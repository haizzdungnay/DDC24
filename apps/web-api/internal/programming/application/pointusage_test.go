package application

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

/* ISS-PIO-18 — bộ quét binding Programming cho "ai đang dùng điểm này".
 *
 * Trước bản vá, `virtual-points/{id}/usage` chỉ quét alarm + schedule, nên xoá
 * một VP đang được chương trình ST bind cho ra danh sách RỖNG kèm
 * `incomplete = false` — "đã kiểm, không ai dùng" cho một câu hỏi chưa từng hỏi.
 */

// matchVP là luật so khớp tối giản dùng cho test: category rỗng vẫn xét tiếp,
// vì binding hình dạng v2 không mang category.
func matchVP(want string) PointMatcher {
	return func(category, pointID string) bool {
		if category != "" && !strings.EqualFold(category, "VP") {
			return false
		}
		return strings.EqualFold(pointID, want)
	}
}

func seedProjectWithBinding(t *testing.T, service *ProjectService, name, idemPrefix string, binding map[string]any) string {
	t.Helper()
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(ctx, actor, CreateProjectCommand{SchemaVersion: "1.0", Name: name,
		Description: "fixture ISS-PIO-18", IdempotencyKey: idemPrefix + "1", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "65555555-5555-4555-8555-555555555555"
	variableID := "67777777-7777-4777-8777-777777777777"

	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": "AHU", "kind": "PROGRAM", "language": "ST",
		"document": "PROGRAM AHU\nVAR_OUTPUT Fan : BOOL; END_VAR\nFan := TRUE;\nEND_PROGRAM\n"}})
	variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{
		"variableId": variableID, "programId": programID, "name": "Fan", "type": "BOOL", "retain": true}})
	bindingOp, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": binding})

	if _, err := service.SaveDraft(ctx, actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations: []json.RawMessage{program, variable, bindingOp}, IfMatch: created.ETag,
		IdempotencyKey: idemPrefix + "2", CorrelationID: testCorrelationID}); err != nil {
		t.Fatal(err)
	}
	return projectID
}

// Binding hình dạng v1 (tab Ánh xạ ghi): `point` lồng, có category.
func TestFindPointReferencesFindsNestedPointBinding(t *testing.T) {
	service, _ := openBundleService(t)
	projectID := seedProjectWithBinding(t, service, "AHU-1", "70000000-0000-4000-8000-00000000000", map[string]any{
		"bindingId":  "68888888-8888-4888-8888-888888888888",
		"variableId": "67777777-7777-4777-8777-777777777777",
		"point":      map[string]any{"category": "VP", "pointId": "VP-07"},
		"direction":  "WRITE", "dataType": "BOOL", "writable": true, "qualityPolicy": "REQUIRE_GOOD",
	})

	scan, err := service.FindPointReferences(context.Background(), matchVP("VP-07"))
	if err != nil {
		t.Fatalf("FindPointReferences: %v", err)
	}
	if len(scan.References) != 1 {
		t.Fatalf("references = %#v; muốn đúng 1 — bỏ sót nghĩa là báo \"không ai dùng\" cho một điểm đang dùng", scan.References)
	}
	ref := scan.References[0]
	if ref.ProjectID != projectID || ref.Scope != "draft" || ref.Variable != "Fan" || ref.Direction != "WRITE" {
		t.Fatalf("reference = %+v; muốn project=%s scope=draft variable=Fan direction=WRITE", ref, projectID)
	}
}

/* Binding hình dạng v2 KHÔNG mang category. Loại nó vì thiếu category chính là
 * bỏ sót đúng lớp binding mà tính năng này sinh ra để tìm — và bỏ sót thì im
 * lặng chứ không kêu. */
func TestFindPointReferencesFindsFlatBindingWithoutCategory(t *testing.T) {
	service, _ := openBundleService(t)
	seedProjectWithBinding(t, service, "AHU-2", "71000000-0000-4000-8000-00000000000", map[string]any{
		"bindingId": "68888888-8888-4888-8888-888888888889",
		"programId": "65555555-5555-4555-8555-555555555555",
		"variable":  "Fan", "pointId": "VP-07", "direction": "WRITE",
	})

	scan, err := service.FindPointReferences(context.Background(), matchVP("VP-07"))
	if err != nil {
		t.Fatalf("FindPointReferences: %v", err)
	}
	if len(scan.References) != 1 {
		t.Fatalf("references = %#v; muốn 1 — binding v2 không có category vẫn phải tìm ra", scan.References)
	}
	if got := scan.References[0].Category; got != "" {
		t.Fatalf("category = %q; binding v2 không mang category nên phải rỗng, không được bịa", got)
	}
}

// Một binding trỏ điểm KHÁC thì không được báo trùng vào.
func TestFindPointReferencesIgnoresOtherPoints(t *testing.T) {
	service, _ := openBundleService(t)
	seedProjectWithBinding(t, service, "AHU-3", "72000000-0000-4000-8000-00000000000", map[string]any{
		"bindingId":  "68888888-8888-4888-8888-88888888888a",
		"variableId": "67777777-7777-4777-8777-777777777777",
		"point":      map[string]any{"category": "LOCAL", "pointId": "DO-01"},
		"direction":  "WRITE", "dataType": "BOOL", "writable": true, "qualityPolicy": "REQUIRE_GOOD",
	})

	scan, err := service.FindPointReferences(context.Background(), matchVP("VP-07"))
	if err != nil {
		t.Fatalf("FindPointReferences: %v", err)
	}
	if len(scan.References) != 0 {
		t.Fatalf("references = %#v; muốn 0", scan.References)
	}
}

/* Chưa xác định được Revision đang chạy KHÔNG được im lặng.
 *
 * Ở harness test không có RuntimeImpactProvider nên `resolveActiveRevision` trả
 * `Resolved=false`. Đó là "chưa hỏi được mã đang chạy", KHÁC hẳn "mã đang chạy
 * không dùng điểm này" — và sự khác biệt đó phải đi lên tới người sắp bấm xoá. */
func TestFindPointReferencesReportsUnknownActiveRevision(t *testing.T) {
	service, _ := openBundleService(t)
	scan, err := service.FindPointReferences(context.Background(), matchVP("VP-07"))
	if err != nil {
		t.Fatalf("FindPointReferences: %v", err)
	}
	if len(scan.Errors) == 0 {
		t.Fatal("Errors rỗng: chưa biết Revision nào đang chạy mà kết quả vẫn tự nhận là đầy đủ")
	}
	found := false
	for _, item := range scan.Errors {
		found = found || strings.Contains(item, "programming-active-revision")
	}
	if !found {
		t.Fatalf("Errors = %v; muốn có mục programming-active-revision", scan.Errors)
	}
}

// Nhiều Project cùng bind một điểm ⇒ liệt kê đủ, không gộp mất.
func TestFindPointReferencesSpansProjects(t *testing.T) {
	service, _ := openBundleService(t)
	seedProjectWithBinding(t, service, "AHU-A", "73000000-0000-4000-8000-00000000000", map[string]any{
		"bindingId":  "68888888-8888-4888-8888-88888888888b",
		"variableId": "67777777-7777-4777-8777-777777777777",
		"point":      map[string]any{"category": "VP", "pointId": "VP-07"},
		"direction":  "READ", "dataType": "BOOL", "writable": false, "qualityPolicy": "REQUIRE_GOOD",
	})
	seedProjectWithBinding(t, service, "AHU-B", "74000000-0000-4000-8000-00000000000", map[string]any{
		"bindingId":  "68888888-8888-4888-8888-88888888888c",
		"variableId": "67777777-7777-4777-8777-777777777777",
		"point":      map[string]any{"category": "VP", "pointId": "VP-07"},
		"direction":  "WRITE", "dataType": "BOOL", "writable": true, "qualityPolicy": "REQUIRE_GOOD",
	})

	scan, err := service.FindPointReferences(context.Background(), matchVP("VP-07"))
	if err != nil {
		t.Fatalf("FindPointReferences: %v", err)
	}
	if len(scan.References) != 2 {
		t.Fatalf("references = %#v; muốn 2, mỗi Project một mục", scan.References)
	}
	if scan.References[0].ProjectID == scan.References[1].ProjectID {
		t.Fatalf("hai mục cùng Project: %#v", scan.References)
	}
}

// `point` lồng thắng khi cả hai hình dạng cùng có mặt: đó là thứ tab Ánh xạ và
// lớp Check đang dùng.
func TestBindingTargetPrefersNestedPoint(t *testing.T) {
	category, pointID := bindingTarget(map[string]any{
		"pointId":  "DO-01",
		"category": "LOCAL",
		"point":    map[string]any{"category": "VP", "pointId": "VP-07"},
	})
	if category != "VP" || pointID != "VP-07" {
		t.Fatalf("bindingTarget = (%q,%q); muốn (VP,VP-07)", category, pointID)
	}
}

// `point` lồng rỗng thì rơi về hình dạng phẳng, không trả rỗng.
func TestBindingTargetFallsBackToFlatShape(t *testing.T) {
	category, pointID := bindingTarget(map[string]any{
		"pointId":  "VP-09",
		"category": "VP",
		"point":    map[string]any{},
	})
	if category != "VP" || pointID != "VP-09" {
		t.Fatalf("bindingTarget = (%q,%q); muốn (VP,VP-09)", category, pointID)
	}
}

// Manifest của Revision đã seal dùng hình dạng PHẲNG.
func TestManifestBindingReferencesReadsFlatShape(t *testing.T) {
	manifest := []byte(`{"bindings":[
		{"programId":"p1","variable":"Fan","direction":"WRITE","category":"VP","pointId":"VP-07"},
		{"programId":"p1","variable":"Temp","direction":"READ","category":"LOCAL","pointId":"UI-01"}]}`)
	refs, err := manifestBindingReferences(manifest, matchVP("VP-07"))
	if err != nil {
		t.Fatalf("manifestBindingReferences: %v", err)
	}
	if len(refs) != 1 || refs[0].Variable != "Fan" {
		t.Fatalf("refs = %#v; muốn đúng binding Fan", refs)
	}
}
