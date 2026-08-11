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
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
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
	if err != nil || view.State != "PASSED" || view.Artifact == nil || view.Artifact.SHA256 != jsonHashHex(digest) || len(view.Diagnostics) != 0 {
		t.Fatalf("view=%+v err=%v", view, err)
	}
	if runner.input.SourceID != "55555555-5555-4555-8555-555555555555" || runner.input.Language != "ST" {
		t.Fatalf("compiler input=%+v", runner.input)
	}
	replay, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil || !replay.Replay || replay.CheckID != accepted.CheckID || replay.State != "PASSED" {
		t.Fatalf("replay=%+v err=%v", replay, err)
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
