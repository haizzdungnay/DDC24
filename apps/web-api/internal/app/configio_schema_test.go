package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mkddc-web/internal/capabilities"
)

/* `ISS-PIO-27`: hình dạng `io_config.conf` nay do `internal/configschema` giữ,
 * và điều nó thật sự thêm vào là: khoá gõ sai KHÔNG còn đi lọt xuống đĩa rồi nằm
 * im tới lần `iobus` khởi động lại. */

/* `validateConfigPointMetadata` đòi ĐỦ bộ kênh kèm tag/name, nên mọi thân yêu
 * cầu hợp lệ phải đầy đủ. Hàm này dựng một bộ đầy đủ rồi cho phép ghi đè đúng
 * một hàng — để test nói về ĐÚNG cái nó muốn nói, không lẫn với lỗi metadata. */
func fullIOBody(uiOverride string) string {
	var ui, ao, do []string
	for channel := 1; channel <= capabilities.ABIUniversalInputs; channel++ {
		if channel == 1 && uiOverride != "" {
			ui = append(ui, uiOverride)
			continue
		}
		ui = append(ui, fmt.Sprintf(`{"ch":%d,"tag":"UI-%02d","name":"UI %02d","type":"none"}`, channel, channel, channel))
	}
	for channel := 1; channel <= capabilities.ABIAnalogOutputs; channel++ {
		ao = append(ao, fmt.Sprintf(`{"ch":%d,"tag":"AO-%02d","name":"AO %02d","mode":"0-10V"}`, channel, channel, channel))
	}
	for channel := 1; channel <= capabilities.ABIDigitalOutputs; channel++ {
		do = append(do, fmt.Sprintf(`{"ch":%d,"tag":"DO-%02d","name":"DO %02d"}`, channel, channel, channel))
	}
	return fmt.Sprintf(`{"ui":[%s],"ao":[%s],"do":[%s]}`, strings.Join(ui, ","), strings.Join(ao, ","), strings.Join(do, ","))
}

func putConfigIO(t *testing.T, core CoreStatusClient, body string) *httptest.ResponseRecorder {
	t.Helper()
	app, token := newTestAppWithRole(t, RoleAdmin, core)
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/io", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	return w
}

// Trước bản vá: `scale_high` được nhận, ghi xuống đĩa, và chỉ lộ khi `iobus`
// khởi động lại rồi lặng lẽ dùng giá trị mặc định.
func TestPutConfigIORejectsMisspelledKey(t *testing.T) {
	w := putConfigIO(t, fakeCore{}, fullIOBody(`{"ch":1,"tag":"UI-01","name":"UI 01","type":"0-10V","scale_high":100}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s; muốn 400", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "scale_high") {
		t.Fatalf("lỗi không chỉ vào khoá gõ sai: %s", w.Body.String())
	}
}

// Hai trường hiệu chuẩn mà `iobus_config.cpp` đọc thật nhưng validator Go trước
// đây không biết. Schema phải nhận chúng, nếu không thì chính bản vá này sẽ khoá
// mất cấu hình có hiệu chuẩn.
func TestPutConfigIOAcceptsFirmwareOnlyCalibrationFields(t *testing.T) {
	w := putConfigIO(t, fakeCore{}, fullIOBody(`{"ch":1,"tag":"UI-01","name":"UI 01","type":"0-10V","cal_gain":1.02,"cal_offset":-0.4}`))
	// Không khẳng định 200: bước cuối của đường ghi là gửi SIGHUP cho
	// `mkddc-iobus`/`mkddc-core`, hai tiến trình không tồn tại trong môi trường
	// test, nên nó đáp 409. Điều test này nói là VALIDATION đã cho qua — khẳng
	// định 200 sẽ biến nó thành test về vòng đời tiến trình.
	assertNotRejected(t, w)
}

// "Validate theo capability": bo nói rõ KHÔNG có khối AO ⇒ từ chối cấu hình AO,
// kèm lý do đọc được.
func TestPutConfigIORejectsBlockTheBoardSaysIsAbsent(t *testing.T) {
	core := boardCapCore{cap: capabilities.BoardCap{Map: capabilities.BoardCapUI16, Known: true}}
	w := putConfigIO(t, core, fullIOBody(""))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s; muốn 400", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "BOARD_CAP_MAP") {
		t.Fatalf("lỗi không nói ra vì sao bị từ chối: %s", w.Body.String())
	}
}

// ...và KHÔNG siết ở ca chưa hỏi được bo. Siết ở đó sẽ làm mọi bo đang không
// chạy `iobus` mất khả năng lưu lại chính cấu hình nó đang chạy.
func TestPutConfigIOKeepsABICeilingWhenBoardUnknown(t *testing.T) {
	w := putConfigIO(t, fakeCore{}, fullIOBody(""))
	assertNotRejected(t, w)
}

// Kênh vượt trần vẫn phải bị chặn, và thông báo giữ nguyên nguyên văn bản cũ để
// FE đang khớp chuỗi không gãy.
func TestPutConfigIOStillRejectsChannelOutOfRange(t *testing.T) {
	w := putConfigIO(t, fakeCore{}, fullIOBody(`{"ch":17,"tag":"UI-01","name":"UI 01","type":"0-10V"}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s; muốn 400", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "must be integer in range 1..16") {
		t.Fatalf("thông báo dải kênh đã đổi: %s", w.Body.String())
	}
}

// assertNotRejected khẳng định request KHÔNG bị validation từ chối. Xem giải
// thích ở `TestPutConfigIOAcceptsFirmwareOnlyCalibrationFields`.
func assertNotRejected(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if w.Code == http.StatusBadRequest {
		t.Fatalf("bị validation từ chối: %s", w.Body.String())
	}
}
