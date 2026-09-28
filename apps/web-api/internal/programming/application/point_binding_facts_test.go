package application

import (
	"strings"
	"testing"
)

/* ISS-PIO-28 — Check kiểm phần ĐẶC THÙ của từng nguồn Point (F-PIO-028, đề bài §33).
 *
 * Mọi lỗi trong nhóm này đều KHÔNG làm gì hỏng ồn ào. Bind vào một kênh đang
 * tắt cho ra một biến đọc mãi một con số không ai cập nhật; bind OUTPUT vào một
 * VP do web-api sở hữu cho ra cuộc giằng co 10 giây một lần. Cả hai đều chạy,
 * đều GOOD, và chỉ lộ ra khi có người ngồi so số bằng tay.
 */

func localSnapshot(facts ...LocalPointFacts) *PointBindingSnapshot {
	snapshot := &PointBindingSnapshot{Local: map[string]LocalPointFacts{}, Virtual: map[string]VirtualPointFacts{}}
	for _, item := range facts {
		snapshot.Local[item.PointID] = item
	}
	return snapshot
}

func virtualSnapshot(facts ...VirtualPointFacts) *PointBindingSnapshot {
	snapshot := &PointBindingSnapshot{Local: map[string]LocalPointFacts{}, Virtual: map[string]VirtualPointFacts{}}
	for _, item := range facts {
		snapshot.Virtual[item.PointID] = item
	}
	return snapshot
}

func float64Ptr(v float64) *float64 { return &v }

// ── Physical ──────────────────────────────────────────────────────────────

// Kênh không có trong cấu hình I/O thì binding không có gì bảo chứng.
func TestLocalBindingRejectsUnknownChannel(t *testing.T) {
	if reason := checkLocalBinding(localSnapshot(), "UI-05", "input"); reason == "" {
		t.Fatal("kênh không tồn tại vẫn qua Check")
	}
}

/* Kênh đang TẮT: chương trình bind vào nó sẽ đọc/ghi một kênh không ai cập
 * nhật, và không có lỗi nào báo ra lúc chạy. */
func TestLocalBindingRejectsDisabledChannel(t *testing.T) {
	snapshot := localSnapshot(LocalPointFacts{PointID: "UI-05", Enabled: false, SignalType: "0-10v"})
	reason := checkLocalBinding(snapshot, "UI-05", "input")
	if reason == "" {
		t.Fatal("kênh đang tắt vẫn qua Check")
	}
	if !strings.Contains(reason, "TẮT") {
		t.Fatalf("lý do không nói kênh đang tắt: %s", reason)
	}
}

/* Kênh UI chưa khai kiểu tín hiệu = chưa biết nó đang đo gì (capability/scaling).
 * Con số nó trả về khi ấy không có nghĩa vật lý nào. */
func TestLocalBindingRequiresSignalTypeOnUniversalInput(t *testing.T) {
	for _, signalType := range []string{"", "  ", "none"} {
		snapshot := localSnapshot(LocalPointFacts{PointID: "UI-05", Enabled: true, SignalType: signalType})
		if reason := checkLocalBinding(snapshot, "UI-05", "input"); reason == "" {
			t.Fatalf("kiểu tín hiệu %q vẫn qua Check", signalType)
		}
	}
	ok := localSnapshot(LocalPointFacts{PointID: "UI-05", Enabled: true, SignalType: "ntc10k"})
	if reason := checkLocalBinding(ok, "UI-05", "input"); reason != "" {
		t.Fatalf("kênh đã khai kiểu vẫn bị chặn: %s", reason)
	}
}

/* Đầu ra do chương trình lái mà chưa khai safe-state: khi Core vào chế độ an
 * toàn, không ai biết phải đưa cơ cấu chấp hành về đâu. */
func TestLocalOutputBindingRequiresSafeState(t *testing.T) {
	noSafe := localSnapshot(LocalPointFacts{PointID: "DO-01", Enabled: true})
	if reason := checkLocalBinding(noSafe, "DO-01", "output"); reason == "" {
		t.Fatal("đầu ra chưa khai safe-state vẫn qua Check")
	}
	// Cùng kênh đó ở hướng ĐỌC thì không cần safe-state.
	if reason := checkLocalBinding(noSafe, "DO-01", "input"); reason != "" {
		t.Fatalf("hướng đọc không cần safe-state mà vẫn bị chặn: %s", reason)
	}
	withSafe := localSnapshot(LocalPointFacts{PointID: "DO-01", Enabled: true, HasSafeValue: true})
	if reason := checkLocalBinding(withSafe, "DO-01", "output"); reason != "" {
		t.Fatalf("đầu ra đã khai safe-state vẫn bị chặn: %s", reason)
	}
}

// AO/DO không phải kênh UI nên không đòi kiểu tín hiệu.
func TestLocalBindingDoesNotRequireSignalTypeOnOutputs(t *testing.T) {
	snapshot := localSnapshot(LocalPointFacts{PointID: "AO-01", Enabled: true, HasSafeValue: true})
	if reason := checkLocalBinding(snapshot, "AO-01", "output"); reason != "" {
		t.Fatalf("AO bị đòi kiểu tín hiệu: %s", reason)
	}
}

// ── Virtual ───────────────────────────────────────────────────────────────

func TestVirtualBindingRejectsMissingOrDisabledPoint(t *testing.T) {
	if reason := checkVirtualBinding(virtualSnapshot(), "VP1", "input", "REAL"); reason == "" {
		t.Fatal("điểm ảo không tồn tại vẫn qua Check")
	}
	off := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: false, SignalType: "float"})
	if reason := checkVirtualBinding(off, "VP1", "input", "REAL"); reason == "" {
		t.Fatal("điểm ảo đang tắt vẫn qua Check")
	}
}

/* `ISS-PIO-16` — chương trình GHI vào một VP do web-api sở hữu sẽ bị vòng đối
 * chiếu 10 giây kéo về giá trị cấu hình. Một cuộc giằng co im lặng mà không bên
 * nào thắng hẳn. */
func TestVirtualOutputBindingRequiresProgramOwnership(t *testing.T) {
	web := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true, SignalType: "float", Source: "WEB"})
	reason := checkVirtualBinding(web, "VP1", "output", "REAL")
	if reason == "" {
		t.Fatal("chương trình ghi vào VP do web-api sở hữu vẫn qua Check")
	}
	if !strings.Contains(reason, "PROGRAM") {
		t.Fatalf("lý do không chỉ ra cách gỡ: %s", reason)
	}
	// Hướng ĐỌC thì VP do web-api sở hữu là hợp lệ — hai trục vẫn tách.
	if reason := checkVirtualBinding(web, "VP1", "input", "REAL"); reason != "" {
		t.Fatalf("hướng đọc bị chặn nhầm: %s", reason)
	}
	program := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true, SignalType: "float", Source: "PROGRAM"})
	if reason := checkVirtualBinding(program, "VP1", "output", "REAL"); reason != "" {
		t.Fatalf("VP do chương trình sở hữu vẫn bị chặn: %s", reason)
	}
}

/* U-05 (REC-DDC-FIELD-USE-20260927) — `writable` là quyền của NGƯỜI VẬN HÀNH,
 * không phải của chương trình. VP trạng thái do PROGRAM sở hữu mà khoá khỏi
 * người vận hành (`writable=false`) phải qua Check; quyền ghi của chương trình
 * đến từ `source`, và VP do web-api sở hữu vẫn bị chặn dù `writable=true`. */
func TestVirtualOutputBindingFollowsOwnershipNotOperatorWritable(t *testing.T) {
	locked := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: false, SignalType: "float", Source: "PROGRAM"})
	if reason := checkVirtualBinding(locked, "VP1", "output", "REAL"); reason != "" {
		t.Fatalf("VP do chương trình sở hữu, khoá khỏi người vận hành, vẫn bị chặn: %s", reason)
	}
	webWritable := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true, SignalType: "float", Source: "WEB"})
	if reason := checkVirtualBinding(webWritable, "VP1", "output", "REAL"); reason == "" {
		t.Fatal("VP do web-api sở hữu vẫn nhận binding ghi chỉ vì writable=true")
	}
}

/* Lệch kiểu cho ra một phép ĐỔI NGẦM chứ không phải một lỗi — số vẫn chạy, chỉ
 * là nó không còn là số người viết chương trình nghĩ. */
func TestVirtualBindingRejectsSignalTypeMismatch(t *testing.T) {
	snapshot := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true, SignalType: "boolean", Source: "PROGRAM"})
	if reason := checkVirtualBinding(snapshot, "VP1", "input", "REAL"); reason == "" {
		t.Fatal("biến REAL bind vào VP boolean vẫn qua Check")
	}
	okSnapshot := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true, SignalType: "boolean", Source: "PROGRAM"})
	if reason := checkVirtualBinding(okSnapshot, "VP1", "input", "BOOL"); reason != "" {
		t.Fatalf("BOOL ↔ boolean vẫn bị chặn: %s", reason)
	}
}

/* Kiểu biến ST do SLOT Core quyết định, không do `signalType` khai báo.
 *
 * Bộ cấp slot đặt VP `integer` lên `AV` (REAL) và VP `multistate` lên `MSV`
 * (UINT); `st_io_map.cpp` khoá cứng `AV ⇒ REAL`, `BV ⇒ BOOL`, `MSV ⇒ UINT`. Luật
 * cũ đòi REAL ↔ `float` và UINT ↔ `integer` nên hai kiểu VP này không bind được
 * vào biến nào — đo được trên bo Foxlinx 2026-09-27 (`PIO-SRC-001`). */
func TestVirtualBindingTypeFollowsCoreSlot(t *testing.T) {
	cases := []struct {
		name, signalType, slot, pointID, dataType string
		pass                                      bool
	}{
		{"integer trên AV nhận REAL", "integer", "AV-2", "AV-2", "REAL", true},
		{"integer trên AV từ chối DINT", "integer", "AV-2", "AV-2", "DINT", false},
		{"multistate trên MSV nhận UINT", "multistate", "MSV-1", "MSV-1", "UINT", true},
		{"multistate trên MSV từ chối INT", "multistate", "MSV-1", "MSV-1", "INT", false},
		{"float trên AV nhận REAL", "float", "AV-4", "AV-4", "REAL", true},
		{"boolean trên BV nhận BOOL", "boolean", "BV-1", "BV-1", "BOOL", true},
		{"boolean trên BV từ chối REAL", "boolean", "BV-1", "BV-1", "REAL", false},
		// Binding mang mã điểm ảo thay vì mã slot vẫn phải suy kiểu từ slot.
		{"mã VP, slot MSV nhận UINT", "multistate", "MSV-2", "VP10", "UINT", true},
		{"mã VP, slot AV từ chối UINT", "integer", "AV-3", "VP4", "UINT", false},
		// Chưa có slot: suy theo pool mà allocator sẽ chọn.
		{"chưa slot, integer nhận REAL", "integer", "", "VP4", "REAL", true},
		{"chưa slot, multistate nhận UINT", "multistate", "", "VP2", "UINT", true},
		{"chưa slot, integer từ chối DINT", "integer", "", "VP4", "DINT", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			facts := VirtualPointFacts{PointID: tc.pointID, Enabled: true, Writable: true,
				SignalType: tc.signalType, Source: "WEB", BoundPointID: tc.slot}
			reason := checkVirtualBinding(virtualSnapshot(facts), tc.pointID, "input", tc.dataType)
			if tc.pass && reason != "" {
				t.Fatalf("bị chặn nhầm: %s", reason)
			}
			if !tc.pass && reason == "" {
				t.Fatal("lệch kiểu so với slot Core vẫn qua Check")
			}
			if !tc.pass && !strings.Contains(reason, "đổi kiểu biến thành") {
				t.Fatalf("lý do không nói phải sửa thành kiểu gì: %s", reason)
			}
		})
	}
}

// Kiểu ST không ràng buộc kiểu tín hiệu nào thì không có gì để đối chiếu — im
// lặng ở đó là đúng, khác hẳn im lặng vì bỏ sót.
func TestVirtualBindingSkipsTypeCheckForUnmappedSTTypes(t *testing.T) {
	snapshot := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true, SignalType: "string", Source: "PROGRAM"})
	if reason := checkVirtualBinding(snapshot, "VP1", "input", "STRING"); reason != "" {
		t.Fatalf("kiểu không ánh xạ được vẫn bị chặn: %s", reason)
	}
}

// `ISS-PIO-15` — biên đảo ngược nghĩa là MỌI lệnh ghi đều bị từ chối lúc chạy.
func TestVirtualBindingRejectsInvertedEngineeringRange(t *testing.T) {
	snapshot := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true,
		SignalType: "float", Source: "PROGRAM", MinValue: float64Ptr(30), MaxValue: float64Ptr(16)})
	if reason := checkVirtualBinding(snapshot, "VP1", "output", "REAL"); reason == "" {
		t.Fatal("biên kỹ thuật đảo ngược vẫn qua Check")
	}
}

/* `ISS-PIO-14` — `initial` mà chưa đặt `initialValue` thì sau khởi động lại
 * điểm về mặc định theo kiểu tín hiệu, không phải con số chương trình hình dung. */
func TestVirtualBindingRejectsInitialPolicyWithoutInitialValue(t *testing.T) {
	missing := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true,
		SignalType: "float", Source: "PROGRAM", RestartPolicy: "initial", HasInitial: false})
	if reason := checkVirtualBinding(missing, "VP1", "output", "REAL"); reason == "" {
		t.Fatal("restartPolicy=initial thiếu initialValue vẫn qua Check")
	}
	present := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true,
		SignalType: "float", Source: "PROGRAM", RestartPolicy: "initial", HasInitial: true})
	if reason := checkVirtualBinding(present, "VP1", "output", "REAL"); reason != "" {
		t.Fatalf("đã đặt initialValue vẫn bị chặn: %s", reason)
	}
	retain := virtualSnapshot(VirtualPointFacts{PointID: "VP1", Enabled: true, Writable: true,
		SignalType: "float", Source: "PROGRAM", RestartPolicy: "retain"})
	if reason := checkVirtualBinding(retain, "VP1", "output", "REAL"); reason != "" {
		t.Fatalf("retain không cần initialValue mà vẫn bị chặn: %s", reason)
	}
}

// Tra mã không phân biệt hoa thường: mã điểm đi qua nhiều lớp, không lớp nào
// hứa giữ nguyên cách viết.
func TestPointLookupIsCaseInsensitive(t *testing.T) {
	local := localSnapshot(LocalPointFacts{PointID: "UI-05", Enabled: true, SignalType: "ntc10k"})
	if reason := checkLocalBinding(local, "ui-05", "input"); reason != "" {
		t.Fatalf("tra mã phân biệt hoa thường: %s", reason)
	}
}

/* Không có provider ⇒ các phép kiểm KHÔNG chạy và KHÔNG chặn.
 *
 * Lựa chọn có cân nhắc: khác slot Modbus (con số lưu là dấu vết có thể trôi),
 * binding LOCAL/VP mang thẳng danh tính bền. Bảo đảm nằm ở cổng NỐI DÂY, xem
 * `TestCheckServiceIsWiredWithPointFacts` phía `internal/app`. */
func TestNilProviderDoesNotBlockBindings(t *testing.T) {
	if reason := checkLocalBinding(nil, "UI-05", "input"); reason != "" {
		t.Fatalf("thiếu provider mà vẫn chặn binding LOCAL: %s", reason)
	}
	if reason := checkVirtualBinding(nil, "VP1", "output", "REAL"); reason != "" {
		t.Fatalf("thiếu provider mà vẫn chặn binding VP: %s", reason)
	}
}
