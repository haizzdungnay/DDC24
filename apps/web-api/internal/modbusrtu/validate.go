package modbusrtu

import (
	"fmt"
	"sort"
	"strings"

	"mkddc-web/internal/points"
)

// Mã lỗi ỔN ĐỊNH (MBR-B201).
//
// Trước bản này validator chỉ trả `path` + câu tiếng Việt. FE muốn xử lý riêng
// một loại lỗi (ví dụ mở hộp thoại chọn cổng khi port sai) buộc phải so khớp
// chuỗi tiếng Việt — vỡ ngay khi ai đó sửa lại câu chữ cho dễ đọc. Mã ổn định
// tách "cái gì sai" khỏi "diễn đạt thế nào".
const (
	CodeRequired         = "REQUIRED"
	CodeInvalidFormat    = "INVALID_FORMAT"
	CodeOutOfRange       = "OUT_OF_RANGE"
	CodeDuplicate        = "DUPLICATE"
	CodeNotFound         = "NOT_FOUND"
	CodeUnsupported      = "UNSUPPORTED"
	CodePortNotAvailable = "PORT_NOT_AVAILABLE"
	CodeAddressOverlap   = "ADDRESS_OVERLAP"
	CodeCapacityExceeded = "CAPACITY_EXCEEDED"
	CodeBusOverloaded    = "BUS_OVERLOADED"
	CodeTagConflict      = "TAG_CONFLICT"
)

type ValidationError struct {
	Path    string
	Message string
	Code    string
}

// ValidateOptions gom các phụ thuộc BÊN NGOÀI của validator.
//
// Validator phải là hàm THUẦN: cùng input cho cùng output, không đọc file,
// không gọi core. Bản trước trộn việc đọc config IO/virtual point vào giữa
// handler nên không thể test riêng luật nào — mọi test phải dựng cả App.
type ValidateOptions struct {
	// Tag đã bị chiếm bởi IO/virtual point; key là tag đã chuẩn hoá.
	ExternalTagOwners map[string]string
	// Cổng serial board thật sự có (MBR-B211).
	Capabilities CapabilityManifest
	// Ngưỡng cảnh báo/từ chối tải bus, % (MBR-B207 / OD-MBRTU-006).
	BusWarnPercent   float64
	BusRejectPercent float64
}

func DefaultValidateOptions() ValidateOptions {
	return ValidateOptions{
		Capabilities: DefaultCapabilityManifest(),
		// OD-MBRTU-006: 50/70 là giá trị KHỞI ĐIỂM, chưa đo trên phần cứng thật.
		// Phải đo lại ở TC-MBRTU-H-15 rồi chốt.
		BusWarnPercent:   50,
		BusRejectPercent: 70,
	}
}

// Validate kiểm toàn bộ cấu hình. Hàm thuần, không I/O.
func Validate(cfg Config, externalTagOwners map[string]string) []ValidationError {
	opts := DefaultValidateOptions()
	opts.ExternalTagOwners = externalTagOwners
	return ValidateWith(cfg, opts)
}

func ValidateWith(cfg Config, opts ValidateOptions) []ValidationError {
	var errs []ValidationError
	add := func(path, code, message string) {
		errs = append(errs, ValidationError{Path: path, Message: message, Code: code})
	}

	buses := validateBuses(cfg, opts, add)
	devices := validateDevices(cfg, buses, opts, add)
	validatePoints(cfg, devices, opts, add)
	validateAddressOverlap(cfg, add)
	validateBusLoad(cfg, buses, opts, add)

	if len(cfg.Points) > MaxPoints {
		add("points", CodeCapacityExceeded,
			fmt.Sprintf("vượt sức chứa %d Point của contract (KX_N_EXT)", MaxPoints))
	}
	return errs
}

// MaxPoints khớp KX_N_EXT trong contracts/shm/mkddc_shm.h (Đ-07: ≥256).
const MaxPoints = 256

type addFunc func(path, code, message string)

func validateBuses(cfg Config, opts ValidateOptions, add addFunc) map[string]Bus {
	out := map[string]Bus{}
	seenPort := map[string]string{}
	seenNumeric := map[int]string{}
	for i, raw := range cfg.Buses {
		bus := NormalizeBus(raw)
		base := fmt.Sprintf("buses[%d]", i)
		if bus.BusID == "" {
			add(base+".bus_id", CodeRequired, "bắt buộc")
			continue
		}
		if _, exists := out[bus.BusID]; exists {
			add(base+".bus_id", CodeDuplicate, "phải unique")
		}
		if n := bus.NumericID(); n == 0 {
			add(base+".bus_id", CodeInvalidFormat,
				"phải kết thúc bằng số 1..255 (ví dụ rs485-1) để ánh xạ sang bus_id của iobus")
		} else if owner, exists := seenNumeric[n]; exists {
			add(base+".bus_id", CodeDuplicate, "trùng số thứ tự bus với "+owner)
		} else {
			seenNumeric[n] = bus.BusID
		}
		// MBR-B211: cổng phải nằm trong capability manifest của board.
		if !opts.Capabilities.Allows(bus.Port) {
			add(base+".port", CodePortNotAvailable,
				"cổng không có trên board này; cổng hợp lệ: "+opts.Capabilities.PortList())
		} else if owner, exists := seenPort[bus.Port]; exists {
			add(base+".port", CodeDuplicate, "đã được bus "+owner+" sử dụng")
		} else {
			seenPort[bus.Port] = bus.BusID
		}
		maxBaud := opts.Capabilities.MaxBaudFor(bus.Port)
		if bus.Baud < 1200 || (maxBaud > 0 && bus.Baud > maxBaud) {
			add(base+".baud", CodeOutOfRange,
				fmt.Sprintf("phải trong 1200..%d", maxBaud))
		}
		if bus.Parity != "N" && bus.Parity != "E" && bus.Parity != "O" {
			add(base+".parity", CodeUnsupported, "phải là N, E hoặc O")
		}
		if bus.StopBit != 1 && bus.StopBit != 2 {
			add(base+".stop_bit", CodeUnsupported, "phải là 1 hoặc 2")
		}
		if bus.OfflineProbeMs < 1000 || bus.OfflineProbeMs > 60000 {
			add(base+".offline_probe_ms", CodeOutOfRange, "phải trong 1000..60000 ms")
		}
		// iobus mở cổng bằng `modbus_new_rtu(..., 8, stop)` — 8 bit dữ liệu là
		// giá trị viết cứng. Nhận một giá trị khác rồi vẫn hiện nó trên trang
		// Tổng quan là để giao diện NÓI SAI về thứ đang chạy trên dây.
		if bus.DataBits != 8 {
			add(base+".data_bits", CodeUnsupported, "iobus chỉ hỗ trợ 8 bit dữ liệu")
		}
		// G-D: chỉ hai chế độ. Giá trị lạ được iobus bỏ qua kèm cảnh báo, nhưng
		// từ chối ngay tại đây thì người dùng biết mình gõ sai thay vì tưởng đã
		// đặt được một chế độ không tồn tại.
		if bus.Direction != "" && bus.Direction != "auto" && bus.Direction != "rts" {
			add(base+".direction", CodeUnsupported, `phải là "auto" hoặc "rts"`)
		}
		out[bus.BusID] = bus
	}
	return out
}

func validateDevices(cfg Config, buses map[string]Bus, opts ValidateOptions,
	add addFunc) map[string]Device {
	devices := make(map[string]Device, len(cfg.Devices))
	slavesPerBus := map[string]map[int]string{}

	for i, raw := range cfg.Devices {
		device := NormalizeDevice(raw)
		base := fmt.Sprintf("devices[%d]", i)
		if !ValidStableID(device.DeviceID) {
			add(base+".device_id", CodeInvalidFormat,
				"phải dài 1..23 ký tự ASCII và bắt đầu bằng chữ")
		}
		key := strings.ToLower(device.DeviceID)
		if _, exists := devices[key]; exists {
			add(base+".device_id", CodeDuplicate, "phải unique")
		}
		devices[key] = device
		if _, _, err := points.NormalizeName(device.DisplayName); err != nil {
			add(base+".display_name", CodeInvalidFormat, err.Error())
		}

		// MBR-B202: Device tham chiếu Bus; tham số serial KẾ THỪA read-only.
		busID := device.BusID
		if busID == "" {
			busID = busIDForPort(device.RS485Port)
			if busID == "" {
				// Không khai `bus_id` và cổng không thuộc dây nào của board:
				// trước đây rơi thầm về dây 1 (REV-BE-09). Từ chối tại đây để
				// người dùng thấy cấu hình sai, thay vì thấy thiết bị chạy trên
				// một dây họ không chọn.
				add(base+".bus_id", CodeNotFound,
					"bắt buộc khi cổng không thuộc bus RS-485 nào của board")
			}
		}
		bus, busExists := buses[busID]
		if len(buses) > 0 && busID != "" && !busExists {
			add(base+".bus_id", CodeNotFound, "không tham chiếu bus đã khai báo")
		}
		if busExists && device.RS485Port != "" && device.RS485Port != bus.Port {
			add(base+".rs485_port", CodeInvalidFormat,
				"cổng thuộc về Bus; thiết bị không được khai cổng khác bus "+bus.BusID)
		}
		if !busExists && !opts.Capabilities.Allows(device.RS485Port) {
			add(base+".rs485_port", CodePortNotAvailable,
				"cổng không có trên board này; cổng hợp lệ: "+opts.Capabilities.PortList())
		}

		if device.SlaveID < 1 || device.SlaveID > 247 {
			add(base+".slave_id", CodeOutOfRange, "phải trong 1..247")
		}
		// Trùng slave_id chỉ là lỗi TRÊN CÙNG MỘT DÂY. Hai bus vật lý tách biệt
		// hoàn toàn có thể cùng có slave 1 — cấm điều đó là bịa ra một ràng buộc
		// không tồn tại trong giao thức.
		if slavesPerBus[busID] == nil {
			slavesPerBus[busID] = map[int]string{}
		}
		if previous, exists := slavesPerBus[busID][device.SlaveID]; exists {
			add(base+".slave_id", CodeDuplicate, "trùng với "+previous+" trên cùng bus "+busID)
		} else {
			slavesPerBus[busID][device.SlaveID] = device.DeviceID
		}

		if device.PollMS < 10 || device.PollMS > 60000 {
			add(base+".poll_ms", CodeOutOfRange, "phải trong 10..60000 ms")
		}
		if device.TimeoutMS < 20 || device.TimeoutMS > 10000 {
			add(base+".timeout_ms", CodeOutOfRange, "phải trong 20..10000 ms")
		}
		// D-05 (Đ-05): `retry` là SỐ LẦN PHÁT LẠI một giao dịch lỗi, không phải
		// ngưỡng chuyển OFFLINE. Giới hạn 3 vì 3 lần phát lại × timeout 300 ms đã
		// là ~1,2 s chiếm dây cho một block trên bus dùng chung.
		if device.Retry < 0 || device.Retry > 3 {
			add(base+".retry", CodeOutOfRange, "phải trong 0..3 (số lần phát lại một giao dịch)")
		}
		if device.OfflineAfterErrors < 1 || device.OfflineAfterErrors > 10 {
			add(base+".offline_after_errors", CodeOutOfRange, "phải trong 1..10")
		}
	}
	return devices
}

func validatePoints(cfg Config, devices map[string]Device, opts ValidateOptions, add addFunc) {
	tagOwners := make(map[string]string, len(opts.ExternalTagOwners)+len(cfg.Points))
	for key, owner := range opts.ExternalTagOwners {
		tagOwners[key] = owner
	}
	pointIDs := map[string]string{}

	for i, raw := range cfg.Points {
		point := NormalizePoint(raw)
		base := fmt.Sprintf("points[%d]", i)
		if !ValidStableID(point.PointID) {
			add(base+".point_id", CodeInvalidFormat,
				"phải dài 1..23 ký tự ASCII, bắt đầu bằng chữ và không đổi khi rename")
		}
		idKey := strings.ToLower(point.PointID)
		if owner, exists := pointIDs[idKey]; exists {
			add(base+".point_id", CodeDuplicate, "trùng với "+owner)
		} else {
			pointIDs[idKey] = point.PointID
		}
		if _, exists := devices[strings.ToLower(point.DeviceID)]; !exists {
			add(base+".device_id", CodeNotFound, "không tham chiếu thiết bị tồn tại")
		}
		if _, key, err := points.NormalizeTag(point.TagName); err != nil {
			add(base+".tag_name", CodeInvalidFormat, err.Error())
		} else if owner, exists := tagOwners[key]; exists {
			add(base+".tag_name", CodeTagConflict, "phải unique; đang thuộc "+owner)
		} else {
			tagOwners[key] = point.PointID
		}
		if _, _, err := points.NormalizeName(point.DisplayName); err != nil {
			add(base+".display_name", CodeInvalidFormat, err.Error())
		}
		switch point.RegisterType {
		case "coil", "discrete_input", "input_register", "holding_register":
		default:
			add(base+".register_type", CodeUnsupported, "không được hỗ trợ")
		}
		if point.Address < 0 || point.Address > 65535 {
			add(base+".address", CodeOutOfRange, "phải trong 0..65535")
		}
		/* `ISS-PIO-21` — quy ước địa chỉ gõ sai phải KÊU.
		 *
		 * Rỗng là hợp lệ và nghĩa là `protocol` (mọi cấu hình đang chạy). Nhưng
		 * một chuỗi lạ mà bị ép êm về `protocol` sẽ khiến người dùng chọn
		 * `vendor`, gõ sai một ký tự, rồi nhận một điểm lặng lẽ hiểu con số của
		 * họ theo quy ước khác — tức đọc sang thanh ghi bên cạnh, với quality
		 * GOOD và không một dấu hiệu nào. */
		if point.AddressConvention != "" && !ValidAddressConvention(point.AddressConvention) {
			add(base+".address_convention", CodeUnsupported, "phải là protocol hoặc vendor")
		}
		switch point.DataType {
		case "bool", "int16", "uint16", "int32", "uint32", "float32":
		default:
			add(base+".data_type", CodeUnsupported, "không được hỗ trợ")
		}
		if (point.RegisterType == "coil" || point.RegisterType == "discrete_input") &&
			point.DataType != "bool" {
			add(base+".data_type", CodeUnsupported, "Coil/Discrete Input phải dùng bool")
		}
		if point.ByteOrder != "big" && point.ByteOrder != "little" {
			add(base+".byte_order", CodeUnsupported, "phải là big hoặc little")
		}
		if point.WordOrder != "high_low" && point.WordOrder != "low_high" {
			add(base+".word_order", CodeUnsupported, "phải là high_low hoặc low_high")
		}
		// D-02: scale = 0 làm encode_register tính raw = 0 rồi trả true, tức GHI
		// IM LẶNG giá trị 0 xuống thiết bị hiện trường.
		if point.Scale == 0 {
			add(base+".scale", CodeOutOfRange, "không được bằng 0")
		}
		if point.ReadWrite != "read" && point.ReadWrite != "read_write" {
			add(base+".read_write", CodeUnsupported, "phải là read hoặc read_write")
		}
		if point.ReadWrite == "read_write" && point.RegisterType != "coil" &&
			point.RegisterType != "holding_register" {
			add(base+".read_write", CodeUnsupported, "chỉ Coil/Holding Register được ghi")
		}
		if point.MinValue != nil && point.MaxValue != nil && *point.MinValue > *point.MaxValue {
			add(base+".min_value", CodeOutOfRange, "min_value phải nhỏ hơn hoặc bằng max_value")
		}
		// OD-MBRTU-003: bit_index chỉ có nghĩa với bool trên register.
		if point.BitIndex != nil {
			if *point.BitIndex < 0 || *point.BitIndex > 15 {
				add(base+".bit_index", CodeOutOfRange, "phải trong 0..15")
			}
			if point.DataType != "bool" {
				add(base+".bit_index", CodeUnsupported, "chỉ dùng được với data_type bool")
			}
			if point.RegisterType != "holding_register" && point.RegisterType != "input_register" {
				add(base+".bit_index", CodeUnsupported,
					"chỉ dùng được với Holding/Input Register")
			}
		}
	}
}

// validateAddressOverlap áp luật DATA_MODEL §5.5.
//
// Vì sao phải chặn: hai Point enabled trỏ vào cùng register nghĩa là cùng một
// ô nhớ thiết bị được publish dưới hai danh tính khác nhau. Khi ghi, hai Point
// sẽ ghi đè nhau theo thứ tự không xác định. Alias có chủ ý chỉ mở sau
// OD-MBRTU-004.
func validateAddressOverlap(cfg Config, add addFunc) {
	type span struct {
		start, end int // [start, end)
		bitIndex   int // -1 = chiếm cả register
		pointID    string
		index      int
	}
	byScope := map[string][]span{}

	for i, raw := range cfg.Points {
		point := NormalizePoint(raw)
		if !point.Enabled {
			continue
		}
		width := 1
		switch point.DataType {
		case "int32", "uint32", "float32":
			width = 2
		}
		bit := -1
		if point.BitIndex != nil {
			bit = *point.BitIndex
		}
		scope := strings.ToLower(point.DeviceID) + "/" + point.RegisterType
		byScope[scope] = append(byScope[scope], span{
			start: point.Address, end: point.Address + width,
			bitIndex: bit, pointID: point.PointID, index: i,
		})
	}

	scopes := make([]string, 0, len(byScope))
	for scope := range byScope {
		scopes = append(scopes, scope)
	}
	sort.Strings(scopes)

	for _, scope := range scopes {
		spans := byScope[scope]
		for a := 0; a < len(spans); a++ {
			for b := a + 1; b < len(spans); b++ {
				x, y := spans[a], spans[b]
				if x.end <= y.start || y.end <= x.start {
					continue
				}
				// Hai bit KHÁC NHAU trong cùng một register là hợp lệ và rất phổ
				// biến ở thanh ghi trạng thái của VFD/đồng hồ.
				if x.bitIndex >= 0 && y.bitIndex >= 0 && x.bitIndex != y.bitIndex &&
					x.start == y.start && x.end == y.end {
					continue
				}
				add(fmt.Sprintf("points[%d].address", y.index), CodeAddressOverlap,
					"chồng vùng register với "+x.pointID)
			}
		}
	}
}

// BusLoad là ước lượng tải của một sợi dây (MBR-B207).
type BusLoad struct {
	BusID          string  `json:"bus_id"`
	Port           string  `json:"port"`
	Baud           int     `json:"baud"`
	DeviceCount    int     `json:"device_count"`
	PointCount     int     `json:"point_count"`
	EstimatedPct   float64 `json:"estimated_percent"`
	WarnThreshold  float64 `json:"warn_percent"`
	RejectThresold float64 `json:"reject_percent"`
}

// EstimateBusLoad tính phần trăm thời gian chiếm dây theo cấu hình.
//
// Mô hình: mỗi thiết bị mỗi chu kỳ poll phát `blocks` giao dịch; mỗi giao dịch
// tốn thời gian truyền request + response cộng thời gian quay đầu (3,5 ký tự
// theo chuẩn Modbus RTU). Đây là ƯỚC LƯỢNG cấu hình — số đo thật do BusWorker
// đếm và publish qua `kx_bus_metrics_t`. Hai con số phục vụ hai việc khác nhau:
// cái này chặn cấu hình không khả thi TRƯỚC khi apply, cái kia cho biết dây
// đang thực sự bận bao nhiêu.
func EstimateBusLoad(cfg Config, opts ValidateOptions) []BusLoad {
	buses, _ := MigrateBuses(cfg)
	pointsByDevice := map[string]int{}
	for _, point := range cfg.Points {
		if point.Enabled {
			pointsByDevice[strings.ToLower(point.DeviceID)]++
		}
	}

	out := make([]BusLoad, 0, len(buses))
	for _, bus := range buses {
		load := BusLoad{
			BusID: bus.BusID, Port: bus.Port, Baud: bus.Baud,
			WarnThreshold: opts.BusWarnPercent, RejectThresold: opts.BusRejectPercent,
		}
		busyPerSecond := 0.0
		for _, device := range cfg.Devices {
			if !device.Enabled || deviceBusID(device) != bus.BusID {
				continue
			}
			load.DeviceCount++
			pointCount := pointsByDevice[strings.ToLower(device.DeviceID)]
			load.PointCount += pointCount
			if device.PollMS <= 0 {
				continue
			}
			// Mỗi 125 register là một giao dịch; tối thiểu một giao dịch.
			blocks := (pointCount + 124) / 125
			if blocks == 0 {
				blocks = 1
			}
			// 8 byte request + (5 + 2·point) byte response, 11 bit mỗi ký tự,
			// cộng 3,5 ký tự quay đầu ở mỗi đầu khung.
			charsPerTransaction := 8.0 + 5.0 + 2.0*float64(pointCount) + 7.0
			bitsPerTransaction := charsPerTransaction * 11.0
			baud := bus.Baud
			if baud <= 0 {
				baud = 19200
			}
			secondsPerTransaction := bitsPerTransaction / float64(baud)
			// Timeout của thiết bị là chặn dưới: một thiết bị chậm giữ dây ít
			// nhất bằng thời gian chờ phản hồi.
			pollsPerSecond := 1000.0 / float64(device.PollMS)
			busyPerSecond += secondsPerTransaction * float64(blocks) * pollsPerSecond
		}
		load.EstimatedPct = busyPerSecond * 100.0
		out = append(out, load)
	}
	return out
}

func deviceBusID(device Device) string {
	if device.BusID != "" {
		return device.BusID
	}
	return busIDForPort(device.RS485Port)
}

func validateBusLoad(cfg Config, buses map[string]Bus, opts ValidateOptions, add addFunc) {
	if opts.BusRejectPercent <= 0 {
		return
	}
	_ = buses
	for _, load := range EstimateBusLoad(cfg, opts) {
		if load.EstimatedPct > opts.BusRejectPercent {
			add("buses."+load.BusID, CodeBusOverloaded,
				fmt.Sprintf("tải ước tính %.1f%% vượt ngưỡng %.0f%%; giảm số Point hoặc tăng poll_ms",
					load.EstimatedPct, opts.BusRejectPercent))
		}
	}
}
