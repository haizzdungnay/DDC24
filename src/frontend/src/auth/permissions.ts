import type { UserRole } from '../types'

export const permissions = {
  read: 'read',
  selfManage: 'self.manage',
  operate: 'operate',
  programEdit: 'program.edit',
  programActivate: 'program.activate',
  settingsManage: 'settings.manage',
  databaseManage: 'database.manage',
  usersManage: 'users.manage',
  systemRelease: 'system.release'
} as const

export type Permission = typeof permissions[keyof typeof permissions]

const rolePermissions: Record<UserRole, ReadonlySet<Permission>> = {
  viewer: new Set([permissions.read, permissions.selfManage]),
  operator: new Set([
    permissions.read,
    permissions.selfManage,
    permissions.operate,
    permissions.programEdit
  ]),
  engineer: new Set([
    permissions.read,
    permissions.selfManage,
    permissions.operate,
    permissions.programEdit,
    permissions.programActivate,
    permissions.settingsManage,
    permissions.systemRelease
  ]),
  admin: new Set(Object.values(permissions))
}

export function isUserRole(value: unknown): value is UserRole {
  return value === 'viewer' || value === 'operator' || value === 'engineer' || value === 'admin'
}

export function can(role: unknown, permission: Permission): boolean {
  return isUserRole(role) && rolePermissions[role].has(permission)
}
