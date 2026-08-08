package app

import (
	webModbus "mkddc-web/internal/modbusrtu"
)

// Đường tra cứu telemetry Modbus RTU DUY NHẤT của tầng API.
//
// Khoá là cặp `(bus, slave)`, KHÔNG phải mỗi `slave`. Với hai cổng RS-485,
// `slave_id = 1` trên `rs485-1` và `slave_id = 1` trên `rs485-2` là hai thiết bị
// khác nhau hoàn toàn hợp lệ — validator chấp nhận điều đó vì `slave_id` chỉ
// cần unique **trong từng dây**. Tra theo mỗi địa chỉ slave thì hai thiết bị đè
// lên nhau: số đo của dây này bị gán cho thiết bị của dây kia, KPI đếm thiết bị
// chết thành đang chạy, và sự kiện ONLINE→OFFLINE mang nhầm `device_id` — người
// vận hành đi theo những con số đó sẽ tới nhầm tủ (REV-BE-03, REV-BE-04).
//
// Lỗi này từng được sửa riêng ở `handleModbusDiagnostics` mà không lan sang bốn
// call site còn lại. Vì vậy toàn bộ phép tra cứu telemetry nay bắt buộc đi qua
// hai kiểu dưới đây; thêm một `map[int]SlaveTelemetry` cục bộ ở endpoint mới là
// lặp lại đúng lỗi cũ.

type modbusSlaveKey struct {
	bus   int
	slave int
}

// modbusBusNumeric quy `bus_id` dạng chuỗi của cấu hình về id số mà FW-SOM dùng.
// Không giải được ⇒ 0, và 0 không khớp bất kỳ dây thật nào (iobus luôn publish
// `bus_id >= 1`, xem `fieldbus_config.cpp` MBR-B101).
func modbusBusNumeric(busID string) int {
	return webModbus.Bus{BusID: busID}.NumericID()
}

// modbusTelemetryIndex tra số đo slave theo thiết bị trong cấu hình.
type modbusTelemetryIndex struct {
	byBusSlave map[modbusSlaveKey]SlaveTelemetry
	// unkeyed = mọi bản ghi telemetry đều mang `bus_id = 0` ("chưa xác định").
	// Đó là publisher đời cũ chưa điền trường này; khi ấy — và CHỈ khi ấy — mọi
	// dây trong cấu hình cùng tra về tập bản ghi không khoá đó. Không có ngoại
	// lệ nào khác: telemetry đã khoá bus mà cấu hình không giải được bus thì
	// đúng đắn là "không biết", không phải đoán về dây 1.
	unkeyed bool
}

func newModbusTelemetryIndex(slaves []SlaveTelemetry) modbusTelemetryIndex {
	ix := modbusTelemetryIndex{byBusSlave: make(map[modbusSlaveKey]SlaveTelemetry, len(slaves))}
	ix.unkeyed = len(slaves) > 0
	for _, item := range slaves {
		if item.BusID != 0 {
			ix.unkeyed = false
		}
		ix.byBusSlave[modbusSlaveKey{bus: int(item.BusID), slave: int(item.Addr)}] = item
	}
	return ix
}

// lookupDevice trả số đo của đúng thiết bị đó, hoặc `false` khi chưa có số đo.
// `false` nghĩa là "chưa biết" — caller không được quy nó về offline hay 0.
func (ix modbusTelemetryIndex) lookupDevice(device webModbus.Device) (SlaveTelemetry, bool) {
	if ix.unkeyed {
		item, ok := ix.byBusSlave[modbusSlaveKey{bus: 0, slave: device.SlaveID}]
		return item, ok
	}
	item, ok := ix.byBusSlave[modbusSlaveKey{bus: modbusBusNumeric(modbusDeviceBus(device)), slave: device.SlaveID}]
	return item, ok
}

// modbusDeviceIndex là chiều ngược lại: từ `(bus, slave)` của telemetry tìm
// `device_id` trong cấu hình, dùng cho bảng chẩn đoán.
type modbusDeviceIndex struct {
	byBusSlave map[modbusSlaveKey]string
	// unkeyed = không thiết bị nào trong cấu hình giải được bus (cấu hình một
	// dây đời cũ, không khai `bus_id` và cổng không nằm trong bảng cổng board).
	unkeyed bool
}

func newModbusDeviceIndex(devices []webModbus.Device) modbusDeviceIndex {
	ix := modbusDeviceIndex{byBusSlave: make(map[modbusSlaveKey]string, len(devices))}
	ix.unkeyed = len(devices) > 0
	for _, device := range devices {
		bus := modbusBusNumeric(modbusDeviceBus(device))
		if bus != 0 {
			ix.unkeyed = false
		}
		ix.byBusSlave[modbusSlaveKey{bus: bus, slave: device.SlaveID}] = device.DeviceID
	}
	return ix
}

// lookup trả `device_id` hoặc chuỗi rỗng khi telemetry không khớp thiết bị nào
// đang khai báo. Rỗng là câu trả lời trung thực: nó nói "có một slave trên dây
// mà cấu hình không biết", chứ không dán nhãn của thiết bị khác lên nó.
func (ix modbusDeviceIndex) lookup(busID int, slaveID int) string {
	if ix.unkeyed {
		return ix.byBusSlave[modbusSlaveKey{bus: 0, slave: slaveID}]
	}
	return ix.byBusSlave[modbusSlaveKey{bus: busID, slave: slaveID}]
}
