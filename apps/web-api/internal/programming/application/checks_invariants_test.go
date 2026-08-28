package application

import (
	"encoding/json"
	"math"
	"testing"
)

func objectView(kind, objectID string, payload map[string]any) revisionObjectView {
	raw, _ := json.Marshal(payload)
	return revisionObjectView{ObjectID: objectID, Kind: kind, Payload: raw}
}

func programView(objectID string) revisionObjectView {
	return objectView("PROGRAM", objectID, map[string]any{"objectId": objectID, "kind": "PROGRAM"})
}

func programViewWithRuntimeID(objectID, programID string) revisionObjectView {
	return objectView("PROGRAM", objectID, map[string]any{
		"objectId": objectID, "kind": "PROGRAM",
		"programConfig": map[string]any{"programId": programID, "objectId": objectID, "periodMs": 1000},
	})
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

func TestSignalPublisherUsesStableProgramIDNotPouObjectID(t *testing.T) {
	objectID := "a1111111-1111-4111-8111-111111111111"
	programID := "b2222222-2222-4222-8222-222222222222"
	objects := []revisionObjectView{
		programViewWithRuntimeID(objectID, programID),
		signalView("d4444444-4444-4444-8444-444444444441", "SUPPLY_TEMP", "REAL",
			programID, "HOLD_LAST", 5000, nil),
	}
	if diagnostics := packageInvariantDiagnostics(objects); len(diagnostics) != 0 {
		t.Fatalf("publisher programId hợp lệ bị so nhầm với objectId: %+v", diagnostics)
	}
	packaged := packageSignals(objects)
	if len(packaged) != 1 || packaged[0].Publisher != programID {
		t.Fatalf("publisher runtime bị đổi identity: %+v", packaged)
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

func TestSignalFallbackMustBeRepresentableByDeclaredType(t *testing.T) {
	program := "a1111111-1111-4111-8111-111111111111"
	badBool, badInt, badUint := 2.0, 32768.0, -1.0
	objects := []revisionObjectView{
		programView(program),
		signalView("d4444444-4444-4444-8444-444444444441", "BAD_BOOL", "BOOL", program, "USE_FALLBACK", 5000, &badBool),
		signalView("d4444444-4444-4444-8444-444444444442", "BAD_INT", "INT", program, "USE_FALLBACK", 5000, &badInt),
		signalView("d4444444-4444-4444-8444-444444444443", "BAD_UINT", "UINT", program, "USE_FALLBACK", 5000, &badUint),
	}
	if counts := detailCodes(packageInvariantDiagnostics(objects)); counts["ST-SIG-002"] != 3 {
		t.Fatalf("fallback ngoài miền không bị Check chặn: %+v", counts)
	}
}

func TestSignalFallbackEncodingMatchesCanonicalStCellLayout(t *testing.T) {
	cases := []struct {
		dataType string
		value    float64
		want     uint64
	}{
		{"BOOL", 1, 1},
		{"INT", -2, uint64(uint32(0xfffffffe))},
		{"DINT", -2147483648, uint64(uint32(0x80000000))},
		{"UINT", 65535, 65535},
		{"REAL", 5.5, uint64(math.Float32bits(5.5))},
		{"TIME", 2500, 2_500_000_000},
	}
	for _, testCase := range cases {
		got, ok := encodeSignalFallback(testCase.dataType, testCase.value)
		if !ok || got != testCase.want {
			t.Errorf("%s(%v) = %#x/%v, muốn %#x/true", testCase.dataType,
				testCase.value, got, ok, testCase.want)
		}
	}
}

// Chính sách stale là enum ĐÓNG. Trước T59-404 chỉ có phép kiểm cặp
// policy/fallback, nên một chính sách bịa đi lọt xuống package và buộc runtime
// phải ĐOÁN thiết bị làm gì khi mất dữ liệu — tức là chọn thay người thiết kế.
func TestStalePolicyIsAClosedSet(t *testing.T) {
	program := "a1111111-1111-4111-8111-111111111111"
	value := 21.5
	objects := []revisionObjectView{
		programView(program),
		// Ba tên hợp lệ: không được sinh diagnostic nào.
		signalView("d4444444-4444-4444-8444-444444444441", "OK_HOLD", "REAL", program, "HOLD_LAST", 5000, nil),
		signalView("d4444444-4444-4444-8444-444444444442", "OK_FALL", "REAL", program, "USE_FALLBACK", 5000, &value),
		signalView("d4444444-4444-4444-8444-444444444443", "OK_WAIT", "REAL", program, "WAIT", 5000, nil),
	}
	if counts := detailCodes(packageInvariantDiagnostics(objects)); counts["ST-SIG-003"] != 0 {
		t.Fatalf("ba chính sách hợp lệ bị từ chối: %+v", counts)
	}

	// Chuỗi rỗng, tên viết thường, tên của tài liệu kiến trúc (`USE_LAST`/
	// `FALLBACK` — cách gọi khác của cùng ba chính sách) và một tên bịa. Mọi
	// biến thể đều phải bị chặn ở Check, không đẩy xuống runtime.
	for _, policy := range []string{"", "hold_last", "USE_LAST", "FALLBACK", "MAGIC", "HOLD_LAST "} {
		objects := []revisionObjectView{
			programView(program),
			signalView("d4444444-4444-4444-8444-444444444441", "BAD_POLICY", "REAL", program, policy, 5000, nil),
		}
		counts := detailCodes(packageInvariantDiagnostics(objects))
		if counts["ST-SIG-003"] != 1 {
			t.Fatalf("chính sách %q không bị chặn: %+v", policy, counts)
		}
	}
}

// Signal phải ĐI TRONG container, không dừng lại ở manifest Check. Trước T59-404
// `mkddc-st-package` không hề nhận signal, nên mọi khai báo Published Signal đã
// qua validate vẫn KHÔNG tới được thiết bị — bus ở runtime luôn rỗng.
func TestPackageSignalsReachTheContainer(t *testing.T) {
	program := "a1111111-1111-4111-8111-111111111111"
	value := 5.0
	objects := []revisionObjectView{
		programView(program),
		signalView("d4444444-4444-4444-8444-444444444442", "ZULU", "REAL", program, "WAIT", 5000, nil),
		signalView("d4444444-4444-4444-8444-444444444441", "ALPHA", "REAL", program, "USE_FALLBACK", 30000, &value),
		signalView("d4444444-4444-4444-8444-444444444443", "MIKE", "BOOL", program, "HOLD_LAST", 1000, nil),
	}
	signals := packageSignals(objects)
	if len(signals) != 3 {
		t.Fatalf("số signal=%d", len(signals))
	}
	// Sắp theo TÊN, không theo thứ tự đọc DB: hai lần Check trên cùng Revision
	// phải cho cùng một package.
	if signals[0].Name != "ALPHA" || signals[1].Name != "MIKE" || signals[2].Name != "ZULU" {
		t.Fatalf("thứ tự signal không tất định: %+v", signals)
	}
	if signals[0].StalePolicy != 1 || signals[1].StalePolicy != 0 || signals[2].StalePolicy != 2 {
		t.Fatalf("chính sách stale ánh xạ sai: %+v", signals)
	}
	if signals[0].FallbackBits == nil || *signals[0].FallbackBits != uint64(math.Float32bits(5.0)) {
		t.Fatalf("giá trị dự phòng không đi xuống dưới dạng bit: %+v", signals[0])
	}
	if signals[1].FallbackBits != nil || signals[2].FallbackBits != nil {
		t.Fatal("chính sách không phải USE_FALLBACK mà vẫn mang giá trị dự phòng")
	}
	// Mã kiểu phải là mã `StType` của runtime, không phải 0 mặc định.
	if signals[1].Type != 1 || signals[0].Type != 3 {
		t.Fatalf("mã kiểu sai: %+v", signals)
	}
	if signals[0].FreshnessMs != 30000 || signals[2].FreshnessMs != 5000 {
		t.Fatalf("freshness sai: %+v", signals)
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
