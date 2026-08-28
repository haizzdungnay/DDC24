package app

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Test đồng bộ BỀ MẶT HTTP: mọi route đăng ký phải có trong `openapi.yaml`, và
// mọi path khai trong `openapi.yaml` phải có route thật.
//
// Vì sao cần: `contract_sync_test.go` (MBR-B004) đã canh *tên field* của schema,
// nhưng KHÔNG canh *danh sách path*. Khoảng trống đó để lọt hai lớp lỗi ngược
// chiều nhau, cả hai đều im lặng ở build và runtime:
//
//  1. Spec thừa — bảy path `/ota/*`, `/logs/download`, `/bacnet/objects`,
//     `/graph/*` được khai mà chưa từng có handler. Generator vẫn sinh client,
//     và FE đã thật sự viết `client.validateGraph()` gọi `POST /graph/validate`
//     — một lời gọi chỉ có thể trả 404. Nó không nổ vì tình cờ không ai gọi hàm
//     đó, chứ không phải vì có gì chặn.
//  2. Code thừa — 13 endpoint đang chạy (`/modbus/frames`, `/alarms/metrics`,
//     `/me/preferences`, …) không hề có trong spec, nên client sinh từ contract
//     thiếu hẳn các bề mặt này và mọi phép đếm độ phủ API đều sai.
//
// Test đọc file contract THẬT và bảng route THẬT (`routeTable()`), không dùng
// bản sao: một bản sao sẽ trôi cùng lúc với thứ nó phải canh gác.

// serverBasePath là prefix trong `servers[].url` của openapi.yaml. Path trong
// spec được ghi tương đối với nó.
const serverBasePath = "/api/v1"

// aliasRoutes là các route KHÔNG có mục riêng trong spec vì chúng là bí danh
// của một path đã khai. Danh sách này cố ý ngắn và phải giữ ngắn; mỗi mục là
// một ngoại lệ có lý do, không phải chỗ để giấu endpoint chưa tài liệu hoá.
var aliasRoutes = map[string]string{
	// Probe không phiên bản cho installer/systemd. Cùng handler với
	// `GET /api/v1/health`; spec mô tả nó ở mục `/health` dưới base `/api/v1`.
	"GET /health": "GET /api/v1/health",
}

// forbiddenInRevA chặn các bề mặt đã được quyết định đẩy sang Rev B quay lại
// contract Rev A một cách im lặng.
//
// `/ota/*` và `/bacnet/objects`: Rev B (quyết định sản phẩm 2026-08-20; OTA
// vốn đã nằm ngoài Rev A theo REVA_SCOPE_ROADMAP §3). `/graph/*` và
// `/logs/download`: phải implement TRƯỚC rồi mới được khai lại.
var forbiddenInRevA = []string{
	"/ota/",
	"/bacnet/objects",
	"/graph/",
	"/logs/download",
}

func openAPIPath(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, "contracts", "openapi", "openapi.yaml")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		dir = filepath.Dir(dir)
	}
	t.Skip("không tìm thấy contracts/openapi/openapi.yaml — bỏ qua test đồng bộ route")
	return ""
}

// specOperations trả về tập "METHOD /api/v1/<path>" khai trong openapi.yaml.
//
// Parser dựa trên thụt lề, đủ cho cấu trúc mà chính dự án viết ra: `paths:` ở
// cột 0, path ở thụt lề 2, method ở thụt lề 4. Cố tình KHÔNG kéo thêm thư viện
// YAML — phụ thuộc mới phải đi qua kiểm duyệt supply-chain, trong khi thứ cần
// đọc chỉ là khoá ở hai mức thụt lề cố định.
func specOperations(t *testing.T) map[string]bool {
	t.Helper()
	file, err := os.Open(openAPIPath(t))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	verbs := map[string]bool{
		"get": true, "post": true, "put": true, "delete": true,
		"patch": true, "head": true, "options": true,
	}
	out := map[string]bool{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	pathPattern := regexp.MustCompile(`^  (/\S*):\s*$`)
	verbPattern := regexp.MustCompile(`^    ([a-z]+):\s*$`)
	topLevel := regexp.MustCompile(`^[A-Za-z]`)

	inPaths := false
	current := ""
	for scanner.Scan() {
		line := scanner.Text()
		if topLevel.MatchString(line) {
			inPaths = strings.HasPrefix(line, "paths:")
			current = ""
			continue
		}
		if !inPaths {
			continue
		}
		if match := pathPattern.FindStringSubmatch(line); match != nil {
			current = match[1]
			continue
		}
		if current == "" {
			continue
		}
		if match := verbPattern.FindStringSubmatch(line); match != nil && verbs[match[1]] {
			out[strings.ToUpper(match[1])+" "+serverBasePath+current] = true
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if len(out) == 0 {
		t.Fatal("không đọc được operation nào từ openapi.yaml — parser hỏng")
	}
	return out
}

// registeredOperations dựng bảng route thật. `routeTable()` chỉ đọc `a.cfg` và
// tạo method value, không dereference receiver, nên một `App` rỗng là đủ.
// `ProgrammingRevA` bật để đếm cả bề mặt Programming — tắt nó đi thì test sẽ
// tưởng 30 path Programming trong spec là thừa.
func registeredOperations(t *testing.T) map[string]bool {
	t.Helper()
	application := &App{cfg: Config{ProgrammingRevA: true}}
	out := map[string]bool{}
	for _, route := range application.routeTable() {
		pattern := route.Pattern
		if canonical, ok := aliasRoutes[pattern]; ok {
			pattern = canonical
		}
		out[pattern] = true
	}
	return out
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func TestRouteTableMatchesOpenAPI(t *testing.T) {
	spec := specOperations(t)
	registered := registeredOperations(t)

	var missingFromSpec []string
	for _, operation := range sortedKeys(registered) {
		if !spec[operation] {
			missingFromSpec = append(missingFromSpec, operation)
		}
	}
	var missingFromCode []string
	for _, operation := range sortedKeys(spec) {
		if !registered[operation] {
			missingFromCode = append(missingFromCode, operation)
		}
	}

	if len(missingFromSpec) > 0 {
		t.Errorf("route ĐANG CHẠY nhưng KHÔNG có trong contracts/openapi/openapi.yaml (%d):\n  %s\n"+
			"Client sinh từ spec sẽ thiếu hẳn các bề mặt này. Khai chúng trong `paths:` rồi chạy lại.",
			len(missingFromSpec), strings.Join(missingFromSpec, "\n  "))
	}
	if len(missingFromCode) > 0 {
		t.Errorf("path khai trong openapi.yaml nhưng KHÔNG có route nào phục vụ (%d):\n  %s\n"+
			"Spec tự nhận là nguồn-chuẩn cho endpoint (D-4); khai endpoint không tồn tại sẽ sinh "+
			"client gọi vào hư không. Hoặc implement handler, hoặc gỡ khỏi contract Rev A.",
			len(missingFromCode), strings.Join(missingFromCode, "\n  "))
	}
}

func TestRevBSurfacesStayOutOfRevAContract(t *testing.T) {
	spec := specOperations(t)
	registered := registeredOperations(t)

	for _, operation := range append(sortedKeys(spec), sortedKeys(registered)...) {
		for _, forbidden := range forbiddenInRevA {
			if strings.Contains(operation, forbidden) {
				t.Errorf("%q quay lại bề mặt Rev A qua tiền tố %q.\n"+
					"OTA và BACnet object exposure thuộc Rev B; /graph/* và /logs/download phải "+
					"implement end-to-end TRƯỚC khi khai lại. Muốn đưa vào Rev A thì sửa "+
					"`forbiddenInRevA` kèm quyết định sản phẩm tương ứng.", operation, forbidden)
			}
		}
	}
}
