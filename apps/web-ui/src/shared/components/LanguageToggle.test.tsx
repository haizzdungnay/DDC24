import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { LanguageToggle } from './LanguageToggle'

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(() => { cleanup(); localStorage.clear() })

function renderToggle(props: { compact?: boolean; className?: string } = {}) {
  return render(<I18nProvider><LanguageToggle {...props} /></I18nProvider>)
}

describe('LanguageToggle', () => {
  it('tên truy cập là HÀNH ĐỘNG, nhãn nhìn thấy là ngôn ngữ hiện tại', () => {
    renderToggle()
    const button = screen.getByRole('button', { name: 'Đổi ngôn ngữ' })
    /* `VI` là TRẠNG THÁI. Nếu nó cũng là tên truy cập thì người dùng trình đọc
     * màn hình nghe "VI" mà không biết bấm vào sẽ ra gì — nên tên truy cập phải
     * nói hành động, và `title` nói đích đến. */
    expect(button).toHaveTextContent('VI')
    expect(button).toHaveAttribute('title', 'Đổi ngôn ngữ sang EN')
  })

  it('bấm thì đổi ngôn ngữ thật, và nhãn theo ngôn ngữ mới', () => {
    renderToggle()
    fireEvent.click(screen.getByRole('button', { name: 'Đổi ngôn ngữ' }))
    const button = screen.getByRole('button', { name: 'Toggle language' })
    expect(button).toHaveTextContent('EN')
    expect(button).toHaveAttribute('title', 'Switch language to VI')
  })

  it('luôn có đúng MỘT nút trong một lần dựng', () => {
    renderToggle()
    expect(screen.queryAllByTestId('language-toggle')).toHaveLength(1)
  })

  /* Hàng Global Context Bar cao 38 px và `overflow-hidden`: một nút cao 40 px sẽ
   * bị cắt, và phần bị cắt vẫn nhận chuột. Nên bản `compact` phải thấp hơn hàng,
   * không phải chỉ nhỏ chữ. `PROGRAMMING_CONTEXT_STRIP_HEIGHT_PX` = 38. */
  it('bản compact thấp hơn hàng 38 px và bỏ mũi nhọn', () => {
    renderToggle({ compact: true })
    const button = screen.getByTestId('language-toggle')
    expect(button.className).toContain('h-6')
    expect(button.className).not.toContain('h-10')
    expect(button.querySelector('svg')).toBeNull()
    cleanup()

    renderToggle()
    const full = screen.getByTestId('language-toggle')
    expect(full.className).toContain('h-10')
    expect(full.querySelector('svg')).not.toBeNull()
  })

  it('nhận thêm className của bên gọi mà không mất lớp gốc', () => {
    renderToggle({ compact: true, className: 'hidden lg:inline-flex' })
    const button = screen.getByTestId('language-toggle')
    expect(button.className).toContain('hidden')
    expect(button.className).toContain('lg:inline-flex')
    expect(button.className).toContain('shrink-0')
  })
})
