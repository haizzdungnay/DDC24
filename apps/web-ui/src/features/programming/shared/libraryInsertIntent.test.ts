import { describe, expect, it } from 'vitest'
import {
  clearLibraryInsertIntent,
  libraryInsertIntentParams,
  readLibraryInsertIntent,
  resolveLibraryInsertIntent,
} from './libraryInsertIntent'
import { PROGRAMS_PRESERVED_QUERY, canonicalProgramsPath } from './programsRoute'

const ENTRY = 'SCALE_LIN'
const REVISION = '33333333-3333-4333-8333-333333333333'

describe('T61-405 — ý định chèn khối mang từ PGM-04 sang PGM-02', () => {
  it('cần CẢ HAI định danh; thiếu một nửa là không có ý định nào', () => {
    /* Một `entryId` không kèm revision là một lời mời chèn "bản mới nhất" —
       đúng thứ `T61-404` đã khoá lại ở đường đọc. Fail closed. */
    expect(readLibraryInsertIntent(`insertEntry=${ENTRY}&insertLibraryRevision=${REVISION}`))
      .toEqual({ entryId: ENTRY, libraryRevisionId: REVISION })
    expect(readLibraryInsertIntent(`insertEntry=${ENTRY}`)).toBeNull()
    expect(readLibraryInsertIntent(`insertLibraryRevision=${REVISION}`)).toBeNull()
    expect(readLibraryInsertIntent('')).toBeNull()
    // Khoảng trắng không phải một định danh.
    expect(readLibraryInsertIntent(`insertEntry=%20&insertLibraryRevision=${REVISION}`)).toBeNull()
  })

  it('gắn vào rồi đọc ra được nguyên vẹn', () => {
    const params = new URLSearchParams({
      returnTo: '/eng/programming/projects/p1/library?scope=PROJECT',
      ...libraryInsertIntentParams({ entryId: ENTRY, libraryRevisionId: REVISION }),
    })
    expect(readLibraryInsertIntent(params)).toEqual({ entryId: ENTRY, libraryRevisionId: REVISION })
  })

  it('dọn ý định nhưng GIỮ NGUYÊN mọi tham số khác', () => {
    /* Ý định là lệnh dùng một lần: để nó nằm lại thì mỗi lần tải trang lại mời
       chèn cùng một khối. Nhưng dọn quá tay sẽ đánh rơi `returnTo` và người
       dùng mất đường quay lại đúng màn hình Thư viện đang lọc. */
    const cleaned = clearLibraryInsertIntent(
      `pou=pou-1&mode=EDIT&returnTo=%2Flibrary%3Fscope%3DPROJECT&insertEntry=${ENTRY}&insertLibraryRevision=${REVISION}`
    )
    expect(readLibraryInsertIntent(cleaned)).toBeNull()
    expect(cleaned.get('pou')).toBe('pou-1')
    expect(cleaned.get('mode')).toBe('EDIT')
    expect(cleaned.get('returnTo')).toBe('/library?scope=PROJECT')
  })

  /*
  Đường dẫn canonical được DỰNG LẠI ở nhiều chỗ (đăng nhập lại, đổi tab, tải lại
  trang). Nếu hai tham số này không nằm trong danh sách giữ lại thì ý định biến
  mất im lặng ở đúng những lúc ấy.
  */
  it('sống sót qua phép dựng lại đường dẫn canonical của PGM-02', () => {
    expect(PROGRAMS_PRESERVED_QUERY).toContain('insertEntry')
    expect(PROGRAMS_PRESERVED_QUERY).toContain('insertLibraryRevision')

    const source = new URLSearchParams({
      returnTo: '/library',
      ...libraryInsertIntentParams({ entryId: ENTRY, libraryRevisionId: REVISION }),
    })
    const path = canonicalProgramsPath('project-1', { pou: 'pou-1', mode: 'EDIT', search: source })
    expect(readLibraryInsertIntent(path.slice(path.indexOf('?') + 1)))
      .toEqual({ entryId: ENTRY, libraryRevisionId: REVISION })
  })

  describe('phân giải trên danh mục đang tải', () => {
    const entries = [
      { entryId: ENTRY, libraryRevisionId: REVISION, name: 'SCALE_LIN' },
      { entryId: 'TON', libraryRevisionId: 'sys-1', name: 'TON' },
    ]

    it('đúng khối đúng bản thì sẵn sàng', () => {
      expect(resolveLibraryInsertIntent({ entryId: ENTRY, libraryRevisionId: REVISION }, entries))
        .toEqual({ status: 'ready', entry: entries[0] })
    })

    it('không có khối ấy và "có nhưng khác bản" là HAI câu, không gộp', () => {
      /* Hai nguyên nhân đòi hai hành động khác nhau: một cái là danh mục chưa
         tải xong hoặc khối đã bị xoá; cái kia là thư viện đã đổi giữa lúc người
         dùng bấm Chèn và lúc bộ soạn thảo mở ra. */
      expect(resolveLibraryInsertIntent({ entryId: 'KHONG_CO', libraryRevisionId: REVISION }, entries))
        .toEqual({ status: 'unknown-entry' })
      expect(resolveLibraryInsertIntent({ entryId: ENTRY, libraryRevisionId: 'ban-khac' }, entries))
        .toEqual({ status: 'revision-mismatch', available: REVISION })
    })

    it('không bao giờ trả về một khối "gần đúng"', () => {
      // Cùng entryId, khác revision: KHÔNG được coi là sẵn sàng. Chèn nhầm bản
      // là một lỗi im lặng, và không có gì bù lại được nó.
      const resolution = resolveLibraryInsertIntent({ entryId: ENTRY, libraryRevisionId: 'ban-khac' }, entries)
      expect(resolution.status).not.toBe('ready')
      expect('entry' in resolution).toBe(false)
    })

    it('danh mục rỗng thì chưa kết luận được là "khác bản"', () => {
      expect(resolveLibraryInsertIntent({ entryId: ENTRY, libraryRevisionId: REVISION }, []))
        .toEqual({ status: 'unknown-entry' })
    })
  })
})
