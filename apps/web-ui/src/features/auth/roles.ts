import type { UserRole } from '../../shared/types'

/**
 * Thang quyền của frontend — WEB-UX-005.
 *
 * Phải khớp `roleRank` trong `apps/web-api/internal/app/auth.go`. Backend là nguồn chân lý:
 * mọi endpoint đã được bọc `auth.Require(<role>, …)` trong `apps/web-api/internal/app/http.go`,
 * và frontend KHÔNG được nới lỏng hơn. Gate ở đây chỉ để người dùng khỏi đi vào
 * một trang mà mọi nút đều 403 — nó là tiện ích UX, không phải hàng rào an ninh.
 * Hàng rào thật nằm ở server và phải giữ nguyên ở đó.
 */
const ROLE_RANK: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3
}

export function roleAtLeast(actual: UserRole | undefined | null, required: UserRole): boolean {
  if (!actual) return false
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

export function roleLabel(role: UserRole): string {
  return role.toUpperCase()
}

/**
 * Ma trận route ↔ quyền tối thiểu.
 *
 * Suy trực tiếp từ bảng đăng ký route của backend chứ không tự nghĩ ra:
 *
 * | Route                    | Tối thiểu | Endpoint quyết định (apps/web-api/internal/app/http.go)        |
 * |--------------------------|-----------|--------------------------------------------------|
 * | `/`, `/monitor`, `/alarms`, `/trends`, `/me`, `/help`, `/eng/diagram`, `/eng/aux`, `/settings/display` | viewer | `GET /points`, `GET /alarms`, … đều `RoleViewer` |
 * | `/settings/network`      | viewer    | `GET /network` là `RoleViewer`; mutation trong trang tự khoá admin (F-06) |
 * | `/eng/commissioning`     | operator  | `POST /commissioning/points/{id}/test` → `RoleOperator` |
 * | `/eng/outputs`           | operator  | `PUT /points/{id}` (force) → `RoleOperator`       |
 * | `/eng/inputs`            | admin     | `PUT /points/{id}/config` → `RoleAdmin`           |
 * | `/eng/virtual-points`    | admin     | `POST/PUT/DELETE /virtual-points` → `RoleAdmin`   |
 * | `/eng/alarm-settings`    | admin     | `PUT /alarm-settings` → `RoleAdmin`               |
 * | `/eng/scheduler`         | admin     | `PUT /schedules` → `RoleAdmin`                    |
 * | `/eng/user-parameters`   | admin     | `PUT /system/config/*` → `RoleAdmin`              |
 * | `/settings/time`         | admin     | `PUT /system/config/time` → `RoleAdmin`           |
 * | `/settings/device`       | admin     | `GET/PUT /system/config/device` → `RoleAdmin`     |
 * | `/settings/users`        | admin     | `GET/POST/PUT/DELETE /users` → `RoleAdmin`        |
 *
 * `/monitor` cố ý để `viewer`: nó là màn hình theo dõi, và chặn cả trang sẽ lấy
 * mất khả năng quan sát của ca trực chỉ-đọc. Nút ép giá trị bên trong trang mới
 * là thứ cần quyền `operator`, và được khoá riêng ở đó.
 */
export const ROUTE_MIN_ROLE: Record<string, UserRole> = {
  '/eng/commissioning': 'operator',
  '/eng/outputs': 'operator',
  '/eng/inputs': 'admin',
  '/eng/virtual-points': 'admin',
  /* Đ-04 (PM/CTO 2026-08-04): Viewer PHẢI giám sát được Modbus RTU.
   * Khoá cả trang ở 'admin' làm người vận hành không xem được thiết bị và điểm
   * dữ liệu, trái yêu cầu sản phẩm PR-MBRTU-001. Backend đã bảo vệ đúng chỗ:
   * GET /modbus/* là viewer, mọi mutation là admin — nên hạ route xuống viewer
   * KHÔNG nới lỏng hơn server. Các control thay đổi cấu hình bị disable trong
   * trang cho vai trò không phải admin. */
  '/eng/modbus-rtu': 'viewer',
  '/eng/alarm-settings': 'admin',
  '/eng/scheduler': 'admin',
  '/eng/user-parameters': 'admin',
  '/settings/time': 'admin',
  '/settings/device': 'admin',
  '/settings/users': 'admin'
}
