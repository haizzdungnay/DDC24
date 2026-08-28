import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
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
})
