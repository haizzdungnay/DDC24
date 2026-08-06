package modbusrtu

import (
	"encoding/json"
	"strconv"
	"strings"
)

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
	BusID          string   `json:"bus_id"`
	DisplayName    string   `json:"display_name"`
	Port           string   `json:"port"`
	Baud           int      `json:"baud"`
	Parity         string   `json:"parity"`
	StopBit        int      `json:"stop_bits"`
	DataBits       int      `json:"data_bits"`
	OfflineProbeMs int      `json:"offline_probe_ms"`
	Enabled        FlexBool `json:"enabled"`
	// G-D: cơ chế điều hướng half-duplex. BE không dựng giao diện cho ba trường
	// này, nhưng PHẢI mang chúng qua: `fieldbus.conf` được unmarshal vào struct
	// rồi marshal lại, nên trường nào không có mặt ở đây sẽ BIẾN MẤT khỏi file
	// sau lần "Áp dụng" đầu tiên. Trước bản này, mọi thao tác cấu hình từ web
	// đều lặng lẽ xoá `direction` của bus, đưa cổng về mặc định của driver.
	Direction        string `json:"direction,omitempty"`
	RtsDelayBeforeUs int    `json:"rts_delay_before_us,omitempty"`
	RtsDelayAfterUs  int    `json:"rts_delay_after_us,omitempty"`
}

// UnmarshalJSON đọc được CẢ HAI bộ tên khoá của `buses[]`.
//
// `fieldbus.conf` có hai bên ghi: BE dùng `bus_id`/`port`/`display_name`/
// `stop_bit`, còn iobus (và người sửa file bằng tay trên bo) dùng bộ rút gọn
// `id`/`device`/`name`/`stop`. Bản trước BE chỉ hiểu bộ của chính nó, nên một
// file viết theo bộ kia được nạp THÀNH CÔNG nhưng ra toàn trường rỗng —
// `bus_id` là "" — và validator chặn ở bước sau với thông báo:
//
//	buses[0].bus_id: bắt buộc
//
// Người dùng thấy điều đó khi bấm "Thêm thiết bị mới": thao tác bị từ chối vì
// một trường thuộc về BUS mà giao diện thiết bị không hề đụng tới, và không có
// cách nào sửa từ giao diện. Nạp được nhưng rỗng còn khó lần ra hơn là nạp lỗi.
//
// Nới lỏng ở đầu đọc, giữ nghiêm ở đầu ghi: `MarshalJSON` mặc định vẫn chỉ xuất
// bộ tên chuẩn, nên file ghi ra không bao giờ lẫn hai bộ.
func (b *Bus) UnmarshalJSON(data []byte) error {
	// alias cắt vòng đệ quy: nếu không, json gọi lại chính hàm này.
	type alias Bus
	var canonical alias
	if err := json.Unmarshal(data, &canonical); err != nil {
		return err
	}
	*b = Bus(canonical)

	var legacy struct {
		ID *int `json:"id"`
		// `stop` là tên của iobus; `stop_bit` là tên BE dùng tới 2026-08-06,
		// trước khi CONFIG_SCHEMA §5b chốt `stop_bits` cho cả hai phía. File
		// trên các bo đã triển khai còn dùng cả hai, và một bản nâng cấp làm
		// cổng im lặng quay về 1 stop bit thì tệ hơn lỗi nó đi sửa.
		Stop    *int    `json:"stop"`
		StopBit *int    `json:"stop_bit"`
		Device  *string `json:"device"`
		Name    *string `json:"name"`
	}
	if err := json.Unmarshal(data, &legacy); err != nil {
		// Bộ rút gọn sai kiểu không được làm hỏng cả bus: bộ chuẩn đã đọc xong.
		return nil
	}
	if b.BusID == "" && legacy.ID != nil && *legacy.ID >= 1 && *legacy.ID <= 255 {
		b.BusID = "rs485-" + strconv.Itoa(*legacy.ID)
	}
	if b.Port == "" && legacy.Device != nil {
		b.Port = *legacy.Device
	}
	if b.DisplayName == "" && legacy.Name != nil {
		b.DisplayName = *legacy.Name
	}
	if b.StopBit == 0 && legacy.StopBit != nil {
		b.StopBit = *legacy.StopBit
	}
	if b.StopBit == 0 && legacy.Stop != nil {
		b.StopBit = *legacy.Stop
	}
	return nil
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
	bus.Direction = strings.ToLower(strings.TrimSpace(bus.Direction))
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
		// Chuẩn hoá cả nhánh "đã có buses[]". Bỏ qua bước này thì một file viết
		// theo bộ tên rút gọn của iobus đi thẳng ra API với `data_bits: 0` và
		// `stop_bits: 0` — giao diện hiện "19200N00", một khung truyền không tồn
		// tại. Mọi đường đọc buses[] đều đi qua đây, nên đây là chỗ duy nhất cần
		// điền mặc định.
		out := make([]Bus, 0, len(cfg.Buses))
		for _, bus := range cfg.Buses {
			out = append(out, NormalizeBus(bus))
		}
		return out, nil
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

// ApplyBusInheritance ép tham số serial của Device bằng tham số của Bus nó thuộc về.
//
// `OD-MBRTU-002` (CLOSED): serial format thuộc **dây**, Device chỉ kế thừa. Bản
// trước phát biểu điều đó trong tài liệu và trong validator, nhưng KHÔNG có chỗ
// nào thực sự đồng bộ hai bên — `devices[].baud` cứ giữ nguyên giá trị người
// dùng gõ lúc tạo. Hệ quả: đổi baud của cổng thì bảng Thiết bị vẫn hiện baud cũ,
// và người vận hành đọc được một con số không đúng với thứ đang chạy trên dây.
//
// Ép ở đây thay vì từ chối ở validator là có chủ ý: người dùng không còn nhập
// các trường này nữa (giao diện Thiết bị hiển thị read-only), nên một giá trị
// lệch là dữ liệu cũ, không phải ý định. Từ chối sẽ chặn họ ở một trường họ
// không sửa được.
func ApplyBusInheritance(cfg *Config) {
	if cfg == nil || len(cfg.Buses) == 0 {
		return
	}
	byID := make(map[string]Bus, len(cfg.Buses))
	for _, bus := range cfg.Buses {
		byID[bus.BusID] = bus
	}
	for i := range cfg.Devices {
		busID := cfg.Devices[i].BusID
		if busID == "" {
			busID = busIDForPort(cfg.Devices[i].RS485Port)
		}
		bus, ok := byID[busID]
		if !ok {
			continue // validator sẽ báo tham chiếu bus sai; không bịa giá trị ở đây
		}
		cfg.Devices[i].BusID = bus.BusID
		cfg.Devices[i].RS485Port = bus.Port
		cfg.Devices[i].Baud = bus.Baud
		cfg.Devices[i].Parity = bus.Parity
		cfg.Devices[i].StopBit = bus.StopBit
	}
}

// PortForBusID trả đường dẫn thiết bị chuẩn của một bus.
//
// Ánh xạ `bus_id` ↔ cổng là **sự thật phần cứng**, không phải lựa chọn của người
// dùng: cho sửa `port` tự do nghĩa là cho phép trỏ hai bus vào cùng một device
// node, hoặc trỏ `rs485-1` sang cổng của `rs485-2`. Cả hai đều tạo ra cấu hình
// nhìn hợp lệ mà chạy sai dây.
func PortForBusID(busID string) string {
	switch strings.ToLower(strings.TrimSpace(busID)) {
	case "rs485-1":
		return "/dev/rs485-1"
	case "rs485-2":
		return "/dev/rs485-2"
	}
	return ""
}

// BusIDForPort suy ra bus_id từ đường dẫn cổng đã chuẩn hoá.
func BusIDForPort(port string) string { return busIDForPort(port) }

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
