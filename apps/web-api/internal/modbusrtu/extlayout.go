package modbusrtu

import (
	"fmt"
	"sort"
)

// `ISS-PIO-31` / `F-PIO-029` — BẢN ĐỒ SLOT `ext` CỦA ĐIỂM MODBUS.
//
// VẤN ĐỀ
// ------
// Slot `ext` được cấp phát TUẦN TỰ trong `iobus` (`ext_cursor_ = 0` ở
// `modbus_master.cpp`, `binding.ext_base = *ext_cursor` ở `bus_worker.cpp`) trên
// đúng tập thiết bị/điểm mà `BuildFieldbusConfig`/`BuildProfile` phát ra. Ba
// thao tác cấu hình bình thường đều làm nó dịch chỗ:
//
//  1. đổi tên điểm  — `BuildProfile` sắp theo TÊN;
//  2. thêm/tắt điểm — điểm tắt bị bỏ khỏi profile;
//  3. tắt thiết bị  — thiết bị tắt bị bỏ khỏi danh sách slave.
//
// Kịch bản hỏng: `VFD-01` (12 điểm, ext 0–11) + `PUMP-02` (8 điểm, ext 12–19).
// Binding đã Commission trỏ `PUMP-02#14`. Tắt `VFD-01` để bảo trì ⇒ `PUMP-02`
// dịch xuống 0–7 ⇒ slot 14 KHÔNG CÒN là thanh ghi cũ. `st_io_map.cpp` chỉ kiểm
// `ext_index ∈ [1, KX_N_EXT]` nên 14 vẫn "hợp lệ": chương trình chạy tiếp, ghi
// lệnh bơm sai chỗ, không một dòng cảnh báo.
//
// VÌ SAO HÀM NÀY TỒN TẠI
// ----------------------
// Review ghi: *"Producer bắc cầu — KHÔNG TỒN TẠI — không nguồn nào phát
// `extIndex` ra ngoài"*. Không có nó thì không tầng nào ĐỐI CHIẾU được
// `(deviceId, pointId)` với slot mà runtime sẽ dùng, và mọi phép kiểm tham
// chiếu của `AC-PIO-ID-02` đều không thi hành được.
//
// Hàm này tính lại ĐÚNG bố cục mà `iobus` sẽ cấp, từ chính cấu hình mà BE phát
// ra. Nó KHÔNG đổi cách cấp phát — đổi bố cục là việc riêng, và làm chung một
// lần với việc bắc cầu sẽ khiến không ai phân biệt được lỗi nằm ở đâu.

// ExtSlot là một điểm Modbus cùng slot runtime của nó.
type ExtSlot struct {
	DeviceID string
	PointID  string
	TagName  string
	// ExtIndex theo quy ước 1-based của ARTIFACT/io_map.
	//
	// Đây là seam đã có thật và chưa từng chạy với dữ liệu thật: allocator
	// `iobus` đếm từ 0 (`snapshot.ext[ext_idx]`), còn artifact kiểm `>= 1` và
	// `st_process_image.cpp` trừ 1 khi đọc. Phát thẳng `ext_idx` thô sẽ lệch
	// ĐÚNG MỘT THANH GHI — hợp lệ với mọi phép kiểm hiện có, và sai ở đúng chỗ
	// không ai nhìn. Quy đổi làm MỘT LẦN, ở đây, và có test khoá cả hai đầu.
	ExtIndex int
	// RegisterCount là số thanh ghi điểm chiếm (2 với 32 bit). Slot kế tiếp
	// cách slot này đúng bấy nhiêu.
	RegisterCount int
}

// ExtLayout là bản đồ đầy đủ, tra được theo cả hai chiều.
type ExtLayout struct {
	Slots []ExtSlot
	byKey map[string]ExtSlot
	byExt map[int]ExtSlot
}

func extKey(deviceID, pointID string) string { return deviceID + "\x00" + pointID }

// Lookup tìm slot theo DANH TÍNH BỀN. Đây là chiều dùng cho kiểm tham chiếu:
// binding giữ `(deviceId, pointId)`, và câu hỏi luôn là "điểm này giờ nằm ở
// slot nào", không bao giờ ngược lại.
func (l ExtLayout) Lookup(deviceID, pointID string) (ExtSlot, bool) {
	slot, ok := l.byKey[extKey(deviceID, pointID)]
	return slot, ok
}

// AtExtIndex tra ngược, dùng để nói ĐÚNG người dùng đang trỏ vào cái gì khi
// binding cũ mang một slot đã đổi chủ. Một thông báo "slot 14 không còn là
// điểm bạn chọn" hữu ích hơn nhiều so với "binding không hợp lệ".
func (l ExtLayout) AtExtIndex(extIndex int) (ExtSlot, bool) {
	slot, ok := l.byExt[extIndex]
	return slot, ok
}

// registerCount lặp lại đúng luật của `BuildProfile`: kiểu 32 bit chiếm hai
// thanh ghi. Đọc từ cùng một chỗ thay vì đoán — nếu luật đổi mà đây không đổi,
// bản đồ sẽ nói dối một cách nhất quán và rất khó thấy.
func registerCount(dataType string) int {
	switch dataType {
	case "int32", "uint32", "float32":
		return 2
	default:
		return 1
	}
}

// BuildExtLayout tính bố cục slot mà `iobus` SẼ cấp cho cấu hình này.
//
// Thứ tự phải khớp chính xác thứ tự `iobus` duyệt:
//   - thiết bị theo thứ tự `BuildFieldbusConfig` phát ra (bỏ thiết bị tắt);
//   - trong mỗi thiết bị, điểm theo thứ tự `BuildProfile` phát ra — tức sắp
//     theo `name`, và bỏ điểm tắt.
//
// Hàm CỐ Ý sao lại cả hai đặc điểm gây dịch chỗ. Nó là bản mô tả trung thực của
// hành vi hiện tại, không phải bản mô tả hành vi mong muốn: một "bản đồ" tính
// theo luật khác luật đang chạy sẽ khiến phép đối chiếu bỏ lọt đúng ca nó sinh
// ra để bắt.
func BuildExtLayout(devices []Device, points []Point) ExtLayout {
	layout := ExtLayout{byKey: map[string]ExtSlot{}, byExt: map[int]ExtSlot{}}
	cursor := 0
	for _, device := range devices {
		if !device.Enabled {
			continue
		}
		devicePoints := make([]Point, 0)
		for _, point := range points {
			if point.DeviceID == device.DeviceID && bool(point.Enabled) {
				devicePoints = append(devicePoints, point)
			}
		}
		// `BuildProfile` sắp theo `name` của row, và `name` là `TagName`.
		sort.SliceStable(devicePoints, func(i, j int) bool {
			return devicePoints[i].TagName < devicePoints[j].TagName
		})
		for _, point := range devicePoints {
			count := registerCount(point.DataType)
			slot := ExtSlot{
				DeviceID: device.DeviceID, PointID: point.PointID, TagName: point.TagName,
				// +1: quy đổi 0-based (allocator) → 1-based (artifact).
				ExtIndex: cursor + 1, RegisterCount: count,
			}
			layout.Slots = append(layout.Slots, slot)
			layout.byKey[extKey(slot.DeviceID, slot.PointID)] = slot
			layout.byExt[slot.ExtIndex] = slot
			cursor += count
		}
	}
	return layout
}

// ExtMismatch mô tả một binding không còn trỏ đúng điểm của nó.
type ExtMismatch struct {
	DeviceID string
	PointID  string
	// WantExt là slot mà binding đang mang; GotExt là slot điểm đó thực sự
	// nằm ở bây giờ. `GotExt == 0` nghĩa là điểm không còn trong cấu hình.
	WantExt int
	GotExt  int
	Reason  string
}

func (m ExtMismatch) Error() string {
	return fmt.Sprintf("binding %s#%s: mang extIndex=%d nhưng %s", m.DeviceID, m.PointID, m.WantExt, m.Reason)
}

// VerifyBinding đối chiếu một binding đã Commission với bố cục hiện tại.
//
// Đây là nửa thi hành được của `AC-PIO-ID-02`: lệch ⇒ trả mismatch để tầng gọi
// CHẶN, thay vì để runtime chạy tiếp chỉ vì slot còn nằm trong `1…256`.
func (l ExtLayout) VerifyBinding(deviceID, pointID string, extIndex int) *ExtMismatch {
	slot, ok := l.Lookup(deviceID, pointID)
	if !ok {
		/* Điểm biến mất (bị tắt, bị xoá, hoặc thiết bị bị tắt) là ca NGUY HIỂM
		 * NHẤT: slot cũ thường vẫn hợp lệ về dải và nay thuộc về một điểm
		 * khác. Nói rõ nó thuộc về ai, nếu tra được. */
		reason := "điểm không còn trong cấu hình đang chạy (bị tắt, bị xoá, hoặc thiết bị đã tắt)"
		if occupant, taken := l.AtExtIndex(extIndex); taken {
			reason += fmt.Sprintf("; slot %d nay thuộc về %s#%s", extIndex, occupant.DeviceID, occupant.PointID)
		}
		return &ExtMismatch{DeviceID: deviceID, PointID: pointID, WantExt: extIndex, GotExt: 0, Reason: reason}
	}
	if slot.ExtIndex != extIndex {
		reason := fmt.Sprintf("điểm nay ở slot %d", slot.ExtIndex)
		if occupant, taken := l.AtExtIndex(extIndex); taken {
			reason += fmt.Sprintf("; slot %d nay thuộc về %s#%s", extIndex, occupant.DeviceID, occupant.PointID)
		}
		return &ExtMismatch{DeviceID: deviceID, PointID: pointID, WantExt: extIndex, GotExt: slot.ExtIndex, Reason: reason}
	}
	return nil
}
