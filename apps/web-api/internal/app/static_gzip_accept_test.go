package app

import "testing"

// T63-104: đọc Accept-Encoding theo RFC 9110 §12.5.3.
func TestAcceptsGzip(t *testing.T) {
	cases := []struct {
		values []string
		want   bool
	}{
		{nil, false},
		{[]string{""}, false},
		{[]string{"gzip"}, true},
		{[]string{"GZIP"}, true},
		{[]string{"gzip, deflate, br, zstd"}, true},
		{[]string{"br", "gzip"}, true},
		{[]string{"x-gzip"}, true},
		{[]string{"gzip;q=0"}, false},
		{[]string{"gzip; q=0.000"}, false},
		{[]string{"gzip;q=0.5"}, true},
		{[]string{"gzip;q=abc"}, false},
		{[]string{"identity"}, false},
		{[]string{"br"}, false},
		{[]string{"*"}, true},
		{[]string{"*;q=0"}, false},
		{[]string{"gzip;q=0, *"}, false},
		{[]string{"*;q=0, gzip"}, true},
	}
	for _, tc := range cases {
		if got := acceptsGzip(tc.values); got != tc.want {
			t.Errorf("acceptsGzip(%q) = %v; want %v", tc.values, got, tc.want)
		}
	}
}
