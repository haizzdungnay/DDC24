import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { useUrlFilters } from './useUrlFilters'

/**
 * Khoá hành vi của `BB-1` (`T57-2.1`).
 *
 * Ba luật trong docstring của hook đều có hệ quả người dùng thấy được, nên cả
 * ba phải có test — nếu không, chúng chỉ là lời hứa trong chú thích.
 */

const DEFAULTS = { status: 'all', q: '' }

function Probe() {
  const filters = useUrlFilters(DEFAULTS)
  const location = useLocation()
  return (
    <div>
      <span data-testid="status">{filters.values.status}</span>
      <span data-testid="q">{filters.values.q}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="filtered">{String(filters.isFiltered)}</span>
      <button onClick={() => filters.set('status', 'unack')}>set-unack</button>
      <button onClick={() => filters.set('status', 'all')}>set-all</button>
      <button onClick={() => filters.set('q', 'AHU')}>set-q</button>
      <button onClick={filters.clear}>clear</button>
    </div>
  )
}

function renderAt(entry: string) {
  return render(<MemoryRouter initialEntries={[entry]}><Probe /></MemoryRouter>)
}

afterEach(cleanup)

describe('useUrlFilters — BB-1', () => {
  it('đọc giá trị từ URL, thiếu thì dùng mặc định', () => {
    renderAt('/alarms?status=unack')
    expect(screen.getByTestId('status')).toHaveTextContent('unack')
    expect(screen.getByTestId('q')).toHaveTextContent('')
  })

  it('LUẬT 1 — giá trị bằng mặc định KHÔNG được ghi vào URL', async () => {
    const user = userEvent.setup()
    renderAt('/alarms')
    await user.click(screen.getByText('set-unack'))
    expect(screen.getByTestId('search')).toHaveTextContent('status=unack')

    await user.click(screen.getByText('set-all'))
    expect(
      screen.getByTestId('search').textContent,
      'thanh địa chỉ đầy ?status=all&q= thì không đọc được và không chia sẻ được'
    ).not.toContain('status')
  })

  it('LUẬT 3 — clear chỉ xoá khoá của bộ lọc, giữ tham số của nơi khác', async () => {
    const user = userEvent.setup()
    renderAt('/alarms?status=unack&alarm=ALM-002')
    await user.click(screen.getByText('clear'))

    const search = screen.getByTestId('search').textContent ?? ''
    expect(search).not.toContain('status=')
    expect(
      search,
      'xoá sạch query sẽ nuốt luôn deep link ?alarm= từ Landing và người dùng mất ngữ cảnh vừa đến từ đâu'
    ).toContain('alarm=ALM-002')
  })

  it('isFiltered phản ánh đúng để trang biết khi nào hiện nút "Xoá lọc"', async () => {
    const user = userEvent.setup()
    renderAt('/alarms')
    expect(screen.getByTestId('filtered')).toHaveTextContent('false')
    await user.click(screen.getByText('set-q'))
    expect(screen.getByTestId('filtered')).toHaveTextContent('true')
  })
})
