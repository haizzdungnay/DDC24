package app

import (
	"encoding/binary"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
)

func TestDecodePointsPublishesModbusIdentityAndQuality(t *testing.T) {
	data := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(data[0:4], kxShmMagic)
	binary.LittleEndian.PutUint16(data[offExtCount:offExtCount+2], 1)
	copy(data[offExt:offExt+24], []byte("MB-AHU-SAT"))
	binary.LittleEndian.PutUint64(data[offExt+offExtValue:offExt+offExtValue+8], math.Float64bits(21.5))
	data[offExt+offExtQuality] = 1 // STALE
	data[offExt+offExtQualityReason] = 5
	data[offExt+offExtOnline] = 1
	data[offExt+offExtWritable] = 1
	data[offExt+offExtBusID] = 2
	data[offExt+offExtSlave] = 7
	binary.LittleEndian.PutUint64(data[offExt+offExtSampleUTCMS:offExt+offExtSampleUTCMS+8], 1700000000000)

	points := decodePoints(data, nil)
	got := points[len(points)-1]
	if got.ID != "MB-AHU-SAT" || got.Kind != "modbus_rtu" || got.Quality != "STALE" || !got.Writable {
		t.Fatalf("Modbus Point = %+v", got)
	}
	if got.Value != float64(21.5) {
		t.Fatalf("value phải là float64 sau contract v2: %+v", got.Value)
	}
	// MBR-B103: reason/bus/slave đến TỪ producer; FE không phải suy diễn nữa.
	if got.QualityReason != "TIMEOUT" || got.BusID != 2 || got.SlaveAddr != 7 {
		t.Fatalf("thiếu trường chẩn đoán từ producer: %+v", got)
	}
	// Mốc hiển thị phải là thời điểm SAMPLE, không phải "lúc web đọc SHM".
	if got.UpdatedAt != "2023-11-14T22:13:20Z" {
		t.Fatalf("updatedAt phải lấy từ sample_utc_ms: %q", got.UpdatedAt)
	}
}

// MBR-B001: giá trị nguyên vượt 2^24 phải giữ nguyên. Với ABI float32 cũ,
// 4294967295 (uint32 max của công-tơ kWh) bị làm tròn thành 4294967296.
func TestDecodePointsKeepsIntegerPrecisionAboveFloatMantissa(t *testing.T) {
	data := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(data[0:4], kxShmMagic)
	binary.LittleEndian.PutUint16(data[offExtCount:offExtCount+2], 1)
	copy(data[offExt:offExt+24], []byte("MB-KWH"))
	binary.LittleEndian.PutUint64(data[offExt+offExtValue:offExt+offExtValue+8], math.Float64bits(4294967295))
	data[offExt+offExtOnline] = 1

	got := decodePoints(data, nil)
	last := got[len(got)-1]
	if last.Value != float64(4294967295) {
		t.Fatalf("mất chính xác số nguyên lớn: %v", last.Value)
	}
}

// Quality lạ (producer mới hơn consumer) phải thành UNKNOWN, không được đoán
// về GOOD — đoán ở đây là bịa trạng thái thiết bị hiện trường.
func TestDecodePointsReportsUnknownForUnrecognisedQuality(t *testing.T) {
	data := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(data[0:4], kxShmMagic)
	binary.LittleEndian.PutUint16(data[offExtCount:offExtCount+2], 1)
	copy(data[offExt:offExt+24], []byte("MB-FUTURE"))
	data[offExt+offExtQuality] = 99

	got := decodePoints(data, nil)
	last := got[len(got)-1]
	if last.Quality != "UNKNOWN" {
		t.Fatalf("quality lạ phải là UNKNOWN, nhận %q", last.Quality)
	}
}

func TestHealthEndpointIsPublicAndReportsAllBaselineChecks(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	app, err := NewApp(testConfig(t, users), nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	for _, name := range []string{"web", "core", "iobus", "io_shm", "plc_shm", "mcu_connection"} {
		if !containsJSONKey(w.Body.Bytes(), name) {
			t.Fatalf("health thiếu check %q: %s", name, w.Body.String())
		}
	}
}

func TestProcessAliveUsesPidFileAndRejectsMissingProcess(t *testing.T) {
	pidPath := t.TempDir() + "/service.pid"
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatal(err)
	}
	if !processAlive(pidPath) {
		t.Fatal("process hiện tại phải được nhận diện là đang chạy")
	}
	if processAlive(pidPath + ".missing") {
		t.Fatal("PID file không tồn tại không được báo healthy")
	}
}

func containsJSONKey(body []byte, key string) bool {
	needle := []byte(`"` + key + `"`)
	for i := 0; i+len(needle) <= len(body); i++ {
		match := true
		for j := range needle {
			if body[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
