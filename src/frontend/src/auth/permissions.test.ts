import { describe, expect, it } from 'vitest'
import { can, permissions } from './permissions'
import type { UserRole } from '../types'

const matrix: Record<UserRole, string[]> = {
  viewer: ['read', 'self.manage'],
  operator: ['read', 'self.manage', 'operate', 'program.edit'],
  engineer: ['read', 'self.manage', 'operate', 'program.edit', 'program.activate', 'settings.manage', 'system.release'],
  admin: Object.values(permissions)
}

describe('web RBAC permission matrix', () => {
  it.each(Object.entries(matrix) as Array<[UserRole, string[]]>)('maps %s to the exact capabilities', (role, expected) => {
    const actual = Object.values(permissions).filter((permission) => can(role, permission))
    expect(actual).toEqual(expected)
  })

  it('fails closed for missing and unknown roles', () => {
    expect(can(undefined, permissions.read)).toBe(false)
    expect(can('engineering', permissions.read)).toBe(false)
    expect(can('root', permissions.usersManage)).toBe(false)
  })
})
