package modbusrtu

import (
	"bufio"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// MBR-B004 — test so khớp field giữa BỐN lớp: canonical Go ↔ OpenAPI ↔ TypeScript ↔ C++.
//
// Vì sao cần: `F-API-14` (nâng thành OD-MBRTU-018) là một trường hợp thật của
// lớp lỗi này — Đ-05 đổi ngữ nghĩa `retry` ở FW/BE/FE nhưng `openapi.yaml` giữ
// mô tả cũ suốt nhiều tuần, và KHÔNG có test nào bắt được vì không có test nào
// đối chiếu contract với hành vi. Một field thêm ở Go mà quên khai ở OpenAPI
// cũng không gây lỗi build hay lỗi runtime: nó chỉ làm client sinh từ spec
// thiếu trường, và lỗi lộ ra ở hiện trường.
//
// Test này cố tình đọc file contract THẬT thay vì một bản sao trong test: bản
// sao sẽ trôi cùng lúc với thứ nó phải canh gác.

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "contracts", "openapi", "openapi.yaml")); err == nil {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	t.Skip("không tìm thấy thư mục contracts/ — bỏ qua test đồng bộ contract")
	return ""
}

// openAPIProperties trích tên field của một schema trong openapi.yaml.
//
// Parser dựa trên thụt lề, chỉ đủ cho các khối `properties:` phẳng mà chính dự
// án viết ra. Cố tình KHÔNG kéo thêm một thư viện YAML: phụ thuộc mới ở đây
// phải đi qua kiểm duyệt supply-chain, trong khi thứ cần kiểm chỉ là danh sách
// khoá ở một mức thụt lề cố định.
func openAPIProperties(t *testing.T, schema string) map[string]bool {
	t.Helper()
	path := filepath.Join(repoRoot(t), "contracts", "openapi", "openapi.yaml")
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	out := map[string]bool{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	inSchema := false
	inProperties := false
	propertyIndent := -1
	keyPattern := regexp.MustCompile(`^(\s*)([A-Za-z_][A-Za-z0-9_]*):`)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		match := keyPattern.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		indent, key := len(match[1]), match[2]

		if !inSchema {
			if indent == 4 && key == schema {
				inSchema = true
			}
			continue
		}
		// Rời khỏi schema khi gặp một schema khác ở cùng mức thụt lề.
		if indent <= 4 {
			break
		}
		if !inProperties {
			if key == "properties" && indent == 6 {
				inProperties = true
				propertyIndent = 8
			}
			continue
		}
		if indent < propertyIndent {
			inProperties = false
			continue
		}
		if indent == propertyIndent {
			out[key] = true
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if len(out) == 0 {
		t.Fatalf("không tìm thấy properties của schema %q trong openapi.yaml", schema)
	}
	return out
}

// jsonFields lấy tên JSON của mọi field public trong một struct Go.
func jsonFields(v any) map[string]bool {
	out := map[string]bool{}
	typ := reflect.TypeOf(v)
	for i := 0; i < typ.NumField(); i++ {
		tag := typ.Field(i).Tag.Get("json")
		if tag == "" || tag == "-" {
			continue
		}
		name := strings.Split(tag, ",")[0]
		if name != "" {
			out[name] = true
		}
	}
	return out
}

func assertGoFieldsDeclaredInOpenAPI(t *testing.T, schema string, value any) {
	t.Helper()
	spec := openAPIProperties(t, schema)
	for field := range jsonFields(value) {
		if !spec[field] {
			t.Errorf("field %q của Go struct KHÔNG có trong schema OpenAPI %q — "+
				"client sinh từ spec sẽ thiếu trường này", field, schema)
		}
	}
}

func TestGoStructFieldsAreDeclaredInOpenAPI(t *testing.T) {
	assertGoFieldsDeclaredInOpenAPI(t, "ModbusBus", Bus{})
	assertGoFieldsDeclaredInOpenAPI(t, "ModbusRTUDevice", Device{})
	assertGoFieldsDeclaredInOpenAPI(t, "ModbusRTUPoint", Point{})
	assertGoFieldsDeclaredInOpenAPI(t, "ModbusRTUDiagnostics", Diagnostics{})
	assertGoFieldsDeclaredInOpenAPI(t, "ModbusPortCapability", PortCapability{})
	assertGoFieldsDeclaredInOpenAPI(t, "ModbusDiffEntry", DiffEntry{})
}

// OD-MBRTU-018 / F-API-14: mô tả `retry` trong OpenAPI phải nói đúng ngữ nghĩa
// SAU Đ-05 ("số lần phát lại một giao dịch"), không phải ngưỡng OFFLINE.
func TestOpenAPIDescribesRetrySemanticsAfterDecision05(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "contracts", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	spec := string(raw)
	idx := strings.Index(spec, "    ModbusRTUDevice:")
	if idx < 0 {
		t.Fatal("không tìm thấy schema ModbusRTUDevice")
	}
	section := spec[idx:]
	if end := strings.Index(section, "\n    ModbusRTUPoint:"); end > 0 {
		section = section[:end]
	}
	if !strings.Contains(section, "phát lại") {
		t.Error("mô tả `retry` không nói rõ đây là số lần PHÁT LẠI một giao dịch")
	}
	if !strings.Contains(section, "offline_after_errors") {
		t.Error("thiếu `offline_after_errors` — ngưỡng OFFLINE phải là trường riêng (Đ-05)")
	}
	if !strings.Contains(section, "offline_probe_ms") {
		t.Error("thiếu `offline_probe_ms` (F-BE-20)")
	}
}

// SRC-F-02: các route nhạy cảm đã có thật phải xuất hiện trong contract, còn
// route roadmap phải được đánh dấu rõ để generator không coi là API khả dụng.
func TestOpenAPISeparatesRuntimeRoutesFromRoadmap(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "contracts", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	spec := string(raw)

	writeTest := openAPIPathSection(t, spec, "/modbus/write-test")
	for _, required := range []string{
		"x-rbac: [admin]",
		"required: [point_id, value]",
		"required: [point_id, applied_value, status]",
		`"429"`,
	} {
		if !strings.Contains(writeTest, required) {
			t.Errorf("/modbus/write-test thiếu contract %q", required)
		}
	}

	monitor := openAPIPathSection(t, spec, "/ws/monitor")
	for _, required := range []string{
		"x-websocket: true",
		"x-rbac: [viewer, operator, admin]",
		`"101"`,
	} {
		if !strings.Contains(monitor, required) {
			t.Errorf("/ws/monitor thiếu contract %q", required)
		}
	}

	for _, path := range []string{
		"/ota/upload", "/ota/apply", "/ota/status", "/logs/download",
		"/bacnet/objects", "/graph/validate", "/graph/deploy",
	} {
		if !strings.Contains(openAPIPathSection(t, spec, path), "x-implementation-status: not-implemented") {
			t.Errorf("route roadmap %s chưa được đánh dấu not-implemented", path)
		}
	}
}

func openAPIPathSection(t *testing.T, spec, path string) string {
	t.Helper()
	marker := "  " + path + ":"
	start := strings.Index(spec, marker)
	if start < 0 {
		t.Fatalf("OpenAPI thiếu path %s", path)
	}
	section := spec[start:]
	if end := strings.Index(section[len(marker):], "\n  /"); end >= 0 {
		section = section[:len(marker)+end]
	}
	return section
}

// Tập quality/reason phải khớp GIỮA BA lớp: enum C++ trong contract header, hàm
// map của Go, và enum trong OpenAPI. Lệch một mức nghĩa là FE hiện một chuỗi mà
// không tầng nào định nghĩa.
func TestQualityEnumMatchesAcrossContractLayers(t *testing.T) {
	root := repoRoot(t)
	header, err := os.ReadFile(filepath.Join(root, "contracts", "shm", "mkddc_shm.h"))
	if err != nil {
		t.Fatal(err)
	}
	spec, err := os.ReadFile(filepath.Join(root, "contracts", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}

	quality := []struct {
		cppSymbol string
		apiName   string
	}{
		{"KX_EXTQ_GOOD", "GOOD"},
		{"KX_EXTQ_STALE", "STALE"},
		{"KX_EXTQ_BAD", "BAD"},
		{"KX_EXTQ_OFFLINE", "OFFLINE"},
		{"KX_EXTQ_CONFIG_ERROR", "CONFIG_ERROR"},
	}
	for _, level := range quality {
		if !strings.Contains(string(header), level.cppSymbol) {
			t.Errorf("contract C++ thiếu %s", level.cppSymbol)
		}
		if !strings.Contains(string(spec), level.apiName) {
			t.Errorf("OpenAPI thiếu quality %q", level.apiName)
		}
	}

	reasons := []struct {
		cppSymbol string
		apiName   string
	}{
		{"KX_EXTR_NOT_INITIALIZED", "NOT_INITIALIZED"},
		{"KX_EXTR_CONFIG_ERROR", "CONFIG_ERROR"},
		{"KX_EXTR_DECODE_ERROR", "DECODE_ERROR"},
		{"KX_EXTR_OUT_OF_RANGE", "OUT_OF_RANGE"},
		{"KX_EXTR_TIMEOUT", "TIMEOUT"},
		{"KX_EXTR_CRC_ERROR", "CRC_ERROR"},
		{"KX_EXTR_PORT_DOWN", "PORT_DOWN"},
		{"KX_EXTR_DEVICE_EXCEPTION", "DEVICE_EXCEPTION"},
		{"KX_EXTR_WRITE_FAILED", "WRITE_FAILED"},
		{"KX_EXTR_BUS_OVERLOAD", "BUS_OVERLOAD"},
	}
	for _, reason := range reasons {
		if !strings.Contains(string(header), reason.cppSymbol) {
			t.Errorf("contract C++ thiếu %s", reason.cppSymbol)
		}
		if !strings.Contains(string(spec), reason.apiName) {
			t.Errorf("OpenAPI thiếu quality_reason %q", reason.apiName)
		}
	}
}

// Sức chứa Point phải khớp KX_N_EXT trong contract. Lệch nghĩa là BE cho lưu
// nhiều Point hơn iobus có slot, và các Point thừa im lặng biến mất khỏi bảng.
func TestMaxPointsMatchesContractCapacity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "contracts", "shm", "mkddc_shm.h"))
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`#define\s+KX_N_EXT\s+(\d+)`).FindStringSubmatch(string(raw))
	if match == nil {
		t.Fatal("không tìm thấy KX_N_EXT trong contract")
	}
	if match[1] != "256" || MaxPoints != 256 {
		t.Fatalf("KX_N_EXT=%s nhưng MaxPoints=%d — hai bên phải khớp", match[1], MaxPoints)
	}
}

// Cổng trong capability manifest mặc định phải khớp enum `port` của OpenAPI.
// Lệch nghĩa là UI dựng dropdown từ spec và người dùng chọn được một cổng mà
// validator từ chối (hoặc ngược lại).
func TestPortAllowlistMatchesOpenAPIEnum(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "contracts", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, port := range DefaultCapabilityManifest().Ports {
		if !strings.Contains(string(raw), port.Port) {
			t.Errorf("cổng %q có trong manifest nhưng không có trong OpenAPI", port.Port)
		}
	}
	if strings.Contains(string(raw), `"/dev/ttyS3"`) {
		t.Error("OpenAPI còn nhắc /dev/ttyS3 — cổng không tồn tại trên board production (D-14)")
	}
}

// Schema IPC control (MBR-B002) phải tồn tại và mô tả đủ 5 op mà iobus phục vụ.
func TestControlChannelSchemaCoversEveryOperation(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "contracts", "config",
		"modbus_control_v1.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"status", "apply_config", "write", "test_connection", "read_test"} {
		if !strings.Contains(string(raw), `"`+op+`"`) {
			t.Errorf("schema IPC thiếu op %q", op)
		}
	}
	// `applied` không được là kết quả hợp lệ của WriteResponse: lệnh mới vào
	// hàng đợi thì chưa ai biết slave có nhận hay không.
	writeResponse := string(raw)
	start := strings.Index(writeResponse, `"WriteResponse"`)
	if start < 0 {
		t.Fatal("schema thiếu WriteResponse")
	}
	section := writeResponse[start:]
	if end := strings.Index(section, `"WriteResult"`); end > 0 {
		section = section[:end]
	}
	if strings.Contains(section, `"applied"`) {
		t.Error("WriteResponse cho phép `applied` — vi phạm FW_SOM_DESIGN §8.2")
	}
}
