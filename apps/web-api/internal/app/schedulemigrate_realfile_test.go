package app

// Đối chiếu 100% lịch trước/sau khi di trú, trên `schedule.conf` THẬT lấy từ bo
// lab (QĐ-8, PM/CTO duyệt 2026-08-07).
//
// Chạy:
//
//	MKDDC_REAL_SCHEDULE_CONF=/đường/dẫn/schedule.conf \
//	  go test ./internal/app/ -run TestMigrationAgainstRealBoardConfig -v
//
// Không đặt biến môi trường thì test tự SKIP — nhưng SKIP **không** phải PASS.
// Rủi ro R-01 (mất cấu hình đang vận hành khi nâng cấp) chỉ được coi là đóng
// khi test này chạy thật với tệp của bo và in ra bảng đối chiếu.
//
// Test chỉ ĐỌC tệp được trỏ tới; mọi thao tác ghi diễn ra trong thư mục tạm.
// Không đụng gì tới bo.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMigrationAgainstRealBoardConfig(t *testing.T) {
	src := os.Getenv("MKDDC_REAL_SCHEDULE_CONF")
	if src == "" {
		t.Skip("đặt MKDDC_REAL_SCHEDULE_CONF trỏ tới bản sao schedule.conf của bo lab (QĐ-8)")
	}

	original, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("đọc %s: %v", src, err)
	}
	if !isScheduleV1Payload(original) {
		t.Fatalf("%s không phải định dạng cũ — không có gì để di trú", src)
	}

	var before []scheduleRowV1
	if err := json.Unmarshal(original, &before); err != nil {
		t.Fatalf("đọc định dạng cũ: %v", err)
	}

	// Chạy di trú trong thư mục tạm, không đụng tệp nguồn.
	app, _ := newScheduleTestApp(t)
	if err := os.WriteFile(app.cfg.ScheduleConfPath, original, 0o600); err != nil {
		t.Fatalf("dựng bản sao: %v", err)
	}
	notes, err := app.MigrateSchedulesOnStartup(t.Context())
	if err != nil {
		t.Fatalf("di trú: %v", err)
	}
	after, err := app.LoadSchedules(t.Context())
	if err != nil {
		t.Fatalf("đọc lại sau di trú: %v", err)
	}

	// ── Đối chiếu 100% ────────────────────────────────────────────────────
	var holidays, executable int
	for _, row := range before {
		if row.ScheduleType == "holiday_period" {
			holidays++
		} else {
			executable++
		}
	}
	t.Logf("BẢN CŨ:  %d hàng (%d lịch thường + %d khoảng ngày lễ)", len(before), executable, holidays)
	t.Logf("BẢN MỚI: %d Schedule Object", len(after))

	if len(after) != executable {
		t.Errorf("MẤT LỊCH: %d hàng thường ở bản cũ nhưng chỉ có %d Schedule Object", executable, len(after))
	}

	byID := make(map[string]ScheduleObject, len(after))
	for _, s := range after {
		byID[s.ScheduleID] = s
	}
	for _, row := range before {
		if row.ScheduleType == "holiday_period" {
			continue
		}
		id := normalizeScheduleID(row.ID)
		got, ok := byID[id]
		if !ok {
			t.Errorf("MẤT %s (%s)", row.ID, row.Label)
			continue
		}
		if got.Enabled {
			t.Errorf("%s: phải ở trạng thái TẮT sau di trú để bắt người dùng review", id)
		}
		if !got.MigratedFromV1 {
			t.Errorf("%s: thiếu cờ migrated_from_v1", id)
		}
		if got.Status != scheduleStatusDraft {
			t.Errorf("%s: status = %s, mong DRAFT", id, got.Status)
		}
		// Target phải giữ nguyên đích điều khiển — sai chỗ này là lịch chạy
		// nhầm thiết bị, hậu quả nặng hơn mất lịch.
		if row.Target != nil && row.Target.Channel != nil {
			wantKind := scheduleV1TargetKind(row.Target.Kind)
			if len(got.TargetObjects) != 1 {
				t.Errorf("%s: có %d target, mong 1", id, len(got.TargetObjects))
			} else {
				tg := got.TargetObjects[0]
				if tg.PointKind != wantKind || tg.Channel == nil || *tg.Channel != *row.Target.Channel {
					t.Errorf("%s: target lệch — cũ %s-%d, mới %s-%v",
						id, row.Target.Kind, *row.Target.Channel, tg.PointKind, tg.Channel)
				}
			}
		}
		// Mỗi ngày trong weekdays cũ phải có đúng hai mốc: bật và trả về mặc định.
		days := 0
		for _, d := range got.WeeklySchedule.Days() {
			if len(*d.Events) > 0 {
				days++
				if len(*d.Events) != 2 {
					t.Errorf("%s ngày %s: %d mốc, mong 2 (bật + trả về mặc định)", id, d.Key, len(*d.Events))
				}
			}
		}
		if row.StartTime != "" && row.EndTime != "" && days != len(row.Weekdays) {
			t.Errorf("%s: %d ngày có lịch, bản cũ khai %d ngày", id, days, len(row.Weekdays))
		}
		// Ngày lễ cũ tắt toàn cục ⇒ mỗi lịch phải nhận đủ số ngoại lệ tương ứng.
		if len(got.ExceptionSchedule) != holidays {
			t.Errorf("%s: %d ngoại lệ, mong %d (mỗi khoảng ngày lễ cũ thành một ngoại lệ)",
				id, len(got.ExceptionSchedule), holidays)
		}
		t.Logf("  ✓ %-12s %-28s %s ngày, %d target, %d ngoại lệ",
			id, got.ScheduleName, valueTypeShort(got.ValueType), len(got.TargetObjects), len(got.ExceptionSchedule))
	}

	// Bản cũ phải còn nguyên vẹn — đây là đường lùi duy nhất.
	backup, err := os.ReadFile(app.cfg.ScheduleConfPath + ".v1.bak")
	if err != nil {
		t.Fatalf("thiếu bản sao lưu .v1.bak: %v", err)
	}
	if string(backup) != string(original) {
		t.Error("bản sao lưu KHÁC tệp gốc — đường lùi không dùng được")
	}

	for _, n := range notes {
		t.Logf("GHI CHÚ: %s", n)
	}
	t.Logf("Bản sao lưu: %s (%d byte, khớp bit-với-bit tệp gốc)",
		filepath.Base(app.cfg.ScheduleConfPath+".v1.bak"), len(backup))
}

func valueTypeShort(v string) string {
	if v == "" {
		return "?"
	}
	return v
}
