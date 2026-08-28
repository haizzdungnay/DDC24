package programminghttp

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mkddc-web/internal/auth"
	webrouter "mkddc-web/internal/router"
)

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
	return definition.method != http.MethodGet
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

func TestEveryMutationRouteRequiresProgramPermissionAndBlocksViewer(t *testing.T) {
	for _, definition := range routeDefinitions {
		definition := definition
		if !mutates(definition) {
			continue
		}
		t.Run(definition.method+" "+definition.path, func(t *testing.T) {
			/* `WEB-RBAC-001` — mutation không còn khai "admin" mà khai VIỆC nó
			   làm. Hai mức hợp lệ, và chỉ hai: sửa Draft (`program.edit`) hoặc
			   chạm tới thiết bị đang chạy (`program.activate`). Một mutation
			   khai `read` là lỗ hổng; khai `users.manage` là siết nhầm chỗ. */
			switch definition.permission {
			case auth.PermissionProgramEdit, auth.PermissionProgramActivate:
			default:
				t.Fatalf("route mutation phải khai program.edit hoặc program.activate, đang là %q",
					definition.permission)
			}
			spy := &authorizerSpy{authenticated: true, role: auth.RoleViewer}
			routes := []webrouter.Route{}
			RegisterProgrammingRoutes(&routes, true)
			mux, err := webrouter.New(spy, routes, nil)
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, requestForRoute(definition))

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("viewer gọi mutation: status = %d; want 403", recorder.Code)
			}
			if spy.handlerCalled {
				t.Fatal("handler chạy dù thiếu quyền — mutation có thể đã xảy ra")
			}
			if spy.requiredPermission != definition.permission {
				t.Fatalf("quyền yêu cầu = %q; want %q", spy.requiredPermission, definition.permission)
			}
		})
	}
}

func TestReadRoutesNeverRequireMoreThanViewer(t *testing.T) {
	// Chiều ngược lại của cùng bất biến: siết quá tay cũng là lỗi. Một route đọc
	// mà đòi admin sẽ làm người vận hành quyền viewer không xem được trạng thái
	// đúng lúc sự cố — và lỗi đó không bao giờ tự lộ ra trong test happy-path.
	for _, definition := range routeDefinitions {
		if mutates(definition) {
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
	for _, definition := range routeDefinitions {
		if !auth.RoleHasPermission(auth.RoleEngineer, definition.permission) {
			t.Errorf("%s %s: engineer KHÔNG có %q — vai này tồn tại để làm việc Programming",
				definition.method, definition.path, definition.permission)
		}
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
