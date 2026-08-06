package modbusrtu

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func validConfig() Config {
	return Config{Devices: []Device{{DeviceID: "rtu-1", DisplayName: "RTU 1", Enabled: true, RS485Port: "/dev/rs485-1", Baud: 9600, Parity: "N", StopBit: 1, SlaveID: 1, PollMS: 1000, TimeoutMS: 300, Retry: 2}}, Points: []Point{{PointID: "MB_TEMP", DeviceID: "rtu-1", TagName: "Room Temp", DisplayName: "Room temperature", RegisterType: "holding_register", Address: 1, DataType: "float32", ByteOrder: "big", WordOrder: "high_low", Scale: 1, ReadWrite: "read", Enabled: true}}}
}

func TestValidateAndProfile(t *testing.T) {
	cfg := validConfig()
	if errs := Validate(cfg, map[string]string{}); len(errs) != 0 {
		t.Fatalf("Validate = %+v", errs)
	}
	data, err := BuildProfile(cfg.Devices[0], cfg.Points)
	if err != nil || len(data) == 0 {
		t.Fatalf("BuildProfile = %d/%v", len(data), err)
	}
	cfg.Points[0].TagName = "existing"
	if errs := Validate(cfg, map[string]string{"existing": "UI-01"}); len(errs) == 0 {
		t.Fatal("xung đột tag không bị chặn")
	}
}

// MBR-B211: cổng ngoài capability manifest phải bị chặn NGAY lúc validate.
//
// `/dev/ttyS2` là cổng UART của MCU IOP trên board Foxlinx. Bản trước nhận mọi
// chuỗi ≤128 byte nên một cấu hình trỏ vào đây lưu được, checksum hợp lệ,
// revision tăng — và chỉ hỏng ở tầng iobus dưới dạng "không mở được cổng", sau
// khi người vận hành đã tin là đã lưu thành công. Cùng lớp lỗi với D-14
// (mặc định `/dev/ttyS3` không tồn tại).
func TestValidateRejectsPortOutsideCapabilityManifest(t *testing.T) {
	for _, port := range []string{"/dev/ttyS2", "/dev/ttyS3", "/dev/ttyUSB0", ""} {
		cfg := validConfig()
		cfg.Devices[0].RS485Port = port
		errs := Validate(cfg, map[string]string{})
		found := false
		for _, e := range errs {
			if e.Code == CodePortNotAvailable {
				found = true
			}
		}
		if !found {
			t.Fatalf("cổng %q phải bị từ chối bằng PORT_NOT_AVAILABLE, nhận %+v", port, errs)
		}
	}
}

// Mã lỗi phải ỔN ĐỊNH: FE dựa vào mã để xử lý riêng từng loại, không so khớp
// câu tiếng Việt (câu chữ được phép sửa cho dễ đọc).
func TestValidationErrorsCarryStableCodes(t *testing.T) {
	cfg := validConfig()
	cfg.Points[0].Scale = 0
	cfg.Devices[0].SlaveID = 999
	codes := map[string]bool{}
	for _, e := range Validate(cfg, map[string]string{}) {
		codes[e.Code] = true
	}
	if !codes[CodeOutOfRange] {
		t.Fatalf("thiếu OUT_OF_RANGE: %+v", codes)
	}
}

// DATA_MODEL §5.5: hai Point cùng vùng register là hai danh tính cho một ô nhớ
// — khi ghi chúng đè nhau theo thứ tự không xác định.
func TestValidateRejectsOverlappingRegisters(t *testing.T) {
	cfg := validConfig()
	// Point gốc là float32 @1 ⇒ chiếm register 1 và 2.
	cfg.Points = append(cfg.Points, Point{
		PointID: "MB_DUP", DeviceID: "rtu-1", TagName: "Dup tag", DisplayName: "Dup",
		RegisterType: "holding_register", Address: 2, DataType: "uint16",
		ByteOrder: "big", WordOrder: "high_low", Scale: 1, ReadWrite: "read", Enabled: true,
	})
	found := false
	for _, e := range Validate(cfg, map[string]string{}) {
		if e.Code == CodeAddressOverlap {
			found = true
		}
	}
	if !found {
		t.Fatal("chồng vùng register không bị chặn")
	}
}

// Hai bit KHÁC NHAU trong cùng register là hợp lệ và rất phổ biến ở thanh ghi
// trạng thái của VFD/đồng hồ (OD-MBRTU-003).
func TestValidateAllowsDistinctBitIndexesInSameRegister(t *testing.T) {
	cfg := validConfig()
	cfg.Points[0].DataType = "bool"
	cfg.Points[0].Address = 10
	bit0, bit1 := 0, 1
	cfg.Points[0].BitIndex = &bit0
	cfg.Points = append(cfg.Points, Point{
		PointID: "MB_BIT1", DeviceID: "rtu-1", TagName: "Bit one", DisplayName: "Bit one",
		RegisterType: "holding_register", Address: 10, DataType: "bool", BitIndex: &bit1,
		ByteOrder: "big", WordOrder: "high_low", Scale: 1, ReadWrite: "read", Enabled: true,
	})
	for _, e := range Validate(cfg, map[string]string{}) {
		if e.Code == CodeAddressOverlap {
			t.Fatalf("hai bit khác nhau trong cùng register phải hợp lệ: %+v", e)
		}
	}
}

// Trùng slave_id chỉ là lỗi TRÊN CÙNG MỘT DÂY. Hai bus vật lý tách biệt hoàn
// toàn có thể cùng có slave 1; cấm điều đó là bịa ra ràng buộc không có trong
// giao thức và chặn một cấu hình hợp lệ.
func TestValidateAllowsSameSlaveIDOnDifferentBuses(t *testing.T) {
	cfg := validConfig()
	cfg.Buses = DefaultBuses()
	cfg.Devices[0].BusID = "rs485-1"
	second := cfg.Devices[0]
	second.DeviceID = "rtu-2"
	second.DisplayName = "RTU 2"
	second.BusID = "rs485-2"
	second.RS485Port = "/dev/rs485-2"
	cfg.Devices = append(cfg.Devices, second)
	for _, e := range Validate(cfg, map[string]string{}) {
		if e.Code == CodeDuplicate {
			t.Fatalf("slave_id trùng trên hai bus khác nhau phải hợp lệ: %+v", e)
		}
	}
}

// MBR-B206: checksum phải ổn định trước thứ tự khai báo và không phụ thuộc
// revision. Bản cũ marshal cả map `rs485`/`slaves` do Go sinh nên cùng một cấu
// hình cho ra hai checksum khác nhau.
func TestChecksumIsStableAcrossDeclarationOrder(t *testing.T) {
	cfg := validConfig()
	cfg.Buses = DefaultBuses()
	first, err := Checksum(cfg)
	if err != nil {
		t.Fatal(err)
	}
	reordered := cfg
	reordered.Buses = []Bus{cfg.Buses[1], cfg.Buses[0]}
	reordered.Revision = 99
	second, err := Checksum(reordered)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("checksum đổi khi chỉ đảo thứ tự / đổi revision: %s vs %s", first, second)
	}
	changed := cfg
	changed.Points = append([]Point(nil), cfg.Points...)
	changed.Points[0].Scale = 2
	third, err := Checksum(changed)
	if err != nil {
		t.Fatal(err)
	}
	if third == first {
		t.Fatal("checksum KHÔNG đổi khi nội dung đổi — vô dụng cho việc phát hiện lệch")
	}
}

func TestPersisterRollsBackWhenReloadFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fieldbus.conf")
	if err := os.WriteFile(path, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	reloads := 0
	p := Persister{ConfigDir: dir, ConfigPath: path, WriteFile: os.WriteFile, Reload: func() (bool, []string) { reloads++; return false, []string{"restart failed"} }}
	_, err := p.Apply(validConfig(), Config{})
	if !errors.Is(err, ErrApply) {
		t.Fatalf("err = %v", err)
	}
	data, readErr := os.ReadFile(path)
	if readErr != nil || string(data) != "old\n" {
		t.Fatalf("rollback = %q/%v", data, readErr)
	}
	if reloads != 2 {
		t.Fatalf("reloads = %d", reloads)
	}
}
