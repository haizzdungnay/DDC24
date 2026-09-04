import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* Ép chế độ LIVE: ở chế độ demo `apiClient` trả dữ liệu giả và KHÔNG gọi
   `fetch`, nên mọi phép kiểm header dưới đây sẽ xanh mà không kiểm gì. */
vi.mock('../config', () => ({ API_ORIGIN: '', WS_ORIGIN: '', IS_DEMO: false, DDC_MODE: 'live' }))

import { apiClient, resetVirtualPointETagForTests } from './client'

/**
 * ISS-PIO-37 — client gửi `If-Match` cho các đường ghi có thể ĐÈ MẤT dữ liệu.
 *
 * Hai tab cùng mở danh sách điểm ảo, cùng sửa, cùng lưu: tab lưu sau đè trọn
 * thay đổi của tab lưu trước và không ai được báo. Backend nay đòi `If-Match`;
 * nếu client không gửi thì mọi lần lưu đều 428 và tính năng coi như hỏng.
 */

type Call = { url: string; init: RequestInit }

let calls: Call[] = []

function jsonResponse(body: unknown, etag?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (etag) headers.set('ETag', etag)
  return new Response(JSON.stringify(body), { status: 200, headers })
}

beforeEach(() => {
  calls = []
  resetVirtualPointETagForTests()
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/virtual-points') && (!init.method || init.method === 'GET')) {
      return jsonResponse([], '"vp:7"')
    }
    return jsonResponse({ id: 'VP1' }, '"vp:8"')
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function headerOf(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name)
}

describe('ISS-PIO-37 — If-Match cho ghi Virtual Point', () => {
  it('sửa một điểm gửi ETag đã đọc từ danh sách', async () => {
    await apiClient.getVirtualPoints()
    await apiClient.updateVirtualPoint({ id: 'VP1', tag: 'vp1', label: 'A', signalType: 'float', enabled: true, writable: true, logEnabled: false })

    const put = calls.find((call) => call.init.method === 'PUT')
    expect(put, 'không có lời gọi PUT nào').toBeDefined()
    expect(headerOf(put!, 'If-Match')).toBe('"vp:7"')
  })

  it('xoá một điểm cũng gửi If-Match', async () => {
    await apiClient.getVirtualPoints()
    await apiClient.deleteVirtualPoint('VP1')

    const del = calls.find((call) => call.init.method === 'DELETE')
    expect(del, 'không có lời gọi DELETE nào').toBeDefined()
    expect(headerOf(del!, 'If-Match')).toBe('"vp:7"')
  })

  /* Vào thẳng một trang sửa mà chưa qua danh sách: client phải tự đọc một lần
     để có ETag, thay vì gửi rỗng và ăn 428. */
  it('chưa có ETag thì đọc một lần rồi mới ghi', async () => {
    await apiClient.updateVirtualPoint({ id: 'VP1', tag: 'vp1', label: 'A', signalType: 'float', enabled: true, writable: true, logEnabled: false })

    const get = calls.find((call) => !call.init.method || call.init.method === 'GET')
    expect(get, 'client không đọc để lấy ETag').toBeDefined()
    const put = calls.find((call) => call.init.method === 'PUT')
    expect(headerOf(put!, 'If-Match')).toBe('"vp:7"')
  })

  /* TẠO MỚI cố ý KHÔNG gửi `If-Match`: thêm một điểm không đè lên thay đổi của
     ai, nên không có phiên bản nào để so. Gửi thừa sẽ bắt người dùng tải lại
     danh sách trước mỗi lần thêm mà không ngăn được mất mát nào. */
  it('tạo mới không gửi If-Match', async () => {
    await apiClient.createVirtualPoint({ tag: 'moi', signalType: 'float', enabled: true })

    const post = calls.find((call) => call.init.method === 'POST')
    expect(post, 'không có lời gọi POST nào').toBeDefined()
    expect(headerOf(post!, 'If-Match')).toBeNull()
  })

  /* ETag phải là của bản NGƯỜI DÙNG ĐANG NHÌN. Đọc lại ngay trước khi ghi sẽ
     luôn khớp và vì thế vô hiệu hoá chính phép kiểm này. */
  it('giữ ETag của lần đọc gần nhất, không tự làm mới trước khi ghi', async () => {
    await apiClient.getVirtualPoints()
    await apiClient.updateVirtualPoint({ id: 'VP1', tag: 'vp1', label: 'A', signalType: 'float', enabled: true, writable: true, logEnabled: false })
    const getsBefore = calls.filter((call) => !call.init.method || call.init.method === 'GET').length
    expect(getsBefore).toBe(1)
  })
})
