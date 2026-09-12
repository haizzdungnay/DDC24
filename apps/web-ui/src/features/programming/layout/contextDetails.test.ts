import { describe, expect, it } from 'vitest'
import {
  contextDetailRows,
  formatObservedAt,
  localTime,
  MISSING_CONTENT_HASH_REASON,
  type ContextDetailsData
} from './contextDetails'

/**
 * `T60-103` — luật của Ô TRỐNG, kiểm ở tầng hàm thuần.
 *
 * File này KHÔNG kiểm markup. Nó kiểm thứ dễ hỏng âm thầm nhất của popover:
 * mỗi dữ kiện thiếu phải nói được VÌ SAO nó thiếu, và không nhánh nào được
 * mượn dữ kiện của nhánh khác để lấp chỗ trống.
 */

const pickVi = (vi: string, _en: string) => vi
const pickEn = (_vi: string, en: string) => en

const DRAFT_REVISION_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ACTIVE_REVISION_ID = '9c858901-8a57-4791-81fe-4c455b099bc9'
const LKG_REVISION_ID = '2c9e7b2a-1c0e-4a6b-9a51-9ac7f5f5cb18'
const DRAFT_HASH = 'a'.repeat(64)
const ACTIVE_HASH = 'b'.repeat(64)

const full: ContextDetailsData = {
  draftRevisionId: DRAFT_REVISION_ID,
  draftContentHash: DRAFT_HASH,
  activeRevisionId: ACTIVE_REVISION_ID,
  activeContentHash: ACTIVE_HASH,
  lkgRevisionId: LKG_REVISION_ID,
  controllerId: 'controller-local',
  observedAt: '2026-08-21T10:00:00Z',
  coreStatus: 'readable'
}

const empty: ContextDetailsData = {
  draftRevisionId: null,
  draftContentHash: null,
  activeRevisionId: null,
  activeContentHash: null,
  lkgRevisionId: null,
  controllerId: null,
  observedAt: null,
  coreStatus: 'readable'
}

function rowsOf(data: ContextDetailsData, pick = pickVi) {
  const rows = contextDetailRows(pick, data)
  return new Map(rows.map((row) => [row.id, row]))
}

describe('contextDetailRows — bốn nhóm dữ kiện của T60-103', () => {
  it('dựng đủ bảy dòng theo thứ tự đọc: cặp Draft → cặp Active → LKG → bộ điều khiển → mốc đọc', () => {
    expect(contextDetailRows(pickVi, full).map((row) => row.id)).toEqual([
      'draftRevisionId',
      'draftContentHash',
      'activeRevisionId',
      'activeContentHash',
      'lkgRevisionId',
      'controllerId',
      'observedAt'
    ])
  })

  it('giữ nguyên chuỗi THÔ để Copy dán được vào phiếu sự cố, không rút gọn', () => {
    const rows = rowsOf(full)
    expect(rows.get('draftRevisionId')?.value).toBe(DRAFT_REVISION_ID)
    expect(rows.get('activeRevisionId')?.value).toBe(ACTIVE_REVISION_ID)
    expect(rows.get('lkgRevisionId')?.value).toBe(LKG_REVISION_ID)
    expect(rows.get('draftContentHash')?.value).toBe(DRAFT_HASH)
    expect(rows.get('activeContentHash')?.value).toBe(ACTIVE_HASH)
    expect(rows.get('controllerId')?.value).toBe('controller-local')
    expect(rows.get('observedAt')?.value).toBe('2026-08-21T10:00:00Z')
    for (const row of contextDetailRows(pickVi, full)) expect(row.missingReason).toBeNull()
  })

  it('BẤT BIẾN: value rỗng ⇔ có lý do; không dòng nào trống im lặng và không dòng nào ra số 0', () => {
    const cases: ContextDetailsData[] = [full, empty, { ...empty, coreStatus: 'unreadable' }, { ...empty, coreStatus: 'loading' }]
    for (const data of cases) {
      for (const row of contextDetailRows(pickVi, data)) {
        expect(row.value === null).toBe(row.missingReason !== null)
        expect(row.value).not.toBe('')
        expect(row.value).not.toBe('0')
        if (row.value === null) expect((row.missingReason ?? '').length).toBeGreaterThan(8)
      }
    }
  })

  it('chuỗi rỗng hoặc toàn khoảng trắng bị coi là THIẾU — không đặt chuỗi rỗng vào clipboard', () => {
    const rows = rowsOf({ ...full, controllerId: '   ', activeRevisionId: '' })
    expect(rows.get('controllerId')?.value).toBeNull()
    expect(rows.get('controllerId')?.missingReason).toBe('Không đọc được từ Core')
    expect(rows.get('activeRevisionId')?.value).toBeNull()
  })
})

describe('contextDetailRows — lý do đúng nguồn gốc, không suy diễn', () => {
  it('Core im: bốn dữ kiện của Core nói "không đọc được", KHÔNG nói "chưa Commission"', () => {
    const rows = rowsOf({ ...empty, coreStatus: 'unreadable' })
    for (const id of ['activeRevisionId', 'activeContentHash', 'lkgRevisionId', 'controllerId', 'observedAt'] as const) {
      expect(rows.get(id)?.missingReason).toBe('Không đọc được từ Core')
    }
    // Đây là điểm dễ sai nhất: gộp "Core im" với "Core nói chưa có" sẽ dạy
    // người vận hành rằng thiết bị trống, trong khi thật ra không ai biết.
    expect(rows.get('activeRevisionId')?.missingReason).not.toBe('Chưa Commission gói nào lên thiết bị')
  })

  it('đang đọc lần đầu: nói "đang đọc", KHÔNG dán nhãn mất kết nối giả lên mỗi lần vào trang', () => {
    const rows = rowsOf({ ...empty, coreStatus: 'loading' })
    for (const id of ['activeRevisionId', 'lkgRevisionId', 'controllerId', 'observedAt'] as const) {
      expect(rows.get(id)?.missingReason).toBe('Đang đọc từ Core…')
    }
    // Draft đến từ read-model Project, không đi qua Core: nó không được đổi
    // giọng theo tình trạng Core.
    expect(rows.get('draftRevisionId')?.missingReason).toBe('Chưa có bản nháp cho Project này')
  })

  it('Core đọc được và trả về chưa có Active: nói đúng "chưa Commission", không đổ cho mất kết nối', () => {
    const rows = rowsOf({ ...full, activeRevisionId: null, activeContentHash: null, lkgRevisionId: null })
    expect(rows.get('activeRevisionId')?.missingReason).toBe('Chưa Commission gói nào lên thiết bị')
    expect(rows.get('activeContentHash')?.missingReason).toBe('Chưa Commission gói nào lên thiết bị')
    expect(rows.get('lkgRevisionId')?.missingReason).toBe('Chưa có bản tốt gần nhất (LKG)')
  })

  /**
   * `ISS-PGUI-01` — thiết bị ĐANG chạy một gói, chỉ là gói của Project khác.
   *
   * Ô này là thứ người vận hành chép vào phiếu sự cố trước khi cân nhắc
   * rollback. "Chưa Commission gói nào lên thiết bị" ở đây không phải một câu
   * thận trọng mà là một câu sai về thiết bị.
   */
  it('gói đang vận hành thuộc Project khác: nói đúng chủ, không nói "chưa Commission"', () => {
    const rows = rowsOf({ ...full, activeRevisionId: null, activeContentHash: null, activeOwnership: 'foreign' })
    expect(rows.get('activeRevisionId')?.missingReason).toBe('Gói đang vận hành thuộc Project khác')
    expect(rows.get('activeContentHash')?.missingReason).toBe('Gói đang vận hành thuộc Project khác')
  })

  it('không quy được gói đang vận hành về Project nào: nói chưa xác định', () => {
    const rows = rowsOf({ ...full, activeRevisionId: null, activeContentHash: null, activeOwnership: 'unresolved' })
    expect(rows.get('activeRevisionId')?.missingReason)
      .toBe('Chưa xác định được gói đang vận hành thuộc Project nào')
  })

  /* Core im vẫn THẮNG mọi lý do quyền sở hữu: không đọc được runtime thì cũng
     không có cơ sở nói gói đang chạy là của ai. */
  it('Core im thắng lý do quyền sở hữu', () => {
    const rows = rowsOf({ ...empty, coreStatus: 'unreadable', activeOwnership: 'foreign' })
    expect(rows.get('activeRevisionId')?.missingReason).toBe('Không đọc được từ Core')
  })

  it('chưa có Draft: cả ID lẫn contentHash của Draft cùng nói "chưa có bản nháp"', () => {
    const rows = rowsOf({ ...full, draftRevisionId: null, draftContentHash: null })
    expect(rows.get('draftRevisionId')?.missingReason).toBe('Chưa có bản nháp cho Project này')
    expect(rows.get('draftContentHash')?.missingReason).toBe('Chưa có bản nháp cho Project này')
    expect(rows.get('draftContentHash')?.missingReason).not.toBe(MISSING_CONTENT_HASH_REASON[0])
  })

  it('có Revision nhưng chưa có hash: nói đúng giới hạn của màn này, không đổ cho dữ liệu', () => {
    const rows = rowsOf({ ...full, draftContentHash: null, activeContentHash: null })
    expect(rows.get('draftContentHash')?.missingReason).toBe(MISSING_CONTENT_HASH_REASON[0])
    expect(rows.get('activeContentHash')?.missingReason).toBe(MISSING_CONTENT_HASH_REASON[0])
  })

  it('KHÔNG mượn hash của Draft cho Active — hai Revision là hai sự thật', () => {
    const rows = rowsOf({ ...full, activeContentHash: null })
    expect(rows.get('draftContentHash')?.value).toBe(DRAFT_HASH)
    expect(rows.get('activeContentHash')?.value).toBeNull()
  })
})

describe('contextDetailRows — mốc đọc gần nhất', () => {
  it('hiển thị chuỗi máy chủ nguyên bản và kèm giờ địa phương như một diễn giải phụ', () => {
    const row = rowsOf(full).get('observedAt')
    expect(row?.value).toBe('2026-08-21T10:00:00Z')
    expect(row?.hint).toBe(`Giờ địa phương: ${localTime('2026-08-21T10:00:00Z')}`)
  })

  it('mốc thời gian hỏng: giữ nguyên chuỗi gốc và nói rõ không phân giải được, không thay bằng "bây giờ"', () => {
    const row = rowsOf({ ...full, observedAt: 'không-phải-thời-gian' }).get('observedAt')
    expect(row?.value).toBe('không-phải-thời-gian')
    expect(row?.hint).toBe('Không phân giải được mốc thời gian; giữ nguyên chuỗi máy chủ trả về')
    expect(localTime('không-phải-thời-gian')).toBeNull()
    expect(formatObservedAt('không-phải-thời-gian')).toBe('không-phải-thời-gian')
  })
})

describe('D-06 — một ngôn ngữ tại một thời điểm', () => {
  it('chế độ EN không rò chuỗi tiếng Việt ở nhãn lẫn ở lý do', () => {
    const viRows = contextDetailRows(pickVi, { ...empty, coreStatus: 'unreadable' })
    const enRows = contextDetailRows(pickEn, { ...empty, coreStatus: 'unreadable' })
    const enText = enRows.map((row) => `${row.label} ${row.missingReason ?? ''} ${row.hint ?? ''}`).join(' ')
    expect(enText).not.toMatch(/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i)
    // Cùng số dòng, cùng thứ tự — chỉ đổi ngôn ngữ, không đổi nội dung dữ kiện.
    expect(enRows.map((row) => row.id)).toEqual(viRows.map((row) => row.id))
  })
})
