package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

func TestSignalDependenciesFailClosedAndBecomeStaleAfterDraftChange(t *testing.T) {
	service, store := openProjectService(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(ctx, actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Dependency",
		IdempotencyKey: "91000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	pending, err := service.GetSignalDependencies(ctx, projectID)
	if err != nil || pending.Status != "PENDING_CHECK" || pending.ReasonCode != "NO_SEALED_REVISION" || pending.Dependencies != nil {
		t.Fatalf("Draft chưa seal phải chưa kiểm chứng: %+v err=%v", pending, err)
	}
	sealed, err := service.SealRevision(ctx, actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: created.Resource["draftRevisionId"].(string), Label: "R1", IfMatch: created.ETag,
		IdempotencyKey: "91000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	revisionID := sealed.Resource["revisionId"].(string)
	withoutCheck, err := service.GetSignalDependencies(ctx, projectID)
	if err != nil || withoutCheck.ReasonCode != "NO_CHECK" || withoutCheck.Dependencies != nil {
		t.Fatalf("Revision chưa Check không được thành mảng rỗng: %+v err=%v", withoutCheck, err)
	}
	manifest, err := buildPackageCheckManifest(validManifestInput(t))
	if err != nil {
		t.Fatal(err)
	}
	checkID := "91000000-0000-4000-8000-000000000003"
	key, request := mutationIdentity("signal-dependencies-pass")
	inputHash := sha256.Sum256([]byte("input"))
	fixedNow := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	if _, err := store.EnqueueCheck(ctx, programmingstore.EnqueueCheckParams{CheckID: checkID, RevisionID: revisionID,
		TargetID: "controller-local", InputSHA256: inputHash, Profile: "MKDDC24_REVA", CompilerVersion: checkCompilerVersion,
		ActorID: testActorID, Role: "admin", AuditID: "91000000-0000-4000-8000-000000000004",
		CorrelationID: testCorrelationID, At: fixedNow, IdempotencyKeySHA256: key, RequestSHA256: request}); err != nil {
		t.Fatal(err)
	}
	claimed, ok, err := store.ClaimCheck(ctx, "worker-dependencies", fixedNow.Add(time.Second), time.Minute)
	if err != nil || !ok {
		t.Fatalf("claim=%+v ok=%v err=%v", claimed, ok, err)
	}
	result, _ := json.Marshal(checkResultDocument{SchemaVersion: "1.0", Diagnostics: []DiagnosticView{}, Manifest: manifest})
	artifactBytes := []byte("dependency-artifact")
	artifactHash := sha256.Sum256(artifactBytes)
	if _, err := store.CompleteCheck(ctx, programmingstore.CompleteCheckParams{CheckID: checkID, LeaseOwner: "worker-dependencies", State: "PASSED",
		ResultJSON: result, Artifact: &programmingstore.Artifact{ArtifactID: "91000000-0000-4000-8000-000000000005",
			RevisionID: revisionID, CheckID: checkID, SchemaVersion: 1, Profile: "MKDDC24_REVA", TargetABI: 3841,
			CompilerVersion: checkCompilerVersion, LibraryVersion: "rev-a.4", ByteSize: int64(len(artifactBytes)), SHA256: artifactHash,
			RelativePath: "sha256/de/dependency.mkir", IntegrityMode: "HASH_ONLY"},
		AuditID: "91000000-0000-4000-8000-000000000006", At: fixedNow.Add(2 * time.Second)}); err != nil {
		t.Fatal(err)
	}
	authoritative, err := service.GetSignalDependencies(ctx, projectID)
	if err != nil || authoritative.Status != "AUTHORITATIVE" || authoritative.ReasonCode != "VERIFIED" ||
		len(authoritative.Dependencies) != 1 || authoritative.CheckID == nil || *authoritative.CheckID != checkID {
		t.Fatalf("Check PASSED cùng Draft phải authoritative: %+v err=%v", authoritative, err)
	}
	_, err = service.SaveDraft(ctx, actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: revisionID,
		Operations: []json.RawMessage{json.RawMessage(`{"op":"setFunctionalTags","tags":["changed"]}`)}, IfMatch: sealed.ETag,
		IdempotencyKey: "91000000-0000-4000-8000-000000000007", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	stale, err := service.GetSignalDependencies(ctx, projectID)
	if err != nil || stale.Status != "STALE" || stale.ReasonCode != "DRAFT_CHANGED" || len(stale.Dependencies) != 1 {
		t.Fatalf("Draft đổi sau Check phải stale nhưng giữ impact có nhãn: %+v err=%v", stale, err)
	}

	legacyCheckID := "91000000-0000-4000-8000-000000000008"
	legacyKey, legacyRequest := mutationIdentity("signal-dependencies-legacy-contract")
	if _, err := store.EnqueueCheck(ctx, programmingstore.EnqueueCheckParams{CheckID: legacyCheckID, RevisionID: revisionID,
		TargetID: "controller-local", InputSHA256: inputHash, Profile: "MKDDC24_REVA", CompilerVersion: checkCompilerVersion,
		ActorID: testActorID, Role: "admin", AuditID: "91000000-0000-4000-8000-000000000009",
		CorrelationID: testCorrelationID, At: fixedNow.Add(3 * time.Second), IdempotencyKeySHA256: legacyKey, RequestSHA256: legacyRequest}); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.ClaimCheck(ctx, "worker-legacy-dependencies", fixedNow.Add(4*time.Second), time.Minute); err != nil || !ok {
		t.Fatalf("không claim được Check contract cũ: ok=%v err=%v", ok, err)
	}
	legacyResult, _ := json.Marshal(checkResultDocument{SchemaVersion: "1.0", Diagnostics: []DiagnosticView{}, Manifest: json.RawMessage(`{"schemaVersion":3}`)})
	legacyArtifactBytes := []byte("legacy-dependency-artifact")
	legacyArtifactHash := sha256.Sum256(legacyArtifactBytes)
	if _, err := store.CompleteCheck(ctx, programmingstore.CompleteCheckParams{CheckID: legacyCheckID, LeaseOwner: "worker-legacy-dependencies", State: "PASSED",
		ResultJSON: legacyResult, Artifact: &programmingstore.Artifact{ArtifactID: "91000000-0000-4000-8000-000000000011",
			RevisionID: revisionID, CheckID: legacyCheckID, SchemaVersion: 1, Profile: "MKDDC24_REVA", TargetABI: 3841,
			CompilerVersion: checkCompilerVersion, LibraryVersion: "rev-a.4", ByteSize: int64(len(legacyArtifactBytes)), SHA256: legacyArtifactHash,
			RelativePath: "sha256/le/legacy-dependency.mkir", IntegrityMode: "HASH_ONLY"},
		AuditID: "91000000-0000-4000-8000-000000000010", At: fixedNow.Add(5 * time.Second)}); err != nil {
		t.Fatal(err)
	}
	unavailable, err := service.GetSignalDependencies(ctx, projectID)
	if err != nil || unavailable.Status != "UNAVAILABLE" || unavailable.ReasonCode != "DEPENDENCY_CONTRACT_UNAVAILABLE" || unavailable.Dependencies != nil {
		t.Fatalf("Check contract cũ phải fail closed: %+v err=%v", unavailable, err)
	}
}
