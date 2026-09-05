package modbusrtu

import "strings"

/* `ISS-PIO-22`/`F-PIO-021` — nhóm poll theo điểm (đề bài §22).
 *
 * Ba tên này phải TRÙNG `poll_group_from_string` trong
 * `apps/iobus/adapters/modbus_rtu/poll_group.cpp`: thêm một nhóm ở một bên mà
 * quên bên kia thì web-api nhận một giá trị mà firmware âm thầm hạ về `normal`
 * — người vận hành đặt `slow` cho một điểm cấu hình và tin rằng đã tiết kiệm
 * được dây.
 */
const (
	PollGroupFast   = "fast"
	PollGroupNormal = "normal"
	PollGroupSlow   = "slow"
)

// PollGroups là tập giá trị hợp lệ, theo thứ tự từ nhanh tới chậm.
var PollGroups = []string{PollGroupFast, PollGroupNormal, PollGroupSlow}

// StaleAfterMaxMS — trần thực dụng cho ngưỡng stale khai tay (1 giờ). Trên mức
// này thì "stale" không còn là một cảnh báo vận hành nữa.
const StaleAfterMaxMS = 3600000

// NormalizePollGroup hạ về `normal` cho mọi giá trị không nhận ra. Rỗng cũng là
// `normal` — đó là mặc định, không phải "chưa biết".
func NormalizePollGroup(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case PollGroupFast:
		return PollGroupFast
	case PollGroupSlow:
		return PollGroupSlow
	default:
		return PollGroupNormal
	}
}

// ValidPollGroup nói một chuỗi có phải nhóm hợp lệ không. Rỗng là hợp lệ (=
// mặc định); một chuỗi lạ thì KHÔNG — im lặng hạ nó về `normal` ở cửa ghi sẽ
// để người dùng tin rằng đã đặt được `slow`.
func ValidPollGroup(value string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" {
		return true
	}
	for _, group := range PollGroups {
		if group == trimmed {
			return true
		}
	}
	return false
}
