import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import { WorkbenchWatchPanel, formatObserved, type WatchRow } from './WorkbenchWatchPanel'

/**
 * `DEV-PROG-003` — khay Watch (Trực tiếp).
 *
 * Trọng tâm của bộ này là **cái không được vẽ**: một giá trị không đọc được
 * không bao giờ trở thành một điểm trên đường xu hướng, và một mốc đọc hỏng
 * không bao giờ được in nguyên ra như thể nó là một mốc thật.
 */
function rows(): WatchRow[] {
  return [
    {
      variableId: 'v1', name: 'temp_in', display: '23.4', state: 'live', quality: 'GOOD',
      typeName: 'REAL', observedAt: '2026-08-28T07:32:18.123Z', numeric: 23.4, unit: 'degC',
    },
    {
      variableId: 'v2', name: 'fan_cmd', display: 'TRUE', state: 'live', quality: 'GOOD',
      typeName: 'BOOL', observedAt: '2026-08-28T07:32:18.123Z', numeric: 1,
    },
    {
      variableId: 'v3', name: 'valve_cmd', display: '—', state: 'invalid', quality: 'BAD',
      numeric: null,
    },
  ]
}

function renderPanel(list: WatchRow[] = rows(), addRequest?: { name: string; nonce: number }) {
  return render(
    <I18nProvider>
      <WorkbenchWatchPanel rows={list} addRequest={addRequest ?? null} />
    </I18nProvider>,
  )
}

beforeEach(() => {
  // Hồ sơ trình duyệt mới đọc `navigator.language`, mà jsdom báo `en-US`; spec
  // kiểm chính xác copy tiếng Việt phải khai báo thay vì phụ thuộc mặc định.
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('WorkbenchWatchPanel — năm cột và không cột nào được bịa', () => {
  it('hiện đủ Biến/Giá trị/Kiểu/Chất lượng/Mốc đọc', () => {
    renderPanel()
    const row = within(screen.getAllByTestId('workbench-watch-row')[0])
    expect(row.getByText('temp_in')).toBeInTheDocument()
    expect(row.getByText('23.4 degC')).toBeInTheDocument()
    expect(row.getByText('REAL')).toBeInTheDocument()
    expect(row.getByText('Tốt')).toBeInTheDocument()
    // Mốc đọc theo giờ địa phương tới mili-giây.
    expect(row.getByText(/\d\d:\d\d:\d\d\.\d\d\d/)).toBeInTheDocument()
  })

  it('kiểu không tra được ⇒ "—", KHÔNG đoán từ hình dạng giá trị', () => {
    // `0` có thể là INT, REAL, hay BOOL đã ép kiểu. Đoán sai kiểu ở đây dẫn tới
    // một kết luận sai về tràn số.
    renderPanel()
    const invalid = within(screen.getAllByTestId('workbench-watch-row')[2])
    expect(invalid.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(invalid.getByText('Xấu')).toBeInTheDocument()
  })

  it('chất lượng nói bằng CHỮ, không chỉ bằng màu', () => {
    renderPanel([{ ...rows()[0], quality: 'UNCERTAIN' }])
    expect(screen.getByText('Chưa chắc')).toBeInTheDocument()
  })

  it('dưới hai mẫu thì KHÔNG vẽ đường — một điểm kéo ngang trông như "ổn định"', () => {
    renderPanel()
    expect(screen.getAllByText('chưa đủ mẫu').length).toBe(3)
  })

  it('bỏ theo dõi một biến rồi thêm lại được — không phải thao tác một chiều', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ theo dõi temp_in' }))
    expect(screen.queryByText('temp_in')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Thêm biến (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'temp_in' }))
    expect(screen.getAllByTestId('workbench-watch-row')).toHaveLength(3)
  })

  it('yêu cầu từ nháy đúp đưa lại biến đã bị bỏ vào danh sách', () => {
    const { rerender } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ theo dõi fan_cmd' }))
    expect(screen.queryByText('fan_cmd')).toBeNull()

    rerender(
      <I18nProvider>
        <WorkbenchWatchPanel rows={rows()} addRequest={{ name: 'fan_cmd', nonce: 1 }} />
      </I18nProvider>,
    )
    expect(screen.getByText('fan_cmd')).toBeInTheDocument()
  })

  it('không có biến nào ánh xạ ⇒ nói đúng vế đó, không hiện bảng rỗng', () => {
    renderPanel([])
    expect(screen.getByRole('status')).toHaveTextContent(/không có biến runtime nào được ánh xạ/)
  })
})

describe('formatObserved — mốc hỏng không được in nguyên ra', () => {
  it('không có mốc, hoặc mốc không parse được ⇒ "—"', () => {
    // In một chuỗi ISO hỏng ra màn hình chỉ làm người đọc tưởng đó là một mốc
    // thật có định dạng lạ.
    expect(formatObserved(undefined)).toBe('—')
    expect(formatObserved('không-phải-mốc')).toBe('—')
  })

  it('mốc hợp lệ hiện tới mili-giây', () => {
    expect(formatObserved('2026-08-28T07:32:18.123Z')).toMatch(/^\d\d:\d\d:\d\d\.123$/)
  })
})
