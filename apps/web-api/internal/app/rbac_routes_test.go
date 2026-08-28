package app

import (
	"testing"

	webAuth "mkddc-web/internal/auth"
)

/*
`WEB-RBAC-001` — mọi route được bảo vệ phải khai một QUYỀN có thật.

Bất biến này bắt đúng lớp lỗi mà mô hình quyền dễ mắc nhất: một route khai sai
tên quyền (gõ nhầm, hoặc quyền bị đổi tên) sẽ không khớp mục nào trong bảng và
`RoleHasPermission` từ chối TẤT CẢ — route trở thành 403 vĩnh viễn cho mọi vai,
kể cả admin, và không ai phát hiện cho tới khi có người dùng thật bấm vào nó.
*/
func TestEveryProtectedRouteDeclaresKnownPermission(t *testing.T) {
	routes := (&App{}).routeTable()
	if len(routes) == 0 {
		t.Fatal("bảng route rỗng")
	}
	protected := 0
	for _, route := range routes {
		if route.Permission == "" && route.Role == "" {
			continue // route công khai (login, health) — có kiểm riêng ở nơi khác
		}
		protected++
		if route.Role != "" {
			t.Errorf("%s: còn khai ngưỡng vai %q; mọi route phải chuyển sang quyền",
				route.Pattern, route.Role)
			continue
		}
		if !webAuth.RoleHasPermission(webAuth.RoleAdmin, route.Permission) {
			t.Errorf("%s: quyền %q không có trong bảng — route này 403 với MỌI vai",
				route.Pattern, route.Permission)
		}
	}
	if protected < 100 {
		t.Fatalf("chỉ thấy %d route được bảo vệ; bảng route có vẻ chưa dựng đủ", protected)
	}
}

/*
Vai `engineer` KHÔNG được chạm tới quản trị tài khoản, và admin phải chạm được
mọi thứ. Hai chiều cùng kiểm vì mỗi chiều một mình đều "đạt" được bằng cách sai.
*/
func TestEngineerReachesSettingsButNeverUserManagement(t *testing.T) {
	routes := (&App{}).routeTable()
	settings, users := 0, 0
	for _, route := range routes {
		switch route.Permission {
		case webAuth.PermissionSettingsManage:
			settings++
			if !webAuth.RoleHasPermission(webAuth.RoleEngineer, route.Permission) {
				t.Errorf("%s: engineer phải cấu hình được", route.Pattern)
			}
		case webAuth.PermissionUsersManage:
			users++
			if webAuth.RoleHasPermission(webAuth.RoleEngineer, route.Permission) {
				t.Errorf("%s: engineer KHÔNG được quản lý tài khoản", route.Pattern)
			}
		}
		if route.Permission != "" && !webAuth.RoleHasPermission(webAuth.RoleAdmin, route.Permission) {
			t.Errorf("%s: admin không với tới được", route.Pattern)
		}
	}
	if settings == 0 || users == 0 {
		t.Fatalf("phân loại quyền có vẻ sai: settings=%d users=%d", settings, users)
	}
}
