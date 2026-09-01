import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { ST_LANGUAGE_PROFILE_VERSION } from '../api/generated/stLanguageProfile'
import { ProblemsDrawer } from './ProblemsDrawer'

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  localStorage.removeItem('programming.problems.collapsed')
  localStorage.removeItem('programming.problems.height')
})
afterEach(cleanup)

describe('ProblemsDrawer', () => {
  it('chưa kiểm tra hiện trạng thái trung tính và CTA, không giả thành 0 lỗi', () => {
    const onEmptyAction = vi.fn()
    render(<I18nProvider><ProblemsDrawer diagnostics={[]} emptyState="not-checked" onEmptyAction={onEmptyAction} /></I18nProvider>)
    expect(screen.getByText('Chưa có kết quả Check cho bản Draft này.')).toBeInTheDocument()
    expect(screen.getByText('Chưa kiểm tra')).toBeInTheDocument()
    expect(screen.queryByText('Không có lỗi.')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mở Kiểm tra' }))
    expect(onEmptyAction).toHaveBeenCalledOnce()
  })

  it('Check đạt hiện 0 lỗi và không mời chạy lại Check', () => {
    render(<I18nProvider><ProblemsDrawer diagnostics={[]} emptyState="no-problems" onEmptyAction={vi.fn()} /></I18nProvider>)
    expect(screen.getByText('Check gần nhất đã đạt, không có lỗi.')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mở Kiểm tra' })).not.toBeInTheDocument()
  })

  it('mobile sheet traps focus, locks scroll, and returns focus after Escape', () => {
    render(<I18nProvider><ProblemsDrawer diagnostics={[{ code: 'PRG-ERR-001', severity: 'ERROR', messageKey: '' }]} /></I18nProvider>)
    const trigger = screen.getByRole('button', { name: /Mở khay|Open tray/ })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: /Danh sách lỗi|Problems list/ })
    expect(document.body.style.overflow).toBe('hidden')
    const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"], button[aria-label="Đóng"]')!
    const problem = dialog.querySelector<HTMLButtonElement>('button:not([aria-label])')!
    close.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(problem).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Danh sách lỗi|Problems list/ })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
  })

  it('desktop cho phép thu gọn và đổi chiều cao bằng bàn phím, giữ preference', () => {
    render(<I18nProvider><ProblemsDrawer diagnostics={[]} /></I18nProvider>)
    const panel = screen.getByRole('region', { name: 'Khay vấn đề' })
    const resize = screen.getByRole('separator', { name: 'Đổi chiều cao khay vấn đề' })
    expect(resize).toHaveClass('min-[1280px]:flex')
    expect(screen.getByRole('button', { name: 'Mở khay' })).toHaveClass('min-[1280px]:hidden')
    expect(resize).toHaveAttribute('aria-valuenow', '160')
    fireEvent.keyDown(resize, { key: 'ArrowUp' })
    expect(resize).toHaveAttribute('aria-valuenow', '176')
    const collapse = within(panel).getByRole('button', { name: 'Thu gọn' })
    fireEvent.click(collapse)
    expect(within(panel).getByRole('button', { name: 'Mở rộng' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mở rộng' })).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem('programming.problems.collapsed')).toBe('true')
  })

  it('diagnostic severity WARNING hiển thị đúng icon cảnh báo có màu warning', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer
          diagnostics={[
            {
              code: 'PRG-ERR-CHECK-001',
              detailCode: 'ST-WARN-002',
              severity: 'WARNING',
              messageKey: 'programming.error.check'
            }
          ]}
        />
      </I18nProvider>
    )
    const warningBtn = screen.getByRole('button', { name: /PRG-ERR-CHECK-001/ })
    const icon = warningBtn.querySelector('svg')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('text-[var(--c-warn-fg)]')
  })

  it('diagnostic có message ưu tiên hiển thị thông điệp thật từ compiler', () => {
    const rawCompilerMsg = "variable 'unused' is declared but never used"
    render(
      <I18nProvider>
        <ProblemsDrawer
          diagnostics={[
            {
              code: 'PRG-ERR-CHECK-001',
              detailCode: 'ST-WARN-002',
              severity: 'WARNING',
              message: rawCompilerMsg,
              messageKey: 'programming.error.check'
            }
          ]}
        />
      </I18nProvider>
    )
    expect(screen.getByText(rawCompilerMsg)).toBeInTheDocument()
  })

  it('diagnostic KHÔNG có message lùi về copy theo detailCode', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer
          diagnostics={[
            {
              code: 'PRG-ERR-CHECK-001',
              detailCode: 'ST-WARN-002',
              severity: 'WARNING',
              messageKey: 'programming.error.check'
            }
          ]}
        />
      </I18nProvider>
    )
    expect(
      screen.getByText('Biến đã khai báo nhưng chưa từng được sử dụng trong chương trình.')
    ).toBeInTheDocument()
  })

  it('detailCode hiện ra cùng code và location', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer
          diagnostics={[
            {
              code: 'PRG-ERR-CHECK-001',
              detailCode: 'ST-WARN-002',
              severity: 'WARNING',
              messageKey: 'programming.error.check',
              location: { line: 3, column: 5 }
            }
          ]}
        />
      </I18nProvider>
    )
    expect(
      screen.getByText('PRG-ERR-CHECK-001 · ST-WARN-002 · dòng 3 · cột 5')
    ).toBeInTheDocument()
  })

  /* ISS-STED-02 — kênh WARNING mang dữ liệu thật, nên khay phải phân biệt được
   * ba mức cho CẢ người không nhìn thấy màu.
   *
   * Icon mang `aria-hidden`, nên nếu severity chỉ tồn tại ở hình dạng + màu thì
   * người dùng trình đọc màn hình nghe "lỗi" và "cảnh báo" y hệt nhau — mà đó là
   * hai hành động khác nhau: một cái chặn phát hành, một cái không. */
  it('phân biệt ERROR / WARNING / INFO cho cả người không nhìn thấy màu', () => {
    render(<I18nProvider><ProblemsDrawer diagnostics={[
      { code: 'PRG-ERR-CHECK-001', severity: 'ERROR', messageKey: '' },
      { code: 'PRG-ERR-CHECK-001', severity: 'WARNING', messageKey: '' },
      { code: 'PRG-ERR-CHECK-001', severity: 'INFO', messageKey: '' }
    ]} /></I18nProvider>)
    expect(screen.getByText('Lỗi:')).toBeInTheDocument()
    expect(screen.getByText('Cảnh báo:')).toBeInTheDocument()
    expect(screen.getByText('Thông tin:')).toBeInTheDocument()
  })

  it('warning dùng token màu cảnh báo, không dùng token lỗi', () => {
    const { container } = render(<I18nProvider><ProblemsDrawer diagnostics={[
      { code: 'PRG-ERR-CHECK-001', severity: 'WARNING', messageKey: '' }
    ]} /></I18nProvider>)
    // Lấy icon TRONG danh sách, không phải chevron ở đầu khay.
    const icon = container.querySelector('li svg[aria-hidden="true"]')
    expect(icon?.getAttribute('class')).toContain('text-[var(--c-warn-fg)]')
    expect(icon?.getAttribute('class')).not.toContain('c-fault-fg')
  })

  /* ---- ISS-STED-18: Diagnostic Provenance Contract ---- */

  const FRESH_HASH = 'a'.repeat(64)
  const CHANGED_HASH = 'b'.repeat(64)

  function withProvenance(overrides: Record<string, unknown> = {}) {
    return {
      code: 'PRG-ERR-CHECK-001',
      severity: 'ERROR' as const,
      messageKey: '',
      location: {
        programId: 'P_ahu',
        revisionId: 'rev-1',
        pouId: 'P_ahu',
        sourceSha256: FRESH_HASH,
        stLanguageProfileVersion: ST_LANGUAGE_PROFILE_VERSION,
        ...overrides
      }
    }
  }

  const openBuffer = { revisionId: 'rev-1', pouId: 'P_ahu', sourceSha256: FRESH_HASH }

  it('diagnostic còn khớp buffer thì KHÔNG mang nhãn CŨ', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer diagnostics={[withProvenance()]} openBuffer={openBuffer} />
      </I18nProvider>
    )
    expect(screen.queryByText(/CŨ/)).not.toBeInTheDocument()
  })

  it('buffer đã đổi ⇒ mục mang nhãn CŨ kèm lý do, và VẪN nằm trong danh sách', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer
          diagnostics={[withProvenance()]}
          openBuffer={{ ...openBuffer, sourceSha256: CHANGED_HASH }}
        />
      </I18nProvider>
    )
    // Không biến mất im lặng: ẩn nó đi làm người dùng tưởng lỗi đã hết.
    // Mã và vị trí nằm chung một node text, nên khớp theo tiền tố.
    expect(screen.getByText(/^PRG-ERR-CHECK-001/)).toBeInTheDocument()
    expect(screen.getByText(/CŨ · buffer đã đổi sau Kiểm tra/)).toBeInTheDocument()
  })

  it('kết quả thuộc revision khác ⇒ nhãn nêu RÕ revision nào', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer
          diagnostics={[withProvenance({ revisionId: 'rev-0' })]}
          openBuffer={openBuffer}
        />
      </I18nProvider>
    )
    expect(screen.getByText(/kết quả thuộc revision rev-0/)).toBeInTheDocument()
  })

  it('có mục CŨ ⇒ khay mời chạy lại Kiểm tra', () => {
    const onRecheck = vi.fn()
    render(
      <I18nProvider>
        <ProblemsDrawer
          diagnostics={[withProvenance()]}
          openBuffer={{ ...openBuffer, sourceSha256: CHANGED_HASH }}
          onRecheck={onRecheck}
        />
      </I18nProvider>
    )
    const button = screen.getByRole('button', { name: 'Chạy lại Kiểm tra' })
    fireEvent.click(button)
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })

  it('không có mục CŨ ⇒ không mời chạy lại Kiểm tra', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer diagnostics={[withProvenance()]} openBuffer={openBuffer} onRecheck={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.queryByRole('button', { name: 'Chạy lại Kiểm tra' })).not.toBeInTheDocument()
  })

  it('không truyền openBuffer ⇒ giữ nguyên hành vi cũ, không nhãn nào', () => {
    render(
      <I18nProvider>
        <ProblemsDrawer diagnostics={[withProvenance()]} />
      </I18nProvider>
    )
    expect(screen.queryByText(/CŨ/)).not.toBeInTheDocument()
  })
})
