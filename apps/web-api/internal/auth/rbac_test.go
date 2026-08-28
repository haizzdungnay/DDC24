package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

/*
`WEB-RBAC-001/002` — bốn vai theo NĂNG LỰC, và token phải chết khi vai đổi.

Trọng tâm của bộ này là hai bất biến, cả hai đều là chống-leo-thang:

 1. Thêm vai `engineer` KHÔNG được nới quyền cho vai đang có.
 2. Hạ vai hoặc xoá tài khoản phải làm token đã cấp mất hiệu lực NGAY, không
    phải sau khi nó hết hạn.
*/


func TestRoleHasPermissionMatrix(t *testing.T) {
	// Bảng viết tay, KHÔNG sinh từ chính hàm đang kiểm: một ma trận suy ra từ
	// cài đặt thì luôn "đúng" và không phát hiện được gì.
	expected := map[Role]map[Permission]bool{
		RoleViewer: {
			PermissionRead: true, PermissionSelfManage: true,
			PermissionOperate: false, PermissionProgramEdit: false, PermissionProgramActivate: false,
			PermissionSettingsManage: false, PermissionDatabaseManage: false,
			PermissionUsersManage: false, PermissionSystemRelease: false,
			PermissionSimulationRun: false,
		},
		RoleOperator: {
			PermissionRead: true, PermissionSelfManage: true, PermissionOperate: true,
			PermissionProgramEdit: false, PermissionProgramActivate: false,
			PermissionSettingsManage: false, PermissionDatabaseManage: false,
			PermissionUsersManage: false, PermissionSystemRelease: false,
			PermissionSimulationRun: false,
		},
		RoleEngineer: {
			PermissionRead: true, PermissionSelfManage: true, PermissionOperate: true,
			PermissionProgramEdit: true, PermissionProgramActivate: true,
			PermissionSettingsManage: true, PermissionSystemRelease: true,
			// Ba quyền engineer KHÔNG có — đây là lý do vai này tồn tại.
			PermissionDatabaseManage: false, PermissionUsersManage: false,
			/* `T59-816` — mô phỏng sinh tiến trình worker có hạn ngạch trên chính
			   tủ; `ADR-053` đặt ranh giới admin-only và lát RBAC không nới nó. */
			PermissionSimulationRun: false,
		},
		RoleAdmin: {
			PermissionRead: true, PermissionSelfManage: true, PermissionOperate: true,
			PermissionProgramEdit: true, PermissionProgramActivate: true,
			PermissionSettingsManage: true, PermissionDatabaseManage: true,
			PermissionUsersManage: true, PermissionSystemRelease: true,
			PermissionSimulationRun: true,
		},
	}

	for _, role := range AllRoles() {
		for _, permission := range AllPermissions() {
			want, declared := expected[role][permission]
			if !declared {
				t.Fatalf("bảng kỳ vọng thiếu %s/%s", role, permission)
			}
			if got := RoleHasPermission(role, permission); got != want {
				t.Errorf("RoleHasPermission(%s, %s) = %v; want %v", role, permission, got, want)
			}
		}
	}
}

func TestUnknownRoleAndPermissionAreDeniedEvenForAdmin(t *testing.T) {
	// Một route khai sai tên quyền phải hỏng ở lúc gọi, KHÔNG được im lặng mở
	// cho vai cao nhất — nếu không, một lỗi chính tả thành một cửa hậu.
	if RoleHasPermission(RoleAdmin, Permission("settings.manage.typo")) {
		t.Error("quyền không có trong bảng vẫn mở cho admin")
	}
	if RoleHasPermission(Role("superuser"), PermissionRead) {
		t.Error("vai lạ vẫn đọc được")
	}
}

func TestEngineerRankSitsBetweenOperatorAndAdmin(t *testing.T) {
	// `Require(min Role)` cũ vẫn dùng thứ hạng; chèn một bậc mà xếp sai chỗ sẽ
	// nới lỏng mọi route đang đòi admin.
	if !RoleAllows(RoleEngineer, RoleOperator) {
		t.Error("engineer phải làm được việc của operator")
	}
	if RoleAllows(RoleEngineer, RoleAdmin) {
		t.Error("engineer KHÔNG được thoả ngưỡng admin")
	}
	if !RoleAllows(RoleAdmin, RoleEngineer) {
		t.Error("admin phải thoả ngưỡng engineer")
	}
}

func TestRequirePermissionAllowsAndBlocks(t *testing.T) {
	service := newTestService(t)
	if err := service.AddUser("engineer1", RoleEngineer, "secret123"); err != nil {
		t.Fatal(err)
	}
	token, _, err := service.Authenticate("engineer1", "secret123", "127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}

	call := func(permission Permission) int {
		reached := false
		handler := service.RequirePermission(permission, func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusNoContent)
		})
		request := httptest.NewRequest(http.MethodGet, "/x", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusNoContent && reached {
			t.Fatal("handler chạy dù bị từ chối — mutation có thể đã xảy ra")
		}
		return recorder.Code
	}

	if status := call(PermissionSettingsManage); status != http.StatusNoContent {
		t.Errorf("engineer + settings.manage: status = %d; want 204", status)
	}
	if status := call(PermissionUsersManage); status != http.StatusForbidden {
		t.Errorf("engineer + users.manage: status = %d; want 403", status)
	}
}

func TestTokenDiesWhenRoleChangesOrAccountRemoved(t *testing.T) {
	/*
	   Lỗ hổng có thật trước lát này: token tự mang vai trong claim và `Validate`
	   tin claim đó. Hạ một tài khoản từ admin xuống viewer KHÔNG chạm được tới
	   token đã cấp, nên người vừa bị hạ quyền vẫn thao tác như admin cho tới
	   khi token hết hạn — tối đa một giờ.
	*/
	service := newTestService(t)
	if err := service.AddUser("temp_admin", RoleAdmin, "secret123"); err != nil {
		t.Fatal(err)
	}
	token, _, err := service.Authenticate("temp_admin", "secret123", "127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	principal, err := service.Validate(token)
	if err != nil || principal.Role != RoleAdmin {
		t.Fatalf("token vừa cấp phải dùng được: %v", err)
	}

	if err := service.SetRole("temp_admin", RoleViewer); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Validate(token); err == nil {
		t.Fatal("token cũ vẫn hợp lệ sau khi hạ vai — người bị hạ quyền giữ nguyên quyền cũ")
	}

	// Xoá tài khoản cũng phải làm token chết, không chờ hết hạn.
	if err := service.AddUser("gone", RoleOperator, "secret123"); err != nil {
		t.Fatal(err)
	}
	goneToken, _, err := service.Authenticate("gone", "secret123", "127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteUser("gone", "temp_admin"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Validate(goneToken); err == nil {
		t.Fatal("token của tài khoản đã xoá vẫn đi qua")
	}
}

func TestEngineerAccountIsAcceptedByUserManagement(t *testing.T) {
	service := newTestService(t)
	if err := service.AddUser("eng", RoleEngineer, "secret123"); err != nil {
		t.Fatalf("phải tạo được tài khoản engineer: %v", err)
	}
	found := false
	for _, user := range service.ListUsers() {
		if user.Username == "eng" && user.Role == RoleEngineer {
			found = true
		}
	}
	if !found {
		t.Fatal("tài khoản engineer không xuất hiện trong danh sách")
	}
}

/*
`T59-816` — `RolesWithPermission` là nguồn của danh sách vai mà FE đọc.

Kiểm cả hai chiều để một cài đặt trả rỗng hoặc trả tất cả đều không lọt: tập trả
về phải khớp CHÍNH XÁC tập vai mà ma trận cho phép.
*/
func TestRolesWithPermissionMatchesMatrix(t *testing.T) {
	for _, permission := range AllPermissions() {
		want := map[Role]bool{}
		for _, role := range AllRoles() {
			if RoleHasPermission(role, permission) {
				want[role] = true
			}
		}
		got := map[Role]bool{}
		for _, role := range RolesWithPermission(permission) {
			if got[role] {
				t.Fatalf("RolesWithPermission(%s) trả trùng %s", permission, role)
			}
			got[role] = true
		}
		if len(got) != len(want) {
			t.Fatalf("RolesWithPermission(%s) = %v; want %v", permission, got, want)
		}
		for role := range want {
			if !got[role] {
				t.Errorf("RolesWithPermission(%s) thiếu %s", permission, role)
			}
		}
	}

	// Ranh giới cụ thể mà `ADR-053` đặt, viết ra thành số để một lần nới quyền
	// im lặng cũng phải đi qua đây.
	roles := RolesWithPermission(PermissionSimulationRun)
	if len(roles) != 1 || roles[0] != RoleAdmin {
		t.Fatalf("simulation.run mở cho %v; ADR-053 đặt admin-only", roles)
	}
}
