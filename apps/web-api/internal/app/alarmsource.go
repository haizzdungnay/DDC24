package app

import (
	"strings"

	webModbus "mkddc-web/internal/modbusrtu"
)

/* ISS-PIO-19 — nguồn cảnh báo cho điểm Modbus RTU, và một lệch hợp đồng giữa
 * web-api và Core phát hiện khi làm issue này (F-PIO-023).
 *
 * VẤN ĐỀ CỦA ISSUE: `validateAlarmSource` chỉ nhận `UI, AO, DO, VP`. Một thanh
 * ghi báo lỗi biến tần (`Fault Word`) — thứ đáng báo động nhất trong tủ — không
 * đặt cảnh báo được.
 *
 * LỆCH HỢP ĐỒNG PHÁT HIỆN KÈM, nặng hơn hẳn: web-api ghi `kind: "VP"` vào
 * `/data/config/alarm_settings.conf`, và Core nạp ĐÚNG tệp đó nhưng chỉ biết
 * `UI/AO/DO/VI/VO`. Một `kind` lạ làm `parse_source` trả false, kéo theo cả
 * `load_alarm_config` trả false ⇒ **Core không nạp một cảnh báo nào**. Nghĩa là
 * đặt một cảnh báo cho điểm ảo qua giao diện web sẽ vô hiệu hoá TOÀN BỘ cảnh
 * báo phần cứng của tủ, im lặng. Cảnh báo VP vẫn "chạy" vì web-api tự đánh giá
 * chúng (`evaluateVirtualPointAlarm`), nên trên màn hình mọi thứ trông bình
 * thường — đó là lý do lỗi này sống được lâu.
 *
 * CÁCH SỬA: Core học `kind: "VP"` (xem `alarm_runtime.cpp`), và web-api ghi kèm
 * `boundPointId` — slot `AV-xx`/`BV-xx`/`MSV-xx` mà điểm ảo chiếm.
 *
 * VÌ SAO KHÔNG ĐỂ CORE SUY SLOT TỪ `channel`: số kênh VP và số slot Core là HAI
 * DÃY ĐỘC LẬP (đã chốt ở `ISS-PIO-18`). Suy ra sẽ vừa khớp nhầm điểm khác vừa
 * bỏ sót điểm đúng — và cả hai đều im lặng.
 */

// alarmSourceKindModbus là kind của nguồn cảnh báo trỏ vào một điểm Modbus RTU.
// Trùng tên category mà Point Catalog dùng (`MB_RTU`) để một khái niệm không
// mang hai cái tên trong cùng một sản phẩm.
const alarmSourceKindModbus = "MB_RTU"

// alarmSourceKinds là tập kind hợp lệ, dùng chung cho validate, hợp đồng và giao diện.
var alarmSourceKinds = []string{"UI", "AO", "DO", "VP", alarmSourceKindModbus}

/* resolveAlarmSourceBindings điền `boundPointId` cho mọi nguồn VP trước khi ghi
 * tệp cấu hình.
 *
 * Chạy ở đường GHI chứ không ở validate: đây là việc dịch sang hợp đồng của
 * Core, không phải một ràng buộc lên yêu cầu của người dùng. Bề mặt API giữ
 * nguyên `pointId: "VP1"`, nên vòng đọc-ghi của chính web-api không đổi.
 *
 * Không tra được điểm ảo ⇒ để TRỐNG chứ không bịa slot. Core sẽ từ chối đúng
 * dòng đó và in `vp_missing_bound`; bịa một slot ở đây là đem cảnh báo gắn vào
 * một điểm khác, và không ai phát hiện được cho tới lúc nó không kêu.
 */
func (a *App) resolveAlarmSourceBindings(rows []AlarmSetting) []AlarmSetting {
	if a == nil {
		return rows
	}
	for i := range rows {
		for j := range rows[i].Sources {
			source := &rows[i].Sources[j]
			if !strings.EqualFold(normalizeVirtualPointKind(source.Kind), "VP") {
				source.BoundPointID = ""
				continue
			}
			item, ok := a.findVirtualPoint(source.PointID)
			if !ok {
				source.BoundPointID = ""
				continue
			}
			source.BoundPointID = item.BoundPointID
		}
	}
	return rows
}

/* modbusExtIndexOf tra slot ext của một điểm Modbus, dùng lại đúng bộ cấp phát
 * của Point Catalog (`BuildExtLayout`).
 *
 * Trả 0 khi chưa cấp slot (điểm hoặc thiết bị đang tắt). 0 chứ không phải một
 * số đoán: một slot bịa sẽ gắn cảnh báo vào thanh ghi của điểm khác.
 */
func modbusExtIndexOf(layout webModbus.ExtLayout, deviceID, pointID string) int {
	slot, ok := layout.Lookup(deviceID, pointID)
	if !ok {
		return 0
	}
	return slot.ExtIndex
}

/* modbusVendorReferenceOf suy tham chiếu vendor của một điểm Modbus.
 *
 * `ISS-PIO-21`: trả 0 khi kiểu thanh ghi lạ, không trả một số gần đúng — một
 * tham chiếu sai hiện cạnh ô nhập là chính xác thứ dẫn người dùng gõ nhầm
 * thanh ghi, và sai một đơn vị ở đây không làm gì hỏng ồn ào cả.
 */
func modbusVendorReferenceOf(point ModbusRTUPoint) int {
	reference, ok := webModbus.VendorReference(point.RegisterType, point.Address)
	if !ok {
		return 0
	}
	return reference
}
