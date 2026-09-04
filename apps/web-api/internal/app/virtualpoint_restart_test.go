package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/* ISS-PIO-14 — chính sách giá trị Virtual Point sau khởi động lại (đề bài §13).
 *
 * Trước bản vá, `value` gánh HAI nghĩa: giá trị khởi tạo do người dùng đặt, và
 * giá trị hiện hành do lệnh ghi runtime cập nhật. Người dùng đặt 20 làm mặc
 * định, một kỹ thuật viên ép 35 để thử, và số 20 biến mất khỏi cấu hình vĩnh
 * viễn — không có đường nào lấy lại.
 */

func seedVPConfig(t *testing.T, app *App, body string) string {
	t.Helper()
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	return path
}

func readVPConfig(t *testing.T, path string) ConfigVirtualPoints {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("đọc config: %v", err)
	}
	var cfg ConfigVirtualPoints
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("giải mã config: %v (raw=%s)", err, data)
	}
	return cfg
}

// `initial`: giá trị runtime bị bỏ, điểm quay về giá trị khởi tạo.
func TestRestartPolicyInitialRestoresInitialValue(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	path := seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":35,"initialValue":20,"restartPolicy":"initial"}]}`)

	if reset := app.applyRestartPolicyOnBoot(context.Background()); reset != 1 {
		t.Fatalf("số điểm đặt lại = %d; muốn 1", reset)
	}
	cfg := readVPConfig(t, path)
	got, ok := virtualPointFloat(cfg.Items[0].Value)
	if !ok || got != 20 {
		t.Fatalf("value sau khởi động = %v; muốn 20 — điểm khai `initial` mà vẫn giữ giá trị runtime", cfg.Items[0].Value)
	}
	// `initialValue` KHÔNG được bị chính thao tác này ăn mất: lần khởi động sau
	// vẫn phải quay về đúng số đó.
	want, ok := virtualPointFloat(cfg.Items[0].InitialValue)
	if !ok || want != 20 {
		t.Fatalf("initialValue = %v; phải còn nguyên sau khi áp chính sách", cfg.Items[0].InitialValue)
	}
}

// `retain` (và mặc định) giữ nguyên giá trị cuối — hành vi cũ, không được đổi.
func TestRestartPolicyRetainKeepsLastValue(t *testing.T) {
	for _, tc := range []struct{ name, policy string }{
		{"khai retain", `,"restartPolicy":"retain"`},
		{"không khai gì (mặc định)", ``},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app, _ := newTestAppWithAdmin(t)
			path := seedVPConfig(t, app,
				`{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":35,"initialValue":20`+tc.policy+`}]}`)

			if reset := app.applyRestartPolicyOnBoot(context.Background()); reset != 0 {
				t.Fatalf("số điểm đặt lại = %d; muốn 0 — `retain` không được đụng vào giá trị", reset)
			}
			cfg := readVPConfig(t, path)
			got, _ := virtualPointFloat(cfg.Items[0].Value)
			if got != 35 {
				t.Fatalf("value = %v; muốn giữ 35", cfg.Items[0].Value)
			}
		})
	}
}

/* `initial` mà CHƯA đặt `initialValue` ⇒ mặc định theo kiểu tín hiệu, KHÔNG rơi
 * về `value`.
 *
 * Rơi về `value` sẽ biến `initial` thành `retain` một cách im lặng — tệ hơn
 * không có tuỳ chọn nào, vì màn hình khi ấy nói một đằng và thiết bị làm một nẻo. */
func TestRestartPolicyInitialWithoutInitialValueUsesSignalDefault(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	path := seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":35,"restartPolicy":"initial"}]}`)

	app.applyRestartPolicyOnBoot(context.Background())
	cfg := readVPConfig(t, path)
	got, ok := virtualPointFloat(cfg.Items[0].Value)
	if !ok || got != 0 {
		t.Fatalf("value = %v; muốn 0 (mặc định của float) — không được lặng lẽ giữ giá trị runtime", cfg.Items[0].Value)
	}
}

// Kiểu boolean cũng phải đúng, không chỉ số.
func TestRestartPolicyInitialHandlesBoolean(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	path := seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"occ","signalType":"boolean","enabled":true,"writable":true,"value":true,"initialValue":false,"restartPolicy":"initial"}]}`)

	app.applyRestartPolicyOnBoot(context.Background())
	cfg := readVPConfig(t, path)
	got, ok := virtualPointBool(cfg.Items[0].Value)
	if !ok || got {
		t.Fatalf("value = %v; muốn false", cfg.Items[0].Value)
	}
}

/* Áp chính sách phải là IDEMPOTENT: chạy lại khi giá trị đã đúng thì không ghi
 * lại tệp.
 *
 * Không phải chuyện hiệu năng: `virtual_points.conf` nằm trên eMMC của một thiết
 * bị nhúng, và một lần ghi thừa mỗi lần khởi động là một lần ghi thừa suốt đời
 * máy. Nó cũng sẽ sinh một vết audit "đã đặt lại" cho một việc không xảy ra. */
func TestRestartPolicyIsIdempotent(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":20,"initialValue":20,"restartPolicy":"initial"}]}`)

	if reset := app.applyRestartPolicyOnBoot(context.Background()); reset != 0 {
		t.Fatalf("lần đầu đặt lại %d điểm; giá trị đã đúng thì không được ghi gì", reset)
	}
	if reset := app.applyRestartPolicyOnBoot(context.Background()); reset != 0 {
		t.Fatalf("lần hai đặt lại %d điểm", reset)
	}
}

/* So giá trị phải theo KIỂU TÍN HIỆU, không phải `==` trên `any`.
 *
 * `20` đọc từ JSON là `float64`, còn hằng số trong mã là `int64`. So bằng `==`
 * sẽ báo "khác nhau" cho hai giá trị bằng nhau, và bản vá này sẽ ghi lại tệp
 * cấu hình ở MỌI lần khởi động — im lặng, mãi mãi. */
func TestSameVirtualPointValueComparesAcrossNumericTypes(t *testing.T) {
	if !sameVirtualPointValue(float64(20), int64(20), virtualPointSignalFloat) {
		t.Fatal("float64(20) và int64(20) phải bằng nhau")
	}
	if sameVirtualPointValue(float64(20), float64(21), virtualPointSignalFloat) {
		t.Fatal("20 và 21 không được coi là bằng nhau")
	}
	if !sameVirtualPointValue(true, true, virtualPointSignalBoolean) {
		t.Fatal("true phải bằng true")
	}
	if sameVirtualPointValue("a", "b", virtualPointSignalString) {
		t.Fatal("chuỗi khác nhau không được coi là bằng nhau")
	}
}

// Giá trị lạ ở `restartPolicy` bị TỪ CHỐI ở đường ghi API.
//
// Kiểm trên giá trị thô: `normalizeVirtualPointRestartPolicy` cố ý hiểu giá trị
// lạ thành `retain` để tệp cũ trên đĩa vẫn đọc được, nên nếu validator cũng
// kiểm bản đã chuẩn hoá thì người gõ nhầm `innitial` sẽ nhận một thiết bị lặng
// lẽ chạy `retain`.
func TestVirtualPointRejectsUnknownRestartPolicy(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1,"restartPolicy":"innitial"}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400 — chính sách gõ sai phải kêu, không được lặng lẽ hoá retain; body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "restartPolicy") {
		t.Fatalf("thông báo lỗi không chỉ ra trường sai: %s", resp.Body.String())
	}
}

// Đọc một tệp cấu hình ĐỜI CŨ (không có `restartPolicy`) không được hỏng, và
// phải hiểu theo hành vi cũ.
func TestLegacyConfigWithoutRestartPolicyReadsAsRetain(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":7}]}`)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/virtual-points", "", token)
	assertStatus(t, resp, http.StatusOK)
	var items []VirtualPoint
	if err := json.Unmarshal(resp.Body.Bytes(), &items); err != nil {
		t.Fatalf("giải mã: %v", err)
	}
	if len(items) != 1 || items[0].RestartPolicy != virtualPointRestartRetain {
		t.Fatalf("items = %+v; cấu hình đời cũ phải đọc thành retain", items)
	}
}

/* Áp chính sách để lại VẾT AUDIT.
 *
 * `ISS-PIO-37` đòi mọi thay đổi cấu hình Point ghi `old → new`. Đây là thay đổi
 * do HỆ THỐNG thực hiện lúc khởi động — im lặng ở đây nghĩa là giá trị một điểm
 * vật lý đổi mà không dấu vết nào. */
func TestRestartPolicyLeavesAuditTrail(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	sink := &auditSink{}
	app.audit.SetSink(sink)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":35,"initialValue":20,"restartPolicy":"initial"}]}`)

	app.applyRestartPolicyOnBoot(context.Background())

	record, ok := sink.find("virtual-points.restart-policy")
	if !ok {
		t.Fatalf("không có vết áp chính sách; đã ghi: %v", sink.actions())
	}
	if record.Actor != "system" {
		t.Fatalf("actor = %q; muốn system", record.Actor)
	}
	if !strings.Contains(record.Detail, "35") || !strings.Contains(record.Detail, "20") {
		t.Fatalf("detail thiếu cả hai vế 35 -> 20: %q", record.Detail)
	}
}
