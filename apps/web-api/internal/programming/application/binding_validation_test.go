package application

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

func issueByDetail(result BindingValidationResult, detail string) *BindingValidationIssue {
	for index := range result.Issues {
		if result.Issues[index].DetailCode == detail {
			return &result.Issues[index]
		}
	}
	return nil
}

func TestBindingValidatorAcceptsCanonicalLocalVirtualAndModbusIdentity(t *testing.T) {
	inputID := "11111111-1111-4111-8111-111111111111"
	outputID := "22222222-2222-4222-8222-222222222222"
	variables := map[string]bindingVariable{
		inputID:  {ID: inputID, ProgramID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", DataType: "REAL", Class: "INPUT"},
		outputID: {ID: outputID, ProgramID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", DataType: "BOOL", Class: "OUTPUT"},
	}
	catalog := []PointCatalogEntry{
		{Category: "LOCAL", PointID: "UI-01", DataType: "REAL", Direction: "READ", Quality: "GOOD"},
		{Category: "VP", PointID: "BV-01", DataType: "BOOL", Direction: "READ_WRITE", Writable: true, Quality: "GOOD"},
		{Category: "MB_RTU", DeviceID: "bus-1-slave-2", PointID: "COIL_1", ExtIndex: 1, DataType: "BOOL", Direction: "READ_WRITE", Writable: true, Quality: "GOOD"},
	}
	for index := range catalog {
		catalog[index].Mapping = EvaluatePointMapEligibility(catalog[index])
	}
	tests := []BindingCandidate{
		{BindingID: "31111111-1111-4111-8111-111111111111", VariableID: inputID, Point: BindingPointIdentity{Category: "LOCAL", PointID: "UI-01"}, Direction: "READ", DataType: "REAL", QualityPolicy: "REQUIRE_GOOD"},
		{BindingID: "32222222-2222-4222-8222-222222222222", VariableID: outputID, Point: BindingPointIdentity{Category: "VP", PointID: "BV-01"}, Direction: "WRITE", DataType: "BOOL", Writable: true, QualityPolicy: "REQUIRE_GOOD"},
		{BindingID: "33333333-3333-4333-8333-333333333333", VariableID: outputID, Point: BindingPointIdentity{Category: "MB_RTU", DeviceID: "bus-1-slave-2", PointID: "COIL_1"}, Direction: "WRITE", DataType: "BOOL", Writable: true, QualityPolicy: "REQUIRE_GOOD"},
	}
	for _, candidate := range tests {
		result := ValidateBindingCandidate(candidate, variables, tests, catalog)
		if result.Verdict != "ALLOW" || len(result.Issues) != 0 {
			t.Fatalf("%s/%s: %+v", candidate.Point.Category, candidate.Point.PointID, result)
		}
	}
	readOnlyOutput := tests[0]
	readOnlyOutput.BindingID = "34444444-4444-4444-8444-444444444444"
	readOnlyOutput.VariableID = outputID
	readOnlyOutput.Direction = "WRITE"
	readOnlyOutput.DataType = "BOOL"
	blocked := ValidateBindingCandidate(readOnlyOutput, variables, tests, catalog)
	if blocked.Verdict != "BLOCK" || issueByDetail(blocked, "PGM-MAP-ELIGIBILITY-001") == nil {
		t.Fatalf("output vào point read-only chưa bị chặn: %+v", blocked)
	}
	wrongDevice := tests[2]
	wrongDevice.BindingID = "35555555-5555-4555-8555-555555555555"
	wrongDevice.Point.DeviceID = "bus-1-slave-9"
	missing := ValidateBindingCandidate(wrongDevice, variables, tests, catalog)
	if issueByDetail(missing, "PGM-MAP-POINT-001") == nil {
		t.Fatalf("MB_RTU sai deviceId thiếu mã identity ổn định: %+v", missing)
	}
	spoofedWritable := tests[1]
	spoofedWritable.BindingID = "36666666-6666-4666-8666-666666666666"
	spoofedWritable.Writable = false
	spoofed := ValidateBindingCandidate(spoofedWritable, variables, tests, catalog)
	writableIssue := issueByDetail(spoofed, "PGM-MAP-WRITABLE-002")
	if spoofed.Verdict != "BLOCK" || writableIssue == nil || writableIssue.Expected != "true" || writableIssue.Actual != "false" {
		t.Fatalf("metadata writable do client khai không bị đối chiếu catalog: %+v", spoofed)
	}
	nonCanonical := tests[0]
	nonCanonical.BindingID = "37777777-7777-4777-8777-777777777777"
	nonCanonical.Direction = "read"
	directionResult := ValidateBindingCandidate(nonCanonical, variables, tests, catalog)
	if issue := issueByDetail(directionResult, "PGM-MAP-DIRECTION-001"); issue == nil || issue.Expected != "READ" || issue.Actual != "read" {
		t.Fatalf("direction ngoài enum OpenAPI vẫn được chuẩn hoá ngầm: %+v", directionResult)
	}
}

func TestBindingValidatorReturnsStableWarningBlockAndCanonicalOwner(t *testing.T) {
	firstVariable := "41111111-1111-4111-8111-111111111111"
	secondVariable := "42222222-2222-4222-8222-222222222222"
	variables := map[string]bindingVariable{
		firstVariable:  {ID: firstVariable, ProgramID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", DataType: "REAL", Unit: "degC", Class: "OUTPUT"},
		secondVariable: {ID: secondVariable, ProgramID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", DataType: "REAL", Unit: "degC", Class: "OUTPUT"},
	}
	point := PointCatalogEntry{Category: "VP", PointID: "AV-01", DataType: "REAL", Unit: "K", Direction: "READ_WRITE", Writable: true, Quality: "UNCERTAIN"}
	point.Mapping = EvaluatePointMapEligibility(point)
	owner := BindingCandidate{BindingID: "43333333-3333-4333-8333-333333333333", VariableID: firstVariable,
		Point: BindingPointIdentity{Category: "VP", PointID: "AV-01"}, Direction: "WRITE", DataType: "REAL", Unit: "K", Writable: true, QualityPolicy: "ALLOW_UNCERTAIN"}
	candidate := BindingCandidate{BindingID: "44444444-4444-4444-8444-444444444444", VariableID: secondVariable,
		Point: BindingPointIdentity{Category: "VP", PointID: "AV-01"}, Direction: "WRITE", DataType: "REAL", Unit: "K", Writable: true, QualityPolicy: "ALLOW_UNCERTAIN"}
	result := ValidateBindingCandidate(candidate, variables, []BindingCandidate{owner, candidate}, []PointCatalogEntry{point})
	if result.Verdict != "BLOCK" || issueByDetail(result, "PGM-MAP-UNIT-001") == nil || issueByDetail(result, "PGM-MAP-QUALITY-001") == nil {
		t.Fatalf("thiếu warning đơn vị/quality: %+v", result)
	}
	conflict := issueByDetail(result, "PGM-MAP-OWNER-001")
	if conflict == nil || conflict.OwnerProgramID != variables[firstVariable].ProgramID || conflict.ConflictProgramID != variables[secondVariable].ProgramID {
		t.Fatalf("owner canonical sai: %+v", conflict)
	}
}

func TestPreviewAndDraftWriteUseSameValidatorAndRejectedWriteIsAtomic(t *testing.T) {
	service, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Preview binding",
		IdempotencyKey: "81000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "81111111-1111-4111-8111-111111111111"
	variableID := "82222222-2222-4222-8222-222222222222"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": "P", "kind": "PROGRAM", "language": "ST", "document": "PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n"}})
	variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{
		"variableId": variableID, "programId": programID, "name": "X", "type": "BOOL", "class": "OUTPUT", "retain": false}})
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, variable}, IfMatch: created.ETag,
		IdempotencyKey: "81000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	bad := BindingCandidate{BindingID: "83333333-3333-4333-8333-333333333333", VariableID: variableID,
		Point: BindingPointIdentity{Category: "LOCAL", PointID: "DO-01"}, Direction: "WRITE", DataType: "REAL", Writable: true, QualityPolicy: "REQUIRE_GOOD"}
	if _, staleErr := service.PreviewBinding(context.Background(), projectID, draftID, created.ETag, bad); !errors.Is(staleErr, programmingstore.ErrETagConflict) {
		t.Fatalf("preview ETag cũ phải trả conflict, err=%v", staleErr)
	}
	preview, err := service.PreviewBinding(context.Background(), projectID, draftID, saved.ETag, bad)
	if err != nil || preview.Verdict != "BLOCK" || issueByDetail(preview.BindingValidationResult, "PGM-MAP-TYPE-001") == nil {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	binding, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": bad})
	_, err = service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{binding}, IfMatch: saved.ETag,
		IdempotencyKey: "81000000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	var publicErr *OperationPublicError
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrMapType || publicErr.Public.Field != "binding.dataType" || publicErr.Public.Args["detailCode"] != "PGM-MAP-TYPE-001" {
		t.Fatalf("write gate không cùng kết quả preview: %v", err)
	}
	draft, err := store.GetDraft(context.Background(), draftID)
	if err != nil || FormatDraftETag(draftID, draft.ETag) != saved.ETag {
		t.Fatalf("ETag đổi sau reject: draft=%+v err=%v", draft, err)
	}
	baselineContent := string(draft.ContentJSON)
	var document map[string]any
	if json.Unmarshal(draft.ContentJSON, &document) != nil || len(collectionOf(document, "bindings")) != 0 {
		t.Fatalf("binding bị ghi một phần: %s", draft.ContentJSON)
	}

	readOnly := BindingCandidate{BindingID: "83444444-4444-4444-8444-444444444444", VariableID: variableID,
		Point: BindingPointIdentity{Category: "LOCAL", PointID: "DI-01"}, Direction: "WRITE", DataType: "BOOL",
		Writable: false, QualityPolicy: "REQUIRE_GOOD"}
	readOnlyPreview, err := service.PreviewBinding(context.Background(), projectID, draftID, saved.ETag, readOnly)
	if err != nil || readOnlyPreview.Verdict != "BLOCK" || issueByDetail(readOnlyPreview.BindingValidationResult, "PGM-MAP-ELIGIBILITY-001") == nil {
		t.Fatalf("output vào Point chỉ đọc chưa bị preview chặn: preview=%+v err=%v", readOnlyPreview, err)
	}
	readOnlyOperation, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": readOnly})
	_, err = service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{readOnlyOperation}, IfMatch: saved.ETag,
		IdempotencyKey: "81000000-0000-4000-8000-000000000004", CorrelationID: testCorrelationID})
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrMapIdentity ||
		publicErr.Public.Args["detailCode"] != "PGM-MAP-ELIGIBILITY-001" {
		t.Fatalf("cửa ghi chưa chặn output vào Point chỉ đọc: %v", err)
	}
	draft, err = store.GetDraft(context.Background(), draftID)
	if err != nil || FormatDraftETag(draftID, draft.ETag) != saved.ETag || string(draft.ContentJSON) != baselineContent {
		t.Fatalf("Draft đổi sau reject Point chỉ đọc: draft=%+v err=%v", draft, err)
	}

	// Contract v2 cũ vẫn đọc được, nhưng request ghi mới thiếu typed pair phải
	// bị chặn sau khi apply trong RAM và trước transaction store.
	legacyOperation, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": map[string]any{
		"bindingId": "83555555-5555-4555-8555-555555555555", "programId": programID,
		"variable": "X", "pointId": "DO-01", "direction": "WRITE"}})
	_, err = service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{legacyOperation}, IfMatch: saved.ETag,
		IdempotencyKey: "81000000-0000-4000-8000-000000000005", CorrelationID: testCorrelationID})
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrRequest ||
		publicErr.Public.Args["detailCode"] != "PGM-MAP-BINDING-002" {
		t.Fatalf("request legacy vẫn đi vòng cửa typed: %v", err)
	}
	draft, err = store.GetDraft(context.Background(), draftID)
	if err != nil || FormatDraftETag(draftID, draft.ETag) != saved.ETag || string(draft.ContentJSON) != baselineContent {
		t.Fatalf("Draft đổi sau request legacy: draft=%+v err=%v", draft, err)
	}
}

func TestBindingPreviewAndWriteFailClosedWithoutCatalog(t *testing.T) {
	service, store := openProjectService(t)
	service.SetPointCatalogProvider(nil)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "No catalog",
		IdempotencyKey: "82000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.PreviewBinding(context.Background(), created.Resource["projectId"].(string), created.Resource["draftRevisionId"].(string), created.ETag,
		BindingCandidate{BindingID: "84444444-4444-4444-8444-444444444444"})
	var publicErr *OperationPublicError
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrUnavailable || publicErr.Public.Field != "pointCatalog" {
		t.Fatalf("catalog thiếu phải fail closed: %v", err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "84555555-5555-4555-8555-555555555555"
	variableID := "84666666-6666-4666-8666-666666666666"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": "P", "kind": "PROGRAM", "language": "ST", "document": "PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n"}})
	variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{
		"variableId": variableID, "programId": programID, "name": "X", "type": "BOOL", "class": "OUTPUT", "retain": false}})
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, variable}, IfMatch: created.ETag,
		IdempotencyKey: "82000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	candidate := BindingCandidate{BindingID: "84777777-7777-4777-8777-777777777777", VariableID: variableID,
		Point: BindingPointIdentity{Category: "LOCAL", PointID: "DO-01"}, Direction: "WRITE", DataType: "BOOL", Writable: true, QualityPolicy: "REQUIRE_GOOD"}
	binding, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": candidate})
	_, err = service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{binding}, IfMatch: saved.ETag,
		IdempotencyKey: "82000000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrUnavailable {
		t.Fatalf("write thiếu catalog phải fail closed: %v", err)
	}
	draft, readErr := store.GetDraft(context.Background(), draftID)
	if readErr != nil || FormatDraftETag(draftID, draft.ETag) != saved.ETag {
		t.Fatalf("Draft đổi sau unavailable: draft=%+v err=%v", draft, readErr)
	}
}

func TestDraftWriteRejectsSecondCanonicalOutputOwnerBeforeMutation(t *testing.T) {
	service, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Output owner",
		IdempotencyKey: "82500000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programIDs := []string{"91111111-1111-4111-8111-111111111111", "92222222-2222-4222-8222-222222222222"}
	variableIDs := []string{"93333333-3333-4333-8333-333333333333", "94444444-4444-4444-8444-444444444444"}
	operations := make([]json.RawMessage, 0, 6)
	for index := range programIDs {
		program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
			"programId": programIDs[index], "name": "P" + string(rune('A'+index)), "kind": "PROGRAM", "language": "ST",
			"document": "PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n"}})
		variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{
			"variableId": variableIDs[index], "programId": programIDs[index], "name": "X", "type": "BOOL", "class": "OUTPUT", "retain": false}})
		operations = append(operations, program, variable)
	}
	first := BindingCandidate{BindingID: "95555555-5555-4555-8555-555555555555", VariableID: variableIDs[0],
		Point: BindingPointIdentity{Category: "LOCAL", PointID: "DO-01"}, Direction: "WRITE", DataType: "BOOL", Writable: true, QualityPolicy: "REQUIRE_GOOD"}
	firstOperation, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": first})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{
		"taskId": "96666666-6666-4666-8666-666666666666", "periodMs": 1000, "programOrder": programIDs}})
	operations = append(operations, firstOperation, task)
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: operations, IfMatch: created.ETag,
		IdempotencyKey: "82500000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	second := BindingCandidate{BindingID: "97777777-7777-4777-8777-777777777777", VariableID: variableIDs[1],
		Point: first.Point, Direction: "WRITE", DataType: "BOOL", Writable: true, QualityPolicy: "REQUIRE_GOOD"}
	secondOperation, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": second})
	_, err = service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{secondOperation}, IfMatch: saved.ETag,
		IdempotencyKey: "82500000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	var publicErr *OperationPublicError
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrOutputOwner ||
		publicErr.Public.Args["ownerProgramId"] != programIDs[0] || publicErr.Public.Args["conflictProgramId"] != programIDs[1] {
		t.Fatalf("owner hiện hữu không canonical: %v", err)
	}
	draft, readErr := store.GetDraft(context.Background(), draftID)
	if readErr != nil || FormatDraftETag(draftID, draft.ETag) != saved.ETag {
		t.Fatalf("Draft đổi sau owner conflict: draft=%+v err=%v", draft, readErr)
	}
}

func TestCheckUsesSameBindingValidatorAndFailsClosedWhenPointDisappears(t *testing.T) {
	service, store := openProjectService(t)
	provider := standardBindingCatalog()
	service.SetPointCatalogProvider(provider)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "Check catalog drift",
		IdempotencyKey: "83000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "85555555-5555-4555-8555-555555555555"
	variableID := "86666666-6666-4666-8666-666666666666"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": "P", "kind": "PROGRAM", "language": "ST", "document": "PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n"}})
	variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{
		"variableId": variableID, "programId": programID, "name": "X", "type": "BOOL", "class": "OUTPUT", "retain": false}})
	candidate := BindingCandidate{BindingID: "87777777-7777-4777-8777-777777777777", VariableID: variableID,
		Point: BindingPointIdentity{Category: "LOCAL", PointID: "DO-01"}, Direction: "WRITE", DataType: "BOOL", Writable: true, QualityPolicy: "REQUIRE_GOOD"}
	binding, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": candidate})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{
		"taskId": "88888888-8888-4888-8888-888888888888", "periodMs": 1000, "programOrder": []string{programID}}})
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, variable, binding, task}, IfMatch: created.ETag,
		IdempotencyKey: "83000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(context.Background(), actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Label: "Catalog drift", IfMatch: saved.ETag, IdempotencyKey: "83000000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	provider.entries = nil
	preview, err := service.PreviewBinding(context.Background(), projectID, sealed.Resource["revisionId"].(string), sealed.ETag, candidate)
	if err != nil || preview.Verdict != "BLOCK" || issueByDetail(preview.BindingValidationResult, "PGM-MAP-POINT-001") == nil {
		t.Fatalf("preview sau khi point biến mất=%+v err=%v", preview, err)
	}
	_, err = service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: sealed.Resource["revisionId"].(string), Operations: []json.RawMessage{binding}, IfMatch: sealed.ETag,
		IdempotencyKey: "83000000-0000-4000-8000-000000000005", CorrelationID: testCorrelationID})
	var publicErr *OperationPublicError
	if !errors.As(err, &publicErr) || publicErr.Public.Code != domain.ErrMapIdentity ||
		publicErr.Public.Args["detailCode"] != "PGM-MAP-POINT-001" {
		t.Fatalf("mutation không cùng verdict point-missing với preview: %v", err)
	}
	draftAfterReject, readErr := store.GetDraft(context.Background(), draftID)
	if readErr != nil || FormatDraftETag(draftID, draftAfterReject.ETag) != sealed.ETag {
		t.Fatalf("Draft đổi sau mutation point-missing: draft=%+v err=%v", draftAfterReject, readErr)
	}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	runner := &fakeCheckRunner{}
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{}, Artifacts: artifacts,
		TargetID: "controller-local", LeaseDuration: time.Minute, Catalog: provider})
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := checks.RequestCheck(context.Background(), actor, RequestCheckCommand{RevisionID: sealed.Resource["revisionId"].(string),
		SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "83000000-0000-4000-8000-000000000004", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if processed, processErr := checks.ProcessNext(context.Background()); processErr != nil || !processed {
		t.Fatalf("ProcessNext=%v err=%v", processed, processErr)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil || view.State != "FAILED" {
		t.Fatalf("Check=%+v err=%v", view, err)
	}
	found := false
	for _, diagnostic := range view.Diagnostics {
		found = found || diagnostic.DetailCode == "PGM-MAP-POINT-001" && diagnostic.Code == string(domain.ErrMapIdentity)
	}
	if !found || runner.input.SourceID != "" {
		t.Fatalf("Check không dùng cùng validator hoặc vẫn gọi compiler: diagnostics=%+v input=%+v", view.Diagnostics, runner.input)
	}
}
