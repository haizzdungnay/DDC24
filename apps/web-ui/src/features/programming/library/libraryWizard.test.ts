import { describe, expect, it } from 'vitest'
import {
  LIBRARY_WIZARD_STEPS,
  emptyLibraryWizardValues,
  libraryWizardCanAdvance,
  libraryWizardChanges,
  libraryWizardDirty,
  libraryWizardDraft,
  libraryWizardIssues,
  libraryWizardValuesFrom,
  nextLibraryWizardStep,
  previousLibraryWizardStep,
  type LibraryWizardContext,
  type LibraryWizardStep,
  type LibraryWizardValues,
} from './libraryWizard'
import { libraryEntryFixture } from './libraryFixture'
import type { LibraryEntryGroup } from '../model/library'

const ENTRY_A = '44444444-4444-4444-8444-44444444000a'
const ENTRY_B = '44444444-4444-4444-8444-44444444000b'
const ENTRY_C = '44444444-4444-4444-8444-44444444000c'

function context(overrides: Partial<LibraryWizardContext> = {}): LibraryWizardContext {
  return {
    entryId: ENTRY_A,
    mode: 'create',
    siblings: [],
    storedSourceAvailable: false,
    ...overrides,
  }
}

function values(overrides: Partial<LibraryWizardValues> = {}): LibraryWizardValues {
  return {
    ...emptyLibraryWizardValues(),
    name: 'SCALE_LIN',
    returnType: 'REAL',
    source: 'FUNCTION SCALE_LIN : REAL\nEND_FUNCTION\n',
    ...overrides,
  }
}

function codes(input: ReturnType<typeof libraryWizardIssues>): string[] {
  return input.map((issue) => issue.code)
}

describe('T61-401 — máy trạng thái wizard PROJECT Library', () => {
  it('một payload hợp lệ không sinh phát hiện nào', () => {
    expect(libraryWizardIssues(values(), context())).toEqual([])
  })

  it('Tiếp/Quay lại dừng ở hai đầu thay vì chạy ra ngoài danh sách bước', () => {
    expect(previousLibraryWizardStep('metadata')).toBe('metadata')
    expect(nextLibraryWizardStep('review')).toBe('review')
    // Đi hết từ đầu tới cuối phải qua ĐÚNG năm bước theo đúng thứ tự đã khoá.
    const walked: LibraryWizardStep[] = ['metadata']
    while (walked[walked.length - 1] !== 'review') {
      walked.push(nextLibraryWizardStep(walked[walked.length - 1]))
    }
    expect(walked).toEqual([...LIBRARY_WIZARD_STEPS])
  })

  it('chỉ chặn Tiếp vì lỗi CỦA CHÍNH bước đang đứng', () => {
    // Thiếu mã nguồn là lỗi của bước Hiện thực. Nó không được khoá người dùng ở
    // bước Thông tin, nơi họ chưa nhìn thấy ô mã nguồn.
    const issues = libraryWizardIssues(values({ source: '' }), context())
    expect(codes(issues)).toEqual(['LIB_SOURCE_INVALID'])
    expect(libraryWizardCanAdvance(issues, 'metadata')).toBe(true)
    expect(libraryWizardCanAdvance(issues, 'implementation')).toBe(false)
  })

  describe('kiểm tra thù địch, Unicode và trần kích thước', () => {
    it('tên ngoài định danh IEC bị chặn, kể cả khi trông hợp lệ với người đọc', () => {
      for (const name of ['1BAD', 'SCALE LIN', 'SCALE-LIN', 'SCALE_LÍN', '', 'A'.repeat(65)]) {
        expect(codes(libraryWizardIssues(values({ name }), context()))).toContain('LIB_NAME_INVALID')
      }
    })

    it('tên trùng không phân biệt hoa thường bị chặn ngay tại form', () => {
      const siblings = [{ entryId: ENTRY_B, name: 'Scale_Lin', dependencies: [] }]
      expect(codes(libraryWizardIssues(values(), context({ siblings })))).toContain('LIB_NAME_TAKEN')
    })

    it('mô tả đếm theo KÝ TỰ chứ không theo byte, nên tiếng Việt không bị chặn oan', () => {
      // 512 ký tự tiếng Việt là hơn 1000 byte UTF-8. Đếm byte ở FE sẽ chặn một
      // mô tả mà máy chủ chấp nhận.
      const justFits = 'đ'.repeat(512)
      expect(codes(libraryWizardIssues(values({ description: justFits }), context())))
        .not.toContain('LIB_DESCRIPTION_INVALID')
      expect(codes(libraryWizardIssues(values({ description: 'đ'.repeat(513) }), context())))
        .toContain('LIB_DESCRIPTION_INVALID')
    })

    it('ký tự điều khiển trong mô tả và thẻ bị chặn', () => {
      expect(codes(libraryWizardIssues(values({ description: 'a\u0000b' }), context())))
        .toContain('LIB_DESCRIPTION_INVALID')
      expect(codes(libraryWizardIssues(values({ tags: ['a\u0007b'] }), context())))
        .toContain('LIB_TAGS_INVALID')
    })

    it('trần thẻ là 8 phần tử và 24 ký tự mỗi thẻ', () => {
      expect(codes(libraryWizardIssues(values({ tags: Array.from({ length: 9 }, (_, index) => `t${index}`) }), context())))
        .toContain('LIB_TAGS_INVALID')
      expect(codes(libraryWizardIssues(values({ tags: ['x'.repeat(25)] }), context())))
        .toContain('LIB_TAGS_INVALID')
    })

    it('mã nguồn đếm theo BYTE và cho phép đúng ba ký tự trắng', () => {
      // Trần của máy chủ là 65536 BYTE, nên một ký tự nhiều byte phải tính đủ.
      const overByBytes = 'đ'.repeat(32769)
      expect(codes(libraryWizardIssues(values({ source: overByBytes }), context())))
        .toContain('LIB_SOURCE_INVALID')
      expect(codes(libraryWizardIssues(values({ source: 'A\tB\r\nC' }), context())))
        .not.toContain('LIB_SOURCE_INVALID')
      expect(codes(libraryWizardIssues(values({ source: 'A\u0000B' }), context())))
        .toContain('LIB_SOURCE_INVALID')
    })

    it('FBD phải là object JSON, không phải mảng hay chuỗi', () => {
      const fbd = (source: string) => codes(libraryWizardIssues(values({ language: 'FBD', source }), context()))
      expect(fbd('khong-phai-json')).toContain('LIB_SOURCE_NOT_JSON')
      expect(fbd('[1,2]')).toContain('LIB_SOURCE_NOT_JSON')
      expect(fbd('{"nodes":[]}')).not.toContain('LIB_SOURCE_NOT_JSON')
    })

    it('cổng phải mang tên IEC, kiểu thuộc registry và không trùng nhau', () => {
      const ports = (input: LibraryWizardValues['inputs']) => codes(libraryWizardIssues(values({ inputs: input }), context()))
      expect(ports([{ name: '1X', type: 'REAL' }])).toContain('LIB_PORT_NAME_INVALID')
      expect(ports([{ name: 'X', type: 'STRING' as never }])).toContain('LIB_PORT_TYPE_INVALID')
      expect(ports([{ name: 'X', type: 'REAL' }, { name: 'x', type: 'INT' }])).toContain('LIB_PORT_DUPLICATE')
    })

    it('FUNCTION phải có kiểu trả về, FUNCTION_BLOCK phải có cổng ra', () => {
      expect(codes(libraryWizardIssues(values({ returnType: '' }), context())))
        .toContain('LIB_RETURN_TYPE_MISSING')
      expect(codes(libraryWizardIssues(values({ kind: 'FUNCTION_BLOCK', returnType: '' }), context())))
        .toContain('LIB_OUTPUT_MISSING')
    })
  })

  describe('vòng phụ thuộc', () => {
    it('phụ thuộc chính nó bị chặn', () => {
      expect(codes(libraryWizardIssues(values({ dependencies: [ENTRY_A] }), context())))
        .toContain('LIB_DEPENDENCY_SELF')
    })

    it('phụ thuộc không có trong thư viện Project bị chặn', () => {
      expect(codes(libraryWizardIssues(values({ dependencies: [ENTRY_B] }), context())))
        .toContain('LIB_DEPENDENCY_UNKNOWN')
    })

    /*
    Vòng GIÁN TIẾP là ca thật sự: A -> B -> C -> A. Một phép kiểm chỉ chặn tự
    phụ thuộc sẽ xanh ở đây, và bản Draft vẫn ghi được — lỗi chỉ nổ ở lần Seal
    sau đó, cách chỗ gây lỗi hàng chục thao tác.
    */
    it('vòng gián tiếp qua nhiều khối bị chặn và nêu tên đường vòng', () => {
      const siblings = [
        { entryId: ENTRY_B, name: 'B_BLOCK', dependencies: [ENTRY_C] },
        { entryId: ENTRY_C, name: 'C_BLOCK', dependencies: [ENTRY_A] },
      ]
      const issues = libraryWizardIssues(values({ dependencies: [ENTRY_B] }), context({ siblings }))
      const cycle = issues.find((issue) => issue.code === 'LIB_DEPENDENCY_CYCLE')
      expect(cycle).toBeDefined()
      expect(cycle?.message).toContain('B_BLOCK')
      expect(cycle?.message).toContain('C_BLOCK')
    })

    it('đồ thị KHÔNG có vòng thì không báo gì — nếu không mọi phụ thuộc đều bị chặn', () => {
      const siblings = [
        { entryId: ENTRY_B, name: 'B_BLOCK', dependencies: [ENTRY_C] },
        { entryId: ENTRY_C, name: 'C_BLOCK', dependencies: [] },
      ]
      expect(codes(libraryWizardIssues(values({ dependencies: [ENTRY_B] }), context({ siblings })))).toEqual([])
    })
  })

  describe('nạp lại một entry đã lưu', () => {
    it('không bịa mã nguồn: hợp đồng đọc chưa mang source nên ô bắt đầu trống', () => {
      const loaded = libraryWizardValuesFrom(libraryEntryFixture({
        interface: { inputs: [{ name: 'X', type: 'REAL' }], returnType: 'REAL' },
      }))
      expect(loaded.source).toBe('')
      // Và chính vì trống, bước Hiện thực phải nói ra lý do thay vì chỉ "trống".
      const issue = libraryWizardIssues(loaded, context({ mode: 'edit' }))
        .find((item) => item.code === 'LIB_SOURCE_INVALID')
      expect(issue?.message).toContain('chưa trả lại mã nguồn')
    })

    it('giữ nguyên các khoá interface mà wizard không mô hình hoá', () => {
      /* `interface` nằm trong `contentSha256` và upsert ghi đè TOÀN PHẦN: dựng
         lại nó chỉ từ ba khoá wizard biết sẽ âm thầm xoá phần còn lại, nên một
         lần sửa mô tả cũng đủ làm mất hợp đồng POU. */
      const stored = {
        inputs: [{ name: 'X', type: 'REAL' }],
        returnType: 'REAL',
        vendorExtension: { retainHint: true },
      }
      const loaded = libraryWizardValuesFrom(libraryEntryFixture({ interface: stored }))
      const draft = libraryWizardDraft(loaded, context({ mode: 'edit' }), [])
      expect(draft.interface).toEqual(stored)
    })
  })

  it('bẩn là khi GIÁ TRỊ khác đi, không phải khi người dùng đã gõ', () => {
    const baseline = values()
    expect(libraryWizardDirty(baseline, baseline)).toBe(false)
    const edited = values({ name: 'OTHER' })
    expect(libraryWizardDirty(edited, baseline)).toBe(true)
    // Gõ rồi xoá lại về đúng như cũ thì KHÔNG còn bẩn: hỏi "mất dữ liệu?" khi
    // không có gì để mất là cách làm hộp thoại ấy mất tác dụng.
    expect(libraryWizardDirty(values({ name: baseline.name }), baseline)).toBe(false)
  })

  it('bảng Xem lại tách thay đổi nội dung khỏi thay đổi trình bày (D61-09)', () => {
    const baseline = values()
    const changed = values({ description: 'mô tả mới', source: baseline.source + 'X' })
    const changes = libraryWizardChanges(changed, baseline)
    expect(changes.map((row) => row.field).sort()).toEqual(['description', 'source'])
    expect(changes.find((row) => row.field === 'source')?.impact).toBe('content')
    expect(changes.find((row) => row.field === 'description')?.impact).toBe('presentation')
    // Không đổi gì thì bảng RỖNG, chứ không liệt kê mọi trường với giá trị giống
    // nhau ở cả hai cột.
    expect(libraryWizardChanges(baseline, baseline)).toEqual([])
  })

  it('payload bỏ hẳn field trống thay vì gửi chuỗi rỗng', () => {
    const projectEntries: LibraryEntryGroup[] = []
    const draft = libraryWizardDraft(values(), context(), projectEntries)
    expect('category' in draft).toBe(false)
    expect('description' in draft).toBe(false)
    expect('tags' in draft).toBe(false)
    const filled = libraryWizardDraft(
      values({ category: ' math ', description: ' mô tả ', tags: [' AHU ', ''] }),
      context(),
      projectEntries
    )
    expect(filled.category).toBe('math')
    expect(filled.description).toBe('mô tả')
    expect(filled.tags).toEqual(['AHU'])
  })
})
