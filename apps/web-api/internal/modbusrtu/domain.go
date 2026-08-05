package modbusrtu

import (
	"fmt"
	"strings"

	"mkddc-web/internal/points"
)

type Config struct {
	RS485          map[string]any   `json:"rs485"`
	PollDefaultMs  int              `json:"poll_default_ms"`
	OfflineProbeMs int              `json:"offline_probe_ms,omitempty"`
	Slaves         []map[string]any `json:"slaves"`
	TCPSlaves      []map[string]any `json:"tcp_slaves,omitempty"`
	Revision       uint64           `json:"revision,omitempty"`
	Checksum       string           `json:"checksum,omitempty"`
	Devices        []Device         `json:"devices,omitempty"`
	Points         []Point          `json:"points,omitempty"`
}

type Device struct {
	DeviceID           string `json:"device_id"`
	DisplayName        string `json:"display_name"`
	Enabled            bool   `json:"enabled"`
	RS485Port          string `json:"rs485_port"`
	Baud               int    `json:"baud"`
	Parity             string `json:"parity"`
	StopBit            int    `json:"stop_bit"`
	SlaveID            int    `json:"slave_id"`
	PollMS             int    `json:"poll_ms"`
	TimeoutMS          int    `json:"timeout_ms"`
	Retry              int    `json:"retry"`
	OfflineAfterErrors int    `json:"offline_after_errors,omitempty"`
}

type Point struct {
	PointID      string  `json:"point_id"`
	DeviceID     string  `json:"device_id"`
	TagName      string  `json:"tag_name"`
	DisplayName  string  `json:"display_name"`
	RegisterType string  `json:"register_type"`
	Address      int     `json:"address"`
	DataType     string  `json:"data_type"`
	ByteOrder    string  `json:"byte_order"`
	WordOrder    string  `json:"word_order"`
	Scale        float64 `json:"scale"`
	Offset       float64 `json:"offset"`
	Unit         string  `json:"unit"`
	ReadWrite    string  `json:"read_write"`
	DefaultValue any     `json:"default_value"`
	SafeValue    any     `json:"safe_value"`
	Enabled      bool    `json:"enabled"`
}

type Diagnostics struct {
	DeviceID          string `json:"device_id"`
	SlaveID           int    `json:"slave_id"`
	Online            bool   `json:"online"`
	TotalPolls        uint32 `json:"total_polls"`
	TotalErrors       uint32 `json:"total_errors"`
	TimeoutErrors     uint32 `json:"timeout_errors"`
	CRCErrors         uint32 `json:"crc_errors"`
	RetryAttempts     uint32 `json:"retry_attempts"`
	ConsecutiveErrors uint8  `json:"consecutive_errors"`
	LastSeenMS        uint64 `json:"last_seen_ms"`
}

type ValidationError struct {
	Path    string
	Message string
}

func NormalizeDevice(device Device) Device {
	device.DeviceID = strings.TrimSpace(device.DeviceID)
	device.DisplayName = strings.TrimSpace(device.DisplayName)
	device.RS485Port = strings.TrimSpace(device.RS485Port)
	device.Parity = strings.ToUpper(strings.TrimSpace(device.Parity))
	if device.Baud == 0 {
		device.Baud = 19200
	}
	if device.StopBit == 0 {
		device.StopBit = 1
	}
	if device.PollMS == 0 {
		device.PollMS = 1000
	}
	if device.TimeoutMS == 0 {
		device.TimeoutMS = 300
	}
	if device.OfflineAfterErrors == 0 {
		device.OfflineAfterErrors = 2
	}
	// D-05: KHÔNG normalize 0 thành 2. Với ngữ nghĩa mới, retry=0 là lựa chọn
	// hợp lệ và có ý nghĩa: "không phát lại, báo lỗi ngay" — phù hợp cho thiết bị
	// nhạy với lệnh lặp. Việc âm thầm đổi 0 thành 2 làm người dùng không thể tắt
	// retry.
	return device
}

func NormalizePoint(point Point) Point {
	point.PointID = strings.TrimSpace(point.PointID)
	point.DeviceID = strings.TrimSpace(point.DeviceID)
	point.TagName = strings.TrimSpace(point.TagName)
	point.DisplayName = strings.TrimSpace(point.DisplayName)
	point.RegisterType = strings.ToLower(strings.TrimSpace(point.RegisterType))
	point.DataType = strings.ToLower(strings.TrimSpace(point.DataType))
	point.ByteOrder = strings.ToLower(strings.TrimSpace(point.ByteOrder))
	point.WordOrder = strings.ToLower(strings.TrimSpace(point.WordOrder))
	point.ReadWrite = strings.ToLower(strings.TrimSpace(point.ReadWrite))
	if point.ByteOrder == "" {
		point.ByteOrder = "big"
	}
	if point.WordOrder == "" {
		point.WordOrder = "high_low"
	}
	if point.ReadWrite == "" {
		point.ReadWrite = "read"
	}
	return point
}

func ValidStableID(value string) bool {
	if len(value) < 1 || len(value) > 23 || !isLetter(value[0]) {
		return false
	}
	for i := range value {
		ch := value[i]
		if !(isLetter(ch) || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func Validate(cfg Config, externalTagOwners map[string]string) []ValidationError {
	var errs []ValidationError
	add := func(path, message string) { errs = append(errs, ValidationError{Path: path, Message: message}) }
	if cfg.OfflineProbeMs < 0 || (cfg.OfflineProbeMs > 0 && (cfg.OfflineProbeMs < 1000 || cfg.OfflineProbeMs > 60000)) {
		add("offline_probe_ms", "phải trong 1000..60000 ms")
	}
	devices := make(map[string]Device, len(cfg.Devices))
	slaves := map[int]string{}
	var bus *Device
	for i, raw := range cfg.Devices {
		device := NormalizeDevice(raw)
		base := fmt.Sprintf("devices[%d]", i)
		if !ValidStableID(device.DeviceID) {
			add(base+".device_id", "phải dài 1..23 ký tự ASCII và bắt đầu bằng chữ")
		}
		key := strings.ToLower(device.DeviceID)
		if _, exists := devices[key]; exists {
			add(base+".device_id", "phải unique")
		}
		devices[key] = device
		if _, _, err := points.NormalizeName(device.DisplayName); err != nil {
			add(base+".display_name", err.Error())
		}
		if device.RS485Port == "" || len(device.RS485Port) > 128 {
			add(base+".rs485_port", "bắt buộc và dài tối đa 128 byte")
		}
		if device.Baud < 1200 || device.Baud > 115200 {
			add(base+".baud", "phải trong 1200..115200")
		}
		if device.Parity != "N" && device.Parity != "E" && device.Parity != "O" {
			add(base+".parity", "phải là N, E hoặc O")
		}
		if device.StopBit != 1 && device.StopBit != 2 {
			add(base+".stop_bit", "phải là 1 hoặc 2")
		}
		if device.SlaveID < 1 || device.SlaveID > 247 {
			add(base+".slave_id", "phải trong 1..247")
		}
		if previous, exists := slaves[device.SlaveID]; exists {
			add(base+".slave_id", "trùng với "+previous)
		} else {
			slaves[device.SlaveID] = device.DeviceID
		}
		if device.PollMS < 10 || device.PollMS > 60000 {
			add(base+".poll_ms", "phải trong 10..60000 ms")
		}
		if device.TimeoutMS < 20 || device.TimeoutMS > 10000 {
			add(base+".timeout_ms", "phải trong 20..10000 ms")
		}
		// D-05 (Đ-05, PM/CTO 2026-08-04): `retry` là SỐ LẦN PHÁT LẠI một giao dịch
		// Modbus bị lỗi, không phải ngưỡng chuyển OFFLINE. Trước đây trường này
		// nhận 1..10 và mang nghĩa ngưỡng offline, trong khi runtime KHÔNG hề phát
		// lại lần nào — người dùng đặt retry=3 tin rằng hệ thống chịu được nhiễu
		// thoáng qua nhưng thực tế mọi lỗi đơn lẻ đều làm điểm rơi STALE.
		// Giới hạn 3: 3 lần phát lại × timeout 300 ms đã là ~1,2 s chiếm dây cho
		// một block trên bus dùng chung.
		if device.Retry < 0 || device.Retry > 3 {
			add(base+".retry", "phải trong 0..3 (số lần phát lại một giao dịch)")
		}
		if device.Enabled {
			if bus == nil {
				copy := device
				bus = &copy
			} else if bus.RS485Port != device.RS485Port || bus.Baud != device.Baud || bus.Parity != device.Parity || bus.StopBit != device.StopBit {
				add(base, "mọi thiết bị enabled trên cùng master phải dùng chung RS485 port/baud/parity/stop bit")
			}
		}
	}
	tagOwners := make(map[string]string, len(externalTagOwners)+len(cfg.Points))
	for key, owner := range externalTagOwners {
		tagOwners[key] = owner
	}
	pointIDs := map[string]string{}
	for i, raw := range cfg.Points {
		point := NormalizePoint(raw)
		base := fmt.Sprintf("points[%d]", i)
		if !ValidStableID(point.PointID) {
			add(base+".point_id", "phải dài 1..23 ký tự ASCII, bắt đầu bằng chữ và không đổi khi rename")
		}
		idKey := strings.ToLower(point.PointID)
		if owner, exists := pointIDs[idKey]; exists {
			add(base+".point_id", "trùng với "+owner)
		} else {
			pointIDs[idKey] = point.PointID
		}
		if _, exists := devices[strings.ToLower(point.DeviceID)]; !exists {
			add(base+".device_id", "không tham chiếu thiết bị tồn tại")
		}
		if _, key, err := points.NormalizeTag(point.TagName); err != nil {
			add(base+".tag_name", err.Error())
		} else if owner, exists := tagOwners[key]; exists {
			add(base+".tag_name", "phải unique; đang thuộc "+owner)
		} else {
			tagOwners[key] = point.PointID
		}
		if _, _, err := points.NormalizeName(point.DisplayName); err != nil {
			add(base+".display_name", err.Error())
		}
		switch point.RegisterType {
		case "coil", "discrete_input", "input_register", "holding_register":
		default:
			add(base+".register_type", "không được hỗ trợ")
		}
		if point.Address < 0 || point.Address > 65535 {
			add(base+".address", "phải trong 0..65535")
		}
		switch point.DataType {
		case "bool", "int16", "uint16", "int32", "uint32", "float32":
		default:
			add(base+".data_type", "không được hỗ trợ")
		}
		if (point.RegisterType == "coil" || point.RegisterType == "discrete_input") && point.DataType != "bool" {
			add(base+".data_type", "Coil/Discrete Input phải dùng bool")
		}
		if point.ByteOrder != "big" && point.ByteOrder != "little" {
			add(base+".byte_order", "phải là big hoặc little")
		}
		if point.WordOrder != "high_low" && point.WordOrder != "low_high" {
			add(base+".word_order", "phải là high_low hoặc low_high")
		}
		if point.Scale == 0 {
			add(base+".scale", "không được bằng 0")
		}
		if point.ReadWrite != "read" && point.ReadWrite != "read_write" {
			add(base+".read_write", "phải là read hoặc read_write")
		}
		if point.ReadWrite == "read_write" && point.RegisterType != "coil" && point.RegisterType != "holding_register" {
			add(base+".read_write", "chỉ Coil/Holding Register được ghi")
		}
	}
	if len(cfg.Points) > 256 {
		add("points", "vượt KX_N_EXT=256")
	}
	return errs
}

func isLetter(ch byte) bool { return ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' }
