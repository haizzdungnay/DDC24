import { FormEvent, useMemo, useState } from 'react'
import { KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { apiClient } from '../../shared/api/client'
import { useAuth } from './AuthProvider'
import { ROUTE_MIN_ROLE, roleAtLeast } from './roles'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { useToast } from '../../shared/components/Toast'
import { useI18n } from '../../shared/i18n'
import { formatDateTime } from '../../shared/utils'

/**
 * Nhãn tiếng Việt/Anh cho từng route có gate quyền.
 *
 * Chỉ liệt kê route NGƯỜI DÙNG hiểu được, không phải mọi path trong `App.tsx`:
 * mục đích là trả lời "tôi làm được gì", không phải in ra bảng định tuyến.
 */
const ROUTE_LABELS: Array<[string, string, string]> = [
  ['/monitor', 'Giám sát điểm I/O', 'Monitor I/O points'],
  ['/alarms', 'Xem và xác nhận cảnh báo', 'View and acknowledge alarms'],
  ['/trends', 'Xem xu hướng lịch sử', 'View historical trends'],
  ['/eng/scheduler', 'Lịch vận hành', 'Operating schedules'],
  ['/eng/commissioning', 'Chạy thử ngõ ra', 'Commission outputs'],
  ['/eng/outputs', 'Cấu hình ngõ ra', 'Configure outputs'],
  ['/eng/modbus-rtu', 'Modbus RTU', 'Modbus RTU'],
  ['/eng/inputs', 'Cấu hình ngõ vào', 'Configure inputs'],
  ['/eng/virtual-points', 'Điểm ảo', 'Virtual points'],
  ['/eng/alarm-settings', 'Cấu hình cảnh báo', 'Alarm settings'],
  ['/eng/user-parameters', 'Tham số người dùng', 'User parameters'],
  ['/settings/network', 'Cấu hình mạng', 'Network settings'],
  ['/settings/time', 'Thời gian hệ thống', 'System time'],
  ['/settings/device', 'Thông tin thiết bị', 'Device settings'],
  ['/settings/users', 'Quản lý người dùng', 'User management']
]

export function UserInfoPage() {
  const { session, logout } = useAuth()
  const { pick } = useI18n()
  const toast = useToast()
  const [openPassword, setOpenPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [savingPassword, setSavingPassword] = useState(false)

  const username = session?.username ?? 'guest'
  const role = session?.role ?? 'viewer'
  const initial = username.slice(0, 1).toUpperCase()
  const roleSummary = {
    admin: pick('Toàn quyền: cấu hình, override, acknowledge alarm, deploy demo.', 'Full access: configuration, override, alarm acknowledge, demo deploy.'),
    operator: pick('Vận hành: override có kiểm soát và acknowledge alarm.', 'Operator access: controlled override and alarm acknowledge.'),
    viewer: pick('Chỉ xem: theo dõi dashboard, monitoring, alarm và trends.', 'Read-only access: dashboard, monitoring, alarms, and trends.')
  }

  /* `T57-2.18` — quyền hiệu lực SINH TỪ `ROUTE_MIN_ROLE`, không viết tay.
   *
   * "operator" tự nó không nói lên điều gì với người dùng mới: họ phải tự thử
   * từng trang để biết mình làm được gì. Câu tóm tắt phía trên có ích nhưng là
   * văn xuôi chép tay — nó sẽ lệch ngay lần đầu ai đó siết quyền một route, và
   * lệch theo hướng nguy hiểm nhất: hứa nhiều hơn thực tế.
   *
   * Dẫn xuất từ chính bảng mà `RequireRole` và `NavRail` đang dùng, nên ba nơi
   * không bao giờ nói ba điều khác nhau. */
  const permissions = useMemo(() => {
    const rows = ROUTE_LABELS.map(([route, vi, en]) => ({
      route,
      label: pick(vi, en),
      required: ROUTE_MIN_ROLE[route],
      allowed: roleAtLeast(role, ROUTE_MIN_ROLE[route] ?? 'viewer')
    }))
    return {
      allowed: rows.filter((row) => row.allowed),
      denied: rows.filter((row) => !row.allowed)
    }
  }, [pick, role])

  /* WEB-UX-003: hàm này trước đây validate xong rồi bắn thẳng
     `toast.push('success', 'Đã đổi mật khẩu (demo)')` mà KHÔNG gọi API nào.
     Người dùng đóng hộp thoại với niềm tin mật khẩu đã đổi; lần đăng nhập sau
     mật khẩu cũ vẫn vào được, mật khẩu mới thì không — và nếu họ đổi vì nghi bị
     lộ thì thông báo giả này chính là thứ giữ cửa mở.
     Backend đã có `POST /api/v1/me/change-password` (users.go) đòi mật khẩu hiện
     tại, nên form phải có thêm ô đó. */
  async function submitPassword(event?: FormEvent) {
    event?.preventDefault()
    if (!passwordForm.current) {
      toast.push('warn', pick('Nhập mật khẩu hiện tại để xác nhận', 'Enter your current password to confirm'))
      return
    }
    if (passwordForm.next.length < 6) {
      toast.push('warn', pick('Mật khẩu mới cần tối thiểu 6 ký tự', 'New password must be at least 6 characters'))
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      toast.push('warn', pick('Mật khẩu xác nhận chưa khớp', 'Password confirmation does not match'))
      return
    }
    setSavingPassword(true)
    try {
      await apiClient.changeMyPassword(passwordForm.current, passwordForm.next)
      setOpenPassword(false)
      setPasswordForm({ current: '', next: '', confirm: '' })
      toast.push('success', pick('Đã đổi mật khẩu', 'Password changed'))
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : pick('Đổi mật khẩu thất bại', 'Password change failed'))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Thông tin người dùng', 'User info')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Thông tin người dùng và phiên hiện tại', 'User details and current session')}</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<KeyRound className="h-4 w-4" />} onClick={() => setOpenPassword(true)}>{pick('Đổi mật khẩu', 'Change password')}</Button>
          <Button variant="danger" icon={<LogOut className="h-4 w-4" />} onClick={logout}>{pick('Đăng xuất', 'Logout')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1fr]">
        <Panel title={pick('Danh tính', 'Identity')}>
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface-2)] text-3xl font-bold text-[var(--c-text)]">{initial}</div>
            <div>
              <div className="text-xl font-semibold">{username}</div>
              <div className="mt-1 inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-1 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
                <UserRound className="h-3.5 w-3.5" />{role}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title={pick('Vai trò & quyền', 'Role & permissions')}>
          <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-[var(--c-accent)]" />
            <div>
              <div className="text-sm font-semibold">{role.toUpperCase()}</div>
              <p className="mt-1 text-sm text-[var(--c-text-dim)]">{roleSummary[role]}</p>
            </div>
          </div>

          {/* `T57-2.18` — danh sách việc LÀM ĐƯỢC và KHÔNG làm được, sinh từ
              `ROUTE_MIN_ROLE`. Hiện cả hai vế là có chủ đích: chỉ liệt kê việc
              làm được thì người dùng vẫn phải thử mới biết ranh giới ở đâu, và
              khi va vào giới hạn họ không biết cần vai trò nào để vượt qua. */}
          <div className="mt-4 space-y-3 border-t border-[var(--c-border)] pt-4">
            <div>
              <div className="text-xs font-semibold uppercase text-[var(--c-good-fg)]">
                {pick('Bạn làm được', 'You can')} ({permissions.allowed.length})
              </div>
              <ul className="mt-1 space-y-0.5 text-sm">
                {permissions.allowed.map((row) => (
                  <li key={row.route} className="text-[var(--c-text)]">· {row.label}</li>
                ))}
              </ul>
            </div>
            {permissions.denied.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
                  {pick('Cần vai trò cao hơn', 'Requires a higher role')} ({permissions.denied.length})
                </div>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {permissions.denied.map((row) => (
                    <li key={row.route} className="text-[var(--c-text-dim)]">
                      · {row.label} — <span className="font-semibold">{row.required}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-[var(--c-text-dim)]">
              {pick(
                'Danh sách sinh từ bảng quyền của route, cùng bảng mà giao diện dùng để khoá nút. Máy chủ vẫn là nơi chặn cuối cùng.',
                'Derived from the route permission table — the same table the UI uses to disable controls. The server remains the final gate.'
              )}
            </p>
          </div>
        </Panel>
      </div>

      {/* WEB-UX-003: ô "Phiên" trước đây có 4 giá trị, 3 trong số đó bịa.
          - "IP demo" `192.168.1.42` và "Lần đăng nhập gần nhất"
            `2026-06-15 17:25:04` gán cứng trong JSX. Đây là hai chỉ dấu an ninh
            — người dùng nhìn chúng để phát hiện phiên lạ. Một giá trị bịa ở đây
            không chỉ vô dụng, nó chủ động che dấu hiệu xâm nhập. Backend chưa
            lưu lịch sử phiên (`GET /api/v1/me` chỉ trả username + role), nên gỡ
            hẳn thay vì để `—` vĩnh viễn; thêm lại khi có audit phiên.
          - "Auto-logout demo" đếm ngược từ 15:00 nhưng khi về 00:00 không có gì
            xảy ra, và TTL thật của JWT là 1 giờ chứ không phải 15 phút. Một đồng
            hồ đếm ngược sai và không dẫn tới hành động nào là lời hứa suông.
          - "Đăng nhập lúc" lấy `new Date()` tại thời điểm MỞ TRANG, nên mỗi lần
            vào lại trang là một mốc mới. Nay lấy `session.loginAt` thật. */}
      <Panel title={pick('Phiên', 'Session')}>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <InfoCell label={pick('Đăng nhập lúc', 'Logged in at')} value={session ? formatDateTime(session.loginAt) : '—'} />
        </dl>
      </Panel>

      <Modal open={openPassword} title={pick('Đổi mật khẩu', 'Change password')} confirmLabel={pick('Lưu', 'Save')} confirmLoading={savingPassword} onConfirm={() => { void submitPassword() }} onClose={() => setOpenPassword(false)}>
        <form className="space-y-3" onSubmit={(event) => { void submitPassword(event) }}>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Mật khẩu hiện tại', 'Current password')}
            <input className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="password" autoComplete="current-password" value={passwordForm.current} onChange={(event) => setPasswordForm((value) => ({ ...value, current: event.target.value }))} />
          </label>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Mật khẩu mới', 'New password')}
            <input className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="password" autoComplete="new-password" value={passwordForm.next} onChange={(event) => setPasswordForm((value) => ({ ...value, next: event.target.value }))} />
          </label>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Xác nhận mật khẩu', 'Confirm password')}
            <input className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="password" autoComplete="new-password" value={passwordForm.confirm} onChange={(event) => setPasswordForm((value) => ({ ...value, confirm: event.target.value }))} />
          </label>
        </form>
      </Modal>
    </div>
  )
}

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
      <dt className="text-xs uppercase text-[var(--c-text-dim)]">{label}</dt>
      <dd className={`mt-2 text-sm font-semibold ${mono ? 'mono' : ''}`}>{value}</dd>
    </div>
  )
}