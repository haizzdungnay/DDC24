import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { CompareDrawer } from './CompareDrawer'
import type { CompareGate } from './compareModel'
import type { ProgrammingRevisionChanges, ProgrammingStHunk } from '../../model/types'

/**
 * Ba thứ được khoá ở đây, theo đúng thứ tự mức nguy hiểm:
 *
 * 1. Bấm một hunk KHÔNG được đổi POU đang mở trong trình soạn.
 * 2. "Máy chủ chưa so" không được trông giống "không có khác biệt".
 * 3. Cặp Revision ID luôn hiện, kể cả khi chưa so được.
 */

const impactGroup = { status: 'NONE' as const, items: [] }
const impact = {
  impactRef: 'ref', retain: impactGroup, activeOverrides: impactGroup, cutover: impactGroup,
  outputMappingChanges: impactGroup, publishedSignals: impactGroup, controlLibrary: impactGroup,
  programSet: impactGroup, enableIntent: impactGroup,
}

const hunk: ProgrammingStHunk = {
  objectId: 'obj-1', changeType: 'REPLACED',
  beforeStartLine: 3, beforeLineCount: 1, afterStartLine: 3, afterLineCount: 1,
  beforeText: ['Fan := TRUE;'], afterText: ['Fan := FALSE;'], truncated: false, coarse: false,
}

function changesView(patch: Partial<ProgrammingRevisionChanges> = {}): ProgrammingRevisionChanges {
  return {
    fromRevisionId: 'rev-active', toRevisionId: 'rev-sealed', impact, changes: [],
    stHunks: [hunk], fbdChanges: [], truncated: false, nextCursor: null, ...patch,
  }
}

const readyGate: CompareGate = { kind: 'READY', fromRevisionId: 'rev-active', toRevisionId: 'rev-sealed' }

function renderDrawer(overrides: Partial<Parameters<typeof CompareDrawer>[0]> = {}) {
  const props: Parameters<typeof CompareDrawer>[0] = {
    gate: readyGate,
    changes: changesView(),
    pouNameByObjectId: new Map([['obj-1', 'AHU_MAIN']]),
    loading: false,
    errorMessage: null,
    sealing: false,
    sealingErrorMessage: null,
    canSeal: true,
    loadingMore: false,
    loadMoreErrorMessage: null,
    onSeal: vi.fn(),
    onLoadMore: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<I18nProvider><CompareDrawer {...props} /></I18nProvider>)
  return props
}

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(cleanup)

describe('CompareDrawer — cặp Revision ID luôn hiện', () => {
  it('trạng thái chưa so được vẫn nói rõ đang định đối chiếu cái gì', () => {
    renderDrawer({ gate: { kind: 'MUST_SAVE', fromRevisionId: 'rev-active', toRevisionId: null }, changes: null })
    const pair = screen.getByTestId('compare-revision-pair')
    // Chưa biết thì là gạch ngang, không phải ID rút gọn hay ô trống.
    expect(within(pair).getByText('rev-active')).toBeInTheDocument()
    expect(within(pair).getAllByText('—').length).toBe(1)
    expect(screen.getByTestId('compare-must-save')).toBeInTheDocument()
  })

  it('sẵn sàng ⇒ hiện đủ hai ID nguyên vẹn', () => {
    renderDrawer()
    const pair = screen.getByTestId('compare-revision-pair')
    expect(within(pair).getByText('rev-active')).toBeInTheDocument()
    expect(within(pair).getByText('rev-sealed')).toBeInTheDocument()
  })
})

describe('CompareDrawer — bấm hunk không đụng vào POU đang mở', () => {
  it('mở chi tiết ở phía chỉ-đọc trong khay, KHÔNG gọi lệnh mở POU', () => {
    const onRevealInEditor = vi.fn()
    renderDrawer({ onRevealInEditor })

    fireEvent.click(screen.getByTestId('compare-entry'))

    const detail = screen.getByTestId('compare-detail')
    expect(within(detail).getByTestId('compare-detail-before')).toHaveTextContent('Fan := TRUE;')
    expect(within(detail).getByTestId('compare-detail-after')).toHaveTextContent('Fan := FALSE;')
    // Đây là luật: một cú nhảy ngầm sang editor sẽ vứt mất chỗ người dùng đang
    // gõ dở ở POU khác.
    expect(onRevealInEditor).not.toHaveBeenCalled()
  })

  it('chỉ nút có nhãn mới mở POU trong trình soạn', () => {
    const onRevealInEditor = vi.fn()
    renderDrawer({ onRevealInEditor })
    fireEvent.click(screen.getByTestId('compare-entry'))
    fireEvent.click(screen.getByRole('button', { name: /Mở POU này trong trình soạn/ }))
    expect(onRevealInEditor).toHaveBeenCalledTimes(1)
    expect(onRevealInEditor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ST', objectId: 'obj-1' }))
  })
})

describe('CompareDrawer — hai loại "trống" không được trông giống nhau', () => {
  it('máy chủ không gửi khoá diff ⇒ nói "chưa so", không nói "không có khác biệt"', () => {
    renderDrawer({ changes: changesView({ stHunks: undefined, fbdChanges: undefined }) })
    expect(screen.getByTestId('compare-unsupported')).toBeInTheDocument()
    expect(screen.queryByTestId('compare-empty')).toBeNull()
  })

  it('đã so và không có gì ⇒ nói thẳng là không có khác biệt', () => {
    renderDrawer({ changes: changesView({ stHunks: [], fbdChanges: [] }) })
    expect(screen.getByTestId('compare-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('compare-unsupported')).toBeNull()
  })

  it('không có Active ⇒ trạng thái rỗng CÓ LÝ DO, không phải "không có khác biệt"', () => {
    renderDrawer({ gate: { kind: 'NO_ACTIVE', fromRevisionId: null, toRevisionId: null }, changes: null })
    expect(screen.getByTestId('compare-no-active')).toBeInTheDocument()
    expect(screen.queryByTestId('compare-empty')).toBeNull()
  })
})

describe('CompareDrawer — fail-closed và vòng đời bàn phím', () => {
  it('từ chối response của cặp Revision cũ', () => {
    renderDrawer({ changes: changesView({ fromRevisionId: 'rev-old' }) })
    expect(screen.getByTestId('compare-error')).toHaveTextContent(/không khớp cặp Revision/)
    expect(screen.queryByTestId('compare-entry-list')).toBeNull()
  })

  it('Escape đóng khay; khay tự nhận focus khi mở', () => {
    const props = renderDrawer()
    const drawer = screen.getByTestId('compare-drawer')
    expect(drawer).toHaveFocus()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('lỗi niêm phong hiển thị và trạng thái trùng Revision không gọi diff', () => {
    renderDrawer({
      gate: { kind: 'MUST_SEAL', fromRevisionId: 'rev-active', toRevisionId: null },
      changes: null,
      sealingErrorMessage: 'Seal thất bại',
    })
    expect(screen.getByTestId('compare-seal-error')).toHaveTextContent('Seal thất bại')
    cleanup()
    renderDrawer({
      gate: { kind: 'SAME_REVISION', fromRevisionId: 'rev-active', toRevisionId: 'rev-active' },
      changes: null,
    })
    expect(screen.getByTestId('compare-same-revision')).toBeInTheDocument()
  })
})

describe('CompareDrawer — nói ra khi danh sách bị cắt và khi thay đổi nằm ngoài mã nguồn', () => {
  it('cắt ⇒ cảnh báo kèm nút đọc tiếp mang đúng cursor', () => {
    const props = renderDrawer({ changes: changesView({ truncated: true, nextCursor: '200' }) })
    expect(screen.getByTestId('compare-truncated')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Xem tiếp/ }))
    expect(props.onLoadMore).toHaveBeenCalledWith('200')
  })

  it('Revision chỉ đổi ánh xạ đầu ra vẫn phải liệt kê, không rơi vào "không có khác biệt"', () => {
    renderDrawer({
      changes: changesView({
        stHunks: [], fbdChanges: [],
        changes: [{ objectId: 'b-1', kind: 'BINDING', changeType: 'MODIFIED', category: 'OUTPUT_MAPPING', beforeSha256: null, afterSha256: null }],
      }),
    })
    const others = screen.getByTestId('compare-non-source')
    expect(within(others).getByText(/OUTPUT_MAPPING/)).toBeInTheDocument()
  })
})

describe('CompareDrawer — màu không bao giờ là tín hiệu duy nhất', () => {
  it('đổi vị trí trên sơ đồ có nhãn chữ riêng, không lẫn vào "đã sửa"', () => {
    renderDrawer({
      changes: changesView({
        stHunks: [],
        fbdChanges: [{ objectId: 'obj-2', element: 'NODE', elementId: '', changeType: 'GEOMETRY_ONLY', detail: 'layout' }],
      }),
      pouNameByObjectId: new Map(),
    })
    expect(screen.getByText(/Chỉ đổi vị trí trên sơ đồ \(không đổi hành vi\)/)).toBeInTheDocument()
  })

  it('đổi thứ tự thực thi cũng có nhãn riêng vì nó ĐỔI hành vi', () => {
    renderDrawer({
      changes: changesView({
        stHunks: [],
        fbdChanges: [{ objectId: 'obj-2', element: 'NODE', elementId: 'blk-1', changeType: 'ORDER_ONLY', detail: 'executionOrder' }],
      }),
      pouNameByObjectId: new Map(),
    })
    expect(screen.getByText(/Đổi thứ tự thực thi/)).toBeInTheDocument()
    // Tên tra không ra ⇒ hiện objectId kèm ghi chú, KHÔNG bịa một cái tên.
    expect(screen.getByText(/\(chưa tra được tên\)/)).toBeInTheDocument()
  })
})

describe('CompareDrawer — hunk bị cắt phải nói ra, số dòng giữ nguyên số thật', () => {
  it('thân đoạn bị cắt ⇒ cảnh báo, và số dòng vẫn là số thật', () => {
    renderDrawer({
      changes: changesView({
        stHunks: [{ ...hunk, afterLineCount: 120, afterText: ['a', 'b'], truncated: true }],
      }),
    })
    fireEvent.click(screen.getByTestId('compare-entry'))
    expect(screen.getByText(/Thân đoạn này đã bị cắt bớt/)).toBeInTheDocument()
    expect(screen.getByTestId('compare-detail-after')).toHaveTextContent('120 dòng')
  })
})

describe('CompareDrawer — lỗi đọc trang tiếp không được vứt phần đã tải', () => {
  it('hiện lỗi kèm đường thử lại, danh sách vẫn còn nguyên', () => {
    renderDrawer({
      changes: changesView({ truncated: true, nextCursor: '200' }),
      loadMoreErrorMessage: 'Mất kết nối tới thiết bị.',
    })
    /* Nếu lỗi này bị gộp vào `errorMessage`, cả danh sách lẫn nút thử lại đều
       biến mất — người dùng mất luôn phần đã đọc vì một lỗi thoáng qua. */
    expect(screen.getByTestId('compare-load-more-error')).toHaveTextContent('Mất kết nối')
    expect(screen.getAllByTestId('compare-entry')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeEnabled()
  })

  it('cắt nhưng chưa lỗi thì nút vẫn là "Xem tiếp"', () => {
    renderDrawer({ changes: changesView({ truncated: true, nextCursor: '200' }) })
    expect(screen.getByRole('button', { name: 'Xem tiếp' })).toBeEnabled()
    expect(screen.queryByTestId('compare-load-more-error')).toBeNull()
  })
})

describe('DEV-PROG-018 — tô dòng khác biệt trong khay So sánh', () => {
  it('mỗi phía chỉ vẽ dòng thuộc về nó, và dòng đổi có dấu + / − chứ không chỉ màu', () => {
    /* Vẽ dòng của phía kia sang phía này làm số dòng hiển thị lệch số dòng thật
       của tệp — mà số dòng thật mới là thứ người dùng dùng để mở đúng chỗ trong
       trình soạn thảo. Dấu `+`/`−` vì màu không bao giờ là tín hiệu duy nhất. */
    renderDrawer({
      changes: changesView({
        stHunks: [{
          objectId: 'obj-1', changeType: 'REPLACED',
          beforeStartLine: 10, beforeLineCount: 2, beforeText: ['A := 1;', 'CU := 2;'],
          afterStartLine: 10, afterLineCount: 2, afterText: ['A := 1;', 'MOI := 3;'],
          truncated: false, coarse: false,
        }],
      }),
    })
    fireEvent.click(screen.getByTestId('compare-entry'))

    const before = within(screen.getByTestId('compare-detail-before'))
    const after = within(screen.getByTestId('compare-detail-after'))
    expect(before.getByText(/CU := 2;/)).toBeInTheDocument()
    expect(before.queryByText(/MOI := 3;/)).toBeNull()
    expect(after.getByText(/MOI := 3;/)).toBeInTheDocument()
    expect(after.queryByText(/CU := 2;/)).toBeNull()
    expect(screen.getByText(/\+1 dòng thêm · −1 dòng bớt/)).toBeInTheDocument()
  })
})
