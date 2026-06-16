import { FormEvent, useState } from 'react'
import { Eye, LockKeyhole, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { DEVICE_DEFAULTS } from '../config'
import { useI18n } from '../i18n'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await login(password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-skyline grid min-h-screen place-items-center overflow-hidden p-6 relative">
      <section className="panel-shadow relative z-10 w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(17,26,43,0.9)] p-7">
        <div className="text-center">
          <div className="text-2xl font-black"><span className="text-[var(--c-accent-2)]">DDC</span> 24</div>
          <h1 className="mt-4 text-xl font-semibold">{t('loginTitle')}</h1>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">{t('loginSub')}</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
          <StatusBadge state="online" label="core" />
          <StatusBadge state="online" label="iobus" />
          <StatusBadge state="online" label="web" />
          <StatusBadge state="online" label="IOP" />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(11,18,32,0.62)] p-3 text-xs">
          <div><dt className="text-[var(--c-text-dim)]">Model</dt><dd className="font-semibold">{DEVICE_DEFAULTS.model}</dd></div>
          <div><dt className="text-[var(--c-text-dim)]">IP</dt><dd className="mono">{DEVICE_DEFAULTS.ip}</dd></div>
          <div><dt className="text-[var(--c-text-dim)]">BACnet ID</dt><dd className="mono">{DEVICE_DEFAULTS.bacnetDeviceId}</dd></div>
          <div><dt className="text-[var(--c-text-dim)]">Firmware</dt><dd className="mono">{DEVICE_DEFAULTS.firmware}</dd></div>
        </dl>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-xs text-[var(--c-text-dim)]">
            Username
            <span className="mt-1 flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3">
              <UserRound className="h-4 w-4" aria-hidden="true" />
              <input className="w-full bg-transparent text-sm outline-none" value="admin" readOnly aria-label="Username" />
            </span>
          </label>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {t('password')}
            <span className="mt-1 flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              <input className="w-full bg-transparent text-sm outline-none" type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-label={t('password')} autoFocus />
              <Eye className="h-4 w-4 text-[var(--c-text-dim)]" aria-hidden="true" />
            </span>
          </label>
          <div className="flex items-center justify-between text-xs text-[var(--c-text-dim)]">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--c-accent)]" /> Remember me</label>
            <button type="button" className="text-[var(--c-accent)]">Forgot password?</button>
          </div>
          {error && <p className="text-sm text-[var(--c-fault)]">{error}</p>}
          <Button className="w-full" variant="primary" type="submit" loading={loading}>{t('signIn')}</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" size="sm">SSO / AD</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => void login('').then(() => navigate('/'))}>{t('guest')}</Button>
          </div>
        </form>
        <p className="mt-5 rounded-[var(--radius)] border border-[rgba(224,161,6,0.38)] bg-[rgba(224,161,6,0.08)] p-3 text-xs text-[var(--c-warn)]">
          Cảnh báo: đổi mật khẩu mặc định trước khi đưa thiết bị vào vận hành.
        </p>
      </section>
    </main>
  )
}
