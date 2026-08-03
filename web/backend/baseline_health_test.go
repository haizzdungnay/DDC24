package main

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
	binary.LittleEndian.PutUint32(data[offExt+offExtValue:offExt+offExtValue+4], math.Float32bits(21.5))
	data[offExt+offExtQuality] = 1
	data[offExt+offExtOnline] = 1
	data[offExt+offExtWritable] = 1

	points := decodePoints(data, nil)
	got := points[len(points)-1]
	if got.ID != "MB-AHU-SAT" || got.Kind != "modbus_rtu" || got.Quality != "STALE" || !got.Writable || got.Value != float32(21.5) {
		t.Fatalf("Modbus Point = %+v", got)
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
