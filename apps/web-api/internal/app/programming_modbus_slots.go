package app

import (
	"context"

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
	snapshot := programmingapplication.ModbusSlotSnapshot{
		ConfigRevision: configRevisionLabel(cfg),
		Slots:          make([]programmingapplication.ModbusSlot, 0, len(layout.Slots)),
	}
	for _, slot := range layout.Slots {
		snapshot.Slots = append(snapshot.Slots, programmingapplication.ModbusSlot{
			DeviceID: slot.DeviceID, PointID: slot.PointID, ExtIndex: slot.ExtIndex,
			RegisterType: slot.RegisterType, Address: slot.Address,
			DataType: slot.DataType, ReadWrite: slot.ReadWrite,
		})
	}
	return snapshot, nil
}

// configRevisionLabel gắn nhãn cấu hình đã dùng để phân giải. `checksum` là thứ
// đổi khi nội dung đổi, nên nó nói đúng hơn `revision` khi ai đó sửa file tay.
func configRevisionLabel(cfg ConfigFieldbus) string {
	if cfg.Checksum != "" {
		return cfg.Checksum
	}
	return ""
}
