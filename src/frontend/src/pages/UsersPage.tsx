import { Edit2, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { can, permissions } from '../auth/permissions'
import { Button } from '../components/Button'
import { DataTable, type Column } from '../components/DataTable'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { ApiError, type UserAccount, type UserRole } from '../types'

type UserAction =
  | { kind: 'create' }
  | { kind: 'role'; user: UserAccount }
  | { kind: 'password'; user: UserAccount }
  | { kind: 'delete'; user: UserAccount }
  | null

const roles: UserRole[] = ['viewer', 'operator', 'engineer', 'admin']
const inputClass = 'mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none transition focus:border-[var(--c-accent)]'

export function UsersPage() {
  const { session } = useAuth()
  const { pick } = useI18n()
  const toast = useToast()
  const allowed = can(session?.role, permissions.usersManage)
  const users = useApi(apiClient.getUsers, [], { enabled: allowed })
  const [action, setAction] = useState<UserAction>(null)
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<UserRole>('viewer')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  if (!allowed) {
    return <StateBlock state="error" title={pick('Khong co quyen quan ly user', 'User management is not permitted')} />
  }

  function openCreate() {
    setUsername('')
    setRole('viewer')
    setPassword('')
    setActionError('')
    setAction({ kind: 'create' })
  }

  function openAction(next: Exclude<UserAction, null>) {
    setUsername(next.kind === 'create' ? '' : next.user.username)
    setRole(next.kind === 'create' ? 'viewer' : next.user.role)
    setPassword('')
    setActionError('')
    setAction(next)
  }

  function closeAction() {
    if (busy) return
    setPassword('')
    setActionError('')
    setAction(null)
  }

  async function submitAction() {
    if (!action || busy) return
    const trimmedUsername = username.trim()
    if (action.kind === 'create' && trimmedUsername.length < 3) {
      setActionError(pick('Username phai co it nhat 3 ky tu.', 'Username must contain at least 3 characters.'))
      return
    }
    if ((action.kind === 'create' || action.kind === 'password') && password.length < 6) {
      setActionError(pick('Mat khau phai co it nhat 6 ky tu.', 'Password must contain at least 6 characters.'))
      return
    }

    setBusy(true)
    setActionError('')
    try {
      if (action.kind === 'create') await apiClient.createUser({ username: trimmedUsername, role, password })
      if (action.kind === 'role') await apiClient.updateUserRole(action.user.username, role)
      if (action.kind === 'password') await apiClient.resetUserPassword(action.user.username, password)
      if (action.kind === 'delete') await apiClient.deleteUser(action.user.username)
      setPassword('')
      setAction(null)
      await users.refetch()
      toast.push('success', pick('Da cap nhat user.', 'User account updated.'))
    } catch (error) {
      setActionError(userActionError(error, pick))
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<Column<UserAccount>> = [
    { key: 'username', header: 'Username', render: (user) => <span className="font-semibold">{user.username}</span> },
    { key: 'role', header: pick('Vai tro', 'Role'), render: (user) => <span className="capitalize">{user.role}</span> },
    {
      key: 'actions',
      header: pick('Thao tac', 'Actions'),
      className: 'w-[190px]',
      render: (user) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label={`Change role for ${user.username}`} icon={<Edit2 className="h-4 w-4" />} onClick={() => openAction({ kind: 'role', user })} />
          <Button size="sm" variant="ghost" aria-label={`Reset password for ${user.username}`} icon={<KeyRound className="h-4 w-4" />} onClick={() => openAction({ kind: 'password', user })} />
          <Button size="sm" variant="ghost" aria-label={`Delete ${user.username}`} title={user.username === session?.username ? pick('Khong the tu xoa tai khoan dang dung', 'You cannot delete your active account') : undefined} disabled={user.username === session?.username} icon={<Trash2 className="h-4 w-4" />} onClick={() => openAction({ kind: 'delete', user })} />
        </div>
      )
    }
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Nguoi dung', 'Users')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Quan tri tai khoan RBAC', 'RBAC account administration')}</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>{pick('Them user', 'Add user')}</Button>
      </div>
      <Panel>
        <DataTable rows={users.data ?? []} columns={columns} getRowKey={(user) => user.username} loading={users.loading} error={users.error} emptyText={pick('Chua co user', 'No users')} />
      </Panel>
      <Modal
        open={Boolean(action)}
        title={actionTitle(action, pick)}
        confirmLabel={action?.kind === 'delete' ? pick('Xoa', 'Delete') : pick('Luu', 'Save')}
        confirmLoading={busy}
        danger={action?.kind === 'delete'}
        onConfirm={() => void submitAction()}
        onClose={closeAction}
      >
        <div className="space-y-4">
          {action?.kind === 'create' && <TextInput label="Username" value={username} autoComplete="off" onChange={setUsername} />}
          {(action?.kind === 'create' || action?.kind === 'role') && (
            <label className="block text-sm font-semibold text-[var(--c-text)]">
              {pick('Vai tro', 'Role')}
              <select className={inputClass} value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                {roles.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          )}
          {(action?.kind === 'create' || action?.kind === 'password') && <TextInput label={pick('Mat khau moi', 'New password')} type="password" value={password} autoComplete="new-password" onChange={setPassword} />}
          {action?.kind === 'delete' && <p>{pick(`Xoa tai khoan ${action.user.username}? Thao tac nay khong the hoan tac.`, `Delete ${action.user.username}? This action cannot be undone.`)}</p>}
          {actionError && <p role="alert" className="rounded-[var(--radius)] border border-[rgba(213,32,42,0.38)] bg-[rgba(213,32,42,0.08)] p-3 text-sm text-[var(--c-fault-fg)]">{actionError}</p>}
        </div>
      </Modal>
    </div>
  )
}

function TextInput({ label, value, type = 'text', autoComplete, onChange }: { label: string; value: string; type?: string; autoComplete?: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-[var(--c-text)]">
      {label}
      <input className={inputClass} type={type} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function actionTitle(action: UserAction, pick: (vi: string, en: string) => string): string {
  if (!action) return ''
  if (action.kind === 'create') return pick('Them user', 'Add user')
  if (action.kind === 'role') return pick(`Doi role: ${action.user.username}`, `Change role: ${action.user.username}`)
  if (action.kind === 'password') return pick(`Dat lai mat khau: ${action.user.username}`, `Reset password: ${action.user.username}`)
  return pick(`Xoa user: ${action.user.username}`, `Delete user: ${action.user.username}`)
}

function userActionError(error: unknown, pick: (vi: string, en: string) => string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return pick('Phien dang nhap da het han.', 'Your session has expired.')
    if (error.status === 403) return pick('Tai khoan khong co quyen quan ly user.', 'This account cannot manage users.')
    if (error.status === 409) return pick(`Xung dot an toan: ${error.message}`, `Safety conflict: ${error.message}`)
  }
  return error instanceof Error ? error.message : pick('Khong cap nhat duoc user.', 'Could not update the user account.')
}
