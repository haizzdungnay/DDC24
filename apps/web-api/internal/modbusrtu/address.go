package modbusrtu

/* ISS-PIO-21 — quy ước địa chỉ Modbus: offset protocol ↔ tham chiếu vendor 4xxxx
 * (F-PIO-020, đề bài §23).
 *
 * TRIỆU CHỨNG: người dùng cầm datasheet ghi `40102` phải TỰ TRỪ để gõ `101`, và
 * không có ô nào ghi lại họ đã hiểu theo quy ước nào. Ô nhập trên giao diện còn
 * ghi thẳng lời nhắc "nhiều tài liệu đánh số từ 1 — trừ đi 1 khi nhập", tức sản
 * phẩm biết vấn đề tồn tại và giao nó cho người dùng làm bằng tay.
 *
 * VÌ SAO ĐỀ BÀI GỌI ĐÂY LÀ CHỖ "PHẢI XỬ LÝ CỰC KỲ CẨN THẬN": sai một đơn vị ở
 * đây KHÔNG làm gì hỏng ồn ào cả. Điểm vẫn đọc, quality vẫn GOOD, đồ thị vẫn
 * chạy — chỉ là nó đang đọc thanh ghi bên cạnh. Một nhiệt độ gió cấp hoá ra là
 * nhiệt độ gió hồi, và không có dấu hiệu nào ngoài "số trông hơi lạ".
 *
 * QUY ƯỚC:
 *   - `protocol` — offset 0-based đi thẳng trong khung Modbus. Đây là dạng
 *     LUÔN được lưu, để không phải suy diễn lại mỗi lần đọc cấu hình.
 *   - `vendor`   — cách đánh số trong tài liệu thiết bị: 0xxxx/1xxxx/3xxxx/4xxxx,
 *     1-based, tiền tố theo vùng dữ liệu.
 *
 * Trường `address_convention` KHÔNG đổi cách lưu; nó ghi lại NGƯỜI DÙNG ĐANG
 * NGHĨ theo quy ước nào, để lần mở sau màn hình nói lại đúng con số họ đã gõ.
 * Thiếu nó thì mỗi lần mở lại là một lần tự dịch trong đầu, và mỗi lần dịch là
 * một cơ hội sai một đơn vị.
 */

const (
	// AddressConventionProtocol — offset 0-based, mặc định và là hành vi cũ.
	AddressConventionProtocol = "protocol"
	// AddressConventionVendor — tham chiếu 1-based có tiền tố vùng (4xxxx…).
	AddressConventionVendor = "vendor"
)

// AddressConventions là tập hợp lệ, dùng chung cho validate, hợp đồng và giao diện.
var AddressConventions = []string{AddressConventionProtocol, AddressConventionVendor}

/* vendorBases — số đầu của mỗi vùng dữ liệu theo cách đánh số của tài liệu.
 *
 * Đây là quy ước Modbus cổ điển, không phải lựa chọn của sản phẩm này: vùng
 * Coil bắt đầu ở 1, Discrete Input ở 10001, Input Register ở 30001, Holding
 * Register ở 40001. `40102` trong datasheet vì thế là offset protocol 101.
 */
var vendorBases = map[string]int{
	"coil":             1,
	"discrete_input":   10001,
	"input_register":   30001,
	"holding_register": 40001,
}

// maxProtocolAddress — offset lớn nhất một khung Modbus chở được.
const maxProtocolAddress = 65535

// VendorBase trả số đầu vùng dữ liệu; `false` khi kiểu thanh ghi không hợp lệ.
func VendorBase(registerType string) (int, bool) {
	base, ok := vendorBases[registerType]
	return base, ok
}

/* vendorRange trả số đầu và offset LỚN NHẤT còn thuộc về vùng đó.
 *
 * Vì sao không dùng chung 0..65535 cho mọi vùng: `40102` là số của vùng Holding
 * Register, không lẫn vào đâu được. Nếu Input Register (số đầu 30001) cũng nhận
 * nó thì phép trừ cho ra offset 10101 — một offset HỢP LỆ, trỏ vào chỗ hoàn
 * toàn khác, và không có gì báo. Đó đúng là lớp lỗi mà `ISS-PIO-21` sinh ra để
 * dẹp, nên trần của mỗi vùng phải dừng ngay dưới số đầu của vùng kế tiếp.
 *
 * Vùng cao nhất (Holding) không có vùng nào ở trên nên trần của nó là giới hạn
 * của chính khung Modbus — đủ chỗ cho cách viết 6 chữ số (`400001`) mà nhiều
 * thiết bị đời mới dùng.
 */
func vendorRange(registerType string) (base int, maxOffset int, ok bool) {
	base, ok = VendorBase(registerType)
	if !ok {
		return 0, 0, false
	}
	maxOffset = maxProtocolAddress
	for _, other := range vendorBases {
		if other <= base {
			continue
		}
		if span := other - base - 1; span < maxOffset {
			maxOffset = span
		}
	}
	return base, maxOffset, true
}

/* VendorReference đổi offset protocol sang số như trong tài liệu thiết bị.
 *
 * `false` khi kiểu thanh ghi lạ hoặc offset ngoài dải — KHÔNG trả một con số
 * "gần đúng": một tham chiếu vendor sai hiện cạnh ô nhập là chính xác thứ dẫn
 * người dùng gõ nhầm thanh ghi.
 */
func VendorReference(registerType string, protocolAddress int) (int, bool) {
	base, maxOffset, ok := vendorRange(registerType)
	if !ok || protocolAddress < 0 || protocolAddress > maxOffset {
		return 0, false
	}
	return base + protocolAddress, true
}

/* ProtocolAddress đổi số trong tài liệu thiết bị về offset protocol.
 *
 * `false` khi số nằm ngoài vùng của chính kiểu thanh ghi đó. Đây là phép kiểm
 * đáng giá nhất của cả tệp này: gõ `40102` trong khi đã chọn Input Register là
 * một mâu thuẫn có thật, và im lặng nhận nó sẽ cho ra offset âm hoặc một offset
 * hợp lệ nhưng trỏ vào chỗ khác.
 */
func ProtocolAddress(registerType string, vendorReference int) (int, bool) {
	base, maxOffset, ok := vendorRange(registerType)
	if !ok {
		return 0, false
	}
	offset := vendorReference - base
	if offset < 0 || offset > maxOffset {
		return 0, false
	}
	return offset, true
}

// ValidAddressConvention kiểm giá trị thô ở đường ghi API.
func ValidAddressConvention(value string) bool {
	for _, allowed := range AddressConventions {
		if value == allowed {
			return true
		}
	}
	return false
}

// NormalizeAddressConvention chuẩn hoá về một trong hai giá trị.
//
// Rỗng ⇒ `protocol`: đó là cách mọi cấu hình đang chạy đã được nhập, và một tệp
// cũ không được bỗng dưng đổi nghĩa con số nó đang mang.
func NormalizeAddressConvention(value string) string {
	if value == AddressConventionVendor {
		return AddressConventionVendor
	}
	return AddressConventionProtocol
}
