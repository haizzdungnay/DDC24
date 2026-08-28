package router

import (
	"fmt"
	"net/http"

	"mkddc-web/internal/auth"
)

type Authorizer interface {
	Require(auth.Role, http.HandlerFunc) http.Handler
	RequirePermission(auth.Permission, http.HandlerFunc) http.Handler
}

type Route struct {
	Pattern string
	Role    auth.Role
	/*
	   `WEB-RBAC-001` — quyền theo NĂNG LỰC. Khai `Permission` thì nó THẮNG
	   `Role`: một route đã nói rõ nó cần việc gì thì ngưỡng vai chỉ còn là di
	   sản. Hai trường cùng tồn tại vì việc chuyển 109 route diễn ra theo nhóm,
	   và đổi tất cả trong một lần là cách chắc chắn nhất để sót một route mà
	   không ai thấy.
	*/
	Permission auth.Permission
	Handler    http.Handler
}

func Public(pattern string, handler http.Handler) Route {
	return Route{Pattern: pattern, Handler: handler}
}

func PublicFunc(pattern string, handler http.HandlerFunc) Route {
	return Public(pattern, handler)
}

func Protected(pattern string, role auth.Role, handler http.HandlerFunc) Route {
	return Route{Pattern: pattern, Role: role, Handler: handler}
}

/* Route khai QUYỀN thay vì ngưỡng vai — xem `Route.Permission`. */
func ProtectedPermission(pattern string, permission auth.Permission, handler http.HandlerFunc) Route {
	return Route{Pattern: pattern, Permission: permission, Handler: handler}
}

func New(authorizer Authorizer, routes []Route, fallback http.Handler) (*http.ServeMux, error) {
	mux := http.NewServeMux()
	seen := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if route.Pattern == "" || route.Handler == nil {
			return nil, fmt.Errorf("invalid route declaration")
		}
		if _, duplicate := seen[route.Pattern]; duplicate {
			return nil, fmt.Errorf("duplicate route %s", route.Pattern)
		}
		seen[route.Pattern] = struct{}{}
		handler := route.Handler
		if route.Permission != "" && route.Role != "" {
			/* Khai cả hai là một mâu thuẫn chưa được giải, không phải một cấu
			   hình "chặt hơn": người đọc không biết cái nào đang có hiệu lực. */
			return nil, fmt.Errorf("route %s khai cả Role lẫn Permission", route.Pattern)
		}
		if route.Permission != "" || route.Role != "" {
			if authorizer == nil {
				return nil, fmt.Errorf("authorizer is required for %s", route.Pattern)
			}
			function, ok := route.Handler.(http.HandlerFunc)
			if !ok {
				return nil, fmt.Errorf("protected route %s must use HandlerFunc", route.Pattern)
			}
			if route.Permission != "" {
				handler = authorizer.RequirePermission(route.Permission, function)
			} else {
				handler = authorizer.Require(route.Role, function)
			}
		}
		mux.Handle(route.Pattern, handler)
	}
	if fallback != nil {
		mux.Handle("/", fallback)
	}
	return mux, nil
}
