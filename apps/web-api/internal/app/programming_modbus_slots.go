package app

import (
	"context"
	"fmt"
	"strings"

	webModbus "mkddc-web/internal/modbusrtu"
	programmingapplication "mkddc-web/internal/programming/application"
)

// `ISS-PIO-31`/`AC-PIO-ID-02` — nguồn phân giải slot `ext` cho đường Check.
//
// Adapter đọc CHÍNH cấu hình fieldbus mà `iobus` sẽ nạp, rồi dựng lại bố cục
// slot bằng `modbusrtu.BuildExtLayout` — hàm sao lại đúng thứ tự cấp phát của
// `iobus` (thiết bị theo thứ tự cấu hình, điểm theo `PointID`, bỏ mục đã tắt).
//
// Vì sao đọc lại mỗi lần Check thay vì cache: slot chỉ có nghĩa so với cấu hình
// ĐANG CHẠY. Một bản đồ cache lại là một bản đồ có thể cũ hơn thiết bị, và một
// bản đồ cũ ở đây cho ra đúng loại sai mà `ISS-PIO-31` sinh ra để chặn.
type programmingModbusSlotAdapter struct{ app *App }

func (a *App) programmingModbusSlots() programmingModbusSlotAdapter {
	return programmingModbusSlotAdapter{app: a}
}

func (adapter programmingModbusSlotAdapter) ResolveModbusSlots(
	_ context.Context) (programmingapplication.ModbusSlotSnapshot, error) {
	cfg, err := readConfig(adapter.app, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		return programmingapplication.ModbusSlotSnapshot{}, err
	}
	layout := webModbus.BuildExtLayout(cfg.Devices, cfg.Points)
	canonical := canonicalModbusDeviceIDs(cfg)
	snapshot := programmingapplication.ModbusSlotSnapshot{
		ConfigRevision: configRevisionLabel(cfg),
		Slots:          make([]programmingapplication.ModbusSlot, 0, len(layout.Slots)),
	}
	for _, slot := range layout.Slots {
		deviceID, ok := canonical[slot.DeviceID]
		if !ok {
			/* Slot do `BuildExtLayout` phát ra luôn thuộc một device có trong
			 * `cfg.Devices`, nên không map được nghĩa là bus của device đó khai
			 * sai (`NumericID() == 0`). Bỏ slot thay vì phát danh tính lai:
			 * một `deviceId` không đúng dạng canonical sẽ bị
			 * `validModbusDeviceID` chặn ở tầng trên, nhưng chặn ở đó thì lý do
			 * đã mất dấu về tận cấu hình bus. */
			continue
		}
		snapshot.Slots = append(snapshot.Slots, programmingapplication.ModbusSlot{
			DeviceID: deviceID, PointID: slot.PointID, ExtIndex: slot.ExtIndex,
			RegisterType: slot.RegisterType, Address: slot.Address, AddressKnown: true,
			DataType: slot.DataType, ReadWrite: slot.ReadWrite,
		})
	}
	return snapshot, nil
}

// canonicalModbusDeviceIDs ánh xạ `device_id` của cấu hình sang danh tính
// CANONICAL của tầng Programming: `bus-<n>-slave-<m>`.
//
// Vì sao phải quy đổi: Point Catalog phát `deviceId` theo dạng canonical (dựng
// từ `bus_id`/`slave_addr` mà runtime báo về), `validModbusDeviceID` bắt buộc
// đúng dạng đó, và toàn bộ test của `ModbusSlot` cũng viết theo dạng đó. Nhưng
// `BuildExtLayout` làm việc trên cấu hình nên slot nó phát ra mang `device_id`
// do người dùng đặt — trên bo thật là `CK508-04`, không phải `bus-1-slave-4`.
// Để nguyên hai hệ danh tính thì `Lookup(deviceId, pointId)` của đường Check
// không bao giờ khớp với binding dựng từ Catalog: điểm nào cũng "không còn
// trong cấu hình đang chạy" dù cấu hình không đổi một chữ.
//
// Ba nhánh, theo thứ tự tin cậy giảm dần:
//  1. `device_id` VỐN đã canonical ⇒ giữ nguyên. Cấu hình đặt tên như vậy là
//     đã tự nói danh tính runtime của nó; quy đổi lại chỉ tạo cơ hội sai.
//  2. Suy từ `bus_id` + `slave_id`. `bus_id` là chuỗi (`rs485-1`) và
//     `NumericID()` là CÙNG phép quy đổi mà validator bắt buộc và `iobus` dùng,
//     nên số ở đây khớp `bus_id` numeric trong SHM.
//  3. Không suy được (thiếu `bus_id`, hoặc bus khai sai số) ⇒ giữ nguyên
//     `device_id`. Bỏ slot ở đây sẽ biến một cấu hình bus thiếu sót thành
//     "điểm biến mất", và thông báo lỗi ở tầng trên mất hẳn dấu vết về nguyên
//     nhân thật.
func canonicalModbusDeviceIDs(cfg ConfigFieldbus) map[string]string {
	out := make(map[string]string, len(cfg.Devices))
	for _, device := range cfg.Devices {
		if isCanonicalModbusDeviceID(device.DeviceID) {
			out[device.DeviceID] = device.DeviceID
			continue
		}
		if n := (webModbus.Bus{BusID: device.BusID}).NumericID(); n != 0 {
			out[device.DeviceID] = fmt.Sprintf("bus-%d-slave-%d", n, device.SlaveID)
			continue
		}
		out[device.DeviceID] = device.DeviceID
	}
	return out
}

// isCanonicalModbusDeviceID lặp lại đúng phép kiểm của `validModbusDeviceID`
// bên `programming/application`. Cố ý lặp thay vì export: hai tầng kiểm cùng
// một dạng vì hai lý do khác nhau, và nối chúng bằng một hàm chung sẽ khiến
// một bên đổi luật kéo bên kia đi theo trong im lặng.
func isCanonicalModbusDeviceID(deviceID string) bool {
	return strings.HasPrefix(deviceID, "bus-") && strings.Contains(deviceID, "-slave-")
}

// configRevisionLabel gắn nhãn cấu hình đã dùng để phân giải. `checksum` là thứ
// đổi khi nội dung đổi, nên nó nói đúng hơn `revision` khi ai đó sửa file tay.
func configRevisionLabel(cfg ConfigFieldbus) string {
	if cfg.Checksum != "" {
		return cfg.Checksum
	}
	return ""
}
