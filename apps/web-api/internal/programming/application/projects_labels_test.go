package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

// T60-015 (Plan 60 §3.1 nhóm B, D-05) — hai giá trị dẫn xuất từ cột đã có sẵn
// trong `0001_programming_v1.sql`:
//
//   - `dirty`    = `drafts.content_sha256` khác `manifest.draftContentSha256`
//     của base Revision (so THẬT, không phải cờ tự đặt);
//   - `sequence` = `revisions.sequence`, lộ ra `GET /revisions/{id}` và
//     `draftSequence`/`activeSequence` của item `GET /projects`.
//
// Không có migration mới trong nhóm test này — nếu một ngày phải thêm
// migration để những giá trị này chạy được thì giả định của T60-015 đã sai.

const labelCorrelationID = "task-t60-015-label-0001"

// fakeRuntimeImpactProvider thay Core trong test. `err` khác nil mô phỏng Core
// im (socket không có/không trả lời), `snapshot.ActiveRevisionID` rỗng mô phỏng
// Core đang chạy nhưng chưa activate Revision nào.
type fakeRuntimeImpactProvider struct {
	snapshot RuntimeImpactSnapshot
	err      error
	calls    int
}

func (f *fakeRuntimeImpactProvider) CurrentRuntimeImpact(context.Context) (RuntimeImpactSnapshot, error) {
	f.calls++
	if f.err != nil {
		return RuntimeImpactSnapshot{}, f.err
	}
	return f.snapshot, nil
}

// openLabelProjectService mở Store + ProjectService dùng CÙNG một mốc thời
// gian. Ghim `Options.Now` của Store khớp `service.now` là bắt buộc: TTL biên
// nhận idempotency tính theo `service.now`, để Store dùng đồng hồ thật thì
// `LookupMutation` sẽ báo hết hạn một cách giả và test hỏng muộn theo ngày chạy
// chứ không hỏng ngay.
func openLabelProjectService(t *testing.T) (*ProjectService, *programmingstore.Store) {
	t.Helper()
	fixed := time.Date(2026, 8, 23, 9, 0, 0, 0, time.UTC)
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming-v1.sqlite"),
		Now:  func() time.Time { return fixed },
	})
	if err != nil {
		t.Fatalf("OpenProgrammingStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewProjectService(store, []byte("cursor-secret-task-t60-015"))
	if err != nil {
		t.Fatalf("NewProjectService: %v", err)
	}
	counter := 0
	service.newID = func() string {
		counter++
		return labelUUID(counter)
	}
	service.now = func() time.Time { return fixed }
	return service, store
}

// labelUUID sinh UUID v4 hợp lệ theo đếm — bể ID cố định của
// `openProjectService` chỉ đủ cho một kịch bản và sẽ panic khi cạn.
func labelUUID(index int) string {
	return fmt.Sprintf("%08x-0000-4000-8000-%012x", index, index)
}

func labelCreateProject(t *testing.T, service *ProjectService, name string, keyIndex int) (string, string, string) {
	t.Helper()
	created, err := service.CreateProject(context.Background(), Actor{ID: testActorID, Role: "admin"},
		CreateProjectCommand{SchemaVersion: "1.0", Name: name,
			IdempotencyKey: labelUUID(0x1000 + keyIndex), CorrelationID: labelCorrelationID})
	if err != nil {
		t.Fatalf("CreateProject(%s): %v", name, err)
	}
	return created.Resource["projectId"].(string), created.Resource["draftRevisionId"].(string), created.ETag
}

func labelSaveDraft(t *testing.T, service *ProjectService, projectID, baseRevisionID, etag, tag string, keyIndex int) string {
	t.Helper()
	saved, err := service.SaveDraft(context.Background(), Actor{ID: testActorID, Role: "admin"},
		SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: baseRevisionID,
			Operations:     []json.RawMessage{json.RawMessage(`{"op":"setFunctionalTags","tags":["` + tag + `"]}`)},
			IfMatch:        etag,
			IdempotencyKey: labelUUID(0x2000 + keyIndex), CorrelationID: labelCorrelationID})
	if err != nil {
		t.Fatalf("SaveDraft(%s): %v", tag, err)
	}
	return saved.ETag
}

func labelSealRevision(t *testing.T, service *ProjectService, projectID, baseRevisionID, etag, label string, keyIndex int) (string, string) {
	t.Helper()
	sealed, err := service.SealRevision(context.Background(), Actor{ID: testActorID, Role: "admin"},
		SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: baseRevisionID,
			Label: label, IfMatch: etag,
			IdempotencyKey: labelUUID(0x3000 + keyIndex), CorrelationID: labelCorrelationID})
	if err != nil {
		t.Fatalf("SealRevision(%s): %v", label, err)
	}
	return sealed.Resource["revisionId"].(string), sealed.ETag
}

func wantDirty(t *testing.T, view ProjectView, expected bool, context string) {
	t.Helper()
	if view.Dirty == nil {
		t.Fatalf("%s: dirty = nil; want %v", context, expected)
	}
	if *view.Dirty != expected {
		t.Fatalf("%s: dirty = %v; want %v", context, *view.Dirty, expected)
	}
}

func wantSequence(t *testing.T, actual *int64, expected int64, context string) {
	t.Helper()
	if actual == nil {
		t.Fatalf("%s: sequence = nil; want %d", context, expected)
	}
	if *actual != expected {
		t.Fatalf("%s: sequence = %d; want %d", context, *actual, expected)
	}
}

// TestProjectDirtyFlagComparesDraftDigestWithBaseRevision khoá đúng phép so
// của T60-015: Draft vừa niêm phong phải là SẠCH, và một lần sửa sau đó phải
// làm nó bẩn. Trước T60-015 FE không có cách nào biết điều này ngoài việc tự
// đoán từ ETag.
func TestProjectDirtyFlagComparesDraftDigestWithBaseRevision(t *testing.T) {
	service, _ := openLabelProjectService(t)
	projectID, draftID, etag := labelCreateProject(t, service, "AHU dirty", 1)

	// (a) Chưa niêm phong Revision nào: không tồn tại bản đóng băng nào để
	// Draft trùng, nên `dirty=true` và `draftSequence` là nil (KHÔNG phải 0).
	fresh, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject trước seal: %v", err)
	}
	wantDirty(t, fresh, true, "Project chưa có Revision nào")
	if fresh.DraftSequence != nil {
		t.Fatalf("Draft chưa niêm phong phải có draftSequence=nil, nhận %d", *fresh.DraftSequence)
	}
	if fresh.ActiveSequence != nil {
		t.Fatalf("chưa nối Core phải có activeSequence=nil, nhận %d", *fresh.ActiveSequence)
	}

	etag = labelSaveDraft(t, service, projectID, draftID, etag, "ahu", 1)
	revision1, etag := labelSealRevision(t, service, projectID, draftID, etag, "Bản 1", 1)

	// (b) Ngay sau khi niêm phong: nội dung Draft chưa đổi byte nào so với bản
	// vừa đóng băng ⇒ SẠCH.
	afterSeal, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject sau seal: %v", err)
	}
	wantDirty(t, afterSeal, false, "ngay sau khi niêm phong Revision #1")
	wantSequence(t, afterSeal.DraftSequence, 1, "draftSequence sau seal #1")

	// (c) Một lần sửa Draft ⇒ BẨN, nhưng `draftSequence` vẫn là #1: sửa Draft
	// không sinh Revision mới.
	etag = labelSaveDraft(t, service, projectID, revision1, etag, "ahu-sửa", 2)
	afterEdit, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject sau khi sửa Draft: %v", err)
	}
	wantDirty(t, afterEdit, true, "sau một lần sửa Draft")
	wantSequence(t, afterEdit.DraftSequence, 1, "draftSequence sau khi sửa Draft")

	// (d) Niêm phong lần hai ⇒ sạch trở lại và sequence tiến lên #2.
	revision2, _ := labelSealRevision(t, service, projectID, revision1, etag, "Bản 2", 2)
	afterSecondSeal, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject sau seal #2: %v", err)
	}
	wantDirty(t, afterSecondSeal, false, "ngay sau khi niêm phong Revision #2")
	wantSequence(t, afterSecondSeal.DraftSequence, 2, "draftSequence sau seal #2")

	// (e) `GET /revisions/{id}` lộ đúng sequence của từng Revision.
	for revisionID, expected := range map[string]int64{revision1: 1, revision2: 2} {
		view, err := service.GetRevision(context.Background(), revisionID)
		if err != nil {
			t.Fatalf("GetRevision(%s): %v", revisionID, err)
		}
		if view.Sequence != expected {
			t.Fatalf("GetRevision(%s).Sequence = %d; want %d", revisionID, view.Sequence, expected)
		}
	}

	// (f) Item của `GET /projects` mang đúng cùng giá trị — Overview đọc trang
	// danh sách, không đọc từng Project một.
	page, err := service.ListProjects(context.Background(), "", 10)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("ListProjects items = %d; want 1", len(page.Items))
	}
	wantDirty(t, page.Items[0], false, "item ListProjects")
	wantSequence(t, page.Items[0].DraftSequence, 2, "draftSequence của item ListProjects")
}

// TestProjectDirtyIsNilWhenBaseManifestCannotBeCompared — Revision dựng bằng
// đường khác `revisionPayload` (bundle/test/DB cũ) có manifest KHÔNG mang
// `draftContentSha256`. Khi đó không so được, và câu trả lời đúng là "chưa
// biết" chứ không phải "sạch": trả `false` sẽ giấu mất công việc chưa phát
// hành và làm CTA của Overview chỉ thẳng sang `Open Runtime`.
func TestProjectDirtyIsNilWhenBaseManifestCannotBeCompared(t *testing.T) {
	service, store := openLabelProjectService(t)
	projectID, draftID, etag := labelCreateProject(t, service, "AHU manifest cũ", 2)
	generation, err := ParseDraftETag(etag, draftID)
	if err != nil {
		t.Fatalf("ParseDraftETag: %v", err)
	}
	revisionID, objectID := labelUUID(0x4001), labelUUID(0x4002)
	if _, err := store.CreateRevision(context.Background(), programmingstore.CreateRevisionParams{
		RevisionID: revisionID, ProjectID: projectID, DraftID: draftID, ExpectedDraftETag: generation,
		// Manifest KHÔNG có `draftContentSha256` — đúng hình dạng mà
		// `store.CreateRevision` vẫn chấp nhận.
		ManifestJSON: []byte(`{"schemaVersion":1}`),
		Objects: []programmingstore.RevisionObjectInput{
			{ObjectID: objectID, Kind: "PROGRAM", PayloadJSON: []byte(`{"language":"ST","source":"X:=1;"}`)},
		},
		ActorID: testActorID, Role: "admin", AuditID: labelUUID(0x4003),
		CorrelationID: labelCorrelationID, At: time.Date(2026, 8, 23, 9, 0, 0, 0, time.UTC),
		IdempotencyKeySHA256: sha256.Sum256([]byte("t60-015-manifest-key")),
		RequestSHA256:        sha256.Sum256([]byte("t60-015-manifest-request")),
	}); err != nil {
		t.Fatalf("CreateRevision thô: %v", err)
	}

	view, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if view.Dirty != nil {
		t.Fatalf("manifest không so được phải cho dirty=nil, nhận %v", *view.Dirty)
	}
	// `sequence` vẫn đọc được từ cột `revisions.sequence` — hai giá trị dẫn
	// xuất độc lập, mất cái này không được kéo theo cái kia.
	wantSequence(t, view.DraftSequence, 1, "draftSequence khi manifest thiếu digest")
}

// TestProjectActiveSequenceOnlyFollowsCoreReadBack khoá luật fail-closed của
// `activeSequence`: chỉ hiện khi Core xác nhận, và chỉ khi Revision đó thuộc
// đúng Project đang xem.
func TestProjectActiveSequenceOnlyFollowsCoreReadBack(t *testing.T) {
	service, _ := openLabelProjectService(t)
	projectID, draftID, etag := labelCreateProject(t, service, "AHU active", 3)
	etag = labelSaveDraft(t, service, projectID, draftID, etag, "ahu", 10)
	revision1, etag := labelSealRevision(t, service, projectID, draftID, etag, "Bản 1", 10)
	etag = labelSaveDraft(t, service, projectID, revision1, etag, "ahu-2", 11)
	revision2, _ := labelSealRevision(t, service, projectID, revision1, etag, "Bản 2", 11)

	// Project thứ hai để chứng minh `activeSequence` không rò từ Project khác.
	otherProjectID, otherDraftID, otherETag := labelCreateProject(t, service, "AHU khác", 4)
	otherETag = labelSaveDraft(t, service, otherProjectID, otherDraftID, otherETag, "khác", 12)
	otherRevision, _ := labelSealRevision(t, service, otherProjectID, otherDraftID, otherETag, "Bản khác", 12)

	provider := &fakeRuntimeImpactProvider{}
	service.SetRuntimeImpactProvider(provider)

	cases := []struct {
		name     string
		snapshot RuntimeImpactSnapshot
		err      error
		expected *int64
	}{
		{name: "Core im ⇒ chưa biết", err: errors.New("Core runtime impact unavailable")},
		{name: "Core chạy nhưng chưa activate ⇒ chưa biết",
			snapshot: RuntimeImpactSnapshot{ProducerMode: "GRAPH_ONLY"}},
		{name: "Core báo Revision DB Web không có ⇒ chưa biết",
			snapshot: RuntimeImpactSnapshot{ProducerMode: "PROGRAM_ONLY", ActiveRevisionID: labelUUID(0x7f7f)}},
		{name: "Core báo Revision của Project khác ⇒ chưa biết",
			snapshot: RuntimeImpactSnapshot{ProducerMode: "PROGRAM_ONLY", ActiveRevisionID: otherRevision}},
		{name: "Core chạy Revision #1 của chính Project này",
			snapshot: RuntimeImpactSnapshot{ProducerMode: "PROGRAM_ONLY", ActiveRevisionID: revision1},
			expected: int64Pointer(1)},
		{name: "Core chạy Revision #2 của chính Project này",
			snapshot: RuntimeImpactSnapshot{ProducerMode: "PROGRAM_ONLY", ActiveRevisionID: revision2},
			expected: int64Pointer(2)},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			provider.snapshot, provider.err = testCase.snapshot, testCase.err
			view, err := service.GetProject(context.Background(), projectID)
			if err != nil {
				t.Fatalf("GetProject: %v", err)
			}
			switch {
			case testCase.expected == nil && view.ActiveSequence != nil:
				t.Fatalf("activeSequence = %d; want nil", *view.ActiveSequence)
			case testCase.expected == nil && view.ActiveRevisionID != nil:
				t.Fatalf("activeRevisionId = %q; want nil", *view.ActiveRevisionID)
			case testCase.expected != nil:
				wantSequence(t, view.ActiveSequence, *testCase.expected, "activeSequence")
				if view.ActiveRevisionID == nil || *view.ActiveRevisionID != testCase.snapshot.ActiveRevisionID {
					t.Fatalf("activeRevisionId = %v; want %q", view.ActiveRevisionID, testCase.snapshot.ActiveRevisionID)
				}
			}
		})
	}

	// Trang danh sách hỏi Core ĐÚNG MỘT LẦN cho cả trang: Revision đang chạy là
	// trạng thái của thiết bị, không phải thuộc tính của từng item.
	provider.snapshot = RuntimeImpactSnapshot{ProducerMode: "PROGRAM_ONLY", ActiveRevisionID: revision2}
	provider.err = nil
	before := provider.calls
	page, err := service.ListProjects(context.Background(), "", 10)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if got := provider.calls - before; got != 1 {
		t.Fatalf("ListProjects gọi Core %d lần; want 1", got)
	}
	if len(page.Items) != 2 {
		t.Fatalf("ListProjects items = %d; want 2", len(page.Items))
	}
	for _, item := range page.Items {
		switch item.ProjectID {
		case projectID:
			wantSequence(t, item.ActiveSequence, 2, "activeSequence của Project đang chạy")
		case otherProjectID:
			if item.ActiveSequence != nil {
				t.Fatalf("Project không chạy phải có activeSequence=nil, nhận %d", *item.ActiveSequence)
			}
		default:
			t.Fatalf("item lạ trong trang: %s", item.ProjectID)
		}
	}
}

func int64Pointer(value int64) *int64 { return &value }
