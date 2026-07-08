package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestVirtualIOCreateAllocatesBackingPoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-io", `{"direction":"input","valueType":"analog","label":"Room Setpoint","enabled":true,"displayMin":0,"displayMax":100}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var got VirtualIOPoint
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != "VI-01" || got.BackingPoint != "AV1" {
		t.Fatalf("created point = %+v, want VI-01 backed by AV1", got)
	}
	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "virtual_io.conf"))
	if err != nil {
		t.Fatalf("read virtual_io.conf: %v", err)
	}
	var cfg ConfigVirtualIO
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_io.conf: %v", err)
	}
	if len(cfg.Items) != 1 || cfg.Items[0].ID != "VI-01" {
		t.Fatalf("stored config = %+v", cfg)
	}
}

func TestVirtualIOCreateNormalizesBeforeAllocation(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-io", `{"direction":"OUTPUT","valueType":"Analog","label":"Demand","enabled":true,"displayMin":0,"displayMax":100}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var got VirtualIOPoint
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != "VO-01" || got.BackingPoint != "AV17" {
		t.Fatalf("created point = %+v, want VO-01 backed by AV17", got)
	}
}

func TestVirtualIOListMissingConfigReturnsEmptyArray(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodGet, "/api/v1/virtual-io", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if w.Body.String() != "[]\n" {
		t.Fatalf("body = %q, want []", w.Body.String())
	}
}

func TestVirtualIORejectsIDDirectionMismatch(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-io", `{"id":"VI-01","direction":"output","valueType":"analog","label":"Demand","enabled":true,"backingPoint":"AV17","displayMin":0,"displayMax":100}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if !hasValidationPath(t, w.Body.Bytes(), "items[0].id") {
		t.Fatalf("body missing id path: %s", w.Body.String())
	}
}

func TestVirtualIORejectsSignalTypeMismatch(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-io", `{"direction":"input","valueType":"binary","label":"Contact","enabled":true,"backingPoint":"BV1","signalType":9,"displayMin":0,"displayMax":1}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if !hasValidationPath(t, w.Body.Bytes(), "items[0].signalType") {
		t.Fatalf("body missing signalType path: %s", w.Body.String())
	}
}

func TestVirtualIOCreateSerializesAllocation(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	router := app.Router()
	const count = 6
	errs := make(chan string, count)
	var wg sync.WaitGroup

	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := newAuthRequest(http.MethodPost, "/api/v1/virtual-io", `{"direction":"output","valueType":"analog","label":"Demand","enabled":true,"displayMin":0,"displayMax":100}`, token)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusCreated {
				errs <- w.Body.String()
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("create failed: %s", err)
	}

	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "virtual_io.conf"))
	if err != nil {
		t.Fatalf("read virtual_io.conf: %v", err)
	}
	var cfg ConfigVirtualIO
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_io.conf: %v", err)
	}
	seen := map[string]bool{}
	for _, item := range cfg.Items {
		if seen[item.BackingPoint] {
			t.Fatalf("duplicate backingPoint in %+v", cfg.Items)
		}
		seen[item.BackingPoint] = true
	}
	if len(cfg.Items) != count {
		t.Fatalf("items = %d, want %d: %+v", len(cfg.Items), count, cfg.Items)
	}
}

func TestVirtualIORejectsDuplicateBackingPoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	body := `{"items":[
		{"id":"VI-01","direction":"input","valueType":"analog","label":"A","enabled":true,"backingPoint":"AV1","displayMin":0,"displayMax":100},
		{"id":"VI-02","direction":"input","valueType":"analog","label":"B","enabled":true,"backingPoint":"AV1","displayMin":0,"displayMax":100}
	]}`
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/virtual-io", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if !hasValidationPath(t, w.Body.Bytes(), "items[1].backingPoint") {
		t.Fatalf("body missing duplicate path: %s", w.Body.String())
	}
}

func TestVirtualIOBulkPutDefaultsEnabledTrue(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	body := `{"items":[{"id":"VI-01","direction":"input","valueType":"analog","label":"A","backingPoint":"AV1","displayMin":0,"displayMax":100}]}`
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/virtual-io", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "virtual_io.conf"))
	if err != nil {
		t.Fatalf("read virtual_io.conf: %v", err)
	}
	var cfg ConfigVirtualIO
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_io.conf: %v", err)
	}
	if len(cfg.Items) != 1 || !cfg.Items[0].Enabled {
		t.Fatalf("config = %+v, want enabled default true", cfg)
	}
}

func TestVirtualIORejectsReservedMSV1(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-io", `{"id":"VO-01","direction":"output","valueType":"multistate","label":"Mode","enabled":true,"backingPoint":"MSV1","displayMin":0,"displayMax":7}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if !hasValidationPath(t, w.Body.Bytes(), "items[0].backingPoint") {
		t.Fatalf("body missing backingPoint path: %s", w.Body.String())
	}
}

func TestVirtualIODeleteRemovesItem(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_io.conf")
	if err := os.WriteFile(path, []byte(`{"items":[{"id":"VI-01","direction":"input","valueType":"analog","label":"A","enabled":true,"backingPoint":"AV1","displayMin":0,"displayMax":100}]}`), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	req := newAuthRequest(http.MethodDelete, "/api/v1/virtual-io/VI-01", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read virtual_io.conf: %v", err)
	}
	var cfg ConfigVirtualIO
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse virtual_io.conf: %v", err)
	}
	if len(cfg.Items) != 0 {
		t.Fatalf("items = %+v, want empty", cfg.Items)
	}
	var result ConfigPutResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Result != "success" {
		t.Fatalf("result = %q, want success", result.Result)
	}
}

func TestCoreCommandPointIDCanonicalizesVirtualAliases(t *testing.T) {
	tests := map[string]string{
		"AV-01":  "AV1",
		"BV_09":  "BV9",
		"MSV-02": "MSV2",
	}
	for in, want := range tests {
		if got := coreCommandPointID(in); got != want {
			t.Fatalf("coreCommandPointID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCanonicalPointIDCanonicalizesVirtualAliases(t *testing.T) {
	tests := map[string]string{
		"AV-01":  "AV1",
		"BV_09":  "BV9",
		"MSV-02": "MSV2",
	}
	for in, want := range tests {
		if got := canonicalPointID(in); got != want {
			t.Fatalf("canonicalPointID(%q) = %q, want %q", in, got, want)
		}
	}
}

func hasValidationPath(t *testing.T, body []byte, path string) bool {
	t.Helper()
	var resp struct {
		Details []configValidationError `json:"details"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode validation body: %v", err)
	}
	return hasConfigErrorPath(resp.Details, path)
}
