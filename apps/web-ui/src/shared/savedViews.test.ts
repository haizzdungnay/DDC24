import { afterEach, describe, expect, it } from 'vitest'
import {
  findSavedView,
  readSavedViews,
  removeSavedView,
  renameSavedView,
  savedViewsStorageKey,
  setSavedViewAccount,
  upsertSavedView,
  writeSavedViews,
  type SavedView
} from './savedViews'

/**
 * Khoá hành vi của khung nhìn đặt tên — `T57-2.3`.
 *
 * Lớp lỗi cần chặn không phải "hàm trả sai" mà là **mất khung nhìn của người
 * dùng**: trùng tên đẻ ra hai mục, đổi tài khoản thấy khung nhìn của người
 * khác, dữ liệu hỏng trong localStorage làm cả trang chết. Ba thứ đó đều hỏng
 * âm thầm nên phải có test riêng.
 */

afterEach(() => {
  localStorage.clear()
  setSavedViewAccount(null)
})

const view = (name: string, params: Record<string, string> = {}): SavedView => ({ name, params })

describe('T57-2.3 — thao tác trên danh sách khung nhìn', () => {
  it('trùng tên là CẬP NHẬT, không tạo mục thứ hai cùng tên', () => {
    const first = upsertSavedView([], 'AHU-1', { q: 'ahu' })
    const second = upsertSavedView(first, 'AHU-1', { q: 'ahu-1', state: 'fault' })
    expect(second).toHaveLength(1)
    expect(second[0].params).toEqual({ q: 'ahu-1', state: 'fault' })
  })

  it('tên bị cắt khoảng trắng thừa; tên rỗng không tạo được gì', () => {
    expect(upsertSavedView([], '  Điểm lỗi  ', {})[0].name).toBe('Điểm lỗi')
    expect(upsertSavedView([], '   ', {})).toEqual([])
  })

  it('danh sách luôn được sắp theo tên để vị trí trong ô chọn ổn định', () => {
    let views = upsertSavedView([], 'Zone 9', {})
    views = upsertSavedView(views, 'AHU-1', {})
    views = upsertSavedView(views, 'Máy lạnh', {})
    expect(views.map((item) => item.name)).toEqual(['AHU-1', 'Máy lạnh', 'Zone 9'])
  })

  it('đổi tên giữ nguyên tham số và không để lại bản cũ', () => {
    const views = renameSavedView([view('cũ', { q: 'x' })], 'cũ', 'mới')
    expect(views).toEqual([{ name: 'mới', params: { q: 'x' } }])
  })

  it('đổi tên sang một tên đã tồn tại thì thay thế mục đó, không nhân đôi', () => {
    const views = renameSavedView([view('a', { q: '1' }), view('b', { q: '2' })], 'a', 'b')
    expect(views).toHaveLength(1)
    expect(views[0]).toEqual({ name: 'b', params: { q: '1' } })
  })

  it('xoá chỉ bỏ đúng mục được nêu tên', () => {
    expect(removeSavedView([view('a'), view('b')], 'a').map((item) => item.name)).toEqual(['b'])
  })

  it('tra cứu theo tên trả undefined thay vì ném lỗi khi không có', () => {
    expect(findSavedView([view('a')], 'b')).toBeUndefined()
    expect(findSavedView([view('a')], null)).toBeUndefined()
  })
})

describe('T57-2.3 — lưu trữ theo tài khoản', () => {
  it('hai tài khoản trên cùng một máy trạm không thấy khung nhìn của nhau', () => {
    setSavedViewAccount('an')
    writeSavedViews('monitor', [view('của An')])
    setSavedViewAccount('binh')
    expect(readSavedViews('monitor')).toEqual([])
    writeSavedViews('monitor', [view('của Bình')])
    setSavedViewAccount('an')
    expect(readSavedViews('monitor').map((item) => item.name)).toEqual(['của An'])
  })

  it('chưa đăng nhập vẫn dùng được, dưới khoá riêng', () => {
    setSavedViewAccount(null)
    expect(savedViewsStorageKey('trends')).toBe('mkddc:views:v1:trends:local')
  })

  it('hai phạm vi (Monitor / Trends) không giẫm lên nhau', () => {
    setSavedViewAccount('an')
    writeSavedViews('monitor', [view('m')])
    writeSavedViews('trends', [view('t')])
    expect(readSavedViews('monitor').map((item) => item.name)).toEqual(['m'])
    expect(readSavedViews('trends').map((item) => item.name)).toEqual(['t'])
  })

  it('dữ liệu hỏng trong localStorage trả về danh sách rỗng, không làm chết trang', () => {
    setSavedViewAccount('an')
    localStorage.setItem(savedViewsStorageKey('monitor'), '{"không phải mảng": true}')
    expect(readSavedViews('monitor')).toEqual([])
    localStorage.setItem(savedViewsStorageKey('monitor'), 'không phải JSON')
    expect(readSavedViews('monitor')).toEqual([])
  })

  it('mục méo mó bị loại từng cái, phần lành lặn vẫn đọc được', () => {
    setSavedViewAccount('an')
    localStorage.setItem(savedViewsStorageKey('monitor'), JSON.stringify([
      { name: 'tốt', params: { q: 'x', bỏ: 12 } },
      { name: '', params: {} },
      { params: { q: 'y' } },
      null
    ]))
    expect(readSavedViews('monitor')).toEqual([{ name: 'tốt', params: { q: 'x' } }])
  })
})
