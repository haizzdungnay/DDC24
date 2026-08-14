package app

import "testing"

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
