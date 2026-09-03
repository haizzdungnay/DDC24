package app

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mkddc-web/internal/capabilities"
)

type boardCapCore struct {
	cap capabilities.BoardCap
	err error
}

func (c boardCapCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: c.err == nil, BoardCap: c.cap}, c.err
}

func getCapabilities(t *testing.T, core CoreStatusClient, role Role) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	app, token := newTestAppWithRole(t, role, core)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/capabilities", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	var body map[string]any
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v (%s)", err, w.Body.String())
		}
	}
	return w, body
}

func capabilityBlock(t *testing.T, body map[string]any, kind string) map[string]any {
	t.Helper()
	blocks, ok := body["blocks"].([]any)
	if !ok {
		t.Fatalf("blocks không phải mảng: %#v", body["blocks"])
	}
	for _, raw := range blocks {
		block, ok := raw.(map[string]any)
		if ok && block["kind"] == kind {
			return block
		}
	}
	t.Fatalf("không có khối %s: %#v", kind, blocks)
	return nil
}

func firstChannelMode(t *testing.T, block map[string]any, modeID string) map[string]any {
	t.Helper()
	channels, ok := block["channels"].([]any)
	if !ok || len(channels) == 0 {
		t.Fatalf("khối %v không có kênh nào", block["kind"])
	}
	modes, ok := channels[0].(map[string]any)["modes"].([]any)
	if !ok {
		t.Fatalf("kênh đầu không có modes")
	}
	for _, raw := range modes {
		mode, ok := raw.(map[string]any)
		if ok && mode["id"] == modeID {
			return mode
		}
	}
	t.Fatalf("không có mode %s", modeID)
	return nil
}

// Bo quảng cáo đủ năng lực kèm RTD ⇒ endpoint công bố số kênh THẬT và mở nhiệt
// trở. Đây là ca mà đề bài §6.1 mô tả: capability do backend cấp, FE không đoán.
func TestSystemCapabilitiesFromConfirmedBoard(t *testing.T) {
	core := boardCapCore{cap: capabilities.BoardCap{
		Map:   capabilities.BoardCapUI16 | capabilities.BoardCapDI8 | capabilities.BoardCapAO4 | capabilities.BoardCapDO4 | capabilities.BoardCapRTD,
		Known: true,
	}}
	w, body := getCapabilities(t, core, RoleViewer)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if body["board_cap_known"] != true {
		t.Fatalf("board_cap_known = %#v", body["board_cap_known"])
	}
	if body["board_cap_map"] != "0x001F" {
		t.Fatalf("board_cap_map = %#v", body["board_cap_map"])
	}
	ui := capabilityBlock(t, body, "UI")
	if ui["presence"] != "yes" || ui["count"] != float64(16) {
		t.Fatalf("khối UI = %#v", ui)
	}
	if got := firstChannelMode(t, ui, "PT100")["availability"]; got != "confirmed" {
		t.Fatalf("PT100 trên bo có RTD = %#v", got)
	}
	di := capabilityBlock(t, body, "DI")
	if di["presence"] != "yes" || di["count"] != float64(8) {
		t.Fatalf("khối DI khi bo xác nhận module = %#v", di)
	}
}

// Ca trung tâm: chưa hỏi được bo. Endpoint vẫn 200 — im lặng hay 503 sẽ đẩy FE
// về đúng chỗ cũ là tự đoán — nhưng nói rõ mình chưa biết, không công bố kênh
// DI tuỳ chọn nào, và GIỮ LẠI nhiệt trở.
func TestSystemCapabilitiesFailsClosedWhenBoardNotAsked(t *testing.T) {
	w, body := getCapabilities(t, boardCapCore{err: errors.New("iobus offline")}, RoleViewer)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if body["board_cap_known"] != false {
		t.Fatalf("board_cap_known = %#v", body["board_cap_known"])
	}
	if _, present := body["board_cap_map"]; present {
		t.Fatalf("chưa hỏi được mà vẫn phát board_cap_map = %#v", body["board_cap_map"])
	}
	ui := capabilityBlock(t, body, "UI")
	if ui["presence"] != "unknown" || ui["count"] != float64(16) {
		t.Fatalf("khối UI khi chưa biết = %#v", ui)
	}
	for _, id := range []string{"PT100", "PT1000"} {
		if got := firstChannelMode(t, ui, id)["availability"]; got != "withheld" {
			t.Fatalf("%s khi chưa hỏi được = %#v", id, got)
		}
	}
	di := capabilityBlock(t, body, "DI")
	if di["presence"] != "unknown" || di["count"] != float64(0) {
		t.Fatalf("khối DI khi chưa biết = %#v", di)
	}
	if channels := di["channels"].([]any); len(channels) != 0 {
		t.Fatalf("bịa ra %d kênh DI trên bo chưa xác nhận module", len(channels))
	}
}

// `overview.go` từng viết cứng `DigitalInputs: 0` kèm chú thích khẳng định đó là
// "hằng của SKU". Nó không phải hằng — và khi bo nói có module DI thì trang
// Overview phải nói theo bo.
func TestOverviewCapabilitiesFollowBoardCapMap(t *testing.T) {
	core := boardCapCore{cap: capabilities.BoardCap{
		Map:   capabilities.BoardCapUI16 | capabilities.BoardCapDI8 | capabilities.BoardCapAO4 | capabilities.BoardCapDO4,
		Known: true,
	}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/overview", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Capabilities OverviewCapabilities `json:"capabilities"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Capabilities.DigitalInputs != 8 {
		t.Fatalf("digitalInputs = %d; bo quảng cáo IOP_BOARD_CAP_DI_8", body.Capabilities.DigitalInputs)
	}
	if !body.Capabilities.BoardCapKnown {
		t.Fatalf("boardCapKnown = false trong khi bản đồ đã đọc được")
	}
}

// Ca ngược: chưa hỏi được thì `digitalInputs: 0` vẫn giữ nguyên như trước, NHƯNG
// `boardCapKnown: false` nói rõ con số 0 đó là "chưa biết" chứ không phải "bo
// không có DI". Không có trường này thì hai tình huống trông y hệt nhau.
func TestOverviewMarksCapabilitiesUnconfirmed(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleViewer, boardCapCore{err: errors.New("iobus offline")})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/overview", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	var body struct {
		Capabilities OverviewCapabilities `json:"capabilities"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Capabilities.DigitalInputs != 0 || body.Capabilities.UniversalInputs != 16 {
		t.Fatalf("capabilities khi chưa biết = %#v", body.Capabilities)
	}
	if body.Capabilities.BoardCapKnown {
		t.Fatalf("boardCapKnown = true trong khi chưa đọc được bản đồ")
	}
}

// `PUT /system/config/io` phải từ chối PT100 khi bo NÓI RÕ là không có mạch RTD.
// Đây là nửa "không CHO ghi" của tiêu chí thứ ba.
func TestPutConfigIORejectsRTDWhenBoardLacksCircuit(t *testing.T) {
	core := boardCapCore{cap: capabilities.BoardCap{
		Map:   capabilities.BoardCapUI16 | capabilities.BoardCapAO4 | capabilities.BoardCapDO4,
		Known: true,
	}}
	app, token := newTestAppWithRole(t, RoleAdmin, core)
	body := `{"ui":[{"ch":1,"type":"PT100"}],"ao":[],"do":[]}`
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/io", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s; muốn 400", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "ui[0].type") {
		t.Fatalf("lỗi không chỉ vào ui[0].type: %s", w.Body.String())
	}
}

// ...và phải CHO ghi khi chưa hỏi được bo. Chặn ở ca "chưa biết" sẽ làm mọi bo
// đang không chạy iobus mất khả năng lưu lại chính cấu hình nhiệt trở nó đang
// dùng thật — hỏng tệ hơn cái nó định tránh.
func TestPutConfigIOAllowsRTDWhenBoardNotAsked(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleAdmin, boardCapCore{err: errors.New("iobus offline")})
	body := `{"ui":[{"ch":1,"type":"PT100"}],"ao":[],"do":[]}`
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/io", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code == http.StatusBadRequest && strings.Contains(w.Body.String(), "mạch nhiệt trở") {
		t.Fatalf("chưa hỏi được bo mà đã chặn ghi PT100: %s", w.Body.String())
	}
}

// decodeBoardCap phải phân biệt BA tình huống mà một `uint16` đơn độc gộp làm
// một: đã hỏi được, đã hỏi và bo trả 0, và producer đời cũ không bao giờ điền.
func TestDecodeBoardCapDistinguishesUnknownFromEmpty(t *testing.T) {
	full := make([]byte, kxIOShmBoardCapLen)
	binary.LittleEndian.PutUint16(full[offIOBoardCapMap:offIOBoardCapMap+2], 0x001D)
	full[offIOBoardCapValid] = 1
	got := decodeBoardCap(full)
	if !got.Known || got.Map != 0x001D {
		t.Fatalf("segment đầy đủ: %#v", got)
	}

	notAsked := make([]byte, kxIOShmBoardCapLen)
	binary.LittleEndian.PutUint16(notAsked[offIOBoardCapMap:offIOBoardCapMap+2], 0x001D)
	notAsked[offIOBoardCapValid] = 0
	if got := decodeBoardCap(notAsked); got.Known {
		t.Fatalf("valid=0 mà vẫn báo đã biết: %#v", got)
	}

	emptyButAsked := make([]byte, kxIOShmBoardCapLen)
	emptyButAsked[offIOBoardCapValid] = 1
	if got := decodeBoardCap(emptyButAsked); !got.Known || got.Map != 0 {
		t.Fatalf("bo trả 0x0000 là câu trả lời HỢP LỆ, không phải 'chưa biết': %#v", got)
	}

	// Producer đời cũ: segment dừng trước hai trường mới. Đọc padding ra 0 rồi
	// coi là "bo không có năng lực nào" sẽ là một lời khẳng định bịa.
	legacy := make([]byte, kxIOShmIOPGapLen)
	if got := decodeBoardCap(legacy); got.Known {
		t.Fatalf("segment đời cũ mà báo đã biết: %#v", got)
	}
}
