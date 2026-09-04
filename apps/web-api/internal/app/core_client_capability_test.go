package app

import (
	"context"
	"testing"
)

/* MỌI NĂNG LỰC TÙY CHỌN CỦA `a.core` PHẢI ĐƯỢC `*CoreClient` ĐÁP ỨNG THẬT.
 *
 * Handler dò năng lực của core bằng ép kiểu động (`a.core.(pointTTLForcer)`),
 * và đó là lựa chọn đúng: test double chỉ cần dựng phần nó quan tâm. Nhưng ép
 * kiểu động KHÔNG được trình biên dịch kiểm — một interface tả sai tên hàm
 * hoặc sai chữ ký vẫn biên dịch sạch, chỉ trượt lúc chạy, và handler trả đúng
 * cái nhánh "core không hỗ trợ" mà nó viết ra cho core ĐỜI CŨ.
 *
 * Đây chính là cách `/api/v1/modbus/write-test` chết lặng: nó dò một hàm
 * `WritePoint(...)` mà KHÔNG type nào trong repo có, nên mọi lệnh ghi hợp lệ
 * đều trả `503 core client không hỗ trợ WritePoint`, trong khi bộ test chỉ
 * kiểm ba ca bị từ chối nên vẫn xanh (ISS-MBW-01).
 *
 * Khai báo dưới đây đẩy phép kiểm đó về lúc BIÊN DỊCH: thêm một năng lực mới
 * mà quên hiện thực ở `CoreClient` là hỏng build ngay, không phải hỏng ở bo.
 */
var (
	_ CoreStatusClient        = (*CoreClient)(nil)
	_ pointReader             = (*CoreClient)(nil)
	_ pointForcer             = (*CoreClient)(nil)
	_ pointTTLForcer          = (*CoreClient)(nil)
	_ monitorPointReader      = (*CoreClient)(nil)
	_ monitorPointForcer      = (*CoreClient)(nil)
	_ monitorPointTTLForcer   = (*CoreClient)(nil)
	_ extCatalogReader        = (*CoreClient)(nil)
	_ FieldbusTelemetryReader = (*CoreClient)(nil)
	_ alarmReader             = (*CoreClient)(nil)
	_ alarmAcker              = (*CoreClient)(nil)
	_ alarmSuppressor         = (*CoreClient)(nil)
	_ alarmReturner           = (*CoreClient)(nil)
	_ commissionTesterTTL     = (*CoreClient)(nil)
	_ hmiCore                 = (*CoreClient)(nil)
	_ scheduleStateReader     = (*CoreClient)(nil)
)

// Ba handler còn dò `ReadFieldbusTelemetry` bằng interface ẩn danh viết tại
// chỗ (`modbus_rtu.go` ×2, `overview.go`). Khoá chữ ký đó ở đây để một lần đổi
// chữ ký không âm thầm biến cả ba thành nhánh "core không hỗ trợ".
func TestCoreClientDapUngChuKyTelemetryAnDanh(t *testing.T) {
	var client any = (*CoreClient)(nil)
	if _, ok := client.(interface {
		ReadFieldbusTelemetry(ctx context.Context) (FieldbusTelemetry, error)
	}); !ok {
		t.Fatal("*CoreClient không còn khớp chữ ký ReadFieldbusTelemetry mà handler đang dò")
	}
}
