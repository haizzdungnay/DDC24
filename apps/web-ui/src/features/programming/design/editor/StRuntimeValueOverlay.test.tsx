import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { presentStRuntimeValue, StRuntimeValueOverlay, type StRuntimeOverlayItem } from './StRuntimeValueOverlay'

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

function item(overrides: Partial<StRuntimeOverlayItem> = {}): StRuntimeOverlayItem {
  return {
    variableId: 'variable-1',
    variableName: 'SupplyTemp',
    value: 0,
    valid: true,
    unit: 'degC',
    quality: 'GOOD',
    freshness: 'LIVE',
    observedAt: '2026-08-21T10:00:00Z',
    ...overrides,
  }
}

describe('StRuntimeValueOverlay (T59-506)', () => {
  it('giữ số 0 thật khi valid=true, nhưng valid=false tuyệt đối không vẽ thành 0', () => {
    expect(presentStRuntimeValue(item())).toEqual({ displayValue: '0', state: 'live' })
    expect(presentStRuntimeValue(item({ valid: false }))).toEqual({ displayValue: '—', state: 'invalid' })

    render(
      <I18nProvider>
        <StRuntimeValueOverlay state={{ status: 'ready', items: [
          item(),
          item({ variableId: 'variable-2', variableName: 'InvalidRawZero', valid: false }),
        ] }} />
      </I18nProvider>,
    )
    const validRow = screen.getByText('SupplyTemp').closest('li')!
    const invalidRow = screen.getByText('InvalidRawZero').closest('li')!
    expect(within(validRow).getByText('0 degC')).toBeInTheDocument()
    expect(within(invalidRow).getByText('—')).toBeInTheDocument()
    expect(within(invalidRow).queryByText('0 degC')).not.toBeInTheDocument()
    expect(within(invalidRow).getByText(/Không hợp lệ/)).toBeInTheDocument()
  })

  it('AC-ST-009: last-known value STALE còn thấy được nhưng có quality/freshness và nhãn chữ rõ', () => {
    render(
      <I18nProvider>
        <StRuntimeValueOverlay state={{ status: 'ready', items: [item({ value: 21.5, quality: 'STALE', freshness: 'STALE' })] }} />
      </I18nProvider>,
    )
    const row = screen.getByText('SupplyTemp').closest('li')!
    expect(within(row).getByText('21.5 degC')).toBeInTheDocument()
    expect(within(row).getByText(/STALE · STALE · Dữ liệu đã cũ/)).toBeInTheDocument()
  })

  it.each([
    { quality: 'BAD' as const, freshness: 'LIVE' as const },
    { quality: 'OFFLINE' as const, freshness: 'LIVE' as const },
    { quality: 'UNKNOWN' as const, freshness: 'LIVE' as const },
    { quality: 'GOOD' as const, freshness: 'UNAVAILABLE' as const },
  ])('ẩn giá trị khi authority là $quality/$freshness', ({ quality, freshness }) => {
    expect(presentStRuntimeValue(item({ value: 42, quality, freshness }))).toEqual({ displayValue: '—', state: 'invalid' })
  })

  it('nêu rõ loading, unavailable và empty thay vì dựng dữ liệu giả', () => {
    const { rerender } = render(<I18nProvider><StRuntimeValueOverlay state={{ status: 'loading' }} /></I18nProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải giá trị runtime')

    rerender(<I18nProvider><StRuntimeValueOverlay state={{ status: 'unavailable', reason: 'Core timeout' }} /></I18nProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Không đọc được giá trị runtime. Core timeout')

    rerender(<I18nProvider><StRuntimeValueOverlay state={{ status: 'ready', items: [] }} /></I18nProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Chưa có biến runtime')
  })
})

/* `T59-810` — Core restart giữa hai snapshot. Giá trị trước và sau một lần
 * restart KHÔNG thuộc cùng một mạch: bộ đếm, trạng thái FB và LKG đều có thể đã
 * khác. Nối tiếp im lặng là nói dối về tính liên tục. */
describe('StRuntimeValueOverlay — Core khởi động lại (T59-810)', () => {
  const item = {
    variableId: 'v1', variableName: 'SupplyTemp', value: 21.5, valid: true,
    quality: 'GOOD' as const, freshness: 'LIVE' as const,
  }

  it('nói ra khi producer đã restart, và VẪN hiện giá trị mới', () => {
    render(
      <I18nProvider>
        <StRuntimeValueOverlay state={{ status: 'ready', items: [item], producerRestarted: true }} />
      </I18nProvider>,
    )
    expect(screen.getByText(/Core đã khởi động lại/)).toBeInTheDocument()
    // Không giấu số liệu: mạch mới vẫn là số liệu thật của mạch mới.
    expect(screen.getByText('SupplyTemp')).toBeInTheDocument()
  })

  it('không restart thì không có cảnh báo thừa', () => {
    render(
      <I18nProvider>
        <StRuntimeValueOverlay state={{ status: 'ready', items: [item] }} />
      </I18nProvider>,
    )
    expect(screen.queryByText(/Core đã khởi động lại/)).toBeNull()
  })
})

describe('StRuntimeValueOverlay — Bộ lọc và chọn biến hiển thị', () => {
  const items = [
    item({ variableId: 'v1', variableName: 'SupplyTemp', value: 24.5 }),
    item({ variableId: 'v2', variableName: 'ReturnTemp', value: 28.0 }),
    item({ variableId: 'v3', variableName: 'FanSpeed', value: 75 }),
  ]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('mkddc-lang', 'vi')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('lọc danh sách biến theo ô tìm kiếm', () => {
    render(
      <I18nProvider>
        <StRuntimeValueOverlay state={{ status: 'ready', items }} programId="pou-ah01" />
      </I18nProvider>,
    )
    expect(screen.getByText('SupplyTemp')).toBeInTheDocument()
    expect(screen.getByText('ReturnTemp')).toBeInTheDocument()
    expect(screen.getByText('FanSpeed')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Tìm biến…')
    fireEvent.change(searchInput, { target: { value: 'fan' } })

    expect(screen.queryByText('SupplyTemp')).not.toBeInTheDocument()
    expect(screen.queryByText('ReturnTemp')).not.toBeInTheDocument()
    expect(screen.getByText('FanSpeed')).toBeInTheDocument()

    // Xoá tìm kiếm bằng nút Clear
    const clearBtn = screen.getByLabelText('Xoá tìm kiếm')
    fireEvent.click(clearBtn)
    expect(screen.getByText('SupplyTemp')).toBeInTheDocument()
    expect(screen.getByText('FanSpeed')).toBeInTheDocument()
  })

  it('mở panel chọn biến, ẩn biến qua checkbox và lưu vào localStorage theo programId', () => {
    render(
      <I18nProvider>
        <StRuntimeValueOverlay state={{ status: 'ready', items }} programId="pou-ah01" />
      </I18nProvider>,
    )

    const togglePickerBtn = screen.getByTitle('Chọn biến hiển thị')
    fireEvent.click(togglePickerBtn)

    expect(screen.getByTestId('runtime-variable-picker')).toBeInTheDocument()

    // Bỏ chọn biến ReturnTemp
    const returnTempCheckbox = screen.getByRole('checkbox', { name: 'ReturnTemp' })
    expect(returnTempCheckbox).toBeChecked()
    fireEvent.click(returnTempCheckbox)
    expect(returnTempCheckbox).not.toBeChecked()

    // Biến ReturnTemp bị ẩn khỏi danh sách overlay
    const list = screen.getByRole('list', { name: 'Giá trị runtime theo biến' })
    expect(within(list).getByText('SupplyTemp')).toBeInTheDocument()
    expect(within(list).queryByText('ReturnTemp')).not.toBeInTheDocument()
    expect(screen.queryByText('28 degC')).not.toBeInTheDocument()

    // Kiểm tra localStorage
    const saved = JSON.parse(localStorage.getItem('mkddc.programming.runtimeOverlay.hidden.pou-ah01') || '[]')
    expect(saved).toContain('ReturnTemp')
  })

  it('hỗ trợ nút Bỏ chọn tất cả và Hiện tất cả', () => {
    render(
      <I18nProvider>
        <StRuntimeValueOverlay state={{ status: 'ready', items }} programId="pou-ah01" />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByTitle('Chọn biến hiển thị'))

    // Bỏ chọn tất cả
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn tất cả' }))
    expect(screen.getByText('Không có biến nào khớp với bộ lọc.')).toBeInTheDocument()

    // Nút Hiện tất cả biến ở trạng thái rỗng
    fireEvent.click(screen.getByRole('button', { name: 'Hiện tất cả biến' }))
    const list = screen.getByRole('list', { name: 'Giá trị runtime theo biến' })
    expect(within(list).getByText('SupplyTemp')).toBeInTheDocument()
    expect(within(list).getByText('ReturnTemp')).toBeInTheDocument()
    expect(within(list).getByText('FanSpeed')).toBeInTheDocument()
  })

  it('hỗ trợ mode SIMULATION với tiêu đề và storageKey riêng biệt', () => {
    render(
      <I18nProvider>
        <StRuntimeValueOverlay
          state={{ status: 'ready', items }}
          programId="sim-01"
          mode="SIMULATION"
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Giá trị quan sát')
    expect(screen.getByText('Mô phỏng')).toBeInTheDocument()

    // Bỏ chọn biến SupplyTemp
    fireEvent.click(screen.getByTitle('Chọn biến hiển thị'))
    const supplyTempCheckbox = screen.getByRole('checkbox', { name: 'SupplyTemp' })
    fireEvent.click(supplyTempCheckbox)

    const saved = JSON.parse(localStorage.getItem('mkddc.programming.runtimeOverlay.hidden.sim.sim-01') || '[]')
    expect(saved).toContain('SupplyTemp')
  })
})
