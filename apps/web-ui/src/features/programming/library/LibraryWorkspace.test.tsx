import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { LibraryPage } from './LibraryPage'
import { PROGRAMMING_ENDPOINTS, ProgrammingApiError, ProgrammingNoResponseError } from '../api/generated/client'
import { readLibraryInsertIntent } from '../shared/libraryInsertIntent'

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

/** `T61-404` — câu trả lời của đường đọc mã nguồn. */
const STORED_SOURCE = 'FUNCTION SCALE_LIN : REAL\nSCALE_LIN := 1.0;\nEND_FUNCTION\n'
function entrySource(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'PROJECT', libraryRevisionId: '33333333-3333-4333-8333-333333333333',
    libraryVersion: '1.0.0', libraryState: 'DRAFT', entryId: ENTRY_ID, name: 'SCALE_LIN',
    kind: 'FUNCTION', language: 'ST', contentSha256: 'a'.repeat(64),
    availability: 'AVAILABLE', source: STORED_SOURCE,
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
    /* `T61-401` — bước Kiểm tra gọi máy chủ. Mặc định "sạch" để test nào không
       nói gì về phép kiểm vẫn đi hết được wizard. */
    if (operationId === 'checkProgrammingLibraryEntry') {
      return Promise.resolve({ blocking: false, diagnostics: [], libraryVersion: '1.0.0' })
    }
    /* `T61-404` — mã nguồn đã lưu của đúng phiên bản. Mặc định là ĐỌC ĐƯỢC, để
       test nào không nói gì về mã nguồn vẫn đi hết được wizard Sửa. */
    if (operationId === 'getProgrammingLibraryEntrySource') {
      return Promise.resolve(entrySource())
    }
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

/**
 * `T61-406` / `ISS-PGM04-15` — "0 mutation" đo bằng PHƯƠNG THỨC HTTP, không
 * bằng một danh sách tên.
 *
 * Bản cũ khẳng định zero-mutation bằng `expect(written).not.toContain(
 * 'upsertProgrammingLibraryEntry')` — một danh sách cấm gồm hai cái tên. Một
 * đường ghi mới thêm vào ngày mai (và lát `T61-402`/`T61-404` đã thêm hai
 * operation chỉ trong tháng này) sẽ đi qua khẳng định ấy mà không có gì đỏ:
 * test không đo "không có phép ghi nào", nó chỉ đo "không có HAI phép ghi mà
 * người viết test hôm ấy nhớ ra".
 *
 * Đây đọc `PROGRAMMING_ENDPOINTS` — chính bảng do hợp đồng sinh ra — nên mọi
 * operation, kể cả operation chưa tồn tại lúc viết dòng này, đều được phân loại
 * đúng. Và một `operationId` KHÔNG có trong bảng thì ném lỗi chứ không im lặng
 * xếp vào "không phải mutation": một cái tên gõ sai không được trở thành một
 * bằng chứng.
 */
const READ_ONLY_POSTS = new Set(['checkProgrammingLibraryEntry'])

function mutationsIssued(): string[] {
  return client.request.mock.calls
    .map((call) => String(call[0]))
    .filter((operationId) => {
      const endpoint = (PROGRAMMING_ENDPOINTS as Record<string, { method: string } | undefined>)[operationId]
      if (!endpoint) throw new Error(`operationId không có trong hợp đồng: ${operationId}`)
      return endpoint.method !== 'GET' && !READ_ONLY_POSTS.has(operationId)
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
    await walkWizardAndSave(dialog, {
      metadata: () => {
        fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } })
        fireEvent.change(within(dialog).getByLabelText(/Phân loại/), { target: { value: 'math' } })
        fireEvent.change(within(dialog).getByLabelText(/Mô tả ngắn/), { target: { value: 'Dốc tuyến tính có giới hạn' } })
        fireEvent.change(within(dialog).getByLabelText(/Thẻ/), { target: { value: 'ahu, vav' } })
      },
      iface: () => fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } }),
      implementation: () =>
        fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), {
          target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' }
        })
    })

    await waitFor(() => expect(upsert).toHaveBeenCalled())
    const body = (upsert.mock.calls[0][1] as { body: Record<string, unknown> }).body
    expect(body.category).toBe('math')
    expect(body.description).toBe('Dốc tuyến tính có giới hạn')
    /* `tags` đã nằm trong hợp đồng ghi từ `T61-101` nhưng trước lát này KHÔNG có
       ô nào để nhập, nên mọi khối PROJECT vĩnh viễn không có thẻ và bộ lọc theo
       thẻ không bao giờ khớp một khối do người dùng tạo. */
    expect(body.tags).toEqual(['ahu', 'vav'])
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
    await walkWizardAndSave(dialog, {
      metadata: () => fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } }),
      iface: () => fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } }),
      implementation: () =>
        fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), {
          target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' }
        })
    })

    await waitFor(() => expect(upsert).toHaveBeenCalled())
    const body = (upsert.mock.calls[0][1] as { body: Record<string, unknown> }).body
    expect('category' in body).toBe(false)
    expect('description' in body).toBe(false)
    expect('tags' in body).toBe(false)
  })
})

/**
 * `T61-401` — đi hết wizard 5 bước tới nút Lưu.
 *
 * Mỗi bước là một màn riêng, nên một test ghi phải đi qua cả năm. Gói vào một
 * hàm để bước nào chặn nhầm thì mọi test ghi đỏ cùng lúc và chỉ đúng vào bước
 * ấy, thay vì mỗi test đỏ một kiểu.
 */
async function walkWizardAndSave(
  dialog: HTMLElement,
  fill: { metadata?: () => void; iface?: () => void; implementation?: () => void } = {}
) {
  const next = () => fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
  fill.metadata?.()
  next()
  fill.iface?.()
  next()
  fill.implementation?.()
  next()
  fireEvent.click(within(dialog).getByRole('button', { name: /Chạy kiểm tra trên máy chủ/ }))
  await waitFor(() => expect(within(dialog).queryByTestId('library-wizard-check-result')).not.toBeNull())
  next()
  fireEvent.click(within(dialog).getByRole('button', { name: /Lưu vào bản nháp thư viện/ }))
}

/*
`T61-401` / `ISS-PGM04-11` — hành vi của wizard 5 bước.

Đây là những điều KHÔNG có test nào canh trước lát này, và chính vì thế bản
trước là một form phẳng mà vẫn được ghi `DONE`: không ai đo được "đóng giữa
chừng có hỏi không", "Quay lại có mất dữ liệu không", "Lưu có đòi phép kiểm của
máy chủ không".
*/
describe('PGM-04 wizard soạn thảo 5 bước (T61-401)', () => {
  function openCreateWizard() {
    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))
    return screen.findByRole('dialog')
  }

  function fillFirstThreeSteps(dialog: HTMLElement, name = 'RAMP_LIN') {
    const next = () => fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: name } })
    next()
    fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } })
    next()
    fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), {
      target: { value: `FUNCTION ${name} : REAL\nEND_FUNCTION` }
    })
    next()
  }

  /* `AC-PGM04-03` — SYSTEM là registry bất biến. Mở một form ghi trên nó là hứa
     một thứ máy chủ sẽ từ chối, nên không có nút nào mở được. */
  it('khối SYSTEM không có đường nào mở được wizard ghi', async () => {
    stub([entry({ scope: 'SYSTEM', entryId: 'TON', name: 'TON', libraryRevisionId: 'system', libraryState: 'PUBLISHED' })])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    expect(screen.queryByRole('button', { name: /Sửa khối/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('đi tới rồi quay lại không mất dữ liệu đã nhập ở bước trước', async () => {
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    const dialog = await openCreateWizard()
    fillFirstThreeSteps(dialog)

    const back = () => fireEvent.click(within(dialog).getByRole('button', { name: 'Quay lại' }))
    back()
    expect(within(dialog).getByLabelText(/Mã nguồn ST/)).toHaveValue('FUNCTION RAMP_LIN : REAL\nEND_FUNCTION')
    back()
    expect(within(dialog).getByLabelText('Kiểu trả về')).toHaveValue('REAL')
    back()
    expect(within(dialog).getByLabelText(/Tên khối/)).toHaveValue('RAMP_LIN')
  })

  /* Đóng khi đang bẩn phải HỎI. Mất mười phút gõ vì một lần bấm nhầm ra ngoài
     là lỗi không có đường hoàn tác nào. */
  it('đóng giữa chừng khi đã nhập thì hỏi lại trước khi bỏ', async () => {
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    const dialog = await openCreateWizard()
    fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    expect(within(dialog).getByTestId('library-wizard-discard')).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Tiếp tục soạn/ }))
    expect(within(dialog).queryByTestId('library-wizard-discard')).toBeNull()
    expect(within(dialog).getByLabelText(/Tên khối/)).toHaveValue('RAMP_LIN')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Đóng và bỏ thay đổi/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('chưa nhập gì thì đóng ngay, không hỏi một câu vô nghĩa', async () => {
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    const dialog = await openCreateWizard()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  /*
  Bước Kiểm tra gọi MÁY CHỦ. Không có nó, wizard chỉ có luật của client, và luật
  của client không biết gì về thư viện Draft thật (tên đã dùng, phụ thuộc, vòng).
  */
  it('không sang được bước cuối khi máy chủ báo lỗi chặn, và hiện lỗi theo trường', async () => {
    const upsert = vi.fn()
    stub([entry()], {
      upsertProgrammingLibraryEntry: upsert,
      checkProgrammingLibraryEntry: () =>
        Promise.resolve({
          blocking: true,
          diagnostics: [{ field: 'dependencies', code: 'LIB_DEPENDENCY_CYCLE', message: 'Phụ thuộc tạo thành vòng: A → B → A.', severity: 'BLOCKING' }],
          libraryVersion: '1.0.0'
        })
    })
    renderPage()
    await screen.findByTestId('library-block-card')
    const dialog = await openCreateWizard()
    fillFirstThreeSteps(dialog)

    fireEvent.click(within(dialog).getByRole('button', { name: /Chạy kiểm tra trên máy chủ/ }))
    const result = await within(dialog).findByTestId('library-wizard-check-result')
    expect(result).toHaveTextContent('dependencies')
    expect(result).toHaveTextContent('LIB_DEPENDENCY_CYCLE')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    expect(within(dialog).getByTestId('library-wizard-check-required')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: /Lưu vào bản nháp thư viện/ })).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })

  /* Sửa tiếp SAU khi kiểm xong là một payload khác. Cho Lưu bằng kết quả cũ là
     đúng cái lỗ hổng mà bước Kiểm tra sinh ra để bịt. */
  it('kết quả kiểm hết hiệu lực ngay khi nội dung đổi, và Lưu bị khoá lại', async () => {
    const upsert = vi.fn().mockResolvedValue({ etag: ETAG, resource: { libraryRevisionId: DRAFT_ID }, auditId: 'a' })
    stub([entry()], { upsertProgrammingLibraryEntry: upsert })
    renderPage()
    await screen.findByTestId('library-block-card')
    const dialog = await openCreateWizard()
    fillFirstThreeSteps(dialog)

    fireEvent.click(within(dialog).getByRole('button', { name: /Chạy kiểm tra trên máy chủ/ }))
    await within(dialog).findByTestId('library-wizard-check-result')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    expect(within(dialog).getByRole('button', { name: /Lưu vào bản nháp thư viện/ })).toBeEnabled()

    // Quay lại sửa một ký tự: kết quả cũ không còn nói gì về payload hiện tại.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quay lại' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quay lại' }))
    fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), { target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION\n(*sửa*)' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    expect(within(dialog).getByTestId('library-wizard-check-stale')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    expect(within(dialog).getByTestId('library-wizard-check-required')).toBeVisible()
    expect(upsert).not.toHaveBeenCalled()
  })

  /* `AC-PGM04-05` — không có Publish rời. Bước Xem lại phải nói ra điều đó và
     không được mọc một nút nào khác ngoài Lưu vào bản nháp. */
  it('bước Xem lại liệt kê thay đổi kèm tác động và chỉ có đường ghi vào bản nháp', async () => {
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    const dialog = await openCreateWizard()
    fireEvent.change(within(dialog).getByLabelText(/Mô tả ngắn/), { target: { value: 'Khối dốc tuyến tính' } })
    fillFirstThreeSteps(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: /Chạy kiểm tra trên máy chủ/ }))
    await within(dialog).findByTestId('library-wizard-check-result')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))

    const table = within(dialog).getByTestId('library-wizard-changes')
    expect(within(table).getByTestId('library-wizard-change-source')).toHaveTextContent('Nội dung')
    expect(within(table).getByTestId('library-wizard-change-description')).toHaveTextContent('Trình bày')
    expect(within(dialog).queryByRole('button', { name: /Publish/i })).toBeNull()
    expect(within(dialog).getByText(/Không có Publish riêng/)).toBeInTheDocument()
  })

  /* A11y: mỗi bước là một màn mới. Không dời tiêu điểm thì người dùng bàn phím
     và trình đọc màn hình vẫn đứng ở nút vừa bấm, không biết màn đã đổi. */
  /* `ISS-PGUI-02` — `STEP_TITLES` là bảng CHỈ tiếng Việt, nên thanh tiến trình
     của wizard in "Thông tin · Giao diện · Hiện thực" giữa giao diện English.
     Bảng nay là cặp vi/en, và thêm một bước mới buộc phải viết cả hai vế. */
  it('ISS-PGUI-02: tên bước theo đúng ngôn ngữ đang chọn', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    fireEvent.click(screen.getByRole('button', { name: /New PROJECT block/ }))
    const dialog = await screen.findByRole('dialog')

    for (const title of ['Metadata', 'Interface', 'Implementation', 'Check', 'Review and save']) {
      expect(within(dialog).getAllByText(new RegExp(title)).length).toBeGreaterThan(0)
    }
    for (const vietnamese of ['Thông tin', 'Giao diện', 'Hiện thực', 'Xem lại và lưu']) {
      expect(within(dialog).queryByText(new RegExp(vietnamese))).not.toBeInTheDocument()
    }
    expect(within(dialog).getByRole('heading', { name: 'Metadata' })).toBeInTheDocument()
  })

  it('mỗi lần đổi bước, tiêu điểm về tiêu đề của bước đó', async () => {
    stub([entry()])
    renderPage()
    await screen.findByTestId('library-block-card')
    const dialog = await openCreateWizard()
    fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))

    const heading = within(dialog).getByRole('heading', { name: 'Giao diện' })
    expect(document.activeElement).toBe(heading)
    expect(within(dialog).getByTestId('library-wizard-step-interface')).toHaveAttribute('aria-current', 'step')
    expect(within(dialog).getByTestId('library-wizard-step-metadata')).not.toHaveAttribute('aria-current')
  })

  /*
  `T61-404` — sửa một khối đã lưu nay bắt đầu từ MÃ NGUỒN THẬT của đúng phiên
  bản ấy, không từ một ô trống.

  Đây là điều kiện để "Sửa" an toàn: upsert là phép ghi đè TOÀN PHẦN, nên bắt
  đầu từ rỗng nghĩa là mọi lần sửa mô tả đều đòi người dùng dán lại toàn bộ mã
  của một khối họ chưa từng nhìn thấy.
  */
  it('nạp mã nguồn đã lưu của ĐÚNG phiên bản đang sửa', async () => {
    const sourceCalls: Record<string, unknown>[] = []
    client.request.mockImplementation((operationId: string, options?: Record<string, unknown>) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'getProgrammingLibraryEntrySource') {
        sourceCalls.push((options?.query ?? {}) as Record<string, unknown>)
        return Promise.resolve(entrySource())
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('button', { name: /Sửa khối/ }))

    const dialog = await screen.findByRole('dialog')
    const next = () => fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    next()
    fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } })
    next()
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/Mã nguồn ST/)).toHaveValue(STORED_SOURCE))
    expect(within(dialog).queryByTestId('library-wizard-source-notice')).toBeNull()

    // Hỏi ĐÚNG phiên bản đang mở, không phải "bản mới nhất".
    expect(sourceCalls[0]).toMatchObject({
      libraryRevisionId: '33333333-3333-4333-8333-333333333333', entryId: ENTRY_ID
    })
  })

  /*
  Fail closed: máy chủ nói không có mã nguồn thì wizard NÓI RA, ô ở lại trống, và
  Lưu vẫn bị chặn. Điền một chuỗi rỗng rồi cho Lưu là ghi đè mất mã.
  */
  it('máy chủ không trả được mã nguồn thì nói rõ lý do, và vẫn không lưu được khi ô trống', async () => {
    const upsert = vi.fn()
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'getProgrammingLibraryEntrySource') {
        return Promise.resolve(entrySource({
          availability: 'HASH_MISMATCH', source: undefined,
          reason: 'Băm nội dung tính lại không khớp băm đã lưu của revision này'
        }))
      }
      if (operationId === 'upsertProgrammingLibraryEntry') return upsert()
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('button', { name: /Sửa khối/ }))

    const dialog = await screen.findByRole('dialog')
    const next = () => fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp' }))
    next()
    fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } })
    next()
    const notice = await within(dialog).findByTestId('library-wizard-source-notice')
    expect(notice).toHaveTextContent('không khớp băm đã lưu')
    expect(within(dialog).getByLabelText(/Mã nguồn ST/)).toHaveValue('')

    next()
    expect(within(dialog).getByTestId('library-wizard-issues')).toHaveTextContent('chưa trả lại mã nguồn')
    expect(upsert).not.toHaveBeenCalled()
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
    /* `T61-405` — điều hướng phải mang ĐỦ DANH TÍNH của khối. Trước lát này nó
       chỉ mang `pou`/`mode`/`returnTo`, nên người dùng chọn một khối rồi hạ cánh
       vào bộ soạn thảo mà KHÔNG có gì nói khối nào — thao tác chọn bị vứt đi. */
    const intent = readLibraryInsertIntent(lastLocation.slice(lastLocation.indexOf('?') + 1))
    expect(intent).toEqual({
      entryId: ENTRY_ID, libraryRevisionId: '33333333-3333-4333-8333-333333333333'
    })
    // Zero mutation: không một lệnh ghi nào được phát ra từ màn hình này.
    expect(mutationsIssued()).toEqual([])
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
    expect(mutationsIssued()).toEqual([])
  })

  /*
  `T61-406` — ca BỊ CHẶN cũng phải là 0 mutation, và trước lát này nó không có
  test nào: hai test zero-mutation cũ chỉ phủ "thành công" và "huỷ". Ca bị chặn
  là ca người dùng bấm vào một nút đang khoá, mở/đóng Inspector, đổi tab — tức
  đúng chuỗi thao tác dễ làm một màn hình phát ra một lượt ghi ngoài ý muốn.
  */
  it('mọi ca bị chặn cũng phát 0 mutation, kể cả khi người dùng cứ bấm', async () => {
    const blocked = [
      entry({ featureState: 'REVIEW_REQUIRED' }),
      entry({ libraryState: 'DEPRECATED' }),
      entry({ signature: undefined }),
      entry({
        compatibility: {
          state: 'REQUIRES_MIGRATION', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: 'pin cũ'
        }
      }),
    ]
    for (const item of blocked) {
      cleanup()
      client.request.mockReset()
      stub([item])
      renderPage()
      fireEvent.click(await screen.findByTestId('library-block-card'))
      const insert = screen.getByRole('button', { name: /Chèn vào POU/ })
      expect(insert).toBeDisabled()
      fireEvent.click(insert)
      // Không có bộ chọn POU nào mở ra, nên cũng không có đường xác nhận nào.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mutationsIssued()).toEqual([])
    }
  })

  /*
  `ISS-PGM04-15` — "Unknown compatibility ... không coi unknown là compatible".

  `UNKNOWN` không chặn (nó là mặc định của hợp đồng, và mọi entry SYSTEM đều
  mang nó), nên phép kiểm duy nhất còn lại là: nó có được NÓI RA không. Fixture
  mặc định không khai `compatibility`, tức đúng ca "máy chủ đời cũ / chưa đo".
  */
  it('tương thích chưa đo được thì NÓI RA cạnh nút Chèn, không im lặng cho qua', async () => {
    stub([entry()])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    expect(screen.getByRole('button', { name: /Chèn vào POU/ })).toBeEnabled()
    const reason = screen.getByTestId('library-insert-reason')
    expect(reason).toHaveAttribute('data-block', 'NONE')
    expect(reason).toHaveTextContent(/chưa đo được mức tương thích/)
    expect(reason).toHaveTextContent(/chưa có nghĩa là tương thích/)
  })

  it('gói đang vận hành pin version khác thì Chèn bị khoá kèm version cần migrate', async () => {
    stub([entry({
      compatibility: {
        state: 'REQUIRES_MIGRATION', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: 'pin cũ'
      }
    })])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    expect(screen.getByRole('button', { name: /Chèn vào POU/ })).toBeDisabled()
    expect(screen.getByTestId('library-insert-reason')).toHaveTextContent(/pin 1\.0\.0/)
  })

  /*
  Bản cũ liệt kê lý do trong `disabled`: `REVIEW_REQUIRED || DEPRECATED`. Nên
  `SIGNATURE_UNAVAILABLE` — lý do thứ ba, đã có trong thang bậc từ `T61-203` —
  lọt qua: nút vẫn bấm được, và dòng lý do bên cạnh nói "màn hình đang ở chế độ
  chỉ đọc", một câu SAI chỉ người dùng đi tìm nhầm nguyên nhân.
  */
  it('không đọc được chữ ký thì khoá Chèn, và nói ĐÚNG lý do đó', async () => {
    stub([entry({ signature: undefined })])
    renderPage()
    fireEvent.click(await screen.findByTestId('library-block-card'))
    expect(screen.getByRole('button', { name: /Chèn vào POU/ })).toBeDisabled()
    const reason = screen.getByTestId('library-insert-reason')
    expect(reason).toHaveAttribute('data-block', 'SIGNATURE_UNAVAILABLE')
    expect(reason).toHaveTextContent(/không đọc được chữ ký/)
    expect(reason).not.toHaveTextContent(/chế độ chỉ đọc/)
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


/*
`T61-402` / `ISS-PGM04-12` — máy chủ ĐÃ ghi nhưng phản hồi mất trên đường về.

Đây là ca nguy hiểm nhất của đường ghi và trước lát này nó không có test nào:
mọi lỗi mạng rơi vào một dải lỗi chung có nút bấm lại, và mỗi lần bấm lại sinh
một `X-Idempotency-Key` MỚI — nên máy chủ coi đó là một ý định khác và ghi thêm
một lần nữa.
*/
describe('PGM-04 đối soát lần ghi không rõ kết quả (T61-402)', () => {
  /**
   * Máy chủ giả: nó THẬT SỰ commit, chỉ có phản hồi là bị đánh rơi.
   *
   * `entryId` lấy từ CHÍNH payload vừa ghi chứ không đoán trước: wizard sinh
   * `entryId` bằng `createUuid()`, nên một id viết cứng ở đây sẽ làm phép đối
   * soát không bao giờ khớp — và test sẽ "chứng minh" một hành vi sai.
   */
  function serverThatCommitsThenDropsResponse() {
    const state = { committed: null as Record<string, unknown> | null, upsertCalls: [] as Record<string, unknown>[] }
    client.request.mockImplementation((operationId: string, options?: Record<string, unknown>) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') {
        const written = state.committed
        return Promise.resolve({
          items: written
            ? [entry(), entry({ entryId: written.entryId as string, name: written.name as string })]
            : [entry()]
        })
      }
      if (operationId === 'checkProgrammingLibraryEntry') {
        return Promise.resolve({ blocking: false, diagnostics: [], libraryVersion: '1.0.0' })
      }
      if (operationId === 'upsertProgrammingLibraryEntry') {
        state.upsertCalls.push(options ?? {})
        // Commit thật, rồi đánh rơi phản hồi.
        state.committed = (options?.body ?? {}) as Record<string, unknown>
        return Promise.reject(new ProgrammingNoResponseError('timeout', 15000))
      }
      if (operationId === 'listProgrammingLibraryUsages') {
        return Promise.resolve({
          sealed: { count: 0, truncated: false, items: [] },
          draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
        })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })
    return state
  }

  async function createBlockThatLosesItsResponse() {
    const state = serverThatCommitsThenDropsResponse()
    renderPage()
    await screen.findByTestId('library-block-card')
    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))
    const dialog = await screen.findByRole('dialog')
    await walkWizardAndSave(dialog, {
      metadata: () => fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } }),
      iface: () => fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } }),
      implementation: () =>
        fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), {
          target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' }
        })
    })
    return state
  }

  it('không nói "đã lưu" và cũng không nói "hỏng" — nói KHÔNG RÕ rồi tự đọc lại một lượt', async () => {
    const state = await createBlockThatLosesItsResponse()

    const notice = await screen.findByTestId('library-mutation-unknown')
    expect(notice).toHaveTextContent('Chưa rõ kết quả')
    expect(notice).toHaveTextContent('máy chủ không trả lời kịp')
    // Không có băng xác nhận lạc quan nào.
    expect(screen.queryByText(/Máy chủ xác nhận/)).toBeNull()

    // Phép đọc lại hội tụ: entry đã có trên máy chủ nên băng biến mất.
    await waitFor(() => expect(screen.queryByTestId('library-mutation-unknown')).toBeNull())
    // Và ĐÚNG MỘT lệnh ghi đã được phát ra trong suốt quá trình.
    expect(state.upsertCalls).toHaveLength(1)
  })

  it('trong lúc chưa ngã ngũ, mọi hành động ghi bị khoá', { timeout: 20000 }, async () => {
    /* Máy chủ KHÔNG commit ở ca này, nên phép đọc lại không xác nhận được và
       băng "không rõ" ở lại — đúng cửa sổ mà UI phải khoá. */
    const upsertCalls: Record<string, unknown>[] = []
    client.request.mockImplementation((operationId: string, options?: Record<string, unknown>) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'checkProgrammingLibraryEntry') {
        return Promise.resolve({ blocking: false, diagnostics: [], libraryVersion: '1.0.0' })
      }
      if (operationId === 'upsertProgrammingLibraryEntry') {
        upsertCalls.push(options ?? {})
        return Promise.reject(new ProgrammingNoResponseError('network', 15000))
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await screen.findByTestId('library-block-card')
    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))
    const dialog = await screen.findByRole('dialog')
    await walkWizardAndSave(dialog, {
      metadata: () => fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } }),
      iface: () => fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } }),
      implementation: () =>
        fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), {
          target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' }
        })
    })

    await screen.findByTestId('library-mutation-unknown')
    // Trần đối soát là 4 lượt × 750 ms, nên chỗ này phải chờ lâu hơn mặc định 1 s.
    await waitFor(() => expect(screen.getByTestId('library-mutation-unresolved')).toBeVisible(),
      { timeout: 6000 })
    expect(screen.getByRole('button', { name: /Khối PROJECT mới/ })).toBeDisabled()
    // Và vẫn đúng MỘT lệnh ghi: phép đọc lại không phát ra mutation nào.
    expect(upsertCalls).toHaveLength(1)
  })

  /*
  `AC` — "Reconcile tạo idempotency key mới" là điều kiện KHÔNG ĐƯỢC ĐÓNG. Gửi
  lại phải là REPLAY của đúng ý định cũ: cùng khoá, cùng `If-Match`. Máy chủ băm
  cả hai vào hash ngữ nghĩa của request, nên đổi một trong hai là gửi một ý định
  khác — khoá mới thì được ghi thêm lần nữa, ETag mới thì bị từ chối là xung đột
  idempotency.
  */
  it('gửi lại dùng ĐÚNG khoá idempotency và ĐÚNG If-Match cũ, không sinh danh tính mới', { timeout: 20000 }, async () => {
    const upsertCalls: Record<string, unknown>[] = []
    client.request.mockImplementation((operationId: string, options?: Record<string, unknown>) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'checkProgrammingLibraryEntry') {
        return Promise.resolve({ blocking: false, diagnostics: [], libraryVersion: '1.0.0' })
      }
      if (operationId === 'upsertProgrammingLibraryEntry') {
        upsertCalls.push(options ?? {})
        if (upsertCalls.length === 1) return Promise.reject(new ProgrammingNoResponseError('abort', 15000))
        // Lần gửi lại: máy chủ nhận ra cùng ý định và replay biên nhận.
        return Promise.resolve({ resource: { libraryRevisionId: DRAFT_ID }, etag: ETAG, auditId: 'a' })
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await screen.findByTestId('library-block-card')
    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))
    const dialog = await screen.findByRole('dialog')
    await walkWizardAndSave(dialog, {
      metadata: () => fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } }),
      iface: () => fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } }),
      implementation: () =>
        fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), {
          target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' }
        })
    })

    await screen.findByTestId('library-mutation-unknown')
    await waitFor(() => expect(screen.getByRole('button', { name: /Gửi lại đúng thao tác cũ/ })).toBeEnabled(),
      { timeout: 6000 })
    fireEvent.click(screen.getByRole('button', { name: /Gửi lại đúng thao tác cũ/ }))

    await waitFor(() => expect(upsertCalls).toHaveLength(2))
    expect(upsertCalls[1].idempotencyKey).toBe(upsertCalls[0].idempotencyKey)
    expect(upsertCalls[1].ifMatch).toBe(upsertCalls[0].ifMatch)
  })

  it('409 vẫn đi đường XUNG ĐỘT (tải lại), không lẫn sang đường không-rõ', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'checkProgrammingLibraryEntry') {
        return Promise.resolve({ blocking: false, diagnostics: [], libraryVersion: '1.0.0' })
      }
      if (operationId === 'upsertProgrammingLibraryEntry') {
        return Promise.reject(new ProgrammingApiError(409, {
          error: {
            code: 'PRG-ERR-CONFLICT-001', messageKey: 'programming.error.conflict',
            retryable: false, keepsRunningRevision: true, correlationId: 'c'
          }
        } as never))
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await screen.findByTestId('library-block-card')
    fireEvent.click(screen.getByRole('button', { name: /Khối PROJECT mới/ }))
    const dialog = await screen.findByRole('dialog')
    await walkWizardAndSave(dialog, {
      metadata: () => fireEvent.change(within(dialog).getByLabelText(/Tên khối/), { target: { value: 'RAMP_LIN' } }),
      iface: () => fireEvent.change(within(dialog).getByLabelText('Kiểu trả về'), { target: { value: 'REAL' } }),
      implementation: () =>
        fireEvent.change(within(dialog).getByLabelText(/Mã nguồn ST/), {
          target: { value: 'FUNCTION RAMP_LIN : REAL\nEND_FUNCTION' }
        })
    })

    expect((await screen.findAllByText(/Bản nháp đã thay đổi ở phiên khác/))[0]).toBeVisible()
    expect(screen.queryByTestId('library-mutation-unknown')).toBeNull()
  })
})


/*
`T61-404` / `ISS-PGM04-13` — Preview mã nguồn ở Inspector.

Trước lát này Inspector không có Preview và hợp đồng đọc không mang `source`, nên
người dùng phải quyết định có chèn một khối hay không mà không đọc được nó.
*/
describe('PGM-04 Preview mã nguồn (T61-404)', () => {
  async function openSourceTab() {
    fireEvent.click(await screen.findByTestId('library-block-card'))
    fireEvent.click(screen.getByRole('tab', { name: 'Mã nguồn' }))
  }

  it('hiện mã nguồn đã lưu kèm danh tính phiên bản, và hỏi ĐÚNG revision đang mở', async () => {
    const sourceCalls: Record<string, unknown>[] = []
    client.request.mockImplementation((operationId: string, options?: Record<string, unknown>) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'getProgrammingLibraryEntrySource') {
        sourceCalls.push((options?.query ?? {}) as Record<string, unknown>)
        return Promise.resolve(entrySource())
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await openSourceTab()

    const viewer = await screen.findByTestId('library-source-viewer')
    expect(viewer).toHaveValue(STORED_SOURCE)
    expect(viewer).toHaveAttribute('readonly')
    /* Danh tính phiên bản phải nằm NGAY TRÊN nội dung: đọc một đoạn mã mà không
       biết nó thuộc bản nào thì không dùng để quyết định được gì. */
    expect(screen.getByTestId('library-source-identity')).toHaveTextContent('1.0.0')
    expect(sourceCalls[0]).toMatchObject({
      libraryRevisionId: '33333333-3333-4333-8333-333333333333', entryId: ENTRY_ID
    })
    // Preview là đường ĐỌC: không một lệnh ghi nào rời màn hình.
    const written = client.request.mock.calls.map((call) => call[0])
    expect(written).not.toContain('upsertProgrammingLibraryEntry')
    expect(written).not.toContain('deleteProgrammingLibraryEntry')
  })

  /* Không bao giờ dựng mã nguồn từ chữ ký: ghép một khung ST "trông giống" từ
     `interface` là bịa ra một thứ chưa từng chạy trên thiết bị nào. */
  it('khối SYSTEM nói ra vì sao không có mã nguồn, và KHÔNG dựng mã từ chữ ký', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') {
        return Promise.resolve({
          items: [entry({ scope: 'SYSTEM', entryId: 'TON', name: 'TON', libraryRevisionId: 'system-rev', libraryState: 'PUBLISHED' })]
        })
      }
      if (operationId === 'getProgrammingLibraryEntrySource') {
        return Promise.resolve(entrySource({
          scope: 'SYSTEM', libraryRevisionId: 'system-rev', libraryState: 'PUBLISHED',
          entryId: 'TON', name: 'TON', language: undefined, source: undefined,
          availability: 'NOT_STORED',
          reason: 'Entry SYSTEM thuộc registry chữ ký; phần hiện thực nằm trong firmware'
        }))
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'UNAVAILABLE'
      })
    })
    renderPage()
    await openSourceTab()

    const notice = await screen.findByTestId('library-source-unavailable')
    expect(notice).toHaveAttribute('data-availability', 'NOT_STORED')
    expect(notice).toHaveTextContent('nằm trong firmware')
    expect(screen.queryByTestId('library-source-viewer')).toBeNull()
  })

  it('băm lệch thì báo và KHÔNG hiện mã nguồn nào', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'getProgrammingLibraryEntrySource') {
        return Promise.resolve(entrySource({
          availability: 'HASH_MISMATCH', source: undefined,
          reason: 'Băm nội dung tính lại không khớp băm đã lưu của revision này'
        }))
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await openSourceTab()

    const notice = await screen.findByTestId('library-source-unavailable')
    expect(notice).toHaveAttribute('data-availability', 'HASH_MISMATCH')
    expect(screen.queryByTestId('library-source-viewer')).toBeNull()
  })

  it('đọc hỏng thì hiện lỗi kèm đường thử lại, không im lặng hiện ô trống', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectListPage())
      if (operationId === 'getProgrammingProject') return Promise.resolve(projectDetail())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'getProgrammingLibraryEntrySource') {
        return Promise.reject(new ProgrammingNoResponseError('timeout', 15000))
      }
      return Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] }, availability: 'SEALED_ONLY'
      })
    })
    renderPage()
    await openSourceTab()

    expect(await screen.findByTestId('library-source-error')).toBeVisible()
    expect(screen.queryByTestId('library-source-viewer')).toBeNull()
    expect(screen.getByRole('button', { name: /Thử đọc lại/ })).toBeEnabled()
  })
})
