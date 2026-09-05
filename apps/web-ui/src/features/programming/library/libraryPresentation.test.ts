import { describe, expect, it } from 'vitest'
import {
  blockSignatureLine,
  compatibilityDisplay,
  entryTags,
  insertBlockReason,
  insertCompatibilityStatement,
  libraryUsability,
  insertTargetCandidates,
  metadataValue,
  safeToRemove,
  scopeLabel,
  usageDisplay,
} from './libraryPresentation'
import { libraryEntryFixture } from './libraryFixture'
import type { ProgrammingLibraryCompatibility, ProgrammingLibraryUsage } from '../model/types'

function usage(overrides: Partial<ProgrammingLibraryUsage> = {}): ProgrammingLibraryUsage {
  return {
    sealed: { count: 0, truncated: false, items: [], nextCursor: null },
    draft: { count: 0, truncated: false, items: [], nextCursor: null },
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
    const ready = libraryEntryFixture()
    expect(insertBlockReason(ready, true)).toBeNull()
    expect(insertBlockReason(ready, false)).toBe('NO_TARGET')
    expect(insertBlockReason({ ...ready, libraryState: 'DEPRECATED' }, true)).toBe('DEPRECATED')
  })

  /* `T61-203` — chữ ký không đọc được thì KHÔNG chèn được, ở CẢ HAI bề mặt.
     Trước lát này Quick Library chặn (nó có `SIGNATURE_UNAVAILABLE`) còn PGM-04
     thì không — nên cùng một khối chèn được từ màn này và không chèn được từ
     màn kia. Bên chặn mới là bên đúng: không có chữ ký thì không dựng nổi một
     lời gọi đủ tham số, và thứ chèn ra sẽ không biên dịch. */
  it('thiếu chữ ký chặn Insert, không im lặng cho chèn một lời gọi không dựng nổi', () => {
    expect(insertBlockReason({ ...libraryEntryFixture(), signature: undefined }, true))
      .toBe('SIGNATURE_UNAVAILABLE')
  })

  /*
  `T61-406` — `REQUIRES_MIGRATION` là một câu của MÁY CHỦ, không phải một suy
  đoán của giao diện: nó nghĩa là Revision đang vận hành pin một version khác
  version mang khối này. Chèn lúc ấy là ghi vào mã nguồn một lời gọi mà lần Kiểm
  tra kế tiếp sẽ từ chối — và người dùng chỉ biết SAU KHI mã nguồn đã đổi.
  */
  it('REQUIRES_MIGRATION chặn Insert, kể cả khi khối tự nó dùng được', () => {
    expect(insertBlockReason({
      ...libraryEntryFixture(),
      compatibility: {
        state: 'REQUIRES_MIGRATION', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: 'pin cũ',
      },
    }, true)).toBe('REQUIRES_MIGRATION')
  })

  /* Thứ tự là hợp đồng: lý do thuộc về CHÍNH KHỐI đứng trước lý do thuộc về
     gói đang chạy. Nói "cần migrate" cho một khối đang chờ review là chỉ người
     dùng đi migrate một thứ mà migrate xong vẫn không chèn được. */
  it('REVIEW_REQUIRED được báo TRƯỚC REQUIRES_MIGRATION', () => {
    expect(insertBlockReason({
      ...libraryEntryFixture(),
      featureState: 'REVIEW_REQUIRED',
      compatibility: {
        state: 'REQUIRES_MIGRATION', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: null,
      },
    }, true)).toBe('REVIEW_REQUIRED')
  })

  /*
  `UNKNOWN` KHÔNG chặn — và đây là ca dễ làm sai nhất của lát này. Hợp đồng ghi
  `UNKNOWN` là giá trị MẶC ĐỊNH (Project chưa Commission thì không có gì để so)
  và MỌI entry SYSTEM đều mang nó. Chặn cứng nghĩa là `TON`/`TOF`/`CTU` không
  chèn được trên bất kỳ Project mới nào — một lệnh cấm mà máy chủ chưa hề đưa
  ra. Sự thật ấy đi bằng `insertCompatibilityStatement` (kiểm ngay dưới), không
  bằng một phép chặn.
  */
  it('UNKNOWN và field VẮNG đều không chặn, vì đó là mặc định của hợp đồng', () => {
    expect(insertBlockReason({ ...libraryEntryFixture(), compatibility: undefined }, true)).toBeNull()
    expect(insertBlockReason({
      ...libraryEntryFixture(),
      compatibility: { state: 'UNKNOWN', requiredVersion: null, availableVersion: null, reason: null },
    }, true)).toBeNull()
  })
})

/*
`ISS-PGM04-15` — "không coi unknown là compatible". Phép kiểm ở đây là: có gì
để NÓI hay không. Trả `null` cho `UNKNOWN` chính là quy nó về im lặng, và im
lặng đúng là cách người đọc hiểu nó thành `COMPATIBLE`.
*/
describe('insertCompatibilityStatement', () => {
  it('chỉ im lặng khi máy chủ đã KHẲNG ĐỊNH là tương thích', () => {
    expect(insertCompatibilityStatement({ kind: 'compatible' })).toBeNull()
  })

  it('UNKNOWN có câu để nói, và câu ấy giữ nguyên lý do của máy chủ', () => {
    expect(insertCompatibilityStatement({ kind: 'unknown', reason: 'chưa Commission' }))
      .toEqual({ kind: 'unknown', reason: 'chưa Commission' })
  })

  /* Giữ cả hai version: "cần migrate" mà không nói từ đâu sang đâu là một câu
     người vận hành không hành động được. */
  it('REQUIRES_MIGRATION giữ đủ hai version để người vận hành hành động được', () => {
    expect(insertCompatibilityStatement({
      kind: 'requires-migration', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: 'pin cũ',
    })).toEqual({
      kind: 'requires-migration', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: 'pin cũ',
    })
  })
})

/* Thang bậc DUY NHẤT, và thứ tự của nó là hợp đồng. Kiểm bằng chuỗi tuyệt đối
   chứ không bằng hằng của sản phẩm: so với chính hằng đang kiểm thì hai vế cùng
   đổi và test xanh vĩnh viễn. */
describe('libraryUsability', () => {
  it('REVIEW_REQUIRED thắng DEPRECATED, và cả hai thắng thiếu chữ ký', () => {
    const base = libraryEntryFixture({ featureState: 'REVIEW_REQUIRED', libraryState: 'DEPRECATED' })
    expect(libraryUsability({ ...base, signature: undefined }).kind).toBe('REVIEW_REQUIRED')
    expect(libraryUsability({ ...base, featureState: 'AVAILABLE', signature: undefined }).kind)
      .toBe('DEPRECATED')
    expect(libraryUsability({ ...base, featureState: 'AVAILABLE', libraryState: 'PUBLISHED', signature: undefined }).kind)
      .toBe('SIGNATURE_UNAVAILABLE')
    expect(libraryUsability(libraryEntryFixture()).kind).toBe('AVAILABLE')
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
      sealed: { count: 3, truncated: false, items: [], nextCursor: null },
    }))
    expect(view).toEqual({ kind: 'sealed-only', sealed: 3, truncated: false })
    expect(view).not.toHaveProperty('draft')
  })

  it('COMPLETE trả cả hai phạm vi tách bạch', () => {
    expect(usageDisplay(usage({
      sealed: { count: 2, truncated: false, items: [], nextCursor: null },
      draft: { count: 1, truncated: true, items: [], nextCursor: null },
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
    expect(safeToRemove(usage({ sealed: { count: 200, truncated: true, items: [], nextCursor: null } }))).toBe(false)
  })

  it('đo được và bằng 0 ở cả hai phạm vi thì cho gỡ', () => {
    expect(safeToRemove(usage())).toBe(true)
  })

  it('SEALED_ONLY bằng 0 vẫn cho gỡ — phần Draft chưa giao, không phải chưa đo', () => {
    expect(safeToRemove(usage({ availability: 'SEALED_ONLY' }))).toBe(true)
  })
})

describe('blockSignatureLine', () => {
  const base = { name: 'SCALE_LIN' as const }

  it('vắng signature thì NÓI RA, không tự parse interface để đoán', () => {
    expect(blockSignatureLine({ ...base })).toEqual({ kind: 'unavailable' })
  })

  it('dựng một dòng đọc được với tên chân và kiểu', () => {
    const line = blockSignatureLine({
      ...base,
      signature: {
        category: 'math', dispatch: 'FUNC_TABLE', polymorphic: false,
        allowedTypes: ['REAL'], typedPortNames: [],
        ports: [
          { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
          { name: 'MODE', direction: 'INPUT', dataType: 'BOOL' },
          { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' },
        ],
      },
    })
    expect(line).toEqual({ kind: 'ready', text: 'SCALE_LIN(IN: REAL, MODE: BOOL) → OUT: REAL' })
  })

  it('nhiều đầu ra được bọc ngoặc để không đọc nhầm thành một kiểu ghép', () => {
    const line = blockSignatureLine({
      name: 'TON',
      signature: {
        category: 'timer', dispatch: 'FB_TYPE', polymorphic: false,
        allowedTypes: [], typedPortNames: [],
        ports: [
          { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
          { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
          { name: 'ET', direction: 'OUTPUT', dataType: 'TIME' },
        ],
      },
    })
    expect(line).toEqual({ kind: 'ready', text: 'TON(IN: BOOL) → (Q: BOOL, ET: TIME)' })
  })

  it('không đầu ra thì viết dấu gạch, không viết số 0 hay chuỗi rỗng', () => {
    const line = blockSignatureLine({
      name: 'LOG_EVENT',
      signature: {
        category: 'other', dispatch: 'EXPANSION', polymorphic: false,
        allowedTypes: [], typedPortNames: [],
        ports: [{ name: 'MSG', direction: 'INPUT', dataType: 'DINT' }],
      },
    })
    expect(line).toEqual({ kind: 'ready', text: 'LOG_EVENT(MSG: DINT) → —' })
  })
})

describe('insertTargetCandidates', () => {
  const objects = [
    { objectId: 'aaa', name: 'AHU_MAIN', kind: 'PROGRAM' as const, language: 'ST' as const, dependencies: ['ENTRY'] },
    { objectId: 'bbb', name: 'FILTER', kind: 'FUNCTION' as const, language: 'FBD' as const, dependencies: [] },
    { objectId: 'ENTRY', name: 'SCALE_LIN', kind: 'FUNCTION' as const, language: 'ST' as const, dependencies: [] },
    { objectId: 'ccc', name: 'HELPER', kind: 'FUNCTION' as const, language: 'ST' as const, dependencies: [] },
  ]
  const entry = { entryId: 'entry', dependencies: [{ entryId: 'CCC', version: '1.0.0' }] }

  it('chặn chèn khối vào chính nó', () => {
    const self = insertTargetCandidates(objects, entry).find((item) => item.objectId === 'ENTRY')
    expect(self?.block).toBe('SELF')
  })

  it('chặn chèn vào POU mà chính khối đang phụ thuộc — đó là một vòng lặp', () => {
    const cycle = insertTargetCandidates(objects, entry).find((item) => item.objectId === 'ccc')
    expect(cycle?.block).toBe('CYCLE')
  })

  it('POU đã dùng khối rồi vẫn chèn được; "đã dùng" là ghi chú, không phải rào', () => {
    const used = insertTargetCandidates(objects, entry).find((item) => item.objectId === 'aaa')
    expect(used?.alreadyDepends).toBe(true)
    expect(used?.block).toBeNull()
  })

  /* Máy chủ không ép luật nào về ngôn ngữ hay `kind`, nên giao diện cũng không
     được ép: chặn ở đây sẽ dựng lại đúng lỗi mà `T61-201` vừa sửa ở đường
     RBAC — người dùng bị giao diện chặn trên thao tác máy chủ chấp nhận. */
  it('KHÔNG chặn theo ngôn ngữ hay kind', () => {
    const fbd = insertTargetCandidates(objects, entry).find((item) => item.objectId === 'bbb')
    expect(fbd?.block).toBeNull()
    expect(fbd?.language).toBe('FBD')
  })
})

describe('entryTags', () => {
  it('field vắng và mảng rỗng là cùng một câu trả lời', () => {
    // Khác `metadataValue`: một khối không có thẻ thì không có hàng thẻ nào,
    // chứ không phải một ô `—` chờ người điền.
    expect(entryTags({})).toEqual([])
    expect(entryTags({ tags: [] })).toEqual([])
  })

  it('KHÔNG chuẩn hoá lại thứ máy chủ đã chuẩn hoá', () => {
    /* Máy chủ đã trim, hạ chữ thường, khử trùng lặp và sắp tăng dần. Gấp chữ
       lần hai ở FE tạo ra luật thứ hai, và hai luật thì cùng một thẻ hiện hai
       kiểu tuỳ nơi hiển thị. Đây là lý do test này khẳng định thứ tự và nội
       dung đi qua NGUYÊN VẸN. */
    expect(entryTags({ tags: ['hvac', 'vav box'] })).toEqual(['hvac', 'vav box'])
  })
})

describe('compatibilityDisplay', () => {
  it('field vắng KHÔNG BAO GIỜ thành "tương thích"', () => {
    // Máy chủ đời cũ chưa gửi trường này. Đọc "vắng" thành "không sao" là đúng
    // cái kết luận mà `UNKNOWN` sinh ra để chặn.
    expect(compatibilityDisplay({})).toEqual({ kind: 'unknown', reason: null })
  })

  it('UNKNOWN giữ nguyên lý do để người đọc biết vì sao chưa đo được', () => {
    expect(compatibilityDisplay({
      compatibility: {
        state: 'UNKNOWN', requiredVersion: null, availableVersion: '1.2.0',
        reason: 'Chưa có Revision vận hành nào pin entry này',
      },
    })).toEqual({ kind: 'unknown', reason: 'Chưa có Revision vận hành nào pin entry này' })
  })

  it('REQUIRES_MIGRATION mang cả hai version để nói rõ lệch ở đâu', () => {
    expect(compatibilityDisplay({
      compatibility: {
        state: 'REQUIRES_MIGRATION', requiredVersion: '1.0.0', availableVersion: '1.2.0',
        reason: 'Revision vận hành đang pin 1.0.0, bản PUBLISHED mới nhất là 1.2.0',
      },
    })).toEqual({
      kind: 'requires-migration', requiredVersion: '1.0.0', availableVersion: '1.2.0',
      reason: 'Revision vận hành đang pin 1.0.0, bản PUBLISHED mới nhất là 1.2.0',
    })
  })

  it('COMPATIBLE là trạng thái duy nhất không kèm lý do', () => {
    expect(compatibilityDisplay({
      compatibility: { state: 'COMPATIBLE', requiredVersion: '1.2.0', availableVersion: '1.2.0', reason: null },
    })).toEqual({ kind: 'compatible' })
  })

  it('giá trị enum lạ rơi về UNKNOWN, không rơi về COMPATIBLE', () => {
    /* Máy chủ mới có thể mọc thêm một giá trị mà bản FE này chưa biết. Kết luận
       "ổn" cho một thứ chưa hiểu là cách một khối được nâng version trong im
       lặng. Ép kiểu ở đây là cố ý: đang mô phỏng đúng payload mà TypeScript
       không chặn được lúc chạy. */
    const future = { state: 'PARTIALLY_COMPATIBLE', requiredVersion: null, availableVersion: null, reason: null }
    expect(compatibilityDisplay({
      compatibility: future as unknown as ProgrammingLibraryCompatibility,
    })).toEqual({ kind: 'unknown', reason: null })
  })
})
