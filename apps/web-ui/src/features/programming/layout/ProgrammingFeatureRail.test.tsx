import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { NAV_GROUPS, NavRail, isProgrammingFocusRoute } from '../../../shared/components/NavRail'
import {
  PROGRAMMING_FEATURE_RAIL_WIDTH_PX,
  PROGRAMMING_RAIL_COLLAPSED_KEY,
  ProgrammingFeatureRail,
  programmingRailItems
} from './ProgrammingFeatureRail'

/**
 * `T60-101` — rail 220 px của focus mode `D-01`.
 *
 * File này KẾ THỪA TRỌN VẸN ba case của `ProgrammingDesktopNav.test.tsx`
 * (`T59-503`) mà rail thay thế: đích phụ thuộc Project bị vô hiệu khi chưa có
 * `projectId`, sáu đích canonical trỏ đúng route, và mục đang mở được đánh dấu
 * `aria-current`. Chỉ selector đổi theo bố cục dọc; không case nào bị bỏ.
 */

/* Cờ `VITE_PROGRAMMING_REV_A` không được đặt trong môi trường vitest, nên
 * `PROGRAMMING_REV_A_ENABLED` mặc định là `false` và focus mode sẽ không bao
 * giờ kích hoạt. Bật cờ ở đây để kiểm ĐÚNG cấu hình của bản phát hành, thay vì
 * kiểm một nhánh mà người dùng thật không bao giờ chạy vào. */
vi.mock('../../../shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/config')>()),
  PROGRAMMING_REV_A_ENABLED: true,
  PROGRAMS_WORKSPACE_V2_ENABLED: true
}))

vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'admin', role: 'admin', loginAt: '2026-08-23T00:00:00Z' },
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

function renderRail(projectId: string | null, initialPath = '/eng/programming') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <ProgrammingFeatureRail projectId={projectId} />
      </MemoryRouter>
    </I18nProvider>
  )
}

function rail() {
  return screen.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình trên desktop' })
}

function railItem(key: string): HTMLElement {
  const element = rail().querySelector<HTMLElement>(`[data-rail-item="${key}"]`)
  if (!element) throw new Error(`rail không có mục "${key}"`)
  return element
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('ProgrammingFeatureRail — T60-101 (D-01 focus mode)', () => {
  it('R60-03 — lối thoát đứng đầu rail và luôn là link thật về ngoài workspace', () => {
    renderRail('project-1')
    /* `DEV-PROG-010` — lối thoát nay CHÍNH LÀ thương hiệu ở đầu rail, không còn
       là một mục riêng bên dưới nó. `R60-03` không đổi: rail toàn cục bị ẩn ở
       chế độ focus, nên ở ≥1024 px đây vẫn là đường DUY NHẤT rời workspace bằng
       chuột, nó vẫn là link thật và không bao giờ bị vô hiệu hoá. */
    const exit = screen.getByRole('link', { name: 'Thoát Lập trình — về Bảng điều khiển' })
    expect(exit).toHaveAttribute('href', '/')
    expect(exit).not.toHaveAttribute('aria-disabled')
    // Nhãn nhìn thấy mang tên khu vực, để người dùng biết mình đang ở đâu.
    expect(within(exit).getByText(/Lập trình/)).toBeInTheDocument()
    // Đứng đầu: là liên kết đầu tiên theo thứ tự DOM, không nằm lẫn giữa 6 đích.
    expect(rail().querySelectorAll('a')[0]).toBe(exit)
  })

  it('không có projectId — PGM-01/06 là link thật, bốn workspace theo Project bị vô hiệu KÈM LÝ DO', () => {
    renderRail(null)
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/eng/programming')
    expect(screen.getByRole('link', { name: 'Runtime & Bảo trì' })).toHaveAttribute('href', '/eng/programming/runtime')
    expect(screen.queryByRole('link', { name: 'Chương trình' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Điểm & Ánh xạ' })).not.toBeInTheDocument()
    for (const key of ['programs', 'mapping', 'library', 'commission', 'execution']) {
      const item = railItem(key)
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveAttribute('title', 'Cần chọn Project trước khi mở mục này')
      expect(item.getAttribute('aria-label')).toContain('Cần chọn Project')
    }
  })

  it('có projectId — cả sáu đích là link thật và trỏ đúng route PGM-01..06', () => {
    renderRail('project-1')
    expect(screen.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('href', '/eng/programming/programs?project=project-1&mode=EDIT')
    expect(screen.getByRole('link', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('href', '/eng/programming/projects/project-1/mapping')
    expect(screen.getByRole('link', { name: 'Thư viện điều khiển' })).toHaveAttribute('href', '/eng/programming/projects/project-1/library')
    expect(screen.getByRole('link', { name: 'Kiểm tra & Vận hành' })).toHaveAttribute('href', '/eng/programming/projects/project-1/commission')
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/eng/programming')
    expect(screen.getByRole('link', { name: 'Runtime & Bảo trì' })).toHaveAttribute('href', '/eng/programming/runtime')
    expect(screen.getByRole('link', { name: 'Execution' })).toHaveAttribute('href', '/eng/programming/programs?project=project-1&mode=EDIT&tab=execution')
    /* Bảy đích (PGM-01..06 + Execution) + lối thoát (thương hiệu) = 8 link. */
    expect(rail().querySelectorAll('a')).toHaveLength(8)
  })

  it('mục đang mở đúng route được đánh dấu active (aria-current)', () => {
    renderRail('project-1', '/eng/programming/programs?project=project-1&mode=EDIT')
    expect(screen.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Tổng quan' })).not.toHaveAttribute('aria-current')
  })

  /* `PLAN-FE-SHELL-062` — test cũ ở đây khoá hành vi "Project Settings hiện
   * nhưng vô hiệu kèm lý do". Mục đó đã bị gỡ: nó là đích thứ bảy trong một
   * shell mà `UD-PROG-008` (CLOSED, `ADR-050.8`) chỉ chốt sáu, và nó chưa bao
   * giờ có route.
   *
   * Bất biến thay thế KHÔNG nằm ở đây mà ở `shellDestinations.test.ts`: mọi
   * đích của shell phải có thật, và một mục chỉ được vô hiệu vì thiếu điều
   * kiện — không bao giờ vì thiếu trang. Đặt nó thành cổng riêng thay vì một
   * test component là có chủ ý: nó kiểm một luật của shell, không kiểm DOM của
   * một component. */

  it('rộng 220 px ở desktop, icon-only ở tablet, ẩn hoàn toàn dưới 768 px', () => {
    renderRail('project-1')
    expect(PROGRAMMING_FEATURE_RAIL_WIDTH_PX).toBe(220)
    const aside = screen.getByTestId('programming-feature-rail')
    expect(aside.className).toContain('hidden')
    expect(aside.className).toContain('md:flex')
    expect(aside.className).toContain('md:w-16')
    expect(aside.className).toContain(`lg:w-[${PROGRAMMING_FEATURE_RAIL_WIDTH_PX}px]`)
  })

  it('mọi mục có icon riêng bên cạnh chữ — icon-only ở tablet vẫn phân biệt được', () => {
    renderRail('project-1')
    for (const item of programmingRailItems('project-1')) {
      expect(railItem(item.key).querySelectorAll('svg').length).toBeGreaterThan(0)
    }
  })

  it('cơ chế thu gọn trên desktop: bấm toggle chuyển sang icon-only (lg:w-16), lưu localStorage và vẫn tương tác được', () => {
    localStorage.removeItem(PROGRAMMING_RAIL_COLLAPSED_KEY)
    renderRail('project-1')
    const aside = screen.getByTestId('programming-feature-rail')
    const toggle = screen.getByTestId('programming-rail-toggle')

    // Trạng thái mở mặc định (hiện logo 1)
    expect(aside).toHaveAttribute('data-collapsed', 'false')
    expect(aside.className).toContain('lg:w-[220px]')
    expect(screen.getByText('Chương trình')).toBeInTheDocument()
    const exitLink = screen.getByRole('link', { name: 'Thoát Lập trình — về Bảng điều khiển' })
    expect(exitLink.querySelector('img')?.getAttribute('src')).toBe('/logo1.png')

    // Bấm nút thu gọn (chuyển sang logo 2)
    fireEvent.click(toggle)
    expect(aside).toHaveAttribute('data-collapsed', 'true')
    expect(aside.className).toContain('lg:w-16')
    expect(screen.queryByText('Chương trình')).toBeNull()
    expect(exitLink.querySelector('img')?.getAttribute('src')).toBe('/logo2.png')
    expect(localStorage.getItem(PROGRAMMING_RAIL_COLLAPSED_KEY)).toBe('true')

    // Các liên kết vẫn đầy đủ và click/tương tác được
    const link = screen.getByRole('link', { name: 'Chương trình' })
    expect(link).toHaveAttribute('href', '/eng/programming/programs?project=project-1&mode=EDIT')
    expect(link).toHaveAttribute('title', 'Chương trình')
    expect(rail().querySelectorAll('a')).toHaveLength(8)

    // Bấm mở lại
    fireEvent.click(toggle)
    expect(aside).toHaveAttribute('data-collapsed', 'false')
    expect(aside.className).toContain('lg:w-[220px]')
    expect(screen.getByText('Chương trình')).toBeInTheDocument()
    expect(localStorage.getItem(PROGRAMMING_RAIL_COLLAPSED_KEY)).toBe('false')
  })

  it('khôi phục trạng thái thu gọn từ localStorage khi khởi tạo', () => {
    localStorage.setItem(PROGRAMMING_RAIL_COLLAPSED_KEY, 'true')
    renderRail('project-1')
    const aside = screen.getByTestId('programming-feature-rail')
    expect(aside).toHaveAttribute('data-collapsed', 'true')
    expect(aside.className).toContain('lg:w-16')
    expect(screen.queryByText('Chương trình')).toBeNull()
  })
})

describe('D-01 — rail Programming THAY rail toàn cục, không xoá mục', () => {
  it.each([
    ['/eng/programming', true],
    ['/eng/programming/runtime', true],
    ['/eng/programming/projects/p1/programs', true],
    ['/eng/programming/programs', true],
    ['/', false],
    ['/eng/inputs', false],
    // Không được ăn nhầm một route chỉ TRÙNG TIỀN TỐ chuỗi.
    ['/eng/programming-legacy', false]
  ])('isProgrammingFocusRoute(%s) = %s', (pathname, expected) => {
    expect(isProgrammingFocusRoute(pathname, true)).toBe(expected)
  })

  it('cờ Programming tắt ⇒ không có focus mode: trang thay thế không có rail riêng nào', () => {
    expect(isProgrammingFocusRoute('/eng/programming', false)).toBe(false)
  })

  it('NavRail toàn cục không render trong /eng/programming nhưng vẫn render ở nơi khác', () => {
    const { unmount } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/eng/programming/runtime']}>
          <NavRail alarmCount={0} device={null} />
        </MemoryRouter>
      </I18nProvider>
    )
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    unmount()

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/']}>
          <NavRail alarmCount={0} device={null} />
        </MemoryRouter>
      </I18nProvider>
    )
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  it('ADR-032 — NAV_GROUPS không đổi: mục Lập trình vẫn nằm trong nhóm Kỹ thuật', () => {
    const engineering = NAV_GROUPS.find((group) => group.id === 'engineering')
    expect(engineering?.items.some((item) => item.to === '/eng/programming')).toBe(true)
    expect(NAV_GROUPS.map((group) => group.id)).toEqual(['overview', 'operation', 'engineering', 'system'])
  })
})
