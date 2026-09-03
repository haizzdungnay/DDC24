package configschema

import "encoding/json"

/* Bộ đọc giá trị JSON đã giải mã.
 *
 * `decodeConfigBody` bật `Decoder.UseNumber()`, nên số đến đây là `json.Number`
 * chứ không phải `float64`. Cấu hình ĐỌC TỪ ĐĨA lại đi qua `encoding/json` mặc
 * định và cho `float64`. Hai đường vào cùng một schema, nên bộ đọc phải nhận cả
 * hai — bỏ sót một dạng sẽ làm validator báo "must be number" cho đúng dữ liệu
 * nó vừa tự ghi ra. */

func stringOf(value any) (string, bool) {
	text, ok := value.(string)
	return text, ok
}

// numberOf trả về (giá trị, có mặt, đọc được). Tách "có mặt" khỏi "đọc được" để
// một khoá tồn tại với giá trị sai kiểu không bị nhầm thành khoá vắng mặt.
func numberOf(value any) (float64, bool, bool) {
	if value == nil {
		return 0, false, false
	}
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		return number, true, err == nil
	case float64:
		return typed, true, true
	case float32:
		return float64(typed), true, true
	case int:
		return float64(typed), true, true
	case int64:
		return float64(typed), true, true
	}
	return 0, true, false
}
