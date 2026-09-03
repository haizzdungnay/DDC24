package configschema

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

const (
	iobusConfigPath     = "../../../../apps/iobus/application/config/iobus_config.cpp"
	safeStateConfigPath = "../../../../apps/core/adapters/config/safe_state_config.cpp"
)

func testModes() ModeSets {
	return ModeSets{
		UI: []string{"none", "0-10V", "2-10V", "4-20mA", "PT100", "PT1000", "NTC10k", "NTC20k", "dry", "potentiometer", "light", "pulse"},
		AO: []string{"0-10V", "4-20mA"},
		DO: []string{"open", "closed"},
	}
}

func fieldNames(collection Collection) map[string]bool {
	names := map[string]bool{}
	for _, field := range collection.Fields {
		names[field.Name] = true
	}
	return names
}

/*
Cổng chống trôi MỘT CHIỀU, và chiều đó là chiều nguy hiểm.

Schema nay TỪ CHỐI khoá lạ. Nếu firmware đọc một khoá mà schema không biết thì
web-api sẽ từ chối chính cấu hình đang chạy thật trên bo — người vận hành mở
trang cấu hình lên, bấm Lưu, và bị chặn với lý do vô nghĩa. Test này đọc THẲNG
mã C++ để chuyện đó là lỗi test chứ không phải sự cố hiện trường.

Chiều ngược lại KHÔNG kiểm: schema có quyền biết những trường mà firmware không
đọc (`note`, `equipment`, `tag`, `trend_enabled` là của tầng web).
*/
func TestSchemaCoversEveryFieldTheFirmwareReads(t *testing.T) {
	raw, err := os.ReadFile(iobusConfigPath)
	if err != nil {
		t.Fatalf("không đọc được %s: %v", iobusConfigPath, err)
	}
	source := string(raw)
	collections := IOCollections(testModes())

	for _, tc := range []struct {
		block      string
		collection string
	}{{"ui", "ui"}, {"ao", "ao"}} {
		known := fieldNames(collections[tc.collection])
		for _, key := range entryKeysRead(t, source, tc.block) {
			if !known[key] {
				t.Fatalf("iobus_config.cpp đọc `%s[].%s` nhưng schema không khai — validator nghiêm ngặt sẽ từ chối cấu hình thật", tc.block, key)
			}
		}
	}

	safeRaw, err := os.ReadFile(safeStateConfigPath)
	if err != nil {
		t.Fatalf("không đọc được %s: %v", safeStateConfigPath, err)
	}
	// `safe_state_config.cpp` đọc TỪ CẢ HAI tệp: `load_ao_modes` lấy `ch`/`mode`
	// từ `io_config.conf` để biết mode thật của kênh, phần còn lại lấy
	// `ch`/`safe` từ `safe_state.conf`. Nên đối chiếu với HỢP của hai schema —
	// tách ra sẽ báo sai ở `mode`.
	safe := SafeStateCollections(testModes())
	known := map[string]bool{}
	for _, collection := range []Collection{safe["ao"], safe["do"], collections["ao"], collections["do"]} {
		for name := range fieldNames(collection) {
			known[name] = true
		}
	}
	for _, key := range coreEntryKeys(string(safeRaw)) {
		if !known[key] {
			t.Fatalf("safe_state_config.cpp đọc `%s` nhưng không schema nào khai", key)
		}
	}
}

// Bằng chứng cổng trên THẬT SỰ bắt được trôi: tiêm một khoá mới vào bản sao mã
// C++ rồi khẳng định bộ trích xuất nhìn thấy nó. Một cổng không có tiêm lỗi có
// thể ngừng kiểm mà vẫn xanh.
func TestDriftGateSeesANewlyReadField(t *testing.T) {
	raw, err := os.ReadFile(iobusConfigPath)
	if err != nil {
		t.Fatalf("không đọc được %s: %v", iobusConfigPath, err)
	}
	mutated := strings.Replace(string(raw),
		`if (get_float(entry, "scale_lo", &f)) out->ui[i].scale_lo = f;`,
		`if (get_float(entry, "scale_lo", &f)) out->ui[i].scale_lo = f;
            if (get_float(entry, "khoa_moi_chua_ai_khai", &f)) out->ui[i].scale_lo = f;`, 1)
	if mutated == string(raw) {
		t.Fatalf("không tiêm được: dòng đọc scale_lo trong iobus_config.cpp đã đổi dạng")
	}
	found := false
	for _, key := range entryKeysRead(t, mutated, "ui") {
		if key == "khoa_moi_chua_ai_khai" {
			found = true
		}
	}
	if !found {
		t.Fatalf("tiêm khoá mới rồi mà bộ trích xuất không thấy — cổng chống trôi đã ngừng kiểm")
	}
}

var entryKeyPattern = regexp.MustCompile(`get_(?:string|bool|float|int|uint)\(entry,\s*"([a-z_0-9]+)"`)

// Chỉ khớp `e->get("...")` — tức khoá đọc trên MỘT PHẦN TỬ. `root->get("ao")`
// là tên collection, không phải tên trường, và gộp hai thứ đó lại sẽ làm cổng
// báo sai ngay từ lần chạy đầu.
var coreKeyPattern = regexp.MustCompile(`\be->get\("([a-z_0-9]+)"\)`)

// entryKeysRead lấy các khoá mà C++ đọc trong khối `if (get_array(s, "<block>"`.
func entryKeysRead(t *testing.T, source string, block string) []string {
	t.Helper()
	marker := `get_array(s, "` + block + `"`
	start := strings.Index(source, marker)
	if start < 0 {
		t.Fatalf("không tìm thấy khối đọc `%s[]` trong iobus_config.cpp — bộ trích xuất đã lạc hậu", block)
	}
	rest := source[start+len(marker):]
	if next := strings.Index(rest, "get_array(s, \""); next >= 0 {
		rest = rest[:next]
	}
	var keys []string
	for _, match := range entryKeyPattern.FindAllStringSubmatch(rest, -1) {
		keys = append(keys, match[1])
	}
	if len(keys) == 0 {
		t.Fatalf("không trích được khoá nào từ khối `%s[]` — bộ trích xuất hỏng", block)
	}
	return keys
}

func coreEntryKeys(source string) []string {
	var keys []string
	seen := map[string]bool{}
	for _, match := range coreKeyPattern.FindAllStringSubmatch(source, -1) {
		if !seen[match[1]] {
			seen[match[1]] = true
			keys = append(keys, match[1])
		}
	}
	return keys
}

func messagesFor(errs []Error) map[string]string {
	out := map[string]string{}
	for _, item := range errs {
		out[item.Path] = item.Message
	}
	return out
}

func jsonRow(t *testing.T, text string) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	var row map[string]any
	if err := decoder.Decode(&row); err != nil {
		t.Fatalf("fixture hỏng: %v", err)
	}
	return row
}

// Điều `ISS-PIO-27` thật sự thêm vào: khoá gõ sai không còn đi lọt xuống đĩa rồi
// nằm im tới lần `iobus` khởi động lại.
func TestUnknownKeyIsRejected(t *testing.T) {
	ui := IOCollections(testModes())["ui"]
	row := jsonRow(t, `{"ch":1,"type":"0-10V","scale_high":100}`)
	errs := Validate(ui, []map[string]any{row}, Bounds{MaxChannel: 16})
	messages := messagesFor(errs)
	if messages["ui[0].scale_high"] == "" {
		t.Fatalf("khoá lạ `scale_high` đi lọt: %#v", messages)
	}
	// Và KHÔNG được báo kèm "thiếu scale_hi": báo đúng cái sai giúp sửa nhanh
	// hơn hẳn báo hệ quả của nó.
	if messages["ui[0].scale_hi"] != "" {
		t.Fatalf("báo nhầm thành thiếu trường: %#v", messages)
	}
}

// Hai trường hiệu chuẩn mà firmware đọc thật nhưng validator Go trước đây không
// biết. Nếu schema quên chúng, cấu hình có hiệu chuẩn sẽ bị từ chối.
func TestCalibrationFieldsAreAccepted(t *testing.T) {
	ui := IOCollections(testModes())["ui"]
	row := jsonRow(t, `{"ch":1,"type":"0-10V","cal_gain":1.02,"cal_offset":-0.4}`)
	if errs := Validate(ui, []map[string]any{row}, Bounds{MaxChannel: 16}); len(errs) != 0 {
		t.Fatalf("trường hiệu chuẩn bị từ chối: %#v", errs)
	}
}

func TestFieldTypeRangeAndEnum(t *testing.T) {
	ui := IOCollections(testModes())["ui"]
	row := jsonRow(t, `{"ch":1,"type":"0-5V","range_mult":9,"filter_samples":"ba","enabled":"yes","sensor_cal":40}`)
	messages := messagesFor(Validate(ui, []map[string]any{row}, Bounds{MaxChannel: 16}))
	for path, want := range map[string]string{
		"ui[0].type":           "must be one of",
		"ui[0].range_mult":     "must be integer in range 0..5",
		"ui[0].filter_samples": "must be integer in range 0..100",
		"ui[0].enabled":        "must be boolean",
		"ui[0].sensor_cal":     "must be number in range -12.7..12.8",
	} {
		if !strings.Contains(messages[path], want) {
			t.Fatalf("%s = %q; muốn chứa %q", path, messages[path], want)
		}
	}
}

func TestRequiredAndCrossFieldRules(t *testing.T) {
	ui := IOCollections(testModes())["ui"]
	row := jsonRow(t, `{"type":"0-10V","scale_lo":100,"scale_hi":10}`)
	messages := messagesFor(Validate(ui, []map[string]any{row}, Bounds{MaxChannel: 16}))
	if messages["ui[0].ch"] != "is required" {
		t.Fatalf("thiếu `ch` không bị bắt: %#v", messages)
	}
	if messages["ui[0].scale_hi"] != "must be greater than scale_lo" {
		t.Fatalf("ràng buộc liên trường không chạy: %#v", messages)
	}
}

// Trần kênh đến từ NĂNG LỰC BO, không từ hằng viết cứng — đó là toàn bộ ý nghĩa
// của "validate theo capability".
func TestChannelCeilingComesFromBounds(t *testing.T) {
	ui := IOCollections(testModes())["ui"]
	row := jsonRow(t, `{"ch":9,"type":"0-10V"}`)
	if errs := Validate(ui, []map[string]any{row}, Bounds{MaxChannel: 16}); len(errs) != 0 {
		t.Fatalf("kênh 9 hợp lệ trên bo 16 kênh mà bị từ chối: %#v", errs)
	}
	messages := messagesFor(Validate(ui, []map[string]any{row}, Bounds{MaxChannel: 8}))
	if messages["ui[0].ch"] != "must be integer in range 1..8" {
		t.Fatalf("trần kênh không theo Bounds: %#v", messages)
	}
}

// Bo nói rõ KHÔNG có khối kênh này ⇒ từ chối cả hàng, kèm lý do. Từ chối mà
// không nói được vì sao là cách nhanh nhất để người vận hành nghĩ hệ thống hỏng.
func TestAbsentBlockRejectsRowsWithAReason(t *testing.T) {
	ao := IOCollections(testModes())["ao"]
	row := jsonRow(t, `{"ch":1,"mode":"0-10V"}`)
	errs := Validate(ao, []map[string]any{row}, Bounds{MaxChannel: 0, AbsentReason: "bo không có khối AO"})
	if len(errs) != 1 || errs[0].Path != "ao[0]" || errs[0].Message != "bo không có khối AO" {
		t.Fatalf("khối vắng mặt không bị từ chối đúng cách: %#v", errs)
	}
}

// Số vào từ HTTP là `json.Number` (`decoder.UseNumber()`), còn số đọc từ đĩa là
// `float64`. Bỏ sót một dạng sẽ làm validator báo "must be number" cho đúng dữ
// liệu nó vừa tự ghi ra.
func TestAcceptsBothNumberRepresentations(t *testing.T) {
	ui := IOCollections(testModes())["ui"]
	fromHTTP := jsonRow(t, `{"ch":1,"type":"0-10V","scale_lo":0,"scale_hi":100}`)
	fromDisk := map[string]any{"ch": float64(1), "type": "0-10V", "scale_lo": float64(0), "scale_hi": float64(100)}
	for name, row := range map[string]map[string]any{"http": fromHTTP, "disk": fromDisk} {
		if errs := Validate(ui, []map[string]any{row}, Bounds{MaxChannel: 16}); len(errs) != 0 {
			t.Fatalf("nguồn %s bị từ chối: %#v", name, errs)
		}
	}
}
