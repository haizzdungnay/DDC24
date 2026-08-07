package app

// Test REST API Scheduler v3.1 (Plan 50 SCHD-134).
//
// Kiểm cả hai chiều: đường hạnh phúc phải chạy, và các đường sai phải bị CHẶN
// đúng chỗ — một API điều khiển quạt và van thì việc nó từ chối đúng quan trọng
// ngang việc nó chấp nhận đúng.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mustParseTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("mốc thời gian test sai: %v", err)
	}
	return parsed
}

// ── Tiện ích ──────────────────────────────────────────────────────────────

func newScheduleTestApp(t *testing.T) (*App, string) {
	t.Helper()
	app, token := newTestAppWithAdmin(t)
	dir := t.TempDir()
	app.cfg.ScheduleConfPath = filepath.Join(dir, "schedule.conf")
	pidfile := filepath.Join(dir, "core.pid")
	if err := os.WriteFile(pidfile, []byte("999999"), 0o600); err != nil {
		t.Fatalf("ghi pidfile: %v", err)
	}
	app.cfg.CorePidPath = pidfile
	return app, token
}

// scheduleJSON dựng một Schedule Object hợp lệ, cho phép ghi đè từng mảnh.
func scheduleJSON(id string, overrides map[string]any) string {
	obj := map[string]any{
		"schema_version":       "3.1",
		"schedule_id":          id,
		"schedule_name":        "Lịch " + id,
		"enabled":              true,
		"status":               "DRAFT",
		"timezone":             "Asia/Ho_Chi_Minh",
		"effective_period":     map[string]any{"start_date": nil, "end_date": nil},
		"value_type":           "BINARY",
		"priority_for_writing": 16,
		"schedule_default":     map[string]any{"value": "INACTIVE"},
		"weekly_schedule": map[string]any{
			"MON": []any{
				map[string]any{"time": "08:00:00", "value": "ACTIVE"},
				map[string]any{"time": "18:00:00", "value": "INACTIVE"},
			},
			"TUE": []any{}, "WED": []any{}, "THU": []any{},
			"FRI": []any{}, "SAT": []any{}, "SUN": []any{},
		},
		"exception_schedule": []any{},
		"target_objects": []any{
			map[string]any{
				"target_id": "TGT-001", "target_type": "INTERNAL_POINT",
				"point_kind": "DO", "channel": 1,
			},
		},
		"revision": 1,
	}
	for k, v := range overrides {
		obj[k] = v
	}
	data, _ := json.Marshal(obj)
	return string(data)
}

func doScheduleRequest(t *testing.T, app *App, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := newAuthRequest(method, path, body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	return w
}

// createSchedule tạo và trả về đối tượng đã lưu.
func createSchedule(t *testing.T, app *App, token, id string, overrides map[string]any) ScheduleObject {
	t.Helper()
	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules", scheduleJSON(id, overrides), token)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /schedules = %d body=%s", w.Code, w.Body.String())
	}
	var obj ScheduleObject
	if err := json.Unmarshal(w.Body.Bytes(), &obj); err != nil {
		t.Fatalf("đọc response: %v", err)
	}
	return obj
}

func decodeFindings(t *testing.T, w *httptest.ResponseRecorder) ScheduleValidationResult {
	t.Helper()
	var result ScheduleValidationResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("đọc findings: %v body=%s", err, w.Body.String())
	}
	return result
}

func hasFindingCode(result ScheduleValidationResult, code string) bool {
	for _, f := range result.Findings {
		if f.Code == code {
			return true
		}
	}
	return false
}

// ── Đường cơ bản ──────────────────────────────────────────────────────────

func TestScheduleListEmptyWhenNoFile(t *testing.T) {
	app, token := newScheduleTestApp(t)
	w := doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestScheduleCreateThenReadRoundTrips(t *testing.T) {
	app, token := newScheduleTestApp(t)
	created := createSchedule(t, app, token, "SCH-001", nil)

	if created.Status != scheduleStatusDraft {
		t.Fatalf("lịch mới phải ở DRAFT, nhận %s", created.Status)
	}
	if created.Revision != 1 {
		t.Fatalf("revision đầu tiên phải là 1, nhận %d", created.Revision)
	}
	// core_priority_level là trường dẫn xuất; backend luôn tự đặt.
	if created.CorePriorityLevel != scheduleCorePriorityLevel {
		t.Fatalf("core_priority_level = %d, mong %d", created.CorePriorityLevel, scheduleCorePriorityLevel)
	}

	w := doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules/SCH-001", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("GET một lịch = %d body=%s", w.Code, w.Body.String())
	}
	var got ScheduleObject
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("đọc response: %v", err)
	}
	if len(got.WeeklySchedule.Mon) != 2 || got.WeeklySchedule.Mon[0].Time != "08:00:00" {
		t.Fatalf("lịch tuần không round-trip: %+v", got.WeeklySchedule.Mon)
	}
	if got.WeeklySchedule.Tue == nil {
		t.Fatal("ngày rỗng phải là [] chứ không phải null — null làm frontend phải xử lý thêm một trường hợp")
	}
}

func TestScheduleClientCannotForgeCorePriorityLevel(t *testing.T) {
	// core_priority_level là sự thật của controller, không phải thứ client khai.
	app, token := newScheduleTestApp(t)
	created := createSchedule(t, app, token, "SCH-001", map[string]any{"core_priority_level": 1})
	if created.CorePriorityLevel != scheduleCorePriorityLevel {
		t.Fatalf("client đặt được core_priority_level = %d", created.CorePriorityLevel)
	}
}

func TestScheduleClientCannotForgeRuntime(t *testing.T) {
	// Cấu hình là ý định, runtime là sự thật. Nhận runtime từ client là mở
	// đường cho giao diện hiển thị số liệu không đến từ controller.
	app, token := newScheduleTestApp(t)
	created := createSchedule(t, app, token, "SCH-001", map[string]any{
		"runtime": map[string]any{"effective_value": "ACTIVE", "value_source": "WEEKLY"},
	})
	if created.Runtime != nil {
		t.Fatalf("client gửi runtime lên và backend giữ lại: %+v", created.Runtime)
	}
}

// ── Cấu hình sai phải bị chặn ─────────────────────────────────────────────

func TestScheduleRejectsMissingDefault(t *testing.T) {
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{"schedule_default": map[string]any{}})
	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules", body, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if !hasFindingCode(decodeFindings(t, w), errSchedMissingDefault) {
		t.Fatalf("mong %s, nhận %s", errSchedMissingDefault, w.Body.String())
	}
}

func TestScheduleRejectsBinaryValueOnAnalogTarget(t *testing.T) {
	// SCH-TARGET-003: BINARY không ghi được vào AO.
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{
		"target_objects": []any{map[string]any{
			"target_id": "TGT-001", "target_type": "INTERNAL_POINT",
			"point_kind": "AO", "channel": 1,
		}},
	})
	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules", body, token)
	if !hasFindingCode(decodeFindings(t, w), errSchedTargetTypeBad) {
		t.Fatalf("mong %s, nhận %s", errSchedTargetTypeBad, w.Body.String())
	}
}

func TestScheduleRejectsChannelBeyondHardware(t *testing.T) {
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{
		"target_objects": []any{map[string]any{
			"target_id": "TGT-001", "target_type": "INTERNAL_POINT",
			"point_kind": "DO", "channel": 99,
		}},
	})
	if !hasFindingCode(decodeFindings(t, doScheduleRequest(t, app, http.MethodPost,
		"/api/v1/schedules", body, token)), errSchedTargetNotFound) {
		t.Fatalf("kênh DO 99 phải bị chặn — phần cứng chỉ có 4")
	}
}

func TestScheduleRejectsDuplicateTimeInOneDay(t *testing.T) {
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{
		"weekly_schedule": map[string]any{
			"MON": []any{
				map[string]any{"time": "08:00:00", "value": "ACTIVE"},
				map[string]any{"time": "08:00:00", "value": "INACTIVE"},
			},
			"TUE": []any{}, "WED": []any{}, "THU": []any{},
			"FRI": []any{}, "SAT": []any{}, "SUN": []any{},
		},
	})
	if !hasFindingCode(decodeFindings(t, doScheduleRequest(t, app, http.MethodPost,
		"/api/v1/schedules", body, token)), errSchedBadWeekly) {
		t.Fatal("hai mốc cùng thời điểm phải bị chặn, không được đoán ý người dùng")
	}
}

func TestScheduleRejectsInvalidTimezone(t *testing.T) {
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{"timezone": "Mars/Olympus_Mons"})
	if !hasFindingCode(decodeFindings(t, doScheduleRequest(t, app, http.MethodPost,
		"/api/v1/schedules", body, token)), errSchedBadTimezone) {
		t.Fatal("timezone không phải IANA phải bị chặn")
	}
}

func TestScheduleRejectsBacnetTargetUntilPhase4(t *testing.T) {
	// ADR-023 QĐ-4. Im lặng bỏ qua sẽ khiến người dùng tưởng lịch đang điều khiển.
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{
		"target_objects": []any{map[string]any{
			"target_id": "TGT-001", "target_type": "BACNET_OBJECT",
			"device_instance": 1001, "object_type": "BINARY_OUTPUT",
			"object_instance": 1, "property_identifier": "PRESENT_VALUE",
		}},
	})
	if !hasFindingCode(decodeFindings(t, doScheduleRequest(t, app, http.MethodPost,
		"/api/v1/schedules", body, token)), errSchedTargetNotWrite) {
		t.Fatal("target BACnet phải bị từ chối rõ ràng ở P1")
	}
}

func TestScheduleDetectsEqualPriorityExceptionConflict(t *testing.T) {
	// Đặc tả §7.3: bằng priority thì BÁO, không tự chọn.
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{
		"exception_schedule": []any{
			map[string]any{
				"exception_id": "EXC-A", "name": "A", "event_priority": 5,
				"date_rule":   map[string]any{"type": "DATE", "date": "2026-09-02"},
				"time_values": []any{map[string]any{"time": "00:00:00", "value": "ACTIVE"}},
			},
			map[string]any{
				"exception_id": "EXC-B", "name": "B", "event_priority": 5,
				"date_rule":   map[string]any{"type": "DATE", "date": "2026-09-02"},
				"time_values": []any{map[string]any{"time": "00:00:00", "value": "INACTIVE"}},
			},
		},
	})
	result := decodeFindings(t, doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules", body, token))
	if !hasFindingCode(result, errSchedExceptionConflit) {
		t.Fatalf("mong %s, nhận %s", errSchedExceptionConflit, result.Findings)
	}
}

func TestScheduleRejectsSixtyFifthSchedule(t *testing.T) {
	app, token := newScheduleTestApp(t)
	list := make([]ScheduleObject, 0, maxSchedules)
	for i := 1; i <= maxSchedules; i++ {
		var obj ScheduleObject
		if err := json.Unmarshal([]byte(scheduleJSON(fmt.Sprintf("SCH-%03d", i),
			map[string]any{"target_objects": []any{}})), &obj); err != nil {
			t.Fatalf("dựng lịch: %v", err)
		}
		list = append(list, obj)
	}
	if err := app.SaveSchedules(t.Context(), list); err != nil {
		t.Fatalf("lưu: %v", err)
	}
	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules", scheduleJSON("SCH-065", nil), token)
	if w.Code != http.StatusConflict {
		t.Fatalf("lịch thứ 65 phải bị chặn, nhận %d", w.Code)
	}
}

// ── Revision và khoá lạc quan ─────────────────────────────────────────────

func TestScheduleUpdateBumpsRevision(t *testing.T) {
	app, token := newScheduleTestApp(t)
	created := createSchedule(t, app, token, "SCH-001", nil)

	body := scheduleJSON("SCH-001", map[string]any{
		"schedule_name": "Tên mới", "revision": created.Revision,
	})
	w := doScheduleRequest(t, app, http.MethodPut, "/api/v1/schedules/SCH-001", body, token)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT = %d body=%s", w.Code, w.Body.String())
	}
	var updated ScheduleObject
	_ = json.Unmarshal(w.Body.Bytes(), &updated)
	if updated.Revision != created.Revision+1 {
		t.Fatalf("revision = %d, mong %d", updated.Revision, created.Revision+1)
	}
	if updated.ScheduleName != "Tên mới" {
		t.Fatalf("tên không được cập nhật: %s", updated.ScheduleName)
	}
}

func TestScheduleUpdateWithStaleRevisionIsRejected(t *testing.T) {
	// Ghi đè im lặng ở đây là mất công của người khác.
	app, token := newScheduleTestApp(t)
	created := createSchedule(t, app, token, "SCH-001", nil)

	first := scheduleJSON("SCH-001", map[string]any{"schedule_name": "A", "revision": created.Revision})
	if w := doScheduleRequest(t, app, http.MethodPut, "/api/v1/schedules/SCH-001", first, token); w.Code != http.StatusOK {
		t.Fatalf("PUT lần một = %d", w.Code)
	}
	stale := scheduleJSON("SCH-001", map[string]any{"schedule_name": "B", "revision": created.Revision})
	w := doScheduleRequest(t, app, http.MethodPut, "/api/v1/schedules/SCH-001", stale, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("revision cũ phải bị chặn, nhận %d", w.Code)
	}
	if !hasFindingCode(decodeFindings(t, w), errSchedRevisionConflict) {
		t.Fatalf("mong %s, nhận %s", errSchedRevisionConflict, w.Body.String())
	}
}

// ── Validate ──────────────────────────────────────────────────────────────

func TestScheduleValidateMovesDraftToValidated(t *testing.T) {
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)

	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules/SCH-001/validate", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("validate = %d body=%s", w.Code, w.Body.String())
	}
	result := decodeFindings(t, w)
	if !result.Valid {
		t.Fatalf("lịch hợp lệ bị báo sai: %+v", result.Findings)
	}
	if result.Status != scheduleStatusValidated {
		t.Fatalf("status = %s, mong %s", result.Status, scheduleStatusValidated)
	}
}

func TestScheduleValidateReportsPathForUI(t *testing.T) {
	// Giao diện phải bấm được vào finding để nhảy tới ô sai (nguyên tắc N4).
	app, token := newScheduleTestApp(t)
	body := scheduleJSON("SCH-001", map[string]any{
		"weekly_schedule": map[string]any{
			"MON": []any{map[string]any{"time": "8:00", "value": "ACTIVE"}},
			"TUE": []any{}, "WED": []any{}, "THU": []any{},
			"FRI": []any{}, "SAT": []any{}, "SUN": []any{},
		},
	})
	result := decodeFindings(t, doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules", body, token))
	found := false
	for _, f := range result.Findings {
		if f.Path == "$.weekly_schedule.MON[0].time" {
			found = true
		}
	}
	if !found {
		t.Fatalf("finding phải chỉ đúng JSON path, nhận %+v", result.Findings)
	}
}

// ── Bật/tắt ───────────────────────────────────────────────────────────────

func TestScheduleDisableSetsDisabledStatus(t *testing.T) {
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)

	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules/SCH-001/disable", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("disable = %d body=%s", w.Code, w.Body.String())
	}
	var obj ScheduleObject
	_ = json.Unmarshal(w.Body.Bytes(), &obj)
	if obj.Enabled {
		t.Fatal("enabled vẫn true sau khi disable")
	}
	// Trong test, pid của core là số giả nên reload luôn hỏng. Cấu hình đã ghi
	// nhưng controller vẫn chạy bản cũ — trạng thái đúng là OUT_OF_SYNC, không
	// phải DISABLED (nói dối là đã có hiệu lực) và cũng không phải lỗi 500
	// (nói dối là chưa ghi gì).
	if obj.Status != scheduleStatusOutOfSync {
		t.Fatalf("status = %s, mong %s khi controller chưa nạp lại", obj.Status, scheduleStatusOutOfSync)
	}

	// Trên đĩa thì cờ enabled và trạng thái DISABLED phải đã được ghi.
	list, err := app.LoadSchedules(t.Context())
	if err != nil {
		t.Fatalf("đọc lại: %v", err)
	}
	if len(list) != 1 || list[0].Enabled || list[0].Status != scheduleStatusDisabled {
		t.Fatalf("cấu hình trên đĩa chưa đúng: %+v", list)
	}
}

// ── Publish ───────────────────────────────────────────────────────────────

func TestSchedulePublishRequiresReason(t *testing.T) {
	// Lý do vào audit; không có nó thì sáu tháng sau không ai giải thích nổi.
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)

	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules/SCH-001/publish",
		`{"revision":1,"reason":""}`, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("publish không lý do phải bị chặn, nhận %d", w.Code)
	}
}

func TestSchedulePublishRejectsStaleRevision(t *testing.T) {
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)

	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules/SCH-001/publish",
		`{"revision":99,"reason":"thử"}`, token)
	if !hasFindingCode(decodeFindings(t, w), errSchedRevisionConflict) {
		t.Fatalf("mong %s, nhận %s", errSchedRevisionConflict, w.Body.String())
	}
}

func TestSchedulePublishFailureKeepsRunningRevision(t *testing.T) {
	// Đặc tả §13.2. Trong test, core pid là số giả nên reload luôn hỏng —
	// đúng thứ cần để kiểm nhánh này.
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)

	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules/SCH-001/publish",
		`{"revision":1,"reason":"kiểm tra publish hỏng"}`, token)
	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("publish hỏng phải trả 504, nhận %d body=%s", w.Code, w.Body.String())
	}
	var result SchedulePublishResult
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	if result.Result != "TIMEOUT" {
		t.Fatalf("result = %s", result.Result)
	}
	if result.Revision != 1 {
		t.Fatalf("revision đang chạy phải giữ nguyên là 1, nhận %d", result.Revision)
	}

	// Và trạng thái trên đĩa phải quay về như cũ, không kẹt ở PUBLISHED.
	get := doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules/SCH-001", "", token)
	var obj ScheduleObject
	_ = json.Unmarshal(get.Body.Bytes(), &obj)
	if obj.Status == scheduleStatusPublished {
		t.Fatal("publish hỏng nhưng trạng thái kẹt ở PUBLISHED")
	}
}

// ── Audit ─────────────────────────────────────────────────────────────────

func TestScheduleAuditRecordsCreateAndUpdate(t *testing.T) {
	app, token := newScheduleTestApp(t)
	created := createSchedule(t, app, token, "SCH-001", nil)
	body := scheduleJSON("SCH-001", map[string]any{"schedule_name": "B", "revision": created.Revision})
	doScheduleRequest(t, app, http.MethodPut, "/api/v1/schedules/SCH-001", body, token)

	w := doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules/SCH-001/audit", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("audit = %d body=%s", w.Code, w.Body.String())
	}
	var entries []ScheduleAuditEntry
	if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
		t.Fatalf("đọc audit: %v", err)
	}
	if len(entries) < 2 {
		t.Fatalf("mong ít nhất 2 dòng audit, nhận %d", len(entries))
	}
	actions := map[string]bool{}
	for _, e := range entries {
		actions[e.Action] = true
		if e.Actor == "" {
			t.Fatal("dòng audit thiếu actor")
		}
	}
	if !actions["CREATE"] || !actions["UPDATE"] {
		t.Fatalf("thiếu action, có: %v", actions)
	}
}

// ── Di trú v1 → v3.1 ──────────────────────────────────────────────────────

func TestScheduleMigratesLegacyConfigAndKeepsBackup(t *testing.T) {
	app, token := newScheduleTestApp(t)
	legacy := `[
	  {"id":"SCH-001","label":"Quat AHU","enabled":true,"scheduleType":"digital_output_value",
	   "startTime":"08:00","endTime":"17:00","weekdays":["monday","tuesday"],
	   "target":{"kind":"DO","channel":1,"pointId":"DO-01"},"value":1},
	  {"id":"SCH-050","label":"Nghi le","enabled":true,"scheduleType":"holiday_period",
	   "startDate":"09-02","endDate":"09-02","weekdays":[]}
	]`
	if err := os.WriteFile(app.cfg.ScheduleConfPath, []byte(legacy), 0o600); err != nil {
		t.Fatalf("ghi cấu hình cũ: %v", err)
	}

	w := doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("GET = %d body=%s", w.Code, w.Body.String())
	}
	var list []ScheduleObject
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("đọc response: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("mong 1 lịch sau di trú (holiday thành ngoại lệ), nhận %d", len(list))
	}

	got := list[0]
	if !got.MigratedFromV1 {
		t.Fatal("thiếu cờ migrated_from_v1 — giao diện sẽ không hiện băng cảnh báo")
	}
	if got.Enabled {
		t.Fatal("lịch di trú phải ở trạng thái TẮT cho tới khi người dùng review")
	}
	if got.ValueType != "BINARY" {
		t.Fatalf("value_type = %s, mong BINARY", got.ValueType)
	}
	// Một khoảng start/end của mô hình cũ phải thành HAI mốc Time-Value; thiếu
	// mốc trả về mặc định thì giá trị sẽ dính lại qua đêm.
	if len(got.WeeklySchedule.Mon) != 2 {
		t.Fatalf("MON phải có 2 mốc, nhận %+v", got.WeeklySchedule.Mon)
	}
	if got.WeeklySchedule.Mon[0].Time != "08:00:00" || got.WeeklySchedule.Mon[1].Time != "17:00:00" {
		t.Fatalf("mốc sai: %+v", got.WeeklySchedule.Mon)
	}
	if got.WeeklySchedule.Mon[1].Value != "INACTIVE" {
		t.Fatalf("mốc kết thúc phải trả về mặc định, nhận %v", got.WeeklySchedule.Mon[1].Value)
	}
	if len(got.WeeklySchedule.Wed) != 0 {
		t.Fatal("ngày không có trong weekdays phải rỗng")
	}
	// holiday_period cũ tắt toàn cục; nay thành ngoại lệ của từng lịch.
	if len(got.ExceptionSchedule) != 1 || got.ExceptionSchedule[0].EventPriority != 1 {
		t.Fatalf("ngày lễ phải thành ngoại lệ priority 1, nhận %+v", got.ExceptionSchedule)
	}
	if len(got.TargetObjects) != 1 || got.TargetObjects[0].PointID != "DO-01" {
		t.Fatalf("target không giữ được: %+v", got.TargetObjects)
	}

	// Bản cũ phải còn nguyên — đây là đường lùi duy nhất.
	backup, err := os.ReadFile(app.cfg.ScheduleConfPath + ".v1.bak")
	if err != nil {
		t.Fatalf("thiếu bản sao lưu .v1.bak: %v", err)
	}
	if !strings.Contains(string(backup), "scheduleType") {
		t.Fatal("bản sao lưu không phải nội dung cũ")
	}
}

func TestScheduleMigrationIsIdempotent(t *testing.T) {
	// Đọc lần hai không được di trú lại và không được ghi đè bản .bak.
	app, token := newScheduleTestApp(t)
	legacy := `[{"id":"SCH-001","label":"X","enabled":true,"scheduleType":"digital_output_value",
	  "startTime":"08:00","endTime":"17:00","weekdays":["monday"],
	  "target":{"kind":"DO","channel":1},"value":1}]`
	if err := os.WriteFile(app.cfg.ScheduleConfPath, []byte(legacy), 0o600); err != nil {
		t.Fatalf("ghi: %v", err)
	}
	doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules", "", token)
	first, _ := os.ReadFile(app.cfg.ScheduleConfPath)
	doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules", "", token)
	second, _ := os.ReadFile(app.cfg.ScheduleConfPath)
	if string(first) != string(second) {
		t.Fatal("lần đọc thứ hai làm đổi tệp — di trú không idempotent")
	}
}

// ── Mô phỏng ──────────────────────────────────────────────────────────────

func TestScheduleSimulateRefusesWithoutSharedEngine(t *testing.T) {
	// Không có binary mô phỏng thì PHẢI báo lỗi, tuyệt đối không tự tính trong
	// Go. Một bản cài lại sẽ đúng cho tới ngày nó lệch khỏi controller.
	t.Setenv("MKDDC_SCHEDULE_SIM", filepath.Join(t.TempDir(), "khong-ton-tai"))
	t.Setenv("PATH", t.TempDir())
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)

	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules/SCH-001/simulate",
		`{"range":"7_DAYS"}`, token)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("mong 503, nhận %d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "engine") {
		t.Fatalf("thông báo phải nói rõ lý do, nhận %s", w.Body.String())
	}
}

func TestScheduleSimulateRejectsBadRange(t *testing.T) {
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)
	w := doScheduleRequest(t, app, http.MethodPost, "/api/v1/schedules/SCH-001/simulate",
		`{"range":"1_YEAR"}`, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("range lạ phải bị chặn, nhận %d", w.Code)
	}
}

// ── Không tồn tại ─────────────────────────────────────────────────────────

func TestScheduleUnknownIDReturns404(t *testing.T) {
	app, token := newScheduleTestApp(t)
	for _, path := range []string{
		"/api/v1/schedules/SCH-999",
		"/api/v1/schedules/SCH-999/revisions",
		"/api/v1/schedules/SCH-999/runtime",
		"/api/v1/schedules/SCH-999/audit",
	} {
		if w := doScheduleRequest(t, app, http.MethodGet, path, "", token); w.Code != http.StatusNotFound {
			t.Fatalf("%s = %d, mong 404", path, w.Code)
		}
	}
}

// ── Runtime ───────────────────────────────────────────────────────────────

func TestScheduleRuntimeIsEmptyWhenControllerSilent(t *testing.T) {
	// Controller không trả lời ⇒ khối rỗng có cấu trúc, để giao diện hiện gạch
	// ngang. KHÔNG được bịa 0 hay OK (nguyên tắc N3).
	app, token := newScheduleTestApp(t)
	createSchedule(t, app, token, "SCH-001", nil)

	w := doScheduleRequest(t, app, http.MethodGet, "/api/v1/schedules/SCH-001/runtime", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("runtime = %d body=%s", w.Code, w.Body.String())
	}
	var rt ScheduleRuntimeState
	if err := json.Unmarshal(w.Body.Bytes(), &rt); err != nil {
		t.Fatalf("đọc runtime: %v", err)
	}
	if rt.EffectiveValue != nil {
		t.Fatalf("effective_value phải là null khi controller im lặng, nhận %v", rt.EffectiveValue)
	}
	if rt.ValueSource != nil {
		t.Fatalf("value_source phải là null, nhận %v", *rt.ValueSource)
	}
}

// ── Tiện ích thuần ────────────────────────────────────────────────────────

func TestScheduleWeekNDayLastWeekUsesBacnetConvention(t *testing.T) {
	// week_of_month = 6 là tuần CUỐI, không phải tuần thứ sáu.
	// Tháng 8/2026 có các Thứ Sáu 7, 14, 21, 28.
	got, ok := scheduleWeekNDayDate(2026, 8, 6, 5)
	if !ok || got != "2026-08-28" {
		t.Fatalf("tuần cuối = %q ok=%v, mong 2026-08-28", got, ok)
	}
	first, ok := scheduleWeekNDayDate(2026, 8, 1, 5)
	if !ok || first != "2026-08-07" {
		t.Fatalf("tuần đầu = %q ok=%v, mong 2026-08-07", first, ok)
	}
	if _, ok := scheduleWeekNDayDate(2026, 8, 5, 5); ok {
		t.Fatal("tháng 8/2026 không có Thứ Sáu thứ năm — phải trả false")
	}
}

func TestScheduleNextTransitionTimestampWrapsToNextWeek(t *testing.T) {
	// Lần chuyển đã qua trong tuần này thì thuộc tuần sau, không phải quá khứ.
	now := mustParseTime(t, "2026-08-14T10:00:00Z") // Thứ Sáu
	got := nextTransitionTimestamp(0, "UTC", now)   // Thứ Hai 00:00
	if got == "" {
		t.Fatal("không tính được mốc kế tiếp")
	}
	if !strings.HasPrefix(got, "2026-08-17") {
		t.Fatalf("mong Thứ Hai tuần sau 2026-08-17, nhận %s", got)
	}
}

func TestScheduleNextTransitionEmptyWhenNone(t *testing.T) {
	now := mustParseTime(t, "2026-08-14T10:00:00Z")
	if got := nextTransitionTimestamp(-1, "UTC", now); got != "" {
		t.Fatalf("không có lần chuyển thì phải rỗng để UI hiện gạch ngang, nhận %s", got)
	}
}
