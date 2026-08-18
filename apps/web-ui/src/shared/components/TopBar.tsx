import { Bell, ChevronDown, CircleHelp, LogOut, Menu, Moon, Sun, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../features/auth'
import { prefersReducedMotion } from '../alarms/annunciation'
import { IS_DEMO } from '../config'
import { useI18n } from '../i18n'
import { useOptionalOverview } from '../overview/OverviewProvider'
import { useTheme } from '../theme/ThemeProvider'
import type { ConnectionState, CurrentUser } from '../types'
import { cn, formatDataAge } from '../utils'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'
import { HealthChip, SeverityBadge, healthReasonLabel } from './pa3/StateAtoms'

/**
 * TopBar — PA3-203 / UX-DES §2.2.
 *
 * Bên trái: định danh thiết bị và kết nối. Bên phải: trạng thái tổng, tuổi dữ
 * liệu, cảnh báo theo mức, giờ, người dùng.
 *
 * KHÔNG đặt badge CPU/RAM/process ở đây (§2.2 nói thẳng). Chúng ở Diagnostics.
 */
export function TopBar({ connectionState, alarmCount, unackedCount = 0, annunciating = false, currentUser, onOpenNav }: { connectionState: ConnectionState; alarmCount: number; unackedCount?: number; annunciating?: boolean; currentUser: CurrentUser | null; onOpenNav?: () => void }) {
  const [now, setNow] = useState(new Date())
  const { logout } = useAuth()
  const { lang, locale, setLang, t, pick } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const overview = useOptionalOverview()
  /* Đọc một lần khi mount: người dùng đổi tuỳ chọn hệ điều hành giữa chừng là
     trường hợp hiếm, còn gọi `matchMedia` mỗi lần render thì tốn vô ích. */
  const [reducedMotion] = useState(prefersReducedMotion)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const online = connectionState === 'connected'
  const snapshot = overview?.data ?? null
  const deviceName = snapshot?.controller.deviceName?.trim()
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b border-[var(--c-border)] bg-[var(--c-surface)] px-3 sm:gap-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* WEB-UX-010: dưới 1024px `NavRail` bị ẩn (`hidden … lg:flex`) và trước
            đây không có gì thay thế — mở web trên điện thoại là mất sạch điều
            hướng, chỉ còn cách gõ tay URL. Nút này mở ngăn kéo thay thế. */}
        {onOpenNav && (
          <button
            type="button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] lg:hidden"
            onClick={onOpenNav}
            aria-label={pick('Mở điều hướng', 'Open navigation')}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <div className="hidden h-9 w-px bg-[var(--c-border)] lg:block" />
        {deviceName && <span className="hidden min-w-0 truncate text-sm font-semibold lg:inline" title={deviceName}>{deviceName}</span>}
        <StatusBadge state={online ? 'online' : 'offline'} label={`${t('system')}: ${online ? t('online') : t('offline')}`} />
        <span className="hidden sm:inline-flex"><StatusBadge state={IS_DEMO ? 'demo' : 'live'} label={IS_DEMO ? t('demo') : t('live')} /></span>
        {snapshot && (
          <>
            {/* BUG-008 — badge FAULT/DEGRADED trước đây không click/hover được,
                người trực không biết vì sao mà phải mở Diagnostics dò thủ công. */}
            <Link
              to="/diagnostics"
              className="hidden md:inline-flex"
              aria-label={pick(`Trạng thái ${snapshot.overallState}: ${healthReasonLabel(snapshot.overallReasonCode, lang)}. Mở Chẩn đoán.`, `Status ${snapshot.overallState}: ${healthReasonLabel(snapshot.overallReasonCode, lang)}. Open Diagnostics.`)}
            >
              <HealthChip state={snapshot.overallState} title={healthReasonLabel(snapshot.overallReasonCode, lang)} />
            </Link>
            {/* Tuổi dữ liệu là số đo an toàn, không phải trang trí: người trực
                phải biết mình đang nhìn dữ liệu bao nhiêu giây tuổi. `—` khi
                không point nào có mốc thời gian thật (PA3-F04). */}
            <span className="mono hidden text-xs text-[var(--c-text-dim)] lg:inline" title={pick('Tuổi dữ liệu mới nhất', 'Age of the newest data')}>
              {pick('Dữ liệu', 'Data')} {formatDataAge(snapshot.lastDataAt)}
            </span>
          </>
        )}
      </div>
      {snapshot && (
        <div className="hidden shrink-0 items-center gap-1.5 xl:flex">
          {snapshot.alarms.critical > 0 && <SeverityBadge severity="critical" count={snapshot.alarms.critical} />}
          {snapshot.alarms.high > 0 && <SeverityBadge severity="high" count={snapshot.alarms.high} />}
          {snapshot.alarms.medium > 0 && <SeverityBadge severity="medium" count={snapshot.alarms.medium} />}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        {/* BUG-017 (TR-MKDDC24-P2-20260814-02 / TC-D10): ở 768–1023px, khối này
            cùng khối trạng thái bên trái (SYSTEM/DEMO/FAULT) và badge sức khoẻ
            (`md:inline-flex`) đồng thời hiện — tổng bề rộng nội dung vượt bề
            rộng header thật (đo bằng Playwright: ~973px cần > ~790px có ở
            1024px), khiến header không wrap mà đè chữ lên nhau. Đồng hồ/ngày
            và tên/role là thông tin phụ (đã có ở trang User/nơi khác), đẩy
            xuống `xl:` để nhường chỗ cho badge sức khoẻ — thứ operator cần
            thấy ngay ở độ rộng máy tính bảng. */}
        <div className="hidden border-r border-[var(--c-border)] pr-6 text-right xl:block">
          <div className="mono text-sm font-semibold">{now.toLocaleTimeString(locale, { hour12: false })}</div>
          <div className="text-xs text-[var(--c-text-dim)]">{now.toLocaleDateString(locale)}</div>
        </div>
        {/* T57-1.5 / `ADR-034` — lớp NHÌN của annunciation.
            `annunciating` bật khi số cảnh báo chưa xác nhận vừa TĂNG. Hai thứ
            đi kèm và không thể thiếu cái nào:
             1. `prefers-reduced-motion` ⇒ KHÔNG nhấp nháy, nhưng vẫn phải nổi
                bật: viền đậm + nhãn chữ. Tắt hẳn annunciation cho nhóm người
                dùng này là biến một tuỳ chọn tiếp cận thành sự cố an toàn.
             2. `role="status"` + `aria-live` để trình đọc màn hình nói ra —
                một tín hiệu chỉ nhìn thấy được không tới được người khiếm thị. */}
        <Link
          to="/alarms"
          className={cn(
            'relative grid h-10 w-10 place-items-center rounded-full border bg-[var(--c-surface)]',
            annunciating ? 'border-2 border-[var(--c-fault)]' : 'border-[var(--c-border)]',
            annunciating && !reducedMotion && 'annunciate'
          )}
          aria-label={annunciating
            ? pick(`Cảnh báo — ${unackedCount} chưa xác nhận, có cảnh báo mới`, `Alarms — ${unackedCount} unacknowledged, new alarm`)
            : pick('Cảnh báo', 'Alarms')}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {alarmCount > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[10px] font-bold text-[var(--c-on-fault)]">{alarmCount}</span>}
        </Link>
        {annunciating && (
          <span role="status" aria-live="assertive" className="hidden rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] px-2 py-1 text-[11px] font-bold uppercase text-[var(--c-fault-fg)] sm:inline">
            {pick(`${unackedCount} chưa xác nhận`, `${unackedCount} unacknowledged`)}
          </span>
        )}
        <Link to="/help" className="hidden h-10 w-10 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] sm:grid" aria-label={pick("Trợ giúp", "Help")}><CircleHelp className="h-5 w-5" /></Link>
        <Link to="/me" className="hidden h-10 w-10 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] sm:grid" aria-label={pick("Người dùng", "User")}><UserRound className="h-5 w-5" /></Link>
        <div className="hidden min-w-[132px] xl:block">
          <div className="text-sm font-semibold">{currentUser?.username ?? 'N/A'}</div>
          <div className="text-xs text-[var(--c-text-dim)]">{currentUser?.role ?? 'N/A'}</div>
        </div>
        {/* WEB-UX-012: đổi theme sáng/tối. Phòng máy tối mà màn hình sáng thì
            chói suốt ca đêm; đây là điều kiện nghiệm thu của audit UI/UX, không
            phải tuỳ chọn trang trí. Lựa chọn được ghi nhớ qua localStorage. */}
        <button
          className="grid h-10 w-10 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)]"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? pick('Chuyển sang giao diện sáng', 'Switch to light theme') : pick('Chuyển sang giao diện tối', 'Switch to dark theme')}
          title={theme === 'dark' ? pick('Giao diện sáng', 'Light theme') : pick('Giao diện tối', 'Dark theme')}
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
        </button>
        <button className="flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-2 text-xs font-semibold sm:px-3" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} aria-label={pick("Đổi ngôn ngữ", "Toggle language")}>
          {lang.toUpperCase()} <ChevronDown className="h-4 w-4" />
        </button>
        <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={logout}><span className="hidden sm:inline">{t('logout')}</span></Button>
      </div>
    </header>
  )
}
