package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Guard cho hợp đồng đóng băng `contracts/config/schedule_v3_1.schema.json`.
//
// Vì sao cần: hợp đồng được đóng băng ở P0 và KHÔNG có test nào chạm tới nó.
// Nó chỉ được kiểm thủ công một lần, với vài mẫu BINARY. Hậu quả lộ ra khi
// kiểm di trú trên bo Foxlinx (2026-08-07): `$defs/ScheduleValue.value` dùng
// `oneOf` với đồng thời nhánh `number` và nhánh `integer, minimum 0`. Số
// nguyên không âm khớp CẢ HAI, mà `oneOf` đòi khớp đúng một ⇒ hợp đồng loại
// sạch mọi lịch ENUMERATED/UNSIGNED và mọi lịch REAL có setpoint tròn số
// (75, 0). Sáu lịch di trú thật từ bo đều bị từ chối, dù chính phần
// `description` của schema nói chúng hợp lệ.
//
// Lỗi kiểu này không gây lỗi build, không gây lỗi runtime — validator Go giữ
// luật thật nên hệ thống vẫn chạy. Nó chỉ hiện ra khi ai đó thật sự đem hợp
// đồng ra kiểm dữ liệu thật. Test này làm việc đó tự động.
//
// Cố tình KHÔNG kéo một thư viện JSON Schema về: `ajv` chỉ có qua `npx` (cần
// mạng) và Go chưa có thư viện nào trong go.mod. Thay vào đó test đọc thẳng
// cây schema và chặn đúng lớp lỗi — nhánh chồng lấn trong `oneOf`.

func scheduleSchemaPath(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		p := filepath.Join(dir, "contracts", "config", "schedule_v3_1.schema.json")
		if _, err := os.Stat(p); err == nil {
			return p
		}
		dir = filepath.Dir(dir)
	}
	t.Skip("không tìm thấy contracts/config/ — bỏ qua guard hợp đồng lịch")
	return ""
}

func loadScheduleSchema(t *testing.T) map[string]any {
	t.Helper()
	data, err := os.ReadFile(scheduleSchemaPath(t))
	if err != nil {
		t.Fatalf("đọc schema: %v", err)
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatalf("schema không phải JSON hợp lệ: %v", err)
	}
	return root
}

// TestScheduleSchemaOneOfBranchesAreDisjoint chặn `oneOf` có nhánh chồng lấn.
//
// `oneOf` = "khớp ĐÚNG MỘT nhánh". Nếu hai nhánh cùng nhận một giá trị thì giá
// trị đó bị loại — ngược hoàn toàn với ý người viết. Cặp nguy hiểm nhất là
// `number` với `integer`: mọi số nguyên đều là number, nên hai nhánh này KHÔNG
// BAO GIỜ rời nhau. Đúng chỗ này đã hỏng một lần rồi.
func TestScheduleSchemaOneOfBranchesAreDisjoint(t *testing.T) {
	root := loadScheduleSchema(t)
	var problems []string

	var walk func(node any, path string)
	walk = func(node any, path string) {
		switch n := node.(type) {
		case map[string]any:
			if branches, ok := n["oneOf"].([]any); ok {
				types := map[string]int{}
				for _, b := range branches {
					bm, ok := b.(map[string]any)
					if !ok {
						continue
					}
					if ty, ok := bm["type"].(string); ok {
						types[ty]++
					}
				}
				if types["number"] > 0 && types["integer"] > 0 {
					problems = append(problems, fmt.Sprintf(
						"%s: oneOf có cả nhánh \"number\" lẫn \"integer\" — mọi số nguyên khớp cả hai "+
							"nên bị loại; dùng anyOf (luật chéo theo value_type do "+
							"scheduleValueMatchesType giữ)", path))
				}
				for ty, count := range types {
					if count > 1 {
						problems = append(problems, fmt.Sprintf(
							"%s: oneOf có %d nhánh cùng type %q — trùng nhau thì mọi giá trị đều bị loại",
							path, count, ty))
					}
				}
			}
			for k, v := range n {
				walk(v, path+"/"+k)
			}
		case []any:
			for i, v := range n {
				walk(v, fmt.Sprintf("%s[%d]", path, i))
			}
		}
	}
	walk(root, "")

	sort.Strings(problems)
	for _, p := range problems {
		t.Error(p)
	}
}

// TestScheduleSchemaAcceptsEveryValueType kiểm hợp đồng nhận đủ 5 value_type.
//
// Đây là bài kiểm mà lẽ ra phải có từ P0. Nó không chạy một engine JSON Schema
// đầy đủ, chỉ khẳng định: với mỗi value_type mà validator Go chấp nhận, tồn
// tại ít nhất một nhánh trong `anyOf`/`oneOf` của hợp đồng nhận kiểu JSON
// tương ứng. Hai tầng phải cùng nói một thứ.
func TestScheduleSchemaAcceptsEveryValueType(t *testing.T) {
	root := loadScheduleSchema(t)

	defs, ok := root["$defs"].(map[string]any)
	if !ok {
		t.Fatal("schema thiếu $defs")
	}

	// Giá trị đại diện cho từng value_type, gồm cả các ca đã từng lọt lưới:
	// REAL tròn số, ENUMERATED/UNSIGNED số nguyên.
	cases := []struct {
		valueType string
		value     any
		jsonType  string
	}{
		{"BINARY", "ACTIVE", "string"},
		{"BINARY", "INACTIVE", "string"},
		{"BOOLEAN", true, "boolean"},
		{"REAL", 24.5, "number"},
		{"REAL", json.Number("75"), "number"}, // tròn số — ca đã hỏng
		{"REAL", json.Number("0"), "number"},  // schedule_default sau di trú
		{"UNSIGNED", json.Number("3"), "number"},
		{"ENUMERATED", json.Number("2"), "number"},
		{"ENUMERATED", json.Number("0"), "number"},
	}

	for _, defName := range []string{"ScheduleValue", "TimeValue"} {
		def, ok := defs[defName].(map[string]any)
		if !ok {
			t.Fatalf("$defs thiếu %s", defName)
		}
		props, _ := def["properties"].(map[string]any)
		valueProp, _ := props["value"].(map[string]any)
		if valueProp == nil {
			t.Fatalf("%s.properties.value không tồn tại", defName)
		}

		branches, keyword := schemaBranches(valueProp)
		if branches == nil {
			t.Fatalf("%s.value không có anyOf/oneOf", defName)
		}

		accepted := map[string]bool{}
		for _, b := range branches {
			if bm, ok := b.(map[string]any); ok {
				if ty, ok := bm["type"].(string); ok {
					accepted[ty] = true
					if ty == "integer" {
						accepted["number"] = true
					}
				}
			}
		}

		for _, c := range cases {
			if !accepted[c.jsonType] {
				t.Errorf("%s.value (%s) không nhận kiểu JSON %q, nên value_type=%s với giá trị %v "+
					"bị hợp đồng từ chối dù validator Go chấp nhận",
					defName, keyword, c.jsonType, c.valueType, c.value)
			}
			// Đối chứng hai chiều: validator Go phải thật sự chấp nhận giá trị này.
			if !scheduleValueMatchesType(c.value, c.valueType) {
				t.Errorf("scheduleValueMatchesType(%v, %s) = false — mẫu trong test này sai, "+
					"hoặc validator vừa đổi luật mà hợp đồng chưa theo", c.value, c.valueType)
			}
		}
	}
}

func schemaBranches(node map[string]any) ([]any, string) {
	if b, ok := node["anyOf"].([]any); ok {
		return b, "anyOf"
	}
	if b, ok := node["oneOf"].([]any); ok {
		return b, "oneOf"
	}
	return nil, ""
}
