package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

/* ISS-PIO-15 — biên kỹ thuật cho VP (F-PIO-016).
 *
 * Trước bản vá, `displayMin`/`displayMax` là thang HIỂN THỊ và không có đường
 * nào từ chối một lệnh ghi 45 °C vào setpoint khai dải 16–30 °C. Điểm Modbus
 * cùng hệ đã có `min_value`/`max_value` đúng nghĩa — hai nguồn Point, hai mức
 * nghiêm ngặt.
 */

// seedLimitedVP gieo một VP số có biên kỹ thuật và trả ETag hiện hành để lệnh
// ghi tiếp theo qua được phép kiểm `If-Match` của `ISS-PIO-37`.
func seedLimitedVP(t *testing.T, app *App, body string) {
	t.Helper()
	seedVPConfig(t, app, body)
}

/* Lệnh ghi NGOÀI dải bị TỪ CHỐI, và từ chối bằng 400 chứ không 409.
 *
 * 409 nói "thiết bị đang ở trạng thái xung đột, đi xem đi"; ở đây việc phải làm
 * chỉ là gõ lại một con số, nên mã trạng thái phải nói đúng điều đó. */
func TestForcePointRejectsValueAboveMaxValue(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedLimitedVP(t, app, `{"items":[{"id":"VP1","tag":"sat-setpoint","signalType":"float","enabled":true,"writable":true,"value":22,"unit":"degC","minValue":16,"maxValue":30}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":45}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400 — ghi 45 vào điểm khai dải 16..30 phải bị từ chối; body=%s", resp.Code, resp.Body.String())
	}
	body := resp.Body.String()
	if !strings.Contains(body, "16") || !strings.Contains(body, "30") {
		t.Fatalf("thông báo không nói dải hợp lệ nên người vận hành không biết gõ lại số nào: %s", body)
	}

	// Và giá trị cũ phải CÒN NGUYÊN: một lệnh bị từ chối không được để lại dấu vết.
	cfg := readVPConfig(t, app.configPath(configGroupVirtualPoints.file))
	if got, _ := virtualPointFloat(cfg.Items[0].Value); got != 22 {
		t.Fatalf("value = %v; lệnh bị từ chối mà vẫn ghi vào cấu hình", cfg.Items[0].Value)
	}
}

// Dưới `minValue` cũng bị chặn — không chỉ vế trên.
func TestForcePointRejectsValueBelowMinValue(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedLimitedVP(t, app, `{"items":[{"id":"VP1","tag":"sat-setpoint","signalType":"float","enabled":true,"writable":true,"value":22,"unit":"degC","minValue":16,"maxValue":30}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":5}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400; body=%s", resp.Code, resp.Body.String())
	}
}

/* KHÔNG KẸP: giá trị trong dải đi qua nguyên vẹn, giá trị ngoài dải bị từ chối.
 *
 * Bài kiểm này bắt đúng cách sửa sai phổ biến nhất — clamp về biên rồi trả 200.
 * Khi đó lệnh "ghi 45" thành "ghi 30" và người vận hành không hề biết. */
func TestForcePointNeverClampsOutOfRangeValue(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sat-setpoint","signalType":"float","enabled":true,"writable":true,"value":22,"unit":"degC","minValue":16,"maxValue":30}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":45}`, token)
	if resp.Code == http.StatusOK {
		t.Fatalf("lệnh ngoài dải được CHẤP NHẬN (status 200) — body=%s", resp.Body.String())
	}
	cfg := readVPConfig(t, path)
	got, _ := virtualPointFloat(cfg.Items[0].Value)
	if got == 30 {
		t.Fatal("giá trị bị KẸP về biên trên (30): lệnh ghi đã bị đổi nghĩa im lặng thay vì bị từ chối")
	}
	if got != 22 {
		t.Fatalf("value = %v; muốn giữ nguyên 22", cfg.Items[0].Value)
	}
}

// Giá trị TRONG dải vẫn ghi bình thường — phép kiểm không được chặn nhầm.
func TestForcePointAcceptsValueInsideRange(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sat-setpoint","signalType":"float","enabled":true,"writable":true,"value":22,"unit":"degC","minValue":16,"maxValue":30}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":24.5}`, token)
	assertStatus(t, resp, http.StatusOK)
	cfg := readVPConfig(t, path)
	if got, _ := virtualPointFloat(cfg.Items[0].Value); got != 24.5 {
		t.Fatalf("value = %v; muốn 24.5", cfg.Items[0].Value)
	}
}

// Đúng BIÊN là hợp lệ: dải đóng ở cả hai đầu, không phải nửa mở.
func TestForcePointAcceptsExactBounds(t *testing.T) {
	for _, value := range []string{"16", "30"} {
		t.Run(value, func(t *testing.T) {
			app, token := newTestAppWithAdmin(t)
			seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":22,"minValue":16,"maxValue":30}]}`)
			resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":`+value+`}`, token)
			assertStatus(t, resp, http.StatusOK)
		})
	}
}

/* Điểm KHÔNG khai biên giữ nguyên hành vi cũ.
 *
 * Mọi cấu hình đang chạy trên bo đều thuộc nhóm này. Siết chúng vì một trường
 * mới xuất hiện là biến một bản vá an toàn thành một sự cố nâng cấp. */
func TestForcePointWithoutLimitsIsUnchanged(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":22}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":9999}`, token)
	assertStatus(t, resp, http.StatusOK)
}

// Khai MỘT vế cũng cưỡng chế được vế đó — "không bao giờ dưới 0" là một yêu cầu thật.
func TestOneSidedLimitIsEnforced(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"flow","signalType":"float","enabled":true,"writable":true,"value":10,"minValue":0}]}`)

	if resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":-1}`, token); resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400 cho giá trị dưới minValue", resp.Code)
	}
	if resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":100000}`, token); resp.Code != http.StatusOK {
		t.Fatalf("status = %d; chỉ khai minValue thì vế trên không được tự chặn", resp.Code)
	}
}

// Kiểu `integer` cũng phải được cưỡng chế, không chỉ `float`.
func TestLimitsEnforcedOnIntegerSignalType(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"stage","signalType":"integer","enabled":true,"writable":true,"value":1,"minValue":0,"maxValue":3}]}`)

	if resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":7}`, token); resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400 — VP kiểu integer cũng phải bị chặn", resp.Code)
	}
}

/* Giá trị gửi dạng CHUỖI không được vòng qua phép kiểm.
 *
 * `normalizeVirtualPointValue` chấp `"45"` cho kiểu số, nên nếu kiểm biên chạy
 * trước bước chuẩn hoá thì chuỗi là lối thoát hiểm hoàn hảo. */
func TestLimitsSurviveStringEncodedValue(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":22,"minValue":16,"maxValue":30}]}`)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/VP1", `{"value":"45"}`, token)
	if resp.Code == http.StatusOK {
		t.Fatalf("giá trị dạng chuỗi \"45\" vòng qua được phép kiểm biên; body=%s", resp.Body.String())
	}
}

// --- Đường ghi CẤU HÌNH ---

// Cấu hình tự gieo sẵn một `value` ngoài dải phải bị từ chối, nếu không thì
// phép kiểm lúc ghi chỉ đang bảo vệ một trạng thái vốn đã sai.
func TestConfigRejectsSeedValueOutsideLimits(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"sp","signalType":"float","enabled":true,"writable":true,"value":45,"minValue":16,"maxValue":30}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400; body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "value") {
		t.Fatalf("lỗi không chỉ ra trường sai: %s", resp.Body.String())
	}
}

// `initialValue` (ISS-PIO-14) cũng nằm trong dải, nếu không thì mỗi lần khởi
// động lại thiết bị tự đặt mình ra ngoài biên kỹ thuật.
func TestConfigRejectsInitialValueOutsideLimits(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"sp","signalType":"float","enabled":true,"writable":true,"value":22,"initialValue":45,"restartPolicy":"initial","minValue":16,"maxValue":30}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400 — initialValue 45 ngoài dải 16..30; body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "initialValue") {
		t.Fatalf("lỗi không chỉ ra initialValue: %s", resp.Body.String())
	}
}

func TestConfigRejectsMinAboveMax(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"sp","signalType":"float","enabled":true,"writable":true,"value":22,"minValue":30,"maxValue":16}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400; body=%s", resp.Code, resp.Body.String())
	}
}

/* Khai biên trên kiểu KHÔNG phải số bị từ chối, không phải bỏ qua im lặng.
 *
 * Chấp nhận rồi lờ đi sẽ để lại một cấu hình trông như đang bảo vệ điểm mà thực
 * chất không cưỡng chế gì — tệ hơn cả việc không có trường đó. */
func TestConfigRejectsLimitsOnNonNumericSignalType(t *testing.T) {
	for _, signalType := range []string{"boolean", "string", "datetime"} {
		t.Run(signalType, func(t *testing.T) {
			app, token := newTestAppWithAdmin(t)
			body := fmt.Sprintf(`{"tag":"x","signalType":%q,"enabled":true,"writable":true,"minValue":0,"maxValue":1}`, signalType)
			resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points", body, token)
			if resp.Code != http.StatusBadRequest {
				t.Fatalf("status = %d; muốn 400 — biên kỹ thuật không cưỡng chế được trên %s; body=%s", resp.Code, signalType, resp.Body.String())
			}
		})
	}
}

// Cấu hình HỢP LỆ đi qua và giữ đủ hai trường khi đọc lại — trường bị nuốt mất
// lúc chuẩn hoá cũng là một cách hỏng im lặng.
func TestConfigRoundTripsLimits(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	create := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"sp","signalType":"float","enabled":true,"writable":true,"value":22,"minValue":16,"maxValue":30}`, token)
	assertStatus(t, create, http.StatusCreated)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/virtual-points", "", token)
	assertStatus(t, resp, http.StatusOK)
	var items []VirtualPoint
	if err := json.Unmarshal(resp.Body.Bytes(), &items); err != nil {
		t.Fatalf("giải mã: %v", err)
	}
	if len(items) != 1 || items[0].MinValue == nil || items[0].MaxValue == nil {
		t.Fatalf("items = %+v; hai biên phải còn nguyên sau vòng ghi-đọc", items)
	}
	if *items[0].MinValue != 16 || *items[0].MaxValue != 30 {
		t.Fatalf("biên = [%v,%v]; muốn [16,30]", *items[0].MinValue, *items[0].MaxValue)
	}
}

// --- Đơn vị ---

func TestCheckVirtualPointValueRangeIgnoresUndeclaredLimits(t *testing.T) {
	item := VirtualPoint{ID: "VP1", SignalType: virtualPointSignalFloat}
	if err := checkVirtualPointValueRange(item, 1e9); err != nil {
		t.Fatalf("điểm chưa khai biên mà vẫn chặn: %v", err)
	}
}

// Điểm KHAI biên số mà nhận một giá trị không đọc được thành số ⇒ từ chối.
// Cho qua ở đây là mở đúng một lối vòng qua phép kiểm.
func TestCheckVirtualPointValueRangeRejectsNonNumeric(t *testing.T) {
	item := VirtualPoint{ID: "VP1", SignalType: virtualPointSignalFloat, MinValue: floatPtr(0), MaxValue: floatPtr(10)}
	if err := checkVirtualPointValueRange(item, "không phải số"); err == nil {
		t.Fatal("giá trị không đọc được thành số vẫn qua được phép kiểm biên")
	}
}

func TestDescribeVirtualPointRangeCoversOneSided(t *testing.T) {
	if got := describeVirtualPointRange(floatPtr(16), floatPtr(30)); got != "[16, 30]" {
		t.Fatalf("got %q", got)
	}
	if got := describeVirtualPointRange(floatPtr(0), nil); got != ">= 0" {
		t.Fatalf("got %q", got)
	}
	if got := describeVirtualPointRange(nil, floatPtr(100)); got != "<= 100" {
		t.Fatalf("got %q", got)
	}
}

/* Hai bộ đọc số của VP phải hiểu ĐÚNG các kiểu mà đường dữ liệu thật sinh ra.
 *
 * `normalizeVirtualPointValue` trả `int64` cho signalType `integer`, và mọi
 * decoder cấu hình đều bật `UseNumber()` nên số về dạng `json.Number`. Bản cũ
 * liệt kê tay `float64/float32/int` và bỏ sót cả hai — đủ để vòng đối chiếu coi
 * mọi VP `integer` là "lệch", và để `restartPolicy: initial` không bao giờ chạy
 * trên VP `integer`. */
func TestVirtualPointNumberReadersCoverRealTypes(t *testing.T) {
	for name, value := range map[string]any{
		"int64":       int64(20),
		"json.Number": json.Number("20"),
		"float64":     float64(20),
		"int":         int(20),
	} {
		got, ok := virtualPointFloat(value)
		if !ok || got != 20 {
			t.Fatalf("virtualPointFloat(%s) = (%v,%v); muốn (20,true)", name, got, ok)
		}
	}
	if got, ok := virtualPointBool(int64(1)); !ok || !got {
		t.Fatalf("virtualPointBool(int64(1)) = (%v,%v); muốn (true,true)", got, ok)
	}
	if got, ok := virtualPointBool(json.Number("0")); !ok || got {
		t.Fatalf("virtualPointBool(json.Number(0)) = (%v,%v); muốn (false,true)", got, ok)
	}
}

/* So giá trị của kiểu SỐ không được rơi xuống nhánh so chuỗi.
 *
 * Ở nhánh đó `virtualPointText` trả `""` cho mọi thứ không phải chuỗi, nên hai
 * giá trị KHÁC NHAU cùng thành `""` và được coi là bằng nhau —
 * `applyRestartPolicyOnBoot` bỏ qua điểm, im lặng. */
func TestSameVirtualPointValueDoesNotFallBackToTextForNumbers(t *testing.T) {
	if sameVirtualPointValue(int64(35), struct{}{}, virtualPointSignalInteger) {
		t.Fatal("kiểu số mà một vế không đọc được vẫn bị coi là bằng nhau")
	}
	if !sameVirtualPointValue(int64(20), json.Number("20"), virtualPointSignalInteger) {
		t.Fatal("int64(20) và json.Number(20) phải bằng nhau")
	}
}

/* VP kiểu `integer` khai `restartPolicy: initial` PHẢI quay về giá trị khởi tạo.
 *
 * Đây là hồi quy thật của `ISS-PIO-14`, lộ ra khi làm `ISS-PIO-15`: bộ đọc số
 * bỏ sót `int64` nên mọi VP integer bị coi là "đã đúng giá trị" và không bao giờ
 * được đặt lại. */
func TestRestartPolicyInitialWorksOnIntegerSignalType(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	path := seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"stage","signalType":"integer","enabled":true,"writable":true,"value":3,"initialValue":0,"restartPolicy":"initial"}]}`)

	if reset := app.applyRestartPolicyOnBoot(t.Context()); reset != 1 {
		t.Fatalf("số điểm đặt lại = %d; muốn 1 — VP integer cũng phải theo chính sách khởi động", reset)
	}
	cfg := readVPConfig(t, path)
	if got, ok := virtualPointFloat(cfg.Items[0].Value); !ok || got != 0 {
		t.Fatalf("value = %v; muốn 0", cfg.Items[0].Value)
	}
}
