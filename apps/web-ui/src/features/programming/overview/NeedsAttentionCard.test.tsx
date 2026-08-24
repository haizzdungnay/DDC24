import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { NeedsAttentionCard, attentionRoute, buildAttentionItems } from './NeedsAttentionCard'
import type { OverviewProgramRow, OverviewViewModel, ProgramsSummaryModel } from './overviewViewModel'

/**
 * `T60-204`. File này khoá bốn thứ:
 *
 * 1. **`AC-PGM01-03`: mỗi mục deep-link tới ĐÚNG trang chủ quản** — không còn
 *    đích cứng `/eng/programming/runtime` cho mọi mã.
 * 2. **Sắp `fault → warning → info`.**
 * 3. **“Xem tất cả (n)”** khi danh sách dài hơn phần xem trước.
 * 4. **Không kết luận “không có việc cần chú ý” khi còn đang đọc**, và không
 *    lộ UUID ở mặt trước (`AC-PGM01-01`).
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OBJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PROGRAM_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const pickVi = (vi: string) => vi

function row(overrides: Partial<OverviewProgramRow> = {}): OverviewProgramRow {
  return {
    key: OBJECT_ID,
    programId: PROGRAM_ID,
    objectId: OBJECT_ID,
    name: 'AHU_Control',
    language: 'ST',
    cycle: { periodMs: 1000, source: 'CORE_LIVE' },
    runtimeState: 'RUNNING',
    runtimeStateSource: 'CORE_LIVE',
    lastRun: { atUtc: '2026-08-24T02:00:00Z', ageMs: 400 },
    health: 'HEALTHY',
    healthMissingReason: null,
    origin: 'DECLARED_AND_LIVE',
    ...overrides
  }
}

function programs(overrides: Partial<ProgramsSummaryModel> = {}): ProgramsSummaryModel {
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

function vm(overrides: Partial<OverviewViewModel> = {}): OverviewViewModel {
  return {
    projectId: PROJECT_ID,
    projectName: 'AHU-01',
    draft: { label: 'Draft #14', sequence: 14, dirty: false, checkState: 'PASSED' },
    active: { label: 'Active #12', sequence: 12, present: true, taskState: 'RUNNING' },
    core: { semantic: 'good', producerState: 'READY', observedAt: '2026-08-24T02:00:00Z' },
    safeState: { active: false, noControllerOnly: false },
    programs: programs(),
    primaryCta: { kind: 'OPEN_RUNTIME', row: 5, undecidedReason: null, route: '/eng/programming/runtime' },
    ...overrides
  }
}

/** Hiện đường dẫn + query của trang đã mở, để khẳng định đích deep-link. */
function RouteProbe({ name }: { name: string }) {
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  return <div data-testid="opened">{`${name}:${projectId ?? '-'}${location.search}`}</div>
}

function renderCard(model: OverviewViewModel, taskId: string | null = 'Control_Main', lang: 'vi' | 'en' = 'vi') {
  localStorage.setItem('mkddc-lang', lang)
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming']}>
        <Routes>
          <Route path="/eng/programming" element={<NeedsAttentionCard vm={model} taskId={taskId} />} />
          <Route path="/eng/programming/runtime" element={<RouteProbe name="runtime" />} />
          <Route path="/eng/programming/projects/:projectId/programs" element={<RouteProbe name="programs" />} />
          <Route path="/eng/programming/projects/:projectId/mapping" element={<RouteProbe name="mapping" />} />
          <Route path="/eng/programming/projects/:projectId/commission" element={<RouteProbe name="commission" />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

afterEach(cleanup)

/* ------------------------------------------------------------------ *
 * Hàm thuần                                                           *
 * ------------------------------------------------------------------ */

describe('attentionRoute — bốn trang chủ quản', () => {
  it('Runtime không phụ thuộc Project', () => {
    expect(attentionRoute('runtime', null)).toBe('/eng/programming/runtime')
  })

  it('ba trang còn lại cần Project; thiếu Project ⇒ null, không bịa đích', () => {
    expect(attentionRoute('programs', PROJECT_ID)).toBe(`/eng/programming/projects/${PROJECT_ID}/programs`)
    expect(attentionRoute('mapping', PROJECT_ID)).toBe(`/eng/programming/projects/${PROJECT_ID}/mapping`)
    expect(attentionRoute('commission', PROJECT_ID)).toBe(`/eng/programming/projects/${PROJECT_ID}/commission`)
    expect(attentionRoute('programs', null)).toBeNull()
    expect(attentionRoute('mapping', null)).toBeNull()
    expect(attentionRoute('commission', null)).toBeNull()
  })
})

describe('buildAttentionItems — sắp fault → warning → info', () => {
  it('mọi mục fault đứng trước warning, mọi warning đứng trước info', () => {
    const items = buildAttentionItems(pickVi, {
      vm: vm({
        core: { semantic: 'good', producerState: 'READY', observedAt: null },
        active: { label: 'Active #12', sequence: 12, present: true, taskState: 'FAULT' },
        safeState: { active: true, noControllerOnly: true },
        draft: { label: 'Draft #14', sequence: 14, dirty: true, checkState: 'FAILED' },
        programs: programs({ truncated: true })
      }),
      taskId: 'Control_Main'
    })
    const severities = items.map((item) => item.severity)
    expect(severities).toEqual([...severities].sort((left, right) =>
      ({ fault: 0, warning: 1, info: 2 })[left] - ({ fault: 0, warning: 1, info: 2 })[right]))
    expect(severities).toContain('fault')
    expect(severities).toContain('warning')
    expect(severities).toContain('info')
  })

  it('đang tải (core UNKNOWN) KHÔNG sinh mục "không kết nối được Core"', () => {
    const items = buildAttentionItems(pickVi, {
      vm: vm({ core: { semantic: 'unknown', producerState: null, observedAt: null } }),
      taskId: null
    })
    expect(items.map((item) => item.code)).not.toContain('PRG-CORE-UNAVAILABLE')
  })

  it('safe-state "chưa ai điều khiển" thuộc Điểm & Ánh xạ, safe-state lỗi thật thuộc Runtime', () => {
    const light = buildAttentionItems(pickVi, {
      vm: vm({ safeState: { active: true, noControllerOnly: true } }),
      taskId: 'Control_Main'
    }).find((item) => item.code === 'PRG-SAFE-ACTIVE')
    expect(light?.owner).toBe('mapping')
    expect(light?.severity).toBe('warning')

    const real = buildAttentionItems(pickVi, {
      vm: vm({ safeState: { active: true, noControllerOnly: false } }),
      taskId: 'Control_Main'
    }).find((item) => item.code === 'PRG-SAFE-ACTIVE')
    expect(real?.owner).toBe('runtime')
    expect(real?.severity).toBe('fault')
  })

  it('không có taskId ⇒ câu thay thế, KHÔNG bịa tên Control_Main', () => {
    const item = buildAttentionItems(pickVi, {
      vm: vm({ safeState: { active: true, noControllerOnly: false } }),
      taskId: null
    }).find((entry) => entry.code === 'PRG-SAFE-ACTIVE')
    expect(item?.entity).toBe('Các output do Program điều khiển (chưa có danh sách Point)')
  })

  it('dòng chưa đọc được từ Core (UNAVAILABLE) không sinh cảnh báo nào', () => {
    const items = buildAttentionItems(pickVi, {
      vm: vm({ programs: programs({ rows: [row({ runtimeState: 'FAULTED', runtimeStateSource: 'UNAVAILABLE', health: null })] }) }),
      taskId: null
    })
    expect(items.map((item) => item.code)).not.toContain('PRG-PROGRAM-FAULTED')
  })

  it('trạng thái FAULTED đọc từ lần trước hạ xuống warning và nói rõ là giá trị cũ', () => {
    const item = buildAttentionItems(pickVi, {
      vm: vm({ programs: programs({ rows: [row({ runtimeState: 'FAULTED', runtimeStateSource: 'LAST_KNOWN', health: null })] }) }),
      taskId: null
    }).find((entry) => entry.code === 'PRG-PROGRAM-FAULTED')
    expect(item?.severity).toBe('warning')
    expect(item?.message).toMatch(/giá trị cũ/)
  })

  it('Program Core chạy mà gói không khai gộp thành MỘT mục thuộc Kiểm tra & Vận hành', () => {
    const items = buildAttentionItems(pickVi, {
      vm: vm({ programs: programs({ rows: [
        row({ key: 'live:1', name: null, objectId: null, origin: 'LIVE_ONLY' }),
        row({ key: 'live:2', name: null, objectId: null, origin: 'LIVE_ONLY' })
      ] }) }),
      taskId: null
    }).filter((item) => item.code === 'PRG-PROGRAM-NOT-DECLARED')
    expect(items).toHaveLength(1)
    expect(items[0].owner).toBe('commission')
    expect(items[0].message).toContain('2 chương trình')
  })

  it('thiếu Project ⇒ mục vẫn có nhưng không có đích, kèm lý do', () => {
    const item = buildAttentionItems(pickVi, {
      vm: vm({ projectId: null, draft: { label: 'Draft #14', sequence: 14, dirty: false, checkState: 'FAILED' } }),
      taskId: null
    }).find((entry) => entry.code === 'PRG-CHECK-FAILED')
    expect(item?.route).toBeNull()
    expect(item?.routeBlockedReason).toBe('Cần chọn Project trước khi mở Kiểm tra & Vận hành')
  })

  it('không có gì bất thường ⇒ danh sách rỗng', () => {
    expect(buildAttentionItems(pickVi, { vm: vm(), taskId: 'Control_Main' })).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * AC-PGM01-03 — deep-link tới đúng trang chủ quản                     *
 * ------------------------------------------------------------------ */

describe('NeedsAttentionCard — deep-link ĐÚNG trang chủ quản (AC-PGM01-03)', () => {
  it('cảnh báo ánh xạ mở Điểm & Ánh xạ, KHÔNG ném sang Runtime', () => {
    renderCard(vm({ safeState: { active: true, noControllerOnly: true } }))
    fireEvent.click(screen.getByRole('button', { name: /PRG-SAFE-ACTIVE/ }))
    expect(screen.getByTestId('opened')).toHaveTextContent(`mapping:${PROJECT_ID}`)
  })

  it('safe-state do lỗi thật vẫn mở Runtime', () => {
    renderCard(vm({ safeState: { active: true, noControllerOnly: false } }))
    fireEvent.click(screen.getByRole('button', { name: /PRG-SAFE-ACTIVE/ }))
    expect(screen.getByTestId('opened')).toHaveTextContent('runtime:-')
  })

  it('Kiểm tra không đạt mở Kiểm tra & Vận hành', () => {
    renderCard(vm({ draft: { label: 'Draft #14', sequence: 14, dirty: false, checkState: 'FAILED' } }))
    fireEvent.click(screen.getByRole('button', { name: /PRG-CHECK-FAILED/ }))
    expect(screen.getByTestId('opened')).toHaveTextContent(`commission:${PROJECT_ID}`)
  })

  it('Program lỗi mở PGM-02 KÈM POU đã chọn', () => {
    renderCard(vm({ programs: programs({ rows: [row({ runtimeState: 'FAULTED', health: 'FAULT' })] }) }))
    fireEvent.click(screen.getByRole('button', { name: /PRG-PROGRAM-FAULTED/ }))
    expect(screen.getByTestId('opened')).toHaveTextContent(`programs:${PROJECT_ID}?program=${OBJECT_ID}`)
  })

  it('Core không kết nối mở Runtime', () => {
    renderCard(vm({ core: { semantic: 'fault', producerState: 'UNAVAILABLE', observedAt: null } }))
    fireEvent.click(screen.getByRole('button', { name: /PRG-CORE-UNAVAILABLE/ }))
    expect(screen.getByTestId('opened')).toHaveTextContent('runtime:-')
  })

  it('bốn mã cùng lúc mang bốn trang chủ quản khác nhau — không còn đích cứng', () => {
    renderCard(vm({
      core: { semantic: 'good', producerState: 'READY', observedAt: null },
      safeState: { active: true, noControllerOnly: true },
      draft: { label: 'Draft #14', sequence: 14, dirty: true, checkState: 'FAILED' },
      programs: programs({ truncated: true, rows: [row({ runtimeState: 'FAULTED', health: 'FAULT' })] })
    }))
    fireEvent.click(screen.getByTestId('attention-show-all'))
    const owners = screen.getAllByRole('button')
      .map((node) => node.getAttribute('data-attention-owner'))
      .filter((value): value is string => value !== null)
    expect(new Set(owners)).toEqual(new Set(['programs', 'mapping', 'commission', 'runtime']))
  })
})

/* ------------------------------------------------------------------ *
 * Hiển thị                                                            *
 * ------------------------------------------------------------------ */

describe('NeedsAttentionCard — hiển thị', () => {
  it('mức độ có CHỮ, không chỉ màu và icon', () => {
    renderCard(vm({ safeState: { active: true, noControllerOnly: false } }))
    expect(screen.getByRole('button', { name: /PRG-SAFE-ACTIVE/ })).toHaveTextContent('Lỗi')
  })

  it('mỗi mục nêu thực thể và hành động', () => {
    renderCard(vm({ safeState: { active: true, noControllerOnly: false } }))
    const item = screen.getByRole('button', { name: /PRG-SAFE-ACTIVE/ })
    expect(item).toHaveTextContent('Thực thể: Control_Main / các output do Program điều khiển')
    expect(item).toHaveTextContent('Hành động: Giữ Commission/Restore bị khóa')
  })

  it('"Xem tất cả (n)" chỉ hiện khi dài hơn phần xem trước và mở hết danh sách', () => {
    const model = vm({
      core: { semantic: 'good', producerState: 'READY', observedAt: null },
      active: { label: 'Active #12', sequence: 12, present: true, taskState: 'FAULT' },
      safeState: { active: true, noControllerOnly: false },
      draft: { label: 'Draft #14', sequence: 14, dirty: true, checkState: 'FAILED' },
      programs: programs({ truncated: true, rows: [row({ runtimeState: 'FAULTED', health: 'FAULT' })] })
    })
    const total = buildAttentionItems(pickVi, { vm: model, taskId: 'Control_Main' }).length
    expect(total).toBeGreaterThan(3)
    renderCard(model)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    const showAll = screen.getByTestId('attention-show-all')
    expect(showAll).toHaveTextContent(`Xem tất cả (${total})`)
    expect(showAll).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(showAll)
    expect(screen.getAllByRole('listitem')).toHaveLength(total)
    expect(showAll).toHaveTextContent('Thu gọn')
  })

  it('danh sách ngắn KHÔNG hiện nút "Xem tất cả"', () => {
    renderCard(vm({ safeState: { active: true, noControllerOnly: false } }))
    expect(screen.queryByTestId('attention-show-all')).not.toBeInTheDocument()
  })

  it('còn đang đọc thì KHÔNG khẳng định "không có việc cần chú ý"', () => {
    renderCard(vm({ core: { semantic: 'unknown', producerState: null, observedAt: null } }))
    expect(screen.getByText('Đang đọc trạng thái — chưa kết luận được có việc cần chú ý hay không.')).toBeInTheDocument()
    expect(screen.queryByText('Không có việc cần chú ý.')).not.toBeInTheDocument()
  })

  it('đọc xong và thật sự sạch thì mới nói "không có việc cần chú ý"', () => {
    renderCard(vm())
    expect(screen.getByText('Không có việc cần chú ý.')).toBeInTheDocument()
  })

  it('thiếu Project ⇒ mục không bấm được nhưng vẫn hiện kèm lý do', () => {
    renderCard(vm({ projectId: null, draft: { label: 'Draft #14', sequence: 14, dirty: false, checkState: 'FAILED' } }))
    expect(screen.queryByRole('button', { name: /PRG-CHECK-FAILED/ })).not.toBeInTheDocument()
    expect(screen.getByText('Cần chọn Project trước khi mở Kiểm tra & Vận hành')).toBeInTheDocument()
  })

  it('AC-PGM01-01: không có chuỗi UUID nào ở mặt trước', () => {
    const { container } = renderCard(vm({
      safeState: { active: true, noControllerOnly: true },
      programs: programs({ rows: [
        row({ runtimeState: 'FAULTED', health: 'FAULT' }),
        row({ key: 'live:1', name: null, objectId: null, origin: 'LIVE_ONLY' })
      ] })
    }))
    expect(container.textContent ?? '').not.toMatch(UUID_PATTERN)
  })

  it('D-06: chế độ EN không rò tiếng Việt cứng', () => {
    const { container } = renderCard(vm({ safeState: { active: true, noControllerOnly: true } }), 'Control_Main', 'en')
    expect(screen.getByText('Attention required')).toBeInTheDocument()
    expect(container.textContent ?? '').toMatch(/Program-controlled outputs/)
    expect(container.textContent ?? '').not.toMatch(/các output do Program điều khiển|Cảnh báo|Thực thể/)
  })
})
