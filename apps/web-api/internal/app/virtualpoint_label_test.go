package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

/* Issue #789 — nhãn nhập lúc tạo Virtual Point phải sống qua: phản hồi tạo,
 * danh sách VP, `GET /points/{id}` (display_name) và một lần khởi động lại
 * (migration chạy mỗi lần boot). Trước bản vá cả bốn chỗ đều mất nhãn. */
func TestVirtualPointCreateKeepsLabelAsDisplayName(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	serve := func(req *http.Request) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		return w
	}

	created := serve(newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"TMP_LAYOUT_CHECK","label":"  Kiểm   bố cục tạm ","signalType":"float","enabled":true,"writable":true,"value":0}`, token))
	if created.Code != http.StatusCreated {
		t.Fatalf("POST = %d body=%s", created.Code, created.Body.String())
	}
	var item VirtualPoint
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if item.Label != "Kiểm bố cục tạm" || item.Tag != "TMP_LAYOUT_CHECK" {
		t.Fatalf("create response tag=%q label=%q; want TMP_LAYOUT_CHECK / Kiểm bố cục tạm", item.Tag, item.Label)
	}

	assertDisplay := func(stage string) {
		t.Helper()
		list := serve(newAuthRequest(http.MethodGet, "/api/v1/virtual-points", "", token))
		var items []VirtualPoint
		if err := json.Unmarshal(list.Body.Bytes(), &items); err != nil || len(items) != 1 || items[0].Label != "Kiểm bố cục tạm" {
			t.Fatalf("%s: GET /virtual-points = %s (err %v); want label kept", stage, list.Body.String(), err)
		}
		point := serve(newAuthRequest(http.MethodGet, "/api/v1/points/"+item.ID, "", token))
		var dto PointDTO
		if err := json.Unmarshal(point.Body.Bytes(), &dto); err != nil {
			t.Fatalf("%s: decode point: %v body=%s", stage, err, point.Body.String())
		}
		if dto.DisplayName != "Kiểm bố cục tạm" || dto.Tag != "TMP_LAYOUT_CHECK" {
			t.Fatalf("%s: GET /points/%s display_name=%q tag=%q; want label as display, tag unchanged", stage, item.ID, dto.DisplayName, dto.Tag)
		}
	}
	assertDisplay("sau khi tạo")

	if err := app.migrateLegacyPointConfig(); err != nil {
		t.Fatalf("migrateLegacyPointConfig: %v", err)
	}
	assertDisplay("sau migration khởi động")
}

// Issue #789: nhãn VP được kiểm trùng như đường đổi tên (WEB-NAME-001), trả
// lỗi có cấu trúc trỏ đúng `items[n].label` để FE tô đúng ô.
func TestVirtualPointCreateRejectsDuplicateLabel(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	serve := func(req *http.Request) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		return w
	}
	first := serve(newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"VP_A","label":"Phòng A","signalType":"float","enabled":true,"writable":true,"value":0}`, token))
	if first.Code != http.StatusCreated {
		t.Fatalf("POST first = %d body=%s", first.Code, first.Body.String())
	}
	dup := serve(newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"VP_B","label":"phòng  a","signalType":"float","enabled":true,"writable":true,"value":0}`, token))
	if dup.Code < 400 || dup.Code >= 500 {
		t.Fatalf("POST duplicate label = %d body=%s; want 4xx", dup.Code, dup.Body.String())
	}
	if !hasValidationPath(t, dup.Body.Bytes(), "items[1].label") {
		t.Fatalf("duplicate label error missing items[1].label path: %s", dup.Body.String())
	}

	// Không nhãn thì vẫn tạo được — tên hiển thị rơi về Tag như trước.
	blank := serve(newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"VP_C","signalType":"float","enabled":true,"writable":true,"value":0}`, token))
	if blank.Code != http.StatusCreated {
		t.Fatalf("POST blank label = %d body=%s", blank.Code, blank.Body.String())
	}
}

// Issue #789: đổi tên qua `PUT /points/{id}/config` (đường FE `updatePointName`)
// cũng phải lưu thật, không bị normalize xoá như trước.
func TestVirtualPointNamePatchPersists(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	serve := func(req *http.Request) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		return w
	}
	created := serve(newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"VP_RENAME","signalType":"float","enabled":true,"writable":true,"value":0}`, token))
	if created.Code != http.StatusCreated {
		t.Fatalf("POST = %d body=%s", created.Code, created.Body.String())
	}
	var item VirtualPoint
	_ = json.Unmarshal(created.Body.Bytes(), &item)
	patch := serve(newAuthRequest(http.MethodPut, "/api/v1/points/"+item.ID+"/config", `{"name":"Nhãn mới"}`, token))
	if patch.Code != http.StatusOK {
		t.Fatalf("PUT config = %d body=%s", patch.Code, patch.Body.String())
	}
	point := serve(newAuthRequest(http.MethodGet, "/api/v1/points/"+item.ID, "", token))
	var dto PointDTO
	_ = json.Unmarshal(point.Body.Bytes(), &dto)
	if dto.DisplayName != "Nhãn mới" {
		t.Fatalf("display_name after rename = %q; want Nhãn mới (body=%s)", dto.DisplayName, point.Body.String())
	}
}
