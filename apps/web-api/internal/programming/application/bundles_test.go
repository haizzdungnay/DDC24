package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

func openBundleService(t *testing.T) (*ProjectService, *programmingstore.Store) {
	t.Helper()
	/* Ghim Store.now khớp service.now mock: nếu không, TTL 24h của mutation
	 * receipt tính từ mốc cố định bên dưới sẽ bị Store coi là hết hạn theo
	 * đồng hồ thật một khi ngày thật trôi qua mốc đó — xem projects_test.go. */
	fixedNow := time.Date(2026, 8, 11, 11, 0, 0, 0, time.UTC)
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming-bundle.sqlite"),
		Now:  func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewProjectService(store, []byte("cursor-secret-task-prog-206"))
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time { return fixedNow }
	return service, store
}

func createBundleRevisionPair(t *testing.T, service *ProjectService) (string, string, string) {
	t.Helper()
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(ctx, actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "AHU bundle",
		Description: "Fixture source-only", IdempotencyKey: "60000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "65555555-5555-4555-8555-555555555555"
	taskID := "66666666-6666-4666-8666-666666666666"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": "AHU", "kind": "PROGRAM", "language": "ST",
		"document": "PROGRAM AHU\nVAR_OUTPUT Fan : BOOL; END_VAR\nFan := TRUE;\nEND_PROGRAM\n"}})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{
		"taskId": taskID, "periodMs": 1000, "programOrder": []string{programID}}})
	saved, err := service.SaveDraft(ctx, actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, task}, IfMatch: created.ETag,
		IdempotencyKey: "60000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealedOne, err := service.SealRevision(ctx, actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Label: "R1", IfMatch: saved.ETag, IdempotencyKey: "60000000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	revisionOne := sealedOne.Resource["revisionId"].(string)
	variableID := "67777777-7777-4777-8777-777777777777"
	bindingID := "68888888-8888-4888-8888-888888888888"
	variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{
		"variableId": variableID, "programId": programID, "name": "Fan", "type": "BOOL", "retain": true}})
	binding, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": map[string]any{
		"bindingId": bindingID, "variableId": variableID, "pointId": "BO-1", "direction": "WRITE"}})
	savedTwo, err := service.SaveDraft(ctx, actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: revisionOne,
		Operations: []json.RawMessage{variable, binding}, IfMatch: sealedOne.ETag,
		IdempotencyKey: "60000000-0000-4000-8000-000000000004", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealedTwo, err := service.SealRevision(ctx, actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: revisionOne,
		Label: "R2", IfMatch: savedTwo.ETag, IdempotencyKey: "60000000-0000-4000-8000-000000000005", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return projectID, revisionOne, sealedTwo.Resource["revisionId"].(string)
}

func TestRevisionChangesDeterministicAndClassifiesSafetyImpact(t *testing.T) {
	service, _ := openBundleService(t)
	_, revisionOne, revisionTwo := createBundleRevisionPair(t, service)
	first, err := service.GetRevisionChanges(context.Background(), revisionOne, revisionTwo)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.GetRevisionChanges(context.Background(), revisionOne, revisionTwo)
	if err != nil {
		t.Fatal(err)
	}
	if first.Impact.ImpactRef == "" || first.Impact.ImpactRef != second.Impact.ImpactRef {
		t.Fatalf("impactRef không deterministic: first=%q second=%q", first.Impact.ImpactRef, second.Impact.ImpactRef)
	}
	if first.Impact.Retain.Status != "PRESENT" || first.Impact.OutputMappingChanges.Status != "PRESENT" ||
		first.Impact.ActiveOverrides.Status != "UNAVAILABLE" || first.Impact.Cutover.Status != "UNAVAILABLE" {
		t.Fatalf("impact fail-closed sai: %+v", first.Impact)
	}
	if len(first.Changes) != 2 || first.Changes[0].Category != "OUTPUT_MAPPING" || first.Changes[1].Category != "RETAIN" {
		t.Fatalf("change classification=%+v", first.Changes)
	}
}

func TestRevisionChangesSupportsExplicitNoActiveBaselineForFirstCommission(t *testing.T) {
	service, _ := openBundleService(t)
	_, revisionOne, _ := createBundleRevisionPair(t, service)
	initial, err := service.GetRevisionChanges(context.Background(), "none", revisionOne)
	if err != nil {
		t.Fatal(err)
	}
	if initial.FromRevisionID != "none" || initial.ToRevisionID != revisionOne ||
		initial.Impact.ImpactRef == "" || len(initial.Changes) == 0 {
		t.Fatalf("initial impact=%+v", initial)
	}
	for _, change := range initial.Changes {
		if change.ChangeType != "ADDED" || change.BeforeSHA256 != nil || change.AfterSHA256 == nil {
			t.Fatalf("baseline none không biểu diễn full candidate: %+v", change)
		}
	}
}

func TestSourceBundleDeterministicRoundTripCreatesDraftOnly(t *testing.T) {
	service, store := openBundleService(t)
	sourceProjectID, revisionOne, revisionTwo := createBundleRevisionPair(t, service)
	actor := Actor{ID: testActorID, Role: "admin"}
	exportOne, err := service.ExportBundle(context.Background(), actor, BundleExportCommand{SchemaVersion: "1.0",
		RevisionIDs: []string{revisionTwo, revisionOne}, IdempotencyKey: "60000000-0000-4000-8000-000000000006", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	exportTwo, err := service.ExportBundle(context.Background(), actor, BundleExportCommand{SchemaVersion: "1.0",
		RevisionIDs: []string{revisionOne, revisionTwo}, IdempotencyKey: "60000000-0000-4000-8000-000000000007", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if exportOne.BundleSHA256 != exportTwo.BundleSHA256 || string(exportOne.Bundle) != string(exportTwo.Bundle) || exportOne.SelectedRevisionID != revisionTwo {
		t.Fatal("bundle không deterministic theo tập Revision bất biến")
	}
	digest := sha256.Sum256(exportOne.Bundle)
	if exportOne.BundleSHA256 != hex.EncodeToString(digest[:]) || exportOne.ByteSize != int64(len(exportOne.Bundle)) {
		t.Fatal("hash/kích thước bundle không khớp bytes")
	}
	command := BundleImportCommand{SchemaVersion: "1.0", Name: "AHU nhập", Description: "Tạo Draft mới",
		Bundle: exportOne.Bundle, ExpectedSHA256: exportOne.BundleSHA256,
		IdempotencyKey: "60000000-0000-4000-8000-000000000008", CorrelationID: testCorrelationID}
	imported, err := service.ImportBundle(context.Background(), actor, command)
	if err != nil {
		t.Fatal(err)
	}
	if imported.Resource["state"] != "DRAFT" || imported.Resource["checkCreated"] != false ||
		imported.Resource["artifactImported"] != false || imported.Resource["commissionStarted"] != false {
		t.Fatalf("import side effect sai: %+v", imported.Resource)
	}
	importedProjectID := imported.Resource["projectId"].(string)
	if importedProjectID == sourceProjectID {
		t.Fatal("import đã tái sử dụng source Project ID")
	}
	project, err := store.GetProject(context.Background(), importedProjectID)
	if err != nil || project.Draft.BaseRevisionID != "" || project.Draft.ETag != 1 {
		t.Fatalf("imported aggregate=%+v err=%v", project, err)
	}
	var document struct {
		Project struct {
			ProjectID string `json:"projectId"`
			Name      string `json:"name"`
		} `json:"project"`
		// T59-301: biến nằm trong `locals` của POU, không còn là collection riêng.
		Objects []struct {
			ObjectID string `json:"objectId"`
			Locals   []any  `json:"locals"`
		} `json:"objects"`
		Programs []any `json:"programs"`
		Bindings []any `json:"bindings"`
	}
	if err := json.Unmarshal(project.Draft.ContentJSON, &document); err != nil || document.Project.ProjectID != importedProjectID ||
		document.Project.Name != "AHU nhập" || len(document.Objects) != 1 || len(document.Programs) != 1 || len(document.Bindings) != 1 {
		t.Fatalf("Draft round-trip=%+v err=%v", document, err)
	}
	if len(document.Objects[0].Locals) != 1 {
		t.Fatalf("biến của POU không đi qua bundle: %+v", document.Objects[0])
	}
	replay, err := service.ImportBundle(context.Background(), actor, command)
	if err != nil || !replay.Replay || replay.Resource["projectId"] != importedProjectID || replay.AuditID != imported.AuditID ||
		replay.Resource["importedFromRevisionId"] != imported.Resource["importedFromRevisionId"] ||
		replay.Resource["bundleSha256"] != imported.Resource["bundleSha256"] || replay.Resource["state"] != "DRAFT" {
		t.Fatalf("import replay=%+v err=%v", replay, err)
	}
	changed := command
	changed.Name = "Tên khác"
	if _, err := service.ImportBundle(context.Background(), actor, changed); !errors.Is(err, programmingstore.ErrIdempotencyConflict) {
		t.Fatalf("import idempotency mismatch err=%v", err)
	}
}

func TestSourceBundleRejectsHashMismatchWithoutMutation(t *testing.T) {
	service, _ := openBundleService(t)
	_, revisionOne, _ := createBundleRevisionPair(t, service)
	actor := Actor{ID: testActorID, Role: "admin"}
	exported, err := service.ExportBundle(context.Background(), actor, BundleExportCommand{SchemaVersion: "1.0",
		RevisionIDs: []string{revisionOne}, IdempotencyKey: "60000000-0000-4000-8000-000000000009", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.ImportBundle(context.Background(), actor, BundleImportCommand{SchemaVersion: "1.0", Name: "Không được tạo",
		Bundle: exported.Bundle, ExpectedSHA256: string(make([]byte, 64)),
		IdempotencyKey: "60000000-0000-4000-8000-000000000010", CorrelationID: testCorrelationID})
	if !errors.Is(err, ErrInvalidBundle) {
		t.Fatalf("hash mismatch err=%v", err)
	}
}
