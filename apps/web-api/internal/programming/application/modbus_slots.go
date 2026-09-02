package application

import (
	"context"
	"fmt"
)

// `ISS-PIO-31` / `AC-PIO-ID-01`+`AC-PIO-ID-02` — SLOT `ext` KHÔNG PHẢI DANH TÍNH.
//
// LỖ HỔNG ĐANG CÓ
// ---------------
// Binding bền lưu `point.extIndex` do FE ghi lúc chọn điểm, và đường Check
// CHUYỂN TIẾP thẳng con số đó xuống compiler (`ioMapFromRevision`). Nhưng slot
// `ext` được `iobus` cấp TUẦN TỰ trên tập thiết bị/điểm đang bật, nên ba thao
// tác cấu hình bình thường — đổi `pointId`, thêm/tắt điểm, tắt thiết bị — đều
// làm nó dịch chỗ. Một binding đã Commission trỏ `PUMP-02#14` sau khi tắt
// `VFD-01` sẽ trỏ vào thanh ghi của điểm KHÁC, và `st_io_map.cpp` chỉ kiểm
// `ext_index ∈ [1, KX_N_EXT]` nên 14 vẫn "hợp lệ": chương trình ghi lệnh bơm
// sai chỗ, không một dòng cảnh báo.
//
// NGUYÊN TẮC Ở ĐÂY
// ----------------
//  1. Danh tính bền của một điểm Modbus là `(deviceId, pointId)` — hai trường
//     người dùng đặt. `extIndex` chỉ là HANDLE RUNTIME, phân giải lại mỗi lần
//     nạp cấu hình (`AC-PIO-ID-01`).
//  2. Check phân giải lại `extIndex` từ cấu hình ĐANG CHẠY, không tin con số
//     lưu trong binding (`AC-PIO-ID-02`).
//  3. Lệch giữa số đã lưu và số phân giải lại ⇒ CHẶN, không tự remap. Tự remap
//     là im lặng đổi ý nghĩa của một binding người vận hành đã duyệt
//     (`AC-PIO-ID-03`).
//  4. Không có nguồn phân giải ⇒ CHẶN mọi binding MB_RTU. Thiếu bằng chứng
//     không phải bằng chứng khớp.

// ModbusSlot là một điểm Modbus cùng slot runtime của nó, theo quy ước 1-based
// của artifact/io_map.
type ModbusSlot struct {
	DeviceID string `json:"deviceId"`
	PointID  string `json:"pointId"`
	ExtIndex int    `json:"extIndex"`
}

// ModbusSlotSnapshot là ẢNH CHỤP bố cục slot tại một thời điểm.
//
// Chụp một lần cho mỗi lần Check chứ không tra từng binding: hai binding của
// cùng một package phải được phân giải trên CÙNG một cấu hình, nếu không một
// thay đổi xảy ra giữa chừng sẽ cho ra một package nửa cũ nửa mới.
type ModbusSlotSnapshot struct {
	// ConfigRevision nhận diện cấu hình đã dùng để phân giải. Rỗng nghĩa là
	// nguồn không phát hành mốc — khi đó fingerprint chỉ dựa vào chính các slot.
	ConfigRevision string
	Slots          []ModbusSlot
}

// ModbusSlotProvider được `internal/app` implement (adapter quanh cấu hình
// fieldbus + `modbusrtu.BuildExtLayout`). `application` KHÔNG import
// `internal/app` — interface đứng ở đây theo đúng hướng phụ thuộc, giống
// `PointCatalogProvider`.
type ModbusSlotProvider interface {
	ResolveModbusSlots(ctx context.Context) (ModbusSlotSnapshot, error)
}

// Lookup tra theo danh tính bền.
func (s ModbusSlotSnapshot) Lookup(deviceID, pointID string) (ModbusSlot, bool) {
	for _, slot := range s.Slots {
		if slot.DeviceID == deviceID && slot.PointID == pointID {
			return slot, true
		}
	}
	return ModbusSlot{}, false
}

// AtExtIndex tra ngược để nói ĐÚNG người dùng đang trỏ vào cái gì. Một thông
// báo "slot 14 nay thuộc về VFD-02#PRESSURE" cho người vận hành biết ngay mức
// độ nguy hiểm; "extIndex không khớp" thì không.
func (s ModbusSlotSnapshot) AtExtIndex(extIndex int) (ModbusSlot, bool) {
	for _, slot := range s.Slots {
		if slot.ExtIndex == extIndex {
			return slot, true
		}
	}
	return ModbusSlot{}, false
}

// resolveModbusExtIndex phân giải slot cho MỘT binding và trả lý do chặn nếu
// không phân giải được hoặc lệch với số đã lưu.
//
// `stored == 0` là binding CHƯA từng được đóng dấu slot — không phải lệch, mà
// là lần phân giải đầu tiên.
func resolveModbusExtIndex(snapshot *ModbusSlotSnapshot, deviceID, pointID string, stored int) (int, string) {
	if snapshot == nil {
		return 0, fmt.Sprintf("không có nguồn phân giải slot Modbus nên không xác minh được binding %s#%s; "+
			"Check dừng thay vì tin con số đã lưu", deviceID, pointID)
	}
	slot, ok := snapshot.Lookup(deviceID, pointID)
	if !ok {
		reason := fmt.Sprintf("điểm %s#%s không còn trong cấu hình đang chạy "+
			"(bị tắt, bị xoá, hoặc thiết bị đã tắt)", deviceID, pointID)
		if stored > 0 {
			if occupant, taken := snapshot.AtExtIndex(stored); taken {
				reason += fmt.Sprintf("; slot %d mà binding đang mang nay thuộc về %s#%s",
					stored, occupant.DeviceID, occupant.PointID)
			}
		}
		return 0, reason
	}
	if stored != 0 && stored != slot.ExtIndex {
		reason := fmt.Sprintf("binding %s#%s mang slot %d nhưng điểm đó nay ở slot %d",
			deviceID, pointID, stored, slot.ExtIndex)
		if occupant, taken := snapshot.AtExtIndex(stored); taken {
			reason += fmt.Sprintf("; slot %d nay thuộc về %s#%s", stored, occupant.DeviceID, occupant.PointID)
		}
		reason += "; cần rebind rồi Commission lại — hệ thống KHÔNG tự chuyển slot"
		return 0, reason
	}
	return slot.ExtIndex, ""
}
