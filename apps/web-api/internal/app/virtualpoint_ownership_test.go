package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

/* ISS-PIO-16 — quyền sở hữu VP (WEB / PROGRAM) phải nhìn thấy được (F-PIO-017).
 *
 * Backend đã tách đúng hai trục `writable` / `source` từ trước, nhưng trục thứ
 * hai không tồn tại ở bề mặt sản phẩm: không có trong type frontend, không có ô
 * đặt, không nhãn nào hiện. Người kỹ sư thấy một VP "chỉ đọc" mà không manh mối.
 */

func seedProgramVP(t *testing.T, app *App) string {
	t.Helper()
	return seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"fan-cmd","signalType":"float","enabled":true,"writable":true,"value":1,"boundPointId":"AV-1","source":"PROGRAM"}]}`)
}

/* Lệnh ghi vào VP do chương trình sở hữu bị TỪ CHỐI.
 *
 * Trước bản vá lệnh đi trọn: cấu hình được ghi, HTTP trả 200. Nhưng
 * `syncVirtualPointToCore` cố ý không đẩy xuống slot do chương trình sở hữu, và
 * đường đọc overlay thẳng từ slot Core — nên giá trị trên màn hình không bao giờ
 * đổi. Người vận hành bấm Write, thấy thành công, thiết bị không nhúc nhích. */
func TestWriteToProgramOwnedVirtualPointIsRejected(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := seedProgramVP(t, app)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":5}`, token)
	if resp.Code == http.StatusOK {
		t.Fatalf("lệnh ghi vào VP do chương trình sở hữu được CHẤP NHẬN (200) — im lặng không có tác dụng gì; body=%s", resp.Body.String())
	}
	if resp.Code != http.StatusConflict {
		t.Fatalf("status = %d; muốn 409 — xung đột trạng thái (điểm thuộc chương trình đang chạy), không phải lỗi cú pháp; body=%s", resp.Code, resp.Body.String())
	}

	// Cấu hình phải CÒN NGUYÊN: một lệnh bị từ chối không để lại dấu vết.
	cfg := readVPConfig(t, path)
	if got, _ := virtualPointFloat(cfg.Items[0].Value); got != 1 {
		t.Fatalf("value = %v; lệnh bị từ chối mà vẫn ghi vào cấu hình", cfg.Items[0].Value)
	}
}

/* Thông báo phải NÓI RÕ ai sở hữu và làm gì để gỡ.
 *
 * Đây là toàn bộ nội dung khiếu nại của F-PIO-017: người kỹ sư không hiểu VÌ SAO
 * một VP lại chỉ đọc. Một câu "forbidden" trả lời đúng câu hỏi sai. */
func TestProgramOwnedRejectionExplainsWhyAndHowToFix(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedProgramVP(t, app)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":5}`, token)
	body := resp.Body.String()
	// `AV-01`, không phải `AV-1`: `canonicalBoundPointID` chuẩn hoá về dạng có
	// số 0 đệm, và thông báo phải in đúng thứ người dùng thấy trong cấu hình.
	for _, want := range []string{"PROGRAM", "AV-01", "WEB"} {
		if !strings.Contains(body, want) {
			t.Fatalf("thông báo thiếu %q nên không nói được ai sở hữu hoặc cách lấy lại quyền ghi: %s", want, body)
		}
	}
}

// VP do WEB sở hữu vẫn ghi bình thường — phép chặn không được bắt nhầm.
func TestWriteToWebOwnedVirtualPointStillWorks(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1,"boundPointId":"AV-1","source":"WEB"}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":5}`, token)
	assertStatus(t, resp, http.StatusOK)
}

// Không khai `source` = hành vi cũ (WEB), ghi được như trước.
func TestLegacyConfigWithoutSourceIsWebOwned(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":5}`, token)
	assertStatus(t, resp, http.StatusOK)
}

/* `writable`/`readWrite` trong PointDTO phải nói SỰ THẬT VẬN HÀNH.
 *
 * Một VP `writable: true` do chương trình sở hữu từ chối mọi lệnh ghi. Báo
 * `read_write` cho nó là sinh ra một nút Write bấm vào không có gì xảy ra. */
func TestProgramOwnedVirtualPointReportsNotWritable(t *testing.T) {
	item := VirtualPoint{ID: "VP1", Tag: "fan", SignalType: virtualPointSignalFloat,
		Enabled: true, Writable: true, BoundPointID: "AV-1", Source: virtualPointSourceProgram}
	dto := virtualPointDTO(item)
	if dto.Writable {
		t.Fatal("writable = true cho điểm mà mọi lệnh ghi đều bị từ chối")
	}
	if dto.ReadWrite != "read" {
		t.Fatalf("readWrite = %q; muốn read", dto.ReadWrite)
	}
	// Nhưng quyền sở hữu vẫn phải phơi ra, nếu không giao diện không giải thích được.
	if dto.VirtualSource != virtualPointSourceProgram {
		t.Fatalf("virtualSource = %q; muốn PROGRAM", dto.VirtualSource)
	}
}

// VP do WEB sở hữu giữ nguyên `writable` của cấu hình — hai trục vẫn tách.
func TestWebOwnedVirtualPointKeepsConfiguredWritable(t *testing.T) {
	writable := virtualPointDTO(VirtualPoint{ID: "VP1", Tag: "sp", SignalType: virtualPointSignalFloat, Enabled: true, Writable: true})
	if !writable.Writable || writable.ReadWrite != "read_write" {
		t.Fatalf("VP do WEB sở hữu phải ghi được: %+v", writable)
	}
	readonly := virtualPointDTO(VirtualPoint{ID: "VP2", Tag: "ro", SignalType: virtualPointSignalFloat, Enabled: true, Writable: false})
	if readonly.Writable {
		t.Fatal("cờ writable=false của cấu hình bị bỏ qua")
	}
}

/* `source` được chuẩn hoá và LUÔN có mặt khi đọc.
 *
 * Giao diện không được phải tự đoán nghĩa của chuỗi rỗng: "chưa khai" và "web-api
 * sở hữu" là một, nhưng chỉ backend biết điều đó. */
func TestVirtualPointSourceIsNormalizedOnRead(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1},{"id":"VP2","tag":"cmd","signalType":"float","enabled":true,"writable":true,"value":1,"boundPointId":"AV-2","source":"program"}]}`)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/virtual-points", "", token)
	assertStatus(t, resp, http.StatusOK)
	var items []VirtualPoint
	if err := json.Unmarshal(resp.Body.Bytes(), &items); err != nil {
		t.Fatalf("giải mã: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items = %d; muốn 2", len(items))
	}
	if items[0].Source != virtualPointSourceWeb {
		t.Fatalf("VP không khai source đọc thành %q; muốn WEB", items[0].Source)
	}
	if items[1].Source != virtualPointSourceProgram {
		t.Fatalf("source \"program\" viết thường đọc thành %q; muốn PROGRAM", items[1].Source)
	}
}

/* Giá trị LẠ ở `source` bị TỪ CHỐI ở đường ghi API.
 *
 * Kiểm trên giá trị THÔ: `normalizeVirtualPointSource` cố ý hiểu giá trị lạ
 * thành `WEB` để tệp cũ trên đĩa vẫn đọc được. Nếu validator cũng kiểm bản đã
 * chuẩn hoá thì người gõ nhầm `PROGRM` sẽ nhận một điểm lặng lẽ do web-api sở
 * hữu — tức web-api đè lên chính chương trình mà họ định trao quyền. */
func TestVirtualPointRejectsUnknownSource(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1,"boundPointId":"AV-3","source":"PROGRM"}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400 — source gõ sai phải kêu, không được lặng lẽ hoá WEB; body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "source") {
		t.Fatalf("lỗi không chỉ ra trường sai: %s", resp.Body.String())
	}
}

// `PROGRAM` mà chưa bind slot nào thì vô nghĩa — vẫn phải bị chặn (hành vi cũ).
func TestProgramSourceRequiresBoundPoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1,"source":"PROGRAM"}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400; body=%s", resp.Code, resp.Body.String())
	}
}

func TestNormalizeVirtualPointSourceCoversCasing(t *testing.T) {
	for _, raw := range []string{"PROGRAM", "program", " Program "} {
		if got := normalizeVirtualPointSource(raw); got != virtualPointSourceProgram {
			t.Fatalf("normalizeVirtualPointSource(%q) = %q", raw, got)
		}
	}
	for _, raw := range []string{"", "WEB", "web", "gì đó lạ"} {
		if got := normalizeVirtualPointSource(raw); got != virtualPointSourceWeb {
			t.Fatalf("normalizeVirtualPointSource(%q) = %q; muốn WEB", raw, got)
		}
	}
}
