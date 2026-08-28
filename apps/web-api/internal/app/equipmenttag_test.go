package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Thẻ thiết bị công nghệ — `T57-3.1` (`ADR-042`), cũng là đường tối thiểu đã
// chốt cho `T57-4.1`.
//
// Thứ phải khoá chặt nhất là CHUẨN HOÁ: nhóm điểm theo thiết bị chỉ có nghĩa
// khi `AHU-1 ` và `AHU-1` rơi vào cùng một nhóm. Lệch chuẩn hoá thì màn hình có
// hai khối cùng tên và người đọc không có cách nào biết vì sao.

func TestEquipmentTagNormalizationCollapsesWhitespace(t *testing.T) {
	cases := map[string]string{
		"  AHU-1  ":     "AHU-1",
		"AHU-1\tTầng 3": "AHU-1 Tầng 3",
		"FCU   03":      "FCU 03",
		"":              "",
		"   ":           "",
	}
	for input, want := range cases {
		if got := normalizeEquipmentTag(input); got != want {
			t.Fatalf("normalizeEquipmentTag(%q) = %q; want %q", input, got, want)
		}
	}
}

func TestPointConfigAcceptsEquipmentAndReturnsItOnThePoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	handler := app.Router()
	// Gieo cấu hình IO thật thay vì bỏ qua test khi thiếu: một test bị skip
	// không phải bằng chứng gì cả.
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "io_config.conf"), []byte(fullIOConfigJSON()), 0o644); err != nil {
		t.Fatalf("seed io_config: %v", err)
	}
	// Máy chạy test không có `mkddc-iobus`/`mkddc-core` để reload; đây là ràng
	// buộc của môi trường, không phải hành vi đang kiểm.
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }

	resp := serveAuth(t, handler, http.MethodPut, "/api/v1/points/UI-01/config", `{"equipment":"  AHU-1  "}`, token)
	assertStatus(t, resp, http.StatusOK)

	var point PointDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &point); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if point.Equipment != "AHU-1" {
		t.Fatalf("Equipment = %q; want %q (đã chuẩn hoá)", point.Equipment, "AHU-1")
	}

	// Thẻ phải NẰM LẠI trong cấu hình, không chỉ có trong phản hồi của lần vá.
	// (Không đọc lại qua `/points` vì core giả của test không trả điểm nào —
	// đó là giới hạn môi trường, không phải hành vi đang kiểm.)
	stored, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "io_config.conf"))
	if err != nil {
		t.Fatalf("read io_config: %v", err)
	}
	if !strings.Contains(string(stored), `"equipment": "AHU-1"`) && !strings.Contains(string(stored), `"equipment":"AHU-1"`) {
		t.Fatalf("thẻ thiết bị không được ghi vào io_config.conf")
	}

	// Gỡ thẻ bằng chuỗi rỗng: phải XOÁ hẳn khỏi cấu hình, không để lại khoá rỗng.
	resp = serveAuth(t, handler, http.MethodPut, "/api/v1/points/UI-01/config", `{"equipment":""}`, token)
	assertStatus(t, resp, http.StatusOK)
	stored, err = os.ReadFile(filepath.Join(app.cfg.ConfigDir, "io_config.conf"))
	if err != nil {
		t.Fatalf("read io_config: %v", err)
	}
	if strings.Contains(string(stored), "AHU-1") {
		t.Fatalf("gỡ thẻ rồi mà giá trị cũ vẫn còn trong cấu hình")
	}
}

func TestPointConfigRejectsOverlongEquipmentTag(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	long := strings.Repeat("x", equipmentTagMaxBytes+1)
	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/UI-01/config", `{"equipment":"`+long+`"}`, token)
	if resp.Code != http.StatusBadRequest && resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d; want 400/422 cho thẻ quá dài; body=%s", resp.Code, resp.Body.String())
	}
}

func TestPointConfigStillRequiresAtLeastOneField(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/UI-01/config", `{}`, token)
	if resp.Code != http.StatusBadRequest && resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d; want 400/422; body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "equipment") {
		t.Fatalf("thông báo phải liệt kê cả trường mới: %s", resp.Body.String())
	}
}

// fullIOConfigJSON dựng cấu hình IO ĐỦ kênh (16 UI + 4 AO + 4 DO).
//
// Bộ kiểm hợp lệ đòi đủ kênh — đó là luật đúng cho một thiết bị thật, nên test
// phải dựng dữ liệu hợp lệ thay vì nới luật cho dễ test.
func fullIOConfigJSON() string {
	var builder strings.Builder
	builder.WriteString(`{"ui":[`)
	for channel := 1; channel <= 16; channel++ {
		if channel > 1 {
			builder.WriteString(",")
		}
		fmt.Fprintf(&builder, `{"ch":%d,"tag":"UI-%02d","name":"UI %d","type":"0-10V"}`, channel, channel, channel)
	}
	builder.WriteString(`],"ao":[`)
	for channel := 1; channel <= 4; channel++ {
		if channel > 1 {
			builder.WriteString(",")
		}
		fmt.Fprintf(&builder, `{"ch":%d,"tag":"AO-%02d","name":"AO %d","mode":"0-10V"}`, channel, channel, channel)
	}
	builder.WriteString(`],"do":[`)
	for channel := 1; channel <= 4; channel++ {
		if channel > 1 {
			builder.WriteString(",")
		}
		fmt.Fprintf(&builder, `{"ch":%d,"tag":"DO-%02d","name":"DO %d"}`, channel, channel, channel)
	}
	builder.WriteString(`]}`)
	return builder.String()
}
