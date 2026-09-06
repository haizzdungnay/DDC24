package programminghttp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"

	"mkddc-web/internal/auth"
	webrouter "mkddc-web/internal/router"
)

type programmingRBACManifest struct {
	SchemaVersion string `json:"schemaVersion"`
	Operations    []struct {
		OperationID string   `json:"operationId"`
		Method      string   `json:"method"`
		Path        string   `json:"path"`
		Roles       []string `json:"roles"`
		Permission  string   `json:"permission"`
	} `json:"operations"`
}

// ISS-PGM-RBAC-01 — OpenAPI là contract công khai, routeDefinitions là hàng
// rào server và roleCan là hàng rào trình bày. Manifest được sinh từ OpenAPI;
// test này khóa hai nguồn đầu theo từng operation, thay vì chỉ so vài route
// mẫu hoặc một tổng đếm vẫn có thể xanh khi hai quyền bị đổi chéo cho nhau.
func TestProgrammingRBACManifestMatchesEveryServerRoute(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được đường dẫn security_matrix_test.go")
	}
	manifestPath := filepath.Clean(filepath.Join(filepath.Dir(thisFile),
		"../../../../../..", "contracts/programming/programming_rbac_manifest.json"))
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("đọc manifest RBAC Programming: %v", err)
	}
	var manifest programmingRBACManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse manifest RBAC Programming: %v", err)
	}
	if manifest.SchemaVersion != "1.0" {
		t.Fatalf("schemaVersion manifest = %q; want 1.0", manifest.SchemaVersion)
	}
	if len(manifest.Operations) != len(routeDefinitions) {
		t.Fatalf("manifest có %d operation; routeDefinitions có %d", len(manifest.Operations), len(routeDefinitions))
	}

	byRoute := make(map[string]struct {
		operationID string
		permission  string
		roles       []string
	}, len(manifest.Operations))
	operationIDs := make(map[string]struct{}, len(manifest.Operations))
	for _, operation := range manifest.Operations {
		key := operation.Method + " " + operation.Path
		if _, exists := byRoute[key]; exists {
			t.Fatalf("manifest trùng route %s", key)
		}
		if operation.OperationID == "" {
			t.Fatalf("manifest thiếu operationId cho %s", key)
		}
		if _, exists := operationIDs[operation.OperationID]; exists {
			t.Fatalf("manifest trùng operationId %s", operation.OperationID)
		}
		operationIDs[operation.OperationID] = struct{}{}
		byRoute[key] = struct {
			operationID string
			permission  string
			roles       []string
		}{operation.OperationID, operation.Permission, operation.Roles}
	}

	for _, definition := range routeDefinitions {
		key := definition.method + " " + definition.path
		declared, exists := byRoute[key]
		if !exists {
			t.Errorf("route server %s thiếu trong manifest OpenAPI", key)
			continue
		}
		if declared.operationID != definition.operationID {
			t.Errorf("%s: manifest operationId=%q; server=%q",
				key, declared.operationID, definition.operationID)
		}
		if declared.permission != string(definition.permission) {
			t.Errorf("%s (%s): manifest permission=%q; server=%q",
				key, declared.operationID, declared.permission, definition.permission)
		}
		serverRoles := auth.RolesWithPermission(definition.permission)
		wantRoles := make([]string, len(serverRoles))
		for index, role := range serverRoles {
			wantRoles[index] = string(role)
		}
		if strings.Join(declared.roles, ",") != strings.Join(wantRoles, ",") {
			t.Errorf("%s (%s): manifest roles=%v; server roles=%v",
				key, declared.operationID, declared.roles, wantRoles)
		}
		delete(byRoute, key)
	}
	if len(byRoute) != 0 {
		extra := make([]string, 0, len(byRoute))
		for key := range byRoute {
			extra = append(extra, key)
		}
		sort.Strings(extra)
		t.Fatalf("manifest có route không tồn tại ở server: %v", extra)
	}
}

// T59-603 — ma trận security cho TOÀN BỘ route Programming.
//
// Vì sao phải là ma trận sinh từ `routeDefinitions` chứ không phải vài case
// chọn tay: RBAC sai một route là đủ để mở một đường mutation cho viewer, và
// route mới thêm vào bảng sẽ KHÔNG có test nào phủ nếu danh sách case được chép
// tay. Cùng một lý do đã dùng cho corpus Control Library ở T59-601: phép đếm
// phải tính từ chính bảng khai báo.

// authorizerSpy đóng vai `auth.AuthService.Require` nhưng ghi lại role được yêu
// cầu và chặn đúng như production: thiếu quyền thì handler KHÔNG được gọi.
type authorizerSpy struct {
	role               auth.Role // role của "người gọi" trong kịch bản này
	authenticated      bool
	requiredRole       auth.Role
	requiredPermission auth.Permission
	handlerCalled      bool
}

/* `WEB-RBAC-001` chèn `engineer` vào giữa `operator` và `admin`; thứ hạng ở đây
 * phải khớp `auth.roleRank`, nếu không spy sẽ cho qua đúng những route mà
 * production chặn. */
func rank(role auth.Role) int {
	switch role {
	case auth.RoleAdmin:
		return 4
	case auth.RoleEngineer:
		return 3
	case auth.RoleOperator:
		return 2
	case auth.RoleViewer:
		return 1
	}
	return 0
}

func (s *authorizerSpy) Require(min auth.Role, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.requiredRole = min
		if !s.authenticated {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if rank(s.role) < rank(min) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		s.handlerCalled = true
		next(w, r)
	})
}

/* Bản quyền-theo-năng-lực của spy: cùng luật chặn, chỉ khác câu hỏi. */
func (s *authorizerSpy) RequirePermission(permission auth.Permission, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.requiredPermission = permission
		if !s.authenticated {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if !auth.RoleHasPermission(s.role, permission) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		s.handlerCalled = true
		next(w, r)
	})
}

func requestForRoute(definition routeDefinition) *http.Request {
	path := definition.path
	// Thay placeholder bằng giá trị hợp lệ về hình thức: mục tiêu là đi tới lớp
	// quyền, không phải đi tới store.
	replacements := map[string]string{
		"{projectId}":         "00000000-0000-4000-8000-000000000001",
		"{revisionId}":        "00000000-0000-4000-8000-000000000002",
		"{checkId}":           "00000000-0000-4000-8000-000000000003",
		"{operationId}":       "00000000-0000-4000-8000-000000000004",
		"{entryId}":           "00000000-0000-4000-8000-000000000005",
		"{libraryRevisionId}": "00000000-0000-4000-8000-00000000000a",
		"{traceId}":           "00000000-0000-4000-8000-000000000006",
		"{programId}":         "00000000-0000-4000-8000-000000000007",
		"{from}":              "00000000-0000-4000-8000-000000000008",
		"{to}":                "00000000-0000-4000-8000-000000000009",
	}
	for placeholder, value := range replacements {
		path = strings.ReplaceAll(path, placeholder, value)
	}
	body := strings.NewReader(`{"schemaVersion":"1.0"}`)
	request := httptest.NewRequest(definition.method, path, body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-0000000000ff")
	request.Header.Set("X-Correlation-ID", "security-matrix-0001")
	request.Header.Set("If-Match", `"1"`)
	return request
}

func mutates(definition routeDefinition) bool {
	// `readOnly` là lối ra DUY NHẤT khỏi "khác GET nghĩa là ghi", và nó phải
	// được khai trên chính bảng route. Suy ra từ tên đường dẫn (ví dụ "kết thúc
	// bằng /check") sẽ biến một route ghi đặt tên nhầm thành một route được
	// miễn mọi bảo vệ mà không ai thấy.
	return definition.method != http.MethodGet && !definition.readOnly
}

/*
`T61-401` — danh sách POST KHÔNG GHI, khoá bằng TÊN.

Cờ `readOnly` gỡ một route khỏi mọi bất biến của bề mặt mutation, nên nó phải
đắt: thêm một route mang cờ này mà không sửa danh sách dưới đây là đỏ. Đếm số
lượng thôi thì không đủ — đổi cờ từ route này sang route khác vẫn giữ nguyên số
đếm.
*/
func TestReadOnlyPostsAreEnumeratedAndDoNotWrite(t *testing.T) {
	expected := []string{
		"POST /api/v1/programming/projects/{projectId}/draft/bindings/preview",
		"POST /api/v1/programming/projects/{projectId}/library/entries/check",
	}
	actual := make([]string, 0, len(expected))
	for _, definition := range routeDefinitions {
		if definition.readOnly {
			actual = append(actual, definition.method+" "+definition.path)
		}
	}
	sort.Strings(actual)
	sort.Strings(expected)
	if strings.Join(actual, "\n") != strings.Join(expected, "\n") {
		t.Fatalf("route readOnly = %v; danh sách đã khoá là %v", actual, expected)
	}
	for _, definition := range routeDefinitions {
		if !definition.readOnly {
			continue
		}
		// Preview binding không ghi nhưng phải khóa vào đúng ảnh Draft; vì vậy nó
		// là ngoại lệ duy nhất được đòi If-Match. Dry run library không phụ thuộc
		// toàn bộ Draft nên vẫn không được đòi header này.
		preview := definition.path == "/api/v1/programming/projects/{projectId}/draft/bindings/preview"
		if (!preview && definition.ifMatchRequired) || definition.idempotencyRequired {
			t.Errorf("%s %s: route readOnly không được đòi If-Match/idempotency",
				definition.method, definition.path)
		}
		// Không bao giờ được đứng sau quyền kích hoạt: `program.activate` là mức
		// dành cho lúc chương trình bắt đầu điều khiển thiết bị thật.
		if definition.permission == auth.PermissionProgramActivate {
			t.Errorf("%s %s: route readOnly không được đòi program.activate",
				definition.method, definition.path)
		}
	}
}

func TestEveryProgrammingRouteRejectsUnauthenticatedBeforeHandler(t *testing.T) {
	for _, definition := range routeDefinitions {
		definition := definition
		t.Run(definition.method+" "+definition.path, func(t *testing.T) {
			spy := &authorizerSpy{authenticated: false}
			routes := []webrouter.Route{}
			RegisterProgrammingRoutes(&routes, true)
			mux, err := webrouter.New(spy, routes, nil)
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, requestForRoute(definition))

			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d; want 401", recorder.Code)
			}
			// Zero mutation: handler thậm chí không được GỌI. Kiểm "store không
			// đổi" là chưa đủ — một handler chạy rồi mới lỗi vẫn có thể đã ghi
			// audit, cấp phát scratch hoặc chạm Core.
			if spy.handlerCalled {
				t.Fatal("handler chạy dù request chưa xác thực")
			}
		})
	}
}

func TestEveryMutationRouteRequiresProgramPermissionAndBlocksViewerAndOperator(t *testing.T) {
	for _, definition := range routeDefinitions {
		definition := definition
		if !mutates(definition) {
			continue
		}
		t.Run(definition.method+" "+definition.path, func(t *testing.T) {
			/* `WEB-RBAC-001` — mutation không còn khai "admin" mà khai VIỆC nó
			   làm. Ba mức hợp lệ, và chỉ ba: sửa Draft (`program.edit`), chạm
			   tới thiết bị đang chạy (`program.activate`), hoặc điều khiển
			   phiên mô phỏng (`simulation.run`, `ADR-053`). Một mutation khai
			   `read` là lỗ hổng; khai `users.manage` là siết nhầm chỗ. */
			switch definition.permission {
			case auth.PermissionProgramEdit, auth.PermissionProgramActivate:
			case auth.PermissionSimulationRun:
				if !strings.Contains(definition.path, "/simulation/") {
					t.Fatalf("route ngoài họ simulation khai simulation.run")
				}
			default:
				t.Fatalf("route mutation phải khai program.edit, program.activate hoặc simulation.run, đang là %q",
					definition.permission)
			}
			/* `VS-PROG-U15` gọi tên CẢ HAI vai. Kiểm mỗi `viewer` là chưa đủ:
			   `operator` mới là vai có mặt trên tủ hằng ngày, và nó có
			   `operate` — quyền gần nhất với một mutation Programming. Nếu một
			   route nào đó lỡ khai `operate`, chỉ vòng lặp này bắt được. */
			for _, role := range []auth.Role{auth.RoleViewer, auth.RoleOperator} {
				spy := &authorizerSpy{authenticated: true, role: role}
				routes := []webrouter.Route{}
				RegisterProgrammingRoutes(&routes, true)
				mux, err := webrouter.New(spy, routes, nil)
				if err != nil {
					t.Fatal(err)
				}
				recorder := httptest.NewRecorder()
				mux.ServeHTTP(recorder, requestForRoute(definition))

				if recorder.Code != http.StatusForbidden {
					t.Fatalf("%s gọi mutation: status = %d; want 403", role, recorder.Code)
				}
				if spy.handlerCalled {
					t.Fatalf("%s: handler chạy dù thiếu quyền — mutation có thể đã xảy ra", role)
				}
				if spy.requiredPermission != definition.permission {
					t.Fatalf("quyền yêu cầu = %q; want %q", spy.requiredPermission, definition.permission)
				}
			}
		})
	}
}

func TestReadRoutesNeverRequireMoreThanViewer(t *testing.T) {
	// Chiều ngược lại của cùng bất biến: siết quá tay cũng là lỗi. Một route đọc
	// mà đòi admin sẽ làm người vận hành quyền viewer không xem được trạng thái
	// đúng lúc sự cố — và lỗi đó không bao giờ tự lộ ra trong test happy-path.
	/* Xét đúng route GET, như trước khi cờ `readOnly` tồn tại. Lý do của bất
	   biến này là QUAN SÁT lúc sự cố: một trạng thái chỉ đọc mà đòi admin sẽ
	   khoá người trực khỏi thứ họ cần nhìn. Một POST không ghi thì không phải
	   quan sát — nó là bước tiền kiểm của một lần GHI, nên nó đứng sau đúng
	   quyền của lần ghi ấy. Ràng buộc riêng cho nhóm đó nằm ở
	   `TestReadOnlyPostsAreEnumeratedAndDoNotWrite`. */
	for _, definition := range routeDefinitions {
		if definition.method != http.MethodGet {
			continue
		}
		if definition.permission != auth.PermissionRead {
			t.Errorf("%s %s: quyền = %q; route đọc phải là read",
				definition.method, definition.path, definition.permission)
		}
	}
}

func TestMutationRoutesDeclareIdempotencyAndConcurrencyGuards(t *testing.T) {
	// Mọi mutation phải khai `idempotencyRequired`: thiếu nó thì một lần bấm hai
	// lần (hoặc client retry sau timeout) thành hai thao tác thật trên thiết bị.
	for _, definition := range routeDefinitions {
		if !mutates(definition) {
			continue
		}
		if definition.method == http.MethodDelete && definition.path == "/api/v1/programming/runtime/traces/{traceId}" {
			// Xoá một phiên trace là thao tác tự-idempotent và không đổi trạng
			// thái điều khiển; ngoại lệ này được ghi rõ thay vì im lặng.
			continue
		}
		if !definition.idempotencyRequired {
			t.Errorf("%s %s: mutation thiếu idempotencyRequired",
				definition.method, definition.path)
		}
	}
}

func TestMutationBodyCapsAreBoundedAndExplicit(t *testing.T) {
	for _, definition := range routeDefinitions {
		if !mutates(definition) {
			continue
		}
		limit := definition.maxBodyBytes
		if limit == 0 {
			limit = maxMutationBodyBytes
		}
		if limit <= 0 || limit > maxBundleMutationBodyBytes {
			t.Errorf("%s %s: trần body = %d, ngoài dải cho phép",
				definition.method, definition.path, limit)
		}
	}
}

func TestErrorEnvelopeNeverLeaksRequestSecrets(t *testing.T) {
	// Thân request có thể chứa thứ không được vọng lại: header xác thực, khoá
	// idempotency, và với bundle import là cả payload người dùng. Envelope lỗi
	// phải nói ĐỦ để sửa mà không chép lại đầu vào.
	const secret = "Bearer super-secret-token-do-not-echo"
	spy := &authorizerSpy{authenticated: true, role: auth.RoleAdmin}
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(spy, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost,
		"/api/v1/programming/operations/commission",
		strings.NewReader(fmt.Sprintf(`{"schemaVersion":"1.0","note":%q}`, secret)))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", secret)
	request.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-0000000000fe")
	request.Header.Set("X-Correlation-ID", "security-matrix-secret")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)

	if strings.Contains(recorder.Body.String(), "super-secret-token") {
		t.Fatalf("envelope vọng lại secret: %s", recorder.Body.String())
	}
	for _, values := range recorder.Header() {
		for _, value := range values {
			if strings.Contains(value, "super-secret-token") {
				t.Fatalf("header vọng lại secret: %q", value)
			}
		}
	}
}

/*
`WEB-RBAC-001` — vai `engineer` phải LÀM ĐƯỢC việc của nó, và chỉ việc của nó.

Hai chiều cùng phải đúng, vì mỗi chiều một mình đều dễ "đạt" bằng cách sai: cho
engineer mọi quyền thì chiều thứ nhất xanh, còn không cho gì thì chiều thứ hai
xanh.
*/
func TestEngineerCanReachEveryProgrammingRouteAndOperatorCannotActivate(t *testing.T) {
	simulationControl := 0
	for _, definition := range routeDefinitions {
		if definition.permission == auth.PermissionSimulationRun {
			/* Ngoại lệ DUY NHẤT, và nó được viết ra chứ không lách qua: điều
			   khiển mô phỏng là admin-only theo `ADR-053` vì phiên sinh ra một
			   tiến trình worker có hạn ngạch RAM/CPU trên chính tủ. Engineer
			   vẫn ĐỌC được phiên (route GET khai `read`). */
			simulationControl++
			if auth.RoleHasPermission(auth.RoleEngineer, definition.permission) {
				t.Errorf("%s %s: engineer có simulation.run — ADR-053 đặt admin-only",
					definition.method, definition.path)
			}
			continue
		}
		if !auth.RoleHasPermission(auth.RoleEngineer, definition.permission) {
			t.Errorf("%s %s: engineer KHÔNG có %q — vai này tồn tại để làm việc Programming",
				definition.method, definition.path, definition.permission)
		}
	}
	if simulationControl != 4 {
		t.Fatalf("số route điều khiển mô phỏng = %d; want 4 (create/stop/action/input)", simulationControl)
	}

	activations := 0
	for _, definition := range routeDefinitions {
		if definition.permission == auth.PermissionProgramActivate {
			activations++
		}
		if definition.permission == auth.PermissionRead {
			continue
		}
		/* Thêm vai `engineer` KHÔNG được là dịp nới quyền cho vai đang có:
		   operator hôm nay không chạm được mutation nào của Programming, và sau
		   lát này vẫn phải như vậy. */
		if auth.RoleHasPermission(auth.RoleOperator, definition.permission) {
			t.Errorf("%s %s: operator được thêm quyền %q — lát này không được nới quyền vai cũ",
				definition.method, definition.path, definition.permission)
		}
	}
	if activations == 0 {
		t.Fatal("không có route nào khai program.activate — bảng route hoặc phép phân loại đã sai")
	}
}

/*
`VS-PROG-U15` — phép ĐẾM bề mặt mutation, viết thành số.

Con số trong kịch bản V&V (`14/14`) được viết khi bề mặt còn nhỏ hơn. Một kịch
bản nói "14/14" trong khi bảng route có 20 mutation là một kịch bản đã lỗi thời
mà không ai thấy — và cách duy nhất để nó không lỗi thời lần nữa là để phép đếm
tự chạy và tự đỏ.
*/
func TestMutationSurfaceCountIsRecordedNotAssumed(t *testing.T) {
	byPermission := map[auth.Permission]int{}
	total := 0
	for _, definition := range routeDefinitions {
		if !mutates(definition) {
			continue
		}
		total++
		byPermission[definition.permission]++
	}
	t.Logf("bề mặt mutation Programming: %d route — program.edit=%d, program.activate=%d, simulation.run=%d",
		total, byPermission[auth.PermissionProgramEdit],
		byPermission[auth.PermissionProgramActivate], byPermission[auth.PermissionSimulationRun])
	if total != 20 {
		t.Fatalf("bề mặt mutation = %d route; con số đã ghi trong record V&V là 20. "+
			"Thêm/bớt route thì phải cập nhật record, không sửa số ở đây cho khớp", total)
	}
}
