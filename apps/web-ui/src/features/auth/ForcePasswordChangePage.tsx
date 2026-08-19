import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { useI18n } from '../../shared/i18n'
import { useAuth } from './AuthProvider'
import { assessPassword, ENFORCED_MIN_PASSWORD_LENGTH } from './passwordPolicy'

/**
 * Màn hình bắt buộc đổi mật khẩu — `T57-3.17` (`ADR-047`).
 *
 * VÌ SAO CÓ MÀN HÌNH NÀY DÙ BACKEND ĐÃ CHẶN
 *
 * Backend mới là nơi cưỡng chế: phiên có cờ `mustChangePassword` chỉ gọi được
 * `/me` và `/me/change-password`, mọi endpoint khác trả `403
 * password_change_required`. Nếu chỉ có thế, người dùng đăng nhập xong sẽ thấy
 * một giao diện đầy lỗi quyền và đi tìm quyền bị thiếu — trong khi việc cần làm
 * là đổi mật khẩu. Màn hình này biến một chuỗi lỗi khó hiểu thành một việc rõ ràng.
 *
 * Nó **không** phải lớp bảo vệ. Gỡ nó đi thì thiết bị vẫn an toàn; gỡ lớp chặn
 * ở backend thì không.
 */
export function ForcePasswordChangePage() {
  const { pick } = useI18n()
  const { session, logout, clearPasswordChangeRequirement } = useAuth()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Chỉ `meetsEnforced` được phép chặn nút — `ADR-037` điều 2: chỉ báo độ mạnh
     là KHUYẾN NGHỊ, không phải cổng. Siết ở đây mà backend vẫn nhận 6 ký tự là
     làm giao diện mô tả sai thiết bị. */
  const assessment = assessPassword(newPassword, session?.username ?? '')
  const mismatch = confirm.length > 0 && confirm !== newPassword
  const canSubmit = oldPassword.length > 0 && assessment.meetsEnforced && !mismatch && confirm.length > 0

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await apiClient.changeMyPassword(oldPassword, newPassword)
      clearPasswordChangeRequirement()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center p-6">
      <Panel className="w-full" title={pick('Phải đổi mật khẩu trước khi tiếp tục', 'Change your password to continue')}>
        <div className="space-y-4 text-sm">
          <p className="text-[var(--c-text-dim)]">
            {pick(
              `Tài khoản "${session?.username ?? ''}" đang dùng mật khẩu do người khác đặt. Thiết bị khoá mọi thao tác khác cho tới khi bạn đặt mật khẩu của riêng mình.`,
              `The account "${session?.username ?? ''}" is using a password someone else set. The device blocks every other action until you set your own.`
            )}
          </p>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Mật khẩu hiện tại', 'Current password')}</span>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Mật khẩu mới', 'New password')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
            />
          </label>
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick(
              `Luật thiết bị đang cưỡng chế: tối thiểu ${ENFORCED_MIN_PASSWORD_LENGTH} ký tự.`,
              `Rule enforced by the device: at least ${ENFORCED_MIN_PASSWORD_LENGTH} characters.`
            )}
          </p>
          {newPassword.length > 0 && assessment.advice.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--c-text-dim)]">
              {assessment.advice.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Nhập lại mật khẩu mới', 'Repeat the new password')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
            />
            {mismatch && <span className="block text-xs text-[var(--c-fault-fg)]">{pick('Hai lần nhập chưa khớp.', 'The two entries do not match.')}</span>}
          </label>

          {error && <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] px-3 py-2 text-xs text-[var(--c-fault-fg)]">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            {/* Vẫn phải thoát được: người mở nhầm tài khoản của đồng nghiệp cần
                một đường ra, và đăng xuất không phải là bỏ qua lớp chặn. */}
            <Button variant="ghost" onClick={logout}>{pick('Đăng xuất', 'Sign out')}</Button>
            <Button variant="primary" icon={<KeyRound className="h-4 w-4" />} loading={busy} disabled={!canSubmit} onClick={() => { void submit() }}>
              {pick('Đặt mật khẩu mới', 'Set new password')}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
