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
import { formatDateTime } from '../../shared/utils'
import type { UserAccessRow, UserAccount, UserRole } from '../../shared/types'
import {
  ENFORCED_MIN_PASSWORD_LENGTH,
  RECOMMENDED_MIN_PASSWORD_LENGTH,
  assessPassword,
  type PasswordStrength
} from './passwordPolicy'

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
/* T57-1.9 / `ADR-037` — con số này phải KHỚP `validNewPassword` trong
   `apps/web-api/internal/auth/service.go`. Siết ở đây mà không siết ở Go làm
   giao diện mô tả sai thiết bị: màn hình bảo "tối thiểu 8" trong khi cùng cái
   bo đó vẫn nhận mật khẩu 6 ký tự qua bất kỳ client nào khác. */
const MIN_PASSWORD_LENGTH = ENFORCED_MIN_PASSWORD_LENGTH

type Dialog =
  | { kind: 'create' }
  | { kind: 'reset'; user: UserAccount }
  | { kind: 'delete'; user: UserAccount }

export function UsersPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const { session } = useAuth()
  /* `T57-3.16`: một nguồn duy nhất cho cả danh sách tài khoản lẫn dấu vết truy
     cập. Gọi hai endpoint rồi ghép ở FE sẽ có lúc hai bảng lệch nhau ngay giữa
     một thao tác quản trị. */
  const state = useApi(apiClient.getUserAccess, [], { refreshMs: 15_000 })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', role: 'viewer' as UserRole, password: '' })
  const [newPassword, setNewPassword] = useState('')
  const [pendingRole, setPendingRole] = useState<string | null>(null)

  const users = state.data?.users ?? []
  const sessions = state.data?.sessions ?? []
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

  const columns: Array<Column<UserAccessRow>> = [
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
      key: 'lastLogin',
      header: pick('Đăng nhập gần nhất', 'Last sign-in'),
      render: (row) => (
        <div className="text-xs">
          {/* `null` KHÔNG phải "chưa từng đăng nhập": vết có thể đã bị đẩy khỏi
              vòng nhớ Activity. Nói sai điều này trên màn hình soát tài khoản
              dẫn tới kết luận sai về một tài khoản bỏ quên. */}
          <div className={row.lastLoginAt ? '' : 'text-[var(--c-text-dim)]'}>
            {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : pick('Không rõ', 'Unknown')}
          </div>
          {row.lastLoginRemote && <div className="mono text-[10px] text-[var(--c-text-dim)]">{row.lastLoginRemote}</div>}
          {row.lastFailedLoginAt && (
            <div className="text-[10px] text-[var(--c-warn-fg)]">
              {pick('Lần sai gần nhất: ', 'Last failure: ')}{formatDateTime(row.lastFailedLoginAt)}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'sessions',
      header: pick('Phiên đang mở', 'Open sessions'),
      render: (row) => (
        <div className="text-xs">
          <span className={row.activeSessions > 0 ? 'font-semibold text-[var(--c-accent)]' : 'text-[var(--c-text-dim)]'}>
            {row.activeSessions}
          </span>
          {row.mustChangePassword && (
            <div className="mt-1 text-[10px] font-semibold uppercase text-[var(--c-warn-fg)]">
              {pick('Đang giữ mật khẩu tạm', 'Holding a temporary password')}
            </div>
          )}
        </div>
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
        {/* Hai giới hạn PHẢI nói ra, nếu không người đọc sẽ tin đây là sổ đầy đủ:
            phiên nằm trong bộ nhớ tiến trình, còn vết đăng nhập nằm trong một
            vòng nhớ có hạn. */}
        <p className="mt-3 text-xs text-[var(--c-text-dim)]">
          {pick(
            `Phiên đang mở chỉ tính từ lần khởi động dịch vụ web gần nhất (${state.data?.sessionsSince ? formatDateTime(state.data.sessionsSince) : '—'}). Dấu vết đăng nhập lấy từ nhật ký hoạt động, giữ tối đa ${state.data?.activityWindow ?? 0} sự kiện — vết cũ hơn sẽ không còn.`,
            `Open sessions are counted only since the web service last started (${state.data?.sessionsSince ? formatDateTime(state.data.sessionsSince) : '—'}). Sign-in traces come from the activity log, which keeps at most ${state.data?.activityWindow ?? 0} events — older traces are gone.`
          )}
        </p>
      </Panel>

      {sessions.length > 0 && (
        <Panel title={pick('Phiên đang hoạt động', 'Active sessions')}>
          <ul className="space-y-1 text-xs">
            {sessions.map((item) => (
              <li key={`${item.username}-${item.issuedAt}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{item.username}</span>
                <span className="text-[var(--c-text-dim)]">{item.role}</span>
                {item.remote && <span className="mono text-[var(--c-text-dim)]">{item.remote}</span>}
                <span className="text-[var(--c-text-dim)]">
                  {pick('Mở lúc ', 'Opened ')}{formatDateTime(item.issuedAt)} · {pick('hoạt động lúc ', 'last seen ')}{formatDateTime(item.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

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
          <PasswordField
            label={pick('Mật khẩu', 'Password')}
            value={createForm.password}
            username={createForm.username}
            onChange={(password) => setCreateForm((form) => ({ ...form, password }))}
          />
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
            <PasswordField
              label={pick('Mật khẩu mới', 'New password')}
              value={newPassword}
              username={dialog.user.username}
              onChange={setNewPassword}
            />
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

/**
 * Ô nhập mật khẩu kèm luật thiết bị và chỉ báo độ mạnh — `T57-1.9`.
 *
 * Hai lớp thông tin, và chúng **phải** phân biệt được với nhau:
 *
 *  - **Luật thiết bị** (`≥ 6 ký tự`): hiện TRƯỚC khi người dùng gõ, và là thứ
 *    duy nhất chặn nút. Đây là câu mô tả đúng cái bo đang làm.
 *  - **Khuyến nghị** (độ mạnh, danh sách gợi ý): **không** chặn gì, và được dán
 *    nhãn "Khuyến nghị" tường minh. Biến nó thành cổng chặn là dựng ra một luật
 *    mà thiết bị không thi hành — đúng lỗi mà `ADR-037` điều 1 loại bỏ.
 */
function PasswordField({ label, value, username, onChange }: {
  label: string
  value: string
  username: string
  onChange: (value: string) => void
}) {
  const { pick } = useI18n()
  const assessment = assessPassword(value, username)
  const strengthLabel: Record<PasswordStrength, string> = {
    unusable: pick('CHƯA ĐỦ ĐỘ DÀI', 'TOO SHORT'),
    weak: pick('YẾU', 'WEAK'),
    fair: pick('TRUNG BÌNH', 'FAIR'),
    strong: pick('MẠNH', 'STRONG')
  }
  const strengthColor: Record<PasswordStrength, string> = {
    unusable: 'var(--c-fault-fg)',
    weak: 'var(--c-fault-fg)',
    fair: 'var(--c-warn-fg)',
    strong: 'var(--c-good-fg)'
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-[var(--c-text-dim)]">
        {label}
        <input
          className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          aria-label={label}
          aria-describedby="password-rule"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>

      {/* Luật hiện TRƯỚC khi gõ, không phải sau khi bị từ chối. */}
      <p id="password-rule" className="text-xs text-[var(--c-text-dim)]">
        {pick(
          `Luật thiết bị đang cưỡng chế: tối thiểu ${ENFORCED_MIN_PASSWORD_LENGTH} ký tự. Không bắt buộc loại ký tự nào, và thiết bị hiện KHÔNG khoá tài khoản sau nhiều lần đăng nhập sai.`,
          `Rule enforced by the device: at least ${ENFORCED_MIN_PASSWORD_LENGTH} characters. No character classes are required, and the device does NOT currently lock accounts after repeated failed sign-ins.`
        )}
      </p>

      {value.length > 0 && (
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-[var(--c-text-dim)]">{pick('Khuyến nghị — không chặn lưu:', 'Advisory — does not block saving:')}</span>
            <span className="font-bold" style={{ color: strengthColor[assessment.strength] }}>{strengthLabel[assessment.strength]}</span>
          </div>
          {assessment.advice.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--c-text-dim)]">
              {assessment.advice.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {assessment.strength === 'strong' && (
            <p className="mt-1 text-xs text-[var(--c-text-dim)]">
              {pick(`Đạt mức khuyến nghị (từ ${RECOMMENDED_MIN_PASSWORD_LENGTH} ký tự, trộn nhiều nhóm ký tự).`, `Meets the recommendation (${RECOMMENDED_MIN_PASSWORD_LENGTH}+ characters, mixed character classes).`)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
