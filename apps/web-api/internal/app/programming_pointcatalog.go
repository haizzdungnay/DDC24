package app

import (
	"context"
	"fmt"
	"strings"

	programmingapplication "mkddc-web/internal/programming/application"
)

// programmingPointCatalogAdapter chiếu `PointDTO` (authority Point hiện hữu
// của toàn hệ thống — capability LOCAL qua SHM Core và runtime truth qua
// end-scan snapshot của Programming Core, VP qua `overlayVirtualPoints`,
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
	/* `ISS-PIO-31` — CATALOG PHẢI PHÁT `extIndex`, KHÔNG CHỈ MÔ TẢ ĐIỂM.
	 *
	 * `EvaluatePointMapEligibility` đọc `ExtIndex` để quyết định một điểm
	 * MB_RTU có bind được chưa; bỏ trống nó thì MỌI điểm Modbus trả về
	 * `UNSUPPORTED_BY_CORE` kèm lý do "Catalog chưa phát extIndex" — và người
	 * dùng không có đường nào dựng binding Modbus qua chính sản phẩm, dù Core
	 * đã resolve `MB_RTU` từ lâu và `BuildExtLayout` đã tính sẵn con số.
	 *
	 * Nguồn là CÙNG một adapter mà đường Check dùng, nên số Catalog quảng cáo
	 * và số Check phân giải lại không thể trôi khỏi nhau. Lỗi đọc bố cục KHÔNG
	 * làm hỏng cả catalog: điểm LOCAL/VP không phụ thuộc nó, còn điểm MB_RTU
	 * giữ `ExtIndex = 0` và tự rơi về đúng nhánh "chưa bind được" có sẵn. */
	slotOf := map[string]int{}
	if snapshot, slotErr := adapter.app.programmingModbusSlots().ResolveModbusSlots(ctx); slotErr == nil {
		for _, slot := range snapshot.Slots {
			slotOf[modbusCatalogKey(slot.DeviceID, slot.PointID)] = slot.ExtIndex
		}
	}

	/* `ISS-PIO-09` — danh tính THEO NGUỒN. Đọc cấu hình MỘT LẦN cho cả trang
	 * thay vì mỗi hàng một lần: catalog có thể tới vài trăm điểm và đọc lại
	 * cùng ba file cho từng điểm là biến một trang danh sách thành một bài
	 * kiểm tra I/O. */
	identity := adapter.pointCatalogIdentitySource()

	entries := make([]programmingapplication.PointCatalogEntry, 0, len(points))
	for _, point := range points {
		entry := toPointCatalogEntry(point)
		if entry.Category == "MB_RTU" {
			entry.ExtIndex = slotOf[modbusCatalogKey(entry.DeviceID, entry.PointID)]
		}
		entries = append(entries, entry)
	}
	entries = adapter.overlayCatalogRuntimeTruth(ctx, entries)
	for index := range entries {
		identity.apply(&entries[index])
	}
	return entries, nil
}

// overlayCatalogRuntimeTruth dùng end-scan snapshot của chính Core đang phục vụ
// Programming cho value/quality LOCAL. PLC SHM vẫn giữ capability và toàn bộ
// catalog; snapshot chỉ thay các field runtime của Point trùng identity.
//
// Trên target hai nguồn do cùng mkddc-core phát. Trên lane host, Core simulator
// có thể chạy cạnh chuỗi no-board chỉ để cấp catalog vật lý; nếu giữ quality từ
// SHM của tiến trình khác thì preview sẽ bác một Point mà Check/runtime đang đọc
// GOOD. Không có snapshot hoặc snapshot lỗi thì giữ nguyên SHM truth, không bịa.
func (adapter programmingPointCatalogAdapter) overlayCatalogRuntimeTruth(ctx context.Context,
	entries []programmingapplication.PointCatalogEntry) []programmingapplication.PointCatalogEntry {
	reader, ok := adapter.app.core.(historianSnapshotReader)
	if !ok {
		return entries
	}
	snapshot, err := reader.ReadPointSnapshot(ctx)
	if err != nil {
		return entries
	}
	local := make(map[string]RuntimePoint, len(snapshot.Points))
	for _, point := range snapshot.Points {
		local[point.ID] = point
	}
	for index := range entries {
		entry := &entries[index]
		point, exists := local[entry.PointID]
		if entry.Category != "LOCAL" || !exists {
			continue
		}
		entry.Value = point.Value
		entry.Quality = pointCatalogQuality(PointDTO{Quality: point.Quality})
		entry.ObservedAt = snapshot.SnapshotObservedAtUTC
		if point.Unit != "" {
			entry.Unit = point.Unit
		}
	}
	return entries
}

// modbusCatalogKey ghép danh tính bền `(deviceId, pointId)` thành khoá tra.
// `pointId` là unique không phân biệt hoa thường theo `modbusrtu/validate.go`,
// nên tra theo mình `pointId` cũng đủ — nhưng ghép cả `deviceId` giữ cho phép
// tra HỎNG TO khi hai hệ danh tính lệch nhau, thay vì âm thầm khớp nhầm điểm
// cùng tên ở thiết bị khác nếu ràng buộc unique kia đổi.
func modbusCatalogKey(deviceID, pointID string) string {
	return strings.ToLower(deviceID) + "\x00" + strings.ToLower(pointID)
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
	result := programmingapplication.MonitorTruthSnapshot{
		ObservedAt:                snapshot.SnapshotObservedAtUTC,
		CapturedMonotonicNs:       snapshot.CapturedMonotonicNs,
		SafeState:                 snapshot.SafeState,
		SafeStateNoControllerOnly: snapshot.SafeStateNoControllerOnly,
		ProgramsTruncated:         snapshot.ProgramsTruncated,
		Points:                    []programmingapplication.MonitorPointTruth{},
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
				LastFaultCode:            program.LastFaultCode,
				LastFaultLine:            program.LastFaultLine,
				FaultCount:               program.FaultCount,
				WaitingReason:            program.WaitingReason,
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
			// Chuyển NGUYÊN con trỏ (ADR-061 mục 4.9): `nil` phải tới FE thành
			// `null` để nó hiện "Core không cấp", không phải "0 vi phạm".
			BudgetUS: snapshot.Task.BudgetUS, BaseStepUS: snapshot.Task.BaseStepUS,
			JitterMaxUS:          snapshot.Task.JitterMaxUS,
			JitterViolationCount: snapshot.Task.JitterViolationCount,
			MissedBaseStepCount:  snapshot.Task.MissedBaseStepCount,
		}
	}

	/* Bảng task/program VÀ point vật lý thuộc cùng point_snapshot qua Web IPC,
	   nên vẫn là truth sống khi PLC SHM chưa attach (host simulator hoặc lúc
	   producer SHM đang khởi động). Không được vứt `snapshot.Points` chỉ vì
	   đường Point Catalog/SHM phụ trợ hỏng: làm vậy đã khiến Core báo UI-01=21.5
	   nhưng Runtime Monitor trả mảng rỗng. Point Catalog CRUD vẫn fail theo SHM;
	   riêng Monitor dùng snapshot Core, giữ quality/value nguyên nguồn. */
	points, pointsErr := adapter.app.ReadPoints(ctx)
	if pointsErr != nil {
		trackedOverrides := map[string]overrideSnapshot{}
		if adapter.app.overrides != nil {
			trackedOverrides = adapter.app.overrides.Snapshot()
		}
		result.Points = make([]programmingapplication.MonitorPointTruth, 0, len(snapshot.Points))
		for _, point := range snapshot.Points {
			truth := programmingapplication.MonitorPointTruth{
				Category: "LOCAL", PointID: point.ID,
				ObservedAt: snapshot.SnapshotObservedAtUTC, ActualValue: point.Value,
				ProgramValue: point.ProgramValue, Source: point.Source,
				EffectivePriority: point.EffectivePriority,
				Quality:           pointCatalogQuality(PointDTO{Quality: point.Quality}), Unit: point.Unit,
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
	result.Points = make([]programmingapplication.MonitorPointTruth, 0, len(points))
	physical := make(map[string]RuntimePoint, len(snapshot.Points))
	for _, point := range snapshot.Points {
		physical[point.ID] = point
	}
	trackedOverrides := map[string]overrideSnapshot{}
	if adapter.app.overrides != nil {
		trackedOverrides = adapter.app.overrides.Snapshot()
	}
	extCommands := adapter.extCommandsByPoint()
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
		if command, exists := extCommands[strings.ToUpper(point.ID)]; category == "MB_RTU" && exists {
			// F05 (EV-PROG-FBD-ST-MB-20260925): điểm Modbus không có dòng trong
			// snapshot Core, nên `programValue` của binding WRITE luôn null — không
			// tách được "Program đã ra lệnh gì" khỏi "coil đọc lại là gì". Lệnh nằm
			// ngay trong slot `ext` của `plc_shm`.
			setpoint := command
			truth.ProgramValue = &setpoint
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

// extCommandsByPoint trả lệnh ghi hiện hành của mọi slot `ext` ĐÃ có lệnh, khoá
// theo `point_id` viết hoa. Không đọc được SHM thì trả rỗng: thiếu `programValue`
// là câu trả lời đúng, bịa 0 thì không.
func (adapter programmingPointCatalogAdapter) extCommandsByPoint() map[string]float64 {
	reader, ok := adapter.app.core.(extCatalogReader)
	if !ok {
		return nil
	}
	slots, err := reader.ReadExtCatalog()
	if err != nil {
		return nil
	}
	commands := make(map[string]float64, len(slots))
	for _, slot := range slots {
		if slot.Dirty && slot.PointID != "" {
			commands[strings.ToUpper(slot.PointID)] = slot.Setpoint
		}
	}
	return commands
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
		Description: point.Note, Enabled: point.Enabled, Equipment: point.Equipment,
		SourceRef: pointCatalogSourceRef(category, deviceID, point),
	}
}

/* pointCatalogSourceRef — định danh NGUỒN sinh ra giá trị (`ISS-PIO-07`).
 *
 * Tiền tố là bắt buộc, không phải trang trí: một `deviceId` Modbus và một mã
 * kênh trên bo là hai không gian tên khác nhau, và gộp chúng vào một chuỗi
 * trần thì consumer không phân biệt được `AV-01` (slot Core) với một thiết bị
 * tình cờ tên `AV-01`.
 *
 * Rỗng nghĩa là CHƯA CÓ NGUỒN — một VP chưa bind slot nào thì thật sự chưa có
 * gì sinh ra giá trị cho nó, và nói "không có" là đúng hơn mọi giá trị tạm.
 */
func pointCatalogSourceRef(category, deviceID string, point PointDTO) string {
	switch category {
	case "MB_RTU":
		if deviceID == "" {
			return ""
		}
		return "modbus:" + deviceID
	case "VP":
		if point.BoundPointID == "" {
			return ""
		}
		return "core:" + point.BoundPointID
	default:
		if point.ID == "" {
			return ""
		}
		return "iop:" + point.ID
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
		/* Hai trục KHÁC NHAU, và trước đây chúng bị gộp làm một:
		 *
		 *   `Writable`  — operator có sửa giá trị VP từ dashboard không;
		 *   `source`    — AI sở hữu slot: web-api (`WEB`) hay ST Program.
		 *
		 * `F-PROG-ASBUILT-016` gỡ chặn chiều ghi, nên trục thứ hai nay tồn tại.
		 * VP do CHƯƠNG TRÌNH sở hữu là đích ghi hợp lệ của `VAR_OUTPUT`; VP do
		 * web-api sở hữu thì KHÔNG — chương trình ghi vào đó sẽ bị vòng đối
		 * chiếu kéo về giá trị cấu hình mỗi 10 giây, một cuộc giằng co im lặng
		 * mà không bên nào thắng hẳn.
		 *
		 * Báo READ cho VP do web-api sở hữu vì thế KHÔNG phải sự thận trọng
		 * thừa: nó ngăn tab Ánh xạ mời người dùng chọn một hướng binding sẽ
		 * hỏng lúc chạy chứ không hỏng lúc Check. */
		if strings.EqualFold(point.VirtualSource, virtualPointSourceProgram) {
			return "READ_WRITE", true
		}
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

/* pointCatalogDataType — `ISS-PIO-06`/`F-PIO-005`.
 *
 * Bản cũ đọc `point.Value` để đoán kiểu, và cả ba hệ quả đều là hệ quả của
 * chính phép đoán đó:
 *
 *  1. Một kênh UI đặt tiếp điểm khô mà CHƯA CÓ MẪU (`Value == nil`) được khai
 *     là `REAL`; bind vào `VAR_INPUT : BOOL` bị báo "Kiểu dữ liệu không khớp",
 *     rồi TỰ HẾT SAI khi điểm có mẫu. Một lỗi nhấp nháy theo trạng thái hiện
 *     trường là lỗi khó tin nhất đối với người vận hành: nó biến mất đúng lúc
 *     họ gọi người khác đến xem.
 *  2. `MSV` không bao giờ ra `UINT`, nên nhánh Multistate không có đường chạy.
 *  3. Điểm Modbus `int16`/`int32`/`uint32` gộp hết về `REAL`, mất cả dải lẫn dấu.
 *
 * Nguồn sự thật nay là CẤU HÌNH: `data_type` của điểm Modbus, `signalType` của
 * VP và của kênh UI, và bản chất phần cứng của AO/DO. Không nhánh nào ở đây
 * còn nhìn vào `point.Value` — kiểu của một điểm không được phép đổi theo việc
 * hôm nay có đọc được số hay không.
 */
func pointCatalogDataType(point PointDTO) string {
	switch point.Kind {
	case "modbus_rtu":
		return modbusDataTypeToIEC(point.DataType)
	case "virtual", "VP":
		return virtualPointDataType(point)
	case "DO":
		// Rơ-le: BOOL là bản chất phần cứng, không phải suy diễn.
		return "BOOL"
	case "AO", "UI":
		/* `ISS-PIO-33` — KIỂU io_map CỦA UI/AO LUÔN LÀ REAL.
		 *
		 * `st_io_map.cpp:93` chốt cứng, không có ngoại lệ nào cho tiếp điểm khô:
		 *     type_valid = ((prefix == "UI" || prefix == "AO") && type == REAL)
		 *               || ((prefix == "DI" || prefix == "DO") && type == BOOL);
		 * UI/AO nằm trong `plc_shm.ai[]`/`ao[]` và luôn là float; `DI` mới là họ
		 * BOOL, và nó là một prefix RIÊNG.
		 *
		 * Đã hỏng HAI LẦN theo hai đường khác nhau, nên chú thích này ở lại:
		 *   1. Bản gốc đánh hơi kiểu Go của `point.Value`: kênh UI cấu hình
		 *      digital được `decodePoints` đổi `Value` sang `bool` cho giao diện
		 *      hiển thị ON/OFF ⇒ catalog phát BOOL.
		 *   2. `ISS-PIO-06` bỏ lối đoán đó và đọc `signalType` từ cấu hình —
		 *      đúng nguyên tắc, nhưng `universalInputDataType` vẫn trả BOOL khi
		 *      `signalType == "dry"` ⇒ catalog VẪN phát BOOL. Sửa nguyên nhân mà
		 *      giữ nguyên triệu chứng.
		 * Cả hai lần, `EvaluatePointMapEligibility` chặn điểm ở CẢ HAI chiều với
		 * lý do "Core yêu cầu REAL cho điểm UI". Đo trên bo Foxlinx: `UI-09..UI-13`
		 * — năm kênh đấu tiếp điểm — không map được vào bất kỳ biến ST nào, dù
		 * chúng đọc đúng và quality GOOD.
		 *
		 * Kiểu HIỂN THỊ và kiểu IO_MAP là hai thứ khác nhau: `signalType: "dry"`
		 * vẫn nói "kênh này là tiếp điểm" cho giao diện, còn `dataType` phải nói
		 * đúng cách Core lưu điểm. Trộn hai thứ làm một là để một lựa chọn hiển
		 * thị âm thầm gỡ mất khả năng lập trình của cả kênh. */
		return "REAL"
	}
	return "REAL"
}

// modbusDataTypeToIEC giữ nguyên ĐỘ RỘNG và DẤU mà `fieldbus.conf` khai.
// Gộp tất cả về `REAL` làm mất thông tin mà chính người dùng đã nhập.
func modbusDataTypeToIEC(dataType string) string {
	switch strings.ToLower(strings.TrimSpace(dataType)) {
	case "bool":
		return "BOOL"
	case "int16":
		return "INT"
	case "uint16":
		return "UINT"
	case "int32":
		return "DINT"
	case "uint32":
		return "UDINT"
	case "float32":
		return "REAL"
	}
	// Cấu hình chưa nói kiểu ⇒ giữ `REAL` như trước. KHÔNG đoán từ giá trị:
	// một điểm chưa có mẫu và một điểm đang đọc ra `true` phải cho cùng câu
	// trả lời, vì cấu hình của chúng giống nhau.
	return "REAL"
}

/* virtualPointDataType lấy kiểu từ SLOT mà VP đã bind, rồi mới tới `signalType`.
 *
 * Slot đứng trước vì nó là thứ Core THẬT SỰ cấp phát: `MSV-*` là `UINT`, và đó
 * chính là hệ quả (2) — trước bản vá không đường nào cho ra `UINT`, nên nhánh
 * Multistate của FE (`PREFIX_TYPE.MSV = 'UINT'`) không bao giờ khớp được. */
func virtualPointDataType(point PointDTO) string {
	if prefix, _, ok := parsePointID(point.BoundPointID); ok {
		switch prefix {
		case "BV":
			return "BOOL"
		case "MSV":
			return "UINT"
		case "AV":
			/* `ISS-PIO-34` — SLOT QUYẾT ĐỊNH KIỂU io_map, KHÔNG PHẢI `signalType`.
			 *
			 * `st_io_map.cpp` chốt `AV ⇒ StType::REAL` không ngoại lệ: slot AV
			 * nằm trong `plc_shm.av[]` và luôn là float. Còn `vpPoolFor` CỐ Ý
			 * đưa cả `integer` lẫn `float` vào pool AV — `MSV` để dành cho
			 * `multistate` (#401). Nên một VP `signalType: "integer"` nằm trên
			 * slot AV là ĐÚNG thiết kế, và trả `DINT` ở đây là catalog tự mâu
			 * thuẫn với allocator của chính mình.
			 *
			 * Hậu quả đo được trên bo Foxlinx: `AV-05` (`VP_AHU_STATE`, enum
			 * 0..8) bị chặn ở CẢ HAI chiều với lý do "Core yêu cầu REAL cho điểm
			 * AV, catalog đang phát DINT" — một VP đọc đúng, quality GOOD, mà
			 * không map được vào biến ST nào.
			 *
			 * Đây là lần thứ BA cùng một lớp lỗi: `UI` tiếp điểm khô
			 * (`ISS-PIO-33`) và nay `AV` kiểu integer. Cùng một gốc: để thuộc
			 * tính KHAI BÁO/HIỂN THỊ của điểm quyết định kiểu io_map, trong khi
			 * kiểu io_map chỉ được nói đúng CÁCH CORE LƯU điểm. `signalType`
			 * vẫn có mặt trong catalog cho giao diện dùng. */
			return "REAL"
		}
	}
	return virtualSignalTypeToIEC(point.SignalType)
}

func virtualSignalTypeToIEC(signalType string) string {
	switch strings.ToLower(strings.TrimSpace(signalType)) {
	case virtualPointSignalBoolean:
		return "BOOL"
	case virtualPointSignalInteger:
		return "DINT"
	case virtualPointSignalMultistate:
		/* `ISS-PIO-17` — state là chỉ số rời rạc không âm, nên `UINT` chứ không
		 * phải `DINT`: một biến chương trình nhận state âm là vô nghĩa, và
		 * `REAL` sẽ mời người viết chương trình so sánh state bằng số thực. */
		return "UINT"
	}
	return "REAL"
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
