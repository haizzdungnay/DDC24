package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

const (
	projectID     = "11111111-1111-4111-8111-111111111111"
	draftID       = "22222222-2222-4222-8222-222222222222"
	revisionID    = "33333333-3333-4333-8333-333333333333"
	objectID      = "44444444-4444-4444-8444-444444444444"
	actorID       = "admin-operator"
	role          = "admin"
	correlationID = "corr-task104-0000001"
)

var fixedNow = time.Date(2026, 8, 11, 8, 0, 0, 0, time.UTC)

func mutationIdentity(label string) ([32]byte, [32]byte) {
	return sha256.Sum256([]byte("key:" + label)), sha256.Sum256([]byte("request:" + label))
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	store, err := OpenProgrammingStore(context.Background(), Options{
		Path: filepath.Join(dir, "programming-v1.sqlite"),
		Now:  func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func createProjectFixture(t *testing.T, store *Store) Draft {
	t.Helper()
	key, request := mutationIdentity("create-project")
	_, draft, err := store.CreateProject(context.Background(), CreateProjectParams{
		ProjectID: projectID, DraftID: draftID, Name: "AHU tầng 1", Description: "fixture",
		ContentJSON: []byte(`{"schemaVersion":1,"programs":[]}`), ActorID: actorID, Role: role,
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", CorrelationID: correlationID, At: fixedNow,
		IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func createRevisionFixture(t *testing.T, store *Store, etag int64) Revision {
	t.Helper()
	key, request := mutationIdentity(fmt.Sprintf("create-revision-%d", etag))
	revision, err := store.CreateRevision(context.Background(), CreateRevisionParams{
		RevisionID: revisionID, ProjectID: projectID, DraftID: draftID, ExpectedDraftETag: etag,
		ManifestJSON: []byte(`{"schemaVersion":1,"objects":["44444444-4444-4444-8444-444444444444"]}`),
		Objects:      []RevisionObjectInput{{ObjectID: objectID, Kind: "PROGRAM", PayloadJSON: []byte(`{"language":"ST","source":"X:=1;"}`)}},
		ActorID:      actorID, Role: role, AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
		CorrelationID: correlationID, At: fixedNow.Add(time.Second),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err != nil {
		t.Fatal(err)
	}
	return revision
}

func TestOpenProgrammingStoreFreshSchemaPolicyAndRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "programming-v1.sqlite")
	store, err := OpenProgrammingStore(context.Background(), Options{Path: path, Now: func() time.Time { return fixedNow }})
	if err != nil {
		t.Fatal(err)
	}
	expectedTables := []string{"artifacts", "audit_records", "check_requests", "checks", "commission_records", "drafts", "mutation_receipts", "operations", "projects", "revision_objects", "revisions", "schema_migrations"}
	rows, err := store.db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(tables) != fmt.Sprint(expectedTables) {
		t.Fatalf("tables=%v", tables)
	}
	checksum, ok := MigrationChecksum(CurrentSchemaVersion)
	if !ok {
		t.Fatal("missing embedded migration checksum")
	}
	var stored []byte
	var version int
	if err := store.db.QueryRow(`SELECT version,checksum FROM schema_migrations ORDER BY version DESC LIMIT 1`).Scan(&version, &stored); err != nil {
		t.Fatal(err)
	}
	if version != CurrentSchemaVersion || !bytes.Equal(stored, checksum[:]) {
		t.Fatal("schema migration checksum mismatch")
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("db mode=%v err=%v", info.Mode().Perm(), err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenProgrammingStore(context.Background(), Options{Path: path, Now: func() time.Time { return fixedNow }})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := reopened.QuickCheck(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDraftETagConcurrentWriterRevisionImmutableAndRestart(t *testing.T) {
	store := openTestStore(t)
	draft := createProjectFixture(t, store)
	if draft.ETag != 1 || string(draft.ContentJSON) != `{"programs":[],"schemaVersion":1}` {
		t.Fatalf("draft not canonical: %+v %s", draft, draft.ContentJSON)
	}
	type result struct {
		draft Draft
		err   error
	}
	results := make(chan result, 2)
	var start sync.WaitGroup
	start.Add(2)
	for index := 0; index < 2; index++ {
		index := index
		go func() {
			start.Done()
			start.Wait()
			key, request := mutationIdentity(fmt.Sprintf("concurrent-%d", index))
			updated, err := store.SaveDraft(context.Background(), SaveDraftParams{
				DraftID: draftID, ExpectedETag: 1,
				ContentJSON: []byte(fmt.Sprintf(`{"schemaVersion":1,"programs":[%d]}`, index)),
				ActorID:     actorID, Role: role,
				AuditID:       fmt.Sprintf("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb%d", index+1),
				CorrelationID: correlationID, At: fixedNow.Add(time.Duration(index+1) * time.Second),
				IdempotencyKeySHA256: key, RequestSHA256: request,
			})
			results <- result{updated, err}
		}()
	}
	var success, conflict int
	for index := 0; index < 2; index++ {
		result := <-results
		switch {
		case result.err == nil && result.draft.ETag == 2:
			success++
		case errors.Is(result.err, ErrETagConflict):
			conflict++
		default:
			t.Fatalf("unexpected concurrent result: %+v", result)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success=%d conflict=%d", success, conflict)
	}
	revision := createRevisionFixture(t, store, 2)
	if revision.Sequence != 1 || revision.ManifestSHA256 == ([32]byte{}) {
		t.Fatalf("revision=%+v", revision)
	}
	if _, err := store.db.Exec(`UPDATE revisions SET sequence=2 WHERE revision_id=?`, revisionID); err == nil || !strings.Contains(err.Error(), "immutable revisions") {
		t.Fatalf("immutable update was not rejected: %v", err)
	}
	if _, err := store.db.Exec(`DELETE FROM revision_objects WHERE revision_id=?`, revisionID); err == nil {
		t.Fatal("immutable Revision object delete was not rejected")
	}
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatal(err)
	}
	path := store.Path()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenProgrammingStore(context.Background(), Options{Path: path, Now: func() time.Time { return fixedNow }})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	read, err := reopened.GetDraft(context.Background(), draftID)
	if err != nil || read.ETag != 3 || read.BaseRevisionID != revisionID {
		t.Fatalf("restart draft=%+v err=%v", read, err)
	}
}

func TestBeginOperationIdempotencySingleFlightAndAudit(t *testing.T) {
	store := openTestStore(t)
	createProjectFixture(t, store)
	createRevisionFixture(t, store, 1)
	key := sha256.Sum256([]byte("idempotency-key-1"))
	params := BeginOperationParams{
		OperationID: "55555555-5555-4555-8555-555555555555", Kind: "COMMISSION",
		ControllerID: "controller-local", RequestedRevisionID: revisionID,
		IdempotencyKeySHA256: key, CorrelationID: correlationID, ActorID: actorID, Role: role,
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", At: fixedNow.Add(2 * time.Second),
	}
	first, err := store.BeginOperation(context.Background(), params)
	if err != nil || first.Replay || first.State != "PENDING" {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	retry := params
	retry.OperationID = "66666666-6666-4666-8666-666666666666"
	retry.AuditID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"
	retry.CorrelationID = "corr-task104-0000002"
	replayed, err := store.BeginOperation(context.Background(), retry)
	if err != nil || !replayed.Replay || replayed.OperationID != first.OperationID {
		t.Fatalf("replay=%+v err=%v", replayed, err)
	}
	changed := retry
	changed.ExpectedActiveRevisionID = revisionID
	if _, err := store.BeginOperation(context.Background(), changed); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("semantic idempotency mismatch err=%v", err)
	}
	other := params
	other.OperationID = "77777777-7777-4777-8777-777777777777"
	other.AuditID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5"
	other.IdempotencyKeySHA256 = sha256.Sum256([]byte("idempotency-key-2"))
	if _, err := store.BeginOperation(context.Background(), other); err == nil {
		t.Fatal("second active operation on controller was accepted")
	}
	var operationCount, auditCount int
	if err := store.db.QueryRow(`SELECT count(*) FROM operations`).Scan(&operationCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM audit_records`).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if operationCount != 1 || auditCount != 3 { // Project, Revision, first Operation only.
		t.Fatalf("operation=%d audit=%d", operationCount, auditCount)
	}
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestOperationLeaseRestartCASAndContextChecksum(t *testing.T) {
	store := openTestStore(t)
	createProjectFixture(t, store)
	createRevisionFixture(t, store, 1)
	key, request := mutationIdentity("operation-coordinator")
	params := BeginOperationParams{
		OperationID: "55555555-5555-4555-8555-555555555555", Kind: "COMMISSION",
		ControllerID: "controller-local", RequestedRevisionID: revisionID,
		IdempotencyKeySHA256: key, RequestSHA256: request,
		ContextJSON:   []byte(`{"schemaVersion":"1.0","locator":"/state/staging/candidate"}`),
		CorrelationID: correlationID, ActorID: actorID, Role: role,
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", At: fixedNow.Add(2 * time.Second),
	}
	created, err := store.BeginOperation(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	lookup, found, err := store.LookupOperationByIdempotency(context.Background(), actorID,
		"COMMISSION", "controller-local", key, request)
	if err != nil || !found || !lookup.Replay || lookup.OperationID != created.OperationID {
		t.Fatalf("lookup=%+v found=%v err=%v", lookup, found, err)
	}
	claimed, ok, err := store.ClaimOperation(context.Background(), ClaimOperationParams{
		Owner: "worker-a", At: fixedNow.Add(3 * time.Second), Lease: time.Minute})
	if err != nil || !ok || claimed.LeaseGeneration != 1 || claimed.AttemptCount != 1 {
		t.Fatalf("claim=%+v ok=%v err=%v", claimed, ok, err)
	}
	if _, ok, err := store.ClaimOperation(context.Background(), ClaimOperationParams{
		Owner: "worker-b", At: fixedNow.Add(4 * time.Second), Lease: time.Minute}); err != nil || ok {
		t.Fatalf("lease kép ok=%v err=%v", ok, err)
	}
	_, err = store.UpdateOperation(context.Background(), UpdateOperationParams{
		OperationID: claimed.OperationID, LeaseOwner: "worker-a", LeaseGeneration: 2,
		State: "UNKNOWN", Step: "RECONCILE", At: fixedNow.Add(5 * time.Second), ReleaseLease: true})
	if !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("stale generation không bị chặn: %v", err)
	}
	updated, err := store.UpdateOperation(context.Background(), UpdateOperationParams{
		OperationID: claimed.OperationID, LeaseOwner: "worker-a", LeaseGeneration: 1,
		State: "UNKNOWN", Step: "RECONCILE", At: fixedNow.Add(5 * time.Second), ReleaseLease: true})
	if err != nil || updated.LeaseOwner != "" {
		t.Fatalf("release=%+v err=%v", updated, err)
	}
	path := store.Path()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := OpenProgrammingStore(context.Background(), Options{Path: path,
		Now: func() time.Time { return fixedNow.Add(6 * time.Second) }})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	reclaimed, ok, err := restarted.ClaimOperation(context.Background(), ClaimOperationParams{
		Owner: "worker-after-restart", At: fixedNow.Add(6 * time.Second), Lease: time.Minute})
	if err != nil || !ok || reclaimed.State != "UNKNOWN" || reclaimed.LeaseGeneration != 2 {
		t.Fatalf("restart claim=%+v ok=%v err=%v", reclaimed, ok, err)
	}
	if _, err := restarted.db.Exec(`UPDATE operations SET operation_context_json=? WHERE operation_id=?`,
		[]byte(`{}`), reclaimed.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.GetOperation(context.Background(), reclaimed.OperationID); err == nil ||
		!strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("context bị sửa ngoài luồng không được phát hiện: %v", err)
	}
}

func TestCheckLeaseIdempotencyAtomicArtifactAndDeterministicDedup(t *testing.T) {
	store := openTestStore(t)
	createProjectFixture(t, store)
	createRevisionFixture(t, store, 1)
	input := sha256.Sum256([]byte("immutable-revision-input"))
	key, request := mutationIdentity("check-request")
	params := EnqueueCheckParams{CheckID: "77777777-7777-4777-8777-777777777777", RevisionID: revisionID, TargetID: "controller-local",
		InputSHA256: input, Profile: "MKDDC24_REVA", CompilerVersion: "fwsom-st-1.1.0", ActorID: actorID, Role: role,
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7", CorrelationID: correlationID, At: fixedNow,
		IdempotencyKeySHA256: key, RequestSHA256: request}
	queued, err := store.EnqueueCheck(context.Background(), params)
	if err != nil || queued.State != "QUEUED" || queued.Replay {
		t.Fatalf("queued=%+v err=%v", queued, err)
	}
	replayParams := params
	replayParams.CheckID = "88888888-8888-4888-8888-888888888888"
	replayParams.AuditID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8"
	replayed, err := store.EnqueueCheck(context.Background(), replayParams)
	if err != nil || !replayed.Replay || replayed.CheckID != queued.CheckID {
		t.Fatalf("replay=%+v err=%v", replayed, err)
	}
	changed := replayParams
	changed.RequestSHA256 = sha256.Sum256([]byte("changed"))
	if _, err := store.EnqueueCheck(context.Background(), changed); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed request err=%v", err)
	}
	claimed, ok, err := store.ClaimCheck(context.Background(), "worker-a", fixedNow, time.Minute)
	if err != nil || !ok || claimed.AttemptCount != 1 || claimed.State != "RUNNING" {
		t.Fatalf("claim=%+v ok=%v err=%v", claimed, ok, err)
	}
	artifactBytes := []byte("same-deterministic-artifact")
	artifactDigest := sha256.Sum256(artifactBytes)
	result := []byte(`{"schemaVersion":"1.0","diagnostics":[]}`)
	completed, err := store.CompleteCheck(context.Background(), CompleteCheckParams{CheckID: claimed.CheckID, LeaseOwner: "worker-a", State: "PASSED", ResultJSON: result,
		Artifact: &Artifact{ArtifactID: "99999999-9999-4999-8999-999999999999", RevisionID: revisionID, CheckID: claimed.CheckID, SchemaVersion: 1,
			Profile: "MKDDC24_REVA", TargetABI: 3841, CompilerVersion: "fwsom-st-1.1.0", LibraryVersion: "rev-a.1", ByteSize: int64(len(artifactBytes)), SHA256: artifactDigest, RelativePath: "sha256/aa/a.mkir", IntegrityMode: "HASH_ONLY"},
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", At: fixedNow.Add(time.Second)})
	if err != nil || completed.State != "PASSED" || completed.Artifact == nil {
		t.Fatalf("complete=%+v err=%v", completed, err)
	}
	if _, err := store.CompleteCheck(context.Background(), CompleteCheckParams{CheckID: claimed.CheckID, LeaseOwner: "worker-a", State: "FAILED", ResultJSON: result, AuditID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", At: fixedNow.Add(2 * time.Second)}); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("terminal rewrite err=%v", err)
	}
	secondKey, secondRequest := mutationIdentity("check-request-second")
	secondParams := params
	secondParams.CheckID = "88888888-8888-4888-8888-888888888888"
	secondParams.AuditID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
	secondParams.IdempotencyKeySHA256, secondParams.RequestSHA256 = secondKey, secondRequest
	if _, err := store.EnqueueCheck(context.Background(), secondParams); err != nil {
		t.Fatal(err)
	}
	secondClaim, ok, err := store.ClaimCheck(context.Background(), "worker-b", fixedNow.Add(2*time.Second), time.Minute)
	if err != nil || !ok {
		t.Fatalf("second claim=%+v ok=%v err=%v", secondClaim, ok, err)
	}
	_, err = store.CompleteCheck(context.Background(), CompleteCheckParams{CheckID: secondClaim.CheckID, LeaseOwner: "worker-b", State: "PASSED", ResultJSON: result,
		Artifact: &Artifact{ArtifactID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", RevisionID: revisionID, CheckID: secondClaim.CheckID, SchemaVersion: 1,
			Profile: "MKDDC24_REVA", TargetABI: 3841, CompilerVersion: "fwsom-st-1.1.0", LibraryVersion: "rev-a.1", ByteSize: int64(len(artifactBytes)), SHA256: artifactDigest, RelativePath: "sha256/aa/a.mkir", IntegrityMode: "HASH_ONLY"},
		AuditID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", At: fixedNow.Add(3 * time.Second)})
	if err != nil {
		t.Fatalf("cùng artifact deterministic phải được phép: %v", err)
	}
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// TestGetLatestCheckForRevision — WP-01 (Overview state model, D-01,
// REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15 §5.2). Khác
// GetPassedCheckForRevision (chỉ tìm bản PASSED, dùng cho Commission), hàm
// này phải trả Check gần nhất bất kể state — kể cả khi Check mới nhất đang
// QUEUED/RUNNING hoặc vừa FAILED sau một lần PASSED trước đó (tái Check trên
// cùng Revision).
func TestGetLatestCheckForRevision(t *testing.T) {
	store := openTestStore(t)
	createProjectFixture(t, store)
	createRevisionFixture(t, store, 1)

	if _, err := store.GetLatestCheckForRevision(context.Background(), revisionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("chưa Check lần nào phải trả ErrNotFound, got %v", err)
	}
	if _, err := store.GetLatestCheckForRevision(context.Background(), "not-a-uuid"); err == nil {
		t.Fatal("revisionID không hợp lệ phải bị từ chối")
	}

	input := sha256.Sum256([]byte("latest-check-fixture"))
	firstKey, firstRequest := mutationIdentity("latest-check-first")
	queued, err := store.EnqueueCheck(context.Background(), EnqueueCheckParams{
		CheckID: "55555555-5555-4555-8555-555555555551", RevisionID: revisionID, TargetID: "controller-local",
		InputSHA256: input, Profile: "MKDDC24_REVA", CompilerVersion: "fwsom-st-1.1.0", ActorID: actorID, Role: role,
		AuditID: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", CorrelationID: correlationID, At: fixedNow,
		IdempotencyKeySHA256: firstKey, RequestSHA256: firstRequest,
	})
	if err != nil {
		t.Fatal(err)
	}
	latest, err := store.GetLatestCheckForRevision(context.Background(), revisionID)
	if err != nil || latest.CheckID != queued.CheckID || latest.State != "QUEUED" {
		t.Fatalf("phải thấy đúng Check vừa QUEUED: latest=%+v err=%v", latest, err)
	}

	claimed, ok, err := store.ClaimCheck(context.Background(), "worker-a", fixedNow, time.Minute)
	if err != nil || !ok {
		t.Fatalf("claim=%+v ok=%v err=%v", claimed, ok, err)
	}
	result := []byte(`{"schemaVersion":"1.0","diagnostics":[{"code":"ST-SEM-002","detailCode":"","severity":"ERROR","messageKey":"x","location":{}}]}`)
	if _, err := store.CompleteCheck(context.Background(), CompleteCheckParams{CheckID: claimed.CheckID, LeaseOwner: "worker-a",
		State: "FAILED", ResultJSON: result, AuditID: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", At: fixedNow.Add(time.Second)}); err != nil {
		t.Fatal(err)
	}
	latest, err = store.GetLatestCheckForRevision(context.Background(), revisionID)
	if err != nil || latest.State != "FAILED" || latest.CompletedAtUTCMS == nil {
		t.Fatalf("phải thấy Check vừa FAILED với completedAt: latest=%+v err=%v", latest, err)
	}

	secondKey, secondRequest := mutationIdentity("latest-check-second")
	second, err := store.EnqueueCheck(context.Background(), EnqueueCheckParams{
		CheckID: "55555555-5555-4555-8555-555555555552", RevisionID: revisionID, TargetID: "controller-local",
		InputSHA256: input, Profile: "MKDDC24_REVA", CompilerVersion: "fwsom-st-1.1.0", ActorID: actorID, Role: role,
		AuditID: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3", CorrelationID: correlationID, At: fixedNow.Add(2 * time.Second),
		IdempotencyKeySHA256: secondKey, RequestSHA256: secondRequest,
	})
	if err != nil {
		t.Fatal(err)
	}
	latest, err = store.GetLatestCheckForRevision(context.Background(), revisionID)
	if err != nil || latest.CheckID != second.CheckID || latest.State != "QUEUED" {
		t.Fatalf("Check thứ hai (mới hơn) phải thắng dù Check đầu đã terminal trước: latest=%+v err=%v", latest, err)
	}

	// CTO/Owner approval 2026-08-15 §1 WP-01: bổ sung nhánh "success" (PASSED)
	// tường minh — trước đó test chỉ phủ QUEUED/FAILED, chưa từng thấy
	// GetLatestCheckForRevision phản ánh đúng một Check PASSED kèm Artifact.
	secondClaim, ok, err := store.ClaimCheck(context.Background(), "worker-b", fixedNow.Add(3*time.Second), time.Minute)
	if err != nil || !ok || secondClaim.CheckID != second.CheckID {
		t.Fatalf("claim Check thứ hai: claimed=%+v ok=%v err=%v", secondClaim, ok, err)
	}
	passArtifactBytes := []byte("latest-check-passed-artifact")
	passArtifactDigest := sha256.Sum256(passArtifactBytes)
	passResult := []byte(`{"schemaVersion":"1.0","diagnostics":[]}`)
	if _, err := store.CompleteCheck(context.Background(), CompleteCheckParams{
		CheckID: secondClaim.CheckID, LeaseOwner: "worker-b", State: "PASSED", ResultJSON: passResult,
		Artifact: &Artifact{ArtifactID: "55555555-5555-4555-8555-555555555553", RevisionID: revisionID, CheckID: secondClaim.CheckID, SchemaVersion: 1,
			Profile: "MKDDC24_REVA", TargetABI: 3841, CompilerVersion: "fwsom-st-1.1.0", LibraryVersion: "rev-a.1",
			ByteSize: int64(len(passArtifactBytes)), SHA256: passArtifactDigest, RelativePath: "sha256/bb/b.mkir", IntegrityMode: "HASH_ONLY"},
		AuditID: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4", At: fixedNow.Add(3 * time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	latest, err = store.GetLatestCheckForRevision(context.Background(), revisionID)
	if err != nil || latest.State != "PASSED" || latest.CompletedAtUTCMS == nil || latest.CheckID != second.CheckID {
		t.Fatalf("phải thấy Check PASSED gần nhất kèm completedAt: latest=%+v err=%v", latest, err)
	}
}

func TestBackupVerifyRestoreIsPointInTimeAndNoOverwrite(t *testing.T) {
	store := openTestStore(t)
	createProjectFixture(t, store)
	dir := t.TempDir()
	backupPath := filepath.Join(dir, "programming-backup.sqlite")
	evidence, err := store.Backup(context.Background(), backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if evidence.QuickCheck != "ok" || evidence.DatabaseVersion != CurrentSchemaVersion || len(evidence.SHA256) != 64 {
		t.Fatalf("backup evidence=%+v", evidence)
	}
	manifestRaw, err := os.ReadFile(evidence.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest BackupEvidence
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil || manifest.SHA256 != evidence.SHA256 {
		t.Fatalf("manifest=%+v err=%v", manifest, err)
	}
	key, request := mutationIdentity("backup-save")
	if _, err := store.SaveDraft(context.Background(), SaveDraftParams{
		DraftID: draftID, ExpectedETag: 1, ContentJSON: []byte(`{"schemaVersion":1,"programs":[1]}`),
		ActorID: actorID, Role: role, AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
		CorrelationID: correlationID, At: fixedNow.Add(time.Second),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	}); err != nil {
		t.Fatal(err)
	}
	restorePath := filepath.Join(dir, "restored.sqlite")
	if err := RestoreBackup(context.Background(), backupPath, restorePath); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenProgrammingStore(context.Background(), Options{Path: restorePath, Now: func() time.Time { return fixedNow }})
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	draft, err := restored.GetDraft(context.Background(), draftID)
	if err != nil || draft.ETag != 1 {
		t.Fatalf("restored draft=%+v err=%v", draft, err)
	}
	before, _ := os.ReadFile(backupPath)
	if _, err := store.Backup(context.Background(), backupPath); err == nil {
		t.Fatal("backup overwrite was accepted")
	}
	after, _ := os.ReadFile(backupPath)
	if !bytes.Equal(before, after) {
		t.Fatal("existing backup changed after rejected overwrite")
	}
	manifestCollisionDestination := filepath.Join(dir, "manifest-collision.sqlite")
	manifestCollisionPath := manifestCollisionDestination + ".manifest.json"
	manifestSentinel := []byte("do-not-delete")
	if err := os.WriteFile(manifestCollisionPath, manifestSentinel, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Backup(context.Background(), manifestCollisionDestination); err == nil {
		t.Fatal("backup accepted a pre-existing manifest")
	}
	if got, err := os.ReadFile(manifestCollisionPath); err != nil || !bytes.Equal(got, manifestSentinel) {
		t.Fatalf("pre-existing manifest changed got=%q err=%v", got, err)
	}
	if _, err := os.Stat(manifestCollisionDestination); !os.IsNotExist(err) {
		t.Fatalf("destination leaked after manifest collision: %v", err)
	}
	corrupt := filepath.Join(dir, "corrupt.sqlite")
	if err := os.WriteFile(corrupt, []byte("not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyBackup(context.Background(), corrupt); err == nil {
		t.Fatal("corrupt backup passed verification")
	}
	if _, err := store.db.Exec(`DROP TRIGGER schema_migrations_no_update`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`UPDATE schema_migrations SET checksum=zeroblob(32)`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Backup(context.Background(), filepath.Join(dir, "bad-checksum.sqlite")); !errors.Is(err, ErrSchemaChecksum) {
		t.Fatalf("backup accepted corrupt migration checksum: %v", err)
	}
}

func TestMigrationFaultChecksumPartialAndCorruptFailClosed(t *testing.T) {
	for _, point := range []string{"before_apply", "after_sql", "before_commit"} {
		t.Run(point, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "fault.sqlite")
			db := openRawSQLite(t, path)
			defer db.Close()
			injected := errors.New("simulated power cut")
			_, err := Migrate(context.Background(), db, MigrationOptions{AppliedAtUTCMS: fixedNow.UnixMilli(), FaultHook: func(candidate string, _ int) error {
				if candidate == point {
					return injected
				}
				return nil
			}})
			if !errors.Is(err, injected) {
				t.Fatalf("point=%s err=%v", point, err)
			}
			count, err := managedTableCount(context.Background(), db)
			if err != nil || count != 0 {
				t.Fatalf("partial schema after %s: count=%d err=%v", point, count, err)
			}
			if _, err := Migrate(context.Background(), db, MigrationOptions{AppliedAtUTCMS: fixedNow.UnixMilli()}); err != nil {
				t.Fatal(err)
			}
		})
	}
	t.Run("checksum", func(t *testing.T) {
		store := openTestStore(t)
		if _, err := store.db.Exec(`DROP TRIGGER schema_migrations_no_update`); err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.Exec(`UPDATE schema_migrations SET checksum=zeroblob(32)`); err != nil {
			t.Fatal(err)
		}
		if _, err := Migrate(context.Background(), store.db, MigrationOptions{}); !errors.Is(err, ErrSchemaChecksum) {
			t.Fatalf("checksum err=%v", err)
		}
	})
	t.Run("user-version", func(t *testing.T) {
		store := openTestStore(t)
		if _, err := store.db.Exec(`PRAGMA user_version=6`); err != nil {
			t.Fatal(err)
		}
		if _, err := Migrate(context.Background(), store.db, MigrationOptions{}); !errors.Is(err, ErrSchemaFuture) {
			t.Fatalf("future user_version err=%v", err)
		}
	})
	t.Run("partial", func(t *testing.T) {
		db := openRawSQLite(t, filepath.Join(t.TempDir(), "partial.sqlite"))
		defer db.Close()
		if _, err := db.Exec(`CREATE TABLE projects(project_id TEXT)`); err != nil {
			t.Fatal(err)
		}
		if _, err := Migrate(context.Background(), db, MigrationOptions{}); !errors.Is(err, ErrPartialSchema) {
			t.Fatalf("partial err=%v", err)
		}
	})
	t.Run("corrupt-open", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "corrupt.sqlite")
		original := []byte("not a sqlite database")
		if err := os.WriteFile(path, original, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := OpenProgrammingStore(context.Background(), Options{Path: path}); err == nil {
			t.Fatal("corrupt DB was auto-created")
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(original, after) {
			t.Fatal("corrupt DB was modified")
		}
	})
}

func TestMigrationV1ToCurrentCreatesVerifiedBackup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "programming-v1.sqlite")
	db := openRawSQLite(t, path)
	migrations, err := embeddedMigrations()
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(migrations[0].SQL); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`INSERT INTO schema_migrations(version,name,checksum,applied_at_utc_ms) VALUES(?,?,?,?)`,
		1, migrations[0].Name, migrations[0].Checksum[:], fixedNow.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	backupDir := filepath.Join(dir, "backups")
	store, err := OpenProgrammingStore(context.Background(), Options{Path: path, BackupDir: backupDir, Now: func() time.Time { return fixedNow }})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var version int
	if err := store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != CurrentSchemaVersion {
		t.Fatalf("user_version=%d err=%v", version, err)
	}
	var receiptTable int
	if err := store.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='mutation_receipts'`).Scan(&receiptTable); err != nil || receiptTable != 1 {
		t.Fatalf("mutation_receipts=%d err=%v", receiptTable, err)
	}
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("backup files=%d; want database + manifest", len(entries))
	}
}

func TestDiskFullAndAuditSensitiveDataRollback(t *testing.T) {
	store := openTestStore(t)
	var pageCount int
	if err := store.db.QueryRow(`PRAGMA page_count`).Scan(&pageCount); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(fmt.Sprintf("PRAGMA max_page_count=%d", pageCount)); err != nil {
		t.Fatal(err)
	}
	large := `{"schemaVersion":1,"payload":"` + strings.Repeat("x", 1024*1024) + `"}`
	key, request := mutationIdentity("disk-full")
	_, _, err := store.CreateProject(context.Background(), CreateProjectParams{
		ProjectID: projectID, DraftID: draftID, Name: "disk full", ContentJSON: []byte(large),
		ActorID: actorID, Role: role, AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7",
		CorrelationID: correlationID, At: fixedNow,
		IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err == nil {
		t.Fatal("simulated SQLITE_FULL accepted a large transaction")
	}
	var projectCount, auditCount int
	if err := store.db.QueryRow(`SELECT count(*) FROM projects`).Scan(&projectCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM audit_records`).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if projectCount != 0 || auditCount != 0 {
		t.Fatalf("disk-full left partial state project=%d audit=%d", projectCount, auditCount)
	}
	// Mở store mới vì max_page_count của connection trên đã cố ý bị giới hạn.
	clean := openTestStore(t)
	_, err = clean.CommitAudit(context.Background(), AuditInput{
		AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8", ActorID: actorID, Role: role,
		Action: "SECURITY_TEST", TargetType: "CONTROLLER", TargetID: "local",
		OccurredAtUTCMS: fixedNow.UnixMilli(), ResultCode: "REJECTED", CorrelationID: correlationID,
		DetailsJSON: []byte(`{"token":"must-not-persist"}`),
	})
	if err == nil {
		t.Fatal("sensitive audit details accepted")
	}
	if err := clean.db.QueryRow(`SELECT count(*) FROM audit_records`).Scan(&auditCount); err != nil || auditCount != 0 {
		t.Fatalf("sensitive audit persisted count=%d err=%v", auditCount, err)
	}
}

func TestAuditChainDetectsTamperAfterOutOfBandTriggerRemoval(t *testing.T) {
	store := openTestStore(t)
	createProjectFixture(t, store)
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DROP TRIGGER audit_records_no_update`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`UPDATE audit_records SET record_hash=zeroblob(32) WHERE sequence=1`); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyAuditChain(context.Background()); err == nil {
		t.Fatal("tampered audit chain passed verification")
	}
}

func openRawSQLite(t *testing.T, path string) *sql.DB {
	t.Helper()
	absPath, err := filepath.Abs(path)
	if err != nil {
		t.Fatal(err)
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(absPath), RawQuery: url.Values{
		"_pragma": {"foreign_keys(1)", "journal_mode(WAL)", "synchronous(FULL)", "busy_timeout(5000)"},
		"_txlock": {"immediate"},
	}.Encode()}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestMigrationChecksumStableFixture(t *testing.T) {
	checksum, ok := MigrationChecksum(1)
	if !ok {
		t.Fatal("missing migration checksum")
	}
	// Fixture này buộc review có chủ ý khi schema v1 đổi sau khi đã phát hành.
	const expected = "427c21772586a8ca3f885f41103d31ee1983071c0e1499ff1d97199a891c3db9"
	if got := hex.EncodeToString(checksum[:]); got != expected {
		t.Fatalf("migration checksum=%s want=%s", got, expected)
	}
	v2Checksum, ok := MigrationChecksum(2)
	if !ok {
		t.Fatal("missing migration v2 checksum")
	}
	const expectedV2 = "8ae5e0df06d9735727de6809c24565bf6e4e0c0fbcbe0f3e10b5d76365c53fe3"
	if got := hex.EncodeToString(v2Checksum[:]); got != expectedV2 {
		t.Fatalf("migration v2 checksum=%s want=%s", got, expectedV2)
	}
}

func TestCanonicalJSONObjectRejectsAmbiguousInput(t *testing.T) {
	for _, raw := range []string{
		`[]`,
		`{"schemaVersion":1,"schemaVersion":2}`,
		`{"schemaVersion":1} trailing`,
	} {
		if _, err := canonicalJSONObject([]byte(raw), 1024); err == nil {
			t.Fatalf("ambiguous JSON was accepted: %s", raw)
		}
	}
	normalized, err := canonicalJSONObject([]byte(`{"e\u0301":"e\u0301"}`), 1024)
	if err != nil || string(normalized) != `{"é":"é"}` {
		t.Fatalf("NFC normalization=%s err=%v", normalized, err)
	}
	if _, err := canonicalJSONObject([]byte(`{"é":1,"e\u0301":2}`), 1024); err == nil {
		t.Fatal("duplicate key after NFC normalization was accepted")
	}
}

func TestProgrammingStoreContractManifest(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được source path")
	}
	contractPath := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "../../../../../contracts/programming/programming_store_v1.manifest.json"))
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		SchemaVersion     int    `json:"schemaVersion"`
		MigrationFile     string `json:"migrationFile"`
		MigrationSHA256   string `json:"migrationSha256"`
		ForeignKeys       bool   `json:"foreignKeys"`
		JournalMode       string `json:"journalMode"`
		Synchronous       string `json:"synchronous"`
		SingleWriter      bool   `json:"singleWriter"`
		FeatureDefaultOff bool   `json:"featureDefaultOff"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	checksum, ok := MigrationChecksum(manifest.SchemaVersion)
	if !ok {
		t.Fatalf("schema version không được hỗ trợ: %d", manifest.SchemaVersion)
	}
	if manifest.MigrationFile != "0005_operation_coordinator.sql" ||
		manifest.MigrationSHA256 != hex.EncodeToString(checksum[:]) ||
		!manifest.ForeignKeys || manifest.JournalMode != "WAL" ||
		manifest.Synchronous != "FULL" || !manifest.SingleWriter || !manifest.FeatureDefaultOff {
		t.Fatalf("Programming store manifest lệch code: %+v", manifest)
	}
}

func TestSchemaTablesFixtureSorted(t *testing.T) {
	store := openTestStore(t)
	rows, err := store.db.Query(`SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	if fmt.Sprint(names) != fmt.Sprint(sorted) || len(names) < 25 {
		t.Fatalf("schema object fixture invalid: %v", names)
	}
}
