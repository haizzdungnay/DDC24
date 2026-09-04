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

/* mechanicalConfigKey nhận diện trường đổi theo MÁY, không theo Ý ĐỊNH người dùng.
 *
 * `ISS-PIO-37` — vì sao phải lọc chứ không ghi hết: tóm tắt có trần
 * `configDiffMaxFields = 8` trường. Một lần lưu cấu hình Point luôn bump
 * `revision`, đổi `checksum`, và bump `generation` của MỌI điểm ảo — tức chỉ
 * riêng nhiễu cơ học đã có thể vượt trần và đẩy thay đổi THẬT ra ngoài tóm tắt.
 * Khi đó vết audit vẫn "có nội dung", nhưng nội dung ấy không trả lời được câu
 * hỏi duy nhất người ta hỏi lúc điều tra sự cố: người dùng đã đổi cái gì.
 *
 * Đây KHÔNG phải giấu thông tin: `revision` đi ra ngoài trong chính phản hồi
 * API và trong tên vết audit, còn `generation` là số nội bộ của không gian tên
 * điểm. Cái bị bỏ là bản sao thừa của chúng bên trong tóm tắt khác biệt. */
func mechanicalConfigKey(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "revision", "checksum", "generation", "updatedat", "updated_at":
		return true
	}
	return false
}

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
		if mechanicalConfigKey(key) {
			continue
		}
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

		oldList, oldIsList := oldValue.([]any)
		newList, newIsList := newValue.([]any)
		if (oldIsList || !hasOld) && (newIsList || !hasNew) && (oldIsList || newIsList) {
			collectListDiff(path, oldList, newList, changes)
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

/* collectListDiff so hai MẢNG cấu hình theo DANH TÍNH phần tử.
 *
 * `ISS-PIO-37` — vì sao cần: mọi cấu hình Point đều là mảng (`io.ao[]`,
 * `virtual_points.items[]`, `fieldbus.points[]`). Bản trước của `collectDiff`
 * chỉ đệ quy vào `map`, nên gặp mảng nó so NGUYÊN KHỐI và in ra một cục JSON bị
 * cắt ở 40 ký tự:
 *
 *     items: [{"channel":0,"enabled":true,"generation… -> [{"boundPointId":"AV-01"…
 *
 * Tóm tắt đó tồn tại nhưng không nói được trường nào đổi — tức tính năng "vết
 * audit mang khác biệt" có mặt mà vô dụng cho đúng nhóm cấu hình nguy hiểm nhất.
 *
 * Ghép theo DANH TÍNH chứ không theo CHỈ SỐ: xoá một điểm ở đầu mảng làm mọi
 * chỉ số phía sau dịch một bậc, và so theo chỉ số sẽ báo "tất cả đều đổi" —
 * lại một tóm tắt đúng về mặt kỹ thuật mà vô dụng với người đọc.
 */
func collectListDiff(path string, before, after []any, changes *[]string) {
	beforeKeys, beforeByKey, beforeKeyed := indexListByIdentity(before)
	afterKeys, afterByKey, afterKeyed := indexListByIdentity(after)
	if !beforeKeyed || !afterKeyed {
		// Mảng giá trị đơn (cổng, chuỗi…): so theo chỉ số là đúng, vì ở đó vị
		// trí CHÍNH LÀ danh tính.
		collectIndexedListDiff(path, before, after, changes)
		return
	}

	seen := map[string]bool{}
	ordered := append(append([]string{}, beforeKeys...), afterKeys...)
	for _, key := range ordered {
		if seen[key] {
			continue
		}
		seen[key] = true
		oldItem, hasOld := beforeByKey[key]
		newItem, hasNew := afterByKey[key]
		itemPath := fmt.Sprintf("%s[%s]", path, key)
		switch {
		case !hasOld:
			*changes = append(*changes, itemPath+": (không có) -> đã thêm")
		case !hasNew:
			*changes = append(*changes, itemPath+": đã xoá")
		default:
			collectDiff(itemPath, oldItem, newItem, changes)
		}
	}
}

func collectIndexedListDiff(path string, before, after []any, changes *[]string) {
	max := len(before)
	if len(after) > max {
		max = len(after)
	}
	for i := 0; i < max; i++ {
		var oldValue, newValue any
		hasOld, hasNew := i < len(before), i < len(after)
		if hasOld {
			oldValue = before[i]
		}
		if hasNew {
			newValue = after[i]
		}
		if hasOld && hasNew && sameJSON(oldValue, newValue) {
			continue
		}
		itemPath := fmt.Sprintf("%s[%d]", path, i)
		*changes = append(*changes, fmt.Sprintf("%s: %s -> %s", itemPath,
			formatDiffValue(path, oldValue, hasOld), formatDiffValue(path, newValue, hasNew)))
	}
}

/* identityListKeys là các khoá dùng làm danh tính phần tử, theo thứ tự ưu tiên.
 *
 * `ch` đứng trước `id` cho cấu hình I/O vì kênh là danh tính bền của một hàng
 * `io_config.conf`; `id`/`pointId` phục vụ điểm ảo và điểm Modbus. */
var identityListKeys = []string{"ch", "id", "pointId", "point_id", "bindingId", "tag", "name"}

// indexListByIdentity trả về (thứ tự khoá, bảng tra, có khoá được không).
//
// `false` khi CÓ phần tử không phải object, hoặc không tìm được khoá danh tính,
// hoặc khoá bị TRÙNG — trùng khoá nghĩa là nó không phải danh tính, và ghép theo
// nó sẽ âm thầm bỏ mất một phần tử.
func indexListByIdentity(list []any) ([]string, map[string]map[string]any, bool) {
	keys := make([]string, 0, len(list))
	byKey := make(map[string]map[string]any, len(list))
	for _, raw := range list {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, nil, false
		}
		key, ok := identityOf(item)
		if !ok {
			return nil, nil, false
		}
		if _, duplicate := byKey[key]; duplicate {
			return nil, nil, false
		}
		keys = append(keys, key)
		byKey[key] = item
	}
	return keys, byKey, true
}

func identityOf(item map[string]any) (string, bool) {
	for _, key := range identityListKeys {
		value, present := item[key]
		if !present {
			continue
		}
		text := strings.TrimSpace(fmt.Sprintf("%v", value))
		if text != "" && text != "<nil>" {
			return text, true
		}
	}
	return "", false
}
