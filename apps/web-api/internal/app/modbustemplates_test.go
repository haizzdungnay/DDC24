package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// `T57-3.11` — mẫu thiết bị Modbus.
//
// Luật quan trọng nhất KHÔNG phải "trả đúng danh sách" mà là **không bịa thông
// số**: một bảng thanh ghi đoán còn nguy hiểm hơn không có mẫu nào, vì người
// dùng tin mẫu hơn tin tài liệu và số sai đi thẳng vào lịch sử vận hành.

func TestModbusTemplateRejectsEntriesWithoutSource(t *testing.T) {
	noSource := ModbusTemplate{ID: "x", Points: []ModbusTemplatePoint{{Name: "A", FC: 3, Count: 1}}}
	if validModbusTemplate(noSource) {
		t.Fatalf("mẫu không nói được nó đến từ đâu thì KHÔNG được hiển thị")
	}

	noPoints := ModbusTemplate{ID: "x", Source: "tài liệu hãng"}
	if validModbusTemplate(noPoints) {
		t.Fatalf("mẫu rỗng điểm là mẫu vô dụng")
	}

	badPoint := ModbusTemplate{ID: "x", Source: "tài liệu hãng", Points: []ModbusTemplatePoint{{Name: "", FC: 3, Count: 1}}}
	if validModbusTemplate(badPoint) {
		t.Fatalf("điểm thiếu tên không dùng được")
	}
}

func TestBuiltinModbusTemplatesAllCiteASource(t *testing.T) {
	if len(builtinModbusTemplates) == 0 {
		t.Skip("chưa có mẫu dựng sẵn nào")
	}
	for _, template := range builtinModbusTemplates {
		if !validModbusTemplate(template) {
			t.Fatalf("mẫu dựng sẵn %q không qua được chính luật của mình", template.ID)
		}
	}
}

func TestSiteTemplateOverridesBuiltinWithSameID(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	site := `[{"id":"mtr-1","name":"Bản của công trình","source":"tài liệu lô thiết bị 2026-08",` +
		`"points":[{"name":"MB-KWH","fc":3,"addr":10,"count":2,"type":"uint32"}]}]`
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "modbus_templates.json"), []byte(site), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/templates", ``, token)
	assertStatus(t, resp, http.StatusOK)
	var templates []ModbusTemplate
	if err := json.Unmarshal(resp.Body.Bytes(), &templates); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for _, template := range templates {
		if template.ID != "mtr-1" {
			continue
		}
		if template.Origin != "site" || template.Points[0].Addr != 10 {
			t.Fatalf("bản của công trình phải thắng bản dựng sẵn: %+v", template)
		}
		return
	}
	t.Fatalf("không thấy mẫu mtr-1 trong danh sách: %+v", templates)
}

func TestBrokenSiteTemplateFileIsIgnoredWholesale(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "modbus_templates.json"), []byte("{ hỏng"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/templates", ``, token)
	assertStatus(t, resp, http.StatusOK)
	var templates []ModbusTemplate
	if err := json.Unmarshal(resp.Body.Bytes(), &templates); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Tệp hỏng ⇒ bỏ qua CẢ tệp, giữ nguyên mẫu dựng sẵn. Ghép từ JSON dở dang
	// là đúng thứ luật "không bịa" cấm.
	if len(templates) != len(builtinModbusTemplates) {
		t.Fatalf("số mẫu = %d; want %d (chỉ còn bản dựng sẵn)", len(templates), len(builtinModbusTemplates))
	}
}
