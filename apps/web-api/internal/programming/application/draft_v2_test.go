package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"mkddc-web/internal/programming/domain"
)

func op(value map[string]any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}

func objectUUID(index int) string {
	return fmt.Sprintf("7%07d-0000-4000-8000-%012d", index, index)
}

// saveOps áp một loạt operation lên Draft và trả ETag mới. Mỗi lần gọi dùng một
// khoá idempotency riêng — dùng lại khoá là replay, không phải mutation thứ hai.
func saveOps(t *testing.T, service *ProjectService, projectID, baseRevisionID, etag, key string,
	operations ...json.RawMessage) (MutationResult, error) {
	t.Helper()
	return service.SaveDraft(context.Background(), Actor{ID: testActorID, Role: "admin"}, SaveDraftCommand{
		ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: baseRevisionID,
		Operations: operations, IfMatch: etag, IdempotencyKey: key, CorrelationID: testCorrelationID,
	})
}

func draftDocument(t *testing.T, service *ProjectService, projectID string) map[string]any {
	t.Helper()
	view, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(view.DraftContentJSON, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

func newV2Project(t *testing.T) (*ProjectService, string, string, string) {
	t.Helper()
	service, _ := openProjectService(t)
	created, err := service.CreateProject(context.Background(), Actor{ID: testActorID, Role: "admin"},
		CreateProjectCommand{SchemaVersion: "1.0", Name: "AHU v2", Description: "fixture",
			IdempotencyKey: "70000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	// `openProjectService` phát ID từ một danh sách cố định, đủ cho vài mutation.
	// Test trần 32 Program gọi SaveDraft 32 lần nên phải thay bằng bộ sinh không
	// cạn — vẫn tất định để audit ID không phụ thuộc đồng hồ hay ngẫu nhiên.
	counter := 0
	service.newID = func() string {
		counter++
		return fmt.Sprintf("dddddddd-dddd-4ddd-8ddd-%012d", counter)
	}
	return service, created.Resource["projectId"].(string), created.Resource["draftRevisionId"].(string), created.ETag
}

func pouOp(objectID, name, kind string) json.RawMessage {
	return op(map[string]any{"op": "upsertObject", "object": map[string]any{
		"objectId": objectID, "kind": kind, "name": name, "language": "ST",
		"source": "PROGRAM " + name + "\nEND_PROGRAM\n"}})
}

func programOp(programID, objectID string, period int) json.RawMessage {
	return op(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "objectId": objectID, "periodMs": period}})
}

// Trần 32 Program là quyết định Product (DDD §0). Program thứ 33 phải bị từ chối
// và Draft phải giữ nguyên đúng 32 — không nhận nửa vời.
func TestDraftRejectsThirtyThirdProgramAndKeepsThirtyTwo(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	for index := 1; index <= domain.MaxProgramsTotal; index++ {
		id := objectUUID(index)
		result, err := saveOps(t, service, projectID, draftID, etag,
			fmt.Sprintf("70000000-0000-4000-8000-1%011d", index),
			pouOp(id, fmt.Sprintf("PRG_%02d", index), "PROGRAM"), programOp(id, id, 1000))
		if err != nil {
			t.Fatalf("Program thứ %d: %v", index, err)
		}
		etag = result.ETag
	}
	document := draftDocument(t, service, projectID)
	if got := len(collectionOf(document, "programs")); got != domain.MaxProgramsTotal {
		t.Fatalf("số Program=%d; want %d", got, domain.MaxProgramsTotal)
	}

	overID := objectUUID(domain.MaxProgramsTotal + 1)
	_, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-200000000001",
		pouOp(overID, "PRG_33", "PROGRAM"), programOp(overID, overID, 1000))
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("Program thứ 33: %v", err)
	}
	after := draftDocument(t, service, projectID)
	if got := len(collectionOf(after, "programs")); got != domain.MaxProgramsTotal {
		t.Fatalf("Draft nhận nửa vời: %d Program", got)
	}
	if len(collectionOf(after, "objects")) != domain.MaxProgramsTotal {
		t.Fatal("POU của Program bị từ chối vẫn được ghi")
	}
}

// Tên POU unique CASE-FOLDED trong Project (DDD §4.2). Không fold thì `Ahu` và
// `AHU` là hai POU ở FE nhưng là một ở compiler.
func TestDraftRejectsCaseFoldedDuplicatePouName(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	first, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-300000000001",
		pouOp(objectUUID(1), "Ahu", "PROGRAM"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := saveOps(t, service, projectID, draftID, first.ETag, "70000000-0000-4000-8000-300000000002",
		pouOp(objectUUID(2), "AHU", "PROGRAM")); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("tên trùng case-folded: %v", err)
	}
	// Tên hợp lệ vẫn phải qua — guard chặn tất cả cũng là guard sai.
	if _, err := saveOps(t, service, projectID, draftID, first.ETag, "70000000-0000-4000-8000-300000000003",
		pouOp(objectUUID(3), "AHU_2", "PROGRAM")); err != nil {
		t.Fatalf("tên hợp lệ bị chặn: %v", err)
	}
}

func TestDraftRenameAndDuplicateKeepIdentitySemantics(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	source := objectUUID(1)
	created, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-400000000001",
		pouOp(source, "AHU", "PROGRAM"), programOp(source, source, 1000))
	if err != nil {
		t.Fatal(err)
	}

	renamed, err := saveOps(t, service, projectID, draftID, created.ETag, "70000000-0000-4000-8000-400000000002",
		op(map[string]any{"op": "renameObject", "objectId": source, "name": "AHU_MAIN"}))
	if err != nil {
		t.Fatal(err)
	}
	document := draftDocument(t, service, projectID)
	object := findByID(document, "objects", "objectId", source)
	if object == nil || object["name"] != "AHU_MAIN" {
		t.Fatalf("rename không đổi tên: %+v", object)
	}
	// Rename KHÔNG được đụng identity: mọi Revision và binding đang trỏ theo
	// objectId sẽ mất đích nếu identity đổi theo tên.
	if program := findByID(document, "programs", "programId", source); program == nil || program["objectId"] != source {
		t.Fatalf("rename làm đứt liên kết Program: %+v", program)
	}

	clone := objectUUID(2)
	if _, err := saveOps(t, service, projectID, draftID, renamed.ETag, "70000000-0000-4000-8000-400000000003",
		op(map[string]any{"op": "duplicateObject", "objectId": source, "newObjectId": clone, "name": "AHU_COPY"})); err != nil {
		t.Fatal(err)
	}
	afterClone := draftDocument(t, service, projectID)
	copied := findByID(afterClone, "objects", "objectId", clone)
	original := findByID(afterClone, "objects", "objectId", source)
	if copied == nil || copied["name"] != "AHU_COPY" || copied["source"] != original["source"] {
		t.Fatalf("duplicate không sao chép nội dung: %+v", copied)
	}
	// Bản sao KHÔNG tự trở thành Program: nhân đôi mã nguồn không phải nhân đôi
	// một đơn vị lập lịch, và làm vậy sẽ âm thầm tiêu một suất trong trần 32.
	if findByID(afterClone, "programs", "programId", clone) != nil {
		t.Fatal("duplicate tự tạo Program mới")
	}
}

// Không cascade ngầm: xoá thứ đang bị tham chiếu phải BÁO, không phải xoá kèm.
func TestDraftRefusesSilentCascadeOnRemove(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	objectID := objectUUID(1)
	created, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-500000000001",
		pouOp(objectID, "AHU", "PROGRAM"), programOp(objectID, objectID, 1000))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := saveOps(t, service, projectID, draftID, created.ETag, "70000000-0000-4000-8000-500000000002",
		op(map[string]any{"op": "removeObject", "objectId": objectID})); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("xoá POU đang có Program: %v", err)
	}

	signalID := objectUUID(9)
	withSignal, err := saveOps(t, service, projectID, draftID, created.ETag, "70000000-0000-4000-8000-500000000003",
		op(map[string]any{"op": "upsertSignal", "signal": map[string]any{
			"signalId": signalID, "name": "SUPPLY_TEMP", "type": "REAL",
			"publisherProgramId": objectID, "freshnessMs": 5000, "stalePolicy": "HOLD_LAST"}}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := saveOps(t, service, projectID, draftID, withSignal.ETag, "70000000-0000-4000-8000-500000000004",
		op(map[string]any{"op": "removeProgram", "programId": objectID})); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("xoá Program đang publish signal: %v", err)
	}
}

// `USE_FALLBACK` bắt buộc có giá trị dự phòng; ba chính sách còn lại KHÔNG được
// mang — đây đúng lối "im lặng thay bằng 0" mà DDD §10 cấm.
func TestDraftSignalPolicyAndFallbackAreCoupled(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	objectID := objectUUID(1)
	base, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-600000000001",
		pouOp(objectID, "AHU", "PROGRAM"), programOp(objectID, objectID, 1000))
	if err != nil {
		t.Fatal(err)
	}
	signal := func(policy string, fallback any, freshness int) json.RawMessage {
		payload := map[string]any{"signalId": objectUUID(9), "name": "SUPPLY_TEMP", "type": "REAL",
			"publisherProgramId": objectID, "freshnessMs": freshness, "stalePolicy": policy}
		if fallback != nil {
			payload["fallbackValue"] = fallback
		}
		return op(map[string]any{"op": "upsertSignal", "signal": payload})
	}
	for name, operation := range map[string]json.RawMessage{
		"USE_FALLBACK thiếu giá trị": signal("USE_FALLBACK", nil, 5000),
		"HOLD_LAST thừa giá trị":     signal("HOLD_LAST", 21.5, 5000),
		"freshness dưới trần dưới":   signal("HOLD_LAST", nil, 999),
		"freshness trên trần trên":   signal("HOLD_LAST", nil, 90001),
		"chính sách tự chế":          signal("JUST_GUESS", nil, 5000),
	} {
		if _, err := saveOps(t, service, projectID, draftID, base.ETag, "70000000-0000-4000-8000-6000000000"+fmt.Sprintf("%02d", len(name)),
			operation); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if _, err := saveOps(t, service, projectID, draftID, base.ETag, "70000000-0000-4000-8000-600000000099",
		signal("USE_FALLBACK", 21.5, 5000)); err != nil {
		t.Fatalf("signal hợp lệ bị chặn: %v", err)
	}
}

// Migration v1→v2 phải TẤT ĐỊNH: chạy hai lần trên cùng document cho cùng kết
// quả, và không sinh identity mới (identity mới làm mọi Revision cũ trỏ hư không).
func TestMigrateDraftToV2IsDeterministicAndKeepsIdentity(t *testing.T) {
	legacy := []byte(`{
		"schemaVersion":1,
		"project":{"projectId":"11111111-1111-4111-8111-111111111111","name":"AHU","functionalTags":[]},
		"programs":[
			{"programId":"70000002-0000-4000-8000-000000000002","name":"BOILER","kind":"PROGRAM","language":"ST","document":"PROGRAM BOILER\nEND_PROGRAM\n"},
			{"programId":"70000001-0000-4000-8000-000000000001","name":"AHU","kind":"PROGRAM","language":"ST","document":"PROGRAM AHU\nEND_PROGRAM\n"}
		],
		"variables":[
			{"variableId":"70000003-0000-4000-8000-000000000003","programId":"70000001-0000-4000-8000-000000000001","name":"Fan","type":"BOOL","retain":true}
		],
		"bindings":[
			{"bindingId":"70000004-0000-4000-8000-000000000004","variableId":"70000003-0000-4000-8000-000000000003","pointId":"BO-1","direction":"WRITE"}
		],
		"task":{"taskId":"70000005-0000-4000-8000-000000000005","periodMs":5000,"programOrder":["70000001-0000-4000-8000-000000000001","70000002-0000-4000-8000-000000000002"]},
		"library":{"profile":"CORE_REVA","version":"1"}
	}`)

	migrate := func() map[string]any {
		var document map[string]any
		if err := json.Unmarshal(legacy, &document); err != nil {
			t.Fatal(err)
		}
		if err := migrateDraftToV2(document); err != nil {
			t.Fatal(err)
		}
		return document
	}
	first, second := migrate(), migrate()
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	if string(firstJSON) != string(secondJSON) {
		t.Fatal("migration không tất định")
	}
	if err := validateDraftDocumentV2(first); err != nil {
		t.Fatalf("kết quả migration không hợp lệ: %v", err)
	}

	// Idempotent: chạy lại trên chính kết quả v2 là no-op.
	again := first
	if err := migrateDraftToV2(again); err != nil {
		t.Fatal(err)
	}
	againJSON, _ := json.Marshal(again)
	if string(againJSON) != string(firstJSON) {
		t.Fatal("migrate lại document v2 làm đổi nội dung")
	}

	if len(collectionOf(first, "objects")) != 2 || len(collectionOf(first, "programs")) != 2 {
		t.Fatalf("migration mất Program: %+v", first["programs"])
	}
	// Identity giữ nguyên — đây là lý do migration không được sinh UUID mới.
	if findByID(first, "objects", "objectId", "70000001-0000-4000-8000-000000000001") == nil {
		t.Fatal("migration đổi identity POU")
	}
	// Chu kỳ của Task v1 trở thành chu kỳ của từng Program.
	for _, program := range collectionOf(first, "programs") {
		if program["periodMs"] != float64(5000) {
			t.Fatalf("chu kỳ không chuyển: %+v", program)
		}
	}
	// Biến v1 vào `locals` của đúng POU sở hữu, không mất.
	owner := findByID(first, "objects", "objectId", "70000001-0000-4000-8000-000000000001")
	locals, _ := owner["locals"].([]any)
	if len(locals) != 1 {
		t.Fatalf("biến v1 bị mất: %+v", owner)
	}
	// Binding v1 được nối lại với Program và tên biến.
	binding := findByID(first, "bindings", "bindingId", "70000004-0000-4000-8000-000000000004")
	if binding == nil || binding["programId"] != "70000001-0000-4000-8000-000000000001" || binding["variable"] != "Fan" {
		t.Fatalf("binding không được nối lại: %+v", binding)
	}
	// v2 bỏ hẳn Task và `variables`.
	if _, present := first["task"]; present {
		t.Fatal("v2 vẫn còn Task")
	}
	if _, present := first["variables"]; present {
		t.Fatal("v2 vẫn còn collection variables")
	}
}

// Idempotency và ETag vẫn phải đúng trên model mới, kể cả sau khi đóng/mở store.
func TestDraftV2IdempotencyAndETagSurviveRestart(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	objectID := objectUUID(1)
	operations := []json.RawMessage{pouOp(objectID, "AHU", "PROGRAM"), programOp(objectID, objectID, 1000)}

	first, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-700000000001", operations...)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-700000000001", operations...)
	if err != nil || !replay.Replay || replay.ETag != first.ETag || replay.AuditID != first.AuditID {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
	// ETag cũ + khoá mới = xung đột, không phải ghi đè im lặng.
	if _, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-700000000002",
		pouOp(objectUUID(2), "BOILER", "PROGRAM")); err == nil {
		t.Fatal("ETag cũ vẫn ghi được")
	}

	document := draftDocument(t, service, projectID)
	if len(collectionOf(document, "objects")) != 1 || len(collectionOf(document, "programs")) != 1 {
		t.Fatalf("Draft sau replay: %+v", document)
	}
}

// T59-702 — `setTask` phải chọn đúng Program trong `programOrder`.
//
// Trước bản vá, mọi Program nhận cùng một `periodMs`, nên một package nhiều chu
// kỳ là không dựng được bằng API — dù profile cho `maxTasks: 3` và packager đã
// nhận `--period` theo từng Program. Test này khoá đúng mối nối đó.
func TestSetTaskChonDungProgramTheoProgramOrder(t *testing.T) {
	document := map[string]any{
		"programs": []any{
			map[string]any{"programId": "p1", "objectId": "p1", "periodMs": float64(1000)},
			map[string]any{"programId": "p2", "objectId": "p2", "periodMs": float64(1000)},
			map[string]any{"programId": "p3", "objectId": "p3", "periodMs": float64(1000)},
		},
	}
	raw := []byte(`{"op":"setTask","task":{"taskId":"slow","periodMs":30000,"programOrder":["p2","p3"]}}`)
	if err := setTaskCompat(document, raw); err != nil {
		t.Fatalf("setTask lỗi: %v", err)
	}
	want := map[string]float64{"p1": 1000, "p2": 30000, "p3": 30000}
	for _, item := range collectionOf(document, "programs") {
		id, _ := item["programId"].(string)
		got, _ := item["periodMs"].(float64)
		if got != want[id] {
			t.Fatalf("%s periodMs=%v, mong đợi %v", id, got, want[id])
		}
		if id == "p1" {
			if _, has := item["taskId"]; has {
				t.Fatalf("p1 không nằm trong programOrder nhưng bị gán taskId")
			}
			continue
		}
		if item["taskId"] != "slow" {
			t.Fatalf("%s thiếu taskId: %v", id, item["taskId"])
		}
	}
}

// Danh sách rỗng giữ nghĩa cũ — Project một chu kỳ không phải sửa gì.
func TestSetTaskProgramOrderRongApDungChoTatCa(t *testing.T) {
	document := map[string]any{
		"programs": []any{
			map[string]any{"programId": "p1", "objectId": "p1", "periodMs": float64(1000)},
			map[string]any{"programId": "p2", "objectId": "p2", "periodMs": float64(30000)},
		},
	}
	raw := []byte(`{"op":"setTask","task":{"taskId":"main","periodMs":5000,"programOrder":[]}}`)
	if err := setTaskCompat(document, raw); err != nil {
		t.Fatalf("setTask lỗi: %v", err)
	}
	for _, item := range collectionOf(document, "programs") {
		if got, _ := item["periodMs"].(float64); got != 5000 {
			t.Fatalf("periodMs=%v, mong đợi 5000", got)
		}
	}
}

// `programOrder` trỏ tới Program không tồn tại là lỗi người gọi: im lặng bỏ qua
// sẽ để lại một Task rỗng mà người dùng tưởng đã cấu hình xong.
func TestSetTaskTuChoiProgramKhongTonTai(t *testing.T) {
	document := map[string]any{
		"programs": []any{map[string]any{"programId": "p1", "objectId": "p1", "periodMs": float64(1000)}},
	}
	raw := []byte(`{"op":"setTask","task":{"taskId":"slow","periodMs":30000,"programOrder":["p1","khong-co"]}}`)
	if err := setTaskCompat(document, raw); err == nil {
		t.Fatal("phải từ chối programOrder có Program không tồn tại")
	}
}

// F-P59-DELETE-PROGRAM-001 — xoá Program trong Project CÓ user POU.
//
// Batch mà FE gửi khi xoá một Program là: removeBinding* -> removeVariable* ->
// removeProgram -> setTask(programOrder = phần còn lại). Adapter FE dựng
// `programOrder` từ TOÀN BỘ `objects` (gồm cả FUNCTION/FUNCTION_BLOCK), trong
// khi `programs` của document chỉ chứa cấu hình chạy của POU kind PROGRAM. Hệ
// quả: `setTaskCompat` thấy một id không có trong `programs` và từ chối CẢ
// batch với `PRG-ERR-REQ-001` — người dùng bấm Xoá và không có gì xảy ra, cũng
// không có lý do nào đọc được.
//
// Test này đi qua đúng `SaveDraft` production, không gọi thẳng hàm nội bộ.
func TestXoaProgramTrongProjectCoUserPouKhongDuocTuChoiCaBatch(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	programObject, functionObject := objectUUID(1), objectUUID(2)
	programID := objectUUID(3)

	saved, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-000000000101",
		pouOp(programObject, "AHU_MAIN", "PROGRAM"),
		programOp(programID, programObject, 1000),
		pouOp(functionObject, "SCALE_LIN", "FUNCTION"))
	if err != nil {
		t.Fatalf("dựng fixture: %v", err)
	}

	// Chỉ Program mới nằm trong `programs`; FUNCTION thì không. Đây là bất biến
	// mà `programOrder` phải tôn trọng.
	document := draftDocument(t, service, projectID)
	if got := len(collectionOf(document, "programs")); got != 1 {
		t.Fatalf("fixture sai: có %d cấu hình Program, mong đợi 1", got)
	}
	if got := len(collectionOf(document, "objects")); got != 2 {
		t.Fatalf("fixture sai: có %d POU object, mong đợi 2", got)
	}

	// Xoá Program duy nhất: sau khi bỏ nó, `programOrder` còn lại KHÔNG được
	// mang theo id của FUNCTION.
	if _, err := saveOps(t, service, projectID, draftID, saved.ETag,
		"70000000-0000-4000-8000-000000000102",
		op(map[string]any{"op": "removeProgram", "programId": programID}),
		op(map[string]any{"op": "removeObject", "objectId": programObject}),
		op(map[string]any{"op": "setTask", "task": map[string]any{
			"taskId": projectID, "periodMs": 1000, "programOrder": []string{}}})); err != nil {
		t.Fatalf("xoá Program bị từ chối: %v", err)
	}

	after := draftDocument(t, service, projectID)
	if got := len(collectionOf(after, "programs")); got != 0 {
		t.Fatalf("còn %d cấu hình Program sau khi xoá", got)
	}
	// POU của Program phải biến mất cùng cấu hình chạy. Giữ lại nó nghĩa là
	// Program vẫn hiện trên giao diện (danh sách dựng từ `objects`) và vẫn có
	// thể đi vào package ở lần Commission sau.
	objects := collectionOf(after, "objects")
	if len(objects) != 1 || objects[0]["objectId"] != functionObject {
		t.Fatalf("objects sau khi xoá = %v, mong đợi chỉ còn FUNCTION", objects)
	}
}

// Chốt chính cái ràng buộc mà FE vi phạm: `programOrder` mang id của một POU
// KHÔNG phải Program thì cả batch bị từ chối. Giữ hành vi fail-closed này của
// backend, và sửa ở phía dựng `programOrder`.
func TestSetTaskTuChoiProgramOrderChuaIdCuaUserPou(t *testing.T) {
	document := map[string]any{
		"objects": []any{
			map[string]any{"objectId": "p1", "kind": "PROGRAM", "name": "AHU"},
			map[string]any{"objectId": "f1", "kind": "FUNCTION", "name": "SCALE"},
		},
		"programs": []any{map[string]any{"programId": "p1", "objectId": "p1", "periodMs": float64(1000)}},
	}
	raw := []byte(`{"op":"setTask","task":{"taskId":"main","periodMs":1000,"programOrder":["p1","f1"]}}`)
	if err := setTaskCompat(document, raw); err == nil {
		t.Fatal("programOrder chứa id của FUNCTION phải bị từ chối, không được im lặng bỏ qua")
	}
}
