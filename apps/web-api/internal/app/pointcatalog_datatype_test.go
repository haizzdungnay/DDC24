package app

import "testing"

/* `ISS-PIO-06`/`F-PIO-005` — `dataType` lấy từ CẤU HÌNH, không suy từ giá trị
 * runtime. Mỗi test dưới đây khoá đúng một trong ba hệ quả mà issue nêu. */

// Hệ quả (1): kênh tiếp điểm khô CHƯA CÓ MẪU từng bị khai là `REAL`, nên bind
// vào `VAR_INPUT : BOOL` báo "Kiểu dữ liệu không khớp" — rồi TỰ HẾT SAI khi
// điểm có mẫu. Một lỗi nhấp nháy theo trạng thái hiện trường.
func TestUniversalInputDryContactIsBoolEvenWithoutASample(t *testing.T) {
	withoutSample := PointDTO{Kind: "UI", SignalType: "dry"}
	if got := pointCatalogDataType(withoutSample); got != "BOOL" {
		t.Fatalf("UI tiếp điểm khô chưa có mẫu = %q; chờ BOOL", got)
	}
	// ...và câu trả lời KHÔNG đổi khi có mẫu. Đó là điều làm lỗi hết nhấp nháy.
	withSample := PointDTO{Kind: "UI", SignalType: "dry", Value: float64(1)}
	if got := pointCatalogDataType(withSample); got != "BOOL" {
		t.Fatalf("UI tiếp điểm khô khi có mẫu = %q; chờ BOOL — kiểu không được đổi theo dữ liệu runtime", got)
	}
}

func TestUniversalInputAnalogStaysReal(t *testing.T) {
	for _, signalType := range []string{"0-10V", "4-20mA", "PT100", "NTC10k", "none"} {
		if got := pointCatalogDataType(PointDTO{Kind: "UI", SignalType: signalType}); got != "REAL" {
			t.Fatalf("UI %s = %q; chờ REAL", signalType, got)
		}
	}
}

// Hệ quả (2): `MSV` không bao giờ ra `UINT`, trong khi FE khai
// `PREFIX_TYPE.MSV = 'UINT'` — nhánh Multistate vì thế không có đường chạy.
func TestVirtualPointDataTypeFollowsBoundSlot(t *testing.T) {
	cases := map[string]string{"BV-01": "BOOL", "MSV-01": "UINT", "AV-01": "REAL"}
	for slot, want := range cases {
		got := pointCatalogDataType(PointDTO{Kind: "virtual", BoundPointID: slot, SignalType: "float"})
		if got != want {
			t.Fatalf("VP bind %s = %q; chờ %q", slot, got, want)
		}
	}
}

// VP chưa bind thì đọc `signalType` — vẫn là cấu hình, không phải giá trị.
func TestVirtualPointDataTypeFollowsSignalTypeWhenUnbound(t *testing.T) {
	cases := map[string]string{"boolean": "BOOL", "integer": "DINT", "float": "REAL", "string": "REAL"}
	for signalType, want := range cases {
		got := pointCatalogDataType(PointDTO{Kind: "virtual", SignalType: signalType})
		if got != want {
			t.Fatalf("VP signalType=%s ⇒ %q; chờ %q", signalType, got, want)
		}
	}
}

// Hệ quả (3): điểm Modbus `int32`/`uint32`/`float32` bị gộp hết về `REAL`, mất
// cả dải lẫn dấu — thông tin mà chính người dùng đã nhập vào `fieldbus.conf`.
func TestModbusDataTypeKeepsWidthAndSign(t *testing.T) {
	cases := map[string]string{
		"bool": "BOOL", "int16": "INT", "uint16": "UINT",
		"int32": "DINT", "uint32": "UDINT", "float32": "REAL",
	}
	for dataType, want := range cases {
		got := pointCatalogDataType(PointDTO{Kind: "modbus_rtu", DataType: dataType})
		if got != want {
			t.Fatalf("Modbus data_type=%s ⇒ %q; chờ %q", dataType, got, want)
		}
	}
}

/* Bất biến bao trùm cả ba hệ quả: với CÙNG một cấu hình, giá trị runtime KHÔNG
 * được đổi câu trả lời. Đây là thứ khiến lỗi hết nhấp nháy — và là thứ dễ mất
 * nhất trong một lần "tối ưu" sau này. */
func TestDataTypeNeverDependsOnRuntimeValue(t *testing.T) {
	samples := []any{nil, true, false, float64(0), float64(12.5), "x"}
	fixtures := []PointDTO{
		{Kind: "UI", SignalType: "dry"},
		{Kind: "UI", SignalType: "0-10V"},
		{Kind: "AO"},
		{Kind: "DO"},
		{Kind: "virtual", SignalType: "integer"},
		{Kind: "modbus_rtu", DataType: "uint16"},
	}
	for _, fixture := range fixtures {
		baseline := pointCatalogDataType(fixture)
		for _, sample := range samples {
			probe := fixture
			probe.Value = sample
			if got := pointCatalogDataType(probe); got != baseline {
				t.Fatalf("kiểu của %s/%s đổi theo giá trị runtime %#v: %q ≠ %q",
					fixture.Kind, fixture.SignalType+fixture.DataType, sample, got, baseline)
			}
		}
	}
}
