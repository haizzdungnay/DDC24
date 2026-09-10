import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingLibraryEntry } from '../../model/types'
import type { ProgrammingLibraryPagedState } from '../../api/queries'
import { type CatalogEntry } from './libraryCatalog'
import { stCallStatement } from '../editor/stInstanceInsertion'
import { QuickLibraryPanel } from './QuickLibraryPanel'

const preferences = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('../../../../shared/api/client', () => ({
  apiClient: {
    getMyPreferences: preferences.get,
    putMyPreferences: preferences.put
  }
}))

/**
 * `DEV-PROG-002` — mỗi mục nay là một THẺ (`quick-library-card`) mang tên, sơ đồ
 * chân và lý do bị chặn. Bám vào thẻ thay vì vào nút "Chèn" là bám đúng vùng mà
 * người dùng đọc, và không vỡ khi nút bị `disabled`.
 */
function cardFor(entryId: string): HTMLElement {
  const card = document.querySelector(`[data-testid="quick-library-card"][data-entry="${entryId}"]`)
  if (!(card instanceof HTMLElement)) throw new Error(`không thấy thẻ khối ${entryId}`)
  return card
}

function libraryItems(): ProgrammingLibraryEntry[] {
  return [
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT', featureState: 'AVAILABLE',
        contentSha256: 'a'.repeat(64),
        signature: {
          dispatch: 'FB_TYPE', polymorphic: false, typedPortNames: [],
          category: 'math', labelVi: 'Giới hạn', labelEn: 'Limit', allowedTypes: ['REAL'],
          ports: [
            { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
            { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
            { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
            { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
          ]
        },
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0
      },
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'PID', kind: 'FUNCTION_BLOCK', name: 'PID', featureState: 'REVIEW_REQUIRED',
        contentSha256: 'b'.repeat(64),
        signature: {
          dispatch: 'FB_TYPE', polymorphic: false, typedPortNames: [],
          category: 'control', labelVi: 'PID', labelEn: 'PID', allowedTypes: [],
          ports: [{ name: 'PV', direction: 'INPUT', dataType: 'REAL' }, { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }]
        },
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 64
      },
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'AND', kind: 'FUNCTION', name: 'AND', featureState: 'AVAILABLE',
        contentSha256: 'c'.repeat(64),
        signature: {
          dispatch: 'OPERATOR', polymorphic: false, typedPortNames: [],
          category: 'logic', labelVi: 'VÀ', labelEn: 'AND', allowedTypes: ['BOOL'],
          ports: [
            { name: 'IN1', direction: 'INPUT', dataType: 'BOOL' },
            { name: 'IN2', direction: 'INPUT', dataType: 'BOOL' },
            { name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }
          ]
        },
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0
      }
  ]
}

/**
 * `T61-202` — panel nay nhận TRẠNG THÁI PHÂN TRANG dùng chung với PGM-04, chứ
 * không phải một `RemoteState` bọc đúng một trang. Helper này khai đủ mặc định
 * để mỗi test chỉ ghi đè phần nó thật sự đang nói về.
 */
function paged(overrides: Partial<ProgrammingLibraryPagedState> = {}): ProgrammingLibraryPagedState {
  return {
    status: 'ready',
    items: libraryItems(),
    error: null,
    failure: null,
    loadMoreError: null,
    loadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

function ready(): ProgrammingLibraryPagedState {
  return paged()
}

function renderPanel(state: ProgrammingLibraryPagedState = ready()) {
  const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(true)
  render(
    <I18nProvider>
      <QuickLibraryPanel library={state} language="ST" onInsert={onInsert} onClose={vi.fn()} />
    </I18nProvider>
  )
  return { onInsert }
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  preferences.get.mockReset().mockResolvedValue({})
  preferences.put.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('PGM-02 Quick Library (T59-804)', () => {
  it('AC-ST-001 / AC-FBD-002: chèn FUNCTION bằng đúng lời gọi có tham số của catalog', async () => {
    const { onInsert } = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Chèn LIMIT' }))
    // Panel trả về ĐÚNG mục catalog; dựng đoạn mã là việc của bề mặt ST.
    const entry = onInsert.mock.calls[0][0]
    expect(entry.entryId).toBe('LIMIT')
    expect(stCallStatement(entry)).toBe('OUT := LIMIT(MN, IN, MX);')
  })

  it('AC-FBD-002: mục chờ review hiện ra nhưng không bấm được, kèm lý do', async () => {
    const { onInsert } = renderPanel()
    const pid = await screen.findByRole('button', { name: 'Chèn PID' })
    expect(pid).toBeDisabled()
    // `DEV-PROG-002` — lý do nay nằm trong THẺ khối chứ không trong chính nút:
    // nút đã bị `disabled` nên chữ bên trong nó không đọc được bằng con trỏ, và
    // thẻ mới còn phải chứa sơ đồ chân. Điều cần khẳng định không đổi: lý do
    // hiển thị ngay cạnh mục, không phải chỉ trong `title`.
    expect(within(cardFor('PID')).getByText('Chờ review sản phẩm')).toBeInTheDocument()
    fireEvent.click(pid)
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('Recent chỉ ghi SAU khi chèn thành công', async () => {
    const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(false)
    render(
      <I18nProvider>
        <QuickLibraryPanel library={ready()} language="ST" onInsert={onInsert} onClose={vi.fn()} />
      </I18nProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Chèn LIMIT' }))
    await waitFor(() => expect(onInsert).toHaveBeenCalled())
    expect(preferences.put).not.toHaveBeenCalled()
  })

  it('Favorites đẩy lên thiết bị bằng MERGE, không xoá khung nhìn của người dùng', async () => {
    preferences.get.mockResolvedValue({ views: { monitor: [{ name: 'Ca đêm', params: {} }] } })
    renderPanel()
    fireEvent.click(await screen.findByTitle('Yêu thích LIMIT'))
    await waitFor(() => expect(preferences.put).toHaveBeenCalled())
    const calls = preferences.put.mock.calls
    const payload = calls[calls.length - 1][0] as Record<string, unknown>
    /* `T61-203` — khoá là ĐỊNH DANH `scope/entryId`, không phải `entryId` trần.
       `entryId` trần trỏ vào bất kỳ version nào của khối; sau lần publish kế
       tiếp nó có thể trỏ vào một revision đã DEPRECATED. */
    expect(payload.programmingLibrary).toEqual({ favorites: ['SYSTEM/LIMIT'], recent: [] })
    // `views` phải còn nguyên: túi tuỳ chọn dùng chung, PUT toàn bộ sẽ xoá
    // khung nhìn Monitor chỉ vì người dùng vừa bấm một ngôi sao.
    expect(payload.views).toEqual({ monitor: [{ name: 'Ca đêm', params: {} }] })
  })

  it('không đọc được tuỳ chọn thì nói ra thay vì im lặng dùng bản cũ', async () => {
    preferences.get.mockRejectedValue(new Error('offline'))
    renderPanel()
    expect(await screen.findByText(/chỉ nằm trên trình duyệt này/)).toBeInTheDocument()
  })

  it('AC-FBD-002: catalog lỗi thì báo lỗi, không hiện danh sách rỗng như thể không có block', async () => {
    renderPanel(paged({ status: 'error', items: [], error: 'PRG-ERR-UNAVAILABLE-001', failure: 'error' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PRG-ERR-UNAVAILABLE-001')
  })

  it('TC-FBD-LIB-001: khoá hành vi khối PID REVIEW_REQUIRED (draggable false, disabled) và cho phép khối AVAILABLE (AND)', async () => {
    renderPanel()

    // Khối PID (REVIEW_REQUIRED): draggable === false, nút chèn disabled
    const pidCard = await waitFor(() => cardFor('PID'))
    expect(pidCard).toHaveAttribute('draggable', 'false')
    const pidButton = await screen.findByRole('button', { name: 'Chèn PID' })
    expect(pidButton).toBeDisabled()

    // Khối AVAILABLE (AND): draggable === true, nút chèn không disabled
    const andCard = cardFor('AND')
    expect(andCard).toHaveAttribute('draggable', 'true')
    const andButton = screen.getByRole('button', { name: 'Chèn AND' })
    expect(andButton).not.toBeDisabled()
  })

  it('TC-FBD-STATE-005: catalog đọc hỏng hiện lý do, có nút Thử lại gọi refresh và 0 entry được render', async () => {
    const refreshSpy = vi.fn()
    renderPanel(paged({
      status: 'error',
      items: [],
      error: 'PRG-ERR-UNAVAILABLE-001',
      refresh: refreshSpy
    }))

    // Hiện lý do lỗi trong role="alert"
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('PRG-ERR-UNAVAILABLE-001')

    // Có nút "Thử lại", click nút gọi đúng refresh
    const retryBtn = screen.getByRole('button', { name: /Thử lại|Retry/ })
    expect(retryBtn).toBeInTheDocument()
    fireEvent.click(retryBtn)
    expect(refreshSpy).toHaveBeenCalledTimes(1)

    // Panel trống về mặt dữ liệu: tuyệt đối không render thẻ khối hay fallback giả
    expect(screen.queryAllByTestId('quick-library-card')).toHaveLength(0)
  })

  it('TC-LIB-CHIP-ALL: hiển thị chip "Tất cả" ở vị trí đầu tiên với aria-pressed="true" theo mặc định', async () => {
    // Cung cấp entry có category công khai hợp lệ
    const itemsWithCategory = libraryItems().map((item) => ({
      ...item,
      category: item.signature?.category ?? undefined,
    }))
    renderPanel(paged({ items: itemsWithCategory }))

    // Chờ danh sách tải xong
    await waitFor(() => cardFor('LIMIT'))

    // Tìm tất cả các button chip phân loại
    const chips = screen.getAllByRole('button').filter((btn) => btn.hasAttribute('aria-pressed'))
    expect(chips.length).toBeGreaterThan(1)

    // Chip đầu tiên luôn là "Tất cả" và đang được chọn theo mặc định
    const allChip = chips[0]
    expect(allChip).toHaveTextContent('Tất cả')
    expect(allChip).toHaveAttribute('aria-pressed', 'true')

    // Các chip danh mục còn lại không được chọn theo mặc định
    const otherChips = chips.slice(1)
    for (const chip of otherChips) {
      expect(chip).toHaveAttribute('aria-pressed', 'false')
    }

    // Khi click chọn một phân loại khác (ví dụ "math")
    const mathChip = screen.getByRole('button', { name: 'math' })
    fireEvent.click(mathChip)

    // Chip "math" chuyển sang aria-pressed="true", còn "Tất cả" chuyển sang aria-pressed="false"
    expect(mathChip).toHaveAttribute('aria-pressed', 'true')
    expect(allChip).toHaveAttribute('aria-pressed', 'false')

    // Bấm lại vào "Tất cả" khôi phục trạng thái được chọn
    fireEvent.click(allChip)
    expect(allChip).toHaveAttribute('aria-pressed', 'true')
    expect(mathChip).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('T59-804 — dock dùng chung: bề mặt tự nói mục nào chưa nhận được', () => {
  it('mục bề mặt chưa vẽ được bị chặn kèm lý do CỦA BỀ MẶT, không phải của catalog', async () => {
    const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(true)
    render(
      <I18nProvider>
        <QuickLibraryPanel
          library={ready()}
          language="FBD"
          onInsert={onInsert}
          canInsert={(entry) =>
            entry.entryId === 'LIMIT' ? { ok: true } : { ok: false, reason: 'Chưa vẽ được trên canvas' }
          }
          onClose={vi.fn()}
        />
      </I18nProvider>
    )
    // LIMIT: catalog cho phép và bề mặt nhận được.
    fireEvent.click(await screen.findByRole('button', { name: 'Chèn LIMIT' }))
    expect(onInsert).toHaveBeenCalledTimes(1)

    // PID: catalog đã chặn (REVIEW_REQUIRED) nên lý do của catalog thắng.
    const pid = await screen.findByRole('button', { name: 'Chèn PID' })
    expect(pid).toBeDisabled()
    expect(within(cardFor('PID')).getByText('Chờ review sản phẩm')).toBeInTheDocument()
  })

  it('DEV-PROG-002: thẻ khối vẽ sơ đồ chân từ chữ ký backend, không tự bịa', async () => {
    renderPanel()
    const limit = within(await waitFor(() => cardFor('LIMIT')))
    // LIMIT có ba chân vào (MN/IN/MX) và một chân ra (OUT) trong chữ ký fixture.
    expect(limit.getByText('→ MN')).toBeInTheDocument()
    expect(limit.getByText('→ IN')).toBeInTheDocument()
    expect(limit.getByText('→ MX')).toBeInTheDocument()
    expect(limit.getByText('OUT →')).toBeInTheDocument()
  })

  it('DEV-PROG-002: chữ ký không đọc được ⇒ nói ra, KHÔNG vẽ một hộp trống', async () => {
    // Một khối không chân trông y hệt "khối không có đầu vào" — hai câu khác
    // hẳn nhau, và câu sai dẫn người dùng chèn một lời gọi thiếu tham số.
    render(
      <I18nProvider>
        <QuickLibraryPanel
          library={paged({
            items: [{
              scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
              entryId: 'MYSTERY', kind: 'FUNCTION', name: 'MYSTERY', featureState: 'AVAILABLE',
              contentSha256: 'c'.repeat(64), interface: 'không-phải-json',
              dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0
            }] as unknown as ProgrammingLibraryEntry[]
          })}
          language="ST"
          onInsert={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>
    )
    const card = within(await waitFor(() => cardFor('MYSTERY')))
    expect(card.getByText('Thiết bị không công bố chân của khối này.')).toBeInTheDocument()
    expect(card.getByText('Thiếu chữ ký từ thiết bị')).toBeInTheDocument()
  })

  it('DEV-PROG-002: "Xem thêm khối…" chỉ hiện khi có Project thật để trỏ tới', async () => {
    renderPanel()
    await waitFor(() => cardFor('LIMIT'))
    // Không có `projectId` ⇒ không có đích thật; không dựng một liên kết chết.
    expect(screen.queryByRole('link', { name: 'Xem thêm khối…' })).toBeNull()
    cleanup()

    render(
      <MemoryRouter>
        <I18nProvider>
          <QuickLibraryPanel
            library={ready()}
            language="ST"
            projectId="p-1"
            onInsert={vi.fn()}
            onClose={vi.fn()}
          />
        </I18nProvider>
      </MemoryRouter>
    )
    const link = await screen.findByRole('link', { name: 'Xem thêm khối…' })
    expect(link).toHaveAttribute('href', '/eng/programming/projects/p-1/library')
  })

  it('mục catalog dùng được nhưng bề mặt chưa nhận thì hiện lý do của bề mặt', async () => {
    const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(true)
    render(
      <I18nProvider>
        <QuickLibraryPanel
          library={ready()}
          language="FBD"
          onInsert={onInsert}
          canInsert={() => ({ ok: false, reason: 'Chưa vẽ được trên canvas' })}
          onClose={vi.fn()}
        />
      </I18nProvider>
    )
    const limit = await screen.findByRole('button', { name: 'Chèn LIMIT' })
    expect(limit).toBeDisabled()
    expect(within(cardFor('LIMIT')).getByText('Chưa vẽ được trên canvas')).toBeInTheDocument()
    fireEvent.click(limit)
    expect(onInsert).not.toHaveBeenCalled()
  })
})

/**
 * `T61-202` / `ISS-PGM04-05` — Quick Library KHÔNG dừng ở trang đầu.
 *
 * Lớp lỗi mà bộ này canh là im lặng: bản trước đọc đúng một trang `limit: 100`
 * rồi bỏ `nextCursor`, nên khối thứ 101 không tồn tại đối với người dùng — và
 * bề mặt trông y hệt một thư viện chỉ có 100 khối. Vì vậy các khẳng định dưới
 * đây đều nhắm vào thứ NGƯỜI DÙNG THẤY (nút, thẻ, cảnh báo), không vào state
 * nội bộ của hook.
 */
function bulkItems(count: number, offset = 0): ProgrammingLibraryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
    entryId: `BLK_${offset + index + 1}`, kind: 'FUNCTION', name: `BLK_${offset + index + 1}`,
    featureState: 'AVAILABLE', contentSha256: 'd'.repeat(64),
    signature: {
          dispatch: 'FB_TYPE', polymorphic: false, typedPortNames: [],
      category: 'math', labelVi: `Khối ${offset + index + 1}`, labelEn: `Block ${offset + index + 1}`,
      allowedTypes: [], ports: [{ name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }]
    },
    dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0
  })) as unknown as ProgrammingLibraryEntry[]
}

const lastInsert = vi.fn<(entry: CatalogEntry) => boolean>()

/** Như `renderPanel` nhưng giữ được đường `rerender`: nửa sau của phép kiểm
 *  "khối 101 tới nơi" là trang sau VỀ, không phải trang sau được xin. */
function renderPagedPanel(state: ProgrammingLibraryPagedState) {
  lastInsert.mockReset().mockReturnValue(true)
  const ui = (value: ProgrammingLibraryPagedState) => (
    <I18nProvider>
      <QuickLibraryPanel library={value} language="ST" onInsert={lastInsert} onClose={vi.fn()} />
    </I18nProvider>
  )
  const view = render(ui(state))
  return { rerender: (next: ProgrammingLibraryPagedState) => view.rerender(ui(next)) }
}

describe('T61-202 — Quick Library đọc chung engine phân trang của PGM-04', () => {
  it('còn trang chưa đọc ⇒ có đường đi tiếp, và nó gọi ĐÚNG loadMore của engine', async () => {
    const loadMore = vi.fn()
    renderPanel(paged({ items: bulkItems(100), hasMore: true, loadMore }))
    const button = await screen.findByTestId('quick-library-load-more')
    // Nhãn nói ra ĐÃ TẢI BAO NHIÊU: "100 khối" cạnh một nút tải thêm là câu
    // duy nhất phân biệt được "thư viện có ngần này" với "mới đọc tới đây".
    expect(button).toHaveTextContent('Tải thêm khối (đã tải 100)')
    fireEvent.click(button)
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('hết trang ⇒ KHÔNG mời tải thêm', async () => {
    renderPanel(paged({ items: bulkItems(12), hasMore: false }))
    await waitFor(() => cardFor('BLK_1'))
    expect(screen.queryByTestId('quick-library-load-more')).toBeNull()
  })

  it('khối thứ 101 tìm và chèn được sau khi trang sau về', async () => {
    const { rerender } = renderPagedPanel(paged({ items: bulkItems(100), hasMore: true }))
    fireEvent.change(await screen.findByLabelText('Tìm khối thư viện'), { target: { value: 'BLK_125' } })
    // Chưa tải trang sau: mục chưa có, và bề mặt phải nói ra là DANH SÁCH CHƯA
    // ĐỦ chứ không phải "không khớp mục nào" — câu sau là lời mời bỏ cuộc.
    expect(screen.queryByTestId('quick-library-card')).toBeNull()
    expect(screen.getByText('Không khớp mục nào trong phần đã tải — còn khối chưa tải.')).toBeInTheDocument()

    rerender(paged({ items: [...bulkItems(100), ...bulkItems(25, 100)], hasMore: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Chèn BLK_125' }))
    expect(lastInsert.mock.calls[0][0].entryId).toBe('BLK_125')
  })

  it('trang sau lỗi: danh sách đã tải GIỮ NGUYÊN và nút đổi thành thử lại', async () => {
    const loadMore = vi.fn()
    renderPanel(paged({
      items: bulkItems(100), hasMore: true, loadMore,
      loadMoreError: 'PRG-ERR-UNAVAILABLE-001',
    }))
    // Luật đắt nhất: một trang hỏng KHÔNG được xoá thứ người dùng đang đọc.
    expect(await waitFor(() => cardFor('BLK_1'))).toBeInTheDocument()
    expect(cardFor('BLK_100')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('PRG-ERR-UNAVAILABLE-001')
    const retry = screen.getByTestId('quick-library-load-more')
    expect(retry).toHaveTextContent('Thử lại trang này')
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('đọc lại lỗi nhưng đã có nội dung ⇒ vẫn vẽ nội dung, kèm cảnh báo', async () => {
    // `status: 'error'` với `items` khác rỗng là trạng thái engine tạo ra khi
    // một lần làm mới hỏng. Đòi `status === 'ready'` ở đây sẽ vứt đúng cái
    // danh sách mà engine cố công giữ lại.
    renderPanel(paged({ status: 'error', items: bulkItems(3), error: 'PRG-ERR-OFFLINE-001', failure: 'offline' }))
    expect(await waitFor(() => cardFor('BLK_1'))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('PRG-ERR-OFFLINE-001')
  })

  it('đang tải trang sau ⇒ nút bị khoá, không xin chồng hai trang', async () => {
    const loadMore = vi.fn()
    renderPanel(paged({ items: bulkItems(100), hasMore: true, loadingMore: true, loadMore }))
    const button = await screen.findByTestId('quick-library-load-more')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Đang tải thêm…')
  })
})
