package modbusrtu

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// Cột CSV của Point (Đ-06: bắt buộc có CẢ CSV và JSON).
//
// CSV dùng ở hiện trường vì mở được bằng Excel trên laptop không có internet;
// JSON dùng để round-trip đầy đủ cấu hình. Thứ tự cột là một phần của hợp đồng:
// đổi thứ tự làm mọi file khách hàng đã xuất trước đó không import lại được.
var pointCSVHeader = []string{
	"point_id", "device_id", "tag_name", "display_name", "register_type", "address",
	"data_type", "byte_order", "word_order", "scale", "offset", "unit", "read_write",
	"default_value", "safe_value", "enabled", "bit_index", "min_value", "max_value",
}

// ExportPointsCSV ghi danh sách Point ra CSV.
func ExportPointsCSV(w io.Writer, points []Point) error {
	writer := csv.NewWriter(w)
	if err := writer.Write(pointCSVHeader); err != nil {
		return err
	}
	sorted := append([]Point(nil), points...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return strings.ToLower(sorted[i].PointID) < strings.ToLower(sorted[j].PointID)
	})
	for _, p := range sorted {
		p = NormalizePoint(p)
		row := []string{
			p.PointID, p.DeviceID, p.TagName, p.DisplayName, p.RegisterType,
			strconv.Itoa(p.Address), p.DataType, p.ByteOrder, p.WordOrder,
			formatFloat(p.Scale), formatFloat(p.Offset), p.Unit, p.ReadWrite,
			formatAny(p.DefaultValue), formatAny(p.SafeValue), strconv.FormatBool(p.Enabled),
			formatIntPtr(p.BitIndex), formatFloatPtr(p.MinValue), formatFloatPtr(p.MaxValue),
		}
		if err := writer.Write(row); err != nil {
			return err
		}
	}
	writer.Flush()
	return writer.Error()
}

// ImportError mang số dòng để người dùng sửa đúng chỗ trong file của họ.
type ImportError struct {
	Line    int    `json:"line"`
	Column  string `json:"column,omitempty"`
	Message string `json:"message"`
}

// ImportPointsCSV đọc CSV thành danh sách Point.
//
// ALL-OR-NOTHING (Đ-06): một dòng sai là TOÀN BỘ file bị từ chối. Import một
// phần tạo ra trạng thái mà người dùng không mô tả được — họ tưởng đã nạp 200
// điểm, thực tế 173 điểm nạp và 27 điểm im lặng biến mất, và không có cách nào
// biết điểm nào thiếu ngoài việc dò tay.
func ImportPointsCSV(r io.Reader) ([]Point, []ImportError) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		return nil, []ImportError{{Line: 0, Message: "không đọc được CSV: " + err.Error()}}
	}
	if len(records) == 0 {
		return nil, []ImportError{{Line: 0, Message: "file rỗng"}}
	}

	header := records[0]
	index := map[string]int{}
	for i, name := range header {
		index[strings.ToLower(strings.TrimSpace(name))] = i
	}
	var errs []ImportError
	for _, required := range []string{"point_id", "device_id", "tag_name", "register_type", "address", "data_type"} {
		if _, ok := index[required]; !ok {
			errs = append(errs, ImportError{Line: 1, Column: required, Message: "thiếu cột bắt buộc"})
		}
	}
	if len(errs) > 0 {
		return nil, errs
	}

	get := func(row []string, name string) string {
		i, ok := index[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	out := make([]Point, 0, len(records)-1)
	for lineIdx, row := range records[1:] {
		line := lineIdx + 2 // 1-based, cộng dòng header
		if len(row) == 0 || strings.TrimSpace(strings.Join(row, "")) == "" {
			continue
		}
		point := Point{
			PointID:      get(row, "point_id"),
			DeviceID:     get(row, "device_id"),
			TagName:      get(row, "tag_name"),
			DisplayName:  get(row, "display_name"),
			RegisterType: get(row, "register_type"),
			DataType:     get(row, "data_type"),
			ByteOrder:    get(row, "byte_order"),
			WordOrder:    get(row, "word_order"),
			Unit:         get(row, "unit"),
			ReadWrite:    get(row, "read_write"),
			Enabled:      true,
		}
		if point.DisplayName == "" {
			point.DisplayName = point.TagName
		}
		address, err := strconv.Atoi(get(row, "address"))
		if err != nil {
			errs = append(errs, ImportError{Line: line, Column: "address", Message: "phải là số nguyên"})
		}
		point.Address = address

		point.Scale = 1
		if raw := get(row, "scale"); raw != "" {
			value, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				errs = append(errs, ImportError{Line: line, Column: "scale", Message: "phải là số"})
			} else {
				point.Scale = value
			}
		}
		if raw := get(row, "offset"); raw != "" {
			value, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				errs = append(errs, ImportError{Line: line, Column: "offset", Message: "phải là số"})
			} else {
				point.Offset = value
			}
		}
		if raw := get(row, "enabled"); raw != "" {
			value, err := strconv.ParseBool(raw)
			if err != nil {
				errs = append(errs, ImportError{Line: line, Column: "enabled", Message: "phải là true/false"})
			} else {
				point.Enabled = value
			}
		}
		if raw := get(row, "bit_index"); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil {
				errs = append(errs, ImportError{Line: line, Column: "bit_index", Message: "phải là số nguyên"})
			} else {
				point.BitIndex = &value
			}
		}
		if raw := get(row, "min_value"); raw != "" {
			value, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				errs = append(errs, ImportError{Line: line, Column: "min_value", Message: "phải là số"})
			} else {
				point.MinValue = &value
			}
		}
		if raw := get(row, "max_value"); raw != "" {
			value, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				errs = append(errs, ImportError{Line: line, Column: "max_value", Message: "phải là số"})
			} else {
				point.MaxValue = &value
			}
		}
		if raw := get(row, "default_value"); raw != "" {
			if value, err := strconv.ParseFloat(raw, 64); err == nil {
				point.DefaultValue = value
			}
		}
		if raw := get(row, "safe_value"); raw != "" {
			if value, err := strconv.ParseFloat(raw, 64); err == nil {
				point.SafeValue = value
			}
		}
		out = append(out, NormalizePoint(point))
	}
	if len(errs) > 0 {
		return nil, errs
	}
	return out, nil
}

// ConfigExport là dạng JSON round-trip đầy đủ.
type ConfigExport struct {
	SchemaVersion int      `json:"schema_version"`
	Revision      uint64   `json:"revision"`
	Checksum      string   `json:"checksum"`
	Buses         []Bus    `json:"buses"`
	Devices       []Device `json:"devices"`
	Points        []Point  `json:"points"`
}

const ExportSchemaVersion = 2

func ExportConfigJSON(cfg Config) ([]byte, error) {
	buses, _ := MigrateBuses(cfg)
	export := ConfigExport{
		SchemaVersion: ExportSchemaVersion,
		Revision:      cfg.Revision,
		Checksum:      cfg.Checksum,
		Buses:         buses,
		Devices:       cfg.Devices,
		Points:        cfg.Points,
	}
	data, err := json.MarshalIndent(export, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

// ImportConfigJSON đọc bản export đầy đủ.
//
// Từ chối schema lạ thay vì cố đoán: một file của phiên bản sau có thể mang
// trường mà bản này không hiểu, và bỏ qua trường đó là im lặng đánh mất cấu
// hình người dùng tưởng đã nạp.
func ImportConfigJSON(raw []byte) (ConfigExport, []ImportError) {
	var export ConfigExport
	if err := json.Unmarshal(raw, &export); err != nil {
		return ConfigExport{}, []ImportError{{Message: "JSON không hợp lệ: " + err.Error()}}
	}
	if export.SchemaVersion == 0 {
		return ConfigExport{}, []ImportError{{Message: "thiếu schema_version"}}
	}
	if export.SchemaVersion > ExportSchemaVersion {
		return ConfigExport{}, []ImportError{{Message: fmt.Sprintf(
			"schema_version %d mới hơn bản hỗ trợ (%d); hãy nâng cấp phần mềm trước khi import",
			export.SchemaVersion, ExportSchemaVersion)}}
	}
	for i := range export.Buses {
		export.Buses[i] = NormalizeBus(export.Buses[i])
	}
	for i := range export.Devices {
		export.Devices[i] = NormalizeDevice(export.Devices[i])
	}
	for i := range export.Points {
		export.Points[i] = NormalizePoint(export.Points[i])
	}
	return export, nil
}

func formatFloat(v float64) string { return strconv.FormatFloat(v, 'g', -1, 64) }

func formatFloatPtr(v *float64) string {
	if v == nil {
		return ""
	}
	return formatFloat(*v)
}

func formatIntPtr(v *int) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(*v)
}

func formatAny(v any) string {
	if v == nil {
		return ""
	}
	switch typed := v.(type) {
	case float64:
		return formatFloat(typed)
	case string:
		return typed
	}
	return fmt.Sprint(v)
}
