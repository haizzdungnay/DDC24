import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import {
  DraftActiveCompareCard,
  changeBreakdown,
  draftActiveRelation,
  serverChangeCount
} from './DraftActiveCompareCard'
import type { ProgrammingImpact } from '../api/generated/client'
import type { ProgrammingRevisionChange, ProgrammingRevisionChanges, RemoteState } from '../model/types'
import type { OverviewViewModel } from './overviewViewModel'

/**
 * `T60-203`. File này khoá năm thứ dễ trôi nhất của thẻ so sánh:
 *
 * 1. **Nhãn `Draft #14` / `Active #12`, không UUID** (`AC-PGM01-01`, D-05) — và
 *    thiếu `sequence` ra `—`, KHÔNG ra `#0`.
 * 2. **`AC-PGM01-02`: khác nhau thì CẢ HAI cùng hiện.**
 * 3. **`dirty = null` không bao giờ đọc thành “sạch”** ⇒ không được thu gọn.
 * 4. **Số thay đổi chỉ khi máy chủ trả.**
 * 5. **`Draft == Active` thu gọn** thành “Không có thay đổi chờ vận hành”.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ACTIVE_REVISION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DRAFT_REVISION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OBJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function draft(overrides: Partial<OverviewViewModel['draft']> = {}): OverviewViewModel['draft'] {
  return { label: 'Draft #14', sequence: 14, dirty: false, checkState: 'PASSED', ...overrides }
}

function active(overrides: Partial<OverviewViewModel['active']> = {}): OverviewViewModel['active'] {
  return { label: 'Active #12', sequence: 12, present: true, ownership: 'owned', taskState: 'RUNNING', ...overrides }
}

function core(overrides: Partial<OverviewViewModel['core']> = {}): OverviewViewModel['core'] {
  return { semantic: 'good', producerState: 'READY', observedAt: '2026-08-24T02:00:00Z', ...overrides }
}

function impactStub(): ProgrammingImpact {
  const none = { status: 'NONE' as const, items: [] }
  return {
    impactRef: 'impact-1',
    retain: none,
    activeOverrides: none,
    cutover: none,
    outputMappingChanges: none,
    publishedSignals: none,
    controlLibrary: none,
    programSet: none,
    enableIntent: none,
    // `ISS-PIO-29` — bốn nhóm tách theo nguồn Point.
    physicalMappingChanges: none, virtualPointChanges: none,
    modbusMappingChanges: none, writableOutputsAffected: none
  }
}

function changesBody(list: ProgrammingRevisionChange[]): ProgrammingRevisionChanges {
  return { fromRevisionId: ACTIVE_REVISION, toRevisionId: DRAFT_REVISION, impact: impactStub(), changes: list }
}

function remote(
  overrides: Partial<RemoteState<ProgrammingRevisionChanges>> = {}
): RemoteState<ProgrammingRevisionChanges> {
  return { status: 'ready', data: changesBody([]), error: null, refresh: vi.fn(), ...overrides }
}

function CommissionProbe() {
  const { projectId } = useParams<{ projectId: string }>()
  return <div data-testid="pgm05">{projectId}</div>
}

function renderCard(props: Partial<Parameters<typeof DraftActiveCompareCard>[0]> = {}, lang: 'vi' | 'en' = 'vi') {
  localStorage.setItem('mkddc-lang', lang)
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming']}>
        <Routes>
          <Route
            path="/eng/programming"
            element={
              <DraftActiveCompareCard
                draft={draft()}
                active={active()}
                core={core()}
                changes={remote()}
                projectId={PROJECT_ID}
                {...props}
              />
            }
          />
          <Route path="/eng/programming/projects/:projectId/commission" element={<CommissionProbe />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

afterEach(cleanup)

/* ------------------------------------------------------------------ *
 * Hàm thuần                                                           *
 * ------------------------------------------------------------------ */

describe('draftActiveRelation — không bao giờ thu gọn nhầm', () => {
  it('dirty = true là kết luận độc lập: KHÁC NHAU kể cả khi Core im', () => {
    expect(draftActiveRelation(draft({ dirty: true }), active(), core({ semantic: 'fault', producerState: null })))
      .toEqual({ relation: 'DIFFERENT', reason: 'DRAFT_DIRTY' })
  })

  it('Core chưa đọc được ⇒ UNKNOWN, không phải "không có thay đổi"', () => {
    expect(draftActiveRelation(draft(), active(), core({ semantic: 'unknown', producerState: null })))
      .toEqual({ relation: 'UNKNOWN', reason: 'RUNTIME_UNAVAILABLE' })
    expect(draftActiveRelation(draft(), active(), core({ semantic: 'fault', producerState: 'UNAVAILABLE' })))
      .toEqual({ relation: 'UNKNOWN', reason: 'RUNTIME_UNAVAILABLE' })
  })

  it('dirty = null KHÔNG được gộp vào false', () => {
    expect(draftActiveRelation(draft({ dirty: null }), active(), core()))
      .toEqual({ relation: 'UNKNOWN', reason: 'DIRTY_UNKNOWN' })
  })

  it('thiếu một sequence ⇒ UNKNOWN, không mượn số của Draft cho Active', () => {
    expect(draftActiveRelation(draft(), active({ label: null, sequence: null }), core()))
      .toEqual({ relation: 'UNKNOWN', reason: 'SEQUENCE_UNRESOLVED' })
    expect(draftActiveRelation(draft({ label: null, sequence: null }), active(), core()))
      .toEqual({ relation: 'UNKNOWN', reason: 'SEQUENCE_UNRESOLVED' })
  })

  it('Core nói chưa có Active ⇒ NO_ACTIVE, khác hẳn "trùng nhau"', () => {
    expect(draftActiveRelation(draft(), active({ present: false, ownership: 'not-commissioned', label: null, sequence: null }), core()))
      .toEqual({ relation: 'NO_ACTIVE', reason: 'NO_ACTIVE_REVISION' })
  })

  /**
   * `ISS-PGUI-01` — `present === false` KHÔNG đồng nghĩa "controller chưa đưa
   * gói nào vào vận hành".
   *
   * Trên production thiết bị ĐANG chạy `SOAK-10P-20260824-172521` trong khi
   * người dùng mở `AHU-MASTER-SEQUENCE` (`PC-001`). Câu "chưa đưa gói nào vào
   * vận hành" ở đây là một khẳng định sai về thiết bị, và nó được đọc ngay
   * trước lúc cân nhắc rollback.
   */
  it('gói đang chạy thuộc Project khác ⇒ lý do riêng, KHÔNG nói controller chưa vận hành', () => {
    const comparison = draftActiveRelation(
      draft(), active({ present: false, ownership: 'foreign', label: null, sequence: null }), core()
    )
    expect(comparison).toEqual({ relation: 'NO_ACTIVE', reason: 'ACTIVE_OTHER_PROJECT' })
    expect(comparison.reason).not.toBe('NO_ACTIVE_REVISION')
  })

  it('không quy được gói đang chạy về Project nào ⇒ UNKNOWN, không kết luận "chưa vận hành"', () => {
    expect(draftActiveRelation(
      draft(), active({ present: false, ownership: 'unresolved', label: null, sequence: null }), core()
    )).toEqual({ relation: 'UNKNOWN', reason: 'ACTIVE_PROJECT_UNRESOLVED' })
  })

  it('hai sequence bằng nhau và Draft sạch ⇒ SAME; khác nhau ⇒ DIFFERENT', () => {
    expect(draftActiveRelation(draft({ sequence: 12, label: 'Draft #12' }), active(), core()).relation).toBe('SAME')
    expect(draftActiveRelation(draft(), active(), core()).relation).toBe('DIFFERENT')
  })
})

describe('serverChangeCount — số chỉ đến từ máy chủ', () => {
  it('tầng gọi không hỏi ⇒ NOT_REQUESTED, không phải 0', () => {
    expect(serverChangeCount(null)).toEqual({ kind: 'NOT_REQUESTED' })
  })

  it('đọc hỏng ⇒ UNAVAILABLE, không phải 0', () => {
    expect(serverChangeCount(remote({ status: 'error', data: null, error: 'boom' }))).toEqual({ kind: 'UNAVAILABLE' })
  })

  it('thân phản hồi thiếu mảng changes ⇒ UNAVAILABLE, không phải 0', () => {
    const broken = { fromRevisionId: ACTIVE_REVISION, toRevisionId: DRAFT_REVISION, impact: impactStub() } as unknown as ProgrammingRevisionChanges
    expect(serverChangeCount(remote({ data: broken }))).toEqual({ kind: 'UNAVAILABLE' })
  })

  it('máy chủ trả mảng ⇒ đếm đúng số mục của chính mảng đó', () => {
    const list: ProgrammingRevisionChange[] = [
      { objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' },
      { objectId: OBJECT_ID, kind: 'BINDING', changeType: 'MODIFIED', category: 'IO' }
    ]
    expect(serverChangeCount(remote({ data: changesBody(list) }))).toEqual({ kind: 'COUNT', total: 2 })
  })
})

describe('changeBreakdown — tổng không bao giờ nhỏ hơn tổng máy chủ trả', () => {
  it('đếm theo loại thay đổi và theo kind', () => {
    const result = changeBreakdown([
      { objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' },
      { objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'MODIFIED', category: 'LOGIC' },
      { objectId: OBJECT_ID, kind: 'BINDING', changeType: 'REMOVED', category: 'IO' }
    ])
    expect(result.added).toBe(1)
    expect(result.modified).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.other).toBe(0)
    expect(result.byKind).toEqual([['BINDING', 1], ['PROGRAM', 2]])
  })

  it('changeType lạ vào cột "khác" thay vì bị bỏ im lặng', () => {
    const list = [{ objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'RENAMED', category: 'LOGIC' }] as unknown as ProgrammingRevisionChange[]
    const result = changeBreakdown(list)
    expect(result.other).toBe(1)
    expect(result.added + result.modified + result.removed + result.other).toBe(list.length)
  })
})

/* ------------------------------------------------------------------ *
 * Thẻ                                                                 *
 * ------------------------------------------------------------------ */

describe('DraftActiveCompareCard — nhãn theo D-05, không UUID', () => {
  it('AC-PGM01-02: Draft và Active cùng hiện khi khác nhau', () => {
    renderCard()
    expect(within(screen.getByTestId('draft-active-compare-draft')).getByText('Draft #14')).toBeInTheDocument()
    expect(within(screen.getByTestId('draft-active-compare-active')).getByText('Active #12')).toBeInTheDocument()
  })

  it('AC-PGM01-01: không có chuỗi UUID nào ở mặt trước', () => {
    const { container } = renderCard({
      changes: remote({ data: changesBody([{ objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' }]) })
    })
    expect(container.textContent ?? '').not.toMatch(UUID_PATTERN)
  })

  it('sequence chưa phân giải được ⇒ "—" kèm lý do, TUYỆT ĐỐI không "#0"', () => {
    renderCard({ active: active({ label: null, sequence: null }) })
    const column = screen.getByTestId('draft-active-compare-active')
    expect(within(column).getByText('Chưa phân giải được số hiệu bản đang vận hành')).toBeInTheDocument()
    expect(column.textContent ?? '').not.toContain('#0')
    expect(within(column).queryByText('Active #0')).not.toBeInTheDocument()
  })

  it('Core chưa đọc được ⇒ trạng thái Active là "Chưa rõ", không phải "Đã dừng"', () => {
    renderCard({
      core: core({ semantic: 'fault', producerState: null }),
      active: active({ taskState: null, present: false, label: null, sequence: null })
    })
    const column = screen.getByTestId('draft-active-compare-active')
    expect(within(column).getByText('Chưa rõ')).toBeInTheDocument()
    expect(within(column).queryByText('Đã dừng')).not.toBeInTheDocument()
    expect(within(column).getByText('Chưa đọc được từ Core.')).toBeInTheDocument()
  })
})

describe('DraftActiveCompareCard — dirty = null không bao giờ là "sạch"', () => {
  it('không thu gọn, và nói rõ máy chủ chưa xác định được', () => {
    renderCard({ draft: draft({ dirty: null, sequence: 12, label: 'Draft #12' }) })
    expect(screen.queryByTestId('draft-active-compare-collapsed')).not.toBeInTheDocument()
    expect(screen.getByTestId('draft-active-compare-relation')).toHaveTextContent(
      'Máy chủ chưa xác định được bản nháp còn việc chưa phát hành hay không.'
    )
    expect(within(screen.getByTestId('draft-active-compare-draft')).getByText('Chưa rõ')).toBeInTheDocument()
  })

  it('cùng số hiệu nhưng dirty = true thì VẪN mở, không thu gọn', () => {
    renderCard({ draft: draft({ dirty: true, sequence: 12, label: 'Draft #12' }) })
    expect(screen.queryByTestId('draft-active-compare-collapsed')).not.toBeInTheDocument()
    expect(screen.getByTestId('draft-active-compare-relation')).toHaveTextContent(/chưa phát hành/)
  })
})

describe('DraftActiveCompareCard — Draft == Active thu gọn', () => {
  it('thu gọn thành "Không có thay đổi chờ vận hành" và bỏ nút So sánh', () => {
    renderCard({ draft: draft({ dirty: false, sequence: 12, label: 'Draft #12' }) })
    const collapsed = screen.getByTestId('draft-active-compare-collapsed')
    expect(within(collapsed).getByText('Không có thay đổi chờ vận hành')).toBeInTheDocument()
    expect(collapsed).toHaveTextContent('Draft #12 trùng đúng Active #12.')
    expect(screen.queryByRole('button', { name: 'So sánh' })).not.toBeInTheDocument()
  })
})

describe('DraftActiveCompareCard — số thay đổi CHỈ khi máy chủ trả', () => {
  it('không hỏi ⇒ không có con số nào, nút So sánh vô hiệu kèm lý do', () => {
    renderCard({ changes: null })
    const line = screen.getByTestId('draft-active-compare-count')
    expect(line).toHaveTextContent('Máy chủ chưa cung cấp bảng thay đổi cho cặp bản này.')
    expect(line.textContent ?? '').not.toMatch(/\d/)
    expect(screen.getByRole('button', { name: 'So sánh' })).toBeDisabled()
  })

  it('đang đọc ⇒ nói đang đọc, không hiện số', () => {
    renderCard({ changes: remote({ status: 'loading', data: null }) })
    const line = screen.getByTestId('draft-active-compare-count')
    expect(line).toHaveTextContent('Đang đọc bảng thay đổi từ máy chủ…')
    expect(line.textContent ?? '').not.toMatch(/\d/)
  })

  it('đọc hỏng ⇒ nói không đọc được, KHÔNG hiện 0', () => {
    renderCard({ changes: remote({ status: 'error', data: null, error: 'boom' }) })
    const line = screen.getByTestId('draft-active-compare-count')
    expect(line).toHaveTextContent('Chưa đọc được bảng thay đổi — không có số thay đổi nào để hiển thị.')
    expect(line.textContent ?? '').not.toMatch(/\b0\b/)
  })

  it('máy chủ trả bảng ⇒ hiện đúng số mục của bảng đó', () => {
    renderCard({
      changes: remote({ data: changesBody([
        { objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' },
        { objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'MODIFIED', category: 'LOGIC' },
        { objectId: OBJECT_ID, kind: 'BINDING', changeType: 'REMOVED', category: 'IO' }
      ]) })
    })
    expect(screen.getByTestId('draft-active-compare-count')).toHaveTextContent('Máy chủ liệt kê 3 thay đổi.')
  })

  it('máy chủ trả mảng rỗng ⇒ câu chữ, không phải con số 0 trần trụi', () => {
    renderCard()
    expect(screen.getByTestId('draft-active-compare-count')).toHaveTextContent('Máy chủ không liệt kê thay đổi nào.')
  })
})

describe('DraftActiveCompareCard — drawer So sánh', () => {
  function openDrawer() {
    renderCard({
      changes: remote({ data: changesBody([
        { objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' },
        { objectId: OBJECT_ID, kind: 'BINDING', changeType: 'MODIFIED', category: 'IO' }
      ]) })
    })
    const button = screen.getByRole('button', { name: 'So sánh' })
    fireEvent.click(button)
    return button
  }

  it('mở drawer và nêu đúng hai nhãn, không UUID', () => {
    openDrawer()
    const drawer = screen.getByTestId('programming-compare-drawer')
    expect(drawer).toHaveTextContent('Active #12 → Draft #14')
    expect(drawer.textContent ?? '').not.toMatch(UUID_PATTERN)
  })

  it('drawer nêu phân loại thay đổi do máy chủ trả', () => {
    openDrawer()
    const types = screen.getByTestId('programming-compare-drawer-types')
    expect(types).toHaveTextContent('Thêm mới')
    expect(types).toHaveTextContent('Sửa')
    const kinds = screen.getByTestId('programming-compare-drawer-kinds')
    expect(kinds).toHaveTextContent('BINDING: 1')
    expect(kinds).toHaveTextContent('PROGRAM: 1')
  })

  it('Esc đóng drawer và trả tiêu điểm về nút So sánh', () => {
    const button = openDrawer()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('programming-compare-drawer')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(button)
  })

  it('bấm ra ngoài đóng drawer mà KHÔNG giật tiêu điểm về nút', () => {
    const button = openDrawer()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('programming-compare-drawer')).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(button)
  })

  it('nút mở PGM-05 điều hướng đúng Project', () => {
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Mở Kiểm tra & Vận hành' }))
    expect(screen.getByTestId('pgm05')).toHaveTextContent(PROJECT_ID)
  })

  it('chưa có Project ⇒ nút mở PGM-05 vô hiệu hoá KÈM LÝ DO, không bịa đích', () => {
    renderCard({
      projectId: null,
      changes: remote({ data: changesBody([{ objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' }]) })
    })
    fireEvent.click(screen.getByRole('button', { name: 'So sánh' }))
    expect(screen.getByRole('button', { name: 'Mở Kiểm tra & Vận hành' })).toBeDisabled()
    expect(screen.getByTestId('programming-compare-drawer'))
      .toHaveTextContent('Cần chọn Project trước khi mở Kiểm tra & Vận hành.')
  })
})

describe('DraftActiveCompareCard — không thêm CTA chính (AC-PGM01-05)', () => {
  it('nút So sánh và nút mở PGM-05 đều là hành động phụ', () => {
    renderCard({
      changes: remote({ data: changesBody([{ objectId: OBJECT_ID, kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' }]) })
    })
    const compare = screen.getByRole('button', { name: 'So sánh' })
    // `variant="primary"` của `Button` là lớp nền accent; hành động phụ dùng nền
    // `--c-surface-2`. Kiểm bằng lớp vì jsdom không tính CSS.
    expect(compare.className).toContain('bg-[var(--c-surface-2)]')
    expect(compare.className).not.toContain('bg-[var(--c-accent)]')
    fireEvent.click(compare)
    const openCommission = screen.getByRole('button', { name: 'Mở Kiểm tra & Vận hành' })
    expect(openCommission.className).toContain('bg-[var(--c-surface-2)]')
    expect(openCommission.className).not.toContain('bg-[var(--c-accent)]')
  })
})

describe('DraftActiveCompareCard — D-06 một ngôn ngữ tại một thời điểm', () => {
  it('chế độ EN không rò tiếng Việt cứng', () => {
    const { container } = renderCard({}, 'en')
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/bản nháp|đang vận hành|thay đổi/i)
  })
})
