package main

import (
	"net/http/httptest"
	"slices"
	"testing"
)

// F-10: token phải lấy được từ Sec-WebSocket-Protocol để client không cần đặt nó
// vào query string (URL đi vào lịch sử browser và access log của mọi reverse proxy).
func TestWSTokenFromSubprotocols(t *testing.T) {
	cases := []struct {
		name   string
		header []string
		want   string
	}{
		{"không có header", nil, ""},
		{"chỉ subprotocol cố định", []string{wsSubprotocol}, ""},
		{
			"token đi kèm trong cùng header",
			[]string{wsSubprotocol + ", " + wsTokenSubprotocolPrefix + "abc.def.ghi"},
			"abc.def.ghi",
		},
		{
			"token ở header thứ hai",
			[]string{wsSubprotocol, wsTokenSubprotocolPrefix + "jwt-value"},
			"jwt-value",
		},
		{
			"prefix rỗng phía sau bị bỏ qua",
			[]string{wsTokenSubprotocolPrefix},
			"",
		},
		{
			"JWT thật (base64url + dấu chấm) là subprotocol token hợp lệ",
			[]string{wsSubprotocol + "," + wsTokenSubprotocolPrefix +
				"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2ln-_bmF0dXJl"},
			"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2ln-_bmF0dXJl",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/v1/ws/monitor", nil)
			for _, h := range tc.header {
				r.Header.Add("Sec-WebSocket-Protocol", h)
			}
			if got := wsTokenFromSubprotocols(r); got != tc.want {
				t.Fatalf("wsTokenFromSubprotocols() = %q; want %q", got, tc.want)
			}
		})
	}
}

// F-11: wsOriginPatterns LUÔN nối 6 pattern localhost, kể cả khi CORS_ORIGIN đã
// được cấu hình tường minh cho production. Một trang tại http://localhost:<port>
// trong browser của người vận hành vẫn qua được check Origin của WS — phá vỡ đúng
// ý định "chỉ cho phép origin đã khai báo" mà isAllowedOrigin thực thi cho HTTP.
func TestWSOriginPatternsDropLoopbackWhenOriginConfigured(t *testing.T) {
	loopback := []string{"localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*"}

	cases := []struct {
		name       string
		configured string
		want       []string
	}{
		{
			// Chưa cấu hình = chế độ dev → cho phép loopback, khớp isAllowedOrigin.
			name:       "rỗng thì cho phép loopback",
			configured: "",
			want:       loopback,
		},
		{
			name:       "chỉ khoảng trắng cũng coi như chưa cấu hình",
			configured: "  ,  ",
			want:       loopback,
		},
		{
			name:       "một origin production",
			configured: "https://ddc.example.local",
			want:       []string{"ddc.example.local"},
		},
		{
			name:       "nhiều origin, có cả port",
			configured: "https://ddc.example.local, http://10.0.0.5:8080",
			want:       []string{"ddc.example.local", "10.0.0.5:8080"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := wsOriginPatterns(tc.configured)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("wsOriginPatterns(%q) = %v; want %v", tc.configured, got, tc.want)
			}
		})
	}
}

// Chốt riêng điều quan trọng nhất: khi đã cấu hình origin thì KHÔNG còn bất kỳ
// pattern loopback nào lọt vào danh sách.
func TestWSOriginPatternsNoLoopbackLeakInProductionConfig(t *testing.T) {
	got := wsOriginPatterns("https://ddc.example.local")
	for _, pattern := range got {
		switch pattern {
		case "localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*":
			t.Fatalf("pattern loopback %q lọt vào allowlist production: %v", pattern, got)
		}
	}
}
