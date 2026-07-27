import { FormEvent, useEffect, useState } from 'react'
import { KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import { formatDateTime } from '../utils'
import type { UserRole } from '../types'

export function UserInfoPage() {
  const { session, logout } = useAuth()
  const { pick } = useI18n()
  const toast = useToast()
  const [loginAt] = useState(() => new Date())
  const [countdown, setCountdown] = useState(15 * 60)
  const [openPassword, setOpenPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ next: '', confirm: '' })

  useEffect(() => {
    const id = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(id)
  }, [])

  const username = session?.username ?? 'guest'
  const role = session?.role ?? 'viewer'
  const initial = username.slice(0, 1).toUpperCase()
  const countdownText = `${Math.floor(countdown / 60).toString().padStart(2, '0')}:${(countdown % 60).toString().padStart(2, '0')}`
  const roleSummary: Record<UserRole, string> = {
    admin: pick('Toàn quyền: cấu hình, override, acknowledge alarm, deploy demo.', 'Full access: configuration, override, alarm acknowledge, demo deploy.'),
    engineer: pick('Kỹ sư: cấu hình và deploy, không quản lý user hoặc database.', 'Engineer access: configuration and deploy, excluding users and database policy.'),
    operator: pick('Vận hành: override có kiểm soát và acknowledge alarm.', 'Operator access: controlled override and alarm acknowledge.'),
    viewer: pick('Chỉ xem: theo dõi dashboard, monitoring, alarm và trends.', 'Read-only access: dashboard, monitoring, alarms, and trends.')
  }

  function submitPassword(event?: FormEvent) {
    event?.preventDefault()
    if (passwordForm.next.length < 6) {
      toast.push('warn', pick('Mật khẩu mới cần tối thiểu 6 ký tự', 'New password must be at least 6 characters'))
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      toast.push('warn', pick('Mật khẩu xác nhận chưa khớp', 'Password confirmation does not match'))
      return
    }
    setOpenPassword(false)
    setPasswordForm({ next: '', confirm: '' })
    toast.push('success', pick('Đã đổi mật khẩu (demo)', 'Password changed (demo)'))
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
        </Panel>
      </div>

      <Panel title={pick('Phiên', 'Session')}>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <InfoCell label={pick('Đăng nhập lúc', 'Logged in at')} value={formatDateTime(loginAt.toISOString())} />
          <InfoCell label="Auto-logout demo" value={countdownText} mono />
          <InfoCell label="IP demo" value="192.168.1.42" mono />
          <InfoCell label={pick('Lần đăng nhập gần nhất', 'Last login')} value="2026-06-15 17:25:04" />
        </dl>
      </Panel>

      <Modal open={openPassword} title={pick('Đổi mật khẩu', 'Change password')} confirmLabel={pick('Lưu', 'Save')} onConfirm={submitPassword} onClose={() => setOpenPassword(false)}>
        <form className="space-y-3" onSubmit={submitPassword}>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Mật khẩu mới', 'New password')}
            <input className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="password" value={passwordForm.next} onChange={(event) => setPasswordForm((value) => ({ ...value, next: event.target.value }))} />
          </label>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Xác nhận mật khẩu', 'Confirm password')}
            <input className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="password" value={passwordForm.confirm} onChange={(event) => setPasswordForm((value) => ({ ...value, confirm: event.target.value }))} />
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
