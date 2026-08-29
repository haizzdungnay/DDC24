import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/eng/programming/projects/${PROJECT_ID}/library`]}>
        <LibraryPage />
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

  it('trạng thái rỗng và trạng thái lỗi nói rõ chuyện gì xảy ra', async () => {
    stub(() => Promise.resolve({ items: [] }))
    const { unmount } = renderPage()
    expect(await screen.findByText(/Không có khối nào khớp bộ lọc/)).toBeInTheDocument()
    unmount()
    cleanup()

    stub(() => Promise.reject(new Error('mạng lỗi')))
    renderPage()
    expect(await screen.findByText(/Không tải được Thư viện điều khiển/)).toBeInTheDocument()
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

  it('viewer đọc được nhưng không thấy form tạo khối', async () => {
    auth.role = 'viewer'
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage()
    expect(await screen.findByRole('button', { name: /SCALE_LIN/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lưu vào bản nháp thư viện/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Chỉ tài khoản quản trị mới sửa được/)).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText(/Phạm vi/), { target: { value: 'SYSTEM' } })
    await waitFor(() => expect(queries.length).toBeGreaterThan(1))
    expect(queries[queries.length - 1]).toMatchObject({ scope: 'SYSTEM' })
  })

  it('danh sách có nhãn a11y và ô tìm kiếm gắn nhãn', async () => {
    stub(() => Promise.resolve({ items: [entry()] }))
    renderPage()
    const list = await screen.findByRole('list', { name: /Danh sách khối Thư viện điều khiển/ })
    expect(list).toBeInTheDocument()
    expect(screen.getByLabelText(/Tìm theo tên/)).toBeInTheDocument()
    // Grid item phải được phép co và metadata chuyển thành hai hàng ở mobile;
    // nếu thiếu hai lớp này, danh sách SYSTEM đẩy document 390 px thành 510 px.
    expect(list.closest('section')).toHaveClass('min-w-0')
    expect(screen.getByRole('button', { name: /SCALE_LIN/ })).toHaveClass('flex-col', 'sm:flex-row')
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
