import { FormEvent, useState } from 'react'
import { ChevronDown, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { LoginError, type LoginErrorKind } from './loginError'
import { DEVICE_DEFAULTS, IS_DEMO } from '../../shared/config'
import { useI18n } from '../../shared/i18n'
import { Button } from '../../shared/components/Button'

/**
 * Đích quay lại sau khi đăng nhập.
 *
 * `ProtectedShell` đã truyền `state.from` khi đẩy người dùng chưa xác thực sang
 * trang đăng nhập, nhưng trước 2026-07-31 trang này bỏ qua nó và luôn về `/` —
 * nghĩa là mọi deep link đều mất sau khi đăng nhập. Người vận hành mở link tới
 * `/settings/network` phải tự bấm lại từ menu.
 *
 * Chỉ chấp nhận đường dẫn nội bộ bắt đầu bằng đúng một dấu `/`: chuỗi kiểu
 * `//evil.example` hay `https://…` sẽ bị trình duyệt hiểu là host khác, biến
 * `state` do người khác dựng thành một open redirect.
 */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== 'string') return '/'
  if (!from.startsWith('/') || from.startsWith('//')) return '/'
  if (from === '/login') return '/'
  return from
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { lang, setLang, t, pick } = useI18n()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  /* T57-1.10 — giữ CẢ loại lỗi lẫn thông điệp: loại quyết định gợi ý hành động
     đi kèm, thông điệp là câu người dùng đọc. */
  const [error, setError] = useState<{ kind: LoginErrorKind | 'local'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const returnTo = safeReturnPath((location.state as { from?: unknown } | null)?.from)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!username.trim()) {
      setError({ kind: 'local', message: pick('Nhập tên đăng nhập', 'Enter a username') })
      return
    }
    // TC-L03 (TR-MKDDC24-P1-20260814-01): username có nhưng password rỗng
    // trước đây lọt qua guard này, gửi thẳng lên server và ăn một roundtrip
    // thừa cho một lỗi biết chắc phía client — chặn cùng cách với username.
    if (!password) {
      setError({ kind: 'local', message: pick('Nhập mật khẩu', 'Enter a password') })
      return
    }
    setLoading(true)
    setError(null)
    try {
      await login(password, username.trim())
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(toLoginError(err, pick))
    } finally {
      setLoading(false)
    }
  }

  async function enterAsGuest() {
    setError(null)
    try {
      await login('', 'guest')
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(toLoginError(err, pick))
    }
  }

  return (
    <main className="login-skyline grid min-h-screen place-items-center overflow-hidden p-6 relative">
      <section className="panel-shadow relative z-10 w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-7">
        {/* BUG-001 (TR-MKDDC24-P1-20260814-01): trang đăng nhập trước đây
            không có cách nào đổi ngôn ngữ — người dùng bị `detectDefaultLang`
            (theo `navigator.language`) khoá tới khi đăng nhập xong mới thấy
            nút đổi ở TopBar. Thêm cùng một nút, cùng style, ngay tại đây. */}
        <button
          type="button"
          className="absolute right-4 top-4 flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2.5 text-xs font-semibold text-[var(--c-text)]"
          onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
          aria-label={pick('Đổi ngôn ngữ', 'Toggle language')}
        >
          {lang.toUpperCase()} <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="text-center">
          <div className="text-2xl font-black"><span className="text-[var(--c-accent-2)]">DDC</span> 24</div>
          <h1 className="mt-4 text-xl font-semibold">{t('loginTitle')}</h1>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">{t('loginSub')}</p>
        </div>
        {/* WEB-UX-002: ở đây từng có 4 badge `core / iobus / web / IOP` gán cứng
            `state="online"`. Trang đăng nhập chạy TRƯỚC khi xác thực, mà mọi
            endpoint trạng thái đều yêu cầu quyền tối thiểu `viewer` — nên không
            có cách nào biết service đang sống hay chết. Bốn ô xanh đó là lời
            khẳng định thuần tuý bịa: kỹ thuật viên tới tủ vì mất điều khiển, mở
            web lên vẫn thấy "tất cả online" trước cả khi kịp đăng nhập.
            Cùng lý do, IP / BACnet ID / Firmware cũng bị gỡ: chúng đọc từ biến
            build-time `VITE_*` với giá trị dự phòng `192.168.1.100` và `47808`,
            tức là hiển thị thông số của một thiết bị tưởng tượng. Model là hằng
            số dòng sản phẩm, biết chắc tại thời điểm build, nên giữ lại. */}
        <dl className="mt-5 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs">
          <div className="flex items-center justify-between gap-3"><dt className="text-[var(--c-text-dim)]">Model</dt><dd className="font-semibold">{DEVICE_DEFAULTS.model}</dd></div>
        </dl>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {/* WEB-UX-009: ô này trước đây là `value="admin" readOnly`.
              Backend đã hiện thực đủ 3 vai trò (`viewer` / `operator` / `admin`,
              xem `Role` trong apps/web-api/internal/app/auth.go) với `auth.Require(...)` trên
              từng endpoint, và trang Người dùng cho phép tạo tài khoản — nhưng
              không tài khoản nào trong số đó đăng nhập được qua Web, vì form
              luôn gửi `admin`. Toàn bộ công RBAC ở backend nằm chết, và trên
              thực tế mọi người dùng Web đều thao tác dưới quyền cao nhất. */}
          <label className="block text-xs text-[var(--c-text-dim)]">
            {t('username')}
            <span className="mt-1 flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3">
              <UserRound className="h-4 w-4" aria-hidden="true" />
              <input
                className="w-full bg-transparent text-sm outline-none"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                aria-label={t('username')}
                autoComplete="username"
                autoFocus
              />
            </span>
          </label>
          <label className="block text-xs text-[var(--c-text-dim)]">
            {t('password')}
            <span className="mt-1 flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              <input className="w-full bg-transparent text-sm outline-none" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} aria-label={t('password')} autoComplete="current-password" />
              {/* Biểu tượng con mắt trước đây chỉ là hình vẽ, không bấm được —
                  một nút chết nữa. Nay nó thực sự hiện/ẩn mật khẩu. */}
              <button
                type="button"
                className="text-[var(--c-text-dim)] hover:text-[var(--c-text)]"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? pick('Ẩn mật khẩu', 'Hide password') : pick('Hiện mật khẩu', 'Show password')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </span>
          </label>
          {/* WEB-UX-002: `Ghi nhớ đăng nhập` và `Quên mật khẩu?` không nối vào
              gì cả — không có cơ chế ghi nhớ phiên, cũng không có luồng khôi
              phục mật khẩu (đặt lại mật khẩu là việc của admin qua trang Người
              dùng). Giữ hai thứ đó là hứa với người vận hành một lối thoát
              không tồn tại; nguyên tắc §3.1.3 của plan 45: thà gỡ còn hơn lừa. */}
          {/* T57-1.10 — mỗi loại lỗi kèm gợi ý hành động RIÊNG. Ba nguyên nhân
              này cần ba việc khác hẳn nhau từ người dùng, nên một câu "Đăng
              nhập thất bại" dùng chung là bắt họ đoán. */}
          {error && <LoginErrorNotice kind={error.kind} message={error.message} />}
          <Button className="w-full" variant="primary" type="submit" loading={loading}>{t('signIn')}</Button>
          {/* Nút Khách chỉ có nghĩa ở bản demo (AUTH_MODE `mock`/`none` cấp phiên
              ngay). Ở bản live nó gọi `/auth/login` với mật khẩu rỗng, luôn hỏng,
              và vì viết theo kiểu `.then()` không `catch` nên lỗi rơi vào
              unhandled rejection — người dùng bấm mà không thấy gì xảy ra. */}
          {IS_DEMO && (
            <Button className="w-full" type="button" variant="secondary" size="sm" onClick={() => { void enterAsGuest() }}>{t('guest')}</Button>
          )}
        </form>
        <p className="mt-5 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-xs text-[var(--c-warn-fg)]">
          {pick('Cảnh báo: đổi mật khẩu mặc định trước khi đưa thiết bị vào vận hành.', 'Warning: change the default password before putting the device into operation.')}
        </p>
      </section>
    </main>
  )
}

/** Chuẩn hoá bất kỳ thứ gì bị ném thành cặp (loại, thông điệp).
 *
 *  Lỗi không phải `LoginError` (lỗi lập trình, lỗi thư viện) được xếp `server`
 *  chứ không phải `credentials`: gợi ý người dùng đi gõ lại mật khẩu cho một
 *  lỗi không liên quan tới mật khẩu là dẫn họ đi sai hướng. */
export function toLoginError(
  err: unknown,
  pick: (vi: string, en: string) => string
): { kind: LoginErrorKind | 'local'; message: string } {
  if (err instanceof LoginError) return { kind: err.kind, message: err.message }
  return {
    kind: 'server',
    message: err instanceof Error ? err.message : pick('Đăng nhập thất bại', 'Sign in failed')
  }
}

function LoginErrorNotice({ kind, message }: { kind: LoginErrorKind | 'local'; message: string }) {
  const { pick } = useI18n()
  const hint = {
    credentials: pick(
      'Kiểm tra phím Caps Lock và bố cục bàn phím. Quên mật khẩu thì cần một quản trị viên đặt lại ở trang Người dùng — thiết bị không có luồng tự khôi phục.',
      'Check Caps Lock and your keyboard layout. If the password is lost, an administrator must reset it on the Users page — the device has no self-service recovery.'
    ),
    unreachable: pick(
      'Thử mở lại địa chỉ của bộ điều khiển trong một tab mới. Nếu cũng không mở được thì vấn đề nằm ở mạng hoặc ở nguồn của thiết bị, không phải ở tài khoản.',
      'Try opening the controller address in a new tab. If that also fails, the problem is the network or the device power, not your account.'
    ),
    server: pick(
      'Thử lại sau ít phút. Nếu vẫn vậy, xem nhật ký dịch vụ web trên bộ điều khiển.',
      'Retry in a few minutes. If it persists, check the web service log on the controller.'
    ),
    local: ''
  }[kind]

  if (kind === 'local') {
    return <p role="alert" className="text-sm text-[var(--c-fault-fg)]">{message}</p>
  }
  return (
    <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] px-3 py-2 text-sm text-[var(--c-fault-fg)]">
      <p className="font-semibold">{message}</p>
      {hint && <p className="mt-1 text-xs">{hint}</p>}
    </div>
  )
}
