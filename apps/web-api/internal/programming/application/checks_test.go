package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
)

type fakeCheckRunner struct {
	input  programmingcompiler.Input
	result programmingcompiler.Result
	err    error
}

func (f *fakeCheckRunner) Compile(_ context.Context, input programmingcompiler.Input) (programmingcompiler.Result, error) {
	f.input = input
	return f.result, f.err
}

func createCheckRevisionFixture(t *testing.T, service *ProjectService) string {
	t.Helper()
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Check fixture", IdempotencyKey: "30000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "55555555-5555-4555-8555-555555555555"
	taskID := "66666666-6666-4666-8666-666666666666"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{"programId": programID, "name": "P", "kind": "PROGRAM", "language": "ST", "document": "PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n"}})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{"taskId": taskID, "periodMs": 1000, "programOrder": []string{programID}}})
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, task}, IfMatch: created.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(context.Background(), actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Label: "Check", IfMatch: saved.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return sealed.Resource["revisionId"].(string)
}

func TestCheckServiceCompilesImmutableRevisionAndPersistsArtifact(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID := createCheckRevisionFixture(t, projects)
	artifactBytes := []byte("verified-artifact")
	digest := sha256.Sum256(artifactBytes)
	runner := &fakeCheckRunner{result: programmingcompiler.Result{OK: true, Artifact: artifactBytes, ArtifactSHA256: digest, Manifest: json.RawMessage(`{"manifestVersion":1}`),
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1, ProfileID: "revA-1t-1-5-30", LibraryVersion: "rev-a.1", IntegrityMode: "HASH_ONLY", TargetABI: 3841}}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	packager := &fakePackager{}
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: packager,
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	command := RequestCheckCommand{RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000004", CorrelationID: testCorrelationID}
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil || accepted.State != "QUEUED" || len(accepted.RequestHash) != 64 {
		t.Fatalf("accepted=%+v err=%v", accepted, err)
	}
	processed, err := checks.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil || view.State != "PASSED" || view.Artifact == nil || len(view.Diagnostics) != 0 {
		t.Fatalf("view=%+v err=%v", view, err)
	}
	stored, err := store.GetCheck(context.Background(), accepted.CheckID)
	if err != nil || stored.Artifact == nil || stored.Artifact.SchemaVersion != 2 || packager.calls != 1 ||
		len(packager.programs) != 1 || packager.programs[0].PeriodMs != 1000 {
		t.Fatalf("Revision v2 không đóng gói chu kỳ vào container: stored=%+v packager=%+v err=%v",
			stored.Artifact, packager.programs, err)
	}
	if runner.input.SourceID != "55555555-5555-4555-8555-555555555555" || runner.input.Language != "ST" {
		t.Fatalf("compiler input=%+v", runner.input)
	}
	replay, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil || !replay.Replay || replay.CheckID != accepted.CheckID || replay.State != "PASSED" {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
}

// createCheckRevisionFixtureWithBindings tái hiện đúng kịch bản AHU_FanControl
// thật (SupplyTemp VAR_INPUT bind UI-01, FanEnable VAR_OUTPUT bind DO-01) —
// dữ liệu Mapping tab ghi qua upsertVariable/upsertBinding, không phải input
// giả định (F-PROG-ASBUILT-013/D-07).
func createCheckRevisionFixtureWithBindings(t *testing.T, service *ProjectService) string {
	t.Helper()
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Check binding fixture", IdempotencyKey: "30000000-0000-4000-8000-000000000101", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "77777777-7777-4777-8777-777777777777"
	varInID := "88888888-8888-4888-8888-888888888888"
	varOutID := "99999999-9999-4999-8999-999999999999"
	bindInID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	bindOutID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	taskID := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	source := "PROGRAM P\nVAR_INPUT SupplyTemp : REAL; END_VAR\nVAR_OUTPUT FanEnable : BOOL; END_VAR\nFanEnable := SupplyTemp > 25.0;\nEND_PROGRAM\n"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{"programId": programID, "name": "P", "kind": "PROGRAM", "language": "ST", "document": source}})
	varIn, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{"variableId": varInID, "programId": programID, "name": "SupplyTemp", "type": "REAL", "class": "INPUT", "initialValue": nil, "retain": false}})
	varOut, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{"variableId": varOutID, "programId": programID, "name": "FanEnable", "type": "BOOL", "class": "OUTPUT", "initialValue": nil, "retain": false}})
	bindIn, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": map[string]any{"bindingId": bindInID, "variableId": varInID,
		"point": map[string]any{"category": "LOCAL", "pointId": "UI-01"}, "direction": "READ", "dataType": "REAL", "writable": false, "qualityPolicy": "REQUIRE_GOOD"}})
	bindOut, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": map[string]any{"bindingId": bindOutID, "variableId": varOutID,
		"point": map[string]any{"category": "LOCAL", "pointId": "DO-01"}, "direction": "WRITE", "dataType": "BOOL", "writable": true, "qualityPolicy": "REQUIRE_GOOD"}})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{"taskId": taskID, "periodMs": 1000, "programOrder": []string{programID}}})
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, varIn, varOut, bindIn, bindOut, task}, IfMatch: created.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000102", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(context.Background(), actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Label: "Check binding", IfMatch: saved.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000103", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return sealed.Resource["revisionId"].(string)
}

func TestCheckServiceResolvesIoMapFromVariablesAndBindings(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID := createCheckRevisionFixtureWithBindings(t, projects)
	artifactBytes := []byte("verified-artifact")
	digest := sha256.Sum256(artifactBytes)
	runner := &fakeCheckRunner{result: programmingcompiler.Result{OK: true, Artifact: artifactBytes, ArtifactSHA256: digest, Manifest: json.RawMessage(`{"manifestVersion":1}`),
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1, ProfileID: "revA-1t-1-5-30", LibraryVersion: "rev-a.1", IntegrityMode: "HASH_ONLY", TargetABI: 3841}}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return time.Date(2026, 8, 14, 10, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	command := RequestCheckCommand{RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000104", CorrelationID: testCorrelationID}
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatalf("request err=%v", err)
	}
	processed, err := checks.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil || view.State != "PASSED" {
		t.Fatalf("view=%+v err=%v", view, err)
	}
	if len(runner.input.IoMap) != 2 {
		t.Fatalf("io map entries=%d want 2: %+v", len(runner.input.IoMap), runner.input.IoMap)
	}
	byVar := map[string]programmingcompiler.IoMapEntry{}
	for _, entry := range runner.input.IoMap {
		byVar[entry.Variable] = entry
	}
	in, ok := byVar["SupplyTemp"]
	if !ok || in.Direction != "input" || in.PointID != "UI-01" || in.Type != "REAL" || in.Category != "LOCAL" || in.Writable {
		t.Fatalf("SupplyTemp entry=%+v ok=%v", in, ok)
	}
	out, ok := byVar["FanEnable"]
	if !ok || out.Direction != "output" || out.PointID != "DO-01" || out.Type != "BOOL" || out.Category != "LOCAL" || !out.Writable {
		t.Fatalf("FanEnable entry=%+v ok=%v", out, ok)
	}
}

// Tái hiện đúng lớp bug F-PROG-ASBUILT-013 phát hiện qua UI-09: một binding
// trỏ tới biến không phải class INPUT/OUTPUT là dữ liệu hỏng (draft.go không
// validate field này ở seal time) — phải chặn TRƯỚC khi gọi compiler, không
// gửi io_map sai lặng lẽ rồi để resolve_io_bindings() (hoặc tệ hơn, không ai)
// bắt lỗi.
func TestCheckServiceFailsClosedWhenBindingReferencesNonIoVariableClass(t *testing.T) {
	projects, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := projects.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Bad class fixture", IdempotencyKey: "30000000-0000-4000-8000-000000000201", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "77777777-7777-4777-8777-777777777777"
	varID := "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	bindID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	taskID := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	source := "PROGRAM P\nVAR X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{"programId": programID, "name": "P", "kind": "PROGRAM", "language": "ST", "document": source}})
	variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{"variableId": varID, "programId": programID, "name": "X", "type": "BOOL", "class": "LOCAL", "initialValue": nil, "retain": false}})
	binding, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": map[string]any{"bindingId": bindID, "variableId": varID,
		"point": map[string]any{"category": "LOCAL", "pointId": "DO-01"}, "direction": "WRITE", "dataType": "BOOL", "writable": true, "qualityPolicy": "REQUIRE_GOOD"}})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{"taskId": taskID, "periodMs": 1000, "programOrder": []string{programID}}})
	saved, err := projects.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, variable, binding, task}, IfMatch: created.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000202", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := projects.SealRevision(context.Background(), actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Label: "Bad class", IfMatch: saved.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000203", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	revisionID := sealed.Resource["revisionId"].(string)

	runner := &fakeCheckRunner{result: programmingcompiler.Result{OK: true}}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return time.Date(2026, 8, 14, 10, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	command := RequestCheckCommand{RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000204", CorrelationID: testCorrelationID}
	accepted, err := checks.RequestCheck(context.Background(), actor, command)
	if err != nil {
		t.Fatal(err)
	}
	processed, err := checks.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil || view.State != "FAILED" || len(view.Diagnostics) == 0 || view.Diagnostics[0].Code != "PRG-ERR-SCOPE-001" {
		t.Fatalf("view=%+v err=%v", view, err)
	}
	if runner.input.SourceID != "" {
		t.Fatalf("compiler đáng lẽ không được gọi: input=%+v", runner.input)
	}
}

func jsonHashHex(value [32]byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, 64)
	for i, b := range value {
		out[i*2] = digits[b>>4]
		out[i*2+1] = digits[b&15]
	}
	return string(out)
}
