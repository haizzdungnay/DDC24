import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { LibraryPage } from './LibraryPage'

/**
 * `T61-501` — bề mặt PGM-04 mà WP-03/WP-04 dựng: thẻ khối, bàn phím, Inspector,
 * drawer soạn thảo theo yêu cầu, Used-In đi tới được, và đường Chèn.
 *
 * Tệp này giữ TÁCH khỏi `LibraryPage.test.tsx` vì nó cần một bản Draft đọc được
 * (POU đích cho Chèn, số nơi dùng trên thẻ) mà bộ test cũ cố ý không có — trộn
 * hai harness lại sẽ làm mọi case cũ phải mang theo một Draft mà chúng không
 * dùng tới.
 */
/* `T61-303` — Yêu thích của thẻ đi qua túi tuỳ chọn dùng chung
   (`shared/api/client`), đúng kho mà Quick Library dùng. Giả lập ở đây để test
   đọc được PAYLOAD thật được đẩy lên, không chỉ đọc trạng thái trên màn hình. */
const preferences = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('../../../shared/api/client', () => ({
  apiClient: { getMyPreferences: preferences.get, putMyPreferences: preferences.put }
}))

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'admin', role: auth.role, loginAt: '2026-08-20T00:00:00Z' },
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

const client = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => client }))

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '44444444-4444-4444-8444-444444444444'
const POU_ID = '66666666-6666-4666-8666-666666666666'
const ETAG = '"22222222-2222-4222-8222-222222222222:3"'

const SIGNATURE = {
  category: 'math', labelVi: 'Tuyến tính', labelEn: 'Linear',
  dispatch: 'FUNC_TABLE', polymorphic: false, allowedTypes: ['REAL'], typedPortNames: [],
  ports: [
    { name: 'SP', direction: 'INPUT', dataType: 'REAL' },
    { name: 'PV', direction: 'INPUT', dataType: 'REAL' },
    { name: 'CV', direction: 'OUTPUT', dataType: 'REAL' }
  ]
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'PROJECT', libraryRevisionId: '33333333-3333-4333-8333-333333333333',
    libraryVersion: '1.0.0', libraryState: 'DRAFT', entryId: ENTRY_ID,
    kind: 'FUNCTION', name: 'SCALE_LIN', language: 'ST', featureState: 'AVAILABLE',
    contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0,
    signature: SIGNATURE,
    ...overrides
  }
}

function projectListPage() {
  return {
    items: [{
      projectId: PROJECT_ID, name: 'AHU', etag: ETAG, activeRevisionId: null,
      draftRevisionId: DRAFT_ID, baseRevisionId: DRAFT_ID, updatedAt: '2026-08-20T00:00:00Z'
    }]
  }
}

/** Draft đọc được, có đúng một POU để Chèn nhắm tới. */
function projectDetail(objects: Record<string, unknown>[] = [
  { objectId: POU_ID, kind: 'PROGRAM', name: 'AHU_MAIN', language: 'ST', source: '', dependencies: [] }
]) {
  return {
    projectId: PROJECT_ID, name: 'AHU', etag: ETAG, activeRevisionId: null,
    draftRevisionId: DRAFT_ID, baseRevisionId: DRAFT_ID, updatedAt: '2026-08-20T00:00:00Z',
    draft: { schemaVersion: 2, objects, programs: [], tasks: [] }
  }
}

function stub(items: unknown[], overrides: Record<string, () => Promise<unknown>> = {}) {
  client.request.mockImplementation((operationId: string) => {
    if (overrides[operationId]) return overrides[operationId]()
    if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
    if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
    if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items })
    if (operationId === 'listProgrammingLibraryUsages') {
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] },
        availability: 'SEALED_ONLY'
      })
    }
    return Promise.reject(new Error('unexpected ' + operationId))
  })
}

let lastLocation = ''
function LocationProbe() {
  const location = useLocation()
  lastLocation = `${location.pathname}${location.search}`
  return null
}

function renderPage(initial = `/eng/programming/projects/${PROJECT_ID}/library`) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initial]}>
        <LocationProbe />
        <Routes>
          <Route path="/eng/programming/projects/:projectId/library" element={<LibraryPage />} />
          <Route path="/eng/programming/programs" element={<p>PGM-02</p>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  auth.role = 'admin'
  localStorage.removeItem('mkddc-programming-library')
  preferences.get.mockReset().mockResolvedValue({})
  preferences.put.mockReset().mockResolvedValue(undefined)
  lastLocation = ''
  client.request.mockReset()
})
afterEach(cleanup)

describe('PGM-04 thẻ khối (T61-303)', () => {
  /*
  `AC-PGM04-01` — chữ ký phải đọc được TRƯỚC khi mở chi tiết. Một thẻ chỉ có
  tên bắt người dùng mở từng khối để biết khối nào nhận REAL và khối nào nhận
  BOOL; với một thư viện vài chục khối, đó là vài chục lần mở.
  */
  it('hiện chữ ký ngay trên thẻ, không cần mở Inspector', async () => {
    stub([entry()])
    renderPage()
    const block = await screen.findByTestId('library-block-card')
    expect(within(block).getByText('SCALE_LIN(SP: REAL, PV: REAL) → CV: REAL')).toBeInTheDocument()
  })

  it('vắng chữ ký thì nói ra, không hiện một dòng trống trông như không có chân', async () => {
    stub([entry({ signature: undefined })])
    renderPage()
    const block = await screen.findByTestId('library-block-card')
    expect(within(block).getByText(/Chưa đọc được chữ ký/)).toBeInTheDocument()
  })

  /*
  Nhãn review-gate phải đọc `featureState` của MÁY CHỦ.

  Bản trước đối chiếu TÊN khối với danh sách feature bị gate trong profile sinh
  ra. Hai hệ quả, và cả hai đều là nói dối: một khối PROJECT do người dùng đặt
  tên `PID` bị gắn nhãn "chờ review Controls/Safety" dù nó chẳng liên quan; và
  một khối SYSTEM thật sẽ MẤT nhãn nếu profile trong bundle lạc hậu so với máy
  chủ — đúng chiều nguy hiểm, vì nhãn biến mất thì không ai đi tìm nó.
  */
  it('khối PROJECT trùng tên với feature bị gate KHÔNG bị gắn nhãn review', async () => {
    stub([entry({ name: 'PID', kind: 'FUNCTION_BLOCK', featureState: 'AVAILABLE' })])
    renderPage()
    await screen.findByTestId('library-block-card')
    expect(screen.queryByText(/Chờ review Controls\/Safety/)).not.toBeInTheDocument()
  })

  it('khối máy chủ đánh dấu REVIEW_REQUIRED thì bị gắn nhãn dù tên là gì', async () => {
    stub([entry({ name: 'BLEND_CTRL', featureState: 'REVIEW_REQUIRED' })])
    renderPage()
    expect(await screen.findByText(/Chờ review Controls\/Safety/)).toBeInTheDocument()
  })

  it('đếm nơi dùng trong bản nháp và nói rõ đó là phạm vi bản nháp', async () => {
    stub([entry()], {
      getProgrammingProject: () => Promise.resolve(projectDetail([
        { objectId: POU_ID, kind: 'PROGRAM', name: 'AHU_MAIN', language: 'ST', source: '', dependencies: [ENTRY_ID] }
      ]))
    })
    renderPage()
    const block = await screen.findByTestId('library-block-card')
    await waitFor(() => expect(within(block).getByText(/1 POU trong bản nháp/)).toBeInTheDocument())
  })

  /* Chưa đọc được bản nháp KHÁC "không POU nào dùng". `0` là một câu mời người
     ta xoá khối, nên nó không được thay thế cho "chưa đo được".

     `T61-303` — câu chữ nay nói ĐÚNG thứ không đọc được: BẢN NHÁP. Bản trước
     viết "chưa đo được nơi dùng", nghe như cả Used-In cũng chưa đo — trong khi
     thẻ chưa bao giờ đo Used-In, và phần ấy có dòng riêng chỉ sang khay. */
  it('chưa đọc được bản nháp thì nói chưa đo được, KHÔNG hiện 0', async () => {
    stub([entry()], { getProgrammingProject: () => Promise.reject(new Error('mạng hỏng')) })
    renderPage()
    const block = await screen.findByTestId('library-block-card')
    await waitFor(() => expect(within(block).getByText(/chưa đọc được bản nháp/)).toBeInTheDocument())
    expect(within(block).queryByText(/0 POU trong bản nháp/)).not.toBeInTheDocument()
  })
})

describe('PGM-04 bàn phím trên lưới thẻ (T61-306)', () => {
  /*
  `SPEC-PGM04-VISUAL-001` §5 — lưới là MỘT điểm dừng tab, và mũi tên DI CHUYỂN
  chứ không MỞ. Gộp hai thứ lại thì lướt từ đầu tới cuối một thư viện 200 khối
  sẽ đổi URL 200 lần và bắn 200 request Used-In cho những khối không ai định
  xem.
  */
  it('đúng một thẻ nằm trong vòng Tab', async () => {
    stub([entry(), entry({ entryId: 'TON', name: 'TON', scope: 'SYSTEM', libraryRevisionId: 'system' })])
    renderPage()
    const cards = await screen.findAllByTestId('library-block-card')
    expect(cards.filter((item) => item.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('mũi tên chuyển tiêu điểm mà KHÔNG đổi khối đang chọn', async () => {
    stub([entry(), entry({ entryId: 'TON', name: 'TON', scope: 'SYSTEM', libraryRevisionId: 'system' })])
    renderPage()
    const cards = await screen.findAllByTestId('library-block-card')
    const list = screen.getByRole('list', { name: /Danh sách khối/ })
    fireEvent.keyDown(list, { key: 'ArrowRight' })

    expect(cards[1]).toHaveFocus()
    // Không có khối nào được CHỌN: URL chưa mang `entry`.
    expect(lastLocation).not.toContain('entry=')
    expect(cards[1]).not.toHaveAttribute('aria-current')
  })

  it('Enter trên thẻ mới mở Inspector và ghi khối vào URL', async () => {
    stub([entry()])
    renderPage()
    const block = await screen.findByTestId('library-block-card')
    fireEvent.click(block)
    await waitFor(() => expect(lastLocation).toContain(`entry=PROJECT%2F${ENTRY_ID}`))
    expect(block).toHaveAttribute('aria-current', 'true')
  })

  it('End nhảy tới thẻ cuối, Home về thẻ đầu', async () => {
    stub([entry(), entry({ entryId: 'TON', name: 'TON', scope: 'SYSTEM', libraryRevisionId: 'system' })])
    renderPage()
    const cards = await screen.findAllByTestId('library-block-card')
    const list = screen.getByRole('list', { name: /Danh sách khối/ })
    fireEvent.keyDown(list, { key: 'End' })
    expect(cards[1]).toHaveFocus()
    fireEvent.keyDown(list, { key: 'Home' })
    expect(cards[0]).toHaveFocus()
  })
})

/**
 * `T61-303` / `ISS-PGM04-08` — thẻ phải ĐỦ để ra quyết định mà không mở
 * Inspector, và mọi trường đều phải có nguồn nói ra được.
 */
describe('T61-303 — thẻ dày bằng dữ liệu authoritative', () => {
  /* Hai con số về "nơi dùng" là HAI SỰ THẬT khác nhau. Thẻ chỉ cầm được một —
     bản nháp của Project đang mở — vì đo Used-In tốn một request cho mỗi khối,
     và một lưới 200 thẻ sẽ bắn 200 request cho những khối không ai định xem.
     Nên thẻ phải nói ra CẢ HAI điều: con số nó cầm là con số nào, và phần còn
     lại đo ở đâu. Gộp lại thì "0" đọc thành "không ai dùng khối này". */
  it('tách con số bản nháp khỏi Used-In authoritative, không gộp thành một số', async () => {
    stub([entry()])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    expect(within(card).getByTestId('library-card-draft-usage')).toBeVisible()
    expect(within(card).getByTestId('library-card-draft-usage')).toHaveTextContent('POU trong bản nháp')
    /* `toBeVisible`, không chỉ `toHaveTextContent`: một `hidden` trên dòng này
       vẫn để text nằm trong cây, nên khẳng định về nội dung sẽ xanh trong khi
       người dùng không đọc được gì — và "0 POU trong bản nháp" lại một mình
       đứng đó, đúng cái gộp mà lát này sinh ra để chặn. */
    expect(within(card).getByTestId('library-card-sealed-usage')).toBeVisible()
    expect(within(card).getByTestId('library-card-sealed-usage'))
      .toHaveTextContent('nơi dùng đã niêm phong: xem khay Nơi sử dụng')
    /* Và thẻ KHÔNG được tự gọi Used-In: đó chính là 200 request kia. */
    const calls = client.request.mock.calls.map((call) => call[0])
    expect(calls).not.toContain('listProgrammingLibraryUsages')
  })

  /* Tương thích đọc từ HỢP ĐỒNG. Trường vắng ⇒ `UNKNOWN`, và `UNKNOWN` phải
     hiện ra: im lặng làm một khối chưa ai đo trông hệt khối đã đo và đạt. */
  it('hiện tương thích khi khác COMPATIBLE, và không đoán từ version', async () => {
    stub([entry({ compatibility: { state: 'REQUIRES_MIGRATION', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: 'lệch version' } })])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    expect(within(card).getByTestId('library-card-compatibility'))
      .toHaveTextContent('Cần nâng cấp phiên bản thư viện')
  })

  it('thiếu trường compatibility là CHƯA ĐO ĐƯỢC, không phải "không sao"', async () => {
    stub([entry()])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    expect(within(card).getByTestId('library-card-compatibility'))
      .toHaveTextContent('Chưa đo được tương thích')
  })

  it('COMPATIBLE thì KHÔNG thêm dòng nào — nhiễu cũng là một cách nói dối', async () => {
    stub([entry({ compatibility: { state: 'COMPATIBLE', requiredVersion: '1.0.0', availableVersion: '1.0.0', reason: null } })])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    expect(within(card).queryByTestId('library-card-compatibility')).toBeNull()
  })

  /* Yêu thích dùng CHUNG kho với Quick Library: cùng túi tuỳ chọn, cùng khoá
     `scope/entryId`. Một kho thứ hai sẽ cho hai danh sách sao khác nhau cho
     cùng một khối, và người dùng không biết bên nào là bên họ vừa bấm. */
  it('gắn sao ghi vào ĐÚNG kho tuỳ chọn dùng chung, khoá theo scope/entryId', async () => {
    stub([entry()])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    /* Ngôi sao là ANH EM của nút thẻ, không nằm trong nó: `<button>` lồng
       `<button>` là HTML không hợp lệ. Hỏi từ ô chứa cả hai. */
    const cell = card.closest('li') as HTMLElement
    const star = within(cell).getByTestId('library-card-favorite')
    expect(star).toHaveAttribute('aria-pressed', 'false')
    /* Nhãn phải CHỨA tên khối đang hiện. Ba nút quanh đây cùng nói về một khối;
       một nhãn "Yêu thích" trống không, lặp trên 200 thẻ, là thứ trình đọc màn
       hình đọc ra 200 lần giống hệt nhau. (Chính ràng buộc này khiến truy vấn
       `getByRole('button', { name: /TÊN/ })` không còn dùng được cho thẻ.) */
    expect(star).toHaveAccessibleName(expect.stringContaining('SCALE_LIN'))
    /* Vùng chạm ≥ 24 px (WCAG 2.5.8). jsdom không có layout nên đo bằng lớp
       tiện ích — nó là nơi quyết định được ghi ra, và một lần đổi xuống 1rem
       phải làm test đỏ. */
    expect(star.className).toContain('min-h-[1.75rem]')
    expect(star.className).toContain('min-w-[1.75rem]')
    fireEvent.click(star)
    await waitFor(() => expect(preferences.put).toHaveBeenCalled())
    const payload = preferences.put.mock.calls[preferences.put.mock.calls.length - 1][0] as Record<string, unknown>
    expect(payload.programmingLibrary).toEqual({ favorites: [`PROJECT/${ENTRY_ID}`], recent: [] })
    await waitFor(() => expect(within(cell).getByTestId('library-card-favorite'))
      .toHaveAttribute('aria-pressed', 'true'))
  })

  /* Bấm sao KHÔNG được mở khay chi tiết: hai hành động khác nhau trên cùng một
     thẻ, và gộp chúng lại thì mỗi lần gắn sao là một lần đổi URL. */
  it('bấm sao không mở khay chi tiết', async () => {
    stub([entry()])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    const cell = card.closest('li') as HTMLElement
    fireEvent.click(within(cell).getByTestId('library-card-favorite'))
    await waitFor(() => expect(preferences.put).toHaveBeenCalled())
    expect(lastLocation).not.toContain('entry=')
  })

  /* `SPEC-PGM04-VISUAL-001` §5 — số điểm dừng `Tab` của lưới là một HẰNG SỐ,
     không tỉ lệ với số thẻ. Thẻ nay có hai nút, nên hằng số là 2; điều bị cấm
     là 2N. Kiểm bằng một lưới 200 thẻ chứ không bằng ba thẻ: ba thẻ thì 2N và
     một hằng số trông không khác nhau mấy. */
  it('lưới 200 thẻ vẫn chỉ tốn một hằng số điểm dừng Tab', async () => {
    const many = Array.from({ length: 200 }, (_, index) => entry({
      entryId: `${index}`.padStart(8, '0') + '-4444-4444-8444-444444444444',
      name: `KHOI_${index}`,
    }))
    stub(many)
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId('library-block-card')).toHaveLength(200))
    const list = screen.getByRole('list', { name: /Danh sách khối Thư viện điều khiển/ })
    const stops = [...list.querySelectorAll('button')].filter((node) => node.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(2)
    // Và đúng một trong hai là THẺ, không phải hai ngôi sao.
    expect(stops.filter((node) => node.dataset.testid === 'library-block-card')).toHaveLength(1)
  })

  /* Chữ dài không được cắt mất thông tin quyết định. `line-clamp` cho mô tả là
     có chủ đích; TÊN và CHỮ KÝ thì phải còn nguyên trong cây (truncate bằng CSS
     vẫn giữ text, `title` mang bản đầy đủ) để copy và để trình đọc màn hình
     đọc được. */
  it('tên và chữ ký dài vẫn còn NGUYÊN trong cây, không bị cắt mất chữ', async () => {
    const longName = 'KHOI_' + 'X'.repeat(80)
    stub([entry({ name: longName, description: 'M'.repeat(400) })])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    expect(within(card).getByText(longName)).toBeInTheDocument()
    expect(card.textContent).toContain(`${longName}(SP: REAL, PV: REAL) → CV: REAL`)
  })

  /* Trường VẮNG hiện `—` KÈM lý do. Ô trống đọc như "đã điền rồi và nội dung
     rỗng", nên người dùng sẽ không đi tìm chỗ để điền. */
  it('thiếu phân loại và mô tả thì nói ra, không để trống', async () => {
    stub([entry({ category: undefined, description: undefined })])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    expect(within(card).getByText('— chưa phân loại')).toBeInTheDocument()
    expect(within(card).getByText('— chưa có mô tả')).toBeInTheDocument()
  })

  it('REVIEW_REQUIRED và DEPRECATED cùng hiện khi cùng đúng', async () => {
    stub([entry({ featureState: 'REVIEW_REQUIRED', libraryState: 'DEPRECATED' })])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    expect(within(card).getByText('Chờ review Controls/Safety')).toBeInTheDocument()
    expect(within(card).getByText('Ngừng sử dụng')).toBeInTheDocument()
  })
})

/**
 * `T61-304` / `ISS-PGM04-09` — hình thái Inspector theo `SPEC-PGM04-VISUAL-001` §1.
 *
 * jsdom KHÔNG có `window.matchMedia` và `innerWidth` mặc định là 1024, nên mọi
 * case khác của tệp này chạy ở hình thái CẮM. Bộ dưới đây cắm `matchMedia` giả
 * để đo hai hình thái PHỦ — thứ mà một bộ test chỉ chạy ở 1024 px sẽ không bao
 * giờ chạm tới, và đó đúng là lý do khay phủ chưa từng tồn tại.
 */
function stubViewport(mode: 'dock' | 'drawer' | 'fullscreen') {
  const matches = (query: string) => {
    if (query.includes('min-width: 1024px')) return mode === 'dock'
    if (query.includes('max-width: 767px')) return mode === 'fullscreen'
    return false
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

/**
 * `T61-305` / `ISS-PGM04-10` — skeleton phải khớp HÌNH HỌC lưới thật.
 *
 * Đo bằng cách so lớp lưới ĐÃ RENDER của hai trạng thái, không bằng cách so
 * hằng với chính nó: một hằng dùng chung vẫn có thể bị một trong hai nơi bỏ
 * qua, và đó đúng là lỗi cần bắt.
 */
describe('T61-305 — skeleton giữ hình học của lưới', () => {
  it('lưới skeleton và lưới thật mang cùng luật cột', async () => {
    const pending: { resolve?: (value: unknown) => void } = {}
    stub([], {
      searchProgrammingLibraries: () => new Promise((resolve) => { pending.resolve = resolve }),
    })
    renderPage()
    const skeleton = await screen.findByRole('list', { name: /Đang tải danh sách khối/ })
    const skeletonClass = skeleton.className

    pending.resolve?.({ items: [entry()] })
    const list = await screen.findByRole('list', { name: /Danh sách khối Thư viện điều khiển/ })
    /* Bố cục nhảy một nhịp khi dữ liệu về là cú nhảy rơi đúng lúc người dùng
       vừa đưa chuột tới chỗ họ tưởng là nút. */
    expect(skeletonClass).toBe(list.className)
    expect(skeletonClass).toContain('md:grid-cols-2')
    expect(skeletonClass).toContain('xl:grid-cols-3')
  })
})

describe('T61-304 — Inspector: cắm ở desktop, khay ở tablet, toàn màn ở mobile', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('desktop CẮM: không phải hộp thoại, không bẫy tiêu điểm, không đóng bằng Esc', async () => {
    /* Bẫy tiêu điểm ở một khay CẮM là nhốt người dùng bàn phím vào một vùng họ
       chưa từng "mở", và `Esc` sẽ đóng một thứ không đóng được. Đây đúng là mục
       "Drawer không trả focus hoặc bẫy focus ở desktop" của issue. */
    stubViewport('dock')
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    /* Khẳng định theo thứ NGƯỜI DÙNG gặp, không theo một `data-testid` gắn
       riêng cho test: khay cắm là một VÙNG của trang, nên nó có tiêu đề bình
       thường và KHÔNG có hộp thoại nào trên màn hình. */
    expect(await screen.findByRole('heading', { name: 'Khối đang chọn' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('library-inspector-drawer')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    // Khối vẫn đang chọn: `Esc` không đóng một khay không mở được.
    await waitFor(() => expect(lastLocation).toContain('entry='))
  })

  it('tablet: KHAY phủ thật, có role dialog và aria-modal — không phải CSS xếp dọc', async () => {
    stubViewport('drawer')
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    const drawer = await screen.findByTestId('library-inspector-drawer')
    expect(drawer).toHaveAttribute('role', 'dialog')
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(drawer).toHaveAttribute('data-mode', 'drawer')
    expect(screen.queryByTestId('library-inspector-dock')).toBeNull()
  })

  it('mobile: TOÀN MÀN, vẫn là hộp thoại', async () => {
    stubViewport('fullscreen')
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    const drawer = await screen.findByTestId('library-inspector-drawer')
    expect(drawer).toHaveAttribute('data-mode', 'fullscreen')
    expect(drawer).toHaveAttribute('aria-modal', 'true')
  })

  it('chưa chọn khối thì khay phủ KHÔNG tồn tại — hộp thoại rỗng là chặn đường mà không đưa lại gì', async () => {
    stubViewport('drawer')
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    expect(screen.queryByTestId('library-inspector-drawer')).toBeNull()
    expect(screen.queryByTestId('library-inspector-backdrop')).toBeNull()
  })

  it('Esc đóng khay và TRẢ TIÊU ĐIỂM về đúng thẻ vừa mở', async () => {
    /* Không trả tiêu điểm thì nó rơi về `<body>`, và người dùng bàn phím phải
       `Tab` lại từ đầu trang để quay về đúng thẻ họ vừa mở. */
    stubViewport('drawer')
    stub([entry()])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    fireEvent.click(card)
    await screen.findByTestId('library-inspector-drawer')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('library-inspector-drawer')).toBeNull())
    await waitFor(() => expect(lastLocation).not.toContain('entry='))
    expect(document.activeElement).toBe(card)
  })

  it('nút Đóng của khay cũng trả tiêu điểm về thẻ', async () => {
    stubViewport('drawer')
    stub([entry()])
    renderPage()
    const card = await screen.findByTestId('library-block-card')
    fireEvent.click(card)
    fireEvent.click(await screen.findByRole('button', { name: 'Đóng khay chi tiết' }))
    await waitFor(() => expect(screen.queryByTestId('library-inspector-drawer')).toBeNull())
    expect(document.activeElement).toBe(card)
  })

  it('khay phủ BẪY tiêu điểm: Tab từ phần tử cuối cuộn về phần tử đầu', async () => {
    stubViewport('drawer')
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    const drawer = await screen.findByTestId('library-inspector-drawer')
    const focusable = [...drawer.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node.getAttribute('tabindex') !== '-1')
    expect(focusable.length).toBeGreaterThan(1)
    const last = focusable[focusable.length - 1]
    last.focus()
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(document.activeElement).toBe(focusable[0])
  })

  /* Lỗi của KHAY không được biến cả thư viện thành rỗng hay lỗi. Danh sách đã
     tải là thứ người dùng đang đọc; một 500 ở đường Used-In không phải lý do
     để lấy nó đi. */
  it('lỗi chi tiết KHÔNG xoá danh sách đã tải', async () => {
    stubViewport('dock')
    stub([entry()], {
      listProgrammingLibraryUsages: () => Promise.reject(new Error('PRG-ERR-UNAVAILABLE-001')),
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('tab', { name: 'Nơi sử dụng' }))
    /* Thẻ vẫn còn đó, và danh sách vẫn bấm được — số TUYỆT ĐỐI, vì "còn ít nhất
       một thẻ" sẽ xanh cả với một danh sách đã mất phân nửa. */
    await waitFor(() => expect(screen.getAllByTestId('library-block-card')).toHaveLength(1))
    expect(screen.queryByText(/Không tải được Thư viện điều khiển/)).toBeNull()
    expect(screen.queryByText(/chưa có khối nào/)).toBeNull()
  })
})

describe('PGM-04 Inspector (T61-304)', () => {
  /*
  `aria-controls` chỉ được trỏ tới khay ĐANG hiện.

  Trước lát này cả bốn tab đều trỏ tới `library-inspector-panel-<id>` của riêng
  chúng, trong khi cây chỉ có MỘT khay mang `id` của tab đang mở — ba trong bốn
  tab trỏ vào một `id` không tồn tại, nên trình đọc màn hình không đi tới được
  nội dung mà tab hứa sẽ mở.
  */
  it('chỉ tab đang mở mang aria-controls, và nó trỏ vào khay có thật', async () => {
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))

    /* `T61-302` — trang nay có HAI dải tab (phạm vi thư viện + khay chi tiết).
       Hỏi `getAllByRole('tab')` trên cả tài liệu là trộn hai dải vào nhau, và
       khẳng định "đúng một tab mang aria-controls" sẽ đỏ vì lý do không liên
       quan gì tới thứ nó đang đo. */
    const tabs = within(screen.getByRole('tablist', { name: 'Khay chi tiết khối' })).getAllByRole('tab')
    const withControls = tabs.filter((tab) => tab.hasAttribute('aria-controls'))
    expect(withControls).toHaveLength(1)
    expect(withControls[0]).toHaveAttribute('aria-selected', 'true')
    const panelId = withControls[0].getAttribute('aria-controls') as string
    expect(document.getElementById(panelId)).not.toBeNull()
  })

  it('mũi tên đi giữa các tab, và cả dải chỉ tốn một nhịp Tab', async () => {
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))

    const tablist = screen.getByRole('tablist', { name: 'Khay chi tiết khối' })
    expect(within(tablist).getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1)
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Tham số' })).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(lastLocation).toContain('panel=parameters'))
  })

  /* Một link ghim `entry` mà bộ lọc hiện tại lọc nó ra phải NÓI RA. Cùng câu
     "Chọn một khối" như lúc chưa chọn gì sẽ làm người nhận link kết luận khối
     đã bị xoá. */
  it('khối trong đường dẫn bị bộ lọc loại ra thì nói rõ và mời xoá bộ lọc', async () => {
    stub([])
    renderPage(`/eng/programming/projects/${PROJECT_ID}/library?entry=PROJECT%2F${ENTRY_ID}&kind=CONVERSION`)
    expect(await screen.findByText(/Khối trong đường dẫn không nằm trong bộ lọc hiện tại/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Xoá bộ lọc' })[0])
    await waitFor(() => expect(lastLocation).not.toContain('kind='))
  })
})

describe('PGM-04 Used-In đi tới được (T61-403)', () => {
  /*
  `AC-PGM04-02` — Used-In phải bấm được. Một danh sách tên POU không bấm được
  bắt người dùng tự tìm lại POU đó bằng mắt trong PGM-02, và đó đúng là lúc họ
  mở nhầm một POU trùng tên.
  */
  it('mỗi POU đã niêm phong là một link tới đúng POU trong PGM-02, mang đường quay lại', async () => {
    stub([entry()], {
      listProgrammingLibraryUsages: () => Promise.resolve({
        sealed: {
          count: 1, truncated: false,
          items: [{
            projectId: PROJECT_ID, projectName: 'AHU', revisionId: DRAFT_ID,
            objectId: POU_ID, objectName: 'AHU_MAIN', requiredVersion: '1.0.0',
            usageKind: 'CALL', isActive: false
          }]
        },
        draft: { count: 0, truncated: false, items: [] },
        availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('tab', { name: 'Nơi sử dụng' }))

    const link = await screen.findByRole('link', { name: /AHU_MAIN/ })
    const href = link.getAttribute('href') as string
    expect(href).toContain('/eng/programming/programs')
    expect(href).toContain(`pou=${POU_ID}`)
    expect(href).toContain('returnTo=')
  })

  /* POU của Project khác KHÔNG được dựng link vào Project đang mở: `objectId`
     của Project khác trỏ vào đây sẽ mở nhầm POU, và người dùng không có cách
     nào biết. */
  it('POU thuộc Project khác hiện tên nhưng không dựng link', async () => {
    stub([entry()], {
      listProgrammingLibraryUsages: () => Promise.resolve({
        sealed: {
          count: 1, truncated: false,
          items: [{
            projectId: '99999999-9999-4999-8999-999999999999', projectName: 'CHILLER',
            revisionId: DRAFT_ID, objectId: POU_ID, objectName: 'CH_MAIN',
            requiredVersion: '1.0.0', usageKind: 'CALL', isActive: false
          }]
        },
        draft: { count: 0, truncated: false, items: [] },
        availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('tab', { name: 'Nơi sử dụng' }))

    expect(await screen.findByText(/CH_MAIN/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /CH_MAIN/ })).not.toBeInTheDocument()
  })
})

describe('PGM-04 soạn thảo theo yêu cầu (T61-401)', () => {
  /*
  `AC-PGM04-03` — form tạo khối không được thường trực. Bản trước giữ một Panel
  luôn hiện với một câu hướng dẫn thay cho nội dung, nên một phần chiều cao
  khung phải luôn dành cho thứ người dùng không dùng tới.
  */
  it('không có form nào cho tới khi bấm Tạo, và Huỷ đóng nó lại', async () => {
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Tên khối/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  /*
  `T61-401` — metadata trình bày phải đi được tới máy chủ.

  Cột `category`/`description` đã có trong store và đã được ĐỌC lên màn hình,
  nhưng không có đường GHI nào: mọi khối PROJECT hiện "— chưa phân loại" vĩnh
  viễn, và bộ lọc Phân loại không bao giờ khớp một khối do người dùng tạo.
  */
  it('gửi phân loại và mô tả lên máy chủ khi người dùng điền', async () => {
    const upsert = vi.fn().mockResolvedValue({ etag: ETAG, resource: { libraryRevisionId: DRAFT_ID }, auditId: 'a' })
    stub([entry()], { upsertProgrammingLibraryEntry: upsert })
    client.request.mockImplementation((operationId: string, options?: unknown) => {
      if (operationId === 'upsertProgrammingLibraryEntry') return upsert(operationId, options)
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await screen.findByTestId('library-block-card')
    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } })
    fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), { target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' } })
    fireEvent.change(within(dialog).getByLabelText(/Phân loại/), { target: { value: 'math' } })
    fireEvent.change(within(dialog).getByLabelText(/Mô tả ngắn/), { target: { value: 'Dốc tuyến tính có giới hạn' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Lưu vào bản nháp thư viện/ }))

    await waitFor(() => expect(upsert).toHaveBeenCalled())
    const body = (upsert.mock.calls[0][1] as { body: Record<string, unknown> }).body
    expect(body.category).toBe('math')
    expect(body.description).toBe('Dốc tuyến tính có giới hạn')
  })

  /* Để trống thì BỎ HẲN field, không gửi chuỗi rỗng: upsert ghi đè toàn phần,
     nên chuỗi rỗng được lưu thành "đã điền, nội dung rỗng" và khối sẽ hiện như
     đã phân loại vào một nhóm không tên thay vì hiện `—`. */
  it('để trống thì không gửi chuỗi rỗng — vắng field khác đã điền rỗng', async () => {
    const upsert = vi.fn().mockResolvedValue({ etag: ETAG, resource: { libraryRevisionId: DRAFT_ID }, auditId: 'a' })
    client.request.mockImplementation((operationId: string, options?: unknown) => {
      if (operationId === 'upsertProgrammingLibraryEntry') return upsert(operationId, options)
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await screen.findByTestId('library-block-card')
    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } })
    fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), { target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Lưu vào bản nháp thư viện/ }))

    await waitFor(() => expect(upsert).toHaveBeenCalled())
    const body = (upsert.mock.calls[0][1] as { body: Record<string, unknown> }).body
    expect('category' in body).toBe(false)
    expect('description' in body).toBe(false)
  })
})

describe('PGM-04 Chèn khối (T61-405/406)', () => {
  /*
  `D61-04`/`T59-205` — không có đường bỏ qua `REVIEW_REQUIRED`. Nút vẫn thấy,
  bị khoá, kèm lý do; không có checkbox nào để tự duyệt.
  */
  it('khối chờ review Controls/Safety thì Chèn bị khoá kèm lý do', async () => {
    stub([entry({ featureState: 'REVIEW_REQUIRED' })])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))

    const insert = screen.getByRole('button', { name: /Chèn vào POU/ })
    expect(insert).toBeDisabled()
    expect(screen.getByText(/khối đang chờ review Controls\/Safety/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('phiên bản đã ngừng sử dụng cũng không chèn được, và nói đúng lý do đó', async () => {
    stub([entry({ libraryState: 'DEPRECATED' })])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    expect(screen.getByRole('button', { name: /Chèn vào POU/ })).toBeDisabled()
    expect(screen.getByText(/phiên bản này đã ngừng sử dụng/)).toBeInTheDocument()
  })

  /*
  `AC-PGM04-06` — Chèn độc lập phải đòi ngữ cảnh đích tường minh, và PGM-04
  KHÔNG được tự ghi vào Draft (handoff §4). Nên chọn POU xong là một lần ĐIỀU
  HƯỚNG tới bộ soạn thảo, không phải một lần ghi: chỗ hoàn tác phải nằm trong
  tầm mắt người dùng lúc họ ghi.
  */
  it('Chèn hỏi POU đích rồi mở bộ soạn thảo, và không ghi gì vào bản nháp', async () => {
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('button', { name: /Chèn vào POU/ }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /AHU_MAIN/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Mở POU và chèn/ }))

    await waitFor(() => expect(lastLocation).toContain('/eng/programming/programs'))
    expect(lastLocation).toContain(`pou=${POU_ID}`)
    expect(lastLocation).toContain('returnTo=')
    // Zero mutation: không một lệnh ghi nào được phát ra từ màn hình này.
    const written = client.request.mock.calls.map((call) => call[0])
    expect(written).not.toContain('upsertProgrammingLibraryEntry')
    expect(written).not.toContain('saveProgrammingDraft')
  })

  it('huỷ bộ chọn POU không điều hướng và không ghi', async () => {
    stub([entry()])
    renderPage()
    const before = lastLocation
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('button', { name: /Chèn vào POU/ }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastLocation.split('?')[0]).toBe(before.split('?')[0])
  })

  /* Không chọn POU thì nút xác nhận phải khoá: một phép chèn "vào đâu đó" là
     một phép chèn người dùng sẽ phải đi tìm lại. */
  it('chưa chọn POU thì không xác nhận được', async () => {
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('button', { name: /Chèn vào POU/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Mở POU và chèn/ })).toBeDisabled()
  })

  /* Bản nháp v1 có thể đang có đủ chương trình — chỉ là danh sách `objects`
     chưa tồn tại để đọc. Nói "chưa có POU nào" ở đây là mời người dùng đi tạo
     lại đúng thứ họ đang có. */
  it('bản nháp schema v1 nói đúng lý do, không nói "chưa có POU nào"', async () => {
    stub([entry()], {
      getProgrammingProject: () => Promise.resolve({
        projectId: PROJECT_ID, name: 'AHU', etag: ETAG, activeRevisionId: null,
        draftRevisionId: DRAFT_ID, baseRevisionId: DRAFT_ID, updatedAt: '2026-08-20T00:00:00Z',
        draft: { schemaVersion: 1, programs: [{ objectId: POU_ID, name: 'AHU_MAIN' }] }
      })
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('button', { name: /Chèn vào POU/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/chưa ở schema v2/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/chưa có POU nào để chèn vào/)).not.toBeInTheDocument()
  })

  it('chưa đọc được bản nháp thì nói ra, không hiện một danh sách POU rỗng', async () => {
    stub([entry()], { getProgrammingProject: () => Promise.reject(new Error('mạng hỏng')) })
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('button', { name: /Chèn vào POU/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Chưa đọc được bản nháp/)).toBeInTheDocument()
  })
})
