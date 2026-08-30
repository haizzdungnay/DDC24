import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../i18n'
import { Modal } from './Modal'

/**
 * Bẫy tiêu điểm của hộp thoại dùng chung.
 *
 * Vì sao có tệp này: `Modal` không hề có test đơn vị nào, và một lỗi bàn phím
 * thật đã sống trong đó — Tab từ nút cuối cùng cuộn vòng về tiêu đề `<h2>` thay
 * vì về nút `Đóng`. Tiêu đề mang `data-modal-initial-focus tabIndex={-1}` để
 * nhận tiêu điểm ban đầu; nó lọt vào vòng Tab qua chính nhánh đó của bộ chọn.
 * Hệ quả: ở MỌI hộp thoại của sản phẩm, người dùng bàn phím mất một nhịp Tab
 * thừa vào một phần tử không bấm được.
 *
 * `e2e/trends.spec.ts` bắt được lỗi này nhưng đã đỏ sẵn trên `main` nên không
 * ai đọc. Test ở đây chạy trong jsdom, nhanh, và nằm ngay cạnh component.
 */
function renderModal() {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  render(
    <I18nProvider>
      <Modal open title="Thêm trend" confirmLabel="Áp dụng" cancelLabel="Hủy" onConfirm={onConfirm} onClose={onClose}>
        <input aria-label="Tìm điểm" />
      </Modal>
    </I18nProvider>,
  )
  return {
    dialog: screen.getByRole('dialog'),
    close: screen.getByRole('button', { name: 'Đóng' }),
    confirm: screen.getByRole('button', { name: 'Áp dụng' }),
    heading: screen.getByRole('heading', { name: 'Thêm trend' }),
  }
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('Modal — vòng Tab', () => {
  it('Tab từ nút cuối cùng cuộn về nút Đóng, KHÔNG về tiêu đề', () => {
    const { dialog, close, confirm, heading } = renderModal()
    confirm.focus()
    expect(confirm).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Tab' })

    expect(close).toHaveFocus()
    // Chốt riêng vế phủ định: tiêu đề nhận được tiêu điểm bằng mã (tabIndex -1)
    // nên "không phải Đóng" là chưa đủ — phải nói rõ nó KHÔNG được là đích.
    expect(heading).not.toHaveFocus()
  })

  it('Shift+Tab từ nút Đóng cuộn ngược về nút cuối cùng', () => {
    const { dialog, close, confirm } = renderModal()
    close.focus()

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })

    expect(confirm).toHaveFocus()
  })

  it('tiêu đề vẫn nhận tiêu điểm BAN ĐẦU — bỏ nó khỏi vòng Tab không được làm mất vai trò đó', () => {
    const { heading } = renderModal()
    expect(heading).toHaveFocus()
  })
})
