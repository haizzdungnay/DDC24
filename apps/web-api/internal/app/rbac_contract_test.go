package app

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	webAuth "mkddc-web/internal/auth"
)

/*
`T59-816` — `x-rbac` trong OpenAPI phải khớp CHÍNH XÁC bảng route của server.

Vì sao cần một cổng chứ không phải một quy ước: `x-rbac` là bản mô tả duy nhất
mà người tích hợp đọc để biết "vai nào gọi được endpoint này". Nó không tham gia
runtime, nên khi nó sai thì KHÔNG có gì đỏ — chỉ có một tài liệu nói dối về ranh
giới bảo mật. Lớp lỗi này đã xảy ra thật ngay trong `T59-816`: bốn route
Simulation chuyển sang `simulation.run` (admin-only) mà `x-rbac` vẫn ghi
`[engineer, admin]`, tức tài liệu mời một vai đi vào cửa đã khoá.

Bộ này so hai chiều. Một chiều thôi thì "đạt" được bằng cách sai: xoá hết
`x-rbac` cũng làm chiều "mọi x-rbac phải đúng" xanh.
*/

var (
	openAPIPathLine   = regexp.MustCompile(`^  (/[^:]*):\s*$`)
	openAPIMethodLine = regexp.MustCompile(`^    (get|put|post|delete|patch|head|options):\s*$`)
	openAPIRBACLine   = regexp.MustCompile(`^      x-rbac:\s*\[(.*)\]\s*$`)
)

// openAPIRBAC đọc `METHOD /api/v1<path>` → danh sách vai từ đặc tả.
func openAPIRBAC(t *testing.T) map[string][]string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "contracts", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	declared := map[string][]string{}
	currentPath, currentMethod := "", ""
	for _, line := range strings.Split(string(raw), "\n") {
		if match := openAPIPathLine.FindStringSubmatch(line); match != nil {
			currentPath, currentMethod = match[1], ""
			continue
		}
		if match := openAPIMethodLine.FindStringSubmatch(line); match != nil {
			currentMethod = strings.ToUpper(match[1])
			continue
		}
		match := openAPIRBACLine.FindStringSubmatch(line)
		if match == nil || currentPath == "" || currentMethod == "" {
			continue
		}
		roles := []string{}
		for _, role := range strings.Split(match[1], ",") {
			role = strings.TrimSpace(role)
			if role != "" {
				roles = append(roles, role)
			}
		}
		sort.Strings(roles)
		declared[currentMethod+" /api/v1"+currentPath] = roles
	}
	if len(declared) < 100 {
		t.Fatalf("chỉ đọc được %d mục x-rbac; parser hoặc đặc tả có vấn đề", len(declared))
	}
	return declared
}

// serverRBAC dựng cùng bản đồ từ bảng route Go — nguồn sự thật duy nhất.
func serverRBAC(t *testing.T) map[string][]string {
	t.Helper()
	app := &App{}
	app.cfg.ProgrammingRevA = true
	actual := map[string][]string{}
	for _, route := range app.routeTable() {
		if route.Permission == "" {
			continue
		}
		roles := []string{}
		for _, role := range webAuth.RolesWithPermission(route.Permission) {
			roles = append(roles, string(role))
		}
		sort.Strings(roles)
		actual[route.Pattern] = roles
	}
	return actual
}

func TestOpenAPIRBACMatchesServerRouteTable(t *testing.T) {
	declared := openAPIRBAC(t)
	actual := serverRBAC(t)

	checked := 0
	for pattern, wantRoles := range actual {
		gotRoles, documented := declared[pattern]
		if !documented {
			// Không phải mọi route đều có mặt trong đặc tả công khai; chỉ soi
			// những route đã được mô tả. Chiều ngược lại bắt phần thiếu.
			continue
		}
		checked++
		if strings.Join(gotRoles, ",") != strings.Join(wantRoles, ",") {
			t.Errorf("%s: x-rbac = %v; bảng route cho %v",
				pattern, gotRoles, wantRoles)
		}
	}
	if checked < 100 {
		t.Fatalf("chỉ đối chiếu được %d route; ghép pattern có vẻ hỏng", checked)
	}

	publicPatterns := map[string]bool{}
	app := &App{}
	app.cfg.ProgrammingRevA = true
	for _, route := range app.routeTable() {
		if route.Permission == "" && route.Role == "" {
			publicPatterns[route.Pattern] = true
		}
	}

	for pattern, roles := range declared {
		if _, exists := actual[pattern]; exists {
			continue
		}
		reason, excepted := authenticatedOnlyExceptions[pattern]
		if !excepted {
			t.Errorf("%s: đặc tả khai x-rbac nhưng server không có route được bảo vệ nào khớp",
				pattern)
			continue
		}
		// Ngoại lệ vẫn phải chứng minh được, không chỉ được liệt kê: route
		// phải TỒN TẠI trong bảng dưới dạng công khai (uỷ quyền nằm trong
		// handler), và `x-rbac` phải nói đúng "mọi vai đã đăng nhập".
		if !publicPatterns[pattern] {
			t.Errorf("%s: nằm trong danh sách ngoại lệ (%s) nhưng không có route công khai nào khớp",
				pattern, reason)
		}
		if len(roles) != len(webAuth.AllRoles()) {
			t.Errorf("%s: ngoại lệ %q phải mở cho mọi vai đã đăng nhập; x-rbac = %v",
				pattern, reason, roles)
		}
	}
}

/*
Route xác thực TRONG handler thay vì ở router.

Chỉ có một, và nó có lý do kỹ thuật cứng: WebSocket của trình duyệt không gửi
được header `Authorization`, nên token đi qua `Sec-WebSocket-Protocol` và chỉ
đọc được sau khi request đã tới handler. Danh sách này cố ý ngắn và phải có lý
do viết ra — thêm một mục vào đây là bỏ một route ra khỏi cổng uỷ quyền tập
trung.
*/
var authenticatedOnlyExceptions = map[string]string{
	"GET /api/v1/ws/monitor": "WebSocket: token đi qua Sec-WebSocket-Protocol, uỷ quyền nằm trong requireWSAuth",
}

/*
Ranh giới `ADR-053` viết thành số: điều khiển mô phỏng chỉ admin, và cả bốn
route điều khiển đều phải nói vậy trong đặc tả.
*/
func TestOpenAPIKeepsSimulationControlAdminOnly(t *testing.T) {
	declared := openAPIRBAC(t)
	control := []string{
		"POST /api/v1/programming/simulation/sessions",
		"DELETE /api/v1/programming/simulation/sessions/{sessionId}",
		"POST /api/v1/programming/simulation/sessions/{sessionId}/actions",
		"PUT /api/v1/programming/simulation/sessions/{sessionId}/inputs/{observationId}",
	}
	for _, pattern := range control {
		roles, documented := declared[pattern]
		if !documented {
			t.Errorf("%s: không có x-rbac trong đặc tả", pattern)
			continue
		}
		if len(roles) != 1 || roles[0] != "admin" {
			t.Errorf("%s: x-rbac = %v; ADR-053 đặt admin-only", pattern, roles)
		}
	}
}
