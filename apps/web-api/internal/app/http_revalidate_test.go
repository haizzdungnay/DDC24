package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

/* T63-108 (PERF-API-03) — 304 theo nội dung cho GET bị poll dày.
 *
 * Mỗi ca khoá một lời hứa ở `http_revalidate.go`: 304 chỉ khi thân y hệt; đổi
 * một byte ⇒ 200 với ETag mới; handler vẫn đọc authority dù trả 304; không
 * trình duyệt nào được tự phục vụ bản cache mà không hỏi lại. */

func conditionalGet(t *testing.T, handler http.Handler, path, token, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	req := newAuthRequest(http.MethodGet, path, "", token)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func TestAlarmsAnswer304OnlyWhileTheBodyIsUnchanged(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-09-28T10:00:00Z", Severity: "high", Status: "unack",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Active: true,
	}}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	handler := app.Router()

	first := conditionalGet(t, handler, "/api/v1/alarms", token, "")
	assertStatus(t, first, http.StatusOK)
	etag := first.Header().Get("ETag")
	if !strings.HasPrefix(etag, `"c-`) {
		t.Fatalf("ETag = %q; muốn ETag mạnh theo nội dung", etag)
	}
	if got := first.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("Cache-Control = %q; muốn private, no-cache để trình duyệt luôn hỏi lại", got)
	}

	readsBefore := core.readCount
	second := conditionalGet(t, handler, "/api/v1/alarms", token, etag)
	assertStatus(t, second, http.StatusNotModified)
	if second.Body.Len() != 0 {
		t.Fatalf("304 không được có thân; body=%q", second.Body.String())
	}
	if second.Header().Get("ETag") != etag {
		t.Fatalf("304 phải nhắc lại ETag; got %q want %q", second.Header().Get("ETag"), etag)
	}
	if core.readCount == readsBefore {
		t.Fatal("304 không được bỏ qua lượt đọc Core: ETag phải tính từ trạng thái HIỆN TẠI")
	}

	// Người trực vừa xác nhận: cùng If-None-Match cũ phải nhận 200 với thân mới.
	core.alarms[0].Status = "acked"
	third := conditionalGet(t, handler, "/api/v1/alarms", token, etag)
	assertStatus(t, third, http.StatusOK)
	if third.Header().Get("ETag") == etag {
		t.Fatal("thân đổi mà ETag giữ nguyên: trình duyệt sẽ tiếp tục hiện trạng thái cũ")
	}
	if !strings.Contains(third.Body.String(), `"status":"acked"`) {
		t.Fatalf("body = %s; muốn trạng thái mới", third.Body.String())
	}
}

func TestAlarmsETagChangesWhenCoreBecomesUnreadable(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{ID: "ALM-1", Severity: "high", Status: "active", Active: true}}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	handler := app.Router()
	first := conditionalGet(t, handler, "/api/v1/alarms", token, "")
	assertStatus(t, first, http.StatusOK)

	core.readErr = errors.New("core offline")
	second := conditionalGet(t, handler, "/api/v1/alarms", token, first.Header().Get("ETag"))
	if second.Code == http.StatusNotModified {
		t.Fatal("Core mất mà vẫn 304: trình duyệt sẽ giữ danh sách cảnh báo cũ như thể vẫn đọc được")
	}
}

func TestMeAnswers304PerUserAndNeverAcrossUsers(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()
	first := conditionalGet(t, handler, "/api/v1/me", adminToken, "")
	assertStatus(t, first, http.StatusOK)
	etag := first.Header().Get("ETag")
	assertStatus(t, conditionalGet(t, handler, "/api/v1/me", adminToken, etag), http.StatusNotModified)

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users", `{"username":"op2","role":"operator","password":"op123456"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)
	opToken := loginToken(t, handler, "op2", "op123456")
	other := conditionalGet(t, handler, "/api/v1/me", opToken, etag)
	assertStatus(t, other, http.StatusOK)
	if !strings.Contains(other.Body.String(), `"op2"`) {
		t.Fatalf("body = %s; người dùng khác phải nhận đúng hồ sơ của mình", other.Body.String())
	}
}

func TestIfNoneMatchHitsFollowsRFC9110(t *testing.T) {
	etag := `"c-abc"`
	cases := map[string]bool{
		"":             false,
		`"c-abc"`:      true,
		`W/"c-abc"`:    true,
		`"x", "c-abc"`: true,
		`"x","y"`:      false,
		"*":            true,
		`"c-abcd"`:     false,
		` "c-abc" `:    true,
		`"vp:3"`:       false,
	}
	for header, want := range cases {
		if got := ifNoneMatchHits(header, etag); got != want {
			t.Errorf("ifNoneMatchHits(%q) = %v; want %v", header, got, want)
		}
	}
}

// `/virtual-points` CỐ Ý không trả 304: ETag của nó là revision cho `If-Match`,
// và revision đó KHÔNG đổi khi tệp cấu hình bị ghi ngoài phễu (đặt lại giá trị
// lúc khởi động, khôi phục tệp). 304 theo revision sẽ cho trình duyệt giữ giá
// trị cũ đúng lúc nó đã sai.
func TestVirtualPointsNeverAnswer304OnTheirRevisionETag(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	seed := func(value string) {
		body := `{"items":[{"id":"VP1","tag":"vp one","label":"A","signalType":"float","enabled":true,"writable":true,"value":` + value + `}]}`
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("seed config: %v", err)
		}
	}
	seed("1")
	handler := app.Router()
	first := conditionalGet(t, handler, "/api/v1/virtual-points", token, "")
	assertStatus(t, first, http.StatusOK)
	etag := first.Header().Get("ETag")

	seed("2") // ghi ngoài phễu: revision giữ nguyên
	second := conditionalGet(t, handler, "/api/v1/virtual-points", token, etag)
	assertStatus(t, second, http.StatusOK)
	if second.Header().Get("ETag") != etag {
		t.Fatalf("tiền đề của test đổi: revision ETag %q → %q", etag, second.Header().Get("ETag"))
	}
	if !strings.Contains(second.Body.String(), `"value":2`) {
		t.Fatalf("body = %s; muốn giá trị mới 2", second.Body.String())
	}
}

// T63-108: khi Core đọc được, `GET /alarms` KHÔNG được chạm kho lịch sử — bản
// trước quét trọn tệp lịch sử ở mọi lượt rồi bỏ kết quả. Giữ khoá của kho trong
// lúc gọi: bản cũ treo ở khoá đó, bản mới trả lời ngay.
func TestAlarmsDoNotReadHistoryWhileCoreIsReadable(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{ID: "ALM-1", Severity: "high", Status: "active", Active: true}}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	handler := app.Router()
	// Lượt đầu ghi sự kiện "started" vào lịch sử (đúng việc của nó); từ lượt sau
	// danh sách không đổi nên không còn gì để ghi.
	assertStatus(t, conditionalGet(t, handler, "/api/v1/alarms", token, ""), http.StatusOK)
	app.alarmHistory.mu.Lock()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- conditionalGet(t, handler, "/api/v1/alarms", token, "") }()
	select {
	case resp := <-done:
		app.alarmHistory.mu.Unlock()
		assertStatus(t, resp, http.StatusOK)
		if !strings.Contains(resp.Body.String(), `"ALM-1"`) {
			t.Fatalf("body = %s; muốn cảnh báo sống", resp.Body.String())
		}
	case <-time.After(2 * time.Second):
		app.alarmHistory.mu.Unlock()
		<-done
		t.Fatal("GET /alarms chờ khoá kho lịch sử dù Core đọc được: nó đang quét lịch sử ở mọi lượt poll")
	}
}
