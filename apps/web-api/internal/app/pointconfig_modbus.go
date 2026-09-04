package app

import (
	"net/http"
	"strings"
)

/* ISS-PIO-20 — `PUT /points/{id}/config` nhận điểm Modbus (F-PIO-023).
 *
 * TRIỆU CHỨNG: `canonicalPointConfigID` chỉ chuẩn hoá `UI/AO/DO/VP`, nên điểm
 * Modbus KHÔNG sửa được tag / tên / đơn vị / trend / thẻ thiết bị qua API Point
 * chung. Muốn đổi một cái tên phải đi đường CRUD riêng dưới `/modbus/*`, với
 * hình dạng payload khác hẳn — và mọi công cụ đã viết cho API Point chung thì
 * lặng lẽ không áp dụng được cho một phần ba số điểm trong tủ.
 *
 * VÌ SAO KHÔNG NHẬN DIỆN BẰNG MẪU CHUỖI: mã điểm Modbus do người dùng đặt
 * (`vfd-fault-word`), không theo một mẫu nào. Đoán bằng chuỗi sẽ vừa nhận nhầm
 * một mã gõ sai thành "điểm Modbus" vừa bỏ sót mã hợp lệ. Phép kiểm đúng là SỰ
 * TỒN TẠI trong `fieldbus.conf` — cùng nguồn mà `overlayPointMetadata` đã dùng
 * để chở metadata Modbus ra ngoài.
 */

// findModbusConfigPoint tra một điểm Modbus theo mã, không phân biệt hoa thường.
//
// Trả về chỉ số trong `cfg.Points` để nơi gọi sửa tại chỗ; -1 = không có.
func findModbusConfigPoint(cfg ConfigFieldbus, id string) int {
	target := strings.TrimSpace(id)
	for i := range cfg.Points {
		if strings.EqualFold(strings.TrimSpace(cfg.Points[i].PointID), target) {
			return i
		}
	}
	return -1
}

// modbusPointExists cho biết mã này có phải một điểm Modbus đang cấu hình không.
func (a *App) modbusPointExists(id string) bool {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		return false
	}
	return findModbusConfigPoint(cfg, id) >= 0
}

/* applyModbusPointMetadataPatch áp bản vá metadata lên một điểm Modbus.
 *
 * Đi qua `mutateModbusConfigLocked` chứ không tự ghi tệp: đó là đường ghi duy
 * nhất của cấu hình Modbus và nó mang theo validate toàn cục, apply xuống
 * iobus, và bump revision. Một đường ghi thứ hai bỏ qua các bước đó sẽ để lại
 * cấu hình trên đĩa khác với cấu hình đang chạy — im lặng.
 *
 * CHỈ chạm năm trường trình bày. `register_type`, `address`, `data_type`,
 * `scale`… là hợp đồng đọc thanh ghi; sửa chúng qua một API đặt tên là "config
 * metadata" là mở một cửa hậu vào chính phần nguy hiểm nhất của cấu hình.
 */
func (a *App) applyModbusPointMetadataPatch(w http.ResponseWriter, r *http.Request, id string, patch PointConfigPatch) {
	oldTag, oldName := "", ""
	applied := a.mutateModbusConfigLocked(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		index := findModbusConfigPoint(*cfg, id)
		if index < 0 {
			return modbusMutationResponse{}, []configValidationError{{Path: "point_id", Message: "không tồn tại"}}
		}
		point := cfg.Points[index]
		oldTag, oldName = point.TagName, point.DisplayName
		if patch.Tag != nil {
			point.TagName = *patch.Tag
		}
		if patch.Name != nil {
			point.DisplayName = *patch.Name
		}
		if patch.Unit != nil {
			point.Unit = strings.TrimSpace(*patch.Unit)
		}
		if patch.TrendEnabled != nil {
			point.TrendEnabled = *patch.TrendEnabled
		}
		if patch.Equipment != nil {
			point.Equipment = *patch.Equipment
		}
		point = normalizeModbusPoint(point)
		cfg.Points[index] = point
		return modbusMutationResponse{Point: &point}, nil
	})
	/* Vết audit ghi theo KẾT QUẢ THẬT do đường ghi trả về.
	 *
	 * Không suy từ `http.ResponseWriter`: nó không phơi mã trạng thái đã viết,
	 * nên mọi phép "đoán xem đã 200 chưa" ở đây sẽ luôn ra cùng một câu trả lời
	 * và nhật ký sẽ nói ngược với thực tế — đúng thứ mà truy vết sự cố dựa vào. */
	result := "rejected"
	if applied {
		result = "accepted"
	}
	a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, result)
}
