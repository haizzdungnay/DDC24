package app

import "testing"

// `T57-3.18` — gộp kết quả kiểm kết nối.
//
// Đây là chỗ dễ sai nhất của tính năng: `unknown` (không kiểm được) KHÔNG được
// gộp vào `unreachable` (kiểm được và không thông). Gộp lại sẽ đẩy người vận
// hành rollback một cấu hình hoàn toàn đúng chỉ vì thiết bị thiếu `ping` — và
// họ mất luôn cửa sổ 120 giây.

func TestNetworkCheckSummaryKeepsThreeStates(t *testing.T) {
	cases := []struct {
		name    string
		targets []NetworkCheckTarget
		want    string
	}{
		{
			name:    "mọi đích kiểm được đều thông",
			targets: []NetworkCheckTarget{{State: "ok"}, {State: "ok"}},
			want:    "ok",
		},
		{
			name:    "một đích không thông ⇒ degraded",
			targets: []NetworkCheckTarget{{State: "ok"}, {State: "unreachable"}},
			want:    "degraded",
		},
		{
			name:    "KHÔNG kiểm được đích nào ⇒ unknown, không phải degraded",
			targets: []NetworkCheckTarget{{State: "unknown"}, {State: "unknown"}},
			want:    "unknown",
		},
		{
			name:    "kiểm được một đích và nó thông, phần còn lại không kiểm được ⇒ ok",
			targets: []NetworkCheckTarget{{State: "ok"}, {State: "unknown"}},
			want:    "ok",
		},
		{
			name:    "kiểm được một đích và nó KHÔNG thông ⇒ degraded dù phần còn lại mù",
			targets: []NetworkCheckTarget{{State: "unreachable"}, {State: "unknown"}},
			want:    "degraded",
		},
		{
			name:    "không có đích nào ⇒ unknown",
			targets: []NetworkCheckTarget{},
			want:    "unknown",
		},
	}

	for _, testCase := range cases {
		if got := summarizeNetworkCheck(testCase.targets); got != testCase.want {
			t.Fatalf("%s: summary = %q; want %q", testCase.name, got, testCase.want)
		}
	}
}
