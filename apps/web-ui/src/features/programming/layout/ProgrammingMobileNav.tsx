import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowLeft, Cable, ClipboardCheck, Home, Library, MoreHorizontal, PencilRuler, SlidersHorizontal } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'

type IconComponent = typeof Home

interface NavItem {
  key: string
  label: [string, string]
  shortLabel: [string, string]
  to: string | null
  icon: IconComponent
  end?: boolean
  /** Lý do BẮT BUỘC khi mục bị vô hiệu hoá — không mục nào xám đi mà im lặng. */
  disabledReason: [string, string] | null
}

const NEEDS_PROJECT: [string, string] = [
  'Cần chọn Project trước khi mở mục này',
  'Pick a project before opening this destination'
]

/**
 * BỐN đích của bottom nav (`T60-208`, handoff §7): `Overview / Runtime / Check
 * / More`.
 *
 * VÌ SAO KHÔNG PHẢI SÁU
 * ---------------------
 * `T59-503` nhồi đủ sáu workspace vào một hàng. Ở 390 px, sáu ô chia đều còn
 * ~65 px mỗi ô — nhãn bị cắt ("Điểm & Ánh xạ" → "Ánh xạ", "Thư viện điều
 * khiển" → "Thư viện") và vùng chạm nằm sát nhau tới mức bấm nhầm là chuyện
 * thường. Handoff §7 vì vậy chốt trần **bốn** đích, phần còn lại vào một ngăn
 * `More`. Đây là đổi **bố cục**, không đổi tập đích: cả sáu workspace vẫn tới
 * được, và luật "không dựng deep-link giả khi chưa có Project" giữ nguyên cho
 * từng mục, dù mục đó nằm ở hàng dưới hay trong ngăn `More`.
 *
 * Ba đích được giữ ở hàng dưới là ba đích **không phụ thuộc ngữ cảnh soạn
 * thảo**: xem tổng quan, xem vận hành, và chạy Kiểm tra/Đưa vào vận hành. Ba
 * đích vào `More` (Chương trình, Điểm & Ánh xạ, Thư viện) là các bề mặt soạn
 * thảo — chúng đòi màn rộng, và trên 390 px người dùng vào đó để *xem*, không
 * phải để *vẽ*.
 */
export function programmingMobileNavItems(projectId: string | null): { primary: NavItem[]; more: NavItem[] } {
  const projectPath = (suffix: string) => (projectId ? `/eng/programming/projects/${projectId}/${suffix}` : null)
  const needsProject = projectId ? null : NEEDS_PROJECT
  return {
    primary: [
      { key: 'overview', label: ['Tổng quan', 'Overview'], shortLabel: ['Tổng quan', 'Overview'], to: '/eng/programming', icon: Home, end: true, disabledReason: null },
      { key: 'runtime', label: ['Runtime & Bảo trì', 'Runtime & Service'], shortLabel: ['Runtime', 'Runtime'], to: '/eng/programming/runtime', icon: Activity, disabledReason: null },
      { key: 'commission', label: ['Kiểm tra & Vận hành', 'Check & Commission'], shortLabel: ['Kiểm tra', 'Check'], to: projectPath('commission'), icon: ClipboardCheck, disabledReason: needsProject }
    ],
    more: [
      { key: 'programs', label: ['Chương trình', 'Programs'], shortLabel: ['Chương trình', 'Programs'], to: projectPath('programs'), icon: PencilRuler, disabledReason: needsProject },
      { key: 'mapping', label: ['Điểm & Ánh xạ', 'Points & Mapping'], shortLabel: ['Ánh xạ', 'Mapping'], to: projectPath('mapping'), icon: Cable, disabledReason: needsProject },
      { key: 'library', label: ['Thư viện điều khiển', 'Control Library'], shortLabel: ['Thư viện', 'Library'], to: projectPath('library'), icon: Library, disabledReason: needsProject },
      {
        /* Giữ đúng cách xử lý của `ProgrammingFeatureRail`: `Project Settings`
         * của README §3 CHƯA có route, nên nó hiện diện mà vô hiệu hoá KÈM LÝ
         * DO thay vì trỏ vào một path rơi vào `<Route path="*">`. */
        key: 'project-settings',
        label: ['Cài đặt Project', 'Project Settings'],
        shortLabel: ['Cài đặt', 'Settings'],
        to: null,
        icon: SlidersHorizontal,
        disabledReason: ['Chưa có trang Cài đặt Project ở bản dựng này', 'The Project Settings page does not exist in this build']
      },
      {
        /* `R60-03` — focus mode gỡ rail toàn cục, nên lối ra phải luôn có mặt.
         * Ở `<768 px` rail Programming cũng bị ẩn, và đây là lối ra duy nhất
         * nằm ngay trong tầm ngón tay. KHÔNG BAO GIỜ vô hiệu hoá. */
        key: 'exit',
        label: ['Thoát Lập trình', 'Exit Programming'],
        shortLabel: ['Thoát', 'Exit'],
        to: '/',
        icon: ArrowLeft,
        disabledReason: null
      }
    ]
  }
}

/**
 * `ProgrammingMobileNav` — bottom navigation `<768 px`.
 *
 * Mỗi đích cao tối thiểu 44 px; **tên truy cập luôn là tên đầy đủ** dù nhãn
 * nhìn thấy được bị rút gọn cho màn 390 px — người dùng trình đọc màn hình
 * không bao giờ nghe thấy "Ánh xạ" mà phải đoán đó là gì.
 */
export function ProgrammingMobileNav({ projectId }: { projectId: string | null }) {
  const { pick } = useI18n()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const { primary, more } = programmingMobileNavItems(projectId)

  // Điều hướng xong thì ngăn `More` phải đóng: để nó mở sẽ che mất chính trang
  // vừa mở, và người dùng chạm phải nút back để thoát khỏi thứ họ vừa chọn.
  useEffect(() => setMoreOpen(false), [location.pathname])

  useEffect(() => {
    if (!moreOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMoreOpen(false)
      moreButtonRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  /* Trang hiện tại nằm trong ngăn `More` thì chính nút `More` phải được đánh
     dấu — nếu không, người dùng đang ở Điểm & Ánh xạ sẽ thấy một hàng nav
     không mục nào sáng và đọc thành "tôi không ở đâu cả". */
  const currentInMore = more.some((item) => item.to !== null && item.to !== '/' && location.pathname.startsWith(item.to))

  return (
    <>
      {moreOpen && (
        <>
          {/* Nền chắn chỉ để bắt cú chạm ra ngoài. `aria-hidden` + `tabIndex=-1`:
              nó không phải một hành động, và không được chen vào thứ tự tab
              giữa nút mở và các mục trong ngăn. */}
          <div
            aria-hidden="true"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
          />
          <div
            id="programming-mobile-more"
            data-testid="programming-mobile-more"
            className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 max-h-[60vh] overflow-y-auto border-t border-[var(--c-border)] bg-[var(--c-surface)] p-2 shadow-lg md:hidden"
          >
            <nav aria-label={pick('Đích Lập trình khác', 'Other Programming destinations')} className="flex flex-col gap-1">
              {more.map((item) => (
                <MoreRow key={item.key} item={item} onNavigate={() => setMoreOpen(false)} />
              ))}
            </nav>
          </div>
        </>
      )}

      <nav
        aria-label={pick('Điều hướng sáu workspace Lập trình', 'Six Programming workspaces navigation')}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[var(--c-border)] bg-[var(--c-surface)]/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur md:hidden"
      >
        {primary.map((item) => (
          <BottomItem key={item.key} item={item} />
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          data-nav-item="more"
          data-nav-current={currentInMore ? 'true' : undefined}
          aria-expanded={moreOpen}
          aria-controls="programming-mobile-more"
          aria-current={currentInMore ? 'true' : undefined}
          aria-label={pick('Thêm đích Lập trình', 'More Programming destinations')}
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] px-0.5 text-center text-[0.62rem] font-medium leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] ${
            moreOpen || currentInMore ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-dim)]'
          }`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          <span aria-hidden="true">{pick('Thêm', 'More')}</span>
        </button>
      </nav>
    </>
  )
}

function BottomItem({ item }: { item: NavItem }) {
  const { pick } = useI18n()
  const { key, label, shortLabel, to, icon: Icon, end, disabledReason } = item
  if (to) {
    return (
      <NavLink
        key={key}
        to={to}
        end={end}
        data-nav-item={key}
        aria-label={pick(...label)}
        className={({ isActive }) =>
          `flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] px-0.5 text-center text-[0.62rem] font-medium leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] ${
            isActive ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-dim)]'
          }`
        }
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span aria-hidden="true">{pick(...shortLabel)}</span>
      </NavLink>
    )
  }
  return (
    <span
      key={key}
      aria-disabled="true"
      data-nav-item={key}
      // Tên truy cập mang LUÔN lý do: nhãn nhìn thấy được đã bị rút gọn, nên
      // nếu lý do chỉ nằm trong `title` thì nó biến mất trên màn cảm ứng.
      aria-label={disabledReason ? `${pick(...label)} — ${pick(...disabledReason)}` : pick(...label)}
      title={disabledReason ? pick(...disabledReason) : undefined}
      className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[0.62rem] leading-tight text-[var(--c-text-dim)] opacity-45"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span aria-hidden="true">{pick(...shortLabel)}</span>
    </span>
  )
}

/** Mục trong ngăn `More`: có chỗ nên hiện **tên đầy đủ**, không rút gọn. */
function MoreRow({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { pick } = useI18n()
  const { label, to, icon: Icon, end, disabledReason } = item
  if (to) {
    return (
      <NavLink
        to={to}
        end={end}
        data-nav-item={item.key}
        aria-label={pick(...label)}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--c-border)] px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] ${
            isActive ? 'bg-[var(--c-surface-2)] text-[var(--c-accent)]' : 'text-[var(--c-text)]'
          }`
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{pick(...label)}</span>
      </NavLink>
    )
  }
  return (
    <span
      aria-disabled="true"
      data-nav-item={item.key}
      aria-label={disabledReason ? `${pick(...label)} — ${pick(...disabledReason)}` : pick(...label)}
      className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--c-border)] px-3 text-sm text-[var(--c-text-dim)] opacity-45"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{pick(...label)}</span>
    </span>
  )
}
