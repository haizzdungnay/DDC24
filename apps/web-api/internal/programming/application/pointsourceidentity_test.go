package application

import "testing"

func floatPtr(value float64) *float64 { return &value }

/* ISS-PIO-09 — chuỗi định danh theo nguồn. Nguyên tắc xuyên suốt các test dưới
 * đây: THIẾU DỮ LIỆU THÌ BỎ TRỐNG. Một hàng ghi "HR 0 · FC03" cho điểm chưa
 * biết địa chỉ tệ hơn hẳn một hàng không ghi gì, vì nó trông như sự thật. */

func TestLocalSourceDetailJoinsSignalTypeAndSpan(t *testing.T) {
	got := LocalSourceDetail("0-10V", "°C", floatPtr(0), floatPtr(50))
	if want := "0-10V → 0…50 °C"; got != want {
		t.Fatalf("LocalSourceDetail = %q; muốn %q", got, want)
	}
}

func TestLocalSourceDetailKeepsSignalTypeVerbatim(t *testing.T) {
	// Viết lại "0-10V" thành "0–10 V" cho đẹp là tự tạo một cách gọi thứ hai
	// cho cùng một thứ; người vận hành tìm theo chuỗi trong cấu hình sẽ hụt.
	if got := LocalSourceDetail("NTC10k", "", nil, nil); got != "NTC10k" {
		t.Fatalf("LocalSourceDetail = %q; muốn giữ nguyên văn %q", got, "NTC10k")
	}
}

func TestLocalSourceDetailNeedsBothBounds(t *testing.T) {
	if got := LocalSourceDetail("0-10V", "°C", floatPtr(0), nil); got != "0-10V" {
		t.Fatalf("thiếu biên trên vẫn dựng dải: %q", got)
	}
	if got := LocalSourceDetail("", "°C", nil, floatPtr(50)); got != "" {
		t.Fatalf("thiếu biên dưới vẫn dựng dải: %q", got)
	}
}

func TestLocalSourceDetailKeepsZeroBound(t *testing.T) {
	// `scale_lo: 0` là biên rất hay gặp. Nếu code coi 0 là "chưa khai" thì đúng
	// nhóm điểm phổ biến nhất sẽ mất dải.
	if got := LocalSourceDetail("", "%", floatPtr(0), floatPtr(100)); got != "0…100 %" {
		t.Fatalf("LocalSourceDetail = %q", got)
	}
}

func TestLocalSourceDetailEmptyWhenNothingKnown(t *testing.T) {
	if got := LocalSourceDetail("  ", "", nil, nil); got != "" {
		t.Fatalf("LocalSourceDetail = %q; muốn rỗng", got)
	}
}

func TestVirtualSourceDetailReportsAccessAndRetain(t *testing.T) {
	for _, testCase := range []struct {
		writable bool
		policy   string
		want     string
	}{
		{true, "retain", "RW · RETAIN"},
		{true, "initial", "RW"},
		{false, "retain", "RO · RETAIN"},
		{false, "", "RO"},
		{true, "RETAIN", "RW · RETAIN"},
	} {
		if got := VirtualSourceDetail(testCase.writable, testCase.policy); got != testCase.want {
			t.Fatalf("VirtualSourceDetail(%v, %q) = %q; muốn %q", testCase.writable, testCase.policy, got, testCase.want)
		}
	}
}

func TestVirtualSourceDetailNeverPromisesRetainForOtherPolicies(t *testing.T) {
	// RETAIN là một lời hứa giữ giá trị qua mất điện. Hiện nó cho chính sách
	// khác là hứa thay thiết bị.
	for _, policy := range []string{"initial", "hold", "", "retained", "retain-ish"} {
		if got := VirtualSourceDetail(true, policy); got != "RW" {
			t.Fatalf("chính sách %q dựng ra %q", policy, got)
		}
	}
}

func TestModbusSourceDetailFormatsRegisterAndFunctionCode(t *testing.T) {
	if got := ModbusSourceDetail("HR", 102, true, 3); got != "HR 102 · FC03" {
		t.Fatalf("ModbusSourceDetail = %q", got)
	}
	if got := ModbusSourceDetail("CO", 0, true, 5); got != "CO 0 · FC05" {
		t.Fatalf("địa chỉ 0 bị coi là chưa biết: %q", got)
	}
}

func TestModbusSourceDetailDropsUnknownParts(t *testing.T) {
	if got := ModbusSourceDetail("HR", 102, false, 3); got != "HR · FC03" {
		t.Fatalf("địa chỉ chưa biết vẫn được in: %q", got)
	}
	if got := ModbusSourceDetail("", 102, true, 0); got != "" {
		t.Fatalf("vùng lạ + không có FC vẫn dựng chuỗi: %q", got)
	}
}

func TestModbusDisplayIDPadsAndRefusesUnassignedSlot(t *testing.T) {
	if got := ModbusDisplayID(14); got != "MB-014" {
		t.Fatalf("ModbusDisplayID(14) = %q", got)
	}
	for _, ext := range []int{0, -1} {
		if got := ModbusDisplayID(ext); got != "" {
			t.Fatalf("slot chưa cấp (%d) vẫn dựng định danh %q", ext, got)
		}
	}
}
