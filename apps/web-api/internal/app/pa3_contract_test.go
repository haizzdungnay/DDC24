package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// pa3Core là core giả có đủ ba mặt PA3 cần: đọc point, ghi có TTL, và trả lời
// `query` như Core thật (remaining_ttl_s do Core sở hữu, không do web-api tính).
type pa3Core struct {
	mu        sync.Mutex
	points    []PointDTO
	overrides map[string]uint32
	// queryCalls đếm số lần web-api hỏi Core, để test chứng minh nó không
	// spam IPC mỗi lần poll.
	queryCalls int
	failQuery  bool
	readErr    error
}

func newPA3Core() *pa3Core {
	return &pa3Core{
		overrides: map[string]uint32{},
		points: []PointDTO{
			{ID: "UI-01", Name: "UI-01", Kind: "UI", Value: float32(21.5), Quality: "good", Source: "core", UpdatedAt: "2026-08-08T03:00:00Z"},
			{ID: "UI-02", Name: "UI-02", Kind: "UI", Value: float32(0), Quality: "bad", Source: "core", UpdatedAt: "2026-08-08T03:00:01Z", Fault: true},
			{ID: "AO-01", Name: "AO-01", Kind: "AO", Value: float32(4.2), Quality: "good", Source: "core", UpdatedAt: "2026-08-08T03:00:02Z"},
			{ID: "DO-01", Name: "DO-01", Kind: "DO", Value: false, Quality: "good", Source: "core", UpdatedAt: "2026-08-08T03:00:03Z"},
		},
	}
}

func (c *pa3Core) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{
		CoreAvailable: true,
		IobusPresent:  true,
		Versions:      VersionStatus{MCUFW: "1.0"},
		IOP:           IOPStatus{Status: "normal"},
	}, nil
}

func (c *pa3Core) ReadPoints(context.Context) ([]PointDTO, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.readErr != nil {
		return nil, c.readErr
	}
	out := make([]PointDTO, len(c.points))
	copy(out, c.points)
	return out, nil
}

func (c *pa3Core) ForcePoint(ctx context.Context, id string, value any, release bool) (PointDTO, error) {
	return c.ForcePointTTL(ctx, id, value, release, 0, "web")
}

func (c *pa3Core) ForcePointTTL(_ context.Context, id string, value any, release bool, ttlS uint32, _ string) (PointDTO, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	point := PointDTO{ID: id, Name: id, Kind: pointKindFromID(id), Value: value, Quality: "good", Source: "core", Priority: "manual", UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), Forced: !release}
	if release {
		delete(c.overrides, canonicalPointID(id))
		point.Priority = "schedule"
		return point, nil
	}
	if ttlS > 0 {
		c.overrides[canonicalPointID(id)] = ttlS
		remaining := ttlS
		point.OverrideExpiresInS = &remaining
	}
	return point, nil
}

func (c *pa3Core) QueryPoint(_ context.Context, id, _ string) (PointDTO, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queryCalls++
	if c.failQuery {
		return PointDTO{}, fmt.Errorf("core unavailable")
	}
	point := PointDTO{ID: canonicalPointID(id), Kind: pointKindFromID(id), Quality: "good", Source: "core"}
	if remaining, ok := c.overrides[canonicalPointID(id)]; ok && remaining > 0 {
		point.Priority = "manual"
		point.OverrideExpiresInS = &remaining
		return point, nil
	}
	point.Priority = "schedule"
	return point, nil
}

func (c *pa3Core) expire(id string) {
	c.mu.Lock()
	delete(c.overrides, canonicalPointID(id))
	c.mu.Unlock()
}

func newPA3App(t *testing.T, role Role, core CoreStatusClient) (*App, string) {
	t.Helper()
	users := writeTestUsers(t, "admin123", role)
	app, err := NewApp(testConfig(t, users), nil, core, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	return app, token
}

func doJSON(t *testing.T, app *App, method, path, body, token string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := newAuthRequest(method, path, body, token)
	rec := httptest.NewRecorder()
	app.Router().ServeHTTP(rec, req)
	var payload map[string]any
	if rec.Body.Len() > 0 {
		_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	}
	return rec, payload
}

// PA3-101: read model Overview phải versioned và có đủ khối bắt buộc của §5.1.
func TestOverviewSchemaAndDomains(t *testing.T) {
	app, token := newPA3App(t, RoleViewer, newPA3Core())
	rec, payload := doJSON(t, app, http.MethodGet, "/api/v1/overview", "", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if int(payload["schemaVersion"].(float64)) != OverviewSchemaVersion {
		t.Fatalf("schemaVersion = %v, want %d", payload["schemaVersion"], OverviewSchemaVersion)
	}
	for _, key := range []string{"generatedAt", "controller", "overallState", "alarms", "points", "health", "attention", "capabilities"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("thiếu khối %q trong overview: %s", key, rec.Body.String())
		}
	}
	health, _ := payload["health"].([]any)
	seen := map[string]bool{}
	for _, item := range health {
		domain, _ := item.(map[string]any)
		name, _ := domain["domain"].(string)
		seen[name] = true
		for _, required := range []string{"state", "reasonCode", "source", "observedAt"} {
			if value, ok := domain[required].(string); !ok || strings.TrimSpace(value) == "" {
				t.Fatalf("domain %q thiếu %q: %#v", name, required, domain)
			}
		}
	}
	for _, domain := range []string{"controller", "local_io", "modbus", "network", "historian"} {
		if !seen[domain] {
			t.Fatalf("thiếu domain health %q", domain)
		}
	}
}

// UX-REQ §4.2 + PA3-F01: base SKU không có DI, nên Operating Summary không
// được có hàng DI và capability phải nói thẳng con số 0.
func TestOverviewNeverInventsDigitalInputs(t *testing.T) {
	app, token := newPA3App(t, RoleViewer, newPA3Core())
	_, payload := doJSON(t, app, http.MethodGet, "/api/v1/overview", "", token)
	caps, _ := payload["capabilities"].(map[string]any)
	if caps["digitalInputs"].(float64) != 0 {
		t.Fatalf("digitalInputs = %v, base SKU Rev A không có DI riêng", caps["digitalInputs"])
	}
	points, _ := payload["points"].(map[string]any)
	groups, _ := points["groups"].([]any)
	for _, item := range groups {
		group, _ := item.(map[string]any)
		if kind, _ := group["kind"].(string); kind == "DI" {
			t.Fatalf("Operating Summary có hàng DI giả: %#v", group)
		}
	}
}

// §5.1: mất authority là trạng thái ƯU TIÊN CAO NHẤT, không được gộp vào
// "degraded" hay tệ hơn là hiện xanh.
func TestOverviewOverallOfflineWhenCoreUnreachable(t *testing.T) {
	app, token := newPA3App(t, RoleViewer, offlineCore{})
	_, payload := doJSON(t, app, http.MethodGet, "/api/v1/overview", "", token)
	if payload["overallState"] != HealthOffline {
		t.Fatalf("overallState = %v, want %q", payload["overallState"], HealthOffline)
	}
	if payload["connected"] != false {
		t.Fatalf("connected = %v, want false", payload["connected"])
	}
}

type offlineCore struct{}

func (offlineCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: false, IOP: IOPStatus{Status: "fault"}}, fmt.Errorf("core socket unavailable")
}

// PA3-302: point chất lượng bad phải xuất hiện trong Attention với target
// drill-down được, chứ không chỉ là một con số tổng.
func TestOverviewAttentionSurfacesBadPoint(t *testing.T) {
	app, token := newPA3App(t, RoleViewer, newPA3Core())
	_, payload := doJSON(t, app, http.MethodGet, "/api/v1/overview", "", token)
	attention, _ := payload["attention"].([]any)
	found := false
	for _, item := range attention {
		row, _ := item.(map[string]any)
		if row["targetType"] == "point" && row["targetId"] == "UI-02" {
			found = true
			if row["severity"] != "high" {
				t.Fatalf("severity của point bad = %v, want high", row["severity"])
			}
		}
	}
	if !found {
		t.Fatalf("UI-02 (quality=bad) không có trong attention: %s", pa3JSON(t, attention))
	}
}

// PA3-103/104: mỗi lệnh đi qua audit phải để lại một dòng Activity đọc được
// bằng API, và KHÔNG được mang theo secret.
func TestActivityRecordsPointCommandWithoutSecrets(t *testing.T) {
	core := newPA3Core()
	app, token := newPA3App(t, RoleAdmin, core)
	rec, _ := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"value":5.5,"ttlS":120}`, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("force status = %d body=%s", rec.Code, rec.Body.String())
	}
	_, payload := doJSON(t, app, http.MethodGet, "/api/v1/activity?limit=20", "", token)
	if int(payload["schemaVersion"].(float64)) != ActivitySchemaVersion {
		t.Fatalf("activity schemaVersion = %v", payload["schemaVersion"])
	}
	items, _ := payload["items"].([]any)
	if len(items) == 0 {
		t.Fatalf("activity rỗng sau khi ép AO-01")
	}
	override := findActivity(items, "point_override")
	if override == nil {
		t.Fatalf("không có sự kiện point_override: %s", pa3JSON(t, items))
	}
	if override["objectId"] != "AO-01" {
		t.Fatalf("objectId = %v, want AO-01", override["objectId"])
	}
	if override["outcome"] != "accepted" {
		t.Fatalf("outcome = %v, want accepted", override["outcome"])
	}
	body := strings.ToLower(pa3JSON(t, items))
	for _, secret := range []string{"admin123", "password", "bearer", "token"} {
		if strings.Contains(body, secret) {
			t.Fatalf("activity chứa dữ liệu nhạy cảm %q: %s", secret, body)
		}
	}
}

func pa3JSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(data)
}

func findActivity(items []any, action string) map[string]any {
	for _, item := range items {
		row, _ := item.(map[string]any)
		if row["action"] == action {
			return row
		}
	}
	return nil
}

// PA3-103: phân trang phải ổn định và không trả trùng dòng.
func TestActivityPaginationIsStable(t *testing.T) {
	app, token := newPA3App(t, RoleAdmin, newPA3Core())
	for i := 0; i < 12; i++ {
		app.RecordSystemActivity("override_expired", "point", fmt.Sprintf("AO-0%d", i%4+1), "expired", "core_ttl", "")
	}
	_, first := doJSON(t, app, http.MethodGet, "/api/v1/activity?limit=5", "", token)
	firstItems, _ := first["items"].([]any)
	if len(firstItems) != 5 {
		t.Fatalf("trang đầu có %d dòng, want 5", len(firstItems))
	}
	cursor, ok := first["nextCursor"].(float64)
	if !ok {
		t.Fatalf("nextCursor thiếu: %s", pa3JSON(t, first))
	}
	_, second := doJSON(t, app, http.MethodGet, fmt.Sprintf("/api/v1/activity?limit=5&before=%d", int(cursor)), "", token)
	secondItems, _ := second["items"].([]any)
	seen := map[float64]bool{}
	for _, item := range append(append([]any{}, firstItems...), secondItems...) {
		row, _ := item.(map[string]any)
		id, _ := row["id"].(float64)
		if seen[id] {
			t.Fatalf("phân trang trả trùng id %v", id)
		}
		seen[id] = true
	}
}

// PA3-107 / PA3-F05: TTL phải xuống tới Core và quay lại qua đường đọc, chứ
// không phải một hẹn giờ trong web-api hay trình duyệt.
func TestOverrideTTLIsOwnedByCore(t *testing.T) {
	core := newPA3Core()
	app, token := newPA3App(t, RoleOperator, core)
	rec, payload := doJSON(t, app, http.MethodPut, "/api/v1/points/DO-01", `{"value":true,"ttlS":90}`, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if payload["overrideExpiresInS"].(float64) != 90 {
		t.Fatalf("overrideExpiresInS = %v, want 90", payload["overrideExpiresInS"])
	}

	// Đọc lại như một trình duyệt vừa reload: trạng thái ép tay vẫn phải thấy.
	_, detail := doJSON(t, app, http.MethodGet, "/api/v1/points/DO-01", "", token)
	if detail["forced"] != true {
		t.Fatalf("forced = %v sau reload, want true", detail["forced"])
	}
	if detail["overrideExpiresInS"].(float64) != 90 {
		t.Fatalf("overrideExpiresInS sau reload = %v", detail["overrideExpiresInS"])
	}

	// Core nhả lệnh (TTL hết hạn ở phía Core). Web phải phản ánh, không giữ
	// một bản sao cũ.
	core.expire("DO-01")
	_, afterExpiry := doJSON(t, app, http.MethodGet, "/api/v1/points/DO-01", "", token)
	if _, present := afterExpiry["overrideExpiresInS"]; present {
		t.Fatalf("vẫn còn overrideExpiresInS sau khi Core nhả: %s", pa3JSON(t, afterExpiry))
	}
	if afterExpiry["forced"] == true {
		t.Fatalf("forced vẫn true sau khi Core nhả")
	}
}

// Core không trả lời KHÔNG được biến thành "đã nhả": output vật lý vẫn đang bị ép.
func TestOverrideKeptWhenCoreQueryFails(t *testing.T) {
	core := newPA3Core()
	app, token := newPA3App(t, RoleOperator, core)
	if rec, _ := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"value":7,"ttlS":600}`, token); rec.Code != http.StatusOK {
		t.Fatalf("force status = %d", rec.Code)
	}
	core.mu.Lock()
	core.failQuery = true
	core.mu.Unlock()

	_, detail := doJSON(t, app, http.MethodGet, "/api/v1/points/AO-01", "", token)
	if detail["forced"] != true {
		t.Fatalf("forced = %v khi Core không trả lời, want giữ nguyên true", detail["forced"])
	}
}

func TestOverrideTTLRangeIsValidated(t *testing.T) {
	app, token := newPA3App(t, RoleOperator, newPA3Core())
	for _, body := range []string{`{"value":1,"ttlS":0}`, `{"value":1,"ttlS":86401}`, `{"value":1,"ttlS":-5}`} {
		rec, _ := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", body, token)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body=%s status = %d, want 400", body, rec.Code)
		}
	}
	rec, _ := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"release":true,"ttlS":10}`, token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("release kèm ttlS status = %d, want 400", rec.Code)
	}
}

// PA3-407: viewer không được mutation, kể cả khi gọi thẳng URL.
func TestViewerCannotOverride(t *testing.T) {
	app, token := newPA3App(t, RoleViewer, newPA3Core())
	rec, _ := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"value":1,"ttlS":60}`, token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer override status = %d, want 403", rec.Code)
	}
}

// Overview và Activity là đường ĐỌC: viewer phải vào được, nếu không Landing
// của ca trực chỉ-đọc sẽ trống.
func TestViewerCanReadOverviewAndActivity(t *testing.T) {
	app, token := newPA3App(t, RoleViewer, newPA3Core())
	for _, path := range []string{"/api/v1/overview", "/api/v1/activity"} {
		rec, _ := doJSON(t, app, http.MethodGet, path, "", token)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200", path, rec.Code)
		}
	}
}

// Point thiếu timestamp không được biến thành "vừa cập nhật": `lastDataAt`
// chỉ nhận mốc thời gian THẬT do producer cấp (PA3-F04 ở phía backend).
func TestOverviewLastDataAtIgnoresMissingTimestamps(t *testing.T) {
	core := newPA3Core()
	core.points = []PointDTO{
		{ID: "UI-01", Kind: "UI", Value: float32(1), Quality: "good", Source: "core", UpdatedAt: ""},
		{ID: "UI-02", Kind: "UI", Value: float32(2), Quality: "good", Source: "core", UpdatedAt: "not-a-timestamp"},
	}
	app, token := newPA3App(t, RoleViewer, core)
	_, payload := doJSON(t, app, http.MethodGet, "/api/v1/overview", "", token)
	if value, present := payload["lastDataAt"]; present && value != nil {
		t.Fatalf("lastDataAt = %v khi không point nào có timestamp hợp lệ", value)
	}
}

/* ── PA3-408 — vòng đời override qua các sự cố thật ──────────────────────────
 *
 * Bốn kịch bản của §10.3 mà một suite unit thông thường bỏ lọt, vì chúng nói về
 * điều gì xảy ra KHI HẠ TẦNG THAY ĐỔI GIỮA CHỪNG chứ không về một lời gọi hàm.
 */

// Restart web-api KHÔNG được làm mất trạng thái ép tay: Core mới là nơi giữ nó.
//
// Mô phỏng restart bằng cách dựng một `App` MỚI trên cùng một Core — đúng thứ
// xảy ra khi `systemctl restart mkddc-web-pi` chạy: tiến trình mới, bộ nhớ
// trống, Core không đổi.
func TestOverrideSurvivesWebAPIRestart(t *testing.T) {
	core := newPA3Core()
	app, token := newPA3App(t, RoleOperator, core)
	if rec, _ := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"value":6.5,"ttlS":300}`, token); rec.Code != http.StatusOK {
		t.Fatalf("force status = %d", rec.Code)
	}

	restarted, token2 := newPA3App(t, RoleOperator, core)
	if restarted.overrides == nil {
		t.Fatal("app mới phải có registry riêng")
	}
	// Registry của tiến trình mới hoàn toàn trống — đó chính là điều kiện test.
	if ids := restarted.overrides.TrackedIDs(); len(ids) != 0 {
		t.Fatalf("registry sau restart phải rỗng, có %v", ids)
	}

	_, detail := doJSON(t, restarted, http.MethodGet, "/api/v1/points/AO-01", "", token2)
	if detail["forced"] != true {
		t.Fatalf("forced = %v sau restart web-api, want true (Core vẫn giữ lệnh)", detail["forced"])
	}
	remaining, ok := detail["overrideExpiresInS"].(float64)
	if !ok || remaining <= 0 {
		t.Fatalf("overrideExpiresInS = %v sau restart, want > 0", detail["overrideExpiresInS"])
	}
}

// TTL hết hạn ở phía Core ⇒ web phải NGỪNG báo forced, kể cả khi registry của
// nó vẫn còn một mục cũ chưa kịp dọn.
func TestOverrideExpiryFromCoreClearsWebState(t *testing.T) {
	core := newPA3Core()
	app, token := newPA3App(t, RoleOperator, core)
	doJSON(t, app, http.MethodPut, "/api/v1/points/DO-01", `{"value":true,"ttlS":5}`, token)
	if snapshot := app.overrides.Snapshot(); len(snapshot) == 0 {
		t.Fatal("registry phải theo dõi lệnh vừa gửi")
	}

	core.expire("DO-01") // Core tự nhả khi tới hạn (scan_loop).

	_, detail := doJSON(t, app, http.MethodGet, "/api/v1/points/DO-01", "", token)
	if _, present := detail["overrideExpiresInS"]; present {
		t.Fatalf("vẫn còn đếm ngược sau khi Core nhả: %s", pa3JSON(t, detail))
	}
	if detail["forced"] == true {
		t.Fatal("forced vẫn true sau khi Core nhả")
	}
	// Và registry phải tự dọn, không giữ rác cho lần đọc sau.
	if ids := app.overrides.TrackedIDs(); len(ids) != 0 {
		t.Fatalf("registry còn %v sau khi Core nhả", ids)
	}
}

// Hai client ép cùng một point: lệnh sau thắng, và CẢ HAI đều để lại vết audit
// truy được. Không được có lệnh nào biến mất im lặng.
func TestConcurrentOverridesAreBothAudited(t *testing.T) {
	core := newPA3Core()
	app, token := newPA3App(t, RoleAdmin, core)

	if rec, _ := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"value":3,"ttlS":60}`, token); rec.Code != http.StatusOK {
		t.Fatalf("lệnh 1 status = %d", rec.Code)
	}
	rec, payload := doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"value":9,"ttlS":120}`, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("lệnh 2 status = %d", rec.Code)
	}
	if payload["overrideExpiresInS"].(float64) != 120 {
		t.Fatalf("lệnh sau phải thắng: overrideExpiresInS = %v, want 120", payload["overrideExpiresInS"])
	}

	_, page := doJSON(t, app, http.MethodGet, "/api/v1/activity?limit=50&action=point_override", "", token)
	items, _ := page["items"].([]any)
	count := 0
	for _, item := range items {
		row, _ := item.(map[string]any)
		if row["objectId"] == "AO-01" {
			count++
		}
	}
	if count < 2 {
		t.Fatalf("chỉ có %d vết audit cho hai lệnh cạnh tranh: %s", count, pa3JSON(t, items))
	}
}

// Đọc danh sách nhiều lần trong một nhịp không được biến thành nhiều vòng IPC
// cho cùng một point: `/points` bị poll bởi mọi tab đang mở.
func TestOverrideRefreshIsRateLimited(t *testing.T) {
	core := newPA3Core()
	app, token := newPA3App(t, RoleOperator, core)
	doJSON(t, app, http.MethodPut, "/api/v1/points/AO-01", `{"value":2,"ttlS":600}`, token)

	core.mu.Lock()
	core.queryCalls = 0
	core.mu.Unlock()

	for i := 0; i < 5; i++ {
		if rec, _ := doJSON(t, app, http.MethodGet, "/api/v1/points", "", token); rec.Code != http.StatusOK {
			t.Fatalf("đọc điểm lần %d status = %d", i, rec.Code)
		}
	}

	core.mu.Lock()
	calls := core.queryCalls
	core.mu.Unlock()
	// Năm lần poll liên tiếp trong chưa tới `overrideQueryInterval` ⇒ nhiều nhất
	// một lần hỏi Core. Không chốt "bằng 0" vì lần đầu có thể rơi đúng biên.
	if calls > 1 {
		t.Fatalf("5 lần poll gây %d lần query Core, want <= 1", calls)
	}
}
