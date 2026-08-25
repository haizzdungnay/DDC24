import { Activity, ArrowLeft, Cable, ClipboardCheck, Home, Library, PencilRuler, SlidersHorizontal } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { PRODUCT_INFO } from '../../../shared/productInfo'
import { programsWorkspacePath } from '../shared/programsRoute'

/**
 * Bề ngang chốt của rail theo README §3 (`Feature Rail 220`). Giữ ở dạng hằng
 * số thay vì chỉ một lớp Tailwind: jsdom không có CSS nên test chỉ khẳng định
 * được ràng buộc này khi con số nằm trong JS.
 */
export const PROGRAMMING_FEATURE_RAIL_WIDTH_PX = 220

/**
 * Nhãn vùng điều hướng — GIỮ NGUYÊN VĂN từ `ProgrammingDesktopNav` mà rail này
 * thay thế.
 *
 * Đây không phải sự lười: `e2e/programming-real.spec.ts` chọn landmark bằng
 * đúng chuỗi này (bốn chỗ) để bấm sang Library/Mapping/Runtime. Đổi tên vùng
 * sẽ làm đỏ một spec nằm ngoài phạm vi task này mà chẳng sửa được lỗi nào.
 */
export const PROGRAMMING_RAIL_NAV_LABEL: readonly [string, string] = [
  'Điều hướng sáu workspace Lập trình trên desktop',
  'Six Programming workspaces navigation (desktop)'
]

type IconComponent = typeof Home

interface RailItem {
  key: string
  label: [string, string]
  to: string | null
  icon: IconComponent
  end?: boolean
  /** Lý do BẮT BUỘC khi mục bị vô hiệu hoá — không có mục nào xám đi mà im lặng. */
  disabledReason: [string, string] | null
}

/**
 * Sáu đích canonical + `Project Settings`. Tách khỏi component để test đọc được
 * bảng đích mà không phải suy từ DOM, và để một chỗ duy nhất quyết định mục nào
 * phụ thuộc Project.
 */
export function programmingRailItems(projectId: string | null): RailItem[] {
  const needsProject: [string, string] = [
    'Cần chọn Project trước khi mở mục này',
    'Pick a project before opening this destination'
  ]
  const projectPath = (suffix: string) => (projectId ? `/eng/programming/projects/${projectId}/${suffix}` : null)
  return [
    { key: 'overview', label: ['Tổng quan', 'Overview'], to: '/eng/programming', icon: Home, end: true, disabledReason: null },
    { key: 'programs', label: ['Chương trình', 'Programs'], to: projectId ? programsWorkspacePath(projectId) : null, icon: PencilRuler, disabledReason: projectId ? null : needsProject },
    { key: 'mapping', label: ['Điểm & Ánh xạ', 'Points & Mapping'], to: projectPath('mapping'), icon: Cable, disabledReason: projectId ? null : needsProject },
    { key: 'library', label: ['Thư viện điều khiển', 'Control Library'], to: projectPath('library'), icon: Library, disabledReason: projectId ? null : needsProject },
    { key: 'commission', label: ['Kiểm tra & Vận hành', 'Check & Commission'], to: projectPath('commission'), icon: ClipboardCheck, disabledReason: projectId ? null : needsProject },
    { key: 'runtime', label: ['Runtime & Bảo trì', 'Runtime & Service'], to: '/eng/programming/runtime', icon: Activity, disabledReason: null },
    {
      /* `Project Settings` của README §3 CHƯA có route: `ProgrammingRoutes` chỉ
       * khai đúng sáu workspace. Trỏ nó vào một path chưa tồn tại sẽ rơi vào
       * `<Route path="*">` và bật ngược về Overview — người dùng bấm một mục
       * rồi thấy mình quay lại chỗ cũ mà không có lời giải thích nào. Vì vậy
       * mục hiện diện nhưng vô hiệu hoá KÈM LÝ DO, đúng luật "không bịa đích". */
      key: 'project-settings',
      label: ['Cài đặt Project', 'Project Settings'],
      to: null,
      icon: SlidersHorizontal,
      disabledReason: ['Chưa có trang Cài đặt Project ở bản dựng này', 'The Project Settings page does not exist in this build']
    }
  ]
}

/**
 * `ProgrammingFeatureRail` — `T60-101`, hiện thực **focus mode** của `D-01`.
 *
 * VÌ SAO RAIL NÀY THAY RAIL TOÀN CỤC
 * ----------------------------------
 * `NavRail` toàn cục rộng 232 px. Để cả hai thì ở 1280 px chỉ còn 828 px cho
 * workspace, và PGM-02 (cây POU 220 + editor + inspector 280) chỉ còn ~328 px
 * cho editor — không dùng được. Việc chặn render nằm ở `NavRail.tsx`
 * (`isProgrammingFocusRoute`); `NAV_GROUPS` KHÔNG đổi nên hợp đồng route↔menu
 * của `ADR-032` không bị động tới.
 *
 * LỐI RA LÀ BẮT BUỘC (`R60-03`)
 * -----------------------------
 * Vì rail toàn cục biến mất, mục `← Thoát Lập trình` là đường duy nhất rời
 * workspace bằng chuột ở ≥1024 px (nút mở ngăn kéo của `TopBar` là `lg:hidden`).
 * Nó đứng đầu rail và KHÔNG BAO GIỜ bị vô hiệu hoá.
 *
 * BREAKPOINT
 * ----------
 * `<768 px` ẩn hoàn toàn — nhường chỗ cho bottom nav; `768–1023 px` thu còn
 * icon (tên đi vào `aria-label`/`title`, không mất với trình đọc màn hình);
 * `≥1024 px` đủ 220 px kèm chữ.
 */
export function ProgrammingFeatureRail({ projectId }: { projectId: string | null }) {
  const { pick } = useI18n()
  const items = programmingRailItems(projectId)

  return (
    <aside
      data-testid="programming-feature-rail"
      className="sticky top-16 hidden max-h-[calc(100vh-4rem)] shrink-0 flex-col gap-2 self-start overflow-y-auto border-r border-[var(--c-border)] bg-[var(--c-surface)] py-2 pr-2 md:flex md:w-16 lg:w-[220px]"
    >
      <div className="px-2">
        <div
          className="truncate text-sm font-black leading-none text-[var(--c-text)]"
          title={PRODUCT_INFO.name}
        >
          <span className="lg:hidden">{PRODUCT_INFO.code}</span>
          <span className="hidden lg:inline">{PRODUCT_INFO.name}</span>
        </div>
      </div>

      <nav aria-label={pick(...PROGRAMMING_RAIL_NAV_LABEL)} className="flex min-h-0 flex-col gap-1">
        <NavLink
          to="/"
          aria-label={pick('Thoát Lập trình', 'Exit Programming')}
          title={pick('Quay lại Bảng điều khiển và điều hướng toàn hệ thống', 'Back to the dashboard and the system-wide navigation')}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] px-2 text-sm font-semibold text-[var(--c-text-dim)] transition hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] md:justify-center lg:justify-start"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden truncate lg:inline">{pick('← Thoát Lập trình', '← Exit Programming')}</span>
        </NavLink>

        <hr className="my-1 border-[var(--c-border)]" aria-hidden="true" />

        {items.map(({ key, label, to, icon: Icon, end, disabledReason }) =>
          to ? (
            <NavLink
              key={key}
              to={to}
              end={end}
              aria-label={pick(...label)}
              title={pick(...label)}
              data-rail-item={key}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-2 rounded-[var(--radius)] border-l-4 px-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] md:justify-center lg:justify-start ${
                  isActive
                    ? 'border-l-[var(--c-accent)] bg-[var(--c-surface-2)] font-semibold text-[var(--c-text)]'
                    : 'border-l-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden truncate lg:inline">{pick(...label)}</span>
            </NavLink>
          ) : (
            /* Tên truy cập của mục bị vô hiệu hoá mang LUÔN lý do: ở chế độ
             * icon-only (768–1023 px) phần chữ bị ẩn, nên nếu lý do chỉ nằm
             * trong `title` thì người dùng trình đọc màn hình chỉ nghe thấy một
             * mục xám mà không biết vì sao. `title` giữ cho người dùng chuột. */
            <span
              key={key}
              aria-disabled="true"
              data-rail-item={key}
              aria-label={disabledReason ? `${pick(...label)} — ${pick(...disabledReason)}` : pick(...label)}
              title={disabledReason ? pick(...disabledReason) : undefined}
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius)] border-l-4 border-l-transparent px-2 text-sm font-medium text-[var(--c-text-dim)] opacity-45 md:justify-center lg:justify-start"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden truncate lg:inline">{pick(...label)}</span>
            </span>
          )
        )}
      </nav>
    </aside>
  )
}
