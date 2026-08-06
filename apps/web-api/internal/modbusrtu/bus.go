package modbusrtu

import "strings"

// Bus là MỘT SỢI DÂY RS-485 (MBR-B202 / OD-MBRTU-002).
//
// Tham số serial thuộc về dây chứ không thuộc thiết bị. Bản trước lưu
// baud/parity/stop ở Device rồi ép "mọi device enabled phải dùng chung giá
// trị" bằng một luật validate — tức là mô hình dữ liệu nói một đằng và ràng
// buộc nói một nẻo. Người dùng vẫn nhập được 4 giá trị baud khác nhau, lưu
// xong mới bị từ chối, và không có chỗ nào trên UI giải thích vì sao.
//
// Với Bus là entity, câu hỏi "bus này chạy baud bao nhiêu" có đúng một câu trả
// lời, và Device chỉ còn kế thừa read-only.
type Bus struct {
	BusID          string `json:"bus_id"`
	DisplayName    string `json:"display_name"`
	Port           string `json:"port"`
	Baud           int    `json:"baud"`
	Parity         string `json:"parity"`
	StopBit        int    `json:"stop_bit"`
	DataBits       int    `json:"data_bits"`
	OfflineProbeMs int    `json:"offline_probe_ms"`
	Enabled        bool   `json:"enabled"`
}

// NumericID trả về id 1-based mà FW-SOM dùng trong `buses[].id` và
// `slaves[].bus_id`. Quy ước: "rs485-1" → 1. Không parse được ⇒ 0, và validator
// từ chối — im lặng gán 1 sẽ dồn mọi thiết bị lên một dây.
func (b Bus) NumericID() int {
	trimmed := strings.TrimSpace(b.BusID)
	if trimmed == "" {
		return 0
	}
	digits := trimmed[strings.LastIndexByte(trimmed, '-')+1:]
	n := 0
	for i := 0; i < len(digits); i++ {
		if digits[i] < '0' || digits[i] > '9' {
			return 0
		}
		n = n*10 + int(digits[i]-'0')
	}
	if n < 1 || n > 255 {
		return 0
	}
	return n
}

func NormalizeBus(bus Bus) Bus {
	bus.BusID = strings.ToLower(strings.TrimSpace(bus.BusID))
	bus.DisplayName = strings.TrimSpace(bus.DisplayName)
	bus.Port = strings.TrimSpace(bus.Port)
	bus.Parity = strings.ToUpper(strings.TrimSpace(bus.Parity))
	if bus.Baud == 0 {
		bus.Baud = 19200
	}
	if bus.Parity == "" {
		bus.Parity = "N"
	}
	if bus.StopBit == 0 {
		bus.StopBit = 1
	}
	if bus.DataBits == 0 {
		bus.DataBits = 8
	}
	if bus.OfflineProbeMs == 0 {
		bus.OfflineProbeMs = 5000
	}
	if bus.DisplayName == "" {
		bus.DisplayName = strings.ToUpper(bus.BusID)
	}
	return bus
}

// DefaultBuses là cấu hình hai bus vật lý của Foxlinx SOM-DDC-24
// (OD-MBRTU-001 CLOSED 2026-08-05). Dùng khi cấu hình cũ chưa có `buses[]`.
func DefaultBuses() []Bus {
	return []Bus{
		{BusID: "rs485-1", DisplayName: "RS485-1", Port: "/dev/rs485-1", Baud: 19200,
			Parity: "N", StopBit: 1, DataBits: 8, OfflineProbeMs: 5000, Enabled: true},
		{BusID: "rs485-2", DisplayName: "RS485-2", Port: "/dev/rs485-2", Baud: 19200,
			Parity: "N", StopBit: 1, DataBits: 8, OfflineProbeMs: 5000, Enabled: true},
	}
}

// MigrateBuses dựng `buses[]` cho cấu hình cũ chỉ có tham số serial ở Device.
//
// Chiến lược theo DATA_MODEL §7.3: nhóm device theo `rs485_port`, lấy tham số
// serial của device enabled ĐẦU TIÊN trên mỗi cổng làm tham số của Bus, và ghi
// warning cho mọi device lệch. Không im lặng ghi đè: người dùng phải biết giá
// trị nào đã được chọn và giá trị nào bị bỏ.
func MigrateBuses(cfg Config) ([]Bus, []string) {
	if len(cfg.Buses) > 0 {
		return cfg.Buses, nil
	}
	var warnings []string
	byPort := map[string]*Bus{}
	var order []string
	for _, device := range cfg.Devices {
		port := strings.TrimSpace(device.RS485Port)
		if port == "" {
			continue
		}
		existing, seen := byPort[port]
		if !seen {
			bus := NormalizeBus(Bus{
				BusID:          busIDForPort(port),
				Port:           port,
				Baud:           device.Baud,
				Parity:         device.Parity,
				StopBit:        device.StopBit,
				OfflineProbeMs: cfg.OfflineProbeMs,
				Enabled:        true,
			})
			byPort[port] = &bus
			order = append(order, port)
			continue
		}
		if device.Enabled && (existing.Baud != device.Baud || existing.Parity != device.Parity ||
			existing.StopBit != device.StopBit) {
			warnings = append(warnings,
				"thiết bị "+device.DeviceID+" khai báo tham số serial khác bus "+existing.BusID+
					"; migration giữ tham số của bus và bỏ giá trị riêng của thiết bị")
		}
	}
	if len(order) == 0 {
		return DefaultBuses(), warnings
	}
	out := make([]Bus, 0, len(order))
	for _, port := range order {
		out = append(out, *byPort[port])
	}
	return out, warnings
}

// busIDForPort suy ra bus_id từ đường dẫn cổng đã chuẩn hoá.
func busIDForPort(port string) string {
	switch port {
	case "/dev/rs485-1", "/dev/ttyS5":
		return "rs485-1"
	case "/dev/rs485-2", "/dev/ttyS1":
		return "rs485-2"
	}
	return "rs485-1"
}
