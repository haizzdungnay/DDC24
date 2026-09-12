import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import { InsertPointVariablePanel } from './InsertPointVariablePanel'
import type { ProgrammingPointCatalogEntry } from '../../model/types'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderWithI18n(ui: React.ReactElement) {
  localStorage.setItem('mkddc-lang', 'vi')
  return render(<I18nProvider>{ui}</I18nProvider>)
}

const mockPoint: ProgrammingPointCatalogEntry = {
  category: 'LOCAL',
  pointId: 'UI-01',
  name: 'Supply Air Temp',
  dataType: 'REAL',
  unit: 'degC',
  direction: 'READ',
  writable: false,
  quality: 'GOOD',
  value: 21.5,
}

describe('InsertPointVariablePanel', () => {
  it('B-T7: Nhánh ST gọi onInsert cũ, không truyền variant => vẫn là popover absolute, hoạt động nguyên vẹn', () => {
    const onInsert = vi.fn()
    const onEnsureLoaded = vi.fn()
    const onClose = vi.fn()

    const { container } = renderWithI18n(
      <InsertPointVariablePanel
        variables={[{ name: 'myVar', type: 'INT' }]}
        pointCatalogStatus="ready"
        pointCatalogItems={[mockPoint]}
        pointCatalogError={null}
        onEnsureLoaded={onEnsureLoaded}
        onInsert={onInsert}
        onClose={onClose}
      />,
    )

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toHaveClass('absolute')
    expect(dialog).toHaveClass('w-72')
    expect(dialog).toHaveClass('right-0')
    expect(dialog).toHaveClass('top-0')

    const pointButton = screen.getByRole('button', { name: /UI-01/i })
    fireEvent.click(pointButton)
    expect(onInsert).toHaveBeenCalledWith('UI-01', { dataType: 'REAL', unit: 'degC' })
  })

  it('B-T9: variant="embedded" trong dock => không có class absolute, chiếm đủ bề ngang dock', () => {
    const onInsert = vi.fn()
    const onEnsureLoaded = vi.fn()
    const onClose = vi.fn()

    const { container } = renderWithI18n(
      <InsertPointVariablePanel
        variant="embedded"
        variables={[{ name: 'myVar', type: 'INT' }]}
        pointCatalogStatus="ready"
        pointCatalogItems={[mockPoint]}
        pointCatalogError={null}
        onEnsureLoaded={onEnsureLoaded}
        onInsert={onInsert}
        onClose={onClose}
      />,
    )
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toHaveClass('absolute')
    expect(dialog).not.toHaveClass('right-0')
    expect(dialog).not.toHaveClass('top-0')
    expect(dialog).toHaveClass('w-full')
  })

  it('B-T4: pointCatalogStatus === "error" => hiện pointCatalogError + nút Thử lại, danh sách rỗng, 0 entry mẫu', () => {
    const onEnsureLoaded = vi.fn()
    renderWithI18n(
      <InsertPointVariablePanel
        variant="embedded"
        variables={[]}
        pointCatalogStatus="error"
        pointCatalogItems={[]}
        pointCatalogError="Lỗi kết nối điểm"
        onEnsureLoaded={onEnsureLoaded}
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Lỗi kết nối điểm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /UI-01/i })).toBeNull()
  })

  it('B-T5: Bấm Thử lại => gọi đúng 1 lần onEnsureLoaded', () => {
    const onEnsureLoaded = vi.fn()
    renderWithI18n(
      <InsertPointVariablePanel
        variant="embedded"
        variables={[]}
        pointCatalogStatus="error"
        pointCatalogItems={[]}
        pointCatalogError="Lỗi mạng"
        onEnsureLoaded={onEnsureLoaded}
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // onEnsureLoaded được gọi 1 lần khi mount
    expect(onEnsureLoaded).toHaveBeenCalledTimes(1)
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' })
    fireEvent.click(retryBtn)
    expect(onEnsureLoaded).toHaveBeenCalledTimes(2)
  })

  it('B-T8: pointCatalogStatus === "loading" => hiện "Đang tải…", chưa hiện danh sách, không cho chọn', () => {
    renderWithI18n(
      <InsertPointVariablePanel
        variant="embedded"
        variables={[]}
        pointCatalogStatus="loading"
        pointCatalogItems={[mockPoint]}
        pointCatalogError={null}
        onEnsureLoaded={vi.fn()}
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Đang tải…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /UI-01/i })).toBeNull()
  })
})
