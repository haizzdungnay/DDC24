// Package configschema là SCHEMA CÓ KIỂU của `io_config.conf` và
// `safe_state.conf` — mô tả một lần, ở một chỗ, mọi trường mà bất kỳ tiến trình
// nào trong hệ thống đọc từ hai tệp đó.
//
// `ISS-PIO-27`/`F-PIO-013`: trước gói này, hình dạng của `ConfigIO` chỉ tồn tại
// dưới dạng `[]map[string]any` cộng với một chuỗi lệnh `if` viết tay trong
// `configapi.go`. Hai hệ quả:
//
//   - **Gõ sai tên khoá đi lọt.** `scale_hi` gõ thành `scale_high` được nhận,
//     ghi xuống đĩa, và chỉ lộ ra khi `iobus` khởi động lại rồi lặng lẽ dùng
//     giá trị mặc định. Đúng cái mà issue mô tả: *"lỗi cấu hình chỉ lộ khi core
//     khởi động lại"*.
//   - **Không ai biết tập trường đầy đủ.** `cal_gain`/`cal_offset` được
//     `iobus_config.cpp` đọc thật nhưng **không** có trong validator Go —
//     `TestSchemaCoversEveryFieldTheFirmwareReads` bây giờ đọc thẳng mã C++ và
//     bắt lỗi đó nếu nó tái diễn.
//
// VÌ SAO VẪN LÀ `[]map[string]any` Ở TẦNG LƯU TRỮ, không phải struct Go: một
// struct chỉ giữ những trường nó khai, nên MỌI khoá không được mô hình hoá sẽ bị
// **xoá âm thầm** ở lần ghi kế tiếp. Với `cal_gain`/`cal_offset` — hai trường
// hiệu chuẩn mà firmware đọc còn Go thì chưa từng biết — đổi sang struct đúng
// vào lúc này sẽ *gây ra* chính loại mất dữ liệu mà issue muốn chặn. Schema ở
// đây mới là thẩm quyền; map chỉ là phương tiện chuyên chở, và nó chuyên chở cả
// những trường mà một struct sẽ đánh rơi. Khi nào cổng chống trôi bên dưới đã
// chạy đủ lâu để danh sách trường được coi là đầy đủ thì việc đổi sang struct
// mới an toàn — và schema này chính là đầu vào của bước đó.
package configschema

import (
	"fmt"
	"math"
	"strings"
)

type Kind int

const (
	KindString Kind = iota
	KindNumber
	KindInt
	KindBool
)

// Field mô tả MỘT khoá trong một hàng cấu hình.
type Field struct {
	Name     string
	Kind     Kind
	Required bool
	// Enum chỉ có nghĩa với KindString. Rỗng = nhận mọi chuỗi.
	Enum []string
	// Min/Max chỉ có nghĩa với KindNumber/KindInt. Nil = không chặn.
	Min *float64
	Max *float64
	// ReadBy ghi nơi THẬT SỰ đọc trường này. Đây không phải chú thích trang
	// trí: cổng chống trôi dùng nó để giải thích vì sao một trường tồn tại, và
	// một trường không ai đọc là một trường đáng ngờ.
	ReadBy []string
}

// Rule là ràng buộc LIÊN TRƯỜNG, thứ mà bảng Field không diễn đạt được.
type Rule struct {
	// Path là khoá bị báo lỗi khi ràng buộc gãy.
	Path  string
	Check func(row map[string]any) (message string, failed bool)
}

type Collection struct {
	Name   string
	Fields []Field
	Rules  []Rule
}

type Error struct {
	Path    string
	Message string
}

func num(value float64) *float64 { return &value }

// uiModes/aoModes/doSafeModes được `app` truyền vào lúc dựng schema để enum của
// validator và enum mà `/system/capabilities` công bố **là cùng một biến** —
// hai danh sách chép tay cạnh nhau sẽ lệch, và khi lệch thì FE hoặc mời chọn một
// mode bị từ chối, hoặc giấu mất một mode hợp lệ.
type ModeSets struct {
	UI []string
	AO []string
	DO []string
}

// Các trường định danh/metadata điểm mà tầng web ghi lên MỌI hàng, bất kể loại
// kênh. Chúng không được firmware đọc nhưng vẫn phải nằm trong schema: thiếu
// chúng thì validator nghiêm ngặt sẽ từ chối chính cấu hình mà web vừa ghi ra.
func pointMetadataFields() []Field {
	return []Field{
		{Name: "id", Kind: KindString, ReadBy: []string{"iobus_config.cpp:entry_index (bí danh cũ của ch)"}},
		{Name: "tag", Kind: KindString, ReadBy: []string{"web-api: pointtags.go"}},
		{Name: "name", Kind: KindString, ReadBy: []string{"web-api: pointtags.go", "iobus_config.cpp (chỉ AO)"}},
		{Name: "note", Kind: KindString, ReadBy: []string{"web-ui"}},
		{Name: "equipment", Kind: KindString, ReadBy: []string{"web-api: pointconfig.go"}},
		{Name: "trend_enabled", Kind: KindBool, ReadBy: []string{"web-api: historian_policy.go"}},
		/* `enabled` và `display_unit`: ĐỌC bởi `points.go:addRows` cho CẢ BA khối
		 * ui/ao/do, nhưng trước `ISS-PIO-25` schema chỉ khai `enabled` ở `ui` và
		 * không khai `display_unit` ở đâu cả.
		 *
		 * Hệ quả đo được: một hàng AO/DO mang `enabled` — đúng khoá mà đường đọc
		 * đi tìm — bị đường ghi trả 400 `unknown field`. Tức là bộ lọc "điểm đã
		 * bật" của `ISS-PIO-07` đọc một khoá mà người dùng KHÔNG lưu nổi, và
		 * `display_unit` thì không lưu được ở bất kỳ khối nào.
		 *
		 * Bên nào đúng: đường ĐỌC. Cả hai đều là metadata trình bày hợp lệ cho
		 * mọi khối kênh, y hệt `note`/`equipment` ngay phía trên. Firmware không
		 * đọc chúng, nên chúng nằm ở đây chứ không phải trong danh sách C++. */
		{Name: "enabled", Kind: KindBool, ReadBy: []string{"web-api: points.go:addRows", "iobus_config.cpp (chỉ UI)"}},
		{Name: "display_unit", Kind: KindString, ReadBy: []string{"web-api: points.go:addRows"}},
	}
}

func channelField(readBy ...string) Field {
	return Field{Name: "ch", Kind: KindInt, Required: true, Min: num(1), ReadBy: readBy}
}

// IOCollections trả về schema của `io_config.conf`.
func IOCollections(modes ModeSets) map[string]Collection {
	ui := Collection{Name: "ui"}
	ui.Fields = append(ui.Fields,
		channelField("iobus_config.cpp:entry_index"),
		Field{Name: "type", Kind: KindString, Required: true, Enum: modes.UI, ReadBy: []string{"iobus_config.cpp:sensor_type_from_string"}},
		Field{Name: "sensor_type", Kind: KindString, Enum: modes.UI, ReadBy: []string{"iobus_config.cpp (bí danh cũ của type)"}},
		Field{Name: "unit", Kind: KindString, ReadBy: []string{"iobus_config.cpp"}},
		// `enabled` nay do `pointMetadataFields()` cấp cho cả ba khối — khai lại ở
		// đây sẽ thành hai Field cùng tên trong một Collection.
		Field{Name: "invert", Kind: KindBool, ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "scale_lo", Kind: KindNumber, ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "scale_hi", Kind: KindNumber, ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "sensor_cal", Kind: KindNumber, Min: num(-12.7), Max: num(12.8), ReadBy: []string{"iobus_config.cpp"}},
		// `cal_gain`/`cal_offset`: firmware đọc thật (`iobus_config.cpp`) nhưng
		// validator Go trước đây KHÔNG biết. Chúng có mặt ở đây chính là bằng
		// chứng cho lý do gói này giữ map thay vì struct.
		Field{Name: "cal_gain", Kind: KindNumber, ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "cal_offset", Kind: KindNumber, ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "range_mult", Kind: KindInt, Min: num(0), Max: num(5), ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "filter_samples", Kind: KindInt, Min: num(0), Max: num(100), ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "math_func", Kind: KindInt, Min: num(0), Max: num(3), ReadBy: []string{"iobus_config.cpp"}},
	)
	ui.Fields = append(ui.Fields, pointMetadataFields()...)
	ui.Rules = []Rule{orderedPair("scale_lo", "scale_hi", "must be greater than scale_lo")}

	ao := Collection{Name: "ao"}
	ao.Fields = append(ao.Fields,
		channelField("iobus_config.cpp:entry_index"),
		Field{Name: "mode", Kind: KindString, Required: true, Enum: modes.AO, ReadBy: []string{"iobus_config.cpp", "safe_state_config.cpp:load_ao_modes"}},
		Field{Name: "units", Kind: KindString, Enum: []string{"percent", "volt", "milliampere", "degC", "Pa", "RPM", "ppm", "no_units"}, ReadBy: []string{"iobus_config.cpp:valid_ao_units"}},
		Field{Name: "min_pv", Kind: KindNumber, ReadBy: []string{"iobus_config.cpp"}},
		Field{Name: "max_pv", Kind: KindNumber, ReadBy: []string{"iobus_config.cpp"}},
	)
	ao.Fields = append(ao.Fields, pointMetadataFields()...)
	ao.Rules = []Rule{orderedPair("min_pv", "max_pv", "must be greater than min_pv")}

	do := Collection{Name: "do"}
	do.Fields = append(do.Fields, channelField("web-api"))
	do.Fields = append(do.Fields, pointMetadataFields()...)

	return map[string]Collection{"ui": ui, "ao": ao, "do": do}
}

// SafeStateCollections trả về schema của `safe_state.conf`.
func SafeStateCollections(modes ModeSets) map[string]Collection {
	ao := Collection{Name: "ao", Fields: []Field{
		channelField("safe_state_config.cpp"),
		// Dải 0..20 là hợp của cả hai mode (0-10 V và 4-20 mA). Ràng buộc CHẶT
		// theo mode thật của kênh nằm ở `safe_state_config.cpp` phía Core, nơi
		// biết `io_config.conf` nói kênh đó đang chạy mode nào — schema này
		// không đọc chéo tệp nên không được giả vờ là biết.
		{Name: "safe", Kind: KindNumber, Required: true, Min: num(0), Max: num(20), ReadBy: []string{"safe_state_config.cpp"}},
	}}
	do := Collection{Name: "do", Fields: []Field{
		channelField("safe_state_config.cpp"),
		{Name: "safe", Kind: KindString, Required: true, Enum: modes.DO, ReadBy: []string{"safe_state_config.cpp"}},
	}}
	return map[string]Collection{"ao": ao, "do": do}
}

func orderedPair(lowKey, highKey, message string) Rule {
	return Rule{Path: highKey, Check: func(row map[string]any) (string, bool) {
		low, hasLow, okLow := numberOf(row[lowKey])
		high, hasHigh, okHigh := numberOf(row[highKey])
		if !hasLow || !hasHigh || !okLow || !okHigh {
			return "", false
		}
		return message, high <= low
	}}
}

// Bounds là trần kênh của một collection, do NĂNG LỰC BO quyết định.
type Bounds struct {
	// MaxChannel là kênh lớn nhất được phép. 0 nghĩa là khối kênh này KHÔNG tồn
	// tại trên bo.
	MaxChannel int
	// AbsentReason giải thích vì sao MaxChannel = 0. Bắt buộc phải có khi
	// MaxChannel = 0: từ chối một cấu hình mà không nói được vì sao là cách
	// nhanh nhất để người vận hành nghĩ hệ thống hỏng.
	AbsentReason string
}

// Validate kiểm một collection theo schema.
//
// Ba lớp kiểm, theo thứ tự: khoá lạ → kiểu/dải/enum từng trường → ràng buộc
// liên trường. Khoá lạ đứng TRƯỚC vì `scale_high` gõ sai không nên báo là
// "thiếu scale_hi" — báo đúng cái sai giúp sửa nhanh hơn hẳn báo hệ quả của nó.
func Validate(collection Collection, rows []map[string]any, bounds Bounds) []Error {
	var errs []Error
	known := make(map[string]Field, len(collection.Fields))
	for _, field := range collection.Fields {
		known[field.Name] = field
	}
	for index, row := range rows {
		base := fmt.Sprintf("%s[%d]", collection.Name, index)
		if bounds.MaxChannel == 0 {
			errs = append(errs, Error{Path: base, Message: bounds.AbsentReason})
			continue
		}
		for _, key := range sortedKeys(row) {
			if _, ok := known[key]; !ok {
				errs = append(errs, Error{Path: base + "." + key, Message: "unknown field; not in ConfigIO schema"})
			}
		}
		for _, field := range collection.Fields {
			errs = append(errs, validateField(base, field, row, bounds)...)
		}
		for _, rule := range collection.Rules {
			if message, failed := rule.Check(row); failed {
				errs = append(errs, Error{Path: base + "." + rule.Path, Message: message})
			}
		}
	}
	return errs
}

func validateField(base string, field Field, row map[string]any, bounds Bounds) []Error {
	path := base + "." + field.Name
	raw, present := row[field.Name]
	if !present {
		if field.Required {
			return []Error{{Path: path, Message: "is required"}}
		}
		return nil
	}
	switch field.Kind {
	case KindString:
		value, ok := stringOf(raw)
		if !ok {
			return []Error{{Path: path, Message: "must be string"}}
		}
		if len(field.Enum) > 0 && !contains(field.Enum, value) {
			return []Error{{Path: path, Message: "must be one of " + strings.Join(field.Enum, ", ")}}
		}
	case KindBool:
		if _, ok := raw.(bool); !ok {
			return []Error{{Path: path, Message: "must be boolean"}}
		}
	case KindInt:
		value, _, ok := numberOf(raw)
		if !ok || value != math.Trunc(value) {
			return []Error{{Path: path, Message: intRangeMessage(field, bounds)}}
		}
		if outOfRange(field, value, bounds) {
			return []Error{{Path: path, Message: intRangeMessage(field, bounds)}}
		}
	case KindNumber:
		value, _, ok := numberOf(raw)
		if !ok {
			return []Error{{Path: path, Message: numberMessage(field)}}
		}
		if outOfRange(field, value, bounds) {
			return []Error{{Path: path, Message: numberMessage(field)}}
		}
	}
	return nil
}

// Trần kênh của trường `ch` đến từ năng lực bo chứ không phải một hằng viết
// cứng: đó là toàn bộ ý nghĩa của "validate theo capability" trong `ISS-PIO-27`.
func effectiveMax(field Field, bounds Bounds) *float64 {
	if field.Name == "ch" {
		return num(float64(bounds.MaxChannel))
	}
	return field.Max
}

func outOfRange(field Field, value float64, bounds Bounds) bool {
	if field.Min != nil && value < *field.Min {
		return true
	}
	if max := effectiveMax(field, bounds); max != nil && value > *max {
		return true
	}
	return false
}

func intRangeMessage(field Field, bounds Bounds) string {
	min, max := field.Min, effectiveMax(field, bounds)
	if min != nil && max != nil {
		return fmt.Sprintf("must be integer in range %d..%d", int(*min), int(*max))
	}
	return "must be integer"
}

func numberMessage(field Field) string {
	if field.Min != nil && field.Max != nil {
		return fmt.Sprintf("must be number in range %s..%s", trimFloat(*field.Min), trimFloat(*field.Max))
	}
	return "must be number"
}

func trimFloat(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.10f", value), "0"), ".")
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func sortedKeys(row map[string]any) []string {
	keys := make([]string, 0, len(row))
	for key := range row {
		keys = append(keys, key)
	}
	// Thứ tự ổn định để thông báo lỗi không đổi giữa hai lần chạy cùng dữ liệu.
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}
