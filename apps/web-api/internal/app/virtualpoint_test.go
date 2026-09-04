package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestVirtualPointCreateAllocatesVP(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"room setpoint","label":"Room Setpoint","signalType":"float","enabled":true,"writable":true,"value":22.5,"unit":"C"}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var got VirtualPoint
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != "VP1" || got.SignalType != "float" || got.Value != 22.5 {
		t.Fatalf("created point = %+v, want VP1 float", got)
	}
	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "virtual_points.conf"))
	if err != nil {
		t.Fatalf("read virtual_points.conf: %v", err)
	}
	var cfg ConfigVirtualPoints
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_points.conf: %v", err)
	}
	if len(cfg.Items) != 1 || cfg.Items[0].ID != "VP1" {
		t.Fatalf("stored config = %+v", cfg)
	}
}

func TestVirtualPointListMissingConfigReturnsEmptyArray(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodGet, "/api/v1/virtual-points", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if w.Body.String() != "[]\n" {
		t.Fatalf("body = %q, want []", w.Body.String())
	}
}

func TestVirtualPointCreateSerializesAllocation(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	router := app.Router()
	const count = 6
	errs := make(chan string, count)
	var wg sync.WaitGroup

	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			body := fmt.Sprintf(`{"tag":"point %d","label":"Point %d","signalType":"integer","enabled":true,"writable":true,"value":1}`, index+1, index+1)
			req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", body, token)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusCreated {
				errs <- w.Body.String()
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("create failed: %s", err)
	}

	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "virtual_points.conf"))
	if err != nil {
		t.Fatalf("read virtual_points.conf: %v", err)
	}
	var cfg ConfigVirtualPoints
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_points.conf: %v", err)
	}
	seen := map[string]bool{}
	for _, item := range cfg.Items {
		if seen[item.ID] {
			t.Fatalf("duplicate id in %+v", cfg.Items)
		}
		seen[item.ID] = true
	}
	if len(cfg.Items) != count {
		t.Fatalf("items = %d, want %d: %+v", len(cfg.Items), count, cfg.Items)
	}
}

func TestVirtualPointRejectsBadSignalValue(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"id":"AV-001","tag":"bad bool","label":"Bad Bool","signalType":"boolean","enabled":true,"value":"maybe"}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if !hasValidationPath(t, w.Body.Bytes(), "items[0].value") {
		t.Fatalf("body missing value path: %s", w.Body.String())
	}
}

func TestVirtualPointRejectsLogQuota(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	items := make([]VirtualPoint, 0, virtualPointLog10Capacity+1)
	interval := 10
	for i := 1; i <= virtualPointLog10Capacity+1; i++ {
		items = append(items, VirtualPoint{ID: formatPointID("VP", i), Label: "Diag", SignalType: "float", Enabled: true, Writable: true, LogEnabled: true, LogIntervalMs: &interval, Value: 1})
	}
	body, _ := json.Marshal(ConfigVirtualPoints{Items: items})
	req := withCurrentVPETag(t, app, newAuthRequest(http.MethodPut, "/api/v1/system/config/virtual-points", string(body), token))
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestVirtualPointUpdatePreservesMissingWritableFalse(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(`{"items":[{"id":"VP1","label":"A","signalType":"float","enabled":true,"writable":false,"value":1}]}`), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	req := withCurrentVPETag(t, app, newAuthRequest(http.MethodPut, "/api/v1/virtual-points/AV-001", `{"tag":"vp one","label":"B","signalType":"float","enabled":true,"value":2}`, token))
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read virtual_points.conf: %v", err)
	}
	var cfg ConfigVirtualPoints
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_points.conf: %v", err)
	}
	if len(cfg.Items) != 1 || cfg.Items[0].Writable {
		t.Fatalf("stored config = %+v, want writable=false", cfg)
	}
}

func TestVirtualPointRejectsLoggedStringAndLongDiagnosticRetention(t *testing.T) {
	interval := 10
	items := []VirtualPoint{
		{ID: "VP1", Label: "Text", SignalType: "string", Enabled: true, Writable: true, LogEnabled: true, LogIntervalMs: &interval, RetentionS: 60, Value: "123"},
		{ID: "VP2", Label: "Diag", SignalType: "float", Enabled: true, Writable: true, LogEnabled: true, LogIntervalMs: &interval, RetentionS: 2 * 60 * 60, Value: 1},
	}
	errs := validateConfigVirtualPoints(ConfigVirtualPoints{Items: items})
	if !hasConfigErrorPath(errs, "items[0].signalType") {
		t.Fatalf("errors missing logged string signalType: %+v", errs)
	}
	if !hasConfigErrorPath(errs, "items[1].retentionS") {
		t.Fatalf("errors missing diagnostic retention: %+v", errs)
	}
}

func TestVirtualPointPreservesWizardMetadata(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"vp wizard","label":"VP Wizard","signalType":"float","enabled":true,"writable":true,"value":5,"unit":"C","displayMin":-10,"displayMax":80,"rangeMultiplier":1,"filterSamples":5,"sensorCal":0.2,"mathFunction":2}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var got VirtualPoint
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Unit != "degC" || got.DisplayMin != -10 || got.DisplayMax != 80 || got.RangeMultiplier != 1 || got.FilterSamples != 5 || got.SensorCal != 0.2 || got.MathFunction != 2 {
		t.Fatalf("created point metadata = %+v", got)
	}
}

func TestVirtualPointDeleteRemovesItem(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(`{"items":[{"id":"VP1","label":"A","signalType":"float","enabled":true,"writable":true,"value":1}]}`), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	req := withCurrentVPETag(t, app, newAuthRequest(http.MethodDelete, "/api/v1/virtual-points/AV-001", "", token))
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read virtual_points.conf: %v", err)
	}
	var cfg ConfigVirtualPoints
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_points.conf: %v", err)
	}
	if len(cfg.Items) != 0 {
		t.Fatalf("items = %+v, want empty", cfg.Items)
	}
}

func TestVirtualPointRecreateIncrementsPersistedGeneration(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	router := app.Router()

	create := func(tag string) VirtualPoint {
		req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", fmt.Sprintf(`{"tag":%q,"signalType":"float","enabled":true,"writable":true,"value":1}`, tag), token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("create status = %d body=%s", w.Code, w.Body.String())
		}
		var point VirtualPoint
		if err := json.Unmarshal(w.Body.Bytes(), &point); err != nil {
			t.Fatalf("decode create response: %v", err)
		}
		return point
	}

	first := create("first")
	if first.ID != "VP1" || first.Generation != 1 {
		t.Fatalf("first = %+v, want VP1 generation 1", first)
	}

	deleteReq := withCurrentVPETag(t, app, newAuthRequest(http.MethodDelete, "/api/v1/virtual-points/VP1", "", token))
	deleteResponse := httptest.NewRecorder()
	router.ServeHTTP(deleteResponse, deleteReq)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", deleteResponse.Code, deleteResponse.Body.String())
	}

	second := create("second")
	if second.ID != "VP1" || second.Generation != 2 {
		t.Fatalf("second = %+v, want VP1 generation 2", second)
	}

	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "point_namespace.conf"))
	if err != nil {
		t.Fatalf("read point_namespace.conf: %v", err)
	}
	var namespace struct {
		Revision    uint64            `json:"revision"`
		Generations map[string]uint64 `json:"generations"`
	}
	if err := json.Unmarshal(data, &namespace); err != nil {
		t.Fatalf("parse point_namespace.conf: %v", err)
	}
	if namespace.Revision != 3 || namespace.Generations["VP1"] != 2 {
		t.Fatalf("namespace = %+v, want revision 3 and VP1 generation 2", namespace)
	}
}

func TestVirtualPointGenerationRecoversAfterNamespaceWriteFailure(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.pointNamespaceWriter = func(string, []byte, os.FileMode) error { return errors.New("injected namespace write failure") }
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"first","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "virtual_points.conf"))
	if err != nil {
		t.Fatalf("read committed virtual config: %v", err)
	}
	var cfg ConfigVirtualPoints
	if err := json.Unmarshal(data, &cfg); err != nil || len(cfg.Items) != 1 || cfg.Items[0].Generation != 1 {
		t.Fatalf("config = %+v err=%v, want VP generation 1", cfg, err)
	}

	app.pointNamespaceWriter = writeConfigFileAtomic
	deleteReq := withCurrentVPETag(t, app, newAuthRequest(http.MethodDelete, "/api/v1/virtual-points/VP1", "", token))
	deleteResponse := httptest.NewRecorder()
	app.Router().ServeHTTP(deleteResponse, deleteReq)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", deleteResponse.Code, deleteResponse.Body.String())
	}
	createReq := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"second","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	createResponse := httptest.NewRecorder()
	app.Router().ServeHTTP(createResponse, createReq)
	var recreated VirtualPoint
	if err := json.Unmarshal(createResponse.Body.Bytes(), &recreated); err != nil || createResponse.Code != http.StatusCreated || recreated.Generation != 2 {
		t.Fatalf("recreate status=%d point=%+v err=%v", createResponse.Code, recreated, err)
	}
}

func TestCoreCommandPointIDCanonicalizesVirtualAliases(t *testing.T) {
	tests := map[string]string{
		"AV-01":  "AV1",
		"BV_09":  "BV9",
		"MSV-02": "MSV2",
	}
	for in, want := range tests {
		if got := coreCommandPointID(in); got != want {
			t.Fatalf("coreCommandPointID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCanonicalPointIDCanonicalizesVirtualAliases(t *testing.T) {
	tests := map[string]string{
		"AV-01":  "AV1",
		"BV_09":  "BV9",
		"MSV-02": "MSV2",
	}
	for in, want := range tests {
		if got := canonicalPointID(in); got != want {
			t.Fatalf("canonicalPointID(%q) = %q, want %q", in, got, want)
		}
	}
}

func hasValidationPath(t *testing.T, body []byte, path string) bool {
	t.Helper()
	var resp struct {
		Details []configValidationError `json:"details"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode validation body: %v", err)
	}
	return hasConfigErrorPath(resp.Details, path)
}

func hasConfigErrorPathContaining(errs []configValidationError, needle string) bool {
	for _, err := range errs {
		if strings.Contains(err.Path, needle) {
			return true
		}
	}
	return false
}

// F-PROG-ASBUILT-014: validateConfigVirtualPoints phải chặn boundPointId sai
// định dạng/capacity/kiểu tín hiệu, và không cho hai VP đang enabled cùng
// chiếm một slot Core AV/BV — nếu không, syncVirtualPointToCore sẽ ghi đè
// lẫn nhau âm thầm mà không ai biết.
func TestValidateConfigVirtualPointsBoundPointId(t *testing.T) {
	cases := []struct {
		name    string
		items   []VirtualPoint
		wantErr bool
	}{
		{"valid AV binding", []VirtualPoint{{ID: "VP1", SignalType: "float", BoundPointID: "AV-01"}}, false},
		{"valid AV integer binding", []VirtualPoint{{ID: "VP1", SignalType: "integer", BoundPointID: "AV-01"}}, false},
		{"valid BV binding", []VirtualPoint{{ID: "VP1", SignalType: "boolean", BoundPointID: "BV-01"}}, false},
		{"unbound VP unaffected", []VirtualPoint{{ID: "VP1", SignalType: "string"}}, false},
		{"bad prefix", []VirtualPoint{{ID: "VP1", SignalType: "float", BoundPointID: "MSV-01"}}, true},
		{"AV out of range", []VirtualPoint{{ID: "VP1", SignalType: "float", BoundPointID: "AV-33"}}, true},
		{"BV out of range", []VirtualPoint{{ID: "VP1", SignalType: "boolean", BoundPointID: "BV-17"}}, true},
		{"AV requires numeric signal", []VirtualPoint{{ID: "VP1", SignalType: "boolean", BoundPointID: "AV-01"}}, true},
		{"BV requires boolean signal", []VirtualPoint{{ID: "VP1", SignalType: "float", BoundPointID: "BV-01"}}, true},
		{"string signal cannot bind", []VirtualPoint{{ID: "VP1", SignalType: "string", BoundPointID: "AV-01"}}, true},
		{"duplicate slot rejected", []VirtualPoint{
			{ID: "VP1", SignalType: "float", Enabled: true, BoundPointID: "AV-01"},
			{ID: "VP2", SignalType: "float", Enabled: true, BoundPointID: "AV-01"},
		}, true},
		{"disabled VP does not conflict", []VirtualPoint{
			{ID: "VP1", SignalType: "float", Enabled: true, BoundPointID: "AV-01"},
			{ID: "VP2", SignalType: "float", Enabled: false, BoundPointID: "AV-01"},
		}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs := validateConfigVirtualPoints(ConfigVirtualPoints{Items: tc.items})
			got := hasConfigErrorPathContaining(errs, "boundPointId")
			if got != tc.wantErr {
				t.Fatalf("%s: boundPointId error = %v, want %v (errs=%+v)", tc.name, got, tc.wantErr, errs)
			}
		})
	}
}

// syncRecorderCore là core giả tối giản chỉ để ghi lại lệnh ForcePointTTL đã
// nhận — dùng riêng cho test đồng bộ VP->Core, không tái dùng pa3Core (PA3)
// vì pa3Core không lưu lại value/id đã ghi để assert.
type syncRecorderCore struct {
	mu    sync.Mutex
	calls []struct {
		id    string
		value any
	}
}

func (c *syncRecorderCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true}, nil
}

func (c *syncRecorderCore) ForcePointTTL(_ context.Context, id string, value any, _ bool, _ uint32, _ string) (PointDTO, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, struct {
		id    string
		value any
	}{id, value})
	return PointDTO{ID: id, Value: value, Quality: "good", Source: "core"}, nil
}

func (c *syncRecorderCore) lastCall() (string, any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.calls) == 0 {
		return "", nil, false
	}
	last := c.calls[len(c.calls)-1]
	return last.id, last.value, true
}

// F-PROG-ASBUILT-014 (phần READ): tạo một VP có boundPointId phải đẩy giá
// trị sang Core ngay qua ForcePointTTL — nếu không, slot AV/BV vẫn BAD/0 cho
// tới lần ghi giá trị kế tiếp và ST Program bind VP sẽ fail-closed vô cớ.
func TestVirtualPointCreateWithBoundPointIdSyncsToCore(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	core := &syncRecorderCore{}
	app, err := NewApp(cfg, nil, core, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"zone setpoint","signalType":"float","enabled":true,"writable":true,"value":28,"boundPointId":"AV-01"}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", w.Code, w.Body.String())
	}
	id, value, called := core.lastCall()
	if !called || id != "AV-01" || value != float64(28) {
		t.Fatalf("ForcePointTTL call = id=%q value=%v called=%v, want AV-01/28", id, value, called)
	}
}

// Ghi giá trị runtime của một VP đã bound (PUT .../virtual-points/{id}) cũng
// phải đồng bộ lại Core — đây là đường vận hành thường xuyên nhất (operator
// đổi setpoint), khác với lúc tạo mới.
func TestWriteVirtualPointValueWithBoundPointIdSyncsToCore(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	core := &syncRecorderCore{}
	app, err := NewApp(cfg, nil, core, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	createReq := newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"occupied","signalType":"boolean","enabled":true,"writable":true,"value":false,"boundPointId":"BV-01"}`, token)
	createW := httptest.NewRecorder()
	app.Router().ServeHTTP(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", createW.Code, createW.Body.String())
	}

	req := httptest.NewRequest(http.MethodPut, "/api/v1/points/VP1", strings.NewReader(`{"value":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("write status = %d body=%s", w.Code, w.Body.String())
	}
	id, value, called := core.lastCall()
	if !called || id != "BV-01" || value != true {
		t.Fatalf("ForcePointTTL call = id=%q value=%v called=%v, want BV-01/true", id, value, called)
	}
}

/* withCurrentVPETag gắn `If-Match` hiện hành lên một request ghi Virtual Point.
 *
 * `ISS-PIO-37` bắt buộc `If-Match` cho UPDATE / DELETE / ghi-cả-cấu-hình, vì đó
 * là ba đường có thể ĐÈ MẤT thay đổi của người khác. Test phải hành xử như một
 * client thật: đọc revision hiện tại rồi khai nó ra. Helper này CỐ Ý đọc
 * authority thay vì nhận một hằng số — một ETag gõ cứng sẽ mục ngay khi bố cục
 * revision đổi, và mục theo kiểu vẫn-xanh.
 *
 * Lưu ý: helper KHÔNG dùng cho POST (tạo mới). Thêm một điểm mới không đè lên
 * thay đổi của ai, nên ở đó không có phiên bản nào để so — xem chú thích trong
 * `virtualpoint_concurrency.go`. */
func withCurrentVPETag(t *testing.T, app *App, req *http.Request) *http.Request {
	t.Helper()
	authority, err := app.readPointNamespaceAuthority()
	if err != nil {
		t.Fatalf("đọc namespace authority để lấy ETag: %v", err)
	}
	req.Header.Set("If-Match", formatVirtualPointETag(authority.Revision))
	return req
}
