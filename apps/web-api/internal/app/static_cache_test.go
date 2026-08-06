package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Header cache của file tĩnh — sự cố bo Foxlinx 2026-08-06.
//
// Sau khi deploy bản có trang "Cổng RS-485", người dùng mở tab đang có sẵn và
// KHÔNG thấy tab mới. Máy chủ phục vụ đúng bản mới, log sạch, kiểm bằng
// Playwright (tải mới mỗi lần) cũng thấy đúng — chỉ trình duyệt thật là giữ
// `index.html` cũ, và `index.html` cũ trỏ vào bundle cũ.
//
// Nguyên nhân: handler không đặt `Cache-Control` gì cả, nên trình duyệt tự suy
// từ `Last-Modified` (heuristic caching) và quyết định giữ lại. Không có tín
// hiệu nào cho người dùng biết họ đang xem bản cũ, nên kết luận tự nhiên của họ
// là "tính năng không có".

func newStaticApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "index-DnwvEcoc.js"), []byte("//js"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "favicon.ico"), []byte("ico"), 0o644); err != nil {
		t.Fatal(err)
	}
	return &App{cfg: Config{StaticDir: dir}}
}

func staticGet(t *testing.T, app *App, path string) *http.Response {
	t.Helper()
	recorder := httptest.NewRecorder()
	app.handleStatic(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder.Result()
}

/* `index.html` phải được hỏi lại mỗi lần: nó là thứ trỏ vào bundle, nên giữ nó
 * lại nghĩa là giữ luôn cả bản build cũ. */
func TestIndexHtmlKhongDuocCacheImLang(t *testing.T) {
	app := newStaticApp(t)
	for _, path := range []string{"/", "/index.html", "/eng/modbus-rtu/ports"} {
		response := staticGet(t, app, path)
		got := response.Header.Get("Cache-Control")
		if !strings.Contains(got, "no-cache") {
			t.Errorf("GET %s → Cache-Control = %q, phải có no-cache; thiếu nó thì "+
				"deploy xong người đang mở trang vẫn chạy bản cũ mà không biết", path, got)
		}
	}
}

/* Đường dẫn SPA không khớp file nào vẫn trả về index.html, nên nó phải mang
 * header của HTML — không phải header suy từ phần mở rộng trong URL. */
func TestDuongDanSpaTraVeIndexVoiHeaderCuaHtml(t *testing.T) {
	app := newStaticApp(t)
	response := staticGet(t, app, "/eng/modbus-rtu/ports")
	if got := response.Header.Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, chờ no-cache", got)
	}
}

/* Tên file asset đã chứa hash nội dung, nên nội dung đổi ⇒ tên đổi. Bản cũ
 * không bao giờ bị phục vụ nhầm, vì thế cache dài là an toàn và tiết kiệm. */
func TestAssetCoHashDuocCacheDaiVaImmutable(t *testing.T) {
	app := newStaticApp(t)
	response := staticGet(t, app, "/assets/index-DnwvEcoc.js")
	got := response.Header.Get("Cache-Control")
	if !strings.Contains(got, "immutable") || !strings.Contains(got, "max-age=31536000") {
		t.Errorf("Cache-Control = %q, chờ có max-age=31536000 và immutable", got)
	}
}

/* File còn lại không có hash trong tên nên KHÔNG được immutable: đổi favicon mà
 * trình duyệt giữ một năm thì không có đường cập nhật. */
func TestFileKhongCoHashKhongDuocImmutable(t *testing.T) {
	app := newStaticApp(t)
	response := staticGet(t, app, "/favicon.ico")
	got := response.Header.Get("Cache-Control")
	if strings.Contains(got, "immutable") {
		t.Errorf("Cache-Control = %q — file không có hash trong tên không được immutable", got)
	}
	if !strings.Contains(got, "must-revalidate") {
		t.Errorf("Cache-Control = %q, chờ có must-revalidate", got)
	}
}
