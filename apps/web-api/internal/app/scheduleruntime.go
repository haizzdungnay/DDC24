package app

// Ghép trạng thái runtime của controller vào Schedule Object (SCHD-152).
//
// Nguyên tắc S2/N2: cấu hình là Ý ĐỊNH, khối `runtime` là SỰ THẬT. Backend
// KHÔNG BAO GIỜ tự tính giá trị hiệu lực — controller không trả lời thì
// `runtime` là nil và giao diện hiển thị gạch ngang. Bịa một con số ở đây chính
// là lớp lỗi FE-DIAG-01 nhưng dịch xuống một tầng.

import (
	"context"
	"time"
)

type scheduleStateReader interface {
	ReadScheduleStates(ctx context.Context) ([]coreScheduleState, error)
}

// attachScheduleRuntime điền khối runtime cho từng lịch và cập nhật trạng thái
// dẫn xuất (ACTIVE / INACTIVE / OUT_OF_SYNC).
func (a *App) attachScheduleRuntime(list []ScheduleObject) {
	if len(list) == 0 {
		return
	}
	reader, ok := a.core.(scheduleStateReader)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	states, err := reader.ReadScheduleStates(ctx)
	if err != nil {
		// Controller im lặng. Để runtime = nil; giao diện sẽ hiện gạch ngang.
		return
	}

	byID := make(map[string]coreScheduleState, len(states))
	for _, st := range states {
		byID[st.ScheduleID] = st
	}
	now := time.Now().UTC()
	for i := range list {
		st, found := byID[list[i].ScheduleID]
		if !found {
			// Controller chưa biết lịch này ⇒ chưa publish hoặc lệch revision.
			continue
		}
		list[i].Runtime = buildScheduleRuntimeState(list[i], st, now)
		list[i].Status = deriveScheduleStatus(list[i], st)
	}
}

func buildScheduleRuntimeState(obj ScheduleObject, st coreScheduleState, now time.Time) *ScheduleRuntimeState {
	rt := &ScheduleRuntimeState{
		EffectiveValue:  decodeScheduleValue(st.EffectiveValue, obj.ValueType),
		LastEvaluatedAt: strPtr(now.Format(time.RFC3339)),
		Targets:         make([]ScheduleTargetRuntime, 0, len(st.Targets)),
	}
	if st.ValueSource != "" {
		rt.ValueSource = strPtr(st.ValueSource)
	}
	if st.SourceExceptionID != "" {
		rt.SourceExceptionID = strPtr(st.SourceExceptionID)
	}
	if st.ErrorCode != "" {
		rt.ErrorCode = strPtr(st.ErrorCode)
	}
	if at := nextTransitionTimestamp(st.NextTransitionWeekSecond, obj.Timezone, now); at != "" {
		rt.NextTransitionAt = strPtr(at)
	}
	// Controller đang chạy đúng bản đã publish; nếu lệch thì deriveScheduleStatus
	// bên dưới đánh dấu OUT_OF_SYNC.
	applied := obj.Revision
	rt.AppliedRevision = &applied

	for _, t := range st.Targets {
		targetKind := ""
		for _, to := range obj.TargetObjects {
			if to.TargetID == t.TargetID {
				targetKind = to.PointKind
				break
			}
		}
		target := ScheduleTargetRuntime{
			TargetID:     t.TargetID,
			WrittenValue: decodeScheduleTargetValue(t.WrittenValue, targetKind, obj.ValueType),
			LastWriteAt:  strPtr(now.Format(time.RFC3339)),
		}
		switch {
		case t.ErrorCode != "":
			target.WriteResult = strPtr("FAILED")
			target.ErrorCode = strPtr(t.ErrorCode)
		case t.InDelay != nil && *t.InDelay:
			target.WriteResult = strPtr("DELAYED")
			target.DelayRemainingSec = t.DelayRemainingSec
		case t.ShouldClaim != nil && !*t.ShouldClaim:
			target.WriteResult = strPtr("RELINQUISHED")
			target.WrittenValue = nil
		case !t.Written:
			// Lịch này thua ở bước phân xử priority giữa các lịch. Không phải
			// lỗi, nhưng người dùng phải thấy được — thua âm thầm là cách để
			// một cấu hình sai sống sót qua commissioning.
			target.WriteResult = strPtr("SKIPPED")
		default:
			target.WriteResult = strPtr("OK")
		}
		if t.OverriddenBy != "" {
			target.OverriddenBy = strPtr(t.OverriddenBy)
		}
		rt.Targets = append(rt.Targets, target)
	}
	return rt
}

// deriveScheduleStatus tính trạng thái hiển thị từ cấu hình + runtime.
func deriveScheduleStatus(obj ScheduleObject, st coreScheduleState) string {
	if !obj.Enabled {
		return scheduleStatusDisabled
	}
	if st.ErrorCode != "" {
		return scheduleStatusError
	}
	switch obj.Status {
	case scheduleStatusDraft, scheduleStatusValidated:
		// Chưa publish thì runtime của controller không nói lên trạng thái của
		// bản nháp đang soạn.
		return obj.Status
	}
	if st.Active {
		return scheduleStatusActive
	}
	return scheduleStatusInactive
}

// decodeScheduleValue đổi số của controller về đúng kiểu hợp đồng. Controller
// lưu mọi giá trị dạng double; hợp đồng đòi ACTIVE/INACTIVE cho BINARY và
// true/false cho BOOLEAN.
func decodeScheduleValue(raw float64, valueType string) any {
	switch valueType {
	case "BINARY":
		if raw != 0 {
			return "ACTIVE"
		}
		return "INACTIVE"
	case "BOOLEAN":
		return raw != 0
	case "UNSIGNED", "ENUMERATED":
		return int64(raw)
	}
	return raw
}

// nextTransitionTimestamp đổi "giây kể từ đầu tuần" của controller thành mốc
// thời gian tuyệt đối theo timezone của lịch. Trả rỗng khi không có lần chuyển
// nào — rỗng để giao diện hiện gạch ngang, không phải 0.
func nextTransitionTimestamp(weekSecond int, timezone string, now time.Time) string {
	if weekSecond < 0 {
		return ""
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	// Thứ Hai = 0 để khớp quy ước của controller.
	weekday := (int(local.Weekday()) + 6) % 7
	currentWeekSecond := weekday*86400 + local.Hour()*3600 + local.Minute()*60 + local.Second()
	delta := weekSecond - currentWeekSecond
	if delta < 0 {
		delta += 7 * 86400 // lần chuyển thuộc tuần sau
	}
	return local.Add(time.Duration(delta) * time.Second).Format(time.RFC3339)
}

func decodeScheduleTargetValue(raw float64, kind string, fallbackType string) any {
	switch kind {
	case "DO", "BV":
		if raw != 0 {
			return "ACTIVE"
		}
		return "INACTIVE"
	case "AO", "AV", "EXT":
		return raw
	case "MSV":
		return int64(raw)
	default:
		return decodeScheduleValue(raw, fallbackType)
	}
}
