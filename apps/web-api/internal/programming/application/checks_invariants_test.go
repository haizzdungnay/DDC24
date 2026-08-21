package application

import (
	"encoding/json"
	"testing"
)

func objectView(kind, objectID string, payload map[string]any) revisionObjectView {
	raw, _ := json.Marshal(payload)
	return revisionObjectView{ObjectID: objectID, Kind: kind, Payload: raw}
}

func programView(objectID string) revisionObjectView {
	return objectView("PROGRAM", objectID, map[string]any{"objectId": objectID, "kind": "PROGRAM"})
}

func bindingView(bindingID, programID, direction, category, pointID string, extIndex int) revisionObjectView {
	point := map[string]any{"category": category, "pointId": pointID}
	if extIndex > 0 {
		point["extIndex"] = extIndex
		point["deviceId"] = "mb-1"
	}
	return objectView("BINDING", bindingID, map[string]any{
		"bindingId": bindingID, "programId": programID, "direction": direction, "point": point})
}

func signalView(signalID, name, dataType, publisherID, policy string, freshness float64, fallback *float64) revisionObjectView {
	payload := map[string]any{"signalId": signalID, "name": name, "type": dataType,
		"publisherProgramId": publisherID, "freshnessMs": freshness, "stalePolicy": policy}
	if fallback != nil {
		payload["fallbackValue"] = *fallback
	}
	return objectView("SIGNAL", signalID, payload)
}

func detailCodes(diagnostics []DiagnosticView) map[string]int {
	counts := make(map[string]int, len(diagnostics))
	for _, diagnostic := range diagnostics {
		counts[diagnostic.DetailCode]++
	}
	return counts
}

// Hai Program cùng ghi MỘT điểm vật lý là hai nguồn lệnh cho một cơ cấu chấp
// hành; trọng tài ưu tiên không giải quyết được vì cả hai ở cùng mức.
func TestOutputOwnerConflictIsRejectedAtCheck(t *testing.T) {
	objects := []revisionObjectView{
		programView("a1111111-1111-4111-8111-111111111111"),
		programView("b2222222-2222-4222-8222-222222222222"),
		bindingView("c3333333-3333-4333-8333-333333333331", "a1111111-1111-4111-8111-111111111111", "WRITE", "LOCAL", "AO-01", 0),
		bindingView("c3333333-3333-4333-8333-333333333332", "b2222222-2222-4222-8222-222222222222", "WRITE", "LOCAL", "ao-01", 0),
	}
	diagnostics := packageInvariantDiagnostics(objects)
	if counts := detailCodes(diagnostics); counts["ST-OWN-001"] != 1 {
		t.Fatalf("output owner conflict=%+v", diagnostics)
	}
	if diagnostics[0].Code != "PRG-ERR-OUTPUT-OWNER-001" {
		t.Fatalf("mã public=%s", diagnostics[0].Code)
	}
}

// Với MB_RTU, identity vật lý là `(deviceId, extIndex)`. So bằng TÊN điểm sẽ bỏ
// lọt đúng trường hợp nguy hiểm: hai tên khác nhau trỏ cùng một thanh ghi.
func TestOutputOwnerConflictUsesPhysicalIdentityForModbus(t *testing.T) {
	objects := []revisionObjectView{
		programView("a1111111-1111-4111-8111-111111111111"),
		programView("b2222222-2222-4222-8222-222222222222"),
		bindingView("c3333333-3333-4333-8333-333333333331", "a1111111-1111-4111-8111-111111111111", "WRITE", "MB_RTU", "valve.cmd", 7),
		bindingView("c3333333-3333-4333-8333-333333333332", "b2222222-2222-4222-8222-222222222222", "WRITE", "MB_RTU", "van.lenh", 7),
	}
	if counts := detailCodes(packageInvariantDiagnostics(objects)); counts["ST-OWN-001"] != 1 {
		t.Fatalf("hai tên khác nhau trỏ cùng slot EXT không bị bắt: %+v", counts)
	}
}

// Chiều khẳng định: đọc chung một điểm là hợp lệ, và mỗi Program ghi điểm riêng
// cũng hợp lệ. Guard chặn tất cả cũng là guard sai.
func TestOutputOwnerAllowsSharedReadsAndDistinctWrites(t *testing.T) {
	objects := []revisionObjectView{
		programView("a1111111-1111-4111-8111-111111111111"),
		programView("b2222222-2222-4222-8222-222222222222"),
		bindingView("c3333333-3333-4333-8333-333333333331", "a1111111-1111-4111-8111-111111111111", "READ", "LOCAL", "UI-01", 0),
		bindingView("c3333333-3333-4333-8333-333333333332", "b2222222-2222-4222-8222-222222222222", "READ", "LOCAL", "UI-01", 0),
		bindingView("c3333333-3333-4333-8333-333333333333", "a1111111-1111-4111-8111-111111111111", "WRITE", "LOCAL", "AO-01", 0),
		bindingView("c3333333-3333-4333-8333-333333333334", "b2222222-2222-4222-8222-222222222222", "WRITE", "LOCAL", "AO-02", 0),
	}
	if diagnostics := packageInvariantDiagnostics(objects); len(diagnostics) != 0 {
		t.Fatalf("cấu hình hợp lệ bị từ chối: %+v", diagnostics)
	}
}

// Một signal có ĐÚNG MỘT publisher: hai publisher nghĩa là hai nguồn sự thật cho
// cùng một tên và consumer không có cách nào biết đọc cái nào.
func TestSignalDuplicatePublisherIsRejected(t *testing.T) {
	objects := []revisionObjectView{
		programView("a1111111-1111-4111-8111-111111111111"),
		programView("b2222222-2222-4222-8222-222222222222"),
		signalView("d4444444-4444-4444-8444-444444444441", "SUPPLY_TEMP", "REAL", "a1111111-1111-4111-8111-111111111111", "HOLD_LAST", 5000, nil),
		signalView("d4444444-4444-4444-8444-444444444442", "supply_temp", "REAL", "b2222222-2222-4222-8222-222222222222", "HOLD_LAST", 5000, nil),
	}
	diagnostics := packageInvariantDiagnostics(objects)
	if counts := detailCodes(diagnostics); counts["ST-SIG-001"] != 1 {
		t.Fatalf("trùng publisher (case-folded) không bị bắt: %+v", diagnostics)
	}
	if diagnostics[0].Code != "PRG-ERR-SIGNAL-PUBLISHER-001" {
		t.Fatalf("mã public=%s", diagnostics[0].Code)
	}
}

// Signal mất publisher là signal không ai ghi — consumer sẽ chờ vĩnh viễn.
func TestSignalWithoutPublisherProgramIsRejected(t *testing.T) {
	objects := []revisionObjectView{
		programView("a1111111-1111-4111-8111-111111111111"),
		signalView("d4444444-4444-4444-8444-444444444441", "SUPPLY_TEMP", "REAL", "e5555555-5555-4555-8555-555555555555", "HOLD_LAST", 5000, nil),
	}
	if counts := detailCodes(packageInvariantDiagnostics(objects)); counts["ST-SIG-004"] != 1 {
		t.Fatalf("publisher không tồn tại không bị bắt: %+v", counts)
	}
}

// Freshness ngoài dải là một chính sách stale KHÔNG thực thi được; kiểu ngoài hệ
// kiểu ST không có biểu diễn nào để truyền.
func TestSignalFreshnessAndTypeAreValidated(t *testing.T) {
	program := "a1111111-1111-4111-8111-111111111111"
	objects := []revisionObjectView{
		programView(program),
		signalView("d4444444-4444-4444-8444-444444444441", "TOO_FAST", "REAL", program, "HOLD_LAST", 999, nil),
		signalView("d4444444-4444-4444-8444-444444444442", "TOO_SLOW", "REAL", program, "HOLD_LAST", 90001, nil),
		signalView("d4444444-4444-4444-8444-444444444443", "BAD_TYPE", "STRING", program, "HOLD_LAST", 5000, nil),
	}
	counts := detailCodes(packageInvariantDiagnostics(objects))
	if counts["ST-SIG-003"] != 2 || counts["ST-SIG-002"] != 1 {
		t.Fatalf("freshness/type=%+v", counts)
	}
}

// `USE_FALLBACK` và giá trị dự phòng đi liền nhau — đúng lối "im lặng thay bằng
// 0" mà DDD §10 cấm.
func TestSignalFallbackIsCoupledToPolicy(t *testing.T) {
	program := "a1111111-1111-4111-8111-111111111111"
	value := 21.5
	objects := []revisionObjectView{
		programView(program),
		signalView("d4444444-4444-4444-8444-444444444441", "NO_FALLBACK", "REAL", program, "USE_FALLBACK", 5000, nil),
		signalView("d4444444-4444-4444-8444-444444444442", "EXTRA_FALLBACK", "REAL", program, "HOLD_LAST", 5000, &value),
		signalView("d4444444-4444-4444-8444-444444444443", "OK_FALLBACK", "REAL", program, "USE_FALLBACK", 5000, &value),
		signalView("d4444444-4444-4444-8444-444444444444", "OK_HOLD", "REAL", program, "HOLD_LAST", 5000, nil),
	}
	counts := detailCodes(packageInvariantDiagnostics(objects))
	if counts["ST-SIG-003"] != 2 {
		t.Fatalf("ghép policy/fallback=%+v", counts)
	}
}

// Bất biến được GỘP: mọi vi phạm của package hiện ra trong một lần Check, không
// phải sửa từng cái rồi chạy lại.
func TestPackageInvariantsAreAggregated(t *testing.T) {
	first := "a1111111-1111-4111-8111-111111111111"
	second := "b2222222-2222-4222-8222-222222222222"
	objects := []revisionObjectView{
		programView(first), programView(second),
		bindingView("c3333333-3333-4333-8333-333333333331", first, "WRITE", "LOCAL", "AO-01", 0),
		bindingView("c3333333-3333-4333-8333-333333333332", second, "WRITE", "LOCAL", "AO-01", 0),
		signalView("d4444444-4444-4444-8444-444444444441", "SUPPLY_TEMP", "REAL", first, "HOLD_LAST", 5000, nil),
		signalView("d4444444-4444-4444-8444-444444444442", "SUPPLY_TEMP", "REAL", second, "HOLD_LAST", 5000, nil),
	}
	counts := detailCodes(packageInvariantDiagnostics(objects))
	if counts["ST-OWN-001"] != 1 || counts["ST-SIG-001"] != 1 {
		t.Fatalf("không gộp đủ vi phạm: %+v", counts)
	}
}
