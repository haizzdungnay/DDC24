package modbusrtu

import (
	"encoding/json"
	"strings"
)

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
	DeviceID           string   `json:"device_id"`
	DisplayName        string   `json:"display_name"`
	Enabled            FlexBool `json:"enabled"`
	RS485Port          string   `json:"rs485_port"`
	Baud               int      `json:"baud"`
	Parity             string   `json:"parity"`
	StopBit            int      `json:"stop_bits"`
	SlaveID            int      `json:"slave_id"`
	PollMS             int      `json:"poll_ms"`
	TimeoutMS          int      `json:"timeout_ms"`
	Retry              int      `json:"retry"`
	OfflineAfterErrors int      `json:"offline_after_errors,omitempty"`
	/* `ISS-PIO-22` — chu kỳ của nhóm `fast`/`slow`. `poll_ms` giữ nguyên nghĩa
	 * là chu kỳ nhóm `normal`, nên cấu hình cũ đọc đúng như trước.
	 * 0 = suy từ `poll_ms` (fast = poll_ms, slow = poll_ms × 10). */
	PollFastMS int `json:"poll_fast_ms,omitempty"`
	PollSlowMS int `json:"poll_slow_ms,omitempty"`
	// U-07 (REC-DDC-FIELD-USE-20260927) — số coil tối đa iobus được gom vào
	// MỘT lệnh FC15 cho thiết bị này. 0 hoặc 1 = TẮT (mặc định): mỗi lệnh ghi
	// coil là một giao dịch riêng, đúng hành vi trước bản này. 2..16 = gom các
	// coil LIỀN KỀ đổi cùng lúc thành một khung, ví dụ 8 relay của một module
	// CK-508 thành một giao dịch thay vì tám.
	//
	// Bật theo TỪNG thiết bị vì không phải slave Modbus nào cũng hỗ trợ FC15;
	// thiết bị không hỗ trợ sẽ từ chối mọi lệnh ghi đã gom (ILLEGAL FUNCTION).
	CoilWriteBatchMax int `json:"coil_write_batch_max,omitempty"`
	// MBR-B202 / OD-MBRTU-002 (CLOSED): Device thuộc về một Bus.
	// `rs485_port`/`baud`/`parity`/`stop_bits` vẫn có trong response để UI hiển
	// thị, nhưng là KẾ THỪA READ-ONLY từ Bus — giao diện Thiết bị không được cho
	// sửa chúng (DATA_MODEL §4).
	BusID string `json:"bus_id,omitempty"`
}

// UnmarshalJSON nhận `stop_bit` (tên BE dùng tới 2026-08-06) ngoài `stop_bits`.
//
// CONFIG_SCHEMA §5b chốt `stop_bits` cho cả hai phía, nhưng file trên các bo đã
// triển khai còn ghi `stop_bit`. Bỏ qua tên cũ thì trường về 0, `NormalizeDevice`
// điền mặc định 1, và một thiết bị cấu hình 2 stop bit lặng lẽ chạy sai khung
// truyền — sai kiểu không báo lỗi, chỉ hỏng dữ liệu trên dây.
func (d *Device) UnmarshalJSON(data []byte) error {
	type alias Device
	var canonical alias
	if err := json.Unmarshal(data, &canonical); err != nil {
		return err
	}
	*d = Device(canonical)
	if d.StopBit != 0 {
		return nil
	}
	var legacy struct {
		StopBit *int `json:"stop_bit"`
	}
	if err := json.Unmarshal(data, &legacy); err == nil && legacy.StopBit != nil {
		d.StopBit = *legacy.StopBit
	}
	return nil
}

type Point struct {
	PointID      string   `json:"point_id"`
	DeviceID     string   `json:"device_id"`
	TagName      string   `json:"tag_name"`
	DisplayName  string   `json:"display_name"`
	RegisterType string   `json:"register_type"`
	Address      int      `json:"address"`
	DataType     string   `json:"data_type"`
	ByteOrder    string   `json:"byte_order"`
	WordOrder    string   `json:"word_order"`
	Scale        float64  `json:"scale"`
	Offset       float64  `json:"offset"`
	Unit         string   `json:"unit"`
	ReadWrite    string   `json:"read_write"`
	DefaultValue any      `json:"default_value"`
	SafeValue    any      `json:"safe_value"`
	Enabled      FlexBool `json:"enabled"`
	// DATA_MODEL §5.2/§5.5 — tuỳ chọn, nil = không khai báo.
	// `min_value`/`max_value` là biên KỸ THUẬT của điểm: mẫu ngoài biên bị đánh
	// BAD/OUT_OF_RANGE thay vì publish một số vô lý với nhãn GOOD.
	MinValue *float64 `json:"min_value,omitempty"`
	MaxValue *float64 `json:"max_value,omitempty"`
	BitIndex *int     `json:"bit_index,omitempty"`
	/* `ISS-PIO-20` — hai trường TRÌNH BÀY, để điểm Modbus sửa được cùng bộ
	 * metadata như điểm LOCAL/VP qua `PUT /points/{id}/config`.
	 *
	 * Trước đây `overlayPointMetadata` đã chở `TagName`/`DisplayName`/`Unit` ra
	 * ngoài, nhưng `trend` và `equipment` thì KHÔNG có chỗ nào để chứa — đúng
	 * như chú thích cạnh `Note` đã nói: thiếu ở đây là sự thật về HỢP ĐỒNG, nên
	 * muốn có thì phải thêm trường vào chính hợp đồng, không phải vá đường chở.
	 *
	 * Core KHÔNG đọc hai trường này; chúng chỉ đi lên giao diện. `omitempty` nên
	 * `fieldbus.conf` của tủ chưa dùng chúng giữ nguyên hình dạng cũ. */
	TrendEnabled bool   `json:"trend_enabled,omitempty"`
	Equipment    string `json:"equipment,omitempty"`
	/* `ISS-PIO-21` — người dùng ĐANG NGHĨ theo quy ước địa chỉ nào (đề bài §23).
	 *
	 * `Address` LUÔN là offset protocol 0-based, bất kể trường này — đó là điều
	 * kiện đóng "lưu địa chỉ protocol chuẩn hoá, không suy mơ hồ mỗi lần đọc".
	 * Trường này chỉ ghi lại cách nhập, để lần mở sau màn hình nói lại đúng con
	 * số người dùng đã gõ từ datasheet.
	 *
	 * Thiếu nó thì mỗi lần mở lại là một lần tự dịch trong đầu, và mỗi lần dịch
	 * là một cơ hội sai một đơn vị — thứ không làm gì hỏng ồn ào, chỉ khiến
	 * điểm đọc sang thanh ghi bên cạnh với quality GOOD. */
	AddressConvention string `json:"address_convention,omitempty"`
	/* `ISS-PIO-22` — NHÓM POLL và ngưỡng stale theo ĐIỂM (đề bài §22).
	 *
	 * Trước bản vá `poll_ms`/`timeout_ms` chỉ có ở cấp Device, nên một điểm cấu
	 * hình (đọc một lần mỗi phút là đủ) bị poll cùng nhịp với tần số VFD
	 * (500 ms) và tiêu băng thông RS-485 vô ích.
	 *
	 * Rỗng = `normal`, tức chu kỳ `poll_ms` của Device — hành vi trước bản vá.
	 * `StaleAfterMS` = 0 nghĩa là SUY từ chu kỳ hiệu lực, không phải "tắt". */
	PollGroup    string `json:"poll_group,omitempty"`
	StaleAfterMS int    `json:"stale_after_ms,omitempty"`
	/* `ISS-PIO-23` — XÁC NHẬN SAU KHI GHI theo điểm (đề bài §26).
	 *
	 * Bật thì mọi lệnh ghi vào điểm này đều được đọc lại và ĐỐI CHIẾU, kể cả
	 * lệnh không tự yêu cầu (lịch trình, chương trình ST, safe-state). Đọc lại
	 * không khớp ⇒ kết quả là `unverified`, KHÔNG phải `applied`: nhiều VFD ACK
	 * lệnh rồi bỏ qua khi tham số bị khoá.
	 *
	 * Mặc định tắt: đọc lại tốn thêm một giao dịch trên dây chung, nên nó là
	 * lựa chọn cho thanh ghi actuator/config chứ không phải mặc định toàn hệ. */
	VerifyAfterWrite  bool    `json:"verify_after_write,omitempty"`
	ReadbackTolerance float64 `json:"readback_tolerance,omitempty"`
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

// MaxCoilWriteBatch — trần `coil_write_batch_max`, khớp `kMaxCoilsPerWrite`
// (`apps/iobus/adapters/modbus_rtu/coil_write_batch.hpp`). iobus kẹp giá trị
// lớn hơn về trần này; BE từ chối ngay để người dùng không tin nhầm.
const MaxCoilWriteBatch = 16

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
	// `ISS-PIO-20` — gom khoảng trắng như thẻ thiết bị của điểm LOCAL/VP:
	// `AHU-1 ` và `AHU-1` phải rơi vào cùng một nhóm trên Monitor.
	point.Equipment = strings.Join(strings.Fields(point.Equipment), " ")
	/* `ISS-PIO-21` — CHỈ hạ chữ và cắt khoảng trắng, KHÔNG ép về mặc định.
	 *
	 * Ép giá trị lạ thành `protocol` ở đây sẽ nuốt mất lỗi gõ nhầm: người dùng
	 * chọn `vendor`, gõ sai một ký tự, và nhận về một điểm lặng lẽ hiểu con số
	 * của họ theo quy ước khác — đúng lớp lỗi mà cả issue này sinh ra để dẹp.
	 * `validate.go` mới là nơi từ chối; rỗng ở đó là hợp lệ và nghĩa là
	 * `protocol`, đúng như mọi cấu hình đang chạy. */
	point.AddressConvention = strings.ToLower(strings.TrimSpace(point.AddressConvention))
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

// ReservedCorePointName báo `id` có trùng dạng tên điểm mà Core tự hiểu hay không
// (`web_ipc.cpp` `parse_point_name`: chữ cái loại điểm + số thứ tự, ví dụ `DO3`,
// `EXT5`) — cộng thêm `UI<n>` mà Web quy đổi trước khi gửi.
//
// `MBA-BE-02` (audit Modbus 2026-09-25): một Point Modbus tên `DO3` đi qua đường
// ghi chung sẽ được Core hiểu thành ngõ ra cục bộ DO3. Chặn ở validator để danh
// tính Modbus và danh tính điểm hệ thống không bao giờ chồng lên nhau.
func ReservedCorePointName(id string) bool {
	upper := strings.ToUpper(strings.TrimSpace(id))
	i := 0
	for i < len(upper) && upper[i] >= 'A' && upper[i] <= 'Z' {
		i++
	}
	if i == 0 || i == len(upper) {
		return false
	}
	for _, ch := range upper[i:] {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	switch upper[:i] {
	case "AI", "BI", "DI", "UI", "AO", "BO", "DO", "AV", "BV", "MSV", "EXT", "MB":
		return true
	}
	return false
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
