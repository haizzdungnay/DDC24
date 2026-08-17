package app

import (
	"path/filepath"
	"testing"
	"time"
)

// F-DASH-LOCALIO-01 — Dashboard hiện FAULT đỏ cho domain "Local I/O" chỉ vì
// người dùng đã đặt Signal Type = "none" ("Không hoạt động") cho các kênh UI
// chưa nối cảm biến. Core trả quality=bad đúng thiết kế cho kênh chưa cấu
// hình (không có dữ liệu thật để báo), nhưng đó không phải một fault phần
// cứng — overviewHealth phải loại các kênh "none" khỏi phép đếm bad/stale
// của domain local_io, cùng họ với FE-DIAG-01/FE-DATA-01 (không được báo sai
// mức độ nghiêm trọng khi thiếu dữ liệu là chủ ý, không phải sự cố).
func TestOverviewHealthLocalIOIgnoresDisabledChannels(t *testing.T) {
	a := &App{}
	core := CoreStatus{CoreAvailable: true, IOP: IOPStatus{Status: "normal"}}
	modbus := modbusHealthInput{}

	uiPoint := func(id, quality, signalType string) PointDTO {
		return PointDTO{ID: id, Kind: "UI", Quality: quality, SignalType: signalType}
	}

	t.Run("kênh Signal Type none quality bad không kéo domain xuống FAULT", func(t *testing.T) {
		points := []PointDTO{
			uiPoint("UI-01", "good", "0-10V"),
			uiPoint("UI-02", "good", "0-10V"),
			uiPoint("UI-09", "bad", "none"),
			uiPoint("UI-10", "bad", "none"),
		}
		health := a.overviewHealth("2026-08-14T00:00:00Z", core, nil, nil, points, modbus, true, "192.168.1.10")
		localIO := findDomainHealth(t, health, "local_io")
		if localIO.State != HealthGood {
			t.Fatalf("state = %q, want %q (reasonCode=%s, detail=%s)", localIO.State, HealthGood, localIO.ReasonCode, localIO.Detail)
		}
		if localIO.ReasonCode != "ok" {
			t.Fatalf("reasonCode = %q, want ok", localIO.ReasonCode)
		}
	})

	t.Run("kênh THẬT bad quality (không phải none) vẫn báo FAULT đúng", func(t *testing.T) {
		points := []PointDTO{
			uiPoint("UI-01", "good", "0-10V"),
			uiPoint("UI-02", "bad", "0-10V"),
			uiPoint("UI-09", "bad", "none"),
		}
		health := a.overviewHealth("2026-08-14T00:00:00Z", core, nil, nil, points, modbus, true, "192.168.1.10")
		localIO := findDomainHealth(t, health, "local_io")
		if localIO.State != HealthFault {
			t.Fatalf("state = %q, want %q — không được để việc loại kênh none làm mất luôn fault thật", localIO.State, HealthFault)
		}
		if localIO.ReasonCode != "bad_quality_points" {
			t.Fatalf("reasonCode = %q, want bad_quality_points", localIO.ReasonCode)
		}
		if localIO.Detail != "1 điểm chất lượng bad" {
			t.Fatalf("detail = %q, want đúng 1 điểm bad (không tính UI-09 none)", localIO.Detail)
		}
	})

	t.Run("mọi kênh đều none -> Unknown, không phải Good giả", func(t *testing.T) {
		points := []PointDTO{
			uiPoint("UI-09", "bad", "none"),
			uiPoint("UI-10", "bad", "none"),
		}
		health := a.overviewHealth("2026-08-14T00:00:00Z", core, nil, nil, points, modbus, true, "192.168.1.10")
		localIO := findDomainHealth(t, health, "local_io")
		if localIO.State != HealthUnknown {
			t.Fatalf("state = %q, want %q", localIO.State, HealthUnknown)
		}
		if localIO.ReasonCode != "no_local_points" {
			t.Fatalf("reasonCode = %q, want no_local_points", localIO.ReasonCode)
		}
	})
}

// Bug 2026-08-17: domain "historian" ở /api/v1/overview báo DEGRADED vĩnh
// viễn ("N điểm ghi lỗi") dù writer legacy đang ghi dữ liệu hoàn toàn bình
// thường, vì historian.writerActive (wire ở main.go) trước đây chỉ xét
// WriterV2 — luôn false ở trạng thái mặc định "legacy" (chưa cutover sang
// historian v2). Test này dựng lại đúng công thức wiring của main.go
// (WriterV2 || LegacyHistorianWritersRunning()) để hồi quy này không tái
// diễn im lặng.
func TestOverviewHealthHistorianLegacyWriterCountsAsActive(t *testing.T) {
	svc, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	svc.identities = func() (map[string]uint64, string, error) {
		return map[string]uint64{"UI-01": 1}, "valid", nil
	}
	svc.file.Points = []HistorianPolicy{{
		PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s",
		RetentionDays: 30, StartAtUTC: time.Now().Add(-time.Hour).Format(time.RFC3339),
	}}

	a := &App{historian: svc}
	svc.writerActive = a.historianWriterActive

	core := CoreStatus{CoreAvailable: true, IOP: IOPStatus{Status: "normal"}}
	modbus := modbusHealthInput{}

	t.Run("WriterV2 false nhưng legacy writer đang running -> historian GOOD, không DEGRADED", func(t *testing.T) {
		a.legacyState = "running"
		health := a.overviewHealth("2026-08-17T00:00:00Z", core, nil, nil, nil, modbus, true, "192.168.1.10")
		historian := findDomainHealth(t, health, "historian")
		if historian.State != HealthGood {
			t.Fatalf("state = %q, want %q (reasonCode=%s, detail=%s) — legacy writer đang ghi thật không được báo degraded", historian.State, HealthGood, historian.ReasonCode, historian.Detail)
		}
	})

	t.Run("legacy writer không running và WriterV2 false -> historian DEGRADED đúng", func(t *testing.T) {
		a.legacyState = "stopped"
		health := a.overviewHealth("2026-08-17T00:00:00Z", core, nil, nil, nil, modbus, true, "192.168.1.10")
		historian := findDomainHealth(t, health, "historian")
		if historian.State != HealthDegraded {
			t.Fatalf("state = %q, want %q — không writer nào ghi thì phải báo degraded thật", historian.State, HealthDegraded)
		}
	})
}

func findDomainHealth(t *testing.T, health []OverviewDomainHealth, domain string) OverviewDomainHealth {
	t.Helper()
	for _, item := range health {
		if item.Domain == domain {
			return item
		}
	}
	t.Fatalf("domain %q not found in health list", domain)
	return OverviewDomainHealth{}
}
