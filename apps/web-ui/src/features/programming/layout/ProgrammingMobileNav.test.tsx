import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { ProgrammingMobileNav } from './ProgrammingMobileNav'

function renderNav(projectId: string | null, initialPath = '/eng/programming') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <ProgrammingMobileNav projectId={projectId} />
      </MemoryRouter>
    </I18nProvider>
  )
}

/** Hàng dưới cùng — trần bốn đích của handoff §7. */
function bottomBar() {
  return screen.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình' })
}

function openMore() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm đích Lập trình' }))
  return within(screen.getByTestId('programming-mobile-more'))
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('ProgrammingMobileNav — T59-503 / T60-208', () => {
  /* SELECTOR ĐỔI VÌ BỐ CỤC ĐỔI (`T60-208`, handoff §7 "max 4 bottom-nav
   * destinations"), khẳng định giữ nguyên: **cả sáu workspace vẫn tới được và
   * vẫn mang tên truy cập ĐẦY ĐỦ**, chỉ khác là ba bề mặt soạn thảo nay nằm
   * trong ngăn `More` thay vì chen vào một hàng sáu ô ở 390 px. */
  it('có Project — hiển thị đủ sáu workspace bằng tên truy cập đầy đủ', () => {
    renderNav('project-1')

    // Hàng dưới: đúng BỐN đích (ba liên kết + một nút mở ngăn).
    const bar = within(bottomBar())
    expect(bar.getAllByRole('link')).toHaveLength(3)
    expect(bar.getAllByRole('button')).toHaveLength(1)
    expect(bar.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/eng/programming')
    expect(bar.getByRole('link', { name: 'Runtime & Bảo trì' })).toHaveAttribute('href', '/eng/programming/runtime')
    expect(bar.getByRole('link', { name: 'Kiểm tra & Vận hành' })).toHaveAttribute('href', '/eng/programming/projects/project-1/commission')

    // Ba workspace còn lại nằm trong ngăn `More`, vẫn đúng đích.
    const more = openMore()
    expect(more.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('href', '/eng/programming/projects/project-1/programs')
    expect(more.getByRole('link', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('href', '/eng/programming/projects/project-1/mapping')
    expect(more.getByRole('link', { name: 'Thư viện điều khiển' })).toHaveAttribute('href', '/eng/programming/projects/project-1/library')
  })

  it('không có Project — không dựng deep-link giả cho PGM-02..05', () => {
    renderNav(null)

    // Chỉ hai đích không phụ thuộc Project còn là liên kết ở hàng dưới.
    expect(within(bottomBar()).getAllByRole('link')).toHaveLength(2)
    expect(screen.getByLabelText(/^Kiểm tra & Vận hành —/)).toHaveAttribute('aria-disabled', 'true')

    const more = openMore()
    expect(more.getByLabelText(/^Chương trình —/)).toHaveAttribute('aria-disabled', 'true')
    expect(more.getByLabelText(/^Điểm & Ánh xạ —/)).toHaveAttribute('aria-disabled', 'true')
    expect(more.getByLabelText(/^Thư viện điều khiển —/)).toHaveAttribute('aria-disabled', 'true')
    // Lý do phải nằm trong TÊN TRUY CẬP: nhãn nhìn thấy được đã bị rút gọn.
    expect(screen.getByLabelText('Kiểm tra & Vận hành — Cần chọn Project trước khi mở mục này')).toBeInTheDocument()
  })

  it('route Mapping được đánh dấu là trang hiện tại', () => {
    renderNav('project-1', '/eng/programming/projects/project-1/mapping')

    /* Trang hiện tại nằm trong ngăn `More`, nên chính nút `More` phải sáng —
     * nếu không, người dùng thấy một hàng nav không mục nào được đánh dấu. */
    const moreButton = screen.getByRole('button', { name: 'Thêm đích Lập trình' })
    expect(moreButton).toHaveAttribute('aria-current', 'true')

    const more = openMore()
    expect(more.getByRole('link', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('aria-current', 'page')
    expect(more.getByRole('link', { name: 'Chương trình' })).not.toHaveAttribute('aria-current')
  })

  it('T60-208: hàng dưới đúng BỐN ô, không ô nào phải cắt nhãn thành sáu cột', () => {
    renderNav('project-1')
    const bar = bottomBar()
    expect(bar.className).toContain('grid-cols-4')
    // Đếm theo phần tử con trực tiếp: bốn ô, không hơn.
    expect(bar.children).toHaveLength(4)
    // Ngăn `More` đóng mặc định — không chiếm màn hình khi chưa ai yêu cầu.
    expect(screen.queryByTestId('programming-mobile-more')).not.toBeInTheDocument()
  })

  it('T60-208: Esc đóng ngăn More và trả tiêu điểm về nút mở', () => {
    renderNav('project-1')
    const moreButton = screen.getByRole('button', { name: 'Thêm đích Lập trình' })
    fireEvent.click(moreButton)
    expect(screen.getByTestId('programming-mobile-more')).toBeInTheDocument()
    expect(moreButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('programming-mobile-more')).not.toBeInTheDocument()
    expect(moreButton).toHaveAttribute('aria-expanded', 'false')
    expect(moreButton).toHaveFocus()
  })

  it('R60-03: lối ra khỏi workspace luôn có mặt trên màn hẹp, kể cả khi chưa có Project', () => {
    // `<768 px` ẩn cả rail Programming lẫn rail toàn cục, nên nếu ngăn này
    // không mang lối ra thì người dùng cảm ứng bị nhốt trong workspace.
    renderNav(null)
    const more = openMore()
    const exit = more.getByRole('link', { name: 'Thoát Lập trình' })
    expect(exit).toHaveAttribute('href', '/')
    expect(exit).not.toHaveAttribute('aria-disabled')
  })

  it('T60-208: Cài đặt Project hiện diện nhưng vô hiệu hoá KÈM LÝ DO, không trỏ vào path không tồn tại', () => {
    renderNav('project-1')
    const more = openMore()
    expect(more.getByLabelText('Cài đặt Project — Chưa có trang Cài đặt Project ở bản dựng này')).toHaveAttribute('aria-disabled', 'true')
    expect(more.queryByRole('link', { name: /Cài đặt Project/ })).not.toBeInTheDocument()
  })
})
