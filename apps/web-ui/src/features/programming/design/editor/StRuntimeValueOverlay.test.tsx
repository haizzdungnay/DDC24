import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

  it('last-known value STALE còn thấy được nhưng có quality/freshness và nhãn chữ rõ', () => {
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
