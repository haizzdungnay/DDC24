package application

import (
	"fmt"
	"strconv"
	"strings"
)

/* ISS-PIO-09 (F-PIO-026, đề bài §29) — DANH TÍNH THEO NGUỒN cho hàng Point.
 *
 * Trước đây hàng Point hiện `category:deviceId:pointId`, nên một điểm Modbus
 * đọc ra `MB_RTU:bus-1-slave-3:VFD_Frequency`: không thanh ghi, không mã hàm,
 * và `bus-1-slave-3` là danh tính CANONICAL của tầng Programming chứ không
 * phải cái tên người vận hành đặt cho thiết bị trong tủ.
 *
 * Ba chuỗi dưới đây do MÁY CHỦ dựng chứ không phải FE, vì cùng một lý do đã
 * ghi ở `ISS-PIO-32`: dữ liệu để dựng chúng (dải kỹ thuật, chính sách khởi
 * động lại, vùng thanh ghi, mã hàm) nằm ở cấu hình mà FE không đọc. FE tự suy
 * sẽ vừa sai vừa không ai bắt được.
 *
 * QUY TẮC XUYÊN SUỐT: thiếu dữ liệu thì BỎ TRỐNG, không bịa. Một hàng ghi
 * "HR 0 · FC03" cho điểm chưa biết địa chỉ tệ hơn hẳn một hàng không ghi gì.
 */

// PointSourceIdentity là phần định danh theo nguồn của một hàng Point.
type PointSourceIdentity struct {
	// DisplayID — định danh ngắn theo nguồn (`UI-01`, `AV-01`, `MB-014`).
	// Rỗng = chưa dựng được; FE quay về `PointID` chứ không bịa số.
	DisplayID string `json:"displayId,omitempty"`
	// DeviceLabel — TÊN thiết bị do người vận hành đặt (`CK508-04`), khác hẳn
	// `DeviceID` canonical (`bus-1-slave-4`). Chỉ điểm Modbus mới có.
	DeviceLabel string `json:"deviceLabel,omitempty"`
	// SourceDetail — chi tiết kỹ thuật đọc được ngay trên hàng:
	// `0-10V → 0…50 °C` · `RW · RETAIN` · `HR 102 · FC03`.
	SourceDetail string `json:"sourceDetail,omitempty"`
}

// LocalSourceDetail dựng chi tiết cho điểm vật lý: kiểu tín hiệu và dải kỹ
// thuật. Kiểu tín hiệu lấy NGUYÊN VĂN từ cấu hình (`0-10V`, `NTC10k`) — viết
// lại cho đẹp là tự tạo một cách gọi thứ hai cho cùng một thứ.
func LocalSourceDetail(signalType, unit string, scaleLo, scaleHi *float64) string {
	signal := strings.TrimSpace(signalType)
	span := engineeringSpan(unit, scaleLo, scaleHi)
	switch {
	case signal != "" && span != "":
		return signal + " → " + span
	case signal != "":
		return signal
	default:
		return span
	}
}

// engineeringSpan dựng `0…50 °C`. Thiếu MỘT trong hai biên là chưa có dải —
// `0…?` không nói được gì mà lại trông như một dải thật.
func engineeringSpan(unit string, lo, hi *float64) string {
	if lo == nil || hi == nil {
		return ""
	}
	span := trimFloat(*lo) + "…" + trimFloat(*hi)
	if unit = strings.TrimSpace(unit); unit != "" {
		span += " " + unit
	}
	return span
}

func trimFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

// VirtualSourceDetail dựng chi tiết cho Virtual Point: quyền ghi và chính sách
// khởi động lại. `RETAIN` chỉ hiện khi chính sách ĐÚNG LÀ `retain` — mọi giá
// trị khác (kể cả rỗng) đều không phải lời hứa giữ giá trị qua mất điện.
func VirtualSourceDetail(writable bool, restartPolicy string) string {
	parts := []string{"RO"}
	if writable {
		parts[0] = "RW"
	}
	if strings.EqualFold(strings.TrimSpace(restartPolicy), "retain") {
		parts = append(parts, "RETAIN")
	}
	return strings.Join(parts, " · ")
}

// ModbusSourceDetail dựng `HR 102 · FC03`. `registerAbbrev` và `functionCode`
// đến từ `modbusrtu` (cùng bảng mà `BuildProfile` ghi xuống `fieldbus.conf`),
// nên con số trên màn hình không thể trôi khỏi con số trên dây.
//
// `addressKnown=false` ⇒ chỉ còn vùng thanh ghi; địa chỉ 0 là một địa chỉ HỢP
// LỆ trong Modbus nên không thể dùng 0 để nói "chưa biết".
func ModbusSourceDetail(registerAbbrev string, address int, addressKnown bool, functionCode int) string {
	parts := make([]string, 0, 2)
	switch {
	case registerAbbrev != "" && addressKnown:
		parts = append(parts, fmt.Sprintf("%s %d", registerAbbrev, address))
	case registerAbbrev != "":
		parts = append(parts, registerAbbrev)
	}
	if functionCode > 0 {
		parts = append(parts, fmt.Sprintf("FC%02d", functionCode))
	}
	return strings.Join(parts, " · ")
}

// ModbusDisplayID dựng `MB-014` từ slot EXT. `extIndex <= 0` nghĩa là chưa cấp
// slot (`ISS-PIO-31`) ⇒ rỗng, để FE hiện `pointId` thay vì một số bịa.
func ModbusDisplayID(extIndex int) string {
	if extIndex <= 0 {
		return ""
	}
	return fmt.Sprintf("MB-%03d", extIndex)
}
