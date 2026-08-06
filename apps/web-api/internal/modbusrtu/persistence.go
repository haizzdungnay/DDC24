package modbusrtu

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var ErrApply = errors.New("không thể áp dụng cấu hình Modbus RTU; cấu hình cũ đã được phục hồi")

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
	restore := func() {
		for i := len(snapshots) - 1; i >= 0; i-- {
			if snapshots[i].exists {
				_ = p.WriteFile(snapshots[i].path, snapshots[i].data, 0o644)
			} else {
				_ = os.Remove(snapshots[i].path)
			}
		}
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
	failTx := func(state, reason string, cause error) (ApplyResult, error) {
		restore()
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
	if previous.Revision > 0 {
		if lkg, err := json.MarshalIndent(previous, "", "  "); err == nil {
			_ = p.WriteFile(filepath.Join(p.ConfigDir, "fieldbus.lkg.json"), append(lkg, '\n'), 0o644)
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
		restore()
		_, _ = p.Reload()
		if p.Journal.Path != "" {
			tx.State = TxRolledBack
			tx.Reason = strings.Join(reloadWarnings, "; ")
			_ = p.Journal.Write(tx)
		}
		return ApplyResult{}, fmt.Errorf("%w: %s", ErrApply, strings.Join(reloadWarnings, "; "))
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

func BuildProfile(device Device, points []Point) ([]byte, error) {
	rows := make([]map[string]any, 0)
	for _, point := range points {
		if !point.Enabled || point.DeviceID != device.DeviceID {
			continue
		}
		fc := map[string]int{"coil": 1, "discrete_input": 2, "holding_register": 3, "input_register": 4}[point.RegisterType]
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
		if point.BitIndex != nil {
			row["bit_index"] = *point.BitIndex
		}
		if point.MinValue != nil {
			row["min_value"] = *point.MinValue
		}
		if point.MaxValue != nil {
			row["max_value"] = *point.MaxValue
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool { return fmt.Sprint(rows[i]["name"]) < fmt.Sprint(rows[j]["name"]) })
	profile := map[string]any{"profile_id": device.DeviceID, "vendor": "user",
		"description": device.DisplayName, "default_baud": device.Baud, "points": rows}
	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}
