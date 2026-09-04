package modbusrtu

/* ISS-PIO-09 — ký hiệu vùng thanh ghi và mã hàm cho hiển thị.
 *
 * `ReadFunctionCode` là NGUỒN SỰ THẬT DUY NHẤT cho ánh xạ `register_type` → FC,
 * và `BuildProfile` gọi chính nó khi ghi `fieldbus.conf`. Trước đây bảng này
 * nằm inline trong `BuildProfile`; giữ nguyên như thế rồi chép một bảng thứ hai
 * cho giao diện là cách chắc chắn nhất để màn hình nói FC03 trong khi dây nói
 * FC04 — và không cổng nào bắt được vì hai bảng không bao giờ gặp nhau.
 */

// readFunctionCodes ánh xạ vùng thanh ghi sang mã hàm ĐỌC. Vắng mặt = vùng lạ.
var readFunctionCodes = map[string]int{
	"coil": 1, "discrete_input": 2, "holding_register": 3, "input_register": 4,
}

// writeFunctionCodes ánh xạ vùng thanh ghi sang mã hàm GHI MỘT giá trị. Chỉ
// `coil` và `holding_register` ghi được — hai vùng còn lại là read-only theo
// chính đặc tả Modbus, nên vắng mặt ở đây là sự thật chứ không phải thiếu sót.
var writeFunctionCodes = map[string]int{"coil": 5, "holding_register": 6}

// registerAbbreviations là ký hiệu ngắn quen thuộc với người vận hành.
var registerAbbreviations = map[string]string{
	"coil": "CO", "discrete_input": "DI", "holding_register": "HR", "input_register": "IR",
}

// ReadFunctionCode trả mã hàm đọc của một vùng thanh ghi; `ok=false` khi vùng
// không nằm trong bốn vùng chuẩn.
func ReadFunctionCode(registerType string) (code int, ok bool) {
	code, ok = readFunctionCodes[registerType]
	return code, ok
}

// WriteFunctionCode trả mã hàm ghi một giá trị; `ok=false` với vùng chỉ đọc.
func WriteFunctionCode(registerType string) (code int, ok bool) {
	code, ok = writeFunctionCodes[registerType]
	return code, ok
}

// RegisterAbbreviation trả ký hiệu ngắn (`HR`, `IR`, `CO`, `DI`). Vùng lạ trả
// về chuỗi rỗng: bịa một ký hiệu cho vùng không hiểu được là nói dối người đọc.
func RegisterAbbreviation(registerType string) string {
	return registerAbbreviations[registerType]
}
