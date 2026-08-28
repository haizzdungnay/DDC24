package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

const (
	testActorID       = "admin"
	testCorrelationID = "task-prog-204-test-0001"
)

func openProjectService(t *testing.T) (*ProjectService, *programmingstore.Store) {
	t.Helper()
	/* Store.now mặc định time.Now() thật; nếu không ghim khớp với service.now
	 * mock bên dưới thì receipt idempotency (TTL 24h tính từ service.now) sẽ
	 * bị Store coi là hết hạn ngay khi ngày thật trôi qua mốc cố định — làm
	 * LookupMutation báo not-found một cách giả, tốn newID() ngoài dự kiến. */
	fixedNow := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming-v1.sqlite"),
		Now:  func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewProjectService(store, []byte("cursor-secret-task-prog-204"))
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{
		"11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", "44444444-4444-4444-8444-444444444444",
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
	}
	service.newID = func() string {
		id := ids[0]
		ids = ids[1:]
		return id
	}
	service.now = func() time.Time { return time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC) }
	return service, store
}

func TestProjectDraftRevisionLifecycleAndDurableIdempotency(t *testing.T) {
	service, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	create := CreateProjectCommand{SchemaVersion: "1.0", Name: "AHU tầng 1", Description: "Điều khiển AHU",
		IdempotencyKey: "10000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID}
	created, err := service.CreateProject(context.Background(), actor, create)
	if err != nil || created.Replay || created.ETag != `"22222222-2222-4222-8222-222222222222:1"` {
		t.Fatalf("create=%+v err=%v", created, err)
	}
	replay, err := service.CreateProject(context.Background(), actor, create)
	if err != nil || !replay.Replay || replay.AuditID != created.AuditID || replay.ETag != created.ETag {
		t.Fatalf("create replay=%+v err=%v", replay, err)
	}
	changedCreate := create
	changedCreate.Name = "AHU tầng 2"
	if _, err := service.CreateProject(context.Background(), actor, changedCreate); !errors.Is(err, programmingstore.ErrIdempotencyConflict) {
		t.Fatalf("idempotency mismatch err=%v", err)
	}

	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	save := SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{json.RawMessage(`{"op":"setFunctionalTags","tags":["ahu","tầng-1"]}`)},
		IfMatch:    created.ETag, IdempotencyKey: "10000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID}
	saved, err := service.SaveDraft(context.Background(), actor, save)
	if err != nil || saved.ETag != `"22222222-2222-4222-8222-222222222222:2"` {
		t.Fatalf("save=%+v err=%v", saved, err)
	}
	secondSave := save
	secondSave.IfMatch = saved.ETag
	secondSave.IdempotencyKey = "10000000-0000-4000-8000-000000000003"
	secondSave.Operations = []json.RawMessage{json.RawMessage(`{"op":"setFunctionalTags","tags":["ahu","tiết-kiệm"]}`)}
	savedAgain, err := service.SaveDraft(context.Background(), actor, secondSave)
	if err != nil || savedAgain.ETag != `"22222222-2222-4222-8222-222222222222:3"` {
		t.Fatalf("second save=%+v err=%v", savedAgain, err)
	}
	oldReplay, err := service.SaveDraft(context.Background(), actor, save)
	if err != nil || !oldReplay.Replay || oldReplay.ETag != saved.ETag {
		t.Fatalf("old replay=%+v err=%v", oldReplay, err)
	}
	stale := secondSave
	stale.IdempotencyKey = "10000000-0000-4000-8000-000000000004"
	stale.IfMatch = created.ETag
	if _, err := service.SaveDraft(context.Background(), actor, stale); !errors.Is(err, programmingstore.ErrETagConflict) {
		t.Fatalf("stale save err=%v", err)
	}

	seal := SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Label: "Bản đầu tiên", Comment: "đóng từ Draft", IfMatch: savedAgain.ETag,
		IdempotencyKey: "10000000-0000-4000-8000-000000000005", CorrelationID: testCorrelationID}
	sealed, err := service.SealRevision(context.Background(), actor, seal)
	if err != nil || sealed.ETag != `"22222222-2222-4222-8222-222222222222:4"` {
		t.Fatalf("seal=%+v err=%v", sealed, err)
	}
	revisionID := sealed.Resource["revisionId"].(string)
	revision, err := service.GetRevision(context.Background(), revisionID)
	if err != nil || revision.State != "IMMUTABLE" || len(revision.ContentHash) != 64 {
		t.Fatalf("revision=%+v err=%v", revision, err)
	}
	if _, ok := revision.Snapshot["manifest"]; !ok {
		t.Fatal("Revision thiếu manifest")
	}
	draft, err := store.GetDraft(context.Background(), draftID)
	if err != nil || draft.ETag != 4 || draft.BaseRevisionID != revisionID {
		t.Fatalf("draft sau seal=%+v err=%v", draft, err)
	}
	sealReplay, err := service.SealRevision(context.Background(), actor, seal)
	if err != nil || !sealReplay.Replay || sealReplay.Resource["revisionId"] != revisionID {
		t.Fatalf("seal replay=%+v err=%v", sealReplay, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	/* Ghim Now khớp fixedNow ở trên: restart mô phỏng process thật khởi động
	 * lại nên KHÔNG mock lại service.now, nhưng nếu Store dùng đồng hồ thật
	 * thì TTL 24h của receipt seal tính từ fixedNow sẽ bị coi là hết hạn một
	 * khi ngày thật trôi qua fixedNow — làm replay giả thành SealRevision
	 * mới và va ETag conflict, y hệt lỗi đã sửa ở openProjectService(). */
	reopened, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: store.Path(),
		Now:  func() time.Time { return time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restarted, err := NewProjectService(reopened, []byte("cursor-secret-task-prog-204"))
	if err != nil {
		t.Fatal(err)
	}
	restartedReplay, err := restarted.SealRevision(context.Background(), actor, seal)
	if err != nil || !restartedReplay.Replay || restartedReplay.AuditID != sealed.AuditID {
		t.Fatalf("restart replay=%+v err=%v", restartedReplay, err)
	}
}

func TestDraftMutationRejectsUnknownWithoutChangingETag(t *testing.T) {
	service, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Boiler",
		IdempotencyKey: "20000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	_, err = service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{json.RawMessage(`{"op":"unsafeActivate"}`)}, IfMatch: created.ETag,
		IdempotencyKey: "20000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown operation err=%v", err)
	}
	draft, err := store.GetDraft(context.Background(), draftID)
	if err != nil || draft.ETag != 1 {
		t.Fatalf("Draft đổi sau reject: %+v err=%v", draft, err)
	}
}

// TASK-PROG-501: `GET /projects/{projectId}` phải trả đủ nội dung Draft canonical
// (DM-PROG-001 §7) để FE nạp lại ST/FBD/mapping/task đang dở — trước bản này
// không có route nào đọc được nội dung Draft, chỉ có metadata. `GET /projects`
// (danh sách) KHÔNG được nhân bản nội dung đó vào từng item.
func TestGetProjectIncludesDraftContentButListDoesNot(t *testing.T) {
	service, _ := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{
		SchemaVersion: "1.0", Name: "AHU tầng 3", IdempotencyKey: "20000000-0000-4000-8000-000000000001",
		CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{
		ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations:     []json.RawMessage{json.RawMessage(`{"op":"setFunctionalTags","tags":["ahu"]}`)},
		IfMatch:        created.ETag,
		IdempotencyKey: "20000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	savedContent, ok := saved.Resource["content"].(map[string]any)
	if !ok {
		t.Fatalf("SaveDraft.Resource thiếu content đọc-ngược: %+v", saved.Resource)
	}
	if project, ok := savedContent["project"].(map[string]any); !ok || project["functionalTags"] == nil {
		t.Fatalf("content trả về từ SaveDraft thiếu functionalTags: %+v", savedContent)
	}

	view, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if len(view.DraftContentJSON) == 0 {
		t.Fatal("GetProject phải trả DraftContentJSON không rỗng")
	}
	var document map[string]any
	if err := json.Unmarshal(view.DraftContentJSON, &document); err != nil {
		t.Fatalf("DraftContentJSON không phải JSON hợp lệ: %v", err)
	}
	// T59-301: document v2 bỏ `variables` (biến nằm trong `locals` của POU) và bỏ
	// `task` (DDD §4.1 cấm expose Task order), thêm `objects`/`signals`/`execution`.
	for _, key := range []string{"schemaVersion", "project", "objects", "programs", "signals", "bindings", "library", "execution"} {
		if _, ok := document[key]; !ok {
			t.Fatalf("DraftContentJSON thiếu khoá %q: %+v", key, document)
		}
	}
	for _, removed := range []string{"variables", "task"} {
		if _, present := document[removed]; present {
			t.Fatalf("document v2 vẫn còn khoá v1 %q", removed)
		}
	}
	if version, _ := document["schemaVersion"].(float64); int(version) != 2 {
		t.Fatalf("schemaVersion=%v; want 2", document["schemaVersion"])
	}

	page, err := service.ListProjects(context.Background(), "", 10)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("ListProjects items = %d; want 1", len(page.Items))
	}
	if len(page.Items[0].DraftContentJSON) != 0 {
		t.Fatal("ListProjects KHÔNG được nhân bản DraftContentJSON vào từng item")
	}
}

// TestGetProjectAndListProjectsExposeLatestCheck — WP-01 (Overview state
// model, D-01, REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15 §5.2). Trước khi
// niêm phong, LatestCheck phải là nil (không có Revision nào để tra — không
// phải lỗi). Sau khi niêm phong và có một Check (dù QUEUED hay terminal),
// GetProject/ListProjects đều phải thấy đúng Check gần nhất cho
// baseRevisionId hiện hành.
func TestGetProjectAndListProjectsExposeLatestCheck(t *testing.T) {
	service, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{
		SchemaVersion: "1.0", Name: "AHU tầng 4", IdempotencyKey: "30000000-0000-4000-8000-000000000001",
		CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)

	before, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject trước seal: %v", err)
	}
	if before.LatestCheck != nil {
		t.Fatalf("chưa seal thì LatestCheck phải nil, got %+v", before.LatestCheck)
	}

	sealed, err := service.SealRevision(context.Background(), actor, SealRevisionCommand{
		ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID, Label: "v1",
		IfMatch: created.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatalf("SealRevision: %v", err)
	}
	revisionID := sealed.Resource["revisionId"].(string)

	afterSealNoCheck, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject sau seal, trước Check: %v", err)
	}
	if afterSealNoCheck.LatestCheck != nil {
		t.Fatalf("đã seal nhưng chưa Check thì LatestCheck vẫn phải nil, got %+v", afterSealNoCheck.LatestCheck)
	}

	input := [32]byte{1}
	key, request := mutationIdentity("wp01-latest-check")
	if _, err := store.EnqueueCheck(context.Background(), programmingstore.EnqueueCheckParams{
		CheckID: "30000000-0000-4000-8000-000000000003", RevisionID: revisionID, TargetID: "controller-local",
		InputSHA256: input, Profile: "MKDDC24_REVA", CompilerVersion: "fwsom-st-1.1.0", ActorID: testActorID, Role: "admin",
		AuditID: "30000000-0000-4000-8000-000000000004", CorrelationID: testCorrelationID, At: time.Date(2026, 8, 11, 9, 0, 1, 0, time.UTC),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	}); err != nil {
		t.Fatalf("EnqueueCheck: %v", err)
	}

	afterCheck, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject sau Check: %v", err)
	}
	if afterCheck.LatestCheck == nil || afterCheck.LatestCheck.State != "QUEUED" || afterCheck.LatestCheck.RevisionID != revisionID {
		t.Fatalf("LatestCheck phải phản ánh Check vừa enqueue: %+v", afterCheck.LatestCheck)
	}

	page, err := service.ListProjects(context.Background(), "", 10)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].LatestCheck == nil || page.Items[0].LatestCheck.State != "QUEUED" {
		t.Fatalf("ListProjects phải trả cùng LatestCheck cho item: %+v", page.Items)
	}
}

// TestGetProjectReflectsTerminalPassedCheckAndPropagatesRealErrors — CTO/Owner
// approval 2026-08-15 §1 WP-01. Bổ sung 2 nhánh chưa từng test ở tầng
// application: (a) Check PASSED (kèm Artifact) phải phản ánh đúng qua
// GetProject/ListProjects với CompletedAt khác nil — trước đó test chỉ dừng
// ở QUEUED; (b) lỗi đọc DB thật (khác ErrNotFound) từ
// GetLatestCheckForRevision phải propagate ra ngoài GetProject thay vì bị
// latestCheckView() nuốt âm thầm thành nil — chỉ ErrNotFound mới được nuốt.
func TestGetProjectReflectsTerminalPassedCheckAndPropagatesRealErrors(t *testing.T) {
	service, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	fixedNow := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)

	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{
		SchemaVersion: "1.0", Name: "AHU tầng 5", IdempotencyKey: "31000000-0000-4000-8000-000000000001",
		CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)

	sealed, err := service.SealRevision(context.Background(), actor, SealRevisionCommand{
		ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID, Label: "v1",
		IfMatch: created.ETag, IdempotencyKey: "31000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatalf("SealRevision: %v", err)
	}
	revisionID := sealed.Resource["revisionId"].(string)

	input := [32]byte{2}
	key, request := mutationIdentity("wp01-terminal-check")
	if _, err := store.EnqueueCheck(context.Background(), programmingstore.EnqueueCheckParams{
		CheckID: "31000000-0000-4000-8000-000000000003", RevisionID: revisionID, TargetID: "controller-local",
		InputSHA256: input, Profile: "MKDDC24_REVA", CompilerVersion: "fwsom-st-1.1.0", ActorID: testActorID, Role: "admin",
		AuditID: "31000000-0000-4000-8000-000000000004", CorrelationID: testCorrelationID, At: fixedNow.Add(time.Second),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	}); err != nil {
		t.Fatalf("EnqueueCheck: %v", err)
	}
	claimed, ok, err := store.ClaimCheck(context.Background(), "worker-wp01", fixedNow.Add(2*time.Second), time.Minute)
	if err != nil || !ok {
		t.Fatalf("ClaimCheck: claimed=%+v ok=%v err=%v", claimed, ok, err)
	}
	artifactBytes := []byte("wp01-terminal-check-artifact")
	digest := sha256.Sum256(artifactBytes)
	if _, err := store.CompleteCheck(context.Background(), programmingstore.CompleteCheckParams{
		CheckID: claimed.CheckID, LeaseOwner: "worker-wp01", State: "PASSED",
		ResultJSON: []byte(`{"schemaVersion":"1.0","diagnostics":[]}`),
		Artifact: &programmingstore.Artifact{
			ArtifactID: "31000000-0000-4000-8000-000000000005", RevisionID: revisionID, CheckID: claimed.CheckID,
			SchemaVersion: 1, Profile: "MKDDC24_REVA", TargetABI: 3841, CompilerVersion: "fwsom-st-1.1.0",
			LibraryVersion: "rev-a.1", ByteSize: int64(len(artifactBytes)), SHA256: digest,
			RelativePath: "sha256/cc/c.mkir", IntegrityMode: "HASH_ONLY",
		},
		AuditID: "31000000-0000-4000-8000-000000000006", At: fixedNow.Add(3 * time.Second),
	}); err != nil {
		t.Fatalf("CompleteCheck PASSED: %v", err)
	}

	// (a) GetProject/ListProjects phải phản ánh đúng PASSED + CompletedAt.
	afterPass, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject sau Check PASSED: %v", err)
	}
	if afterPass.LatestCheck == nil || afterPass.LatestCheck.State != "PASSED" || afterPass.LatestCheck.CompletedAt == nil {
		t.Fatalf("LatestCheck phải là PASSED kèm CompletedAt: %+v", afterPass.LatestCheck)
	}
	page, err := service.ListProjects(context.Background(), "", 10)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].LatestCheck == nil || page.Items[0].LatestCheck.State != "PASSED" ||
		page.Items[0].LatestCheck.CompletedAt == nil {
		t.Fatalf("ListProjects phải phản ánh cùng Check PASSED: %+v", page.Items)
	}

	// (b) Lỗi đọc DB thật (revisionID không hợp lệ, khác ErrNotFound) phải
	// propagate ra ngoài latestCheckView(), không bị nuốt thành nil.
	if _, err := service.latestCheckView(context.Background(), "not-a-canonical-uuid"); err == nil {
		t.Fatal("revisionID không hợp lệ phải trả lỗi thật, không phải nil im lặng")
	} else if errors.Is(err, programmingstore.ErrNotFound) {
		t.Fatalf("lỗi UUID không hợp lệ không được là ErrNotFound (đó là nhánh 'chưa Check', khác nhánh lỗi thật): %v", err)
	}
}

func mutationIdentity(label string) ([32]byte, [32]byte) {
	return sha256.Sum256([]byte("key:" + label)), sha256.Sum256([]byte("request:" + label))
}
