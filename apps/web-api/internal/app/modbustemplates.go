package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Mẫu thiết bị Modbus dựng sẵn — `T57-3.11` (§6.12-P3).
//
// VÌ SAO CẦN
//
// Khai một slave Modbus là gõ lại bảng thanh ghi từ tài liệu nhà sản xuất: mã
// hàm, địa chỉ, kiểu dữ liệu, thứ tự byte, hệ số. Gõ sai một ô thì thiết bị vẫn
// "chạy" và vẫn trả số — chỉ là số sai, và không có gì trên màn hình gợi ý điều
// đó. Mẫu dựng sẵn biến việc gõ lại thành việc chọn.
//
// LUẬT NỀN: KHÔNG BỊA THÔNG SỐ
//
// Một bảng thanh ghi đoán còn nguy hiểm hơn không có mẫu nào — người dùng tin
// mẫu hơn tin tài liệu. Vì vậy mỗi mẫu **bắt buộc** có trường `source` nói rõ
// nó đến từ đâu; mẫu thiếu `source` bị **loại khỏi danh sách**, không hiển thị.
//
// HAI NGUỒN MẪU
//
//  1. **Dựng sẵn trong binary** — chỉ những mẫu đã kiểm chứng được trên thiết bị
//     thật. Hiện có đúng một: `mtr-1`, đọc từ chính profile đang chạy trên board
//     lab `SOM-DDC-24-foxlinx` ngày 2026-08-19.
//  2. **`<config>/modbus_templates.json`** — do người tích hợp thêm tại hiện
//     trường. Trùng `id` thì bản của người dùng THẮNG: họ có tài liệu của đúng
//     lô thiết bị đang lắp, còn bản dựng sẵn chỉ là điểm khởi đầu.

type ModbusTemplatePoint struct {
	Name      string  `json:"name"`
	FC        int     `json:"fc"`
	Addr      int     `json:"addr"`
	Count     int     `json:"count"`
	Type      string  `json:"type"`
	ByteOrder string  `json:"byte_order,omitempty"`
	Scale     float64 `json:"scale,omitempty"`
	Offset    float64 `json:"offset,omitempty"`
	Unit      string  `json:"unit,omitempty"`
	Writable  bool    `json:"writable,omitempty"`
}

type ModbusTemplate struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Manufacturer string `json:"manufacturer,omitempty"`
	Description  string `json:"description,omitempty"`
	// Source là BẮT BUỘC: mẫu không nói được nó đến từ đâu thì không được hiển thị.
	Source string `json:"source"`
	// Origin: `builtin` | `site`. Giao diện phải phân biệt được hai loại.
	Origin string                `json:"origin"`
	Points []ModbusTemplatePoint `json:"points"`
}

// builtinModbusTemplates — chỉ mẫu đã kiểm chứng trên thiết bị thật.
//
// CỐ Ý RẤT NGẮN. Thà một mẫu có nguồn còn hơn hai mươi mẫu đoán theo tên hãng:
// bảng thanh ghi sai sẽ đọc ra số sai mà không ai nghi ngờ, và sai số đó đi
// thẳng vào lịch sử vận hành.
var builtinModbusTemplates = []ModbusTemplate{
	{
		ID:          "mtr-1",
		Name:        "Đồng hồ điện năng — 1 thanh ghi kWh",
		Description: "Đọc điện năng tích luỹ bằng một cặp thanh ghi holding 32-bit.",
		Source:      "Profile đang chạy trên board lab SOM-DDC-24-foxlinx, đọc ngày 2026-08-19 (/data/config/profiles/mtr-1.json)",
		Origin:      "builtin",
		Points: []ModbusTemplatePoint{
			{Name: "MB-KWH", FC: 3, Addr: 0, Count: 2, Type: "uint32", ByteOrder: "ABCD", Scale: 1, Offset: 0, Writable: false, Unit: "kWh"},
		},
	},
}

func (a *App) handleListModbusTemplates(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.modbusTemplates())
}

func (a *App) modbusTemplates() []ModbusTemplate {
	byID := map[string]ModbusTemplate{}
	for _, template := range builtinModbusTemplates {
		if validModbusTemplate(template) {
			byID[template.ID] = template
		}
	}
	// Mẫu của người tích hợp ghi đè mẫu dựng sẵn cùng `id`: họ có tài liệu của
	// đúng lô thiết bị đang lắp.
	for _, template := range a.siteModbusTemplates() {
		if validModbusTemplate(template) {
			byID[template.ID] = template
		}
	}

	list := make([]ModbusTemplate, 0, len(byID))
	for _, template := range byID {
		list = append(list, template)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	return list
}

func (a *App) siteModbusTemplates() []ModbusTemplate {
	path := a.modbusTemplatesPath()
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var templates []ModbusTemplate
	if err := json.Unmarshal(data, &templates); err != nil {
		/* Tệp hỏng ⇒ bỏ qua toàn bộ tệp thay vì đoán phần đọc được. Một mẫu
		   ghép từ JSON dở dang là đúng thứ mà luật "không bịa" cấm. */
		return nil
	}
	for index := range templates {
		templates[index].Origin = "site"
	}
	return templates
}

func (a *App) modbusTemplatesPath() string {
	dir := strings.TrimSpace(a.cfg.ConfigDir)
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "modbus_templates.json")
}

// validModbusTemplate cưỡng chế luật "không bịa": thiếu `source` hoặc không có
// điểm nào thì mẫu KHÔNG được hiển thị.
func validModbusTemplate(template ModbusTemplate) bool {
	if strings.TrimSpace(template.ID) == "" {
		return false
	}
	if strings.TrimSpace(template.Source) == "" {
		return false
	}
	if len(template.Points) == 0 {
		return false
	}
	for _, point := range template.Points {
		if strings.TrimSpace(point.Name) == "" || point.FC == 0 || point.Count <= 0 {
			return false
		}
	}
	return true
}
