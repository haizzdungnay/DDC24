package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
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
	return createCheckRevisionFixtureWithPeriod(t, service, 1000)
}

// createCheckRevisionFixtureWithPeriod dựng cùng Revision một Program nhưng với
// chu kỳ cho trước — cần cho kịch bản nâng cấp ADR-061 mục 4.14 (Revision cũ
// 30000 ms).
func createCheckRevisionFixtureWithPeriod(t *testing.T, service *ProjectService, periodMs int) string {
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
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{"taskId": taskID, "periodMs": periodMs, "programOrder": []string{programID}}})
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
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1, ProfileID: "revA-1t-1-5-30", LibraryVersion: domain.SystemLibraryVersion, IntegrityMode: "HASH_ONLY", TargetABI: 3841}}
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
	// ISS-STED-19: artifact phải TỰ MANG phiên bản hồ sơ ngôn ngữ ST. Một
	// artifact đọc lại sau này, tách khỏi phản hồi capabilities sinh ra nó, mà
	// không nói được nó biên dịch dưới hồ sơ nào thì không kiểm chứng được.
	if view.Artifact.StLanguageProfileVersion != domain.STLanguageProfileVersion {
		t.Fatalf("artifact.stLanguageProfileVersion = %q, muốn %q",
			view.Artifact.StLanguageProfileVersion, domain.STLanguageProfileVersion)
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
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1, ProfileID: "revA-1t-1-5-30", LibraryVersion: domain.SystemLibraryVersion, IntegrityMode: "HASH_ONLY", TargetABI: 3841}}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Catalog: standardBindingCatalog(),
		Now:     func() time.Time { return time.Date(2026, 8, 14, 10, 0, 0, 0, time.UTC) }})
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
	_, err = projects.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, variable, binding, task}, IfMatch: created.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000202", CorrelationID: testCorrelationID})
	var publicErr *OperationPublicError
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrMapIdentity {
		t.Fatalf("SaveDraft phải chặn class LOCAL bằng validator binding, err=%v", err)
	}
	draft, readErr := store.GetDraft(context.Background(), draftID)
	if readErr != nil || draft.ETag != 1 {
		t.Fatalf("Draft đổi dù binding bị chặn: draft=%+v err=%v", draft, readErr)
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

func TestCheckServiceWarningOnlyPassesWithDiagnosticsAndMessage(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID := createCheckRevisionFixture(t, projects)
	artifactBytes := []byte("verified-artifact-warn")
	digest := sha256.Sum256(artifactBytes)
	runner := &fakeCheckRunner{result: programmingcompiler.Result{
		OK: true,
		Diagnostics: []programmingcompiler.Diagnostic{
			{Code: "ST-WARN-002", Severity: "warning", Message: "variable 'unused' is declared but never used", Line: 10, Column: 2},
		},
		Artifact: artifactBytes, ArtifactSHA256: digest, Manifest: json.RawMessage(`{"manifestVersion":1}`),
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1, ProfileID: "revA-1t-1-5-30",
		LibraryVersion: domain.SystemLibraryVersion, IntegrityMode: "HASH_ONLY", TargetABI: 3841,
	}}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	checks, err := NewCheckService(CheckServiceOptions{
		Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return time.Date(2026, 8, 31, 10, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	command := RequestCheckCommand{
		RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000901", CorrelationID: testCorrelationID,
	}
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatal(err)
	}
	processed, err := checks.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil {
		t.Fatal(err)
	}
	if view.State != "PASSED" {
		t.Fatalf("state=%s want PASSED", view.State)
	}
	if len(view.Diagnostics) != 1 {
		t.Fatalf("diagnostics count=%d want 1: %+v", len(view.Diagnostics), view.Diagnostics)
	}
	diag := view.Diagnostics[0]
	if diag.Severity != "WARNING" {
		t.Errorf("severity=%s want WARNING", diag.Severity)
	}
	if diag.DetailCode != "ST-WARN-002" {
		t.Errorf("detailCode=%s want ST-WARN-002", diag.DetailCode)
	}
	if diag.Message == "" || diag.Message != "variable 'unused' is declared but never used" {
		t.Errorf("message=%q want 'variable 'unused' is declared but never used'", diag.Message)
	}
}

func TestCheckServiceErrorAndWarningFailsWithBothDiagnosticsPreserved(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID := createCheckRevisionFixture(t, projects)
	runner := &fakeCheckRunner{result: programmingcompiler.Result{
		OK: false,
		Diagnostics: []programmingcompiler.Diagnostic{
			{Code: "ST-SYN-001", Severity: "error", Message: "unexpected token", Line: 5, Column: 1},
			{Code: "ST-WARN-002", Severity: "warning", Message: "variable 'x' unused", Line: 2, Column: 1},
		},
	}}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	checks, err := NewCheckService(CheckServiceOptions{
		Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return time.Date(2026, 8, 31, 10, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	command := RequestCheckCommand{
		RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000902", CorrelationID: testCorrelationID,
	}
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatal(err)
	}
	processed, err := checks.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil {
		t.Fatal(err)
	}
	if view.State != "FAILED" {
		t.Fatalf("state=%s want FAILED", view.State)
	}
	if len(view.Diagnostics) != 2 {
		t.Fatalf("diagnostics count=%d want 2: %+v", len(view.Diagnostics), view.Diagnostics)
	}
	if view.Diagnostics[0].Severity != "ERROR" || view.Diagnostics[0].DetailCode != "ST-SYN-001" {
		t.Errorf("diagnostic 0=%+v", view.Diagnostics[0])
	}
	if view.Diagnostics[1].Severity != "WARNING" || view.Diagnostics[1].DetailCode != "ST-WARN-002" {
		t.Errorf("diagnostic 1=%+v", view.Diagnostics[1])
	}
}

func TestSanitizeCompilerMessageStripsHostPathsAndTokens(t *testing.T) {
	cases := []struct {
		name      string
		input     string
		forbidden []string
	}{
		{
			name:      "linux scratch path",
			input:     "error in /tmp/scratch-abc123/src.st: undeclared variable 'x'",
			forbidden: []string{"/tmp/scratch-abc123/src.st", "/tmp", "scratch-abc123"},
		},
		{
			name:      "windows host path",
			input:     `error at C:\Users\build\x.st: duplicate declaration`,
			forbidden: []string{`C:\Users\build\x.st`, `C:\Users`, `build`},
		},
		{
			name:      "unc path",
			input:     `error at \\server\share\file.st: syntax error`,
			forbidden: []string{`\\server\share\file.st`},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sanitized := sanitizeCompilerMessage(tc.input)
			for _, forbidden := range tc.forbidden {
				if strings.Contains(sanitized, forbidden) {
					t.Errorf("sanitizeCompilerMessage(%q) = %q; still contains forbidden string %q", tc.input, sanitized, forbidden)
				}
			}
		})
	}
}

// Message vượt trần bị cắt trên BIÊN RUNE. Độ dài message do đầu vào của người
// dùng chi phối (tên biến nằm trong message), nên nhánh này chạy thật chứ không
// phải nhánh lý thuyết. Cắt giữa một rune nhiều byte sẽ sinh U+FFFD trên UI —
// đúng thứ #352 yêu cầu tránh khi nói "giữ thông điệp".
func TestSanitizeCompilerMessageTruncatesOnRuneBoundary(t *testing.T) {
	// Mỗi 'π' là 2 byte: chuỗi 400 ký tự = 800 byte, vượt trần 512.
	msg := strings.Repeat("π", 400)
	sanitized := sanitizeCompilerMessage(msg)

	if len(sanitized) > 512 {
		t.Errorf("len=%d byte, vượt trần 512", len(sanitized))
	}
	if !utf8.ValidString(sanitized) {
		t.Errorf("chuỗi cắt ra không phải UTF-8 hợp lệ: %q", sanitized)
	}
	if strings.ContainsRune(sanitized, utf8.RuneError) {
		t.Errorf("cắt giữa rune sinh U+FFFD: %q", sanitized)
	}
	if sanitized == "" {
		t.Error("cắt hết sạch message — phải giữ lại phần lọt trần")
	}
}

func TestNormalizeSeverityDefaultsUnknownAndEmptyToError(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"warning", "WARNING"},
		{"WARNING", "WARNING"},
		{"Warning", "WARNING"},
		{"info", "INFO"},
		{"INFO", "INFO"},
		{"fatal", "ERROR"},
		{"", "ERROR"},
		{"unknown_severity", "ERROR"},
		{"   ", "ERROR"},
	}
	for _, tt := range tests {
		got := normalizeSeverity(tt.input)
		if got != tt.want {
			t.Errorf("normalizeSeverity(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

/* T63-304 (F-PRG-PERF-004) — Check biên dịch song song tối đa 2 Program nhưng
 * gộp kết quả theo ĐÚNG thứ tự Program. `parallelBatchRunner` dùng chính
 * `programmingcompiler.CompileConcurrently` (đường của ProcessRunner) và cho
 * Program đứng trước chạy LÂU hơn, để thứ tự hoàn thành ngược thứ tự Program. */
type parallelBatchRunner struct {
	mu      sync.Mutex
	active  int
	peak    int
	failed  map[string]bool
	errs    map[string]error
	delays  map[string]time.Duration
	symbols bool
}

func (r *parallelBatchRunner) Compile(_ context.Context, input programmingcompiler.Input) (programmingcompiler.Result, error) {
	r.mu.Lock()
	r.active++
	if r.active > r.peak {
		r.peak = r.active
	}
	delay, failed, err := r.delays[input.SourceID], r.failed[input.SourceID], r.errs[input.SourceID]
	r.mu.Unlock()
	defer func() { r.mu.Lock(); r.active--; r.mu.Unlock() }()
	time.Sleep(delay)
	if err != nil {
		return programmingcompiler.Result{}, err
	}
	if failed {
		return programmingcompiler.Result{OK: false, Diagnostics: []programmingcompiler.Diagnostic{
			{Code: "ST-SYN-001", Severity: "ERROR", Message: "lỗi của " + input.SourceID}}}, nil
	}
	artifact := []byte("artifact:" + input.SourceID)
	return programmingcompiler.Result{OK: true, Artifact: artifact, ArtifactSHA256: sha256.Sum256(artifact),
		Manifest: json.RawMessage(`{"manifestVersion":1}`), CompilerVersion: checkCompilerVersion,
		ArtifactSchemaVersion: 1, CompilerProfile: 1, ProfileID: "revA-1t-1-5-30",
		LibraryVersion: domain.SystemLibraryVersion, IntegrityMode: "HASH_ONLY", TargetABI: 3841}, nil
}

func (r *parallelBatchRunner) CompileBatch(ctx context.Context, inputs []programmingcompiler.Input) []programmingcompiler.CompileOutcome {
	return programmingcompiler.CompileConcurrently(ctx, inputs, programmingcompiler.MaxConcurrentCompiles, r.Compile)
}

// reverseDelays: Program đầu chạy lâu nhất ⇒ hoàn thành sau cùng.
func reverseDelays(ids []string) map[string]time.Duration {
	delays := make(map[string]time.Duration, len(ids))
	for index, id := range ids {
		delays[id] = time.Duration(len(ids)-index) * 30 * time.Millisecond
	}
	return delays
}

func TestCheckCompilesInParallelButReportsDiagnosticsInProgramOrder(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, ids := packageRevisionFixture(t, projects, 4)
	failed := map[string]bool{}
	for _, id := range ids {
		failed[id] = true
	}
	runner := &parallelBatchRunner{failed: failed, delays: reverseDelays(ids)}
	view := runCheck(t, newCheckServiceForPackage(t, store, runner), revisionID, "33000000-0000-4000-8000-000000000001")
	if view.State != "FAILED" || len(view.Diagnostics) != len(ids) {
		t.Fatalf("state=%s diagnostics=%+v", view.State, view.Diagnostics)
	}
	for index, diagnostic := range view.Diagnostics {
		// `programId` và NỘI DUNG phải cùng thuộc Program thứ `index`: ghép kết
		// quả theo thứ tự hoàn thành sẽ gắn lỗi của Program này vào tên Program kia.
		programID, _ := diagnostic.Location["programId"].(string)
		if programID != ids[index] || diagnostic.Message != "lỗi của "+ids[index] {
			t.Fatalf("diagnostic %d = %s/%q; muốn %s/%q — thứ tự theo process xong trước, không theo Program",
				index, programID, diagnostic.Message, ids[index], "lỗi của "+ids[index])
		}
	}
	if runner.peak != 2 {
		t.Fatalf("biên dịch song song tối đa %d; muốn 2 (Plan 63 §4.3)", runner.peak)
	}
}

// Cùng Revision: đường song song cho ĐÚNG cùng package (content + container hash)
// với đường tuần tự.
func TestCheckParallelCompileBuildsTheSamePackageAsSequential(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, ids := packageRevisionFixture(t, projects, 4)
	hashOf := func(view CheckView) string {
		if view.State != "PASSED" {
			t.Fatalf("state=%s diagnostics=%+v", view.State, view.Diagnostics)
		}
		stored, err := store.GetCheck(context.Background(), view.CheckID)
		if err != nil {
			t.Fatal(err)
		}
		var document struct {
			Manifest struct {
				ContentSHA256   string `json:"contentSha256"`
				ContainerSHA256 string `json:"containerSha256"`
			} `json:"manifest"`
		}
		if err := json.Unmarshal(stored.ResultJSON, &document); err != nil {
			t.Fatal(err)
		}
		return document.Manifest.ContentSHA256 + "/" + document.Manifest.ContainerSHA256
	}
	sequential := hashOf(runCheck(t, newCheckServiceForPackage(t, store, &perProgramRunner{failed: map[string]bool{}}),
		revisionID, "33000000-0000-4000-8000-000000000002"))
	parallelRunner := &parallelBatchRunner{delays: reverseDelays(ids)}
	parallel := hashOf(runCheck(t, newCheckServiceForPackage(t, store, parallelRunner),
		revisionID, "33000000-0000-4000-8000-000000000003"))
	if sequential == "/" || sequential != parallel {
		t.Fatalf("package song song %q khác tuần tự %q", parallel, sequential)
	}
	if parallelRunner.peak != 2 {
		t.Fatalf("không chạy song song: peak=%d", parallelRunner.peak)
	}
}

// Lỗi worker quyết định kết quả theo THỨ TỰ Program, như vòng tuần tự: Program 2
// timeout (xong muộn) đứng trước Program 3 lệch toolchain (xong sớm) ⇒ TIMED_OUT.
func TestCheckParallelFirstWorkerErrorFollowsProgramOrder(t *testing.T) {
	projects, store := openProjectService(t)
	revisionID, ids := packageRevisionFixture(t, projects, 3)
	runner := &parallelBatchRunner{
		errs: map[string]error{
			ids[1]: fmt.Errorf("%w: deadline", programmingcompiler.ErrTimeout),
			ids[2]: fmt.Errorf("%w: lệch profile", programmingcompiler.ErrToolchainMismatch),
		},
		delays: map[string]time.Duration{ids[0]: 10 * time.Millisecond, ids[1]: 120 * time.Millisecond},
	}
	view := runCheck(t, newCheckServiceForPackage(t, store, runner), revisionID, "33000000-0000-4000-8000-000000000004")
	if view.State != "TIMED_OUT" || len(view.Diagnostics) != 1 || view.Diagnostics[0].DetailCode != "ST-WORKER-TIMEOUT" {
		t.Fatalf("state=%s diagnostics=%+v — lỗi của Program xong trước đã thắng lỗi của Program đứng trước", view.State, view.Diagnostics)
	}
}
