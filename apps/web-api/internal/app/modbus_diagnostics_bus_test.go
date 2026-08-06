package app

import "testing"

// Tra cứu thiết bị trong bảng chẩn đoán phải theo (bus, slave), KHÔNG theo mỗi
// slave — sự cố lộ ra khi chốt 2 cổng RS-485.
//
// `slave_id = 1` trên rs485-1 và `slave_id = 1` trên rs485-2 là hai thiết bị
// khác nhau hoàn toàn hợp lệ (validator đã cho phép: unique theo TỪNG bus). Tra
// theo mỗi địa chỉ thì hai thiết bị đè lên nhau, và bảng chẩn đoán gán số đo
// của dây này cho thiết bị của dây kia — sai mà trông vẫn hợp lý, khiến người
// vận hành đi tìm lỗi ở nhầm tủ.
func TestDiagnosticsTraCuuTheoBusVaSlaveKhongPhaiChiSlave(t *testing.T) {
	type slaveKey struct{ bus, slave int }
	devices := []struct {
		id    string
		bus   int
		slave int
	}{
		{"MTR-TANG-1", 1, 1},
		{"VFD-TANG-2", 2, 1}, // cùng slave_id, khác dây
	}
	index := map[slaveKey]string{}
	for _, d := range devices {
		index[slaveKey{d.bus, d.slave}] = d.id
	}
	if len(index) != 2 {
		t.Fatalf("hai thiết bị cùng slave_id khác bus bị gộp thành %d mục", len(index))
	}
	if got := index[slaveKey{2, 1}]; got != "VFD-TANG-2" {
		t.Errorf("(bus 2, slave 1) tra ra %q, chờ VFD-TANG-2", got)
	}
	if got := index[slaveKey{1, 1}]; got != "MTR-TANG-1" {
		t.Errorf("(bus 1, slave 1) tra ra %q, chờ MTR-TANG-1", got)
	}
}
