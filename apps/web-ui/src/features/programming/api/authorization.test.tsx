import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UserRole } from '../../../shared/types'
import {
  PROGRAMMING_ACTION_CAPABILITY,
  ProgrammingAuthorizationProvider,
  programmingRoleCanAction,
  useProgrammingActionAllowed,
  useProgrammingAuthorization,
} from './authorization'

const authState = vi.hoisted(() => ({
  session: {
    username: 'engineer',
    role: 'engineer' as UserRole,
    loginAt: '2026-09-06T00:00:00Z',
  },
}))

vi.mock('../../auth', () => ({
  useAuth: () => ({ session: authState.session }),
}))

function EditSurface() {
  const allowed = useProgrammingActionAllowed('editDraft')
  const { revoke } = useProgrammingAuthorization()
  return (
    <section>
      <p>Nội dung Draft chỉ đọc vẫn còn</p>
      {allowed && <button onClick={() => revoke('program.edit')}>Lưu Draft</button>}
    </section>
  )
}

describe('Programming authorization', () => {
  it('khóa ma trận action: engineer làm Programming, Simulation chỉ admin', () => {
    const actions = Object.keys(PROGRAMMING_ACTION_CAPABILITY) as Array<keyof typeof PROGRAMMING_ACTION_CAPABILITY>
    for (const role of ['viewer', 'operator'] as const) {
      expect(actions.filter((action) => programmingRoleCanAction(role, action))).toEqual([])
    }
    expect(actions.filter((action) => !programmingRoleCanAction('engineer', action))).toEqual(['simulation'])
    expect(actions.filter((action) => programmingRoleCanAction('admin', action))).toEqual(actions)
  })

  it('thu hồi sau mount gỡ action ghi, giữ ngữ cảnh đọc và reset ở phiên mới', () => {
    authState.session = { username: 'engineer', role: 'engineer', loginAt: '2026-09-06T00:00:00Z' }
    const view = render(<ProgrammingAuthorizationProvider><EditSurface /></ProgrammingAuthorizationProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Lưu Draft' }))
    expect(screen.queryByRole('button', { name: 'Lưu Draft' })).toBeNull()
    expect(screen.getByText('Nội dung Draft chỉ đọc vẫn còn')).toBeTruthy()

    authState.session = { username: 'engineer', role: 'engineer', loginAt: '2026-09-06T01:00:00Z' }
    view.rerender(<ProgrammingAuthorizationProvider><EditSurface /></ProgrammingAuthorizationProvider>)
    expect(screen.getByRole('button', { name: 'Lưu Draft' })).toBeTruthy()
  })
})
