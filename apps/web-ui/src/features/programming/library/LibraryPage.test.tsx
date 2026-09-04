import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ProgrammingApiError } from '../api/generated/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { LibraryPage } from './LibraryPage'

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
const ENTRY_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_ETAG = '"22222222-2222-4222-8222-222222222222:3"'
const NEXT_ETAG = '"22222222-2222-4222-8222-222222222222:4"'

function projectPage() {
  return {
    items: [
      {
        projectId: PROJECT_ID,
        name: 'AHU',
        etag: PROJECT_ETAG,
        activeRevisionId: null,
        draftRevisionId: '22222222-2222-4222-8222-222222222222',
        baseRevisionId: '22222222-2222-4222-8222-222222222222',
        updatedAt: '2026-08-20T00:00:00Z'
      }
    ]
  }
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'PROJECT',
    libraryRevisionId: '33333333-3333-4333-8333-333333333333',
    libraryVersion: '1.0.0',
    libraryState: 'DRAFT',
    entryId: '44444444-4444-4444-8444-444444444444',
    kind: 'FUNCTION',
    name: 'SCALE_LIN',
    language: 'ST',
    featureState: 'AVAILABLE',
    contentSha256: 'a'.repeat(64),
    dependencies: [],
    stateLayoutKnown: true,
    stateSizeBytes: 0,
    ...overrides
  }
}

function stub(libraryResponse: () => Promise<unknown>, overrides: Record<string, () => Promise<unknown>> = {}) {
  client.request.mockImplementation((operationId: string) => {
    if (overrides[operationId]) return overrides[operationId]()
    if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
    if (operationId === 'searchProgrammingLibraries') return libraryResponse()
    return Promise.reject(new Error('unexpected ' + operationId))
  })
}

/* `T61-302` — URL là một phần của hợp đồng màn hình này (tab + bộ lọc + khối
   đang chọn), nên test phải ĐỌC được nó, không chỉ dựng nó. */
let lastLocation = ''
function LocationProbe() {
  const location = useLocation()
  lastLocation = `${location.pathname}${location.search}`
  return null
}

/**
 * Như `renderPage` nhưng có `<Route path>` THẬT, nên `useParams().projectId` có
 * ngay từ render đầu — đúng đường mà ứng dụng chạy.
 *
 * `renderPage` cố ý KHÔNG có Route: nó mô phỏng lối vào cũ
 * `/eng/programming/library`, nơi Project chỉ biết được sau khi danh sách về.
 * Hai lối vào ấy khác nhau ở đúng chỗ lát này chạm tới (thời điểm tab mặc định
 * ngã ngũ), nên trộn chúng vào một helper là để một nửa hành vi không ai đo.
 */
function renderPageWithRoute(path = `/eng/programming/projects/${PROJECT_ID}/library`) {
  lastLocation = ''
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/eng/programming/projects/:projectId/library" element={<LibraryPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>
  )
}

function renderPage(path = `/eng/programming/projects/${PROJECT_ID}/library`) {
  lastLocation = ''
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <LibraryPage />
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  // Ghim ngôn ngữ: `detectDefaultLang` theo `navigator.language`, nên test khoá
  // chuỗi tiếng Việt sẽ đỏ/xanh theo locale của máy chạy nếu không ghim.
  localStorage.setItem('mkddc-lang', 'vi')
  auth.role = 'admin'
  client.request.mockReset()
})
afterEach(cleanup)

describe('PGM-04 Control Library', () => {
  it('hiện danh sách trộn SYSTEM và PROJECT, chọn được để xem chi tiết', async () => {
    stub(() => Promise.resolve({ items: [entry(), entry({ scope: 'SYSTEM', entryId: 'TON', name: 'TON', kind: 'FUNCTION_BLOCK', libraryRevisionId: 'system', libraryState: 'PUBLISHED', stateLayoutKnown: true, stateSizeBytes: 16 })] }))
    renderPage()
    expect(await screen.findByRole('button', { name: /SCALE_LIN/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TON/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /SCALE_LIN/ }))
    expect(await screen.findAllByText('1.0.0 · DRAFT')).toHaveLength(2)
  })

  /*
  `T61-206` — ba màn hình "không có gì để xem" là BA trạng thái riêng.

  Bản trước gộp chúng: `groups.length === 0` cho ra cùng câu "không khớp bộ
  lọc" kể cả khi KHÔNG có bộ lọc nào. Câu đó đổ lỗi cho một bộ lọc không tồn
  tại, và người dùng sẽ đi xoá bộ lọc thay vì đi tạo khối.
  */
  it('thư viện trống mời TẠO KHỐI, không đổ lỗi cho bộ lọc không tồn tại', async () => {
    stub(() => Promise.resolve({ items: [] }))
    renderPage()
    expect(await screen.findByText(/Thư viện của Project này chưa có khối nào/)).toBeInTheDocument()
    expect(screen.queryByText(/khớp bộ lọc/)).not.toBeInTheDocument()
  })

  it('có bộ lọc mà 0 kết quả thì mới nói về bộ lọc', async () => {
    stub(() => Promise.resolve({ items: [] }))
    renderPage()
    await screen.findByText(/Thư viện của Project này chưa có khối nào/)
    fireEvent.change(screen.getByLabelText(/Tìm theo tên hoặc mô tả/), { target: { value: 'khong-ton-tai' } })
    expect(await screen.findByText(/Không có khối nào khớp bộ lọc/)).toBeInTheDocument()
  })

  it('lỗi đọc KHÔNG bị trình bày như một thư viện rỗng', async () => {
    // Danh sách rỗng đọc như "thư viện không có gì"; sự thật ở đây là "không
    // đọc được thư viện". Hai câu dẫn tới hai hành động khác nhau.
    stub(() => Promise.reject(new Error('mạng lỗi')))
    renderPage()
    expect(await screen.findByText(/Không tải được Thư viện điều khiển/)).toBeInTheDocument()
    expect(screen.queryByText(/chưa có khối nào/)).not.toBeInTheDocument()
    expect(screen.queryByText(/khớp bộ lọc/)).not.toBeInTheDocument()
  })

  // `stateLayoutKnown=false` KHÔNG được hiển thị là "0 B": đó là chưa biết, và
  // hiện 0 sẽ làm người dùng tin một con số chưa ai tính.
  it('phân biệt state chưa biết với state bằng 0', async () => {
    stub(() => Promise.resolve({ items: [entry({ kind: 'FUNCTION_BLOCK', name: 'FILTER_T1', stateLayoutKnown: false, stateSizeBytes: 0 })] }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /FILTER_T1/ }))
    expect(await screen.findByText(/Chưa biết — chờ biên dịch/)).toBeInTheDocument()
    expect(screen.queryByText('0 B')).not.toBeInTheDocument()
  })

  // PID còn nhãn REVIEW_REQUIRED: trang CHỈ cảnh báo, và tuyệt đối không có ô
  // tick nào để "duyệt" — token phê duyệt suy ra từ contract profile (T59-205).
  it('cảnh báo feature chờ review Controls/Safety mà không cho duyệt tại UI', async () => {
    stub(() => Promise.resolve({ items: [entry({ scope: 'SYSTEM', entryId: 'PID', name: 'PID', kind: 'FUNCTION_BLOCK', libraryRevisionId: 'system', libraryState: 'PUBLISHED', featureState: 'REVIEW_REQUIRED' })] }))
    renderPage()
    expect(await screen.findByText(/Chờ review Controls\/Safety/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /PID/ }))
    expect(await screen.findByRole('note')).toHaveTextContent(/Kiểm tra sẽ từ chối/)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  /*
  `SPEC-PGM04-VISUAL-001` §3 — thiếu quyền thì nút ghi VẪN THẤY và bị khoá kèm
  lý do; ẩn nó đi bị cấm. Ẩn nút làm người dùng tưởng thiết bị không có khả năng
  đó rồi đi hỏi sai người, thay vì đi xin quyền.

  Câu lý do cũng phải đúng chính sách: quyền ghi là `program.edit`
  (`engineer` + `admin`), nên nói "chỉ tài khoản quản trị" là mô tả sai một
  chính sách mà máy chủ không hề ép.
  */
  it('viewer đọc được, nút tạo khối vẫn thấy nhưng bị khoá kèm lý do', async () => {
    auth.role = 'viewer'
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage()
    expect(await screen.findByRole('button', { name: /SCALE_LIN/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lưu vào bản nháp thư viện/ })).not.toBeInTheDocument()
    const create = screen.getByRole('button', { name: /Khối PROJECT mới/ })
    expect(create).toBeDisabled()
    expect(screen.getByText(/Vai hiện tại không sửa được Thư viện điều khiển/)).toBeInTheDocument()
    expect(create).toHaveAttribute('aria-describedby', 'library-create-reason')
    fireEvent.click(screen.getByRole('button', { name: /SCALE_LIN/ }))
    expect(screen.queryByRole('button', { name: /Ngừng sử dụng phiên bản/ })).not.toBeInTheDocument()
  })

  it('chỉ deprecate bản PUBLISHED sau xác nhận và đọc lại đúng revision từ máy chủ', async () => {
    const publishedRevisionId = '55555555-5555-4555-8555-555555555555'
    let deprecated = false
    let mutationOptions: {
      path?: Record<string, string>
      body?: Record<string, unknown>
      ifMatch?: string
      idempotencyKey?: string
      correlationId?: string
    } | undefined
    client.request.mockImplementation((operationId: string, options?: typeof mutationOptions) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'getProgrammingProject') return Promise.reject(new Error('không cần Draft trong test deprecate'))
      if (operationId === 'searchProgrammingLibraries') {
        return Promise.resolve({
          items: [
            entry({
              libraryRevisionId: publishedRevisionId,
              libraryState: deprecated ? 'DEPRECATED' : 'PUBLISHED'
            })
          ]
        })
      }
      if (operationId === 'deprecateProgrammingLibraryRevision') {
        mutationOptions = options
        deprecated = true
        return Promise.resolve({
          resource: {
            projectId: PROJECT_ID,
            draftRevisionId: '22222222-2222-4222-8222-222222222222',
            libraryRevisionId: publishedRevisionId,
            libraryVersion: '1.0.0',
            libraryState: 'DEPRECATED'
          },
          etag: NEXT_ETAG,
          auditId: 'audit-deprecate',
          correlationId: 'correlation-deprecate'
        })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /SCALE_LIN/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ngừng sử dụng phiên bản 1.0.0' }))

    const dialog = await screen.findByRole('dialog', { name: /Ngừng sử dụng phiên bản thư viện/ })
    expect(dialog).toHaveTextContent(/Toàn bộ phiên bản PROJECT Library này sẽ chuyển sang DEPRECATED/)
    expect(dialog).toHaveTextContent(publishedRevisionId)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ngừng sử dụng' }))

    await waitFor(() => expect(mutationOptions).toBeDefined())
    expect(mutationOptions).toMatchObject({
      path: { projectId: PROJECT_ID, libraryRevisionId: publishedRevisionId },
      body: { schemaVersion: '1.0' },
      ifMatch: PROJECT_ETAG
    })
    expect(mutationOptions?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(mutationOptions?.correlationId).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('status')
          .some((notice) => notice.textContent?.includes('Máy chủ xác nhận phiên bản thư viện 1.0.0 · DEPRECATED'))
      ).toBe(true)
    })
    expect(screen.queryByRole('button', { name: /Ngừng sử dụng phiên bản/ })).not.toBeInTheDocument()
  })

  it('không hiện hành động deprecate cho bản DRAFT hoặc DEPRECATED', async () => {
    stub(() =>
      Promise.resolve({
        items: [
          entry({ libraryRevisionId: '66666666-6666-4666-8666-666666666666', libraryVersion: '1.1.0', libraryState: 'DRAFT' }),
          entry({ libraryRevisionId: '55555555-5555-4555-8555-555555555555', libraryVersion: '1.0.0', libraryState: 'DEPRECATED' })
        ]
      })
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /SCALE_LIN/ }))
    expect(screen.queryByRole('button', { name: /Ngừng sử dụng phiên bản/ })).not.toBeInTheDocument()
  })

  // Mutation library đi chung lane concurrency với tài liệu Draft: sau khi lưu,
  // trang phải dùng ETag MỚI, nếu không thao tác kế tiếp bị 409 vô cớ.
  it('gửi If-Match và dùng lại ETag mới cho thao tác kế tiếp', async () => {
    const etags: (string | undefined)[] = []
    stub(() => Promise.resolve({ items: [entry()] }), {
      upsertProgrammingLibraryEntry: () => Promise.resolve({ resource: {}, etag: NEXT_ETAG, auditId: 'a', correlationId: 'c' }),
      deleteProgrammingLibraryEntry: () => Promise.resolve({ resource: {}, etag: NEXT_ETAG, auditId: 'a', correlationId: 'c' })
    })
    client.request.mockImplementation((operationId: string, options?: { ifMatch?: string }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries') return Promise.resolve({ items: [entry()] })
      if (operationId === 'getProgrammingProject') return Promise.reject(new Error('không cần Draft trong test ETag'))
      if (operationId !== 'upsertProgrammingLibraryEntry' && operationId !== 'deleteProgrammingLibraryEntry') {
        return Promise.reject(new Error('unexpected ' + operationId))
      }
      etags.push(options?.ifMatch)
      return Promise.resolve({ resource: {}, etag: NEXT_ETAG, auditId: 'a', correlationId: 'c' })
    })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Khối PROJECT mới/ }))
    fireEvent.change(await screen.findByLabelText(/Tên khối/), { target: { value: 'HELPER' } })
    fireEvent.change(screen.getByLabelText(/Mã nguồn ST/), { target: { value: 'FUNCTION HELPER : REAL\nEND_FUNCTION\n' } })
    fireEvent.click(screen.getByRole('button', { name: /Lưu vào bản nháp thư viện/ }))
    await waitFor(() => expect(etags).toEqual([PROJECT_ETAG]))

    fireEvent.click(screen.getByRole('button', { name: /SCALE_LIN/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Xoá khối/ }))
    await waitFor(() => expect(etags).toEqual([PROJECT_ETAG, NEXT_ETAG]))
  })

  it('giữ nguyên interface canonical khi sửa entry thay vì xoá ngầm hợp đồng POU', async () => {
    const canonicalInterface = {
      inputs: [{ name: 'X', type: 'REAL' }],
      returnType: 'REAL'
    }
    let mutationBody: Record<string, unknown> | undefined
    client.request.mockImplementation((operationId: string, options?: { body?: Record<string, unknown> }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'getProgrammingProject') return Promise.reject(new Error('không cần Draft trong test interface'))
      if (operationId === 'searchProgrammingLibraries') {
        return Promise.resolve({ items: [entry({ interface: canonicalInterface })] })
      }
      if (operationId === 'upsertProgrammingLibraryEntry') {
        mutationBody = options?.body
        return Promise.resolve({ resource: {}, etag: NEXT_ETAG, auditId: 'a', correlationId: 'c' })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /SCALE_LIN/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sửa khối/ }))
    fireEvent.change(screen.getByLabelText(/Mã nguồn ST/), {
      target: { value: 'FUNCTION SCALE_LIN : REAL\nVAR_INPUT X : REAL; END_VAR\nSCALE_LIN := X;\nEND_FUNCTION\n' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Lưu vào bản nháp thư viện/ }))

    await waitFor(() => expect(mutationBody).toBeDefined())
    expect(mutationBody).toMatchObject({ interface: canonicalInterface })
  })

  it('đổi nhãn vùng nhập theo ST hoặc FBD để không mô tả sai payload', async () => {
    stub(() => Promise.resolve({ items: [] }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Khối PROJECT mới/ }))
    expect(screen.getByLabelText('Mã nguồn ST')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Ngôn ngữ'), { target: { value: 'FBD' } })
    expect(screen.getByLabelText('Nội dung FBD (JSON)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Mã nguồn ST')).not.toBeInTheDocument()
  })

  it('đổi bộ lọc là tải lại từ server, không lọc trên trang đã cắt', async () => {
    const queries: unknown[] = []
    client.request.mockImplementation((operationId: string, options?: { query?: unknown }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      queries.push(options?.query)
      return Promise.resolve({ items: [entry()] })
    })
    renderPage()
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    /* `T61-302` — phạm vi nay là TAB, không phải ô chọn. Bấm tab phải phát một
       request MỚI mang `scope`, chứ không lọc lại trang đang cầm: lọc phía
       client chỉ đúng trên phần đã tải, và người dùng đọc kết quả ấy như thể nó
       phủ cả thư viện. */
    fireEvent.click(screen.getByTestId('library-scope-tab-SYSTEM'))
    await waitFor(() => expect(queries.length).toBeGreaterThan(1))
    expect(queries[queries.length - 1]).toMatchObject({ scope: 'SYSTEM' })
  })

  /* Mặc định là tab DỰ ÁN khi có Project: đây là Thư viện CỦA một Project, và
     mọi đường ghi chỉ áp cho khối PROJECT. Request đầu tiên phải mang đúng
     phạm vi ấy — nếu không, màn hình mở ra ở một danh sách rồi lặng lẽ đổi
     sang danh sách khác. */
  it('mở ra ở tab Dự án khi có Project, và KHÔNG bắn lượt nào với tab sai trước đó', async () => {
    const searches: unknown[] = []
    client.request.mockImplementation((operationId: string, options?: { query?: unknown }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries') searches.push(options?.query)
      return Promise.resolve({ items: [entry()] })
    })
    renderPageWithRoute()
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    expect(screen.getByTestId('library-scope-tab-PROJECT')).toHaveAttribute('aria-selected', 'true')
    /* Số TUYỆT ĐỐI ở phần tử ĐẦU: lối vào cũ không mang `projectId` trên route,
       nên nó chỉ biết Project sau khi danh sách về. Hỏi trước lúc đó là bắn một
       lượt với tab mặc định SAI rồi đổi tab ngay sau đó — request thừa, và
       người dùng thấy tab nhảy. Khẳng định "có một lượt PROJECT ở đâu đó" sẽ
       xanh cả với bản bắn hai lượt. */
    expect(searches[0]).toMatchObject({ scope: 'PROJECT' })
  })

  /* URL chuẩn tắc: tab mặc định KHÔNG để lại tham số. Hai đường dẫn khác nhau
     mô tả cùng một màn hình thì người dùng không biết cái nào để gửi đi. */
  it('chọn lại tab mặc định thì XOÁ tham số scope khỏi URL', async () => {
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage()
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    fireEvent.click(screen.getByTestId('library-scope-tab-SYSTEM'))
    await waitFor(() => expect(lastLocation).toContain('scope=SYSTEM'))
    fireEvent.click(screen.getByTestId('library-scope-tab-PROJECT'))
    await waitFor(() => expect(lastLocation).not.toContain('scope='))
  })

  /* "Xoá bộ lọc" KHÔNG đổi tab: tab là điều hướng, và người dùng vừa xoá bộ lọc
     không có nghĩa là họ muốn rời khỏi danh sách đang xem. */
  it('xoá bộ lọc giữ nguyên tab và chỉ bỏ các tham số lọc', async () => {
    stub(() => Promise.resolve({ items: [] }))
    renderPage(`/eng/programming/projects/${PROJECT_ID}/library?scope=SYSTEM&kind=FUNCTION&q=pid`)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xoá bộ lọc' }))[0])
    await waitFor(() => expect(lastLocation).not.toContain('kind='))
    expect(lastLocation).not.toContain('q=')
    expect(lastLocation).toContain('scope=SYSTEM')
  })

  /* FAIL-CLOSED: tab Dự án mà không phân giải được `projectId` thì KHÔNG gửi
     request nào. Store từ chối yêu cầu ấy ("PROJECT library search bắt buộc
     projectId"), và lỗi đó lên màn hình dưới dạng một sự cố máy chủ — trong khi
     sự thật là ngữ cảnh còn thiếu mà FE biết trước. */
  it('tab Dự án không có Project: không gọi máy chủ, và nói đúng lý do', async () => {
    const queries: unknown[] = []
    client.request.mockImplementation((operationId: string, options?: { query?: unknown }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [] })
      queries.push(options?.query)
      return Promise.resolve({ items: [entry()] })
    })
    renderPage('/eng/programming/library?scope=PROJECT')
    expect(await screen.findByText(/Chưa chọn Project nên chưa đọc được thư viện của Project/))
      .toBeInTheDocument()
    expect(queries).toEqual([])
  })

  /* Không có tab `USER`: sản phẩm không có phạm vi ấy ở API lẫn Product
     authority. Một URL cố tình yêu cầu nó rơi về mặc định, KHÔNG tạo tab thứ ba
     — một tab rỗng vẽ ra một khả năng không tồn tại. */
  it('URL đòi scope=USER không tạo tab thứ ba', async () => {
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage(`/eng/programming/projects/${PROJECT_ID}/library?scope=USER`)
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    const tabs = within(screen.getByRole('tablist', { name: 'Phạm vi thư viện' })).getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByTestId('library-scope-tab-PROJECT')).toHaveAttribute('aria-selected', 'true')
  })

  /* `SPEC-PGM04-VISUAL-001` §5 — cả dải tab tốn ĐÚNG MỘT nhịp `Tab`, mũi tên đi
     giữa các tab. Một dải hai tab ăn hai nhịp `Tab` trước khi tới nội dung là
     thứ người dùng bàn phím phải trả giá ở mọi lần vào trang. */
  it('dải tab phạm vi: một điểm dừng Tab, mũi tên chuyển tab và đổi URL', async () => {
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage()
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    const tablist = screen.getByRole('tablist', { name: 'Phạm vi thư viện' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1)

    /* Phải bấm CẢ HAI chiều. Một test chỉ dùng `ArrowLeft` sẽ xanh với bản làm
       hỏng riêng `ArrowRight` — và người dùng đi tới cuối dải rồi không quay
       lại được là đúng nửa bàn phím bị hỏng mà không ai đo. */
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    await waitFor(() => expect(screen.getByTestId('library-scope-tab-SYSTEM')).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(lastLocation).toContain('scope=SYSTEM'))

    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByTestId('library-scope-tab-PROJECT')).toHaveAttribute('aria-selected', 'true'))

    fireEvent.keyDown(tablist, { key: 'Home' })
    await waitFor(() => expect(screen.getByTestId('library-scope-tab-SYSTEM')).toHaveAttribute('aria-selected', 'true'))

    fireEvent.keyDown(tablist, { key: 'End' })
    await waitFor(() => expect(screen.getByTestId('library-scope-tab-PROJECT')).toHaveAttribute('aria-selected', 'true'))
  })

  /* `SPEC-PGM04-VISUAL-001` §1 — dưới 768 px bộ lọc thu vào MỘT nút.
     Bốn ô lọc ở khổ hẹp chiếm gần hết màn hình, nên danh sách — thứ người dùng
     tới để đọc — bị đẩy xuống dưới nếp gấp. */
  it('khổ hẹp: bộ lọc thu vào một nút mang SỐ bộ lọc đang áp', async () => {
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage(`/eng/programming/projects/${PROJECT_ID}/library?kind=FUNCTION&category=timer`)
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    const toggle = screen.getByTestId('library-filter-toggle')
    /* Con số là toàn bộ giá trị của nút: một thanh đã thu gọn mà không nói gì là
       cách người ta nhìn một danh sách đã bị lọc và tưởng đó là cả thư viện. */
    expect(toggle).toHaveTextContent('Bộ lọc (2)')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
  })

  it('khổ hẹp: TAB không được đếm vào số bộ lọc', async () => {
    // Đếm tab thì nút luôn hiện ít nhất `1`, và con số thôi mang tin.
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage(`/eng/programming/projects/${PROJECT_ID}/library?scope=SYSTEM`)
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    expect(screen.getByTestId('library-filter-toggle')).toHaveTextContent('Bộ lọc')
    expect(screen.getByTestId('library-filter-toggle')).not.toHaveTextContent('(')
  })

  /* Đường thoát không được nằm SAU một cú bấm nữa: khi đang bị lọc nhầm, thứ
     người dùng cần là quay lại, không phải mở một ngăn kéo rồi mới quay lại. */
  it('Xoá bộ lọc nằm NGOÀI phần thu gọn, không cần mở ngăn kéo', async () => {
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage(`/eng/programming/projects/${PROJECT_ID}/library?kind=FUNCTION`)
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    const clear = screen.getAllByRole('button', { name: 'Xoá bộ lọc' })[0]
    const drawer = document.getElementById('library-filter-drawer')
    expect(drawer).not.toBeNull()
    expect(drawer?.contains(clear)).toBe(false)
  })

  /* Mọi bộ lọc phải đi lên SERVER. Lọc phía client chỉ đúng trên phần đã tải,
     và người dùng đọc kết quả ấy như thể nó phủ cả thư viện. */
  it('kind và category đi lên server, không lọc trên trang đang cầm', async () => {
    const searches: Array<Record<string, unknown>> = []
    client.request.mockImplementation((operationId: string, options?: { query?: Record<string, unknown> }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries' && options?.query) searches.push(options.query)
      return Promise.resolve({ items: [entry()] })
    })
    renderPageWithRoute(`/eng/programming/projects/${PROJECT_ID}/library?kind=CONVERSION&category=timer&q=ton`)
    await waitFor(() => expect(searches.length).toBeGreaterThan(0))
    expect(searches[0]).toMatchObject({ kind: 'CONVERSION', category: 'timer', q: 'ton', scope: 'PROJECT' })
  })

  it('danh sách có nhãn a11y và ô tìm kiếm gắn nhãn', async () => {
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage()
    const list = await screen.findByRole('list', { name: /Danh sách khối Thư viện điều khiển/ })
    expect(list).toBeInTheDocument()
    expect(screen.getByLabelText(/Tìm theo tên/)).toBeInTheDocument()
    // Grid item phải được phép co; nếu thiếu `min-w-0`, một tên khối dài hoặc
    // một chữ ký dài đẩy document 390 px thành 510 px và cả trang cuộn ngang.
    expect(list.closest('section')).toHaveClass('min-w-0')
    expect(screen.getByRole('button', { name: /SCALE_LIN/ })).toHaveClass('min-w-0')
  })
})

/*
`T61-204`/`T61-105` — Used-In có HAI NGUỒN, và chúng không được gộp.

Phần "đã niêm phong" đến từ server và phủ mọi Project; phần "bản nháp" tính ở FE
từ chính Draft đang mở nên CHỈ phủ Project hiện tại. Gộp hai con số lại là cách
một khối bị deprecate trong khi nó đang điều khiển tủ: người dùng thấy "0 nơi
dùng" của bản nháp và tưởng đó là toàn bộ.
*/
describe('LibraryPage — Used-In hai nguồn', () => {
  it('UNAVAILABLE hiện lý do, KHÔNG hiện số 0', async () => {
    stub(() => Promise.resolve({ items: [entry({ scope: 'SYSTEM', name: 'PID', entryId: 'PID' })] }), {
      listProgrammingLibraryUsages: () => Promise.resolve({
        sealed: { count: 0, truncated: false, items: [] },
        draft: { count: 0, truncated: false, items: [] },
        availability: 'UNAVAILABLE',
      }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /PID/ }))

    const usage = await screen.findByRole('region', { name: 'Nơi sử dụng' })
    expect(within(usage).getByText(/Chưa đo được/)).toBeInTheDocument()
    // Con số 0 ở đây sẽ đọc như "không ai dùng khối này" — một câu mời xoá nó.
    expect(within(usage).queryByText(/^0 nơi dùng$/)).not.toBeInTheDocument()
  })

  it('phần đã niêm phong nêu đích danh Project và POU, và đánh dấu bản đang chạy', async () => {
    stub(() => Promise.resolve({ items: [entry({ scope: 'PROJECT', name: 'SCALE_LIN' })] }), {
      listProgrammingLibraryUsages: () => Promise.resolve({
        sealed: {
          count: 1, truncated: false,
          items: [{
            projectId: '11111111-1111-4111-8111-111111111111', projectName: 'AHU-01',
            revisionId: '22222222-2222-4222-8222-222222222222',
            objectId: '33333333-3333-4333-8333-333333333333', objectName: 'AHU_MAIN',
            requiredVersion: 'v2', usageKind: 'CALL', isActive: true,
          }],
        },
        draft: { count: 0, truncated: false, items: [] },
        availability: 'SEALED_ONLY',
      }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /SCALE_LIN/ }))

    const usage = await screen.findByRole('region', { name: 'Nơi sử dụng' })
    expect(within(usage).getByText(/1 nơi dùng/)).toBeInTheDocument()
    // Tên Project và POU chứ không phải UUID — `AC-PGM01-01`.
    expect(within(usage).getByText(/AHU-01/)).toBeInTheDocument()
    expect(within(usage).getByText(/AHU_MAIN/)).toBeInTheDocument()
    expect(within(usage).getByText(/đang chạy/)).toBeInTheDocument()
    // Hai nguồn phải được gắn nhãn TÁCH BẠCH.
    expect(within(usage).getByText('Trong Revision đã niêm phong')).toBeInTheDocument()
    expect(within(usage).getByText('Trong bản nháp của Project này')).toBeInTheDocument()
  })
})

/*
`T61-202` — phân trang cursor.

Trước lát này danh sách đọc đúng một trang `limit: 100` rồi bỏ `nextCursor`:
phần dư biến mất IM LẶNG và người dùng kết luận khối họ tìm không tồn tại.
*/
describe('LibraryPage — phân trang', () => {
  it('còn trang thì nói ra và tải tiếp được, không im lặng cắt danh sách', async () => {
    /* Mock khoá theo CURSOR chứ không theo số lần gọi: trang đầu có thể được
       xin nhiều lần (bộ lọc đổi khi `projectId` tới), và đếm lần gọi sẽ trả
       nhầm trang hai cho một lần tải lại trang một. */
    client.request.mockImplementation((operationId: string, options?: { query?: Record<string, unknown> }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries') {
        return options?.query?.cursor === 'trang-2'
          ? Promise.resolve({ items: [entry({ entryId: 'B', name: 'BETA' })], nextCursor: null })
          : Promise.resolve({ items: [entry({ entryId: 'A', name: 'ALPHA' })], nextCursor: 'trang-2' })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })
    renderPage()

    expect(await screen.findByRole('button', { name: /ALPHA/ })).toBeInTheDocument()
    // Chưa tải trang 2 thì BETA chưa có — và màn hình phải NÓI RA là còn nữa.
    expect(screen.queryByRole('button', { name: /BETA/ })).not.toBeInTheDocument()
    const more = screen.getByRole('button', { name: /Tải thêm khối/ })

    fireEvent.click(more)
    expect(await screen.findByRole('button', { name: /BETA/ })).toBeInTheDocument()
    // Hết trang thì nút biến mất, không để lại một nút bấm mãi không ra gì.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Tải thêm khối/ })).not.toBeInTheDocument())
  })

  it('trang lỗi KHÔNG xoá danh sách đã tải, và thử lại được', async () => {
    let secondPageAttempts = 0
    client.request.mockImplementation((operationId: string, options?: { query?: Record<string, unknown> }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries') {
        if (options?.query?.cursor !== 'trang-2') {
          return Promise.resolve({ items: [entry({ entryId: 'A', name: 'ALPHA' })], nextCursor: 'trang-2' })
        }
        secondPageAttempts += 1
        // Lần xin trang hai đầu tiên hỏng; lần thứ hai thành công.
        return secondPageAttempts === 1
          ? Promise.reject(new Error('mạng hỏng'))
          : Promise.resolve({ items: [entry({ entryId: 'B', name: 'BETA' })], nextCursor: null })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })
    renderPage()
    expect(await screen.findByRole('button', { name: /ALPHA/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tải thêm khối/ }))
    // Mất mọi thứ đã cuộn qua chỉ vì trang thứ hai lỗi là đánh đổi không ai chọn.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /ALPHA/ })).toBeInTheDocument()

    // Và nút phải còn bấm được: khoá nó lại sau lần lỗi đầu là biến đường thử
    // lại thành nút chết.
    fireEvent.click(screen.getByRole('button', { name: /Tải thêm khối/ }))
    expect(await screen.findByRole('button', { name: /BETA/ })).toBeInTheDocument()
  })

  it('cursor lặp thì dừng và nói ra, không quay vòng vô hạn', async () => {
    client.request.mockImplementation((operationId: string, options?: { query?: Record<string, unknown> }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries') {
        // Máy chủ vi phạm hợp đồng: luôn trả về CÙNG một cursor.
        const second = options?.query?.cursor === 'lap-lai'
        return Promise.resolve({
          items: [entry({ entryId: second ? 'A2' : 'A1', name: second ? 'KHOI2' : 'KHOI1' })],
          nextCursor: 'lap-lai',
        })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })
    renderPage()
    expect(await screen.findByRole('button', { name: /KHOI1/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tải thêm khối/ }))
    // Trang VỪA nhận vẫn hợp lệ nên được ghép; chỉ đường đi tiếp bị cắt.
    expect(await screen.findByRole('button', { name: /KHOI2/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/cursor lặp/))
    expect(screen.queryByRole('button', { name: /Tải thêm khối/ })).not.toBeInTheDocument()
  })
})

/*
`T61-204` — bộ lọc và khối đang chọn sống trong URL.

Trước lát này chúng là `useState` cục bộ, nên tải lại trang hoặc gửi đường dẫn
cho đồng nghiệp đều mất ngữ cảnh: người nhận mở ra thấy toàn bộ thư viện thay vì
đúng khối đang được nói tới. Một màn hình tra cứu mà không dán link được thì
người ta sẽ mô tả bằng lời — và mô tả bằng lời là chỗ nhầm khối.
*/
describe('LibraryPage — trạng thái trong URL', () => {
  it('mở bằng đường dẫn có sẵn bộ lọc thì áp ngay, không cần thao tác lại', async () => {
    const seen: Record<string, unknown>[] = []
    client.request.mockImplementation((operationId: string, options?: { query?: Record<string, unknown> }) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries') {
        if (options?.query) seen.push(options.query)
        return Promise.resolve({ items: [entry({ name: 'SCALE_LIN' })] })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/eng/programming/projects/${PROJECT_ID}/library?category=timer&kind=FUNCTION`]}>
          <LibraryPage />
        </MemoryRouter>
      </I18nProvider>
    )
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    // Bộ lọc phải đi TỚI MÁY CHỦ, không chỉ hiện trên ô select.
    await waitFor(() => expect(seen.some((q) => q.category === 'timer' && q.kind === 'FUNCTION')).toBe(true))
    expect(screen.getByLabelText(/Phân loại/)).toHaveValue('timer')
  })

  it('đổi bộ lọc ghi vào URL để dán link được', async () => {
    stub(() => Promise.resolve({ items: [entry({ name: 'SCALE_LIN' })] }))
    /* `MemoryRouter` không đụng `window.location`, nên đọc vị trí qua chính
       router — kiểm `window.location` ở đây sẽ xanh/đỏ vì lý do không liên
       quan tới thứ đang đo. */
    function LocationProbe() {
      const location = useLocation()
      return <span data-testid="loc">{location.search}</span>
    }
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/eng/programming/projects/${PROJECT_ID}/library`]}>
          <LibraryPage />
          <LocationProbe />
        </MemoryRouter>
      </I18nProvider>
    )
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    fireEvent.change(screen.getByLabelText(/Phân loại/), { target: { value: 'control' } })
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('category=control'))
  })
})

/*
`T61-206` — 403 phải XOÁ nội dung đang hiện.

Bản trước nối mô hình trạng thái cho `status`/`message` nhưng vẫn vẽ mảng thô,
nên luật này chết lặng: sau một phán quyết 403, màn hình vẫn hiện đúng những
khối mà máy chủ vừa nói vai này không được xem. Một sự cố mạng thì giữ nội dung
là đúng; một phán quyết quyền thì không — nó nói "có thể không còn là của bạn
để xem".
*/
describe('LibraryPage — 403 xoá nội dung đang hiện', () => {
  it('mất quyền giữa chừng thì danh sách biến mất, không chỉ đổi tiêu đề', async () => {
    let denied = false
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'listProgrammingProjects') return Promise.resolve(projectPage())
      if (operationId === 'searchProgrammingLibraries') {
        if (denied) {
          return Promise.reject(new ProgrammingApiError(403, {
            error: { code: 'PRG-ERR-FORBIDDEN-001', messageKey: 'programming.error.forbidden' },
            correlationId: 'corr-403',
          } as never))
        }
        return Promise.resolve({ items: [entry({ name: 'SCALE_LIN' })] })
      }
      return Promise.reject(new Error('unexpected ' + operationId))
    })
    renderPage()
    expect(await screen.findByRole('button', { name: /SCALE_LIN/ })).toBeInTheDocument()

    denied = true
    fireEvent.change(screen.getByLabelText(/Phân loại/), { target: { value: 'control' } })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /SCALE_LIN/ })).not.toBeInTheDocument())
  })
})

/*
`T61-204` — `returnTo` và tab Inspector nằm trong URL.

Hai thứ này là phần còn nợ của lát URL state trước: gửi một đường dẫn phải gửi
được đúng thứ mình đang nhìn — khối nào, đang xem mặt nào của nó, và đường về
chỗ đã rời đi.
*/
describe('LibraryPage — returnTo và tab Inspector', () => {
  it('tab Inspector đọc từ URL và ghi ngược lại URL', async () => {
    stub(() => Promise.resolve({ items: [entry({ name: 'SCALE_LIN' })] }))
    function LocationProbe() {
      const location = useLocation()
      return <span data-testid="loc">{location.search}</span>
    }
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/eng/programming/projects/${PROJECT_ID}/library?entry=PROJECT%2F${ENTRY_ID}&panel=versions`]}>
          <LibraryPage />
          <LocationProbe />
        </MemoryRouter>
      </I18nProvider>
    )
    // Mở thẳng vào khay Phiên bản, không phải Chi tiết.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Phiên bản' })).toHaveAttribute('aria-selected', 'true'))

    fireEvent.click(screen.getByRole('tab', { name: 'Tham số' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('panel=parameters'))
  })

  it('tham số panel lạ rơi về Chi tiết, không để màn hình trống', async () => {
    stub(() => Promise.resolve({ items: [entry({ name: 'SCALE_LIN' })] }))
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/eng/programming/projects/${PROJECT_ID}/library?entry=PROJECT%2F${ENTRY_ID}&panel=khong-ton-tai`]}>
          <LibraryPage />
        </MemoryRouter>
      </I18nProvider>
    )
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Chi tiết' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('returnTo nội bộ hiện nút quay lại; returnTo ra ngoài bị bỏ', async () => {
    stub(() => Promise.resolve({ items: [entry({ name: 'SCALE_LIN' })] }))
    const { unmount } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/eng/programming/projects/${PROJECT_ID}/library?returnTo=%2Feng%2Fprogramming%2Fprograms`]}>
          <LibraryPage />
        </MemoryRouter>
      </I18nProvider>
    )
    const back = await screen.findByRole('link', { name: /Quay lại chỗ đang làm/ })
    expect(back).toHaveAttribute('href', '/eng/programming/programs')
    unmount()
    cleanup()

    /* Một `returnTo` trỏ ra ngoài là open redirect: người ta gửi link "mở Thư
       viện" rồi nút Quay lại đưa nạn nhân sang trang khác mang theo phiên đang
       đăng nhập. */
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/eng/programming/projects/${PROJECT_ID}/library?returnTo=https%3A%2F%2Fevil.example%2Fx`]}>
          <LibraryPage />
        </MemoryRouter>
      </I18nProvider>
    )
    await screen.findByRole('button', { name: /SCALE_LIN/ })
    expect(screen.queryByRole('link', { name: /Quay lại chỗ đang làm/ })).not.toBeInTheDocument()
  })
})
