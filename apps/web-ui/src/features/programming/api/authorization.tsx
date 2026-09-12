import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth'
import { roleCan } from '../../../shared/auth/capabilities'
import type { ProgrammingPermission } from './generated/client'
import type { UserRole } from '../../../shared/types'

/** Các hành động của sáu workspace Programming và capability tối thiểu tương ứng. */
export const PROGRAMMING_ACTION_CAPABILITY = {
  createProject: 'program.edit',
  editDraft: 'program.edit',
  mapping: 'program.edit',
  publishedSignal: 'program.edit',
  execution: 'program.edit',
  library: 'program.edit',
  check: 'program.edit',
  trace: 'program.edit',
  bundleExport: 'program.edit',
  commission: 'program.activate',
  restore: 'program.activate',
  retainReset: 'program.activate',
  runtimeIntent: 'program.activate',
  bundleImport: 'program.activate',
  recoveryReset: 'program.activate',
  simulation: 'simulation.run',
} as const satisfies Record<string, ProgrammingPermission>

export type ProgrammingAction = keyof typeof PROGRAMMING_ACTION_CAPABILITY

export function programmingRoleCanAction(role: UserRole | undefined | null, action: ProgrammingAction): boolean {
  return roleCan(role, PROGRAMMING_ACTION_CAPABILITY[action])
}

interface ProgrammingAuthorizationValue {
  isRevoked: (permission: ProgrammingPermission) => boolean
  revoke: (permission: ProgrammingPermission) => void
}

const NO_AUTHORIZATION_OVERRIDE: ProgrammingAuthorizationValue = {
  isRevoked: () => false,
  revoke: () => undefined,
}

const ProgrammingAuthorizationContext = createContext<ProgrammingAuthorizationValue>(NO_AUTHORIZATION_OVERRIDE)

/**
 * Giữ thu hồi quyền nhận được từ HTTP 403 trong đúng một phiên đăng nhập.
 * Việc đổi user/role/loginAt tạo identity mới và bỏ state thu hồi cũ; request
 * mutation đã bị 403 không được client tự phát lại.
 */
export function ProgrammingAuthorizationProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const identity = session ? `${session.username}\u0000${session.role}\u0000${session.loginAt}` : 'anonymous'
  const [revoked, setRevoked] = useState<{ identity: string; permissions: ReadonlySet<ProgrammingPermission> }>(() => ({
    identity,
    permissions: new Set(),
  }))

  const revoke = useCallback((permission: ProgrammingPermission) => {
    setRevoked((current) => {
      const permissions = current.identity === identity ? new Set(current.permissions) : new Set<ProgrammingPermission>()
      permissions.add(permission)
      return { identity, permissions }
    })
  }, [identity])

  const value = useMemo<ProgrammingAuthorizationValue>(() => ({
    isRevoked: (permission) => revoked.identity === identity && revoked.permissions.has(permission),
    revoke,
  }), [identity, revoke, revoked])

  return <ProgrammingAuthorizationContext.Provider value={value}>{children}</ProgrammingAuthorizationContext.Provider>
}

export function useProgrammingAuthorization(): ProgrammingAuthorizationValue {
  return useContext(ProgrammingAuthorizationContext)
}

export function useProgrammingActionAllowed(action: ProgrammingAction): boolean {
  const { session } = useAuth()
  const { isRevoked } = useProgrammingAuthorization()
  const permission = PROGRAMMING_ACTION_CAPABILITY[action]
  return programmingRoleCanAction(session?.role, action) && !isRevoked(permission)
}
