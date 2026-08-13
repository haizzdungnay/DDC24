package application

import (
	"context"
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
	for _, key := range []string{"schemaVersion", "project", "programs", "variables", "bindings", "task", "library"} {
		if _, ok := document[key]; !ok {
			t.Fatalf("DraftContentJSON thiếu khoá %q: %+v", key, document)
		}
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
