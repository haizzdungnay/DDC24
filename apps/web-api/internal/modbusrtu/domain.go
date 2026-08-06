package modbusrtu

import "strings"

// Config là nội dung fieldbus.conf.
//
// MBR-B206: `rs485`/`slaves`/`tcp_slaves` là các khối SINH RA cho iobus, giữ
// kiểu map vì chúng phản chiếu schema của FW. Nguồn chân lý cấu hình là
// `buses`/`devices`/`points` — các struct có kiểu chặt. Checksum tính trên
// canonical JSON của phần nguồn chân lý, KHÔNG tính trên map (thứ tự key của
// map Go không xác định nên checksum đổi giữa hai lần chạy dù cấu hình y hệt).
type Config struct {
	RS485          map[string]any   `json:"rs485"`
	Buses          []Bus            `json:"buses,omitempty"`
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
	// MBR-B202: Device thuộc về một Bus. `rs485_port`/`baud`/`parity`/`stop_bit`
	// vẫn có trong response để không vỡ UI cũ, nhưng là KẾ THỪA read-only từ Bus.
	BusID string `json:"bus_id,omitempty"`
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
	// DATA_MODEL §5.2/§5.5 — tuỳ chọn, nil = không khai báo.
	// `min_value`/`max_value` là biên KỸ THUẬT của điểm: mẫu ngoài biên bị đánh
	// BAD/OUT_OF_RANGE thay vì publish một số vô lý với nhãn GOOD.
	MinValue *float64 `json:"min_value,omitempty"`
	MaxValue *float64 `json:"max_value,omitempty"`
	BitIndex *int     `json:"bit_index,omitempty"`
}

// MBR-B110: counter là uint64 xuyên suốt. uint32 tràn sau ~2,7 năm ở nhịp poll
// thực tế, và khi tràn thì FE/historian tính delta ra số âm khổng lồ.
type Diagnostics struct {
	DeviceID          string `json:"device_id"`
	SlaveID           int    `json:"slave_id"`
	BusID             uint8  `json:"bus_id"`
	Online            bool   `json:"online"`
	TotalPolls        uint64 `json:"total_polls"`
	TotalErrors       uint64 `json:"total_errors"`
	TimeoutErrors     uint64 `json:"timeout_errors"`
	CRCErrors         uint64 `json:"crc_errors"`
	RetryAttempts     uint64 `json:"retry_attempts"`
	WriteFailed       uint64 `json:"write_failed"`
	WriteDropped      uint64 `json:"write_dropped"`
	ConsecutiveErrors uint8  `json:"consecutive_errors"`
	LastException     uint8  `json:"last_exception"`
	LastSeenMS        uint64 `json:"last_seen_ms"`
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

func isLetter(ch byte) bool { return ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' }
