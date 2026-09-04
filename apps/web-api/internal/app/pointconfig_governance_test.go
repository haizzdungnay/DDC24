package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mkddc-web/internal/auth"
)

/* ISS-PIO-37 — RBAC / Audit / Revision cho cấu hình Point.
 *
 * Hai tiêu chí được canh ở đây:
 *   1. Mọi thay đổi cấu hình Point ghi `actor / time / old value / new value`.
 *   2. Chống lost-update bằng revision hoặc ETag.
 * (Tiêu chí 3 — lệnh test output giữ TTL + audit — đã đóng ở `ISS-PIO-26`, và
 * `commissioning_test.go` canh nó.)
 */

// auditSink thu bản ghi audit để đọc lại `Detail`.
type auditSink struct{ records []auth.AuditRecord }

func (s *auditSink) RecordActivity(record auth.AuditRecord) { s.records = append(s.records, record) }

func (s *auditSink) find(action string) (auth.AuditRecord, bool) {
	for i := len(s.records) - 1; i >= 0; i-- {
		if s.records[i].Action == action {
			return s.records[i], true
		}
	}
	return auth.AuditRecord{}, false
}

func (s *auditSink) actions() []string {
	out := make([]string, 0, len(s.records))
	for _, record := range s.records {
		out = append(out, record.Action)
	}
	return out
}

/* ---------- Tiêu chí 1: old value → new value ---------- */

// Sửa một điểm ảo phải để lại vết mang CẢ giá trị cũ lẫn giá trị mới.
func TestVirtualPointChangeAuditCarriesOldAndNewValue(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	sink := &auditSink{}
	app.audit.SetSink(sink)

	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(`{"items":[{"id":"VP1","tag":"phong-cu","signalType":"float","enabled":true,"writable":true,"value":1}]}`), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	req := withCurrentVPETag(t, app, newAuthRequest(http.MethodPut, "/api/v1/virtual-points/VP1",
		`{"tag":"hoi-moi","signalType":"float","enabled":true,"writable":true,"value":1}`, token))
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	assertStatus(t, w, http.StatusOK)

	record, ok := sink.find("virtual-points.update")
	if !ok {
		t.Fatalf("không có vết `virtual-points.update`; đã ghi: %v", sink.actions())
	}
	if record.Actor != "admin" {
		t.Fatalf("actor = %q; muốn admin — không biết AI đổi thì vết audit vô dụng", record.Actor)
	}
	/* Cả HAI vế phải có mặt. Một vết chỉ nói "label đã đổi" trả lời được câu
	 * "có đổi không" nhưng không trả lời được "đổi từ gì sang gì" — mà đó mới là
	 * câu người điều tra sự cố hỏi. */
	if !strings.Contains(record.Detail, "phong-cu") {
		t.Errorf("detail thiếu GIÁ TRỊ CŨ: %q", record.Detail)
	}
	if !strings.Contains(record.Detail, "hoi-moi") {
		t.Errorf("detail thiếu GIÁ TRỊ MỚI: %q", record.Detail)
	}
}

/* io-bundle: hai tệp của MỘT giao dịch phải nằm trong MỘT tóm tắt, và đường dẫn
 * phải nói trường thuộc tệp nào.
 *
 * Kiểm thẳng hàm gộp thay vì đi qua HTTP: một PUT io-bundle hợp lệ đòi đủ 16 UI
 * + 4 AO + 4 DO kèm tag/name đúng chuẩn, nên test qua HTTP sẽ phải `t.Skip` khi
 * dựng thiếu — và một test skip được thì có ngày nó skip mãi mà không ai biết
 * nó đã thôi kiểm gì. */
func TestIOBundleDiffMergesBothFilesWithFilePrefix(t *testing.T) {
	beforeIO := ConfigIO{AO: []map[string]any{{"ch": 1, "mode": "0-10V"}}}
	afterIO := ConfigIO{AO: []map[string]any{{"ch": 1, "mode": "4-20mA"}}}
	beforeSafe := ConfigSafeState{AO: []map[string]any{{"ch": 1, "safe": 0}}}
	afterSafe := ConfigSafeState{AO: []map[string]any{{"ch": 1, "safe": 4}}}

	summary := summarizeIOBundleDiff(beforeIO, beforeSafe, afterIO, afterSafe)
	if !strings.Contains(summary, "io.ao[1].mode") {
		t.Errorf("thiếu thay đổi mode kèm tiền tố tệp: %q", summary)
	}
	if !strings.Contains(summary, "safe_state.ao[1].safe") {
		t.Errorf("thiếu thay đổi safe kèm tiền tố tệp: %q", summary)
	}
	// Cả hai vế của mỗi thay đổi phải có mặt.
	for _, want := range []string{"0-10V", "4-20mA"} {
		if !strings.Contains(summary, want) {
			t.Errorf("tóm tắt thiếu %q: %q", want, summary)
		}
	}
}

/* Nhiễu cơ học không được chiếm chỗ của thay đổi thật.
 *
 * Tóm tắt có trần 8 trường. Mỗi lần lưu đều bump `revision`, đổi `checksum`, và
 * bump `generation` của mọi điểm ảo — nếu đếm cả chúng thì một cấu hình vài chục
 * điểm sẽ đẩy thay đổi THẬT ra khỏi tóm tắt, và vết audit tuy "có nội dung"
 * nhưng không trả lời được gì. */
func TestConfigDiffDropsMechanicalFields(t *testing.T) {
	before := map[string]any{"revision": 4, "checksum": "aaa", "items": []any{
		map[string]any{"id": "VP1", "label": "Cũ", "generation": 7}}}
	after := map[string]any{"revision": 5, "checksum": "bbb", "items": []any{
		map[string]any{"id": "VP1", "label": "Mới", "generation": 8}}}

	summary := summarizeConfigDiff(before, after)
	if !strings.Contains(summary, "Cũ") || !strings.Contains(summary, "Mới") {
		t.Fatalf("tóm tắt mất thay đổi thật: %q", summary)
	}
	for _, noise := range []string{"revision", "checksum", "generation"} {
		if strings.Contains(summary, noise) {
			t.Errorf("tóm tắt còn nhiễu cơ học %q: %q", noise, summary)
		}
	}
}

/* ---------- Tiêu chí 2: chống lost-update ---------- */

// Kịch bản lost-update thật: hai client cùng đọc revision N, cùng sửa. Client
// thứ hai PHẢI bị chặn thay vì đè mất thay đổi của client thứ nhất.
func TestVirtualPointUpdateRejectsStaleRevision(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(`{"items":[{"id":"VP1","tag":"vp one","label":"A","signalType":"float","enabled":true,"writable":true,"value":1}]}`), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	// Cả hai client cùng đọc một ETag.
	authority, err := app.readPointNamespaceAuthority()
	if err != nil {
		t.Fatalf("đọc authority: %v", err)
	}
	sharedETag := formatVirtualPointETag(authority.Revision)

	// Client 1 ghi trước — thành công, revision tiến một bậc.
	first := newAuthRequest(http.MethodPut, "/api/v1/virtual-points/VP1",
		`{"tag":"client-mot","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	first.Header.Set("If-Match", sharedETag)
	w1 := httptest.NewRecorder()
	app.Router().ServeHTTP(w1, first)
	assertStatus(t, w1, http.StatusOK)

	// Client 2 ghi sau với ETag ĐÃ CŨ — phải bị chặn.
	second := newAuthRequest(http.MethodPut, "/api/v1/virtual-points/VP1",
		`{"tag":"client-hai","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	second.Header.Set("If-Match", sharedETag)
	w2 := httptest.NewRecorder()
	app.Router().ServeHTTP(w2, second)
	if w2.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d; muốn 412 — client 2 vừa đè mất thay đổi của client 1 mà không ai biết; body=%s", w2.Code, w2.Body.String())
	}

	// ...và thay đổi của client 1 còn nguyên trên đĩa.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("đọc config: %v", err)
	}
	var cfg ConfigVirtualPoints
	if err := json.Unmarshal(data, &cfg); err != nil || len(cfg.Items) != 1 {
		t.Fatalf("config = %s err=%v", data, err)
	}
	if cfg.Items[0].Tag != "client-mot" {
		t.Fatalf("tag = %q; muốn client-mot — thay đổi của client ghi trước đã bị mất", cfg.Items[0].Tag)
	}
}

// Thiếu `If-Match` là 428, KHÁC với gửi sai (412): hai hành động khắc phục khác
// nhau — thiếu thì client phải gửi header, lệch thì người dùng phải tải lại.
func TestVirtualPointWritesDistinguishMissingFromStalePrecondition(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(`{"items":[{"id":"VP1","tag":"vp one","label":"A","signalType":"float","enabled":true,"writable":true,"value":1}]}`), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	body := `{"tag":"vp one","label":"B","signalType":"float","enabled":true,"writable":true,"value":1}`

	missing := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/virtual-points/VP1", body, token)
	if missing.Code != http.StatusPreconditionRequired {
		t.Fatalf("thiếu If-Match: status = %d; muốn 428; body=%s", missing.Code, missing.Body.String())
	}

	stale := newAuthRequest(http.MethodPut, "/api/v1/virtual-points/VP1", body, token)
	stale.Header.Set("If-Match", formatVirtualPointETag(9999))
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, stale)
	if w.Code != http.StatusPreconditionFailed {
		t.Fatalf("If-Match cũ: status = %d; muốn 412; body=%s", w.Code, w.Body.String())
	}
}

// Ba đường ghi có thể ĐÈ MẤT dữ liệu đều phải được canh — không sót đường nào.
func TestEveryOverwritingVirtualPointPathRequiresPrecondition(t *testing.T) {
	cases := []struct{ name, method, path, body string }{
		{"cập nhật một điểm", http.MethodPut, "/api/v1/virtual-points/VP1", `{"tag":"vp one","label":"B","signalType":"float","enabled":true,"writable":true,"value":1}`},
		{"xoá một điểm", http.MethodDelete, "/api/v1/virtual-points/VP1", ""},
		{"ghi lại cả cấu hình", http.MethodPut, "/api/v1/system/config/virtual-points", `{"items":[]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, token := newTestAppWithAdmin(t)
			path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
			if err := os.WriteFile(path, []byte(`{"items":[{"id":"VP1","tag":"vp one","label":"A","signalType":"float","enabled":true,"writable":true,"value":1}]}`), 0o644); err != nil {
				t.Fatalf("seed config: %v", err)
			}
			resp := serveAuth(t, app.Router(), tc.method, tc.path, tc.body, token)
			if resp.Code != http.StatusPreconditionRequired {
				t.Fatalf("status = %d; muốn 428 — đường ghi này đè được dữ liệu mà không đòi If-Match; body=%s", resp.Code, resp.Body.String())
			}
		})
	}
}

/* TẠO MỚI cố ý KHÔNG đòi `If-Match`, và đó là quyết định chứ không phải sót.
 *
 * Thêm một điểm mới không đè lên thay đổi của ai: hai người tạo đồng thời thì cả
 * hai điểm đều được tạo. `If-Match` là phép so PHIÊN BẢN của một tài nguyên đã
 * tồn tại; ở đây không có phiên bản nào để so. Đòi nó sẽ bắt người dùng tải lại
 * danh sách trước mỗi lần thêm mà không ngăn được mất mát nào. */
func TestVirtualPointCreateDoesNotRequirePrecondition(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"vp moi","label":"Điểm mới","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	if resp.Code != http.StatusCreated && resp.Code != http.StatusOK {
		t.Fatalf("status = %d; tạo mới không được đòi If-Match; body=%s", resp.Code, resp.Body.String())
	}
}

// GET phải phát ETag, nếu không client không có gì để gửi lại.
func TestVirtualPointListPublishesETag(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/virtual-points", "", token)
	assertStatus(t, resp, http.StatusOK)
	etag := resp.Header().Get("ETag")
	if etag == "" {
		t.Fatal("GET không phát ETag: client không có cơ sở nào để gửi If-Match")
	}
	if _, _, ok := parseVirtualPointETag(etag); !ok {
		t.Fatalf("ETag %q không đọc lại được bằng chính bộ phân tích của server", etag)
	}
}

// `If-Match: *` là ghi đè CÓ CHỦ ĐÍCH theo đúng ngữ nghĩa HTTP — chấp nhận, vì
// người gõ `*` đã nói rõ họ muốn ghi đè bất kể phiên bản.
func TestVirtualPointAcceptsExplicitWildcardOverride(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(`{"items":[{"id":"VP1","tag":"vp one","label":"A","signalType":"float","enabled":true,"writable":true,"value":1}]}`), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	req := newAuthRequest(http.MethodPut, "/api/v1/virtual-points/VP1",
		`{"tag":"vp one","label":"B","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	req.Header.Set("If-Match", "*")
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	assertStatus(t, w, http.StatusOK)
}
