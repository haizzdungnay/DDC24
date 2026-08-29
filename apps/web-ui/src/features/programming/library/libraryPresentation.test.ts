import { describe, expect, it } from 'vitest'
import {
  insertBlockReason,
  metadataValue,
  safeToRemove,
  scopeLabel,
  usageDisplay,
} from './libraryPresentation'
import type { ProgrammingLibraryUsage } from '../model/types'

function usage(overrides: Partial<ProgrammingLibraryUsage> = {}): ProgrammingLibraryUsage {
  return {
    sealed: { count: 0, truncated: false, items: [] },
    draft: { count: 0, truncated: false, items: [] },
    availability: 'COMPLETE',
    ...overrides,
  }
}

describe('scopeLabel', () => {
  it('KHÔNG bao giờ gọi SYSTEM là "Core"', () => {
    // Sản phẩm đã có `mkddc-core`. Hai nghĩa cho một từ, đúng chỗ người trực ca
    // cần đọc nhanh, là một cái bẫy — không phải chuyện khẩu vị từ ngữ.
    expect(scopeLabel('SYSTEM', false)).toBe('Hệ thống')
    expect(scopeLabel('SYSTEM', true)).toBe('System')
    expect(scopeLabel('SYSTEM', true).toLowerCase()).not.toContain('core')
  })
})

describe('metadataValue', () => {
  it('field vắng là "chưa ai điền", không phải chuỗi rỗng', () => {
    // Quy về chuỗi rỗng làm ô đó trông như đã điền rồi, và người dùng sẽ không
    // đi tìm chỗ để điền.
    expect(metadataValue(undefined)).toBeNull()
    expect(metadataValue('   ')).toBeNull()
    expect(metadataValue(' Điều khiển ')).toBe('Điều khiển')
  })
})

describe('insertBlockReason', () => {
  it('REVIEW_REQUIRED chặn Insert kể cả khi ĐÃ có POU đích', () => {
    expect(insertBlockReason({ featureState: 'REVIEW_REQUIRED', libraryState: 'PUBLISHED' }, true))
      .toBe('REVIEW_REQUIRED')
  })

  it('REVIEW_REQUIRED được báo TRƯỚC "chưa chọn đích"', () => {
    // Thứ tự này là hợp đồng: mở đúng POU cũng không làm khối chèn được, nên
    // báo "hãy chọn POU đích" là chỉ người dùng đi một vòng vô ích.
    expect(insertBlockReason({ featureState: 'REVIEW_REQUIRED', libraryState: 'PUBLISHED' }, false))
      .toBe('REVIEW_REQUIRED')
  })

  it('khối bình thường có đích thì không bị chặn', () => {
    expect(insertBlockReason({ featureState: 'AVAILABLE', libraryState: 'PUBLISHED' }, true)).toBeNull()
    expect(insertBlockReason({ featureState: 'AVAILABLE', libraryState: 'PUBLISHED' }, false)).toBe('NO_TARGET')
    expect(insertBlockReason({ featureState: 'AVAILABLE', libraryState: 'DEPRECATED' }, true)).toBe('DEPRECATED')
  })
})

describe('usageDisplay', () => {
  it('UNAVAILABLE KHÔNG BAO GIỜ thành số, kể cả khi payload có sẵn số 0', () => {
    // Đây là bất biến đắt nhất của lát này. `0` nghĩa là "không ai dùng" — một
    // câu mời người ta xoá khối. `UNAVAILABLE` nghĩa là "chưa đo được".
    const view = usageDisplay(usage({ availability: 'UNAVAILABLE' }))
    expect(view).toEqual({ kind: 'unavailable' })
  })

  it('không có dữ liệu cũng là UNAVAILABLE, không phải 0', () => {
    expect(usageDisplay(null)).toEqual({ kind: 'unavailable' })
    expect(usageDisplay(undefined)).toEqual({ kind: 'unavailable' })
  })

  it('ĐANG TẢI khác CHƯA ĐO ĐƯỢC', () => {
    /* Trước bản vá này mọi trường hợp không có dữ liệu đều rơi vào
       `unavailable`, nên trong lúc request còn bay, khay của một khối PROJECT
       hiện đúng câu lý do của SYSTEM ("phân giải nơi dùng từ registry"). Một
       trạng thái đang tải mặc áo chưa đo được, và mang lý do của loại khác —
       người đọc kết luận sai hai lần. */
    expect(usageDisplay(null, true)).toEqual({ kind: 'loading' })
    // Đã có dữ liệu rồi thì `loading` của lần đọc lại KHÔNG che kết quả cũ.
    expect(usageDisplay(usage({ availability: 'UNAVAILABLE' }), true)).toEqual({ kind: 'unavailable' })
  })

  it('đang tải thì cũng KHÔNG cho gỡ', () => {
    // Chưa đọc xong cũng là chưa biết.
    expect(safeToRemove(null)).toBe(false)
  })

  it('SEALED_ONLY chỉ trả phần đã niêm phong, không bịa phần Draft', () => {
    const view = usageDisplay(usage({
      availability: 'SEALED_ONLY',
      sealed: { count: 3, truncated: false, items: [] },
    }))
    expect(view).toEqual({ kind: 'sealed-only', sealed: 3, truncated: false })
    expect(view).not.toHaveProperty('draft')
  })

  it('COMPLETE trả cả hai phạm vi tách bạch', () => {
    expect(usageDisplay(usage({
      sealed: { count: 2, truncated: false, items: [] },
      draft: { count: 1, truncated: true, items: [] },
    }))).toEqual({ kind: 'count', sealed: 2, draft: 1, truncated: true })
  })
})

describe('safeToRemove', () => {
  it('CHƯA ĐO ĐƯỢC thì không cho gỡ — không biết khác với biết là 0', () => {
    expect(safeToRemove(usage({ availability: 'UNAVAILABLE' }))).toBe(false)
    expect(safeToRemove(null)).toBe(false)
  })

  it('danh sách bị cắt bớt cũng không cho gỡ', () => {
    // `truncated` nghĩa là còn mục chưa đọc; phần chưa đọc có thể chứa đúng
    // chương trình đang chạy.
    expect(safeToRemove(usage({ sealed: { count: 200, truncated: true, items: [] } }))).toBe(false)
  })

  it('đo được và bằng 0 ở cả hai phạm vi thì cho gỡ', () => {
    expect(safeToRemove(usage())).toBe(true)
  })

  it('SEALED_ONLY bằng 0 vẫn cho gỡ — phần Draft chưa giao, không phải chưa đo', () => {
    expect(safeToRemove(usage({ availability: 'SEALED_ONLY' }))).toBe(true)
  })
})
