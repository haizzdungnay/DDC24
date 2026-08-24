import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { NAV_GROUPS, NavRail, isProgrammingFocusRoute } from '../../../shared/components/NavRail'
import {
  PROGRAMMING_FEATURE_RAIL_WIDTH_PX,
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
  PROGRAMMING_REV_A_ENABLED: true
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
  it('R60-03 — mục Thoát Lập trình đứng đầu rail và luôn là link thật về ngoài workspace', () => {
    renderRail('project-1')
    const exit = screen.getByRole('link', { name: 'Thoát Lập trình' })
    expect(exit).toHaveAttribute('href', '/')
    expect(exit).not.toHaveAttribute('aria-disabled')
    // Chuỗi có mũi tên là nhãn NHÌN THẤY theo D-01; tên truy cập giữ sạch mũi tên.
    expect(within(rail()).getByText('← Thoát Lập trình')).toBeInTheDocument()
    // Đứng đầu: là liên kết đầu tiên theo thứ tự DOM, không nằm lẫn giữa 6 đích.
    expect(rail().querySelectorAll('a')[0]).toBe(exit)
  })

  it('không có projectId — PGM-01/06 là link thật, bốn workspace theo Project bị vô hiệu KÈM LÝ DO', () => {
    renderRail(null)
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/eng/programming')
    expect(screen.getByRole('link', { name: 'Runtime & Bảo trì' })).toHaveAttribute('href', '/eng/programming/runtime')
    expect(screen.queryByRole('link', { name: 'Chương trình' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Điểm & Ánh xạ' })).not.toBeInTheDocument()
    for (const key of ['programs', 'mapping', 'library', 'commission']) {
      const item = railItem(key)
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveAttribute('title', 'Cần chọn Project trước khi mở mục này')
      expect(item.getAttribute('aria-label')).toContain('Cần chọn Project')
    }
  })

  it('có projectId — cả sáu đích là link thật và trỏ đúng route PGM-01..06', () => {
    renderRail('project-1')
    expect(screen.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('href', '/eng/programming/projects/project-1/programs')
    expect(screen.getByRole('link', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('href', '/eng/programming/projects/project-1/mapping')
    expect(screen.getByRole('link', { name: 'Thư viện điều khiển' })).toHaveAttribute('href', '/eng/programming/projects/project-1/library')
    expect(screen.getByRole('link', { name: 'Kiểm tra & Vận hành' })).toHaveAttribute('href', '/eng/programming/projects/project-1/commission')
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/eng/programming')
    expect(screen.getByRole('link', { name: 'Runtime & Bảo trì' })).toHaveAttribute('href', '/eng/programming/runtime')
    // Sáu đích + lối thoát; `Project Settings` KHÔNG phải link (chưa có route).
    expect(rail().querySelectorAll('a')).toHaveLength(7)
  })

  it('mục đang mở đúng route được đánh dấu active (aria-current)', () => {
    renderRail('project-1', '/eng/programming/projects/project-1/programs')
    expect(screen.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Tổng quan' })).not.toHaveAttribute('aria-current')
  })

  it('Project Settings hiện nhưng vô hiệu kèm lý do — không trỏ vào route không tồn tại', () => {
    renderRail('project-1')
    const settings = railItem('project-settings')
    expect(settings.tagName).toBe('SPAN')
    expect(settings).toHaveAttribute('aria-disabled', 'true')
    expect(settings).toHaveAttribute('title', 'Chưa có trang Cài đặt Project ở bản dựng này')
    expect(programmingRailItems('project-1').find((item) => item.key === 'project-settings')?.to).toBeNull()
  })

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
})

describe('D-01 — rail Programming THAY rail toàn cục, không xoá mục', () => {
  it.each([
    ['/eng/programming', true],
    ['/eng/programming/runtime', true],
    ['/eng/programming/projects/p1/programs', true],
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
