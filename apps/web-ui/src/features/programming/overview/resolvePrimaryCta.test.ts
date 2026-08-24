import { describe, expect, it } from 'vitest'
import {
  primaryCtaLabel,
  primaryCtaUndecidedLabel,
  resolvePrimaryCta,
  type PrimaryCtaInput,
  type PrimaryCtaKind,
  type PrimaryCtaUndecidedReason
} from './resolvePrimaryCta'

/**
 * `T60-201` — bảng năm trạng thái của `PGM-01_OVERVIEW_FE_HANDOFF.md` §3, phủ
 * **cả năm hàng** cộng các biên mà `AC-PGM01-05` phụ thuộc vào.
 *
 * Ba nhóm khẳng định:
 *
 * 1. Năm hàng ra đúng năm CTA, và mỗi lần chỉ ra MỘT (kiểu trả về không cho
 *    phép nhiều hơn một, nên phần "đúng một" được khoá ngay ở hình dạng dữ liệu
 *    chứ không phải bằng một phép đếm DOM sau này).
 * 2. Thiếu dữ kiện KHÔNG rơi vào CTA nào — mọi nhánh đó phải trả `kind = null`
 *    kèm lý do. Đây là phần dễ hồi quy nhất: một `if` xếp sai chỗ sẽ biến "chưa
 *    biết" thành "Commission".
 * 3. Nhãn không rò ngôn ngữ (D-06).
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const BASE_REVISION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_REVISION_ID = '33333333-3333-4333-8333-333333333333'

/** Nền: Project đọc được, Draft sạch, Check PASSED, Core sống, Active khác Draft. */
function input(overrides: Partial<PrimaryCtaInput> = {}): PrimaryCtaInput {
  return {
    projectStatus: 'ready',
    projectId: PROJECT_ID,
    baseRevisionId: BASE_REVISION_ID,
    dirty: false,
    latestCheckState: 'PASSED',
    runtimeStatus: 'ready',
    producerState: 'READY',
    activeRevisionId: OTHER_REVISION_ID,
    ...overrides
  }
}

describe('resolvePrimaryCta — năm hàng của handoff §3', () => {
  it('hàng 1 — Draft dirty ⇒ Tiếp tục chỉnh sửa, đích là workspace PGM-02', () => {
    const decision = resolvePrimaryCta(input({ dirty: true }))
    expect(decision.kind).toBe('CONTINUE_EDITING')
    expect(decision.row).toBe(1)
    expect(decision.route).toBe(`/eng/programming/projects/${PROJECT_ID}/programs`)
    expect(decision.undecidedReason).toBeNull()
  })

  it('hàng 1 thắng hàng 2: Draft dirty VÀ Check gần nhất FAILED vẫn ra Tiếp tục chỉnh sửa', () => {
    // Bảng §3 là bảng CÓ THỨ TỰ. Một bản nháp đã đổi từ sau lần Check hỏng thì
    // danh sách lỗi cũ nói về mã nguồn không còn tồn tại — dẫn người dùng tới
    // đó là chỉ vào một chẩn đoán đã hết hiệu lực.
    expect(resolvePrimaryCta(input({ dirty: true, latestCheckState: 'FAILED' })).kind).toBe('CONTINUE_EDITING')
  })

  it('hàng 2 — Check FAILED ⇒ Sửa lỗi Kiểm tra', () => {
    const decision = resolvePrimaryCta(input({ latestCheckState: 'FAILED' }))
    expect(decision.kind).toBe('FIX_CHECK_ERRORS')
    expect(decision.row).toBe(2)
    expect(decision.route).toBe(`/eng/programming/projects/${PROJECT_ID}/commission`)
  })

  it('hàng 2 — TIMED_OUT cũng là Check không đạt, không phải "chưa Check"', () => {
    expect(resolvePrimaryCta(input({ latestCheckState: 'TIMED_OUT' })).kind).toBe('FIX_CHECK_ERRORS')
  })

  it('hàng 3 — Draft đã Check PASSED và Active khác ⇒ Xem lại thay đổi', () => {
    const decision = resolvePrimaryCta(input())
    expect(decision.kind).toBe('REVIEW_CHANGES')
    expect(decision.row).toBe(3)
  })

  it('hàng 4 — Check PASSED nhưng chưa có Active nào để so ⇒ Đưa vào vận hành', () => {
    const decision = resolvePrimaryCta(input({ activeRevisionId: null }))
    expect(decision.kind).toBe('COMMISSION')
    expect(decision.row).toBe(4)
    expect(decision.route).toBe(`/eng/programming/projects/${PROJECT_ID}/commission`)
  })

  it('hàng 5 — Active trùng đúng Revision nền của Draft ⇒ Mở Runtime', () => {
    const decision = resolvePrimaryCta(input({ activeRevisionId: BASE_REVISION_ID }))
    expect(decision.kind).toBe('OPEN_RUNTIME')
    expect(decision.row).toBe(5)
    expect(decision.route).toBe('/eng/programming/runtime')
  })

  it('hàng 5 thắng hàng 3: không có thay đổi thì không đề nghị xem lại thay đổi', () => {
    // Cùng một Revision đang chạy và đang là nền của Draft ⇒ bảng thay đổi rỗng.
    expect(resolvePrimaryCta(input({ activeRevisionId: BASE_REVISION_ID, latestCheckState: 'PASSED' })).kind)
      .toBe('OPEN_RUNTIME')
  })

  it('mỗi lần chỉ có đúng MỘT hành động chính trên cả năm hàng (AC-PGM01-05)', () => {
    const rows: PrimaryCtaInput[] = [
      input({ dirty: true }),
      input({ latestCheckState: 'FAILED' }),
      input(),
      input({ activeRevisionId: null }),
      input({ activeRevisionId: BASE_REVISION_ID })
    ]
    const kinds = rows.map((row) => resolvePrimaryCta(row).kind)
    expect(kinds).toEqual(['CONTINUE_EDITING', 'FIX_CHECK_ERRORS', 'REVIEW_CHANGES', 'COMMISSION', 'OPEN_RUNTIME'])
    // Năm hàng ⇒ năm CTA khác nhau, không hàng nào trả về hai giá trị hay rỗng.
    expect(new Set(kinds).size).toBe(5)
    expect(kinds.every((kind) => kind !== null)).toBe(true)
  })
})

describe('resolvePrimaryCta — thiếu dữ kiện thì KHÔNG đoán CTA', () => {
  const cases: Array<[string, Partial<PrimaryCtaInput>, PrimaryCtaUndecidedReason]> = [
    ['Project đang tải', { projectStatus: 'loading' }, 'PROJECT_LOADING'],
    ['đọc Project hỏng', { projectStatus: 'error' }, 'PROJECT_UNAVAILABLE'],
    ['chưa có Project nào', { projectId: null, baseRevisionId: null }, 'NO_PROJECT'],
    ['có Project nhưng chưa phân giải được Revision nền', { baseRevisionId: null }, 'NO_PROJECT'],
    ['server trả dirty = null', { dirty: null }, 'DIRTY_UNKNOWN'],
    ['Check đang xếp hàng', { latestCheckState: 'QUEUED' }, 'CHECK_IN_PROGRESS'],
    ['Check đang chạy', { latestCheckState: 'RUNNING' }, 'CHECK_IN_PROGRESS'],
    ['runtime đang tải', { runtimeStatus: 'loading' }, 'RUNTIME_LOADING'],
    ['đọc runtime hỏng', { runtimeStatus: 'error' }, 'RUNTIME_UNAVAILABLE'],
    ['Core im (producerState UNAVAILABLE)', { producerState: 'UNAVAILABLE' }, 'RUNTIME_UNAVAILABLE'],
    ['chưa có producerState', { producerState: null }, 'RUNTIME_UNAVAILABLE']
  ]

  it.each(cases)('%s ⇒ không CTA nào, có lý do', (_name, overrides, reason) => {
    const decision = resolvePrimaryCta(input(overrides))
    expect(decision.kind).toBeNull()
    expect(decision.row).toBeNull()
    expect(decision.route).toBeNull()
    expect(decision.undecidedReason).toBe(reason)
  })

  it('dirty = null KHÔNG được coi là "sạch" rồi đẩy tới Commission', () => {
    // Đây là biên nguy hiểm nhất của cả hàm: `dirty` là `boolean | null`, và
    // `if (dirty)` một mình sẽ gộp `null` vào `false`.
    const decision = resolvePrimaryCta(input({ dirty: null, activeRevisionId: null }))
    expect(decision.kind).not.toBe('COMMISSION')
    expect(decision.undecidedReason).toBe('DIRTY_UNKNOWN')
  })

  it('Core im vẫn cho Tiếp tục chỉnh sửa và Sửa lỗi Kiểm tra (README §6)', () => {
    // Core offline chỉ khoá Commission; sửa bản nháp và xem lỗi Check là việc
    // hoàn toàn cục bộ ở web-api, không cần Core trả lời.
    expect(resolvePrimaryCta(input({ producerState: 'UNAVAILABLE', dirty: true })).kind).toBe('CONTINUE_EDITING')
    expect(resolvePrimaryCta(input({ producerState: 'UNAVAILABLE', latestCheckState: 'FAILED' })).kind)
      .toBe('FIX_CHECK_ERRORS')
  })

  it('Core DEGRADED vẫn là một câu trả lời tường minh của server, không phải thiếu dữ kiện', () => {
    expect(resolvePrimaryCta(input({ producerState: 'DEGRADED' })).kind).toBe('REVIEW_CHANGES')
  })

  it('bản niêm phong chưa từng Check ⇒ quay về workspace, không nhảy tới Commission (WP-01)', () => {
    const decision = resolvePrimaryCta(input({ latestCheckState: null }))
    expect(decision.kind).toBe('CONTINUE_EDITING')
    expect(decision.row).toBe(1)
  })
})

describe('resolvePrimaryCta — nhãn theo đúng một ngôn ngữ (D-06)', () => {
  const vi = (v: string, _e: string) => v
  const en = (_v: string, e: string) => e

  it('mọi CTA đều có nhãn ở cả hai ngôn ngữ và không trộn lẫn', () => {
    const kinds: PrimaryCtaKind[] = ['CONTINUE_EDITING', 'FIX_CHECK_ERRORS', 'REVIEW_CHANGES', 'COMMISSION', 'OPEN_RUNTIME']
    for (const kind of kinds) {
      expect(primaryCtaLabel(vi, kind).length).toBeGreaterThan(0)
      expect(primaryCtaLabel(en, kind).length).toBeGreaterThan(0)
      expect(primaryCtaLabel(vi, kind)).not.toBe(primaryCtaLabel(en, kind))
    }
    expect(primaryCtaLabel(en, 'COMMISSION')).toBe('Commission')
    expect(primaryCtaLabel(vi, 'COMMISSION')).toBe('Đưa vào vận hành')
  })

  it('mọi lý do "chưa kết luận" đều nói thành lời, không để trống', () => {
    const reasons: PrimaryCtaUndecidedReason[] = [
      'PROJECT_LOADING', 'PROJECT_UNAVAILABLE', 'NO_PROJECT', 'DIRTY_UNKNOWN',
      'CHECK_IN_PROGRESS', 'RUNTIME_LOADING', 'RUNTIME_UNAVAILABLE'
    ]
    for (const reason of reasons) {
      expect(primaryCtaUndecidedLabel(vi, reason).length).toBeGreaterThan(0)
      expect(primaryCtaUndecidedLabel(en, reason).length).toBeGreaterThan(0)
      // Bản EN không được rò ký tự có dấu tiếng Việt (tiền lệ BUG-018).
      expect(primaryCtaUndecidedLabel(en, reason)).not.toMatch(/[àáảãạăâđêôơư]/i)
    }
  })
})
