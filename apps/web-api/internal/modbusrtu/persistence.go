package modbusrtu

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

var ErrApply = errors.New("không thể áp dụng cấu hình Modbus RTU; cấu hình cũ đã được phục hồi")

// errRollbackIncomplete: quay về cấu hình cũ KHÔNG hoàn tất. Đĩa đang ở trạng
// thái lai — còn nguyên (một phần) cấu hình mới, thứ mà iobus vừa từ chối hoặc
// không nạp được, và là thứ nó sẽ đọc ở lần khởi động sau.
//
// Vì sao phải có một lỗi riêng thay vì nuốt im như bản cũ: `ErrApply` nói
// "cấu hình cũ đã được phục hồi" và journal ghi `ROLLED_BACK`. Khi `restore()`
// hỏng mà không ai thu lỗi, cả hai câu đó đều SAI, và không phép đo nào phát
// hiện được vì trạng thái journal do chính nhánh lỗi này tự đặt. Người vận hành
// cần biết ngay tại lúc apply hỏng rằng đĩa không còn khớp với thứ họ được báo.
var errRollbackIncomplete = errors.New("quay về cấu hình cũ THẤT BẠI: đĩa còn giữ cấu hình mới, lần khởi động sau iobus sẽ nạp đúng thứ vừa bị từ chối")

type FileWriter func(string, []byte, os.FileMode) error
type ReloadFunc func() (bool, []string)

// Persister ghi cấu hình xuống đĩa rồi báo iobus nạp lại.
//
// MBR-B212: `Reload` (restart service) KHÔNG còn là đường chính. Restart
// mkddc-iobus để áp một thay đổi Modbus cắt luôn IOP 100 Hz — mọi I/O vật lý
// của tủ ngừng vài giây chỉ vì ai đó sửa tên một Point (D-09). Đường chính nay
// là `Control.ApplyConfig`, áp cấu hình tại ranh giới giữa hai transaction
// Modbus. `Reload` chỉ còn là phương án dự phòng khi iobus chưa mở kênh điều
// khiển (bản cũ chưa nâng cấp), và khi dùng thì phải nói rõ trong warnings.
type Persister struct {
	ConfigDir  string
	ConfigPath string
	WriteFile  FileWriter
	Reload     ReloadFunc
	Control    ControlClient
	Journal    Journal
	Actor      string
	// OperationID để idempotent; rỗng ⇒ không ghi nhớ.
	OperationID string
}

type ApplyResult struct {
	Config     Config
	Warnings   []string
	Generation uint64
	// Cách cấu hình được nạp: "control" (ranh giới transaction) hoặc
	// "service_restart" (dự phòng, có gián đoạn I/O).
	ReloadMode string
}

// Apply chạy transaction: stage → journal → gửi iobus → ACK → commit.
func (p Persister) Apply(cfg, previous Config) (ApplyResult, error) {
	if p.WriteFile == nil {
		return ApplyResult{}, errors.New("modbus persister thiếu WriteFile")
	}
	var warnings []string

	for i := range cfg.Devices {
		cfg.Devices[i] = NormalizeDevice(cfg.Devices[i])
	}
	for i := range cfg.Points {
		cfg.Points[i] = NormalizePoint(cfg.Points[i])
	}
	buses, migrationWarnings := MigrateBuses(cfg)
	warnings = append(warnings, migrationWarnings...)
	for i := range buses {
		buses[i] = NormalizeBus(buses[i])
	}
	cfg.Buses = buses
	// Sau khi bus đã chuẩn hoá: đồng bộ tham số serial xuống Device. Phải nằm
	// TRƯỚC checksum, nếu không hai cấu hình giống hệt nhau về ý nghĩa lại cho
	// hai checksum khác nhau chỉ vì device còn giữ baud cũ.
	ApplyBusInheritance(&cfg)

	cfg.Revision = previous.Revision + 1
	// MBR-B206: checksum tính trên canonical form của NGUỒN CHÂN LÝ, trước khi
	// sinh các khối phái sinh. Bản cũ marshal cả struct (gồm map `rs485`/
	// `slaves` do Go sinh) nên checksum phụ thuộc thứ tự key của map và kiểu
	// số học của giá trị — cùng một cấu hình cho ra hai checksum khác nhau.
	sum, err := Checksum(cfg)
	if err != nil {
		return ApplyResult{}, err
	}
	cfg.Checksum = sum
	cfg = buildFieldbusBlocks(cfg, p.ConfigDir)

	configData, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return ApplyResult{}, err
	}
	configData = append(configData, '\n')

	tx := Transaction{
		OperationID:    p.OperationID,
		TargetRevision: cfg.Revision,
		BaseRevision:   previous.Revision,
		Checksum:       cfg.Checksum,
		State:          TxStaged,
		Actor:          p.Actor,
		StartedAt:      time.Now().UTC(),
	}
	if p.Journal.Path != "" {
		if err := p.Journal.Write(tx); err != nil {
			return ApplyResult{}, fmt.Errorf("không ghi được journal: %w", err)
		}
	}

	type snapshot struct {
		path   string
		data   []byte
		exists bool
	}
	var snapshots []snapshot
	// restore trả về lỗi thay vì vứt: đây là TOÀN BỘ cơ chế quay về của Apply,
	// nên một `WriteFile` hỏng ở đây (đĩa đầy, EROFS, mất quyền trên đường dẫn)
	// là khác biệt giữa "đã quay về an toàn" và "đĩa đang ở trạng thái lai".
	// Không dừng ở lỗi đầu tiên: các snapshot còn lại vẫn phải được thử: quay về
	// được ba trong bốn file vẫn tốt hơn bỏ dở ở file đầu, và báo cáo phải nêu
	// ĐỦ các đường dẫn không quay về được để người vận hành biết phải sửa ở đâu.
	restore := func() error {
		var failed []string
		for i := len(snapshots) - 1; i >= 0; i-- {
			snap := snapshots[i]
			var err error
			if snap.exists {
				err = p.WriteFile(snap.path, snap.data, 0o644)
			} else {
				// File chưa từng tồn tại trước transaction: quay về nghĩa là xoá.
				// Vắng mặt sẵn thì đã đúng đích, không phải lỗi.
				if err = os.Remove(snap.path); os.IsNotExist(err) {
					err = nil
				}
			}
			if err != nil {
				failed = append(failed, fmt.Sprintf("%s (%v)", snap.path, err))
			}
		}
		if len(failed) == 0 {
			return nil
		}
		return fmt.Errorf("%w; đường dẫn không quay về được: %s",
			errRollbackIncomplete, strings.Join(failed, "; "))
	}
	write := func(path string, data []byte) error {
		old, readErr := os.ReadFile(path)
		snapshots = append(snapshots, snapshot{path: path, data: old, exists: readErr == nil})
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		return p.WriteFile(path, data, 0o644)
	}
	remove := func(path string) error {
		old, readErr := os.ReadFile(path)
		if readErr != nil && !os.IsNotExist(readErr) {
			return readErr
		}
		snapshots = append(snapshots, snapshot{path: path, data: old, exists: readErr == nil})
		if os.IsNotExist(readErr) {
			return nil
		}
		return os.Remove(path)
	}
	// withRollback gộp kết quả quay về vào hai thứ mà người khác đọc được: lỗi
	// trả về cho caller (và qua đó là thông điệp người vận hành thấy) và `Reason`
	// ghi vào journal. Rollback hỏng phải hiện ở CẢ HAI: chỉ ghi nguyên nhân gốc
	// thì bản ghi `ROLLED_BACK` vẫn đọc như một lần quay về trót lọt.
	//
	// Lỗi rollback đứng TRƯỚC nguyên nhân gốc, ở cả hai chuỗi: `ErrApply` mở đầu
	// bằng "cấu hình cũ đã được phục hồi", nên đặt nó trước thì người vận hành
	// đọc câu sai trước rồi mới tới câu đính chính — và có thể dừng ở câu đầu.
	// Thứ tự bọc `%w` không đổi kết quả `errors.Is`, nên tầng HTTP vẫn phân loại
	// được theo `ErrApply` như cũ.
	withRollback := func(reason string, cause error, rollbackErr error) (string, error) {
		if rollbackErr == nil {
			return reason, cause
		}
		return fmt.Sprintf("%v; nguyên nhân gốc: %s", rollbackErr, reason),
			fmt.Errorf("%w; nguyên nhân apply hỏng: %w", rollbackErr, cause)
	}
	failTx := func(state, reason string, cause error) (ApplyResult, error) {
		reason, cause = withRollback(reason, cause, restore())
		if p.Journal.Path != "" {
			tx.State = state
			tx.Reason = reason
			_ = p.Journal.Write(tx)
		}
		return ApplyResult{}, cause
	}

	for _, device := range cfg.Devices {
		profile, err := BuildProfile(device, cfg.Points)
		if err != nil {
			return failTx(TxRolledBack, err.Error(), err)
		}
		if err := write(filepath.Join(p.ConfigDir, "profiles", device.DeviceID+".json"), profile); err != nil {
			return failTx(TxRolledBack, err.Error(), err)
		}
	}
	currentDevices := make(map[string]struct{}, len(cfg.Devices))
	for _, device := range cfg.Devices {
		currentDevices[device.DeviceID] = struct{}{}
	}
	for _, oldDevice := range previous.Devices {
		if _, keep := currentDevices[oldDevice.DeviceID]; keep {
			continue
		}
		if err := remove(filepath.Join(p.ConfigDir, "profiles", oldDevice.DeviceID+".json")); err != nil {
			return failTx(TxRolledBack, err.Error(), err)
		}
	}
	if err := write(p.ConfigPath, configData); err != nil {
		return failTx(TxRolledBack, err.Error(), err)
	}

	// Bản last-known-good: khi apply hỏng ở bước iobus, đây là thứ để quay về
	// mà không cần dựng lại từ trạng thái trong bộ nhớ của tiến trình web.
	//
	// Ghi hỏng KHÔNG làm apply thất bại — cấu hình mới vẫn áp được — nhưng phải
	// nói ra: bản LKG vắng mặt là thứ người vận hành cần biết TRƯỚC khi cần tới
	// nó, chứ không phải lúc đang cần quay về và phát hiện không có gì để quay về.
	if previous.Revision > 0 {
		lkgPath := filepath.Join(p.ConfigDir, "fieldbus.lkg.json")
		lkg, err := json.MarshalIndent(previous, "", "  ")
		if err != nil {
			warnings = append(warnings, fmt.Sprintf(
				"không dựng được bản last-known-good %s: %v; lần apply sau nếu hỏng sẽ không có bản cũ trên đĩa để quay về", lkgPath, err))
		} else if err := p.WriteFile(lkgPath, append(lkg, '\n'), 0o644); err != nil {
			warnings = append(warnings, fmt.Sprintf(
				"không ghi được bản last-known-good %s: %v; lần apply sau nếu hỏng sẽ không có bản cũ trên đĩa để quay về", lkgPath, err))
		}
	}

	if p.Journal.Path != "" {
		tx.State = TxSent
		_ = p.Journal.Write(tx)
	}

	// Đường chính: báo iobus nạp lại tại ranh giới transaction.
	if p.Control.SocketPath != "" {
		ack, err := p.Control.ApplyConfig(cfg.Revision, cfg.Checksum, p.ConfigPath)
		if err == nil && ack.Result == "ack" {
			if p.Journal.Path != "" {
				tx.State = TxCommitted
				_ = p.Journal.Write(tx)
			}
			return ApplyResult{Config: cfg, Warnings: warnings,
				Generation: ack.Generation, ReloadMode: "control"}, nil
		}
		if err == nil {
			// iobus TỪ CHỐI: cấu hình mới không thực thi được. Quay về bản cũ —
			// để nguyên file mới trên đĩa nghĩa là lần khởi động sau iobus sẽ
			// nạp đúng thứ nó vừa từ chối.
			return failTx(TxRolledBack, ack.Reason,
				fmt.Errorf("%w: iobus từ chối — %s", ErrApply, ack.Reason))
		}
		if !errors.Is(err, ErrControlUnavailable) {
			return failTx(TxUnreachable, err.Error(), fmt.Errorf("%w: %v", ErrApply, err))
		}
		warnings = append(warnings,
			"iobus chưa mở kênh điều khiển fieldbus; đã dùng phương án restart service (có gián đoạn I/O)")
	}

	// Dự phòng: restart service. Chỉ tới đây khi iobus chưa có kênh điều khiển.
	if p.Reload == nil {
		return failTx(TxRolledBack, "không có đường nạp lại cấu hình",
			fmt.Errorf("%w: không có kênh điều khiển và không có Reload", ErrApply))
	}
	applied, reloadWarnings := p.Reload()
	warnings = append(warnings, reloadWarnings...)
	if !applied {
		// Không gọi `failTx` được ở đây vì journal phải ghi SAU lần restart thứ
		// hai: trạng thái `ROLLED_BACK` chỉ đúng khi service đã chạy lại bằng
		// cấu hình cũ. Phần bọc lỗi thì dùng chung, để hai đường quay về không
		// nói hai thứ khác nhau về cùng một sự cố.
		reason, cause := withRollback(strings.Join(reloadWarnings, "; "),
			fmt.Errorf("%w: %s", ErrApply, strings.Join(reloadWarnings, "; ")), restore())
		_, _ = p.Reload()
		if p.Journal.Path != "" {
			tx.State = TxRolledBack
			tx.Reason = reason
			_ = p.Journal.Write(tx)
		}
		return ApplyResult{}, cause
	}
	if p.Journal.Path != "" {
		tx.State = TxCommitted
		_ = p.Journal.Write(tx)
	}
	return ApplyResult{Config: cfg, Warnings: warnings, ReloadMode: "service_restart"}, nil
}

// buildFieldbusBlocks sinh các khối mà iobus đọc (`buses`, `rs485`, `slaves`)
// từ nguồn chân lý (`Buses`/`Devices`).
func buildFieldbusBlocks(cfg Config, configDir string) Config {
	cfg.Slaves = nil
	busByID := map[string]Bus{}
	for _, bus := range cfg.Buses {
		busByID[bus.BusID] = bus
	}

	// `rs485` giữ lại cho iobus bản cũ chỉ hiểu một bus: điền bus đầu tiên
	// đang bật. Bỏ hẳn khối này sẽ làm một binary chưa nâng cấp không mở được
	// cổng nào và im lặng không poll gì.
	cfg.RS485 = nil
	for _, bus := range cfg.Buses {
		if !bus.Enabled {
			continue
		}
		cfg.RS485 = map[string]any{
			"device": bus.Port, "baud": bus.Baud, "parity": bus.Parity, "stop": bus.StopBit,
			"offline_probe_ms": bus.OfflineProbeMs,
		}
		break
	}

	for _, device := range cfg.Devices {
		if !device.Enabled {
			continue
		}
		busID := deviceBusID(device)
		bus, ok := busByID[busID]
		if !ok {
			continue
		}
		slave := map[string]any{
			"addr":       device.SlaveID,
			"bus_id":     bus.NumericID(),
			"profile":    filepath.Join(configDir, "profiles", device.DeviceID+".json"),
			"name":       device.DeviceID,
			"poll_ms":    device.PollMS,
			"timeout_ms": device.TimeoutMS,
			"retry":      device.Retry,
			// F-BE-19: iobus đọc được trường này từ lâu nhưng BE chưa bao giờ
			// ghi, nên nó luôn ở mặc định 2 và không có đường cấu hình nào.
			"offline_after_errors": device.OfflineAfterErrors,
		}
		cfg.Slaves = append(cfg.Slaves, slave)
	}
	return cfg
}

// commandNumber đổi giá trị lệnh đã lưu (bool/số/chuỗi) sang số mà iobus hiểu.
// Không đổi được thì trả false: thiếu `safe_value` là "không có chính sách an
// toàn", còn bịa 0 là ra lệnh tắt thiết bị mà không ai khai.
func commandNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "on":
			return 1, true
		case "false", "off":
			return 0, true
		}
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
	default:
		return 0, false
	}
}

func BuildProfile(device Device, points []Point) ([]byte, error) {
	rows := make([]map[string]any, 0)
	for _, point := range points {
		if !point.Enabled || point.DeviceID != device.DeviceID {
			continue
		}
		/* ISS-PIO-09: dùng chung bảng với hiển thị (`registerdisplay.go`) để
		 * FC trên màn hình không bao giờ lệch FC trên dây. */
		fc, _ := ReadFunctionCode(point.RegisterType)
		count := 1
		if point.DataType == "int32" || point.DataType == "uint32" || point.DataType == "float32" {
			count = 2
		}
		order := "AB"
		if count == 2 {
			switch {
			case point.ByteOrder == "little" && point.WordOrder == "high_low":
				order = "BADC"
			case point.ByteOrder == "big" && point.WordOrder == "low_high":
				order = "CDAB"
			case point.ByteOrder == "little" && point.WordOrder == "low_high":
				order = "DCBA"
			default:
				order = "ABCD"
			}
		} else if point.ByteOrder == "little" {
			order = "BA"
		}
		row := map[string]any{"name": point.PointID, "fc": fc, "addr": point.Address,
			"count": count, "type": point.DataType, "byte_order": order,
			"scale": point.Scale, "offset": point.Offset,
			"writable": point.ReadWrite == "read_write"}
		/* `ISS-PIO-22` — chỉ ghi khi KHÁC mặc định, để `fieldbus.conf` của tủ
		 * chưa dùng tính năng này giữ nguyên hình dạng cũ (và diff cấu hình
		 * không nở ra vì một trường ai cũng để mặc định). */
		if group := NormalizePollGroup(point.PollGroup); group != PollGroupNormal {
			row["poll_group"] = group
		}
		if point.StaleAfterMS > 0 {
			row["stale_after_ms"] = point.StaleAfterMS
		}
		/* `ISS-PIO-23` — cùng lý do: chỉ ghi khi khác mặc định. */
		if point.VerifyAfterWrite {
			row["verify_after_write"] = true
		}
		if point.ReadbackTolerance > 0 {
			row["readback_tolerance"] = point.ReadbackTolerance
		}
		if point.BitIndex != nil {
			row["bit_index"] = *point.BitIndex
		}
		if point.MinValue != nil {
			row["min_value"] = *point.MinValue
		}
		if point.MaxValue != nil {
			row["max_value"] = *point.MaxValue
		}
		/* EV-PROG-FBD-ST-MB-20260925 F06 — chủ sở hữu chốt 2026-09-26: Program
		 * đang ghi điểm này bị Disable/Stop (hoặc lệnh cũ quá hold TTL) thì
		 * thiết bị về `safe_value`. iobus là nơi phát lệnh đó, nên giá trị phải
		 * có trong profile; trước bản này nó chỉ nằm trong cấu hình của web. */
		if safe, ok := commandNumber(point.SafeValue); ok && point.ReadWrite == "read_write" {
			row["safe_value"] = safe
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool { return fmt.Sprint(rows[i]["name"]) < fmt.Sprint(rows[j]["name"]) })
	profile := map[string]any{"profile_id": device.DeviceID, "vendor": "user",
		"description": device.DisplayName, "default_baud": device.Baud, "points": rows}
	/* U-07 — chỉ ghi khi BẬT (> 1), cùng lý do như các trường tuỳ chọn của điểm:
	 * thiết bị chưa bật giữ nguyên profile cũ từng byte, nên nâng cấp web không
	 * làm iobus đổi khung trên dây của tủ nào. */
	if device.CoilWriteBatchMax > 1 {
		profile["max_coils_per_write"] = device.CoilWriteBatchMax
	}
	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}
