package modbusrtu

import (
	"encoding/json"
	"strings"
	"testing"
)

// U-07 (REC-DDC-FIELD-USE-20260927) — `coil_write_batch_max` theo thiết bị.
//
// iobus gom các lệnh ghi coil liền kề thành một FC15 CHỈ khi profile khai
// `max_coils_per_write > 1`. BE là nơi duy nhất sinh profile, nên nó quyết định
// hai điều mà test dưới đây khoá: thiết bị chưa bật giữ profile cũ từng byte
// (nâng cấp web không đổi khung trên dây của tủ nào), và giá trị ngoài dải bị
// từ chối thay vì để iobus kẹp lặng lẽ.

func coilBatchDevice(max int) Device {
	return Device{DeviceID: "CK508-04", DisplayName: "CK508 04", Enabled: FlexBool(true),
		RS485Port: "/dev/rs485-1", Baud: 9600, Parity: "N", StopBit: 1, SlaveID: 4,
		PollMS: 1000, TimeoutMS: 300, Retry: 1, CoilWriteBatchMax: max}
}

func coilBatchPoints() []Point {
	return []Point{{PointID: "RELAY1", DeviceID: "CK508-04", RegisterType: "coil", Address: 0,
		DataType: "bool", Enabled: FlexBool(true), ReadWrite: "read_write"}}
}

func TestBuildProfileChiGhiMaxCoilsPerWriteKhiBatGom(t *testing.T) {
	for _, tc := range []struct {
		max  int
		want any
	}{{0, nil}, {1, nil}, {2, float64(2)}, {8, float64(8)}, {16, float64(16)}} {
		raw, err := BuildProfile(coilBatchDevice(tc.max), coilBatchPoints())
		if err != nil {
			t.Fatalf("max=%d: %v", tc.max, err)
		}
		var profile map[string]any
		if err := json.Unmarshal(raw, &profile); err != nil {
			t.Fatal(err)
		}
		got, exists := profile["max_coils_per_write"]
		if tc.want == nil {
			if exists {
				t.Fatalf("max=%d: tắt gom mà profile vẫn mang max_coils_per_write=%v:\n%s", tc.max, got, raw)
			}
			continue
		}
		if got != tc.want {
			t.Fatalf("max=%d: max_coils_per_write=%v, muốn %v:\n%s", tc.max, got, tc.want, raw)
		}
	}
}

func TestValidateCoilWriteBatchMaxTrongDai0Den16(t *testing.T) {
	for _, tc := range []struct {
		max int
		ok  bool
	}{{-1, false}, {0, true}, {1, true}, {2, true}, {16, true}, {17, false}, {125, false}} {
		cfg := Config{Devices: []Device{coilBatchDevice(tc.max)}}
		errs := ValidateWith(cfg, ValidateOptions{Capabilities: DefaultCapabilityManifest()})
		hit := false
		for _, e := range errs {
			if strings.HasSuffix(e.Path, ".coil_write_batch_max") {
				hit = true
				if e.Code != CodeOutOfRange {
					t.Fatalf("max=%d: mã lỗi %q, muốn %q", tc.max, e.Code, CodeOutOfRange)
				}
			}
		}
		if hit == tc.ok {
			t.Fatalf("max=%d: bị từ chối=%v, muốn hợp lệ=%v (lỗi: %+v)", tc.max, hit, tc.ok, errs)
		}
	}
}

// Checksum cấu hình tính trên canonical form: thiết bị chưa bật gom không được
// đổi checksum, nếu không mọi tủ đang chạy sẽ thấy "cấu hình lệch" sau nâng cấp.
func TestCoilWriteBatchMaxKhongDoiChecksumKhiTat(t *testing.T) {
	base := Config{Devices: []Device{coilBatchDevice(0)}}
	sumOff, err := Checksum(base)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(base.Devices[0])
	if strings.Contains(string(raw), "coil_write_batch_max") {
		t.Fatalf("thiết bị tắt gom vẫn ghi coil_write_batch_max: %s", raw)
	}
	on := Config{Devices: []Device{coilBatchDevice(8)}}
	sumOn, err := Checksum(on)
	if err != nil {
		t.Fatal(err)
	}
	if sumOn == sumOff {
		t.Fatal("bật gom mà checksum không đổi — iobus không biết cấu hình đã khác")
	}
}

// Diff của candidate phải hiện thay đổi này: người duyệt apply cần thấy tủ sắp
// đổi khung trên dây.
func TestCandidateDiffHienDoiCoilWriteBatchMax(t *testing.T) {
	before := coilBatchDevice(0)
	after := coilBatchDevice(8)
	fieldsBefore := deviceFields(before)
	fieldsAfter := deviceFields(after)
	if fieldsBefore["coil_write_batch_max"] != "0" || fieldsAfter["coil_write_batch_max"] != "8" {
		t.Fatalf("deviceFields thiếu coil_write_batch_max: before=%v after=%v", fieldsBefore, fieldsAfter)
	}
}
