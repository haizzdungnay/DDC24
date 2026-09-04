import { describe, expect, it } from 'vitest'
import {
  LIBRARY_SCOPE_TABS,
  activeLibraryFilterCount,
  clearLibraryFilters,
  defaultLibraryScope,
  libraryScopeIsMeasurable,
  readLibraryUrlState,
  writeLibraryUrlState,
} from './libraryUrlState'

/**
 * `T61-302` / `ISS-PGM04-07` — tab và bộ lọc của PGM-04.
 *
 * Bộ này thuần: không router, không jsdom, không component. Mọi luật ở đây là
 * luật về DỮ LIỆU, và một luật dữ liệu kiểm qua cây React là một luật kiểm gián
 * tiếp — nó vẫn xanh khi ai đó bỏ luật và bù lại bằng một mẹo ở lớp vẽ.
 */

const WITH_PROJECT = { hasProject: true }
const NO_PROJECT = { hasProject: false }

function read(search: string, context = WITH_PROJECT) {
  return readLibraryUrlState(new URLSearchParams(search), context)
}

describe('tab phạm vi', () => {
  it('có ĐÚNG hai tab, và không có USER', () => {
    // Kiểm bằng giá trị TUYỆT ĐỐI: `expect(LIBRARY_SCOPE_TABS).toContain(...)`
    // sẽ xanh kể cả khi ai đó thêm tab thứ ba.
    expect([...LIBRARY_SCOPE_TABS]).toEqual(['SYSTEM', 'PROJECT'])
  })

  it('URL đòi USER rơi về mặc định, KHÔNG tạo phạm vi thứ ba', () => {
    /* Sản phẩm không có phạm vi `USER` ở API lẫn Product authority. Truyền tiếp
       giá trị ấy sẽ gửi lên server một `scope` bị từ chối, và màn hình báo lỗi
       cho một thứ người dùng không gõ ra. */
    expect(read('scope=USER').scope).toBe('PROJECT')
    expect(read('scope=user').scope).toBe('PROJECT')
    expect(read('scope=').scope).toBe('PROJECT')
  })

  it('mặc định theo ngữ cảnh: có Project ⇒ PROJECT, không ⇒ SYSTEM', () => {
    /* Có Project thì đây là Thư viện CỦA Project ấy, và mọi đường ghi chỉ áp cho
       khối PROJECT. Không có Project thì SYSTEM là phạm vi DUY NHẤT đo được —
       mặc định vào nó thì màn hình không mở ra ở một trạng thái chặn. */
    expect(defaultLibraryScope(WITH_PROJECT)).toBe('PROJECT')
    expect(defaultLibraryScope(NO_PROJECT)).toBe('SYSTEM')
    expect(read('', NO_PROJECT).scope).toBe('SYSTEM')
  })

  it('URL chuẩn tắc BỎ tab mặc định, giữ tab không mặc định', () => {
    const atDefault = writeLibraryUrlState(new URLSearchParams('scope=SYSTEM'), { scope: 'PROJECT' }, WITH_PROJECT)
    expect(atDefault.get('scope')).toBeNull()
    const away = writeLibraryUrlState(new URLSearchParams(), { scope: 'SYSTEM' }, WITH_PROJECT)
    expect(away.get('scope')).toBe('SYSTEM')
  })
})

describe('bộ lọc', () => {
  it('kind lạ và category ngoài registry bị BỎ, không truyền tiếp', () => {
    /* Một `category` ngoài registry đi thẳng lên server sẽ trả 0 kết quả, và màn
       hình nói "không khớp bộ lọc" cho một bộ lọc không tồn tại — người dùng đi
       tìm lỗi ở dữ liệu của họ. */
    expect(read('kind=PROGRAM').kind).toBe('')
    expect(read('category=khong-co-that').category).toBe('')
    expect(read('kind=FUNCTION_BLOCK').kind).toBe('FUNCTION_BLOCK')
    expect(read('category=timer').category).toBe('timer')
  })

  it('truy vấn chỉ toàn khoảng trắng KHÔNG phải một bộ lọc', () => {
    // Nó không đổi kết quả, nhưng lại làm màn hình rỗng đọc thành "không khớp
    // bộ lọc" — và mời người dùng xoá một bộ lọc chẳng ảnh hưởng gì.
    expect(read('q=%20%20').query).toBe('')
    expect(activeLibraryFilterCount(read('q=%20%20'))).toBe(0)
  })

  it('đếm bộ lọc KHÔNG tính tab', () => {
    /* Nếu đếm tab thì nút "Bộ lọc" ở khổ hẹp luôn hiện ít nhất `1`, và con số
       thôi mang tin: người dùng không phân biệt được "đang lọc gì đó" với "đang
       xem một tab". */
    expect(activeLibraryFilterCount(read('scope=SYSTEM'))).toBe(0)
    expect(activeLibraryFilterCount(read('scope=SYSTEM&kind=FUNCTION'))).toBe(1)
    expect(activeLibraryFilterCount(read('kind=FUNCTION&category=timer&q=pid'))).toBe(3)
  })

  it('giá trị rỗng XOÁ tham số thay vì ghi một chuỗi rỗng', () => {
    // `?kind=` là một tham số không mang tin; giữ nó lại thì hai đường dẫn khác
    // nhau mô tả cùng một màn hình.
    const next = writeLibraryUrlState(new URLSearchParams('kind=FUNCTION&q=pid'), { kind: '', query: '  ' }, WITH_PROJECT)
    expect(next.get('kind')).toBeNull()
    expect(next.get('q')).toBeNull()
  })
})

describe('xoá bộ lọc', () => {
  it('bỏ mọi bộ lọc nhưng GIỮ tab', () => {
    /* Tab là điều hướng. Người dùng vừa xoá bộ lọc không có nghĩa là họ muốn
       rời khỏi danh sách đang xem. */
    const next = clearLibraryFilters(new URLSearchParams('scope=SYSTEM&kind=FUNCTION&category=timer&q=pid'), WITH_PROJECT)
    expect(next.get('scope')).toBe('SYSTEM')
    expect(next.get('kind')).toBeNull()
    expect(next.get('category')).toBeNull()
    expect(next.get('q')).toBeNull()
  })

  it('đưa về URL CHUẨN TẮC: tab mặc định thì bỏ luôn tham số', () => {
    const next = clearLibraryFilters(new URLSearchParams('scope=PROJECT&q=pid'), WITH_PROJECT)
    expect(next.get('scope')).toBeNull()
    expect(next.toString()).toBe('')
  })

  it('KHÔNG đụng tới khối đang chọn, khay đang mở, hay đường quay lại', () => {
    /* Xoá bộ lọc không phải là đóng khối đang mở, và càng không phải là quên
       đường quay lại POU người dùng đã rời đi. */
    const next = clearLibraryFilters(
      new URLSearchParams('kind=FUNCTION&entry=SYSTEM%2FTON&panel=usage&returnTo=%2Feng%2Fprogramming'),
      WITH_PROJECT,
    )
    expect(next.get('entry')).toBe('SYSTEM/TON')
    expect(next.get('panel')).toBe('usage')
    expect(next.get('returnTo')).toBe('/eng/programming')
  })
})

describe('fail-closed', () => {
  it('PROJECT không có projectId là KHÔNG đo được', () => {
    /* Store từ chối yêu cầu ấy ("PROJECT library search bắt buộc projectId"), và
       lỗi đó lên màn hình dưới dạng một sự cố máy chủ — trong khi sự thật là
       ngữ cảnh còn thiếu mà FE biết trước. */
    expect(libraryScopeIsMeasurable('PROJECT', NO_PROJECT)).toBe(false)
    expect(libraryScopeIsMeasurable('PROJECT', WITH_PROJECT)).toBe(true)
  })

  it('SYSTEM luôn đo được, kể cả khi chưa có Project', () => {
    expect(libraryScopeIsMeasurable('SYSTEM', NO_PROJECT)).toBe(true)
  })
})

describe('vòng đọc–ghi', () => {
  it('ghi rồi đọc lại trả đúng thứ đã ghi (back/forward/reload giữ ngữ cảnh)', () => {
    let params = new URLSearchParams()
    params = writeLibraryUrlState(params, { scope: 'SYSTEM' }, WITH_PROJECT)
    params = writeLibraryUrlState(params, { kind: 'CONVERSION' }, WITH_PROJECT)
    params = writeLibraryUrlState(params, { category: 'timer' }, WITH_PROJECT)
    params = writeLibraryUrlState(params, { query: 'ton' }, WITH_PROJECT)
    expect(readLibraryUrlState(params, WITH_PROJECT)).toEqual({
      scope: 'SYSTEM', kind: 'CONVERSION', category: 'timer', query: 'ton',
    })
  })

  it('ghi một mảnh KHÔNG chạm các mảnh khác', () => {
    const params = writeLibraryUrlState(
      new URLSearchParams('scope=SYSTEM&kind=FUNCTION&entry=SYSTEM%2FTON'),
      { query: 'pid' },
      WITH_PROJECT,
    )
    expect(params.get('scope')).toBe('SYSTEM')
    expect(params.get('kind')).toBe('FUNCTION')
    expect(params.get('entry')).toBe('SYSTEM/TON')
  })
})
