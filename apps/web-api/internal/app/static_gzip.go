package app

// T63-104 (PERF-FE-01, Plan 63 §4.2) — phục vụ bản `.gz` nén SẴN của tài nguyên FE.
//
// Trước bản này `handleStatic` chỉ đặt Cache-Control rồi `http.ServeFile`, nên
// mọi JS/CSS đi qua mạng ở dạng thô: cold load trang login trên host kéo 9 file,
// 1264,9 KiB (đo Playwright + Chromium, 2026-09-28). Bước build
// (`apps/web-ui/scripts/precompress-assets.mjs`) nay sinh `<file>.gz` cạnh
// JS/CSS trong `assets/`; ở đây chỉ CHỌN file, không nén gì trên SOM.
//
// Luật chọn (Plan 63 T63-104):
//   - Trả `.gz` CHỈ khi client nhận gzip (Accept-Encoding, tôn trọng `q=0`) VÀ
//     request không có `Range`. Range tính trên byte của bản gốc; trả byte của
//     bản nén cho một Range là hỏng dữ liệu.
//   - Bản `.gz` mang `Content-Encoding: gzip` và `Content-Type` của FILE GỐC
//     (không phải application/gzip); `Cache-Control` do setStaticCacheHeaders
//     quyết định như cũ.
//   - Có biến thể thì MỌI phản hồi của file đó (gzip, identity, 206, 304) mang
//     `Vary: Accept-Encoding`, và ETag riêng cho từng biến thể — hai biểu diễn
//     khác byte không được chung một strong ETag.
//   - File không có `.gz` đi đường `http.ServeFile` y như trước.

import (
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// serveStaticGzipVariant phục vụ `target` khi nó có biến thể `target.gz`. Trả
// false (chưa ghi gì) khi không có biến thể hoặc không biết Content-Type gốc —
// caller rơi về http.ServeFile.
func serveStaticGzipVariant(w http.ResponseWriter, r *http.Request, target string) bool {
	gzPath := target + ".gz"
	if info, err := os.Stat(gzPath); err != nil || !info.Mode().IsRegular() {
		return false
	}
	// Không biết kiểu gốc thì ServeContent sẽ dò từ byte nén và trả
	// application/x-gzip — trình duyệt sẽ không chạy nổi file đó.
	contentType := mime.TypeByExtension(filepath.Ext(target))
	if contentType == "" {
		return false
	}
	served, encoding := target, ""
	if r.Header.Get("Range") == "" && acceptsGzip(r.Header.Values("Accept-Encoding")) {
		served, encoding = gzPath, "gzip"
	}
	file, err := os.Open(served)
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	header := w.Header()
	header.Add("Vary", "Accept-Encoding")
	header.Set("Content-Type", contentType)
	etag := fmt.Sprintf(`"%x-%x`, info.Size(), info.ModTime().UnixNano())
	if encoding != "" {
		header.Set("Content-Encoding", encoding)
		etag += "-" + encoding
		// ServeContent bỏ Content-Length khi đã có Content-Encoding (nó không biết
		// byte đã nén chưa). Ở đây byte gửi đi CHÍNH LÀ file .gz nên biết độ dài;
		// chỉ đặt cho 200 — 304/412 không có body.
		w = &precompressedLengthWriter{ResponseWriter: w, length: strconv.FormatInt(info.Size(), 10)}
	}
	header.Set("ETag", etag+`"`)
	http.ServeContent(w, r, target, info.ModTime(), file)
	return true
}

type precompressedLengthWriter struct {
	http.ResponseWriter
	length string
}

func (p *precompressedLengthWriter) WriteHeader(code int) {
	if code == http.StatusOK {
		p.Header().Set("Content-Length", p.length)
	}
	p.ResponseWriter.WriteHeader(code)
}

func (p *precompressedLengthWriter) Unwrap() http.ResponseWriter { return p.ResponseWriter }

// acceptsGzip đọc Accept-Encoding (RFC 9110 §12.5.3). `gzip`/`x-gzip` với q > 0
// thì nhận; không nhắc gzip thì theo `*`. Header vắng ⇒ không nhận: gửi bản gốc
// cho client không nói gì là lựa chọn an toàn.
func acceptsGzip(values []string) bool {
	gzipQ, starQ := -1.0, -1.0
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			coding, params, _ := strings.Cut(part, ";")
			coding = strings.ToLower(strings.TrimSpace(coding))
			q := 1.0
			for _, param := range strings.Split(params, ";") {
				key, raw, ok := strings.Cut(param, "=")
				if !ok || !strings.EqualFold(strings.TrimSpace(key), "q") {
					continue
				}
				parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
				if err != nil {
					parsed = 0 // q hỏng: coi như từ chối, không đoán là nhận
				}
				q = parsed
			}
			switch coding {
			case "gzip", "x-gzip":
				gzipQ = max(gzipQ, q)
			case "*":
				starQ = max(starQ, q)
			}
		}
	}
	if gzipQ >= 0 {
		return gzipQ > 0
	}
	return starQ > 0
}
