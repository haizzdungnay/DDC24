package app

// T63-104 (PERF-FE-01, Plan 63 §4.2) — phục vụ `.gz` nén sẵn.
//
// File này chỉ gọi `handleStatic` (API có từ trước T63-104) nên chạy được trên mã
// cũ để chứng minh test ĐỎ khi bỏ bản sửa.

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type gzipStaticFixture struct {
	app   *App
	js    []byte
	jsGz  []byte
	css   []byte
	cssGz []byte
}

func gzipBytes(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func newGzipStaticFixture(t *testing.T) gzipStaticFixture {
	t.Helper()
	dir := t.TempDir()
	assets := filepath.Join(dir, "assets")
	if err := os.MkdirAll(assets, 0o755); err != nil {
		t.Fatal(err)
	}
	fx := gzipStaticFixture{
		app: &App{cfg: Config{StaticDir: dir}},
		js:  []byte(strings.Repeat("export const mkddc = 'Plan 63 T63-104';\n", 200)),
		css: []byte(strings.Repeat(".btn{color:#123456;padding:4px}\n", 200)),
	}
	fx.jsGz, fx.cssGz = gzipBytes(t, fx.js), gzipBytes(t, fx.css)
	files := map[string][]byte{
		"index.html":                   []byte("<html>mkddc</html>"),
		"assets/index-AbC123.js":       fx.js,
		"assets/index-AbC123.js.gz":    fx.jsGz,
		"assets/index-AbC123.css":      fx.css,
		"assets/index-AbC123.css.gz":   fx.cssGz,
		"assets/nogz-Z9.js":            fx.js,
		"assets/blob-X1.unknownext":    fx.js,
		"assets/blob-X1.unknownext.gz": fx.jsGz,
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return fx
}

func (fx gzipStaticFixture) do(t *testing.T, method, path string, headers map[string]string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	fx.app.handleStatic(recorder, req)
	return recorder.Result()
}

func readAll(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func gunzipAll(t *testing.T, body []byte) []byte {
	t.Helper()
	reader, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("body không phải gzip hợp lệ: %v", err)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// AC: client nhận gzip ⇒ bản `.gz`, Content-Encoding gzip, Vary, Content-Type của
// file GỐC, Cache-Control không đổi, giải nén trùng hash file gốc.
func TestStaticServesPrecompressedGzipWithOriginalHeaders(t *testing.T) {
	fx := newGzipStaticFixture(t)
	identity := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", nil)
	wantType := identity.Header.Get("Content-Type")
	cases := []struct {
		path     string
		raw, gz  []byte
		typeHint string
	}{
		{"/assets/index-AbC123.js", fx.js, fx.jsGz, "javascript"},
		{"/assets/index-AbC123.css", fx.css, fx.cssGz, "text/css"},
	}
	for _, tc := range cases {
		resp := fx.do(t, http.MethodGet, tc.path, map[string]string{"Accept-Encoding": "gzip, deflate, br"})
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Encoding") != "gzip" {
			t.Fatalf("%s: status=%d Content-Encoding=%q; want 200 gzip", tc.path, resp.StatusCode, resp.Header.Get("Content-Encoding"))
		}
		if !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
			t.Fatalf("%s: Vary=%q; want Accept-Encoding", tc.path, resp.Header.Get("Vary"))
		}
		if got := resp.Header.Get("Content-Type"); !strings.Contains(got, tc.typeHint) || strings.Contains(got, "gzip") {
			t.Fatalf("%s: Content-Type=%q; want kiểu của file gốc", tc.path, got)
		}
		if got := resp.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
			t.Fatalf("%s: Cache-Control=%q; want không đổi", tc.path, got)
		}
		if !bytes.Equal(body, tc.gz) || resp.Header.Get("Content-Length") != strconv.Itoa(len(tc.gz)) {
			t.Fatalf("%s: body %d byte, Content-Length %s; want đúng file .gz (%d byte)", tc.path, len(body), resp.Header.Get("Content-Length"), len(tc.gz))
		}
		if sha256.Sum256(gunzipAll(t, body)) != sha256.Sum256(tc.raw) {
			t.Fatalf("%s: giải nén KHÔNG trùng hash file gốc", tc.path)
		}
	}
	if got := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": "gzip"}).Header.Get("Content-Type"); got != wantType {
		t.Fatalf("Content-Type gzip=%q ≠ identity=%q", got, wantType)
	}
}

// AC: client không nhận gzip ⇒ bản gốc, không Content-Encoding, vẫn Vary.
func TestStaticServesIdentityWhenClientDoesNotAcceptGzip(t *testing.T) {
	fx := newGzipStaticFixture(t)
	for _, accept := range []string{"", "identity", "br", "gzip;q=0", "gzip;q=0, *;q=1", "x-gzip;q=0.0"} {
		resp := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": accept})
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Encoding") != "" || !bytes.Equal(body, fx.js) {
			t.Fatalf("Accept-Encoding %q: status=%d Content-Encoding=%q body=%d byte; want 200 bản gốc",
				accept, resp.StatusCode, resp.Header.Get("Content-Encoding"), len(body))
		}
		if !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
			t.Fatalf("Accept-Encoding %q: thiếu Vary — cache trung gian có thể trả nhầm bản gzip", accept)
		}
	}
	resp := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": "*"})
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Accept-Encoding *: Content-Encoding=%q; want gzip", resp.Header.Get("Content-Encoding"))
	}
}

// AC: HEAD mang đúng header của GET tương ứng, không body.
func TestStaticHeadMatchesSelectedVariant(t *testing.T) {
	fx := newGzipStaticFixture(t)
	gz := fx.do(t, http.MethodHead, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": "gzip"})
	if gz.StatusCode != http.StatusOK || gz.Header.Get("Content-Encoding") != "gzip" ||
		gz.Header.Get("Content-Length") != strconv.Itoa(len(fx.jsGz)) || len(readAll(t, gz)) != 0 {
		t.Fatalf("HEAD gzip: status=%d CE=%q CL=%q; want 200 gzip, CL=%d, không body",
			gz.StatusCode, gz.Header.Get("Content-Encoding"), gz.Header.Get("Content-Length"), len(fx.jsGz))
	}
	plain := fx.do(t, http.MethodHead, "/assets/index-AbC123.js", nil)
	if plain.Header.Get("Content-Encoding") != "" || plain.Header.Get("Content-Length") != strconv.Itoa(len(fx.js)) {
		t.Fatalf("HEAD identity: CE=%q CL=%q; want CL=%d", plain.Header.Get("Content-Encoding"), plain.Header.Get("Content-Length"), len(fx.js))
	}
}

// AC: có Range ⇒ luôn bản gốc (Range tính trên byte gốc), kể cả khi client nhận gzip.
func TestStaticRangeAlwaysServesIdentityBytes(t *testing.T) {
	fx := newGzipStaticFixture(t)
	resp := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": "gzip", "Range": "bytes=0-9"})
	body := readAll(t, resp)
	if resp.StatusCode != http.StatusPartialContent || resp.Header.Get("Content-Encoding") != "" {
		t.Fatalf("Range: status=%d CE=%q; want 206 không nén", resp.StatusCode, resp.Header.Get("Content-Encoding"))
	}
	if !bytes.Equal(body, fx.js[:10]) || resp.Header.Get("Content-Range") != "bytes 0-9/"+strconv.Itoa(len(fx.js)) {
		t.Fatalf("Range: body=%q Content-Range=%q; want 10 byte đầu của BẢN GỐC", body, resp.Header.Get("Content-Range"))
	}
	if !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
		t.Fatal("Range: thiếu Vary")
	}
}

// AC: ETag/If-None-Match — mỗi biến thể một ETag; khớp đúng biến thể ⇒ 304.
func TestStaticETagDistinguishesVariantsAndHonoursIfNoneMatch(t *testing.T) {
	fx := newGzipStaticFixture(t)
	gzipped := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": "gzip"})
	plain := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", nil)
	gzTag, plainTag := gzipped.Header.Get("ETag"), plain.Header.Get("ETag")
	if gzTag == "" || plainTag == "" || gzTag == plainTag {
		t.Fatalf("ETag gzip=%q identity=%q; want hai ETag khác nhau, khác rỗng", gzTag, plainTag)
	}

	notModified := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": "gzip", "If-None-Match": gzTag})
	if notModified.StatusCode != http.StatusNotModified || len(readAll(t, notModified)) != 0 {
		t.Fatalf("If-None-Match gzip: status=%d; want 304 không body", notModified.StatusCode)
	}
	if !strings.Contains(notModified.Header.Get("Vary"), "Accept-Encoding") || notModified.Header.Get("Cache-Control") == "" {
		t.Fatalf("304 phải giữ Vary và Cache-Control: Vary=%q CC=%q", notModified.Header.Get("Vary"), notModified.Header.Get("Cache-Control"))
	}

	// ETag của bản gzip không được làm client identity nhận 304 cho bản gốc.
	crossed := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"If-None-Match": gzTag})
	if crossed.StatusCode != http.StatusOK || !bytes.Equal(readAll(t, crossed), fx.js) {
		t.Fatalf("If-None-Match gzip tag, client identity: status=%d; want 200 bản gốc", crossed.StatusCode)
	}
	if resp := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"If-None-Match": plainTag}); resp.StatusCode != http.StatusNotModified {
		t.Fatalf("If-None-Match identity: status=%d; want 304", resp.StatusCode)
	}
	// 304/412 không có body ⇒ không được mang Content-Length của file .gz.
	if cl := notModified.Header.Get("Content-Length"); cl != "" {
		t.Fatalf("304 mang Content-Length=%q", cl)
	}
	failed := fx.do(t, http.MethodGet, "/assets/index-AbC123.js", map[string]string{"Accept-Encoding": "gzip", "If-Match": `"khac"`})
	if failed.StatusCode != http.StatusPreconditionFailed || failed.Header.Get("Content-Length") != "" {
		t.Fatalf("If-Match lệch: status=%d CL=%q; want 412 không Content-Length", failed.StatusCode, failed.Header.Get("Content-Length"))
	}
}

// Không có `.gz` ⇒ đường cũ nguyên vẹn; không biết Content-Type gốc ⇒ không phục
// vụ bản nén; index.html giữ no-cache và không nén.
func TestStaticWithoutUsableVariantKeepsOldBehaviour(t *testing.T) {
	fx := newGzipStaticFixture(t)
	resp := fx.do(t, http.MethodGet, "/assets/nogz-Z9.js", map[string]string{"Accept-Encoding": "gzip"})
	if resp.Header.Get("Content-Encoding") != "" || resp.Header.Get("Vary") != "" || !bytes.Equal(readAll(t, resp), fx.js) {
		t.Fatalf("không có .gz: CE=%q Vary=%q; want bản gốc như cũ", resp.Header.Get("Content-Encoding"), resp.Header.Get("Vary"))
	}
	resp = fx.do(t, http.MethodGet, "/assets/blob-X1.unknownext", map[string]string{"Accept-Encoding": "gzip"})
	if resp.Header.Get("Content-Encoding") != "" || !bytes.Equal(readAll(t, resp), fx.js) {
		t.Fatalf("không biết Content-Type gốc: CE=%q; want bản gốc", resp.Header.Get("Content-Encoding"))
	}
	for _, path := range []string{"/", "/login"} {
		resp = fx.do(t, http.MethodGet, path, map[string]string{"Accept-Encoding": "gzip"})
		if resp.Header.Get("Cache-Control") != "no-cache" || resp.Header.Get("Content-Encoding") != "" {
			t.Fatalf("%s: CC=%q CE=%q; want no-cache, không nén", path, resp.Header.Get("Cache-Control"), resp.Header.Get("Content-Encoding"))
		}
	}
}
