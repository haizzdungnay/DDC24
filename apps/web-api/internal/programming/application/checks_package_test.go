package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

// perProgramRunner biên dịch theo `SourceID`: mỗi Program một artifact riêng, và
// một tập Program được đánh dấu hỏng. Nó cũng đếm số lần gọi để test kiểm được
// rằng Check biên dịch ĐÚNG số Program, không nhiều hơn.
type perProgramRunner struct {
	mu     sync.Mutex
	calls  []string
	failed map[string]bool
}

func (r *perProgramRunner) Compile(_ context.Context, input programmingcompiler.Input) (programmingcompiler.Result, error) {
	r.mu.Lock()
	r.calls = append(r.calls, input.SourceID)
	failed := r.failed[input.SourceID]
	r.mu.Unlock()
	if failed {
		return programmingcompiler.Result{OK: false, Diagnostics: []programmingcompiler.Diagnostic{
			{Code: "ST-SYN-001", Severity: "ERROR", Message: "lỗi cú pháp mô phỏng"},
		}}, nil
	}
	artifact := []byte("artifact:" + input.SourceID)
	return programmingcompiler.Result{OK: true, Artifact: artifact, ArtifactSHA256: sha256.Sum256(artifact),
		Manifest: json.RawMessage(`{"manifestVersion":1}`), CompilerVersion: checkCompilerVersion,
		ArtifactSchemaVersion: 1, CompilerProfile: 1, ProfileID: "revA-1t-1-5-30",
		LibraryVersion: domain.SystemLibraryVersion, IntegrityMode: "HASH_ONLY", TargetABI: 3841}, nil
}

// fakePackager bọc các artifact thành một blob tất định. Nó KHÔNG mô phỏng định
// dạng container: định dạng thật do `mkddc-st-package` ghi và đã có golden/fuzz
// của T59-106 canh. Ở đây chỉ cần một Packager có hành vi tất định để kiểm phần
// điều phối của Check.
type fakePackager struct {
	mu       sync.Mutex
	calls    int
	programs []programmingcompiler.PackageProgram
	signals  []programmingcompiler.PackageSignal
}

func (p *fakePackager) Package(_ context.Context, programs []programmingcompiler.PackageProgram,
	signals []programmingcompiler.PackageSignal, _ []programmingcompiler.LinkedPOU,
	_ programmingcompiler.LibraryLock) (programmingcompiler.PackageResult, error) {
	p.mu.Lock()
	p.calls++
	p.programs = append([]programmingcompiler.PackageProgram(nil), programs...)
	p.signals = signals
	p.mu.Unlock()
	blob := []byte("PKG")
	for _, program := range programs {
		blob = append(blob, []byte("|"+program.Name+"|")...)
		blob = append(blob, program.Artifact...)
	}
	// Signal cũng phải đi vào nội dung: một packager giả bỏ qua chúng sẽ làm mọi
	// test "package đổi khi signal đổi" xanh mà không chứng minh gì.
	for _, signal := range signals {
		blob = append(blob, []byte(fmt.Sprintf("|S:%s:%d:%d|", signal.Name, signal.Type,
			signal.StalePolicy))...)
	}
	return programmingcompiler.PackageResult{Package: blob, SHA256: sha256.Sum256(blob),
		ByteSize: int64(len(blob)), ProgramCount: len(programs), SchemaVersion: 2, TargetABI: 3841}, nil
}

func TestSingleProgramWithDistinctObjectAndRuntimeIdentityForcesV2(t *testing.T) {
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	packager := &fakePackager{}
	service := &CheckService{packager: packager, artifacts: artifacts,
		newID: func() string { return "89999999-9999-4999-8999-999999999999" }}
	objectID := "81111111-1111-4111-8111-111111111111"
	programID := "82222222-2222-4222-8222-222222222222"
	artifactBytes := []byte("artifact-distinct-runtime-identity")
	digest := sha256.Sum256(artifactBytes)
	stored, packaged, err := service.packageArtifact(context.Background(), programmingstore.Check{}, 2,
		[]programmingcompiler.Input{{SourceID: objectID}},
		[]programmingcompiler.Result{{Artifact: artifactBytes, ArtifactSHA256: digest}},
		[]packageProgramArtifact{{ProgramID: programID}},
		[]packageProgramTopology{{ObjectID: objectID, ProgramID: programID, PeriodMs: 5000,
			BudgetUs: programBudgetUs(5000)}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if packaged == nil || stored.SchemaVersion != 2 || len(packager.programs) != 1 {
		t.Fatalf("Document v2 một Program không được bọc v2: stored=%+v packaged=%+v",
			stored, packaged)
	}
	if packager.programs[0].Name != programID || packager.programs[0].PeriodMs != 5000 {
		t.Fatalf("runtime identity/topology sai: %+v", packager.programs[0])
	}
}

func TestSchemaV2SingleProgramAlwaysPackagesSealedPeriod(t *testing.T) {
	for _, periodMs := range []int64{5000, 30000} {
		t.Run(fmt.Sprintf("period_%d_ms", periodMs), func(t *testing.T) {
			artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
			if err != nil {
				t.Fatal(err)
			}
			packager := &fakePackager{}
			service := &CheckService{packager: packager, artifacts: artifacts,
				newID: func() string { return "89999999-9999-4999-8999-999999999999" }}
			programID := "81111111-1111-4111-8111-111111111111"
			artifactBytes := []byte("artifact-v2-single-program")
			digest := sha256.Sum256(artifactBytes)
			stored, packaged, err := service.packageArtifact(context.Background(), programmingstore.Check{}, 2,
				[]programmingcompiler.Input{{SourceID: programID}},
				[]programmingcompiler.Result{{Artifact: artifactBytes, ArtifactSHA256: digest,
					ArtifactSchemaVersion: 1}},
				[]packageProgramArtifact{{ProgramID: programID}},
				[]packageProgramTopology{{ObjectID: programID, ProgramID: programID, PeriodMs: periodMs,
					BudgetUs: programBudgetUs(periodMs)}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if packaged == nil || packaged.SchemaVersion != 2 || stored.SchemaVersion != 2 || packager.calls != 1 {
				t.Fatalf("Revision v2 một Program không tạo container v2: stored=%+v packaged=%+v calls=%d",
					stored, packaged, packager.calls)
			}
			if len(packager.programs) != 1 || packager.programs[0].PeriodMs != periodMs {
				t.Fatalf("periodMs không tới writer v2: %+v", packager.programs)
			}
		})
	}
}

func TestSchemaV1SingleProgramPreservesHistoricalArtifactV1(t *testing.T) {
	packager := &fakePackager{}
	service := &CheckService{packager: packager,
		newID: func() string { return "89999999-9999-4999-8999-999999999999" }}
	programID := "81111111-1111-4111-8111-111111111111"
	artifactBytes := []byte("historical-artifact-v1")
	digest := sha256.Sum256(artifactBytes)
	stored, packaged, err := service.packageArtifact(context.Background(), programmingstore.Check{}, 1,
		[]programmingcompiler.Input{{SourceID: programID}},
		[]programmingcompiler.Result{{Artifact: artifactBytes, ArtifactSHA256: digest,
			ArtifactSchemaVersion: 1}},
		[]packageProgramArtifact{{ProgramID: programID, RelativePath: "legacy/artifact.mkir"}},
		[]packageProgramTopology{{ObjectID: programID, ProgramID: programID, PeriodMs: 5000,
			BudgetUs: programBudgetUs(5000)}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if packaged != nil || stored.SchemaVersion != 1 || stored.RelativePath != "legacy/artifact.mkir" || packager.calls != 0 {
		t.Fatalf("artifact v1 lịch sử không được passthrough nguyên trạng: stored=%+v packaged=%+v calls=%d",
			stored, packaged, packager.calls)
	}
}

func createLegacySchemaV1CheckRevision(t *testing.T, projects *ProjectService,
	store *programmingstore.Store) (string, string) {
	t.Helper()
	created, err := projects.CreateProject(context.Background(), Actor{ID: testActorID, Role: "admin"},
		CreateProjectCommand{SchemaVersion: "1.0", Name: "Legacy schema v1",
			IdempotencyKey: "31100000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	generation, err := ParseDraftETag(created.ETag, draftID)
	if err != nil {
		t.Fatal(err)
	}
	programID := "86666666-6666-4666-8666-666666666666"
	taskID := "85555555-5555-4555-8555-555555555555"
	revisionID := "83333333-3333-4333-8333-333333333333"
	programPayload, _ := json.Marshal(map[string]any{
		"programId": programID, "name": "LEGACY", "kind": "PROGRAM", "language": "ST",
		"document": "PROGRAM LEGACY\nEND_PROGRAM\n",
	})
	taskPayload, _ := json.Marshal(map[string]any{
		"taskId": taskID, "periodMs": 5000, "programOrder": []string{programID},
	})
	_, err = store.CreateRevision(context.Background(), programmingstore.CreateRevisionParams{
		RevisionID: revisionID, ProjectID: projectID, DraftID: draftID, ExpectedDraftETag: generation,
		ManifestJSON: []byte(`{"schemaVersion":1}`), DocumentSchemaVersion: 1, ProgramCount: 1,
		Objects: []programmingstore.RevisionObjectInput{
			{ObjectID: programID, Kind: "PROGRAM", PayloadJSON: programPayload},
			{ObjectID: taskID, Kind: "TASK", PayloadJSON: taskPayload},
		},
		ActorID: testActorID, Role: "admin", AuditID: "84444444-4444-4444-8444-444444444444",
		CorrelationID: testCorrelationID, At: time.Date(2026, 8, 11, 9, 30, 0, 0, time.UTC),
		IdempotencyKeySHA256: sha256.Sum256([]byte("legacy-schema-v1-revision-key")),
		RequestSHA256:        sha256.Sum256([]byte("legacy-schema-v1-revision-request")),
	})
	if err != nil {
		t.Fatal(err)
	}
	return revisionID, programID
}

func TestProcessNextPreservesLegacySchemaV1TaskPeriodAndArtifact(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, programID := createLegacySchemaV1CheckRevision(t, projects, store)
	runner := &perProgramRunner{failed: map[string]bool{}}
	checks := newCheckServiceForPackage(t, store, runner)
	packager := &fakePackager{}
	checks.packager = packager

	view := runCheck(t, checks, revisionID, "31100000-0000-4000-8000-000000000002")
	if view.State != "PASSED" || view.Artifact == nil {
		t.Fatalf("Check lại Revision v1 thất bại: %+v", view)
	}
	stored, err := store.GetCheck(context.Background(), view.CheckID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Artifact == nil || stored.Artifact.SchemaVersion != 1 || packager.calls != 0 {
		t.Fatalf("Revision v1 không giữ artifact lịch sử: artifact=%+v packager=%d",
			stored.Artifact, packager.calls)
	}
	var result struct {
		Manifest struct {
			Topology []packageProgramTopology `json:"topology"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(stored.ResultJSON, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Manifest.Topology) != 1 || result.Manifest.Topology[0].ProgramID != programID ||
		result.Manifest.Topology[0].PeriodMs != 5000 {
		t.Fatalf("ProcessNext không giữ TASK.periodMs v1: %+v", result.Manifest.Topology)
	}
}

var checkServiceSeq int

func newCheckServiceForPackage(t *testing.T, store *programmingstore.Store, runner programmingcompiler.Runner) *CheckService {
	t.Helper()
	// Mỗi service phải có `workerID` RIÊNG: `NewCheckService` lấy nó từ `NewID()`,
	// nên hai service dùng chung bộ sinh sẽ có cùng worker ID và lease không còn
	// phân biệt được ai đang giữ Check.
	checkServiceSeq++
	seq := checkServiceSeq
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	counter := 0
	service, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{}, Artifacts: artifacts,
		TargetID: "controller-local", LeaseDuration: time.Minute,
		Now:   func() time.Time { return time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC) },
		NewID: func() string { counter++; return fmt.Sprintf("eeeeeeee-eeee-4eee-8eee-%03d%09d", seq, counter) }})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func TestSingleProgramPublishedSignalForcesV2AndKeepsProgramIdentity(t *testing.T) {
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	packager := &fakePackager{}
	service := &CheckService{packager: packager, artifacts: artifacts,
		newID: func() string { return "89999999-9999-4999-8999-999999999999" }}
	programID := "81111111-1111-4111-8111-111111111111"
	artifactBytes := []byte("artifact-single-with-signal")
	digest := sha256.Sum256(artifactBytes)
	stored, packaged, err := service.packageArtifact(context.Background(), programmingstore.Check{}, 2,
		[]programmingcompiler.Input{{SourceID: programID}},
		[]programmingcompiler.Result{{Artifact: artifactBytes, ArtifactSHA256: digest}},
		[]packageProgramArtifact{{ProgramID: programID}},
		[]packageProgramTopology{{ObjectID: programID, ProgramID: programID, PeriodMs: 1000,
			BudgetUs: programBudgetUs(1000)}},
		[]programmingcompiler.PackageSignal{{Name: "SUPPLY_TEMP", Publisher: programID,
			Type: 3, FreshnessMs: 5000, StalePolicy: 0}})
	if err != nil {
		t.Fatal(err)
	}
	if packaged == nil || stored.SchemaVersion != 2 || packager.calls != 1 {
		t.Fatalf("signal một Program không được đóng gói v2: stored=%+v packaged=%+v", stored, packaged)
	}
	if got := programPackageName(programID); got != programID {
		t.Fatalf("runtime identity=%q, muốn Program ID nguyên gốc %q", got, programID)
	}
	if len(packager.signals) != 1 || packager.signals[0].Publisher != programID {
		t.Fatalf("publisher bị đổi identity: %+v", packager.signals)
	}
}

// packageRevisionFixture seal một Revision có `count` Program, đi qua đúng đường
// sản phẩm (SaveDraft + SealRevision) chứ không dựng object bằng tay.
func packageRevisionFixture(t *testing.T, projects *ProjectService, count int, unscheduledIndexes ...int) (string, []string) {
	t.Helper()
	unscheduled := make(map[int]bool, len(unscheduledIndexes))
	for _, index := range unscheduledIndexes {
		unscheduled[index] = true
	}
	created, err := projects.CreateProject(context.Background(), Actor{ID: testActorID, Role: "admin"},
		CreateProjectCommand{SchemaVersion: "1.0", Name: "Package check", IdempotencyKey: "31000000-0000-4000-8000-000000000001",
			CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	counter := 0
	projects.newID = func() string {
		counter++
		return fmt.Sprintf("cafecafe-cafe-4caf-8caf-%012d", counter)
	}

	operations := make([]json.RawMessage, 0, count)
	ids := make([]string, 0, count)
	for index := 0; index < count; index++ {
		id := fmt.Sprintf("8%07d-0000-4000-8000-%012d", index, index)
		ids = append(ids, id)
		operations = append(operations, op(map[string]any{"op": "upsertObject", "object": map[string]any{
			"objectId": id, "kind": "PROGRAM", "name": fmt.Sprintf("PRG_%02d", index), "language": "ST",
			"source": fmt.Sprintf("PROGRAM PRG_%02d\nEND_PROGRAM\n", index)}}))
		if !unscheduled[index] {
			operations = append(operations, op(map[string]any{"op": "upsertProgram", "program": map[string]any{
				"programId": id, "objectId": id, "periodMs": 1000}}))
		}
	}
	saved, err := projects.SaveDraft(context.Background(), Actor{ID: testActorID, Role: "admin"},
		SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID, Operations: operations,
			IfMatch: created.ETag, IdempotencyKey: "31000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := projects.SealRevision(context.Background(), Actor{ID: testActorID, Role: "admin"},
		SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID, Label: "R1",
			IfMatch: saved.ETag, IdempotencyKey: "31000000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return sealed.Resource["revisionId"].(string), ids
}

func runCheck(t *testing.T, checks *CheckService, revisionID, key string) CheckView {
	t.Helper()
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"},
		RequestCheckCommand{RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
			IdempotencyKey: key, CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := checks.ProcessNext(context.Background()); err != nil {
		t.Fatal(err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil {
		t.Fatal(err)
	}
	return view
}

// Check biên dịch MỌI Program của package, không phải Program đầu tiên.
func TestCheckCompilesEveryProgramInPackage(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, ids := packageRevisionFixture(t, projects, 4)
	runner := &perProgramRunner{failed: map[string]bool{}}
	checks := newCheckServiceForPackage(t, store, runner)

	view := runCheck(t, checks, revisionID, "32000000-0000-4000-8000-000000000001")
	if view.State != "PASSED" {
		t.Fatalf("state=%s diagnostics=%+v", view.State, view.Diagnostics)
	}
	if len(runner.calls) != len(ids) {
		t.Fatalf("số lần biên dịch=%d; want %d (%v)", len(runner.calls), len(ids), runner.calls)
	}
	// Thứ tự biên dịch ổn định theo objectId — điều kiện để hash package có nghĩa.
	for index := 1; index < len(runner.calls); index++ {
		if runner.calls[index-1] >= runner.calls[index] {
			t.Fatalf("thứ tự biên dịch không ổn định: %v", runner.calls)
		}
	}
	// Package nhiều Program phải cho ra MỘT artifact stage-able (container v2),
	// không phải artifact của Program đầu tiên: `schemaVersion` phải là 2.
	if view.Artifact == nil {
		t.Fatal("package 4 Program không có artifact stage-able")
	}
}

// Một Program hỏng KHÔNG che các Program hỏng khác, và mỗi diagnostic phải trỏ
// đúng Program của nó.
func TestCheckAggregatesDiagnosticsFromEveryFailingProgram(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, ids := packageRevisionFixture(t, projects, 3)
	runner := &perProgramRunner{failed: map[string]bool{ids[0]: true, ids[2]: true}}
	checks := newCheckServiceForPackage(t, store, runner)

	view := runCheck(t, checks, revisionID, "32000000-0000-4000-8000-000000000002")
	if view.State != "FAILED" {
		t.Fatalf("state=%s", view.State)
	}
	if len(view.Diagnostics) != 2 {
		t.Fatalf("số diagnostic=%d; want 2: %+v", len(view.Diagnostics), view.Diagnostics)
	}
	seen := map[string]struct{}{}
	for _, diagnostic := range view.Diagnostics {
		programID, _ := diagnostic.Location["programId"].(string)
		if programID == "" {
			t.Fatalf("diagnostic không nêu Program: %+v", diagnostic)
		}
		seen[programID] = struct{}{}
	}
	if _, ok := seen[ids[0]]; !ok {
		t.Fatalf("thiếu lỗi của Program đầu: %+v", seen)
	}
	if _, ok := seen[ids[2]]; !ok {
		t.Fatalf("thiếu lỗi của Program cuối: %+v", seen)
	}
	// Program hỏng không được dừng phần còn lại: cả ba đều phải được thử.
	if len(runner.calls) != 3 {
		t.Fatalf("Check dừng sớm: %v", runner.calls)
	}
}

// Deterministic build: cùng một Revision Check hai lần cho ĐÚNG cùng
// `packageSha256`. Không có phép đo này thì "tất định" chỉ là lời nói.
func TestCheckPackageHashIsDeterministicAcrossRuns(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, _ := packageRevisionFixture(t, projects, 3)
	runner := &perProgramRunner{failed: map[string]bool{}}
	checks := newCheckServiceForPackage(t, store, runner)

	hashes := make([]string, 0, 2)
	for index, key := range []string{"32000000-0000-4000-8000-000000000003", "32000000-0000-4000-8000-000000000004"} {
		view := runCheck(t, checks, revisionID, key)
		if view.State != "PASSED" {
			t.Fatalf("lần %d state=%s", index+1, view.State)
		}
		result, err := store.GetCheck(context.Background(), view.CheckID)
		if err != nil {
			t.Fatal(err)
		}
		var document struct {
			Manifest struct {
				ContentSHA256   string `json:"contentSha256"`
				ContainerSHA256 string `json:"containerSha256"`
				ProgramCount    int    `json:"programCount"`
			} `json:"manifest"`
		}
		if err := json.Unmarshal(result.ResultJSON, &document); err != nil {
			t.Fatal(err)
		}
		if document.Manifest.ProgramCount != 3 || document.Manifest.ContainerSHA256 == "" {
			t.Fatalf("manifest package sai: %+v", document.Manifest)
		}
		hashes = append(hashes, document.Manifest.ContentSHA256+"/"+document.Manifest.ContainerSHA256)
	}
	if hashes[0] == "" || hashes[0] != hashes[1] {
		t.Fatalf("hash package không tất định: %v", hashes)
	}
}

// Check KHÔNG được chạm Active/LKG dù đạt hay hỏng — nó là phép kiểm, không phải
// một bước triển khai.
func TestCheckNeverTouchesActiveState(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, ids := packageRevisionFixture(t, projects, 2)
	runner := &perProgramRunner{failed: map[string]bool{ids[1]: true}}
	checks := newCheckServiceForPackage(t, store, runner)

	snapshot, err := store.GetRevision(context.Background(), revisionID)
	if err != nil {
		t.Fatal(err)
	}
	before, err := store.GetProject(context.Background(), snapshot.Revision.ProjectID)
	if err != nil {
		t.Fatal(err)
	}

	failed := runCheck(t, checks, revisionID, "32000000-0000-4000-8000-000000000005")
	if failed.State != "FAILED" {
		t.Fatalf("state=%s", failed.State)
	}
	runner.failed = map[string]bool{}
	passed := runCheck(t, checks, revisionID, "32000000-0000-4000-8000-000000000006")
	if passed.State != "PASSED" {
		t.Fatalf("state=%s diagnostics=%+v", passed.State, passed.Diagnostics)
	}

	// Kiểm CẢ HAI chiều: chỉ kiểm chiều Check hỏng sẽ bỏ lọt đúng trường hợp
	// Check ĐẠT rồi tự ý kích hoạt.
	after, err := store.GetProject(context.Background(), snapshot.Revision.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Draft.ETag != before.Draft.ETag || after.Draft.ContentSHA256 != before.Draft.ContentSHA256 {
		t.Fatalf("Check đụng Draft: etag %d -> %d", before.Draft.ETag, after.Draft.ETag)
	}
	records, err := store.ListAuditRecords(context.Background(), 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		switch record.Action {
		case "COMMISSION", "RESTORE", "PACKAGE_ACTIVATE", "RETAIN_RESET":
			t.Fatalf("Check sinh hành động triển khai: %s", record.Action)
		}
	}
}

// F-P59-GHOST-POU-001: Draft/Revision được giữ PROGRAM POU chưa schedule, nhưng
// Check phải dừng trước compiler/packager bằng mã ổn định và không sinh bất kỳ
// hành động nào có thể đổi Active/LKG.
func TestCheckRejectsUnscheduledProgramBeforeCompilerAndPackager(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, ids := packageRevisionFixture(t, projects, 2, 1)
	revision, err := store.GetRevision(context.Background(), revisionID)
	if err != nil {
		t.Fatal(err)
	}
	before, err := store.GetProject(context.Background(), revision.Revision.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	runner := &perProgramRunner{failed: map[string]bool{}}
	checks := newCheckServiceForPackage(t, store, runner)
	packager := &fakePackager{}
	checks.packager = packager

	view := runCheck(t, checks, revisionID, "32000000-0000-4000-8000-000000000105")
	if view.State != "FAILED" || view.Artifact != nil || len(view.Diagnostics) != 1 {
		t.Fatalf("Check ghost POU=%+v", view)
	}
	diagnostic := view.Diagnostics[0]
	if diagnostic.Code != "PRG-ERR-CHECK-001" || diagnostic.DetailCode != "ST-POU-005" {
		t.Fatalf("diagnostic=%+v", diagnostic)
	}
	if got, _ := diagnostic.Location["programId"].(string); got != ids[1] {
		t.Fatalf("diagnostic trỏ %q; muốn %q", got, ids[1])
	}
	if len(runner.calls) != 0 || packager.calls != 0 {
		t.Fatalf("đã gọi compiler/packager: compiler=%v packager=%d", runner.calls, packager.calls)
	}
	after, err := store.GetProject(context.Background(), revision.Revision.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Draft.ETag != before.Draft.ETag || after.Draft.ContentSHA256 != before.Draft.ContentSHA256 {
		t.Fatalf("Check hỏng đã đổi Draft: etag %d -> %d", before.Draft.ETag, after.Draft.ETag)
	}
	records, err := store.ListAuditRecords(context.Background(), 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		switch record.Action {
		case "COMMISSION", "RESTORE", "PACKAGE_ACTIVATE", "RETAIN_RESET":
			t.Fatalf("Check ghost POU sinh hành động triển khai: %s", record.Action)
		}
	}
}

func TestPackageArtifactRejectsUnscheduledTopology(t *testing.T) {
	service := &CheckService{}
	objectID := "84444444-4444-4444-8444-444444444444"
	_, _, err := service.packageArtifact(context.Background(), programmingstore.Check{}, 2,
		[]programmingcompiler.Input{{SourceID: objectID}},
		[]programmingcompiler.Result{{Artifact: []byte("IR")}},
		[]packageProgramArtifact{{ProgramID: objectID}},
		[]packageProgramTopology{{ObjectID: objectID, ProgramID: objectID, PeriodMs: 0}}, nil)
	if err == nil || !strings.Contains(err.Error(), "ST-POU-005") {
		t.Fatalf("package không fail-closed bằng ST-POU-005: %v", err)
	}
}

// Hai worker cùng chạy phải chia nhau Check, không cùng xử lý một Check: lease
// là thứ giữ bất biến đó, và nó phải đúng cả khi hai worker đua nhau.
func TestConcurrentCheckWorkersClaimDisjointWork(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, _ := packageRevisionFixture(t, projects, 2)
	runner := &perProgramRunner{failed: map[string]bool{}}
	first := newCheckServiceForPackage(t, store, runner)
	second := newCheckServiceForPackage(t, store, runner)

	accepted, err := first.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"},
		RequestCheckCommand{RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
			IdempotencyKey: "32000000-0000-4000-8000-000000000007", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	claimed := make([]bool, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	for index, service := range []*CheckService{first, second} {
		go func(index int, service *CheckService) {
			defer wait.Done()
			processed, _ := service.ProcessNext(context.Background())
			claimed[index] = processed
		}(index, service)
	}
	wait.Wait()

	if claimed[0] && claimed[1] {
		t.Fatal("hai worker cùng nhận một Check")
	}
	if !claimed[0] && !claimed[1] {
		t.Fatal("không worker nào nhận Check")
	}
	view, err := first.GetCheck(context.Background(), accepted.CheckID)
	if err != nil {
		t.Fatal(err)
	}
	if view.State != "PASSED" {
		t.Fatalf("state=%s diagnostics=%+v", view.State, view.Diagnostics)
	}
	// Đúng hai Program, biên dịch đúng hai lần — không worker nào chạy lại.
	if len(runner.calls) != 2 {
		t.Fatalf("số lần biên dịch=%d; want 2 (%v)", len(runner.calls), runner.calls)
	}
}
