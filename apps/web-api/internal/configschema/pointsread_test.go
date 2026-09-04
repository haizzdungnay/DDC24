package configschema_test

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"mkddc-web/internal/capabilities"
	"mkddc-web/internal/configschema"
)

/* ISS-PIO-25 — cổng canh chiều ĐỌC của web-api.
 *
 * TRIỆU CHỨNG đo được trước bản vá: `points.go:addRows` đọc `enabled` và
 * `display_unit` từ hàng ui/ao/do, nhưng `IOCollections` chỉ khai `enabled` cho
 * `ui` và không khai `display_unit` ở đâu cả. Vì `Validate` từ chối khoá lạ, một
 * hàng AO mang đúng khoá mà đường đọc đi tìm bị đường ghi trả
 * 400 `unknown field`. Bộ lọc "điểm đã bật" của ISS-PIO-07 đọc một khoá người
 * dùng không lưu nổi.
 *
 * `TestSchemaCoversEveryFieldTheFirmwareReads` không bắt được ca này: nó đọc
 * `iobus_config.cpp`, còn hai khoá trên do GO đọc, không phải firmware. Cổng này
 * bịt đúng khoảng trống đó — cùng một câu hỏi ("ai đọc khoá này?") nhưng hỏi ở
 * phía Go.
 */

var pointsGoKeyPattern = regexp.MustCompile(`(?:stringField|boolField|intField)\(row, "([a-z_0-9]+)"\)`)

// keysReadByPointsGo lấy đúng các khoá `addRows` đọc từ một hàng io_config.
func keysReadByPointsGo(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile("../app/points.go")
	if err != nil {
		t.Fatalf("đọc points.go: %v", err)
	}
	src := string(raw)
	start := strings.Index(src, "addRows := func(")
	if start < 0 {
		t.Fatal("không tìm thấy addRows trong points.go — cổng này đã mất mục tiêu, sửa regex chứ đừng xoá test")
	}
	end := strings.Index(src[start:], "\n\taddRows(ioCfg.UI")
	if end < 0 {
		t.Fatal("không tìm thấy chỗ gọi addRows(ioCfg.UI ...)")
	}
	body := src[start : start+end]
	seen := map[string]bool{}
	var keys []string
	for _, m := range pointsGoKeyPattern.FindAllStringSubmatch(body, -1) {
		if seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		keys = append(keys, m[1])
	}
	if len(keys) < 5 {
		t.Fatalf("chỉ trích được %d khoá từ addRows (%v) — quá ít, cơ chế trích đã hỏng", len(keys), keys)
	}
	return keys
}

func schemaFieldNames(c configschema.Collection) map[string]bool {
	names := make(map[string]bool, len(c.Fields))
	for _, f := range c.Fields {
		names[f.Name] = true
	}
	return names
}

func ioModeSets() configschema.ModeSets {
	return configschema.ModeSets{UI: capabilities.UIModes, AO: capabilities.AOModes, DO: capabilities.DOModes}
}

func TestSchemaCoversEveryKeyPointsGoReads(t *testing.T) {
	collections := configschema.IOCollections(ioModeSets())
	keys := keysReadByPointsGo(t)

	/* `type` là ngoại lệ CÓ CHỦ, và đúng theo hợp đồng: nó chỉ có nghĩa ở kênh
	 * UI ("0-10V", "none"…). `addRows` đọc nó cho cả ba khối chỉ vì dùng chung
	 * một vòng lặp; với AO/DO nó luôn vắng và signalType ra rỗng. Đưa `type` vào
	 * schema AO/DO sẽ là NHẬN một khoá vô nghĩa, tệ hơn là từ chối nó. */
	uiOnly := map[string]bool{"type": true}

	for _, kind := range []string{"ui", "ao", "do"} {
		names := schemaFieldNames(collections[kind])
		for _, key := range keys {
			if uiOnly[key] && kind != "ui" {
				continue
			}
			if !names[key] {
				t.Errorf("%s: `points.go` ĐỌC khoá %q nhưng schema không khai ⇒ ghi lại chính khoá đó sẽ bị từ chối 400 unknown field", kind, key)
			}
		}
	}
}

// Cơ chế trích phải còn sống: nếu không tìm nổi khoá nào trong addRows thì cổng
// trên sẽ xanh mà không kiểm gì. Test này canh chính cơ chế đó.
func TestPointsGoKeyExtractionStillFindsKnownKeys(t *testing.T) {
	keys := keysReadByPointsGo(t)
	for _, want := range []string{"ch", "tag", "name", "enabled", "display_unit", "note", "equipment", "trend_enabled"} {
		found := false
		for _, key := range keys {
			if key == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("không trích được khoá %q từ addRows — hoặc points.go đã đổi, hoặc regex hỏng; cả hai đều phải xem chứ không phải bỏ qua (trích được: %v)", want, keys)
		}
	}
}
