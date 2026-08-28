import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { ProgramsSummaryTable } from './ProgramsSummaryTable'
import type { OverviewProgramRow, ProgramsSummaryModel } from './overviewViewModel'

/**
 * `T60-205` — bảng Programs của PGM-01.
 *
 * File này khoá bốn thứ dễ trôi nhất:
 *
 * 1. **Sáu cột theo D-02**, không có `Task`, không có CPU/core.
 * 2. **Thiếu số liệu ra `—` kèm lý do**, không bao giờ ra `0` (`AC-PGM01-04`).
 * 3. **`LAST_KNOWN` phải hiện nhãn "giá trị cũ"**.
 * 4. **Không UUID ở mặt trước** (`AC-PGM01-01`) — kiểm bằng regex trên toàn bộ
 *    DOM của bảng, không chỉ trên vài chuỗi cụ thể.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OBJECT_A = '44444444-4444-4444-8444-444444444444'
const PROGRAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function row(overrides: Partial<OverviewProgramRow> = {}): OverviewProgramRow {
  return {
    key: OBJECT_A,
    programId: PROGRAM_A,
    objectId: OBJECT_A,
    name: 'AHU_Control',
    language: 'ST',
    cycle: { periodMs: 1000, source: 'CORE_LIVE' },
    runtimeState: 'RUNNING',
    runtimeStateSource: 'CORE_LIVE',
    lastRun: { atUtc: '2026-08-23T10:00:00Z', ageMs: 400 },
    health: 'HEALTHY',
    healthMissingReason: null,
    origin: 'DECLARED_AND_LIVE',
    ...overrides
  }
}

function model(overrides: Partial<ProgramsSummaryModel> = {}): ProgramsSummaryModel {
  return {
    rows: [row()],
    source: 'CORE_LIVE',
    truncated: false,
    emptyReason: null,
    activeSetReason: null,
    activeLabel: 'Active #12',
    ...overrides
  }
}

/** Hiện đường dẫn + query đích để khẳng định deep-link mang theo POU đã chọn. */
function ProgramsRouteProbe() {
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  return <div data-testid="pgm02">{`${projectId}${location.search}`}</div>
}

function renderTable(overrides: Partial<ProgramsSummaryModel> = {}, lang: 'vi' | 'en' = 'vi', projectId: string | null = PROJECT_ID) {
  localStorage.setItem('mkddc-lang', lang)
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming']}>
        <Routes>
          <Route path="/eng/programming" element={<ProgramsSummaryTable model={model(overrides)} projectId={projectId} />} />
          <Route path="/eng/programming/projects/:projectId/programs" element={<ProgramsRouteProbe />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

function table() {
  return screen.getByRole('table')
}

afterEach(cleanup)

describe('ProgramsSummaryTable — sáu cột theo D-02', () => {
  it('đúng sáu cột, đúng thứ tự, KHÔNG có cột Task và KHÔNG có CPU/core', () => {
    renderTable()
    const headers = within(table()).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['Chương trình', 'Ngôn ngữ', 'Chu kỳ', 'Trạng thái', 'Chạy gần nhất', 'Sức khoẻ'])
    // Task không còn là đơn vị chạy từ `T59-402`; cột đó bị D-02 loại hẳn.
    expect(within(table()).queryByRole('columnheader', { name: /task|tác vụ/i })).not.toBeInTheDocument()
    expect(within(table()).queryByRole('columnheader', { name: /cpu|core|lõi/i })).not.toBeInTheDocument()
  })

  it('chu kỳ render TỪ DỮ LIỆU, không phải hằng số của ảnh mockup (D-03)', () => {
    renderTable({ rows: [row({ cycle: { periodMs: 5000, source: 'CORE_LIVE' } })] })
    expect(within(table()).getByText('5000 ms')).toBeInTheDocument()
    // Profile Rev A chỉ có [1000, 5000, 30000]; `10 ms`/`100 ms` trong ảnh
    // không tồn tại trong sản phẩm nên cũng không được xuất hiện ở đây.
    expect(within(table()).queryByText('10 ms')).not.toBeInTheDocument()
    expect(within(table()).queryByText('100 ms')).not.toBeInTheDocument()
  })

  it('nói rõ nguồn của chu kỳ: số sống của Core khác số khai báo trong gói', () => {
    renderTable({ rows: [row({ cycle: { periodMs: 1000, source: 'CORE_LIVE' } })] })
    expect(within(table()).getByText('Core đang chạy')).toBeInTheDocument()
    cleanup()
    renderTable({ rows: [row({ cycle: { periodMs: 1000, source: 'DECLARED' } })] })
    expect(within(table()).getByText('Khai báo trong gói')).toBeInTheDocument()
  })
})

describe('ProgramsSummaryTable — hàng bấm được mở PGM-02 kèm POU đã chọn', () => {
  it('bấm tên chương trình điều hướng sang PGM-02 với query program', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'AHU_Control' }))
    expect(screen.getByTestId('pgm02')).toHaveTextContent(`${PROJECT_ID}?program=${OBJECT_A}`)
  })

  it('bấm vào hàng cũng mở đúng POU đó', () => {
    renderTable()
    const cell = screen.getByRole('button', { name: 'AHU_Control' }).closest('tr')
    fireEvent.click(cell as HTMLElement)
    expect(screen.getByTestId('pgm02')).toHaveTextContent(`${PROJECT_ID}?program=${OBJECT_A}`)
  })

  it('không có objectId ⇒ hàng KHÔNG bấm được, không điều hướng "chung chung"', () => {
    renderTable({ rows: [row({ objectId: null, key: 'live:x', origin: 'LIVE_ONLY', name: 'Chỉ Core biết' })] })
    expect(screen.queryByRole('button', { name: 'Chỉ Core biết' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('pgm02')).not.toBeInTheDocument()
  })

  it('chưa xác định được Project ⇒ hàng không bấm được', () => {
    renderTable({}, 'vi', null)
    expect(screen.queryByRole('button', { name: 'AHU_Control' })).not.toBeInTheDocument()
    expect(within(table()).getByText('AHU_Control')).toBeInTheDocument()
  })
})

describe('ProgramsSummaryTable — thiếu số liệu ra "—" kèm lý do, KHÔNG BAO GIỜ 0 (AC-PGM01-04)', () => {
  it('Core im: chu kỳ, mốc chạy và sức khoẻ đều là "—" kèm lý do', () => {
    renderTable({
      source: 'UNAVAILABLE',
      rows: [row({
        cycle: null, lastRun: null, health: null, healthMissingReason: 'NOT_READ_FROM_CORE',
        runtimeState: 'UNKNOWN', runtimeStateSource: 'UNAVAILABLE'
      })]
    })
    const body = table().querySelector('tbody') as HTMLElement
    expect(within(body).getAllByText('—')).toHaveLength(3)
    expect(within(body).getAllByText('Chưa đọc được từ Core').length).toBeGreaterThanOrEqual(3)
    // Không một `0` đơn độc nào được sinh ra từ dữ liệu thiếu.
    expect(body.textContent).not.toMatch(/(^|[^0-9])0($|[^0-9])/)
  })

  it('lý do trống sức khoẻ phân biệt "chưa đọc được" với "server không gán nhãn"', () => {
    renderTable({ rows: [row({ health: null, healthMissingReason: 'NOT_LABELLED', runtimeState: 'DISABLED' })] })
    expect(within(table()).getByText('Máy chủ không gán nhãn cho trạng thái này')).toBeInTheDocument()
    cleanup()
    renderTable({ rows: [row({ health: null, healthMissingReason: 'NOT_REPORTED_BY_CORE', origin: 'DECLARED_ONLY' })] })
    expect(within(table()).getByText('Core không kể tên chương trình này')).toBeInTheDocument()
  })

  it('chương trình chỉ Core biết: tên và ngôn ngữ là "—" kèm lý do, không in định danh thay thế', () => {
    renderTable({ rows: [row({ key: 'live:x', objectId: null, name: null, language: null, origin: 'LIVE_ONLY' })] })
    expect(within(table()).getAllByText('Không có trong gói đang vận hành')).toHaveLength(2)
  })

  it('bảng bị Core cắt ở trần 32 chương trình thì nói thẳng là chưa đầy đủ', () => {
    renderTable({ truncated: true })
    expect(screen.getByText(/chưa đầy đủ/)).toBeInTheDocument()
  })
})

describe('ProgramsSummaryTable — LAST_KNOWN mang nhãn "giá trị cũ"', () => {
  it('read-back rơi về bảng ý định bền vững ⇒ hiện nhãn giá trị cũ', () => {
    renderTable({ source: 'LAST_KNOWN', rows: [row({ runtimeStateSource: 'LAST_KNOWN' })] })
    expect(within(table()).getByText('giá trị cũ')).toBeInTheDocument()
  })

  it('read-back sống thì KHÔNG dán nhãn giá trị cũ', () => {
    renderTable()
    expect(within(table()).queryByText('giá trị cũ')).not.toBeInTheDocument()
  })

  it('nguồn UNAVAILABLE nói "chưa đọc được từ Core", không im lặng hiện trạng thái như thật', () => {
    renderTable({ source: 'UNAVAILABLE', rows: [row({ runtimeState: 'UNKNOWN', runtimeStateSource: 'UNAVAILABLE' })] })
    expect(within(table()).getAllByText('Chưa đọc được từ Core').length).toBeGreaterThan(0)
  })
})

describe('ProgramsSummaryTable — AC-PGM01-01 và tín hiệu không chỉ bằng màu', () => {
  it('không có UUID nào trên mặt trước của bảng', () => {
    renderTable()
    expect(table().textContent ?? '').not.toMatch(UUID_PATTERN)
    // Cả trong thuộc tính DOM: một `data-*` mang UUID vẫn là lộ định danh thô.
    expect(table().outerHTML).not.toMatch(UUID_PATTERN)
  })

  it('nhãn revision dùng "Active #12" thay cho UUID (D-05)', () => {
    renderTable()
    expect(screen.getByText(/Active #12/)).toBeInTheDocument()
  })

  it('chưa phân giải được số hiệu gói thì nói ra, không in UUID thay thế', () => {
    renderTable({ activeLabel: null })
    expect(screen.getByText(/chưa phân giải được số hiệu/)).toBeInTheDocument()
  })

  it('mỗi trạng thái có CHỮ bên cạnh màu — trạng thái chạy và sức khoẻ đều đọc được', () => {
    renderTable()
    expect(within(table()).getByText('Đang chạy')).toBeInTheDocument()
    expect(within(table()).getByText('Bình thường')).toBeInTheDocument()
    cleanup()
    renderTable({ rows: [row({ runtimeState: 'FAULTED', health: 'FAULT' })] })
    // Hai chỗ: cột State ('Lỗi' = FAULTED) và cột Health ('Lỗi' = FAULT).
    expect(within(table()).getAllByText('Lỗi')).toHaveLength(2)
  })
})

describe('ProgramsSummaryTable — trạng thái rỗng luôn có lý do', () => {
  it('đang đọc: skeleton/loading, KHÔNG phải "không có chương trình nào"', () => {
    renderTable({ rows: [], emptyReason: 'LOADING', activeSetReason: 'REVISION_LOADING' })
    expect(screen.getByText('Đang đọc danh sách chương trình…')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('đọc hỏng: nói rõ chưa đọc được, kèm lý do của tập Program', () => {
    renderTable({ rows: [], emptyReason: 'UNAVAILABLE', activeSetReason: 'REVISION_MISMATCH' })
    expect(screen.getByText('Chưa đọc được danh sách chương trình.')).toBeInTheDocument()
    expect(screen.getByText(/không dùng bản nháp để thay thế/)).toBeInTheDocument()
  })

  it('chưa Commission gói nào: giải thích, không hiện bảng rỗng câm', () => {
    renderTable({ rows: [], emptyReason: 'NO_PROGRAM', activeSetReason: 'NO_ACTIVE_REVISION', activeLabel: null })
    expect(screen.getByText('Chưa có chương trình nào đang vận hành.')).toBeInTheDocument()
    expect(screen.getByText(/chưa vận hành gói nào/)).toBeInTheDocument()
  })
})

describe('ProgramsSummaryTable — D-06 một ngôn ngữ tại một thời điểm', () => {
  it('chế độ EN không rò tiếng Việt (tiền lệ BUG-018)', () => {
    renderTable({ source: 'LAST_KNOWN', rows: [row({ runtimeStateSource: 'LAST_KNOWN', cycle: null, health: null, healthMissingReason: 'NOT_READ_FROM_CORE' })] }, 'en')
    const headers = within(table()).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['Program', 'Language', 'Cycle', 'State', 'Last Exec', 'Health'])
    expect(within(table()).getByText('stale value')).toBeInTheDocument()
    expect(within(table()).getAllByText('Not read from Core').length).toBeGreaterThan(0)
    expect(table().textContent ?? '').not.toMatch(/[àáảãạăâđêôơư]/i)
  })
})

/* ------------------------------------------------------------------ *
 * `T60-208` — dưới 768 px: thẻ gọn thay bảng cuộn ngang               *
 * ------------------------------------------------------------------ */

describe('ProgramsSummaryTable — biến thể thẻ gọn cho màn hẹp (T60-208)', () => {
  it('mỗi Program là một thẻ mang ĐỦ sáu dữ kiện, mỗi giá trị có nhãn đi kèm', () => {
    renderTable()
    const cards = screen.getByTestId('programs-summary-cards')
    // Nhãn phải nằm cạnh giá trị: thẻ không có hàng header nên một ô không nhãn
    // là một con số không ai đọc được là số gì.
    for (const label of ['Ngôn ngữ', 'Chu kỳ', 'Trạng thái', 'Chạy gần nhất', 'Sức khoẻ']) {
      expect(within(cards).getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(within(cards).queryByText(/tác vụ|task/i)).not.toBeInTheDocument()
  })

  it('bảng và thẻ KHÔNG cùng hiển thị — trình đọc màn hình không đọc trùng', () => {
    renderTable()
    // jsdom không áp media query của Tailwind, nên kiểm bằng chính lớp điều
    // khiển hiển thị: thẻ `md:hidden`, bảng `hidden md:block`. Nếu ai gỡ một
    // trong hai lớp đó, nội dung sẽ nhân đôi ở mọi khổ màn hình.
    expect(screen.getByTestId('programs-summary-cards').className).toContain('md:hidden')
    const tableWrapper = table().parentElement
    expect(tableWrapper?.className).toContain('hidden')
    expect(tableWrapper?.className).toContain('md:block')
  })

  it('thẻ bấm được mở đúng PGM-02 kèm POU đã chọn, y như hàng bảng', () => {
    renderTable()
    const cards = screen.getByTestId('programs-summary-cards')
    const first = cards.querySelector('[data-program-card]')
    expect(first).not.toBeNull()
    fireEvent.click(first as Element)
    expect(screen.getByTestId('pgm02')).toHaveTextContent(`${PROJECT_ID}?program=${OBJECT_A}`)
  })

  it('thẻ mở được bằng BÀN PHÍM, không chỉ bằng chuột', () => {
    renderTable()
    const first = screen.getByTestId('programs-summary-cards').querySelector('[data-program-card]')
    fireEvent.keyDown(first as Element, { key: 'Enter' })
    expect(screen.getByTestId('pgm02')).toHaveTextContent(`${PROJECT_ID}?program=${OBJECT_A}`)
  })

  it('tên Program trong thẻ KHÔNG là nút riêng — cả thẻ mới là vùng bấm', () => {
    renderTable()
    // Hai điều khiển chồng nhau làm cùng một việc khiến trình đọc màn hình đọc
    // ra hai đích cho một mục. Bản bảng giữ nút; bản thẻ thì không.
    const cards = screen.getByTestId('programs-summary-cards')
    expect(within(cards).queryByRole('button', { name: 'AHU_Control' })).not.toBeInTheDocument()
    expect(within(cards).getByRole('button', { name: /Mở chương trình AHU_Control/ })).toBeInTheDocument()
  })

  it('không có Project thì thẻ không điều hướng đi đâu cả', () => {
    renderTable({}, 'vi', null)
    const cards = screen.getByTestId('programs-summary-cards')
    const first = cards.querySelector('[data-program-card]')
    fireEvent.click(first as Element)
    expect(screen.queryByTestId('pgm02')).not.toBeInTheDocument()
  })
})
