import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { useAuth } from './AuthProvider'
import { Button } from '../../shared/components/Button'
import { DataTable, Column } from '../../shared/components/DataTable'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import type { UserAccount, UserRole } from '../../shared/types'

/**
 * Quản lý người dùng — WEB-UX-011.
 *
 * Bản trước dài đúng 20 dòng và là **vỏ rỗng hoàn toàn**: bảng dựng từ
 * `getDemoUsers()` kể cả khi chạy bản live, nên trên board thật nó hiển thị năm
 * tài khoản không tồn tại (`operator1`, `operator2`, `maintenance`…). Nút "Thêm
 * user", nút sửa và nút liên kết đều không có `onClick`. Cột "Trạng thái"
 * online/offline không có nguồn dữ liệu nào — backend không theo dõi phiên.
 *
 * Hệ quả thực tế: người quản trị tin rằng đã có sẵn tài khoản vận hành phân
 * quyền, trong khi `users.conf` trên board chỉ có mỗi `admin`.
 *
 * Toàn bộ endpoint cần thiết đã có ở backend từ lâu (`apps/web-api/internal/app/users.go`,
 * đăng ký tại `http.go:170-174`) với guard chống xoá/hạ quyền admin cuối cùng và
 * ghi audit mọi thay đổi. Trang này nối vào đúng những endpoint đó.
 *
 * Hai cột bị bỏ vì không có nguồn: "Họ và tên" (backend chỉ lưu username + role)
 * và "Trạng thái online". Thà thiếu cột còn hơn một cột luôn hiển thị sai.
 */

const ROLE_OPTIONS: UserRole[] = ['viewer', 'operator', 'admin']
const MIN_PASSWORD_LENGTH = 6

type Dialog =
  | { kind: 'create' }
  | { kind: 'reset'; user: UserAccount }
  | { kind: 'delete'; user: UserAccount }

export function UsersPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const { session } = useAuth()
  const state = useApi(apiClient.listUsers, [])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', role: 'viewer' as UserRole, password: '' })
  const [newPassword, setNewPassword] = useState('')
  const [pendingRole, setPendingRole] = useState<string | null>(null)

  const users = state.data ?? []
  const adminCount = users.filter((user) => user.role === 'admin').length

  if (state.loading && !state.data) return <StateBlock state="loading" title={pick('Đang tải danh sách người dùng', 'Loading users')} />
  if (state.error && !state.data) {
    return <StateBlock state="error" title={pick('Không tải được danh sách người dùng', 'Could not load users')} detail={state.error.message} onRetry={state.refetch} />
  }

  function report(err: unknown, fallbackVi: string, fallbackEn: string) {
    toast.push('error', err instanceof Error ? err.message : pick(fallbackVi, fallbackEn))
  }

  /**
   * Guard last-admin ở client, phản chiếu `ErrLastAdmin` của backend.
   *
   * Backend vẫn là nơi chặn thật (`AuthService.SetRole` / `DeleteUser` trả 409),
   * nhưng khoá nút ở đây để người quản trị không tự đưa mình vào tình huống mất
   * hẳn đường quản trị rồi mới biết. Không có admin nào thì không ai đổi được
   * cấu hình, và trên site thật đó là một chuyến xe ra hiện trường.
   */
  function isLastAdmin(user: UserAccount): boolean {
    return user.role === 'admin' && adminCount <= 1
  }

  async function changeRole(user: UserAccount, role: UserRole) {
    if (role === user.role) return
    setPendingRole(user.username)
    try {
      await apiClient.setUserRole(user.username, role)
      toast.push('success', pick(`${user.username}: đã đổi vai trò thành ${role}`, `${user.username}: role changed to ${role}`))
      await state.refetch()
    } catch (err) {
      report(err, 'Đổi vai trò thất bại', 'Changing the role failed')
      // Nạp lại để ô chọn quay về giá trị server thực sự đang giữ, thay vì đứng
      // ở giá trị người dùng vừa chọn hụt.
      await state.refetch()
    } finally {
      setPendingRole(null)
    }
  }

  async function submitCreate() {
    const username = createForm.username.trim()
    if (!username) {
      toast.push('warn', pick('Nhập tên đăng nhập', 'Enter a username'))
      return
    }
    if (createForm.password.length < MIN_PASSWORD_LENGTH) {
      toast.push('warn', pick(`Mật khẩu cần tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`))
      return
    }
    setBusy(true)
    try {
      await apiClient.createUser(username, createForm.role, createForm.password)
      toast.push('success', pick(`Đã tạo người dùng ${username}`, `Created user ${username}`))
      setCreateForm({ username: '', role: 'viewer', password: '' })
      setDialog(null)
      await state.refetch()
    } catch (err) {
      report(err, 'Tạo người dùng thất bại', 'Creating the user failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitReset(user: UserAccount) {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.push('warn', pick(`Mật khẩu cần tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`))
      return
    }
    setBusy(true)
    try {
      await apiClient.resetUserPassword(user.username, newPassword)
      toast.push('success', pick(`Đã đặt lại mật khẩu cho ${user.username}`, `Password reset for ${user.username}`))
      setNewPassword('')
      setDialog(null)
    } catch (err) {
      report(err, 'Đặt lại mật khẩu thất bại', 'Resetting the password failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitDelete(user: UserAccount) {
    setBusy(true)
    try {
      await apiClient.deleteUser(user.username)
      toast.push('success', pick(`Đã xoá ${user.username}`, `Deleted ${user.username}`))
      setDialog(null)
      await state.refetch()
    } catch (err) {
      report(err, 'Xoá người dùng thất bại', 'Deleting the user failed')
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<Column<UserAccount>> = [
    {
      key: 'username',
      header: pick('Tên đăng nhập', 'Username'),
      render: (row) => (
        <span className="font-semibold">
          {row.username}
          {row.username === session?.username && <span className="ml-2 text-[10px] uppercase text-[var(--c-text-dim)]">{pick('bạn', 'you')}</span>}
        </span>
      )
    },
    {
      key: 'role',
      header: pick('Vai trò', 'Role'),
      render: (row) => (
        <select
          className="h-8 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
          aria-label={pick(`Vai trò của ${row.username}`, `Role for ${row.username}`)}
          value={row.role}
          disabled={pendingRole === row.username || isLastAdmin(row)}
          title={isLastAdmin(row) ? pick('Không thể hạ quyền admin cuối cùng', 'Cannot demote the last admin') : undefined}
          onChange={(event) => { void changeRole(row, event.target.value as UserRole) }}
        >
          {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      )
    },
    {
      key: 'actions',
      header: pick('Thao tác', 'Actions'),
      render: (row) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<KeyRound className="h-4 w-4" />}
            aria-label={pick(`Đặt lại mật khẩu cho ${row.username}`, `Reset password for ${row.username}`)}
            onClick={() => { setNewPassword(''); setDialog({ kind: 'reset', user: row }) }}
          >
            {pick('Đặt lại mật khẩu', 'Reset password')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="h-4 w-4" />}
            aria-label={pick(`Xoá ${row.username}`, `Delete ${row.username}`)}
            disabled={isLastAdmin(row) || row.username === session?.username}
            title={row.username === session?.username
              ? pick('Không thể tự xoá tài khoản đang đăng nhập', 'You cannot delete the account you are signed in with')
              : isLastAdmin(row) ? pick('Không thể xoá admin cuối cùng', 'Cannot delete the last admin') : undefined}
            onClick={() => setDialog({ kind: 'delete', user: row })}
          >
            {pick('Xoá', 'Delete')}
          </Button>
        </div>
      )
    }
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Người dùng', 'Users')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Quản trị tài khoản RBAC — mọi thay đổi đều được ghi audit log', 'RBAC account administration — every change is written to the audit log')}</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ kind: 'create' })}>
          {pick('Thêm người dùng', 'Add user')}
        </Button>
      </div>

      <Panel>
        <DataTable
          rows={users}
          columns={columns}
          getRowKey={(row) => row.username}
          emptyText={pick('Chưa có tài khoản nào', 'No accounts yet')}
        />
      </Panel>

      <Modal
        open={dialog?.kind === 'create'}
        title={pick('Thêm người dùng', 'Add user')}
        confirmLabel={pick('Tạo', 'Create')}
        confirmLoading={busy}
        onConfirm={() => { void submitCreate() }}
        onClose={() => setDialog(null)}
      >
        <div className="space-y-3">
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Tên đăng nhập', 'Username')}
            <input
              className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
              aria-label={pick('Tên đăng nhập', 'Username')}
              autoComplete="off"
              value={createForm.username}
              onChange={(event) => setCreateForm((form) => ({ ...form, username: event.target.value }))}
            />
          </label>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Vai trò', 'Role')}
            <select
              className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
              aria-label={pick('Vai trò', 'Role')}
              value={createForm.role}
              onChange={(event) => setCreateForm((form) => ({ ...form, role: event.target.value as UserRole }))}
            >
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Mật khẩu', 'Password')}
            <input
              className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
              aria-label={pick('Mật khẩu', 'Password')}
              type="password"
              autoComplete="new-password"
              value={createForm.password}
              onChange={(event) => setCreateForm((form) => ({ ...form, password: event.target.value }))}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={dialog?.kind === 'reset'}
        title={pick('Đặt lại mật khẩu', 'Reset password')}
        confirmLabel={pick('Đặt lại', 'Reset')}
        confirmLoading={busy}
        onConfirm={() => { if (dialog?.kind === 'reset') void submitReset(dialog.user) }}
        onClose={() => setDialog(null)}
      >
        {dialog?.kind === 'reset' && (
          <div className="space-y-3">
            <p>{pick(`Đặt mật khẩu mới cho tài khoản `, 'Set a new password for account ')}<span className="mono font-semibold text-[var(--c-text)]">{dialog.user.username}</span>.</p>
            <p>{pick('Người dùng đó sẽ không được thông báo; hãy tự bàn giao mật khẩu mới cho họ.', 'That user is not notified; hand the new password over yourself.')}</p>
            <label className="block text-xs text-[var(--c-text-dim)]">
              {pick('Mật khẩu mới', 'New password')}
              <input
                className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
                aria-label={pick('Mật khẩu mới', 'New password')}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === 'delete'}
        danger
        title={pick('Xoá người dùng?', 'Delete user?')}
        confirmLabel={pick('Xoá', 'Delete')}
        confirmLoading={busy}
        onConfirm={() => { if (dialog?.kind === 'delete') void submitDelete(dialog.user) }}
        onClose={() => setDialog(null)}
      >
        {dialog?.kind === 'delete' && (
          <>
            <p className="mono font-semibold text-[var(--c-text)]">{dialog.user.username} — {dialog.user.role}</p>
            <p className="mt-3">{pick('Tài khoản này sẽ bị xoá khỏi thiết bị. Phiên đang đăng nhập của họ vẫn còn hiệu lực tới khi token hết hạn.', 'This account is removed from the device. Any session they already hold stays valid until its token expires.')}</p>
          </>
        )}
      </Modal>
    </div>
  )
}
