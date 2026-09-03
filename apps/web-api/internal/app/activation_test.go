package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/* `ISS-PIO-33`: vòng đời `Edit → Validate → Apply → Read-back Verify`.
 *
 * Khoảng cách mà bộ test này đóng: trước bản vá, web đáp `200 success` cho một
 * cấu hình 4-20 mA mà bo vẫn đang chạy 0-10 V — vì `iobus` ghi `ao_mode[] = 0`
 * khi MCU NACK `SET_AO_CFG`, và không ai đọc lại con số đó. */

type aoModeCore struct {
	modes     []uint8
	err       error
	iopStatus string
}

func (c aoModeCore) ReadStatus(context.Context) (CoreStatus, error) {
	status := c.iopStatus
	if status == "" {
		status = "normal"
	}
	return CoreStatus{CoreAvailable: true, IobusPresent: true, IOP: IOPStatus{Status: status}}, nil
}

func (c aoModeCore) ReadAOModes() ([]uint8, error) {
	if c.err != nil {
		return nil, c.err
	}
	return c.modes, nil
}

func aoBody(t *testing.T, mode string) string {
	t.Helper()
	return strings.Replace(fullIOBody(""), `{"ch":1,"tag":"AO-01","name":"AO 01","mode":"0-10V"}`,
		`{"ch":1,"tag":"AO-01","name":"AO 01","mode":"`+mode+`"}`, 1)
}

func putIOWithReload(t *testing.T, core CoreStatusClient, body string) (*httptest.ResponseRecorder, *App) {
	t.Helper()
	app, token := newTestAppWithRole(t, RoleAdmin, core)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/io", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	return w, app
}

func decodeResult(t *testing.T, w *httptest.ResponseRecorder) ConfigPutResult {
	t.Helper()
	var result ConfigPutResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return result
}

// Phần cứng báo đúng mode đã yêu cầu ⇒ `verified`, và đối chiếu từng kênh có mặt
// trong đáp ứng để người vận hành nhìn thấy được.
func TestActivationVerifiedWhenHardwareReportsRequestedMode(t *testing.T) {
	core := aoModeCore{modes: []uint8{1, 0, 0, 0}}
	w, _ := putIOWithReload(t, core, aoBody(t, "4-20mA"))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	result := decodeResult(t, w)
	if result.Activation == nil || result.Activation.Status != ActivationVerified {
		t.Fatalf("activation = %#v", result.Activation)
	}
	if len(result.Activation.AOModes) != kxNAO {
		t.Fatalf("thiếu đối chiếu từng kênh: %#v", result.Activation.AOModes)
	}
	if result.Activation.AOModes[0].Requested != "4-20mA" || result.Activation.AOModes[0].Applied != "4-20mA" {
		t.Fatalf("đối chiếu kênh 1 sai: %#v", result.Activation.AOModes[0])
	}
}

// Ca trung tâm: MCU NACK nên `iobus` giữ 0-10 V. Đây là BẰNG CHỨNG hỏng ⇒ phải
// rollback, và tệp trên đĩa phải trở lại nội dung cũ chứ không chỉ báo lỗi.
func TestActivationMismatchRollsBackAndNamesTheChannel(t *testing.T) {
	core := aoModeCore{modes: []uint8{0, 0, 0, 0}}
	app, token := newTestAppWithRole(t, RoleAdmin, core)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	ioPath := filepath.Join(app.cfg.ConfigDir, configGroupIO.file)
	if err := os.WriteFile(ioPath, []byte(`{"ui":[],"ao":[],"do":[]}`+"\n"), 0o644); err != nil {
		t.Fatalf("dựng cấu hình cũ: %v", err)
	}
	before, err := os.ReadFile(ioPath)
	if err != nil {
		t.Fatalf("đọc cấu hình cũ: %v", err)
	}

	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/io", aoBody(t, "4-20mA"), token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s; muốn 409", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, "read-back") || !strings.Contains(body, "AO-01") {
		t.Fatalf("lỗi không nói ra kênh nào lệch: %s", body)
	}
	after, err := os.ReadFile(ioPath)
	if err != nil {
		t.Fatalf("đọc lại cấu hình: %v", err)
	}
	if string(after) != string(before) {
		t.Fatalf("KHÔNG rollback: tệp đã đổi\ntrước=%s\nsau=%s", before, after)
	}
}

// IOP chưa poll ⇒ `iobus` chưa từng gửi `SET_AO_CFG`. Đây là THIẾU BẰNG CHỨNG,
// không phải bằng chứng hỏng: không rollback, nhưng cũng không được im lặng.
func TestActivationUnverifiedWhenIOPNotPolling(t *testing.T) {
	core := aoModeCore{modes: []uint8{0, 0, 0, 0}, iopStatus: "fault"}
	w, _ := putIOWithReload(t, core, aoBody(t, "4-20mA"))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s; không được rollback vì thiếu bằng chứng", w.Code, w.Body.String())
	}
	result := decodeResult(t, w)
	if result.Activation == nil || result.Activation.Status != ActivationUnverified {
		t.Fatalf("activation = %#v", result.Activation)
	}
	if !strings.Contains(result.Activation.Reason, "SET_AO_CFG") {
		t.Fatalf("lý do không nói ra nguyên nhân: %q", result.Activation.Reason)
	}
	// Và nó phải đi ra ngoài như một cảnh báo có tên, không nằm im trong log.
	if len(result.Warnings) == 0 || !strings.Contains(strings.Join(result.Warnings, " "), "SET_AO_CFG") {
		t.Fatalf("cảnh báo không tới được người vận hành: %#v", result.Warnings)
	}
}

// Không đọc được `io_shm` cũng là thiếu bằng chứng — nói ra, không rollback.
func TestActivationUnverifiedWhenShmUnreadable(t *testing.T) {
	core := aoModeCore{err: errors.New("io_shm không mở được")}
	w, _ := putIOWithReload(t, core, aoBody(t, "0-10V"))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	result := decodeResult(t, w)
	if result.Activation == nil || result.Activation.Status != ActivationUnverified {
		t.Fatalf("activation = %#v", result.Activation)
	}
	if !strings.Contains(result.Activation.Reason, "io_shm") {
		t.Fatalf("lý do không nói ra nguyên nhân: %q", result.Activation.Reason)
	}
}

// Core client không đọc được SHM (mọi giả lập, và cả bản sim) vẫn phải BÁO CÁO
// là chưa kiểm chứng — im lặng ở đây sẽ khiến "verified" trở thành mặc định
// ngầm, đúng cái bẫy mà `ISS-PIO-33` muốn dẹp.
func TestActivationAlwaysPresentEvenWithoutAReader(t *testing.T) {
	w, _ := putIOWithReload(t, fakeCore{}, fullIOBody(""))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	result := decodeResult(t, w)
	if result.Activation == nil {
		t.Fatalf("đáp ứng không có activation: %s", w.Body.String())
	}
	if result.Activation.Status != ActivationUnverified {
		t.Fatalf("activation = %#v", result.Activation)
	}
}

// Kênh không được liệt kê giữ mặc định 0-10 V — khớp `iobus_config.cpp`, nơi
// `ao_mode[]` được khởi tạo `V0_10` trước khi parse. Đoán khác đi sẽ tạo ra
// "mismatch" cho một cấu hình hoàn toàn hợp lệ rồi rollback oan.
func TestExpectedAOModesDefaultToVoltage(t *testing.T) {
	cfg := ConfigIO{AO: []map[string]any{{"ch": 2, "mode": "4-20mA"}}}
	got := expectedAOModes(cfg)
	want := []uint8{0, 1, 0, 0}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expectedAOModes = %v; muốn %v", got, want)
		}
	}
}
