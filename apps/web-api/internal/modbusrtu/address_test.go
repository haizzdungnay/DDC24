package modbusrtu

import "testing"

/* ISS-PIO-21 — quy ước địa chỉ Modbus (F-PIO-020, đề bài §23).
 *
 * Người dùng cầm datasheet ghi `40102` phải tự trừ để gõ `101`. Sai một đơn vị
 * ở đây KHÔNG làm gì hỏng ồn ào: điểm vẫn đọc, quality vẫn GOOD, đồ thị vẫn
 * chạy — chỉ là nó đang đọc thanh ghi bên cạnh.
 */

// Đúng ví dụ trong issue: `40102` trên datasheet là offset protocol 101.
func TestDatasheetHoldingRegisterMapsToProtocolOffset(t *testing.T) {
	got, ok := ProtocolAddress("holding_register", 40102)
	if !ok || got != 101 {
		t.Fatalf("ProtocolAddress(holding, 40102) = (%d,%v); muốn (101,true)", got, ok)
	}
	back, ok := VendorReference("holding_register", 101)
	if !ok || back != 40102 {
		t.Fatalf("VendorReference(holding, 101) = (%d,%v); muốn (40102,true)", back, ok)
	}
}

// Bốn vùng dữ liệu, bốn số đầu — quy ước Modbus cổ điển, không phải lựa chọn
// của sản phẩm này.
func TestVendorBasesCoverEveryRegisterType(t *testing.T) {
	for registerType, want := range map[string]int{
		"coil": 1, "discrete_input": 10001, "input_register": 30001, "holding_register": 40001,
	} {
		base, ok := VendorBase(registerType)
		if !ok || base != want {
			t.Fatalf("VendorBase(%s) = (%d,%v); muốn (%d,true)", registerType, base, ok, want)
		}
		// Offset 0 luôn là chính số đầu vùng.
		if ref, ok := VendorReference(registerType, 0); !ok || ref != want {
			t.Fatalf("VendorReference(%s, 0) = (%d,%v); muốn (%d,true)", registerType, ref, ok, want)
		}
	}
}

/* Số vendor nằm ngoài vùng của CHÍNH kiểu thanh ghi đó bị từ chối.
 *
 * Đây là phép kiểm đáng giá nhất: gõ `40102` trong khi đã chọn Input Register
 * là một mâu thuẫn có thật. Im lặng nhận nó sẽ cho ra offset 10101 — một offset
 * hợp lệ, trỏ vào chỗ hoàn toàn khác, và không có gì báo. */
func TestProtocolAddressRejectsReferenceFromAnotherArea(t *testing.T) {
	if _, ok := ProtocolAddress("input_register", 40102); ok {
		t.Fatal("số 4xxxx được nhận cho Input Register — sẽ trỏ vào thanh ghi khác trong im lặng")
	}
	if _, ok := ProtocolAddress("coil", 40102); ok {
		t.Fatal("số 4xxxx được nhận cho Coil")
	}
	// Dưới số đầu vùng cũng sai.
	if _, ok := ProtocolAddress("holding_register", 40000); ok {
		t.Fatal("số dưới số đầu vùng vẫn được nhận")
	}
}

// Kiểu thanh ghi lạ KHÔNG được suy ra một con số gần đúng.
func TestUnknownRegisterTypeYieldsNoReference(t *testing.T) {
	if _, ok := VendorReference("gi-do-la", 100); ok {
		t.Fatal("kiểu thanh ghi lạ vẫn suy ra tham chiếu vendor")
	}
	if _, ok := ProtocolAddress("gi-do-la", 40102); ok {
		t.Fatal("kiểu thanh ghi lạ vẫn suy ra offset protocol")
	}
	if _, ok := VendorBase(""); ok {
		t.Fatal("kiểu rỗng vẫn có số đầu vùng")
	}
}

// Offset ngoài dải khung Modbus không có tham chiếu vendor.
func TestVendorReferenceRejectsOutOfRangeOffset(t *testing.T) {
	for _, offset := range []int{-1, 65536} {
		if _, ok := VendorReference("holding_register", offset); ok {
			t.Fatalf("offset %d vẫn suy ra tham chiếu vendor", offset)
		}
	}
	if _, ok := VendorReference("holding_register", 65535); !ok {
		t.Fatal("offset 65535 là hợp lệ mà bị từ chối")
	}
}

/* Đổi qua đổi lại phải về đúng chỗ cũ.
 *
 * Một phép đổi mất mát ở đây nghĩa là mở lại cấu hình sẽ hiện một con số khác
 * con số người dùng đã gõ — và họ sẽ "sửa" nó. */
func TestConversionsRoundTrip(t *testing.T) {
	// Mỗi vùng có TRẦN RIÊNG, dừng ngay dưới số đầu vùng kế tiếp — đó là sự
	// thật của cách đánh số này, không phải một giới hạn tự đặt ra.
	for registerType, maxOffset := range map[string]int{
		"coil": 9999, "discrete_input": 19999, "input_register": 9999, "holding_register": 65535,
	} {
		for _, offset := range []int{0, 1, 101, maxOffset} {
			reference, ok := VendorReference(registerType, offset)
			if !ok {
				t.Fatalf("VendorReference(%s,%d) thất bại", registerType, offset)
			}
			back, ok := ProtocolAddress(registerType, reference)
			if !ok || back != offset {
				t.Fatalf("%s: %d -> %d -> (%d,%v)", registerType, offset, reference, back, ok)
			}
		}
	}
}

// Rỗng nghĩa là `protocol` — mọi cấu hình đang chạy đã được nhập như vậy.
func TestNormalizeAddressConventionDefaultsToProtocol(t *testing.T) {
	for _, raw := range []string{"", "protocol", "gi-do-la"} {
		if got := NormalizeAddressConvention(raw); got != AddressConventionProtocol {
			t.Fatalf("NormalizeAddressConvention(%q) = %q", raw, got)
		}
	}
	if got := NormalizeAddressConvention("vendor"); got != AddressConventionVendor {
		t.Fatalf("got %q", got)
	}
}

/* `NormalizePoint` chỉ hạ chữ, KHÔNG ép giá trị lạ về mặc định.
 *
 * Ép êm sẽ nuốt mất lỗi gõ nhầm: người dùng chọn `vendor`, gõ sai một ký tự, và
 * nhận về một điểm lặng lẽ hiểu con số của họ theo quy ước khác. */
func TestNormalizePointDoesNotSwallowBadConvention(t *testing.T) {
	got := NormalizePoint(Point{AddressConvention: "  VENDR "})
	if got.AddressConvention != "vendr" {
		t.Fatalf("AddressConvention = %q; phải giữ nguyên giá trị lạ để validate từ chối", got.AddressConvention)
	}
	if NormalizePoint(Point{AddressConvention: " VENDOR "}).AddressConvention != AddressConventionVendor {
		t.Fatal("giá trị hợp lệ viết hoa/thừa khoảng trắng phải chuẩn hoá được")
	}
}

/* Trần của mỗi vùng dừng ngay DƯỚI số đầu vùng kế tiếp.
 *
 * Không phải một giới hạn tự đặt ra: một số ở hoặc trên số đầu vùng kế tiếp
 * thuộc về vùng đó, không lẫn vào đâu được. Nhận nó ở vùng dưới sẽ cho ra một
 * offset hợp lệ nhưng trỏ vào chỗ khác. */
func TestEachAreaStopsBelowTheNextArea(t *testing.T) {
	for registerType, want := range map[string]int{
		"coil": 9999, "discrete_input": 19999, "input_register": 9999, "holding_register": 65535,
	} {
		if _, ok := VendorReference(registerType, want); !ok {
			t.Fatalf("%s: offset trần %d bị từ chối", registerType, want)
		}
		if _, ok := VendorReference(registerType, want+1); ok {
			t.Fatalf("%s: offset %d vượt trần vẫn được nhận", registerType, want+1)
		}
	}
}

/* Vùng cao nhất (Holding) đủ chỗ cho cách viết 6 chữ số.
 *
 * `400001` là cách nhiều thiết bị đời mới đánh số. Cắt Holding ở 5 chữ số sẽ
 * loại đúng những thiết bị có nhiều thanh ghi nhất. */
func TestHoldingRegisterSupportsSixDigitNotation(t *testing.T) {
	got, ok := ProtocolAddress("holding_register", 40001+65535)
	if !ok || got != 65535 {
		t.Fatalf("ProtocolAddress(holding, 105536) = (%d,%v); muốn (65535,true)", got, ok)
	}
}
