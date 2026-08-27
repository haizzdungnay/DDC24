package app

import "testing"

// Quyền sở hữu slot Virtual Point — `F-PROG-ASBUILT-016`.
//
// Khi chiều GHI của VP được mở cho ST Program, hai bên cùng có thể ghi một ô
// điểm: chương trình đặt giá trị mỗi chu kỳ, còn web-api đẩy giá trị cấu hình
// mỗi lần khởi động hoặc mỗi lần ai đó sửa VP. Không có ranh giới sở hữu thì ô
// điểm nhấp nháy giữa hai nguồn và không dấu hiệu nào chỉ ra vì sao — nên
// `source` phải là một lựa chọn TƯỜNG MINH, không phải một mặc định êm ái.
func TestVirtualPointSourceValidation(t *testing.T) {
	base := func(source, bound string) VirtualPoint {
		return VirtualPoint{ID: "VP1", Tag: "VP_X", SignalType: virtualPointSignalBoolean,
			Enabled: true, Writable: true, Source: source, BoundPointID: bound}
	}
	cases := []struct {
		name    string
		item    VirtualPoint
		wantErr bool
	}{
		{"rong la mac dinh WEB", base("", "BV-1"), false},
		{"WEB tuong minh", base("WEB", "BV-1"), false},
		{"PROGRAM co bound", base("PROGRAM", "BV-1"), false},
		{"khong phan biet hoa thuong", base("program", "BV-1"), false},
		// Chuỗi lạ KHÔNG được rơi về "web-api sở hữu" một cách im lặng: nhánh
		// đó sẽ ghi đè kết quả điều khiển bằng một hằng số cấu hình.
		{"chuoi la bi tu choi", base("CORE", "BV-1"), true},
		// Sở hữu chỉ có nghĩa khi đã bind vào một slot Core thật.
		{"PROGRAM khong bound", base("PROGRAM", ""), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := ConfigVirtualPoints{Items: []VirtualPoint{tc.item}}
			errs := validateConfigVirtualPoints(cfg)
			if got := len(errs) > 0; got != tc.wantErr {
				t.Fatalf("wantErr=%v, nhan %d loi: %+v", tc.wantErr, len(errs), errs)
			}
		})
	}
}
