package app

import (
	"context"
	"fmt"
	"strings"

	programmingapplication "mkddc-web/internal/programming/application"
)

// programmingPointCatalogAdapter chiếu `PointDTO` (authority Point hiện hữu
// của toàn hệ thống — LOCAL qua SHM Core, VP qua `overlayVirtualPoints`,
// Modbus RTU qua `EXT_PHYSICAL`) sang `PointCatalogEntry` của Programming.
// Đặt ở `internal/app` (không phải `internal/programming/application`) vì
// hướng phụ thuộc chỉ được một chiều: `app` đã import `programming/*`, chiều
// ngược lại sẽ tạo import cycle — đây là "accept interfaces, return structs"
// đúng nghĩa Go, không phải một API/domain model song song (không có store,
// không có identity mới; Point Catalog authority vẫn là chỗ cũ).
//
// Rev A: chỉ ba category LOCAL/VP/MB_RTU (OD-PROG-007); Kind từ producer thật
// (`pointKindFromID`, "virtual", "modbus_rtu") quyết định category — không tự
// suy đoán hay tạo category thứ tư.
type programmingPointCatalogAdapter struct{ app *App }

// programmingPointCatalog trả kiểu cụ thể (không phải interface hẹp) vì
// adapter implement `PointCatalogProvider`, `OverrideProvider` và
// `MonitorSnapshotProvider` — main.go gán cùng adapter read-only này vào ba
// field; không tạo authority Point thứ hai.
func (a *App) programmingPointCatalog() programmingPointCatalogAdapter {
	return programmingPointCatalogAdapter{app: a}
}

func (adapter programmingPointCatalogAdapter) ListPointCatalog(ctx context.Context) ([]programmingapplication.PointCatalogEntry, error) {
	points, err := adapter.app.ReadPoints(ctx)
	if err != nil {
		return nil, err
	}
	entries := make([]programmingapplication.PointCatalogEntry, 0, len(points))
	for _, point := range points {
		entries = append(entries, toPointCatalogEntry(point))
	}
	return entries, nil
}

func (adapter programmingPointCatalogAdapter) ReadProgrammingMonitorSnapshot(ctx context.Context) (programmingapplication.MonitorTruthSnapshot, error) {
	reader, ok := adapter.app.core.(historianSnapshotReader)
	if !ok {
		return programmingapplication.MonitorTruthSnapshot{}, fmt.Errorf("Core không hỗ trợ point_snapshot bounded")
	}
	snapshot, err := reader.ReadPointSnapshot(ctx)
	if err != nil {
		return programmingapplication.MonitorTruthSnapshot{}, err
	}
	points, err := adapter.app.ReadPoints(ctx)
	if err != nil {
		return programmingapplication.MonitorTruthSnapshot{}, err
	}
	physical := make(map[string]RuntimePoint, len(snapshot.Points))
	for _, point := range snapshot.Points {
		physical[point.ID] = point
	}
	trackedOverrides := map[string]overrideSnapshot{}
	if adapter.app.overrides != nil {
		trackedOverrides = adapter.app.overrides.Snapshot()
	}
	result := programmingapplication.MonitorTruthSnapshot{
		ObservedAt:                snapshot.SnapshotObservedAtUTC,
		CapturedMonotonicNs:       snapshot.CapturedMonotonicNs,
		SafeState:                 snapshot.SafeState,
		SafeStateNoControllerOnly: snapshot.SafeStateNoControllerOnly,
		ProgramsTruncated:         snapshot.ProgramsTruncated,
		Points:                    make([]programmingapplication.MonitorPointTruth, 0, len(points)),
	}
	// T60-012 — bảng Program đi cùng ĐÚNG snapshot này, không phải một
	// round-trip thứ hai: Core (`WebIpc::drain`) chỉ chấp nhận MỘT
	// `point_snapshot` mỗi scan cycle, nên mọi nguồn đọc trong web-api này phải
	// dùng chung kết quả đã coalesce ở `CoreClient.ReadPointSnapshot`. Thêm một
	// lần gọi riêng cho Program sẽ dựng lại đúng cuộc đụng độ đã sinh ra 40%
	// HTTP 503 ở Runtime Monitor hồi 2026-08-14.
	//
	// `if != nil` chứ không phải `if len() > 0`: nil (khoá `programs` vắng ⇒
	// Core đời cũ) phải đi tiếp thành nil để `ListPrograms` ra `UNAVAILABLE`,
	// còn `[]` (Core sống, hệ không có Program nào) phải giữ được là slice rỗng
	// non-nil. `make(..., 0, 0)` cho một slice non-nil, đúng thứ cần ở nhánh này.
	if snapshot.Programs != nil {
		programs := make([]programmingapplication.ProgramMetricsView, 0, len(snapshot.Programs))
		for _, program := range snapshot.Programs {
			programs = append(programs, programmingapplication.ProgramMetricsView{
				InstanceID: program.InstanceID, State: program.State, Enabled: program.Enabled,
				PeriodMS: program.PeriodMS, LastExecNS: program.LastExecNS, MaxExecNS: program.MaxExecNS,
				MissedReleaseCount:       program.MissedReleaseCount,
				ConsecutiveMissedRelease: program.ConsecutiveMissedRelease,
				LastRunMonoNS:            program.LastRunMonoNS, Lane: program.Lane,
			})
		}
		result.Programs = programs
	}
	if snapshot.Task != nil {
		result.Task = &programmingapplication.TaskMetricsView{
			TaskID: snapshot.Task.TaskID, PeriodMS: snapshot.Task.PeriodMS,
			BudgetMS: snapshot.Task.BudgetMS, State: snapshot.Task.State,
			RunCount: snapshot.Task.RunCount, MissedReleaseCount: snapshot.Task.MissedReleaseCount,
			LastExecNS: snapshot.Task.LastExecNS, MaxExecNS: snapshot.Task.MaxExecNS,
			OverrunCount: snapshot.Task.OverrunCount, ConsecutiveOverruns: snapshot.Task.ConsecutiveOverruns,
		}
	}
	for _, point := range points {
		category, deviceID := pointCatalogCategory(point)
		// Cùng bug F-PROG-ASBUILT-014 lộ lại ở Monitor: Binding trong Revision
		// lưu Point.PointID là slot Core thật (vd "AV-02"), nếu truth ở đây vẫn
		// đánh chỉ mục bằng id thân thiện "VP3" thì monitorPointKey() không bao
		// giờ khớp — Monitor Program báo "UNKNOWN · UNAVAILABLE" cho MỌI biến
		// bind VP dù giá trị Core thật hoàn toàn hợp lệ (xác nhận qua socket
		// debug: applied_value đúng, chỉ có việc tra cứu quality bị lệch key).
		truth := programmingapplication.MonitorPointTruth{
			Category: category, PointID: pointCatalogPointID(category, point), DeviceID: deviceID,
			ObservedAt: point.UpdatedAt, ActualValue: point.Value, Source: point.Source,
			Quality: pointCatalogQuality(point), Unit: point.Unit,
		}
		if sample, exists := physical[point.ID]; category == "LOCAL" && exists {
			truth.ObservedAt = snapshot.SnapshotObservedAtUTC
			truth.ActualValue = sample.Value
			truth.ProgramValue = sample.ProgramValue
			truth.Source = sample.Source
			truth.EffectivePriority = sample.EffectivePriority
			truth.Quality = sample.Quality
			if sample.Unit != "" {
				truth.Unit = sample.Unit
			}
		}
		if point.OverrideExpiresInS != nil {
			remaining := int64(*point.OverrideExpiresInS)
			truth.OverrideRemainingS = &remaining
		}
		if tracked, exists := trackedOverrides[canonicalPointID(point.ID)]; exists {
			truth.OverrideActor = tracked.User
			remaining := int64(tracked.RemainingS)
			truth.OverrideRemainingS = &remaining
		}
		result.Points = append(result.Points, truth)
	}
	return result, nil
}

// ListActiveOverrides — TASK-PROG-504. Chỉ những Point đang thật sự bị force
// (`Forced==true`) mới xuất hiện; TTL và actor lấy từ `OverrideRegistry` khi
// registry còn nhớ (override được force qua chính web-api này), nếu không thì
// dùng field TTL tự thân của PointDTO (`OverrideExpiresInS`, có thể do Core
// hoặc web restart chưa đồng bộ vào registry) và để `actorId` rỗng — KHÔNG
// suy đoán actor để lấp chỗ trống. `EffectivePriority` cố ý bỏ trống:
// `PointDTO.Priority` là chuỗi mô tả nguồn (vd. "Virtual Point"), không phải
// mức ưu tiên số 1..5 của arbitration — gán nhầm sẽ là bịa dữ liệu.
func (adapter programmingPointCatalogAdapter) ListActiveOverrides(ctx context.Context) ([]programmingapplication.OverrideEntry, error) {
	points, err := adapter.app.ReadPoints(ctx)
	if err != nil {
		return nil, err
	}
	snapshot := adapter.app.overrides.Snapshot()
	entries := make([]programmingapplication.OverrideEntry, 0)
	for _, point := range points {
		if !point.Forced {
			continue
		}
		category, deviceID := pointCatalogCategory(point)
		entry := programmingapplication.OverrideEntry{
			Category: category, PointID: point.ID, DeviceID: deviceID, Value: point.Value, Source: point.Source,
		}
		if remaining := point.OverrideExpiresInS; remaining != nil {
			value := int64(*remaining)
			entry.RemainingS = &value
		}
		if tracked, ok := snapshot[point.ID]; ok {
			entry.ActorID = tracked.User
			value := int64(tracked.RemainingS)
			entry.RemainingS = &value
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// pointCatalogPointID — F-PROG-ASBUILT-014: category VP chỉ resolve được ở
// Core khi pointId là slot AV-n/BV-n thật đã đồng bộ (`BoundPointID`), không
// phải id thân thiện "VP1" (id đó vẫn đúng cho mọi API điểm khác, chỉ riêng
// các chỗ Programming cần đối chiếu với Binding.Point.PointID trong Revision
// — vốn luôn lưu id Core thật — mới cần định danh này).
func pointCatalogPointID(category string, point PointDTO) string {
	if category == "VP" && point.BoundPointID != "" {
		return point.BoundPointID
	}
	return point.ID
}

func toPointCatalogEntry(point PointDTO) programmingapplication.PointCatalogEntry {
	category, deviceID := pointCatalogCategory(point)
	direction, writable := pointCatalogDirection(point)
	pointID := pointCatalogPointID(category, point)
	return programmingapplication.PointCatalogEntry{
		Category: category, PointID: pointID, DeviceID: deviceID, Name: pointCatalogName(point),
		DataType: pointCatalogDataType(point), Unit: point.Unit, Direction: direction, Writable: writable,
		Quality: pointCatalogQuality(point), Value: point.Value, ObservedAt: point.UpdatedAt,
	}
}

func pointCatalogCategory(point PointDTO) (category, deviceID string) {
	switch point.Kind {
	case "virtual", "VP":
		return "VP", ""
	case "modbus_rtu":
		return "MB_RTU", fmt.Sprintf("bus-%d-slave-%d", point.BusID, point.SlaveAddr)
	default:
		return "LOCAL", ""
	}
}

func pointCatalogName(point PointDTO) string {
	if point.Name != "" {
		return point.Name
	}
	return point.ID
}

func pointCatalogDirection(point PointDTO) (direction string, writable bool) {
	switch point.Kind {
	case "AO", "DO":
		return "READ_WRITE", true
	case "virtual":
		// `Writable` ở đây là "operator có sửa được giá trị VP từ dashboard
		// không" — một trục hoàn toàn khác với "ST Program bind VAR_OUTPUT
		// ghi được VP không". Trục sau CHƯA có (resolve_io_bindings() chặn
		// tường minh mọi VAR_OUTPUT category VP, F-PROG-ASBUILT-016) nên
		// Point Catalog phải báo READ bất kể `Writable`, tránh Design/Mapping
		// tab cho chọn một hướng binding sẽ luôn fail Check.
		return "READ", false
	case "modbus_rtu":
		if point.Writable {
			return "READ_WRITE", true
		}
		return "READ", false
	default:
		return "READ", false
	}
}

func pointCatalogDataType(point PointDTO) string {
	switch point.Kind {
	case "DO":
		return "BOOL"
	case "AO", "UI":
		if _, ok := point.Value.(bool); ok {
			return "BOOL"
		}
		return "REAL"
	default:
		if _, ok := point.Value.(bool); ok {
			return "BOOL"
		}
		return "REAL"
	}
}

// pointCatalogQuality chuẩn hoá quality producer về đúng sáu mức Programming
// (DM-PROG-001 — GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN); giá trị lạ hoặc
// rỗng về UNKNOWN, KHÔNG suy đoán thành GOOD (RSK-PROG-010).
func pointCatalogQuality(point PointDTO) string {
	quality := strings.ToUpper(strings.TrimSpace(point.Quality))
	switch quality {
	case "GOOD", "UNCERTAIN", "BAD", "STALE", "OFFLINE", "UNKNOWN":
		return quality
	case "CONFIG_ERROR":
		return "BAD"
	default:
		return "UNKNOWN"
	}
}
