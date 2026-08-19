package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Tóm tắt khác biệt cấu hình cho nhật ký hoạt động — `T57-3.14` (§6.5-P3).
//
// VÌ SAO
//
// Vết audit hiện tại nói "user X đã sửa `io_config.conf` lúc 14:03, kết quả
// success". Khi điều tra một sự cố, câu hỏi luôn là **sửa cái gì** — và trước
// đây câu trả lời chỉ lấy được bằng cách so hai bản sao lưu, nếu còn bản sao lưu.
//
// BA RÀNG BUỘC QUYẾT ĐỊNH THIẾT KẾ
//
//  1. **Ngắn.** Nhật ký hoạt động là vòng nhớ 2000 sự kiện; nhét cả tệp cấu
//     hình vào một sự kiện là đẩy hàng chục sự kiện khác ra khỏi vòng. Tóm tắt
//     có trần, và khi vượt trần thì NÓI RA còn bao nhiêu trường nữa.
//  2. **Không lộ bí mật.** Cấu hình có thể chứa mật khẩu Wi-Fi hay khoá; giá
//     trị của trường có tên nhạy cảm bị thay bằng `***`, giữ lại sự kiện "có
//     đổi" mà không ghi nội dung.
//  3. **Đường dẫn đọc được.** `northbound.bacnetPort: 47808 -> 47809` chứ không
//     phải chỉ số mảng trần — người đọc nhật ký sáu tháng sau không có sơ đồ dữ
//     liệu trong đầu.

const (
	configDiffMaxFields = 8
	configDiffMaxValue  = 40
)

// sensitiveConfigKey nhận diện trường không được ghi giá trị vào nhật ký.
func sensitiveConfigKey(key string) bool {
	lower := strings.ToLower(key)
	for _, needle := range []string{"password", "passphrase", "secret", "token", "key", "psk", "credential"} {
		if strings.Contains(lower, needle) {
			return true
		}
	}
	return false
}

// summarizeConfigDiff so hai bản cấu hình đã mã hoá JSON và trả tóm tắt một dòng.
//
// Trả chuỗi rỗng khi không có khác biệt nào — nơi gọi không nên ghi một vết
// "đã sửa" mang tóm tắt trống, vì nó nói sai: người dùng bấm Lưu nhưng nội dung
// không đổi là một sự kiện khác hẳn.
func summarizeConfigDiff(before, after any) string {
	beforeMap := toGenericMap(before)
	afterMap := toGenericMap(after)
	if beforeMap == nil && afterMap == nil {
		return ""
	}
	changes := []string{}
	collectDiff("", beforeMap, afterMap, &changes)
	if len(changes) == 0 {
		return ""
	}
	sort.Strings(changes)
	if len(changes) > configDiffMaxFields {
		remaining := len(changes) - configDiffMaxFields
		changes = append(changes[:configDiffMaxFields], fmt.Sprintf("… và %d trường khác", remaining))
	}
	return strings.Join(changes, "; ")
}

func toGenericMap(value any) map[string]any {
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var generic map[string]any
	if err := json.Unmarshal(data, &generic); err != nil {
		return nil
	}
	return generic
}

func collectDiff(prefix string, before, after map[string]any, changes *[]string) {
	keys := map[string]struct{}{}
	for key := range before {
		keys[key] = struct{}{}
	}
	for key := range after {
		keys[key] = struct{}{}
	}
	for key := range keys {
		path := key
		if prefix != "" {
			path = prefix + "." + key
		}
		oldValue, hasOld := before[key]
		newValue, hasNew := after[key]

		oldNested, oldIsMap := oldValue.(map[string]any)
		newNested, newIsMap := newValue.(map[string]any)
		if (oldIsMap || !hasOld) && (newIsMap || !hasNew) && (oldIsMap || newIsMap) {
			if oldNested == nil {
				oldNested = map[string]any{}
			}
			if newNested == nil {
				newNested = map[string]any{}
			}
			collectDiff(path, oldNested, newNested, changes)
			continue
		}

		if sameJSON(oldValue, newValue) {
			continue
		}
		*changes = append(*changes, fmt.Sprintf("%s: %s -> %s", path, formatDiffValue(key, oldValue, hasOld), formatDiffValue(key, newValue, hasNew)))
	}
}

func sameJSON(left, right any) bool {
	leftData, leftErr := json.Marshal(left)
	rightData, rightErr := json.Marshal(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return string(leftData) == string(rightData)
}

func formatDiffValue(key string, value any, present bool) string {
	if !present {
		return "(không có)"
	}
	if sensitiveConfigKey(key) {
		return "***"
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "?"
	}
	text := strings.Trim(string(data), `"`)
	if len(text) > configDiffMaxValue {
		return text[:configDiffMaxValue] + "…"
	}
	if text == "" {
		return "(rỗng)"
	}
	return text
}
