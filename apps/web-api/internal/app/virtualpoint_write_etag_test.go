package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

/* ISS-PIO-37 — phản hồi GHI Virtual Point phải mang ETag của revision MỚI.
 *
 * Trước bản vá chỉ phản hồi đọc (`GET /virtual-points`) gắn ETag. Client giữ
 * ETag cũ sau một lần tạo/sửa/xoá, nên lần ghi kế tiếp trong cùng phiên trang bị
 * 412. Đo trên bo Foxlinx 2026-09-27: xoá hai VP liên tiếp trên trang Virtual
 * Points thì VP thứ hai không xoá được, không có thông báo nào. */
func TestVirtualPointWriteResponsesCarryNextETag(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	seed := `{"items":[` +
		`{"id":"VP1","tag":"VP_ONE","signalType":"float","enabled":true,"writable":true,"value":1},` +
		`{"id":"VP2","tag":"VP_TWO","signalType":"float","enabled":true,"writable":true,"value":2}]}`
	if err := os.WriteFile(path, []byte(seed), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	serve := func(req *http.Request) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		return w
	}

	list := serve(newAuthRequest(http.MethodGet, "/api/v1/virtual-points", "", token))
	etag := list.Header().Get("ETag")
	if list.Code != http.StatusOK || etag == "" {
		t.Fatalf("GET /virtual-points = %d, ETag %q", list.Code, etag)
	}

	// Tạo mới: POST không cần If-Match nhưng vẫn phải trả revision mới.
	created := serve(newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"VP_THREE","signalType":"float","enabled":true,"writable":true,"value":3}`, token))
	if created.Code != http.StatusCreated {
		t.Fatalf("POST = %d body=%s", created.Code, created.Body.String())
	}
	afterCreate := created.Header().Get("ETag")
	if afterCreate == "" || afterCreate == etag {
		t.Fatalf("POST phải trả ETag mới, nhận %q (trước đó %q)", afterCreate, etag)
	}

	// Hai lần xoá liên tiếp, mỗi lần dùng ETag lấy từ PHẢN HỒI GHI trước đó —
	// đúng như FE (`rememberVirtualPointETag`), không đọc lại danh sách.
	first := newAuthRequest(http.MethodDelete, "/api/v1/virtual-points/VP1", "", token)
	first.Header.Set("If-Match", afterCreate)
	firstResp := serve(first)
	if firstResp.Code != http.StatusOK {
		t.Fatalf("DELETE VP1 = %d body=%s", firstResp.Code, firstResp.Body.String())
	}
	afterFirst := firstResp.Header().Get("ETag")
	if afterFirst == "" || afterFirst == afterCreate {
		t.Fatalf("DELETE phải trả ETag mới, nhận %q (trước đó %q)", afterFirst, afterCreate)
	}

	second := newAuthRequest(http.MethodDelete, "/api/v1/virtual-points/VP2", "", token)
	second.Header.Set("If-Match", afterFirst)
	if resp := serve(second); resp.Code != http.StatusOK {
		t.Fatalf("DELETE VP2 bằng ETag của phản hồi xoá trước = %d body=%s (lần ghi thứ hai trong cùng phiên)", resp.Code, resp.Body.String())
	}
}
