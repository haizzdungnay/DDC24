package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

/* T63-108 — `overview.alarms.activeOrUnacked` là số trên chuông shell. Chuông
 * đổi NGUỒN (poll `/alarms` → snapshot overview) nhưng KHÔNG được đổi ngữ
 * nghĩa. Ba lớp khoá:
 *
 *  1. Quy tắc Go khớp quy tắc FE chạy trên CHÍNH JSON mà `/alarms` phát ra
 *     (bắt được mọi lệch, kể cả khi ai đó bỏ `omitempty` của `active`).
 *  2. Các hàng cụ thể mà lệch ngữ nghĩa sẽ lộ ra, và khác biệt với `total`.
 *  3. Đầu-cuối: cùng một Core, số trên `/overview` bằng số chuông cũ đếm được
 *     từ thân `/alarms`. */

// feBellRule là bản chép quy tắc chuông cũ ở trình duyệt, áp lên một hàng
// `/alarms` ĐÃ giải mã JSON:
//
//	normalizeAlarm: active = typeof raw.active === 'boolean' ? raw.active : undefined
//	               status = alarmStatusFrom(raw.status)
//	countShellAlarms: (active ?? (status === 'active' || status === 'acked')) || status === 'unack'
func feBellRule(raw map[string]any) bool {
	status := "active"
	if value, ok := raw["status"]; ok && value != nil {
		switch s := strings.ToLower(toString(value)); s {
		case "unack", "acked", "cleared", "shelved":
			status = s
		case "acknowledged":
			status = "acked"
		case "unacknowledged":
			status = "unack"
		case "clear", "resolved", "normal":
			status = "cleared"
		}
	}
	activeOrStatus := status == "active" || status == "acked"
	if active, ok := raw["active"].(bool); ok {
		activeOrStatus = active
	}
	return activeOrStatus || status == "unack"
}

func toString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	b, _ := json.Marshal(value)
	return string(b)
}

func TestShellBellCountMatchesTheWireRule(t *testing.T) {
	statuses := []string{"active", "unack", "acked", "shelved", "cleared", "", "ACKED", "Unack", "acknowledged", "resolved", "weird"}
	for _, status := range statuses {
		for _, active := range []bool{false, true} {
			alarm := AlarmDTO{ID: "A", Status: status, Active: active, Severity: "high"}
			body, err := json.Marshal(alarm)
			if err != nil {
				t.Fatal(err)
			}
			var raw map[string]any
			if err := json.Unmarshal(body, &raw); err != nil {
				t.Fatal(err)
			}
			if got, want := shellBellCountsAlarm(alarm), feBellRule(raw); got != want {
				t.Errorf("status=%q active=%v (wire %s): server đếm %v, chuông cũ đếm %v", status, active, body, got, want)
			}
		}
	}
}

func TestShellBellCountDiffersFromTotalOnlyWhereTheOldBellDid(t *testing.T) {
	// Tiền đề trên dây: hàng chốt tay đã xác nhận, hết điều kiện đi ra `/alarms`
	// KHÔNG có khoá `active` (Go `omitempty`), nên chuông cũ đếm nó theo status.
	latched, _ := json.Marshal(AlarmDTO{ID: "3", Status: "acked", Active: false})
	if strings.Contains(string(latched), `"active"`) {
		t.Fatalf("tiền đề đổi: /alarms nay phát `active:false` (%s) — chuông cũ sẽ KHÔNG đếm hàng này nữa; xem lại countShellBellAlarms", latched)
	}
	cases := []struct {
		name    string
		alarm   AlarmDTO
		bell    bool
		inTotal bool
	}{
		{"đang hoạt động", AlarmDTO{ID: "1", Status: "active", Active: true}, true, true},
		{"hết điều kiện, chưa xác nhận", AlarmDTO{ID: "2", Status: "unack", Active: false}, true, true},
		// `active=false` bị `omitempty` bỏ khỏi JSON ⇒ chuông cũ rơi về status `acked` ⇒ ĐẾM.
		{"chốt tay đã xác nhận, hết điều kiện, chờ return", AlarmDTO{ID: "3", Status: "acked", Active: false}, true, true},
		{"đã xác nhận, còn điều kiện", AlarmDTO{ID: "4", Status: "acked", Active: true}, true, true},
		{"shelved, hết điều kiện", AlarmDTO{ID: "5", Status: "shelved", Active: false}, false, true},
		{"shelved, còn điều kiện", AlarmDTO{ID: "6", Status: "shelved", Active: true}, true, true},
		{"cleared từ lịch sử", AlarmDTO{ID: "7", Status: "cleared", Active: false}, false, false},
	}
	all := make([]AlarmDTO, 0, len(cases))
	wantBell := 0
	for _, tc := range cases {
		if got := shellBellCountsAlarm(tc.alarm); got != tc.bell {
			t.Errorf("%s: chuông đếm %v; muốn %v", tc.name, got, tc.bell)
		}
		all = append(all, tc.alarm)
		if tc.bell {
			wantBell++
		}
	}
	counts := summarizeAlarms(all)
	if got := countShellBellAlarms(all); got != wantBell {
		t.Fatalf("countShellBellAlarms = %d; muốn %d", got, wantBell)
	}
	if counts.Total == wantBell {
		t.Fatalf("tiền đề của test đổi: total %d trùng số chuông %d — test không còn phân biệt được hai định nghĩa", counts.Total, wantBell)
	}
}

func TestOverviewActiveOrUnackedEqualsTheOldBellOverAlarmsBody(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{
		{ID: "A-ACTIVE", Status: "active", Active: true, Severity: "high"},
		{ID: "A-UNACK", Status: "unack", Active: false, Severity: "medium"},
		{ID: "A-LATCHED", Status: "acked", Active: false, Severity: "high"},
		{ID: "A-SHELVED", Status: "shelved", Active: false, Severity: "low"},
		{ID: "A-SHELVED-ON", Status: "shelved", Active: true, Severity: "low"},
		{ID: "   ", Status: "active", Active: true, Severity: "info"}, // `/alarms` bỏ hàng không ID
		{ID: "A-DUP", Status: "shelved", Active: false, Severity: "info"},
		{ID: "A-DUP", Status: "unack", Active: false, Severity: "info"}, // ID trùng: `/alarms` giữ hàng sau
	}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	handler := app.Router()

	alarmsResp := serveAuth(t, handler, http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, alarmsResp, http.StatusOK)
	var rows []map[string]any
	if err := json.Unmarshal(alarmsResp.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode /alarms: %v", err)
	}
	oldBell := 0
	for _, row := range rows {
		if feBellRule(row) {
			oldBell++
		}
	}

	overviewResp := serveAuth(t, handler, http.MethodGet, "/api/v1/overview", "", token)
	assertStatus(t, overviewResp, http.StatusOK)
	var overview struct {
		Alarms struct {
			Total           int  `json:"total"`
			ActiveOrUnacked *int `json:"activeOrUnacked"`
		} `json:"alarms"`
		Degraded []string `json:"degraded"`
	}
	if err := json.Unmarshal(overviewResp.Body.Bytes(), &overview); err != nil {
		t.Fatalf("decode /overview: %v", err)
	}
	for _, d := range overview.Degraded {
		if d == "alarms" {
			t.Fatal("tiền đề: Core giả đọc được nên overview không được gắn degraded alarms")
		}
	}
	if overview.Alarms.ActiveOrUnacked == nil {
		t.Fatal("overview thiếu alarms.activeOrUnacked: chuông sẽ phải quay về poll /alarms")
	}
	if *overview.Alarms.ActiveOrUnacked != oldBell {
		t.Fatalf("overview.alarms.activeOrUnacked = %d; chuông cũ đếm %d trên thân /alarms", *overview.Alarms.ActiveOrUnacked, oldBell)
	}
	if overview.Alarms.Total == oldBell {
		t.Fatalf("tiền đề: total %d trùng số chuông %d — test không phân biệt được total với trường mới", overview.Alarms.Total, oldBell)
	}
}
