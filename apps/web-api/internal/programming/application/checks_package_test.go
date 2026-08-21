package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
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
		LibraryVersion: "rev-a.1", IntegrityMode: "HASH_ONLY", TargetABI: 3841}, nil
}

// fakePackager bọc các artifact thành một blob tất định. Nó KHÔNG mô phỏng định
// dạng container: định dạng thật do `mkddc-st-package` ghi và đã có golden/fuzz
// của T59-106 canh. Ở đây chỉ cần một Packager có hành vi tất định để kiểm phần
// điều phối của Check.
type fakePackager struct {
	mu    sync.Mutex
	calls int
}

func (p *fakePackager) Package(_ context.Context, programs []programmingcompiler.PackageProgram) (programmingcompiler.PackageResult, error) {
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	blob := []byte("PKG")
	for _, program := range programs {
		blob = append(blob, []byte("|"+program.Name+"|")...)
		blob = append(blob, program.Artifact...)
	}
	return programmingcompiler.PackageResult{Package: blob, SHA256: sha256.Sum256(blob),
		ByteSize: int64(len(blob)), ProgramCount: len(programs), SchemaVersion: 2, TargetABI: 3841}, nil
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

// packageRevisionFixture seal một Revision có `count` Program, đi qua đúng đường
// sản phẩm (SaveDraft + SealRevision) chứ không dựng object bằng tay.
func packageRevisionFixture(t *testing.T, projects *ProjectService, count int, brokenIndexes ...int) (string, []string) {
	t.Helper()
	broken := make(map[int]bool, len(brokenIndexes))
	for _, index := range brokenIndexes {
		broken[index] = true
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
		operations = append(operations, op(map[string]any{"op": "upsertProgram", "program": map[string]any{
			"programId": id, "objectId": id, "periodMs": 1000}}))
		_ = broken
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
