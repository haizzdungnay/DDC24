package app

import (
	"fmt"
	"math"
	"strings"
)

/* ISS-PIO-15 — biên KỸ THUẬT cho điểm ảo, tách khỏi thang hiển thị (F-PIO-016).
 *
 * TRIỆU CHỨNG: `displayMin`/`displayMax` là thang VẼ ĐỒ THỊ. Không có đường nào
 * từ chối một lệnh ghi 45 °C vào `SAT_Setpoint` khai dải làm việc 16–30 °C —
 * lệnh đi trọn xuống Core, xuống cơ cấu chấp hành, và giao diện báo thành công.
 *
 * Nặng hơn "một số sai": điểm Modbus của CÙNG hệ này đã có `min_value`/
 * `max_value` với đúng nghĩa biên kỹ thuật (`modbusrtu/domain.go:90-94`), nên
 * hai nguồn Point trong một sản phẩm đang chạy hai mức nghiêm ngặt khác nhau.
 * Người vận hành không có cách nào biết mình đang đứng ở nguồn nào.
 *
 * CÁCH SỬA: thêm `minValue`/`maxValue` cho VP, ĐẶT TÊN GIỐNG HỆT phía Modbus,
 * và TỪ CHỐI lệnh ghi ngoài dải.
 *
 * VÌ SAO TỪ CHỐI CHỨ KHÔNG KẸP (clamp): kẹp im lặng biến "ghi 45" thành "ghi
 * 30" và trả về 200. Người vận hành tin thiết bị đang ở 45; hệ thống ở 30. Một
 * lệnh sai bị từ chối thì sửa được trong mười giây, còn một lệnh sai được nhận
 * rồi lặng lẽ đổi nghĩa thì chỉ lộ ra khi có sự cố.
 *
 * PHẠM VI CƯỠNG CHẾ, ghi rõ thay vì để người đọc tự phát hiện: phép kiểm này
 * nằm ở BỀ MẶT API (`PUT /points/{id}` và mọi đường ghi cấu hình VP). Một
 * chương trình ST ghi thẳng vào slot `plc_shm.av[]` KHÔNG đi qua đây — web-api
 * chỉ đọc lại slot đó ở vòng đối chiếu. Chặn tại vòng đối chiếu sẽ là web-api
 * đánh nhau với chương trình đang chạy mỗi 10 giây, tệ hơn hẳn lỗi đang sửa;
 * biên cho logic điều khiển thuộc về chính chương trình đó.
 */

// virtualPointRangeError là lỗi "giá trị ngoài biên kỹ thuật".
//
// Có KIỂU RIÊNG để nơi gọi phân biệt được với các lỗi ghi khác: đây là lỗi của
// YÊU CẦU (client sửa con số là xong ⇒ 400), không phải xung đột trạng thái
// thiết bị (⇒ 409). Trả 409 cho ca này sẽ bảo người dùng đi xem thiết bị đang
// bận gì, trong khi việc phải làm chỉ là gõ lại một con số.
type virtualPointRangeError struct {
	PointID string
	Value   float64
	Min     *float64
	Max     *float64
}

func (e *virtualPointRangeError) Error() string {
	return fmt.Sprintf("giá trị %s nằm ngoài biên kỹ thuật %s của điểm %s; lệnh ghi bị từ chối (không kẹp về biên)",
		formatVirtualPointLimit(e.Value), describeVirtualPointRange(e.Min, e.Max), e.PointID)
}

// formatVirtualPointLimit in số ở dạng ngắn nhất còn đọc được, không đuôi ".000000".
func formatVirtualPointLimit(value float64) string {
	return fmt.Sprintf("%g", value)
}

// describeVirtualPointRange mô tả dải cho người đọc, kể cả khi chỉ khai một vế.
func describeVirtualPointRange(min, max *float64) string {
	switch {
	case min != nil && max != nil:
		return fmt.Sprintf("[%s, %s]", formatVirtualPointLimit(*min), formatVirtualPointLimit(*max))
	case min != nil:
		return fmt.Sprintf(">= %s", formatVirtualPointLimit(*min))
	case max != nil:
		return fmt.Sprintf("<= %s", formatVirtualPointLimit(*max))
	default:
		return "(chưa khai)"
	}
}

/* virtualPointLimitsApplicable — biên kỹ thuật CHỈ có nghĩa với kiểu số.
 *
 * Trên `boolean`/`string`/`datetime` thì "min 16, max 30" không cưỡng chế được
 * gì. Chấp nhận rồi bỏ qua sẽ để lại một cấu hình trông như đang bảo vệ điểm mà
 * thực chất không — nên đường ghi API từ chối, xem `validateVirtualPointLimits`.
 */
func virtualPointLimitsApplicable(signalType string) bool {
	return virtualPointNumericSignalType(signalType)
}

// virtualPointHasLimits: điểm có khai biên nào không (một vế cũng tính).
func virtualPointHasLimits(item VirtualPoint) bool {
	return item.MinValue != nil || item.MaxValue != nil
}

/* checkVirtualPointValueRange kiểm một giá trị SẮP GHI với biên của điểm.
 *
 * Trả `nil` khi được phép ghi. Kiểu không phải số, hoặc điểm không khai biên
 * nào, thì không có gì để kiểm — đó là hành vi của mọi cấu hình đang chạy và
 * không được đổi chỉ vì trường mới xuất hiện.
 */
func checkVirtualPointValueRange(item VirtualPoint, value any) error {
	if !virtualPointHasLimits(item) || !virtualPointLimitsApplicable(item.SignalType) {
		return nil
	}
	number, ok := virtualPointNumber(value)
	if !ok {
		/* Không đọc được thành số trong khi điểm KHAI biên số ⇒ từ chối.
		 * Cho qua ở đây là mở đúng một lối vòng qua phép kiểm này. */
		return &virtualPointRangeError{PointID: item.ID, Value: math.NaN(), Min: item.MinValue, Max: item.MaxValue}
	}
	if item.MinValue != nil && number < *item.MinValue {
		return &virtualPointRangeError{PointID: item.ID, Value: number, Min: item.MinValue, Max: item.MaxValue}
	}
	if item.MaxValue != nil && number > *item.MaxValue {
		return &virtualPointRangeError{PointID: item.ID, Value: number, Min: item.MinValue, Max: item.MaxValue}
	}
	return nil
}

/* validateVirtualPointLimits kiểm phần biên kỹ thuật của MỘT mục cấu hình.
 *
 * Gọi từ `validateConfigVirtualPoints` sau khi mục đã chuẩn hoá. Kiểm cả
 * `value` lẫn `initialValue`: một cấu hình tự gieo sẵn giá trị ngoài dải sẽ
 * biến phép kiểm lúc ghi thành trò hề — điểm khởi động ở 45 °C rồi mọi lệnh ghi
 * hợp lệ sau đó đều bị so với một trạng thái vốn đã sai.
 */
func validateVirtualPointLimits(item VirtualPoint, base string, errs *[]configValidationError) {
	if !virtualPointHasLimits(item) {
		return
	}
	if !virtualPointLimitsApplicable(item.SignalType) {
		/* Không im lặng bỏ qua: một trường trông như đang bảo vệ điểm mà thực
		 * chất không cưỡng chế gì là thứ tệ hơn cả việc không có trường đó. */
		addConfigErr(errs, base+".minValue",
			"biên kỹ thuật chỉ áp dụng cho signalType integer hoặc float")
		return
	}
	for _, limit := range []struct {
		name  string
		value *float64
	}{{"minValue", item.MinValue}, {"maxValue", item.MaxValue}} {
		if limit.value == nil {
			continue
		}
		if math.IsNaN(*limit.value) || math.IsInf(*limit.value, 0) {
			addConfigErr(errs, base+"."+limit.name, "phải là số hữu hạn")
			return
		}
	}
	if item.MinValue != nil && item.MaxValue != nil && *item.MinValue > *item.MaxValue {
		addConfigErr(errs, base+".maxValue", "phải >= minValue")
		return
	}
	if item.Value != nil {
		if err := checkVirtualPointValueRange(item, item.Value); err != nil {
			addConfigErr(errs, base+".value", "nằm ngoài biên kỹ thuật "+describeVirtualPointRange(item.MinValue, item.MaxValue))
		}
	}
	if item.InitialValue != nil {
		if err := checkVirtualPointValueRange(item, item.InitialValue); err != nil {
			addConfigErr(errs, base+".initialValue", "nằm ngoài biên kỹ thuật "+describeVirtualPointRange(item.MinValue, item.MaxValue))
		}
	}
}

// virtualPointLimitsSummary dựng mô tả dải để đưa vào thông báo/nhật ký.
// Rỗng khi điểm không khai biên nào — nơi gọi không phải tự đoán.
func virtualPointLimitsSummary(item VirtualPoint) string {
	if !virtualPointHasLimits(item) {
		return ""
	}
	return strings.TrimSpace(describeVirtualPointRange(item.MinValue, item.MaxValue))
}
