import { describe, expect, it } from 'vitest'
import { roleCan, USER_ROLES, type UserCapability } from './capabilities'

/*
 * `WEB-RBAC-001` — bảng năng lực của frontend phải KHỚP backend
 * (`auth.RoleHasPermission`). Lệch nhau là loại lỗi im lặng tệ nhất ở đây: giao
 * diện hiện một nút mà server luôn trả 403, hoặc giấu một nút mà người dùng có
 * quyền dùng.
 */
describe('roleCan — ma trận vai × năng lực', () => {
  const expected: Record<string, Partial<Record<UserCapability, boolean>>> = {
    viewer: {
      read: true, 'self.manage': true,
      operate: false, 'settings.manage': false, 'users.manage': false
    },
    operator: {
      read: true, operate: true,
      // Thêm vai `engineer` KHÔNG được nới quyền cho vai đang có.
      'program.edit': false, 'settings.manage': false, 'users.manage': false
    },
    engineer: {
      read: true, operate: true, 'program.edit': true, 'program.activate': true,
      'settings.manage': true, 'system.release': true,
      // Hai năng lực engineer KHÔNG có — đây là lý do vai này tồn tại.
      'users.manage': false, 'database.manage': false
    },
    admin: {
      read: true, operate: true, 'program.activate': true,
      'settings.manage': true, 'users.manage': true, 'database.manage': true
    }
  }

  for (const [role, capabilities] of Object.entries(expected)) {
    for (const [capability, want] of Object.entries(capabilities)) {
      it(`${role} · ${capability} = ${want}`, () => {
        expect(roleCan(role as never, capability as UserCapability)).toBe(want)
      })
    }
  }

  it('chưa đăng nhập thì KHÔNG có năng lực nào', () => {
    expect(roleCan(undefined, 'read')).toBe(false)
    expect(roleCan(null, 'read')).toBe(false)
  })

  it('bốn vai, theo thứ tự quyền tăng dần', () => {
    expect(USER_ROLES).toEqual(['viewer', 'operator', 'engineer', 'admin'])
  })
})
