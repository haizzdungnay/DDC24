import {
  Activity,
  ArrowLeft,
  Cable,
  ClipboardCheck,
  Home,
  Library,
  PanelLeft,
  PanelLeftClose,
  PencilRuler,
  Play
} from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { PRODUCT_INFO } from '../../../shared/productInfo'
import { cn } from '../../../shared/utils'
import { programsWorkspacePath } from '../shared/programsRoute'

/** Khóa lưu trạng thái thu gọn rail lập trình trong localStorage. */
export const PROGRAMMING_RAIL_COLLAPSED_KEY = 'mkddc:programming-rail-collapsed'

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
 * SÁU đích canonical `PGM-01..06` — đúng `UD-PROG-008` (CLOSED, `ADR-050.8`).
 * Tách khỏi component để test đọc được bảng đích mà không phải suy từ DOM, và
 * để một chỗ duy nhất quyết định mục nào phụ thuộc Project.
 *
 * `PLAN-FE-SHELL-062` — trước đây ở đây có mục thứ bảy `Project Settings`, đến
 * từ một dòng mô tả trong handoff Plan 60 chứ không từ yêu cầu nào. Nó chưa bao
 * giờ có route, nên phải render xám kèm lý do "trang không tồn tại". Bất biến
 * thay thế nó được khoá bằng máy ở `shellDestinations.test.ts`: mục chỉ được
 * vô hiệu vì THIẾU ĐIỀU KIỆN (chưa chọn Project), không bao giờ vì thiếu trang.
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
    { key: 'execution', label: ['Execution', 'Execution'], to: projectId ? programsWorkspacePath(projectId, { search: 'tab=execution' }) : null, icon: Play, disabledReason: projectId ? null : needsProject }
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
  const { pick, t } = useI18n()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(PROGRAMMING_RAIL_COLLAPSED_KEY) === 'true')
  const items = programmingRailItems(projectId)
  const ToggleIcon = collapsed ? PanelLeft : PanelLeftClose

  function handleToggle() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(PROGRAMMING_RAIL_COLLAPSED_KEY, String(next))
      return next
    })
  }

  return (
    <aside
      data-testid="programming-feature-rail"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'sticky top-16 hidden shrink-0 flex-col gap-2 self-stretch rounded-[var(--radius)] bg-[var(--c-rail-bg)] py-2 motion-safe:transition-[width] motion-safe:duration-200 md:flex md:w-16 lg:top-0',
        collapsed ? 'lg:w-16' : 'lg:w-[220px]'
      )}
    >
      <div className="hidden px-2 lg:flex lg:justify-end">
        <button
          type="button"
          data-testid="programming-rail-toggle"
          onClick={handleToggle}
          aria-label={collapsed ? t('expand-sidebar') : t('collapse-sidebar')}
          title={collapsed ? t('expand-sidebar') : t('collapse-sidebar')}
          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-[var(--c-rail-text-dim)] transition hover:bg-[var(--c-rail-active-bg)] hover:text-[var(--c-rail-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)]"
        >
          <ToggleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </div>

      {/* `DEV-PROG-010` — LOGO LÀ LỐI RA.
        *
        * `R60-03` vẫn nguyên hiệu lực: rail toàn cục bị ẩn ở chế độ focus, nên
        * ở ≥1024 px đây là đường DUY NHẤT rời workspace bằng chuột. Điều đổi là
        * hình thức, không phải sự tồn tại — mục "← Thoát Lập trình" riêng đã
        * gộp vào chính thương hiệu ở đầu rail. Nó vẫn là một `NavLink` thật, có
        * `aria-label` nói rõ hành động, và KHÔNG BAO GIỜ bị vô hiệu hoá.
        *
        * Tên đầy đủ là "<sản phẩm> Lập trình": một chữ "DDC24" trơ trọi không
        * nói được người dùng đang ở khu vực nào của hệ thống. */}
      <nav aria-label={pick(...PROGRAMMING_RAIL_NAV_LABEL)} className="flex min-h-0 flex-col gap-1 px-1">
        {/* Thương hiệu nằm TRONG landmark điều hướng, không đứng ngoài nó: đây
            là một đích điều hướng thật (lối ra), và `R60-03` đòi nó là liên kết
            ĐẦU TIÊN của rail — người dùng bàn phím gặp lối ra trước khi phải đi
            hết sáu workspace. */}
        <NavLink
          to="/"
          data-testid="programming-rail-brand"
          aria-label={pick('Thoát Lập trình — về Bảng điều khiển', 'Exit Programming — back to the dashboard')}
          title={pick('Quay lại Bảng điều khiển và điều hướng toàn hệ thống', 'Back to the dashboard and the system-wide navigation')}
          className={cn(
            'flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-2 text-sm font-black leading-tight text-[var(--c-rail-text)] transition hover:bg-[var(--c-rail-active-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] md:justify-center',
            collapsed ? 'lg:justify-center' : 'lg:justify-start'
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className={cn('lg:hidden', collapsed && 'lg:inline')}>{PRODUCT_INFO.code}</span>
          {!collapsed && (
            <span className="hidden truncate lg:inline">{PRODUCT_INFO.name} {pick('Lập trình', 'Programming')}</span>
          )}
        </NavLink>

        <hr className="my-1 border-[var(--c-rail-active-bg)]" aria-hidden="true" />

        {items.map(({ key, label, to, icon: Icon, end, disabledReason }) =>
          to ? (
            <NavLink
              key={key}
              to={to}
              end={end}
              aria-label={pick(...label)}
              title={pick(...label)}
              data-rail-item={key}
              /* Mục đang chọn tô NGUYÊN chiều ngang (`DEV-PROG-010`): một vạch
                 4 px bên trái là tín hiệu quá nhỏ trên rail tối, và nó biến mất
                 hẳn ở chế độ chỉ-icon 768–1023 px. */
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-2 rounded-[var(--radius)] border-l-4 px-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] md:justify-center',
                  collapsed ? 'lg:justify-center' : 'lg:justify-start',
                  isActive
                    ? 'border-l-[var(--c-accent)] bg-[var(--c-rail-active-bg)] font-semibold text-[var(--c-rail-text)]'
                    : 'border-l-transparent text-[var(--c-rail-text-dim)] hover:bg-[var(--c-rail-active-bg)] hover:text-[var(--c-rail-text)]'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="hidden truncate lg:inline">{pick(...label)}</span>}
            </NavLink>
          ) : (
            /* Tên truy cập của mục bị vô hiệu hoá mang LUÔN lý do: ở chế độ
             * icon-only (768–1023 px) phần chữ bị ẩn, nên nếu lý do chỉ nằm
             * trong `title` thì người dùng trình đọc màn hình chỉ nghe thấy một
             * mục xám mà không biết vì sao. `title` giữ cho người dùng chuột. */
            <span
              key={key}
              role="link"
              aria-disabled="true"
              data-rail-item={key}
              aria-label={disabledReason ? `${pick(...label)} — ${pick(...disabledReason)}` : pick(...label)}
              title={disabledReason ? pick(...disabledReason) : undefined}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-[var(--radius)] border-l-4 border-l-transparent px-2 text-sm font-medium text-[var(--c-rail-text-dim)] opacity-60 md:justify-center',
                collapsed ? 'lg:justify-center' : 'lg:justify-start'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="hidden truncate lg:inline">{pick(...label)}</span>}
            </span>
          )
        )}
      </nav>
    </aside>
  )
}
