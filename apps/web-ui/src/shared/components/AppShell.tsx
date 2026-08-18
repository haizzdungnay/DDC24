import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../features/auth'
import {
  AlarmTone,
  alarmSoundKey,
  readAlarmSoundPreference,
  shouldAnnunciate
} from '../alarms/annunciation'
import { apiClient } from '../api/client'
import { IS_DEMO } from '../config'
import { useApi } from '../hooks/useApi'
import { useRealtime } from '../realtime'
import { useI18n } from '../i18n'
import { NavDrawer, NavRail } from './NavRail'
import { Breadcrumb } from './pa3/Breadcrumb'
import { CommandPalette } from './pa3/CommandPalette'
import { TopBar } from './TopBar'
import { RouteErrorBoundary } from './RouteErrorBoundary'

export function AppShell() {
  const location = useLocation()
  const { connectionState } = useRealtime()
  const { session } = useAuth()
  const { t } = useI18n()
  const alarms = useApi(apiClient.getAlarms, [], { refreshMs: 1000 })
  const health = useApi(apiClient.getHealth, [], { refreshMs: 5000 })
  const me = useApi(() => IS_DEMO ? Promise.resolve(session) : apiClient.getMe(), [session], { refreshMs: IS_DEMO ? undefined : 30000 })
  const [navOpen, setNavOpen] = useState(false)
  const alarmCount = alarms.data?.filter((alarm) => (alarm.active ?? (alarm.status === 'active' || alarm.status === 'acked')) || alarm.status === 'unack').length ?? 0
  const currentUser = me.data ?? session

  useEffect(() => {
    const refresh = () => { void alarms.refetch() }
    window.addEventListener('mkddc:alarms-updated', refresh)
    return () => window.removeEventListener('mkddc:alarms-updated', refresh)
  }, [alarms.refetch])

  /* T57-1.5 / `ADR-034` — annunciation hai lớp.
   *
   * Lớp NHÌN (`annunciating`) là bắt buộc và luôn chạy được vì nó không phụ
   * thuộc chính sách autoplay của trình duyệt. Lớp NGHE chỉ kêu khi người dùng
   * đã bật VÀ ngữ cảnh âm thanh thật sự `running`; `AlarmTone.play()` tự bỏ qua
   * khi chưa `running` thay vì ném lỗi vào một Promise không ai bắt.
   *
   * Kích hoạt theo mức TĂNG của số cảnh báo chưa xác nhận, không theo "đang có
   * unack > 0": kêu liên tục suốt ca là cách chắc chắn nhất để người trực tắt
   * tiếng vĩnh viễn, tức là mất hẳn lớp annunciation (ISA-18.2 alarm fatigue).
   */
  const unacked = alarms.data?.filter((alarm) => alarm.status === 'unack').length ?? 0
  const previousUnackedRef = useRef(-1)
  const toneRef = useRef<AlarmTone | null>(null)
  const [annunciating, setAnnunciating] = useState(false)
  const soundKey = alarmSoundKey(health.data?.deviceName ?? '', session?.username ?? '')

  useEffect(() => {
    const previous = previousUnackedRef.current
    previousUnackedRef.current = unacked
    if (!shouldAnnunciate(previous, unacked)) return
    setAnnunciating(true)
    if (readAlarmSoundPreference(soundKey)) {
      if (!toneRef.current) toneRef.current = new AlarmTone()
      /* `arm()` ở đây KHÔNG nằm trong một cử chỉ người dùng nên thường không
         mở khoá được — và đó là hành vi đúng: nó chỉ đánh thức lại một ngữ
         cảnh đã được mở khoá từ trang Hiển thị. Trạng thái thật hiện ở đó. */
      void toneRef.current.arm().then(() => toneRef.current?.play())
    }
    /* Nhấp nháy có điểm dừng: một badge nháy vĩnh viễn trở thành nhiễu nền và
       bị mắt lọc bỏ sau vài phút. */
    const timer = window.setTimeout(() => setAnnunciating(false), 12000)
    return () => window.clearTimeout(timer)
  }, [unacked, soundKey])

  /* Hết cảnh báo chưa xác nhận thì dừng ngay, không đợi hết 12 giây. */
  useEffect(() => {
    if (unacked === 0) setAnnunciating(false)
  }, [unacked])

  useEffect(() => () => { toneRef.current?.close() }, [])

  return (
    <div className="min-h-screen bg-[var(--c-bg)] text-[var(--c-text)]">
      {/* PA3-202 / WCAG 2.2 AA 2.4.1: thanh bên có hơn 20 liên kết. Không có
          đường nhảy qua chúng thì người dùng bàn phím phải Tab hơn 20 lần trên
          MỌI trang trước khi chạm được nội dung. Link ẩn cho tới khi nhận tiêu
          điểm, nên không chiếm chỗ của người dùng chuột. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-[var(--radius)] focus:border focus:border-[var(--c-accent)] focus:bg-[var(--c-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--c-accent)]"
      >
        {t('skip-to-content')}
      </a>
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] border-x border-[var(--c-border)]">
        <NavRail alarmCount={alarmCount} device={health.data} />
        {/* WEB-UX-010: ngăn kéo thay cho thanh bên khi màn hình dưới 1024px. */}
        <NavDrawer open={navOpen} alarmCount={alarmCount} device={health.data} onClose={() => setNavOpen(false)} />
        <div className="min-w-0 flex-1">
          <TopBar connectionState={connectionState} alarmCount={alarmCount} unackedCount={unacked} annunciating={annunciating} currentUser={currentUser} onOpenNav={() => setNavOpen(true)} />
          {connectionState !== 'connected' && (
            <div className="sticky top-16 z-30 border-b border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-5 py-2 text-sm text-[var(--c-warn-fg)]">
              {t('reconnecting')}
            </div>
          )}
          <main id="main-content" className="p-5">
            {/* PA3-204: breadcrumb chỉ hiện với trang có chiều sâu, và command
                palette (Ctrl/⌘+K) sống ở cấp shell để mở được từ mọi trang. */}
            <Breadcrumb />
            {/* Một trang lỗi không được làm trắng cả ứng dụng. `resetKey` là
                đường dẫn hiện tại, nên chuyển sang trang khác sẽ tự thử render
                lại thay vì kẹt ở màn hình lỗi. */}
            <RouteErrorBoundary resetKey={location.pathname} label={location.pathname}>
              <Outlet />
            </RouteErrorBoundary>
          </main>
          <CommandPalette />
        </div>
      </div>
    </div>
  )
}
