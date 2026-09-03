package application

import (
	"encoding/json"
	"testing"
)

/* `ISS-PIO-01`/`AC-PIO-ID-01` — `extIndex` KHÔNG phải danh tính.
 *
 * Binding v1 có hình dạng MỞ: `upsertBindingCompat` chép MỌI khoá client gửi
 * nguyên vào tài liệu bền. Nếu cửa này không chặn, một `extIndex` lọt vào sẽ
 * NẰM LẠI trong binding đã seal — và người đọc sau này hoàn toàn có thể tin nó.
 * Đó đúng là hạt giống của lỗi mà cả chuỗi `ISS-PIO-31` sinh ra để dẹp: slot
 * `14` bị coi là danh tính lâu dài, rồi cấu hình dịch chỗ và lệnh bơm đi sai
 * thanh ghi mà không một dòng cảnh báo. */

const (
	identityBindingID  = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"
	identityVariableID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"
)

func bindingOp(t *testing.T, binding map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"op": "upsertBinding", "binding": binding})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return raw
}

func durableBinding(extra map[string]any, pointExtra map[string]any) map[string]any {
	point := map[string]any{"category": "MB_RTU", "deviceId": "bus-1-slave-4", "pointId": "PUMP_CMD"}
	for key, value := range pointExtra {
		point[key] = value
	}
	binding := map[string]any{
		"bindingId":     identityBindingID,
		"variableId":    identityVariableID,
		"point":         point,
		"direction":     "WRITE",
		"dataType":      "BOOL",
		"writable":      true,
		"qualityPolicy": "REQUIRE_GOOD",
	}
	for key, value := range extra {
		binding[key] = value
	}
	return binding
}

// Danh tính bền `(deviceId, pointId)` phải đi qua được — nếu không thì bản vá
// này chặn luôn chính thứ nó bảo vệ.
func TestDurableBindingWithoutRuntimeHandleIsAccepted(t *testing.T) {
	// `replaceOrAppend` đòi collection đã tồn tại — tài liệu draft thật luôn có.
	document := map[string]any{"bindings": []any{}}
	if err := upsertBindingCompat(document, bindingOp(t, durableBinding(nil, nil))); err != nil {
		t.Fatalf("binding chỉ mang danh tính bền mà bị từ chối: %v", err)
	}
	bindings, _ := document["bindings"].([]any)
	if len(bindings) != 1 {
		t.Fatalf("số binding lưu = %d (chờ 1)", len(bindings))
	}
	stored, _ := bindings[0].(map[string]any)
	point, _ := stored["point"].(map[string]any)
	if point["deviceId"] != "bus-1-slave-4" || point["pointId"] != "PUMP_CMD" {
		t.Fatalf("danh tính bền không được giữ nguyên: %#v", point)
	}
}

// Cửa ghi phải TỪ CHỐI, không âm thầm gỡ bỏ: gỡ bỏ sẽ khiến client tưởng nó đã
// lưu được thứ nó gửi.
func TestBindingCarryingExtIndexIsRejected(t *testing.T) {
	cases := map[string]map[string]any{
		"trong thân binding": {"extIndex": 14},
		"viết snake_case":    {"ext_index": 14},
		"viết hoa khác đi":   {"ExtIndex": 14},
	}
	for name, extra := range cases {
		t.Run(name, func(t *testing.T) {
			document := map[string]any{"bindings": []any{}}
			if err := upsertBindingCompat(document, bindingOp(t, durableBinding(extra, nil))); err == nil {
				t.Fatalf("binding mang handle runtime mà vẫn được nhận; tài liệu = %#v", document)
			}
			if stored, _ := document["bindings"].([]any); len(stored) != 0 {
				t.Fatalf("bị từ chối rồi mà vẫn ghi vào tài liệu: %#v", document)
			}
		})
	}
}

// Và cả khi nó nấp trong `point` — chỗ tự nhiên nhất để ai đó đặt nó, vì Catalog
// phát `extIndex` ngay cạnh `pointId`.
func TestExtIndexHiddenInsidePointIsAlsoRejected(t *testing.T) {
	document := map[string]any{"bindings": []any{}}
	if err := upsertBindingCompat(document, bindingOp(t, durableBinding(nil, map[string]any{"extIndex": 14}))); err == nil {
		t.Fatalf("extIndex nấp trong point mà vẫn được nhận; tài liệu = %#v", document)
	}
}
