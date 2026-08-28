import type { UserRole } from '../types'

/**
 * `WEB-RBAC-001` — NĂNG LỰC của từng vai, khớp `auth.RoleHasPermission` ở
 * `apps/web-api/internal/auth`.
 *
 * VÌ SAO Ở `shared/` CHỨ KHÔNG Ở `features/auth`
 * ---------------------------------------------
 * `UserRole` đã ở `shared/types`, và các thành phần dùng chung
 * (`PointLoggingDialog`…) cần hỏi "vai này có cấu hình được không". Để bảng ở
 * `features/auth` buộc `shared/` phải deep-import một feature — đúng thứ lint
 * của repo cấm, và cấm có lý: `shared/` là tầng dưới, nó không được phụ thuộc
 * tầng trên.
 *
 * Giao diện hỏi "vai này làm được việc gì" thay vì "vai này có đủ lớn không".
 * Hai câu trùng nhau cho tới đúng lúc chúng tách ra: sửa cấu hình mạng và tạo
 * tài khoản cùng đòi `admin` chỉ vì cả hai đều cao nhất, nên không thể mở cấu
 * hình cho kỹ sư mà không mở luôn quyền tạo tài khoản.
 *
 * Đây là tiện ích UX, KHÔNG phải hàng rào an ninh: hàng rào thật nằm ở server
 * và phải giữ nguyên ở đó. Bảng này chỉ để người dùng khỏi đi vào một trang mà
 * mọi nút đều 403.
 */
export type UserCapability =
  | 'read'
  | 'self.manage'
  | 'operate'
  | 'program.edit'
  | 'program.activate'
  | 'settings.manage'
  | 'database.manage'
  | 'users.manage'
  | 'system.release'

const ROLE_CAPABILITIES: Record<UserRole, readonly UserCapability[]> = {
  viewer: ['read', 'self.manage'],
  operator: ['read', 'self.manage', 'operate'],
  engineer: [
    'read', 'self.manage', 'operate',
    'program.edit', 'program.activate', 'settings.manage', 'system.release'
  ],
  admin: [
    'read', 'self.manage', 'operate',
    'program.edit', 'program.activate', 'settings.manage', 'system.release',
    'database.manage', 'users.manage'
  ]
}

/** Vai chưa xác định KHÔNG có năng lực nào — chưa đăng nhập không phải "vai mặc định". */
export function roleCan(actual: UserRole | undefined | null, capability: UserCapability): boolean {
  if (!actual) return false
  return ROLE_CAPABILITIES[actual]?.includes(capability) ?? false
}

/** Mọi vai, theo thứ tự quyền tăng dần — để màn hình quản lý tài khoản liệt kê. */
export const USER_ROLES: readonly UserRole[] = ['viewer', 'operator', 'engineer', 'admin']
