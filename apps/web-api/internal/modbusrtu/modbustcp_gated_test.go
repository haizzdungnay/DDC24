package modbusrtu

import (
	"os"
	"strings"
	"testing"
)

/* `ISS-PIO-30`/`F-PIO-024` — MODBUS TCP LÀ NĂNG LỰC ẨN CÓ CHỦ Ý (`ADR-055`).
 *
 * Issue này yêu cầu "một dòng trong hồ sơ". Một dòng trong hồ sơ chỉ giúp được
 * người ĐỌC hồ sơ đó; người sắp xoá `modbus_tcp.cpp` thường là người vừa grep
 * thấy "không ai gọi từ web/API". Ba test dưới đây biến lời khẳng định của
 * `ADR-055` thành thứ CI kiểm được, để hồ sơ và mã không thể lệch nhau trong im
 * lặng:
 *
 *   1. Mã vẫn còn và vẫn được biên dịch — hồ sơ không mô tả một tệp đã bị xoá.
 *   2. Chú thích cảnh báo vẫn nằm ngay tại chỗ mã.
 *   3. Modbus TCP vẫn THẬT SỰ ẩn — không route, không schema. Nếu ai đó mở tab
 *      mà quên cập nhật `ADR-055`, test này đỏ và bắt phải sửa hồ sơ.
 */

const (
	modbusTCPHeaderPath = "../../../../apps/iobus/adapters/modbus_rtu/modbus_tcp.hpp"
	modbusTCPSourcePath = "../../../../apps/iobus/adapters/modbus_rtu/modbus_tcp.cpp"
	iobusCMakePath      = "../../../../apps/iobus/CMakeLists.txt"
	openAPIPath         = "../../../../contracts/openapi/openapi.yaml"
)

func TestModbusTCPCodeStillExistsAndIsBuilt(t *testing.T) {
	for _, path := range []string{modbusTCPHeaderPath, modbusTCPSourcePath} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s không còn: `ADR-055` nói đây là năng lực ẩn có chủ ý cho Rev B."+
				" Nếu thật sự muốn bỏ, phải sửa `ADR-055` trước — không xoá im lặng (%v)", path, err)
		}
	}

	cmake, err := os.ReadFile(iobusCMakePath)
	if err != nil {
		t.Fatalf("không đọc được CMakeLists của iobus: %v", err)
	}
	/* Phải khớp ĐƯỜNG DẪN NGUỒN THƯ VIỆN, không phải chuỗi con "modbus_tcp.cpp".
	 *
	 * CMakeLists còn nhắc `tests/test_modbus_tcp.cpp`, và chuỗi con kia nằm gọn
	 * trong tên tệp test — nên một phép kiểm lỏng vẫn XANH sau khi ai đó gỡ
	 * đúng dòng nguồn thư viện. Chính phép tiêm lỗi đã bắt được điều đó. */
	if !strings.Contains(string(cmake), "adapters/modbus_rtu/modbus_tcp.cpp") {
		t.Fatal("modbus_tcp.cpp không còn được biên dịch — một tệp không build là mã chết THẬT," +
			" khác hẳn năng lực ẩn có chủ ý mà `ADR-055` mô tả")
	}
}

/* Chú thích phải nằm ngay tại chỗ mã. Hồ sơ ở `DECISIONS.md` chỉ giúp người đọc
 * hồ sơ; người sắp xoá tệp này đang nhìn vào chính tệp này. */
func TestModbusTCPHeaderCarriesTheGatedNotice(t *testing.T) {
	header, err := os.ReadFile(modbusTCPHeaderPath)
	if err != nil {
		t.Fatalf("không đọc được modbus_tcp.hpp: %v", err)
	}
	text := string(header)
	for _, marker := range []string{"ADR-055", "ISS-PIO-30", "KHÔNG PHẢI MÃ CHẾT"} {
		if !strings.Contains(text, marker) {
			t.Fatalf("modbus_tcp.hpp thiếu dấu %q — người grep tệp này sẽ lại kết luận nó là mã chết", marker)
		}
	}
}

/* Lời khẳng định "ẩn" phải còn ĐÚNG. Đề bài §19: *"Nếu Rev A hiện chưa hỗ trợ
 * Modbus TCP thì không hiện tab này"*. Mở route/schema mà quên cập nhật
 * `ADR-055` sẽ để hồ sơ nói một đằng, sản phẩm làm một nẻo. */
func TestModbusTCPHasNoRouteOrSchema(t *testing.T) {
	spec, err := os.ReadFile(openAPIPath)
	if err != nil {
		t.Fatalf("không đọc được openapi.yaml: %v", err)
	}
	lower := strings.ToLower(string(spec))
	for _, forbidden := range []string{"modbus/tcp", "modbus-tcp", "modbustcp", "modbus_tcp"} {
		if strings.Contains(lower, forbidden) {
			t.Fatalf("openapi.yaml đã có %q: Modbus TCP không còn ẩn."+
				" Mở tab là quyết định sản phẩm Rev B — cập nhật `ADR-055` cùng lúc, đừng để hồ sơ lệch mã",
				forbidden)
		}
	}
}
