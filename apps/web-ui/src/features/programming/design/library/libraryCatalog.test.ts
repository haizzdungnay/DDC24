import { describe, expect, it } from 'vitest'
import type { ProgrammingLibraryPage, ProgrammingLibrarySignature } from '../../model/types'
import {
  catalogCategories,
  catalogEntries,
  catalogParity,
  filterCatalog,
  isInsertable,
} from './libraryCatalog'
import { insertBlockReason } from '../../library/libraryPresentation'
import { stCallStatement } from '../editor/stInstanceInsertion'

/* `T61-203` — chữ ký ĐÃ PHÂN GIẢI, đúng hình dạng máy chủ trả. FE không còn
   parse `interface` thô, nên fixture khai bằng chuỗi JSON sẽ không sinh port
   nào — và một fixture không sinh port thì test đang đo chính thứ nó vừa làm
   hỏng. */
function signature(extra: Record<string, unknown> = {}): ProgrammingLibrarySignature {
  return {
    category: 'math',
    labelVi: 'Giới hạn (LIMIT)',
    labelEn: 'Limit',
    dispatch: 'FUNC_TABLE',
    polymorphic: true,
    typedPortNames: [],
    allowedTypes: ['REAL', 'INT'],
    defaultType: 'REAL',
    ports: [
      { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
      { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
      { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
      { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
    ],
    ...extra
  } as ProgrammingLibrarySignature
}

function page(): ProgrammingLibraryPage {
  return {
    items: [
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT', featureState: 'AVAILABLE',
        contentSha256: 'a'.repeat(64), signature: signature(), category: 'math', dependencies: [],
        stateLayoutKnown: true, stateSizeBytes: 0
      },
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'TON', kind: 'FUNCTION_BLOCK', name: 'TON', featureState: 'AVAILABLE',
        contentSha256: 'b'.repeat(64),
        signature: {
          dispatch: 'FB_TYPE', polymorphic: false, typedPortNames: [],
          category: 'timer', labelVi: 'Trễ bật (TON)', labelEn: 'On delay', allowedTypes: [],
          ports: [
            { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
            { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
            { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' }
          ]
        },
        category: 'timer', dependencies: [], stateLayoutKnown: true, stateSizeBytes: 16
      },
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'PID', kind: 'FUNCTION_BLOCK', name: 'PID', featureState: 'REVIEW_REQUIRED',
        contentSha256: 'c'.repeat(64),
        signature: {
          dispatch: 'FB_TYPE', polymorphic: false, typedPortNames: [],
          category: 'control', labelVi: 'PID', labelEn: 'PID', allowedTypes: [],
          ports: [{ name: 'PV', direction: 'INPUT', dataType: 'REAL' }, { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }]
        },
        category: 'control', dependencies: [], stateLayoutKnown: true, stateSizeBytes: 64
      },
      {
        scope: 'PROJECT', libraryRevisionId: 'prj-1', libraryVersion: '1', libraryState: 'PUBLISHED',
        entryId: 'AHU_HELPER', kind: 'FUNCTION', name: 'AHU_HELPER', language: 'ST', featureState: 'AVAILABLE',
        contentSha256: 'd'.repeat(64), interface: 'không-phải-json', dependencies: [],
        stateLayoutKnown: false, stateSizeBytes: 0
      }
    ]
  }
}

describe('PGM-02 catalog thư viện dùng chung', () => {
  it('dùng chữ ký ĐÃ PHÂN GIẢI của backend khi có, không tự parse lại', () => {
    const [entry] = catalogEntries({
      items: [{
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.3', libraryState: 'PUBLISHED',
        entryId: 'TON', kind: 'FUNCTION_BLOCK', name: 'TON', featureState: 'AVAILABLE',
        contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 10,
        // Chữ ký THÔ cố ý hỏng: nếu FE vẫn tự parse thì test này đỏ.
        interface: 'không-phải-json',
        /* `T61-203` — `category` CÔNG KHAI khác `signature.category` một cách cố
           ý. Bản cũ của Quick Library đọc từ chữ ký, nên nó sẽ trả `'timer'`
           trong khi PGM-04 trả `'sensor'` cho cùng một khối. Trường công khai
           là trường người dùng sửa được; blob chữ ký thì không. */
        category: 'sensor',
        signature: {
          category: 'timer', labelVi: 'Trễ bật', labelEn: 'On delay', dispatch: 'FB_TYPE',
          polymorphic: false, allowedTypes: [], typedPortNames: [],
          ports: [
            { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
            { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' }
          ]
        }
      }]
    })
    expect(entry.usability).toEqual({ kind: 'AVAILABLE' })
    expect(entry.category).toBe('sensor')
    expect(entry.ports.map((port) => port.name)).toEqual(['IN', 'Q'])
  })

  it('chuẩn hoá SYSTEM và PROJECT trong cùng một danh sách', () => {
    const entries = catalogEntries(page())
    /* `T61-203` — thứ tự nay là thứ tự của `groupLibraryEntries`, luật gom của
       PGM-04 (theo TÊN, rồi `entryId`). Trước lát này Quick Library giữ nguyên
       thứ tự máy chủ trả, nên cùng một thư viện xếp khác nhau ở hai màn hình. */
    expect(entries.map((entry) => entry.entryId)).toEqual(['AHU_HELPER', 'LIMIT', 'PID', 'TON'])
    const limit = entries.find((entry) => entry.entryId === 'LIMIT')!
    const ton = entries.find((entry) => entry.entryId === 'TON')!
    expect(limit.category).toBe('math')
    expect(limit.ports).toHaveLength(4)
    // FB có trạng thái nội tại; FUNCTION thì không.
    expect(ton.stateful).toBe(true)
    expect(limit.stateful).toBe(false)
  })

  it('mục chữ ký hỏng KHÔNG biến mất mà được đánh dấu không dùng được', () => {
    const entries = catalogEntries(page())
    const broken = entries.find((entry) => entry.entryId === 'AHU_HELPER')
    expect(broken?.usability).toEqual({ kind: 'SIGNATURE_UNAVAILABLE' })
    expect(broken?.ports).toEqual([])
    expect(isInsertable(broken!)).toBe(false)
  })

  it('REVIEW_REQUIRED hiện ra nhưng không chèn được', () => {
    const pid = catalogEntries(page()).find((entry) => entry.entryId === 'PID')!
    expect(pid.usability).toEqual({ kind: 'REVIEW_REQUIRED' })
    expect(isInsertable(pid)).toBe(false)
  })

  /*
  `T61-406` — parity với PGM-04 trên lý do thứ tư.

  Trước lát này `isInsertable` đọc thẳng `usability` và bỏ trắng
  `compatibility`, nên một khối `REQUIRES_MIGRATION` bị PGM-04 chặn vẫn chèn
  được từ khay chèn nhanh: cùng một khối, hai câu trả lời, và câu dễ dãi hơn nằm
  đúng ở bề mặt người ta chèn nhanh. Đây chính là lớp lỗi `T61-203` đã phải sửa
  một lần cho `DEPRECATED`.

  Kiểm bằng CẢ HAI bề mặt trong cùng một `it`: kiểm mỗi bên một nơi thì hai bên
  lại lệch được mà không test nào đỏ.
  */
  it('REQUIRES_MIGRATION: Quick Library và PGM-04 nói CÙNG một câu', () => {
    const raw = page()
    const withPin = {
      ...raw,
      items: raw.items.map((item) =>
        item.entryId === 'TON'
          ? {
              ...item,
              compatibility: {
                state: 'REQUIRES_MIGRATION' as const,
                requiredVersion: '1.0.0',
                availableVersion: '2.0.0',
                reason: 'Revision đang chạy pin 1.0.0',
              },
            }
          : item
      ),
    }
    const ton = catalogEntries(withPin).find((entry) => entry.entryId === 'TON')!
    expect(ton.usability).toEqual({ kind: 'AVAILABLE' })
    expect(isInsertable(ton)).toBe(false)
    expect(insertBlockReason(withPin.items.find((item) => item.entryId === 'TON')!, true))
      .toBe('REQUIRES_MIGRATION')
  })

  /* `UNKNOWN` là mặc định của hợp đồng và MỌI entry SYSTEM đều mang nó — chặn
     cứng là chặn `TON` trên mọi Project chưa Commission. Fixture này không khai
     `compatibility`, tức đúng ca "field vắng". */
  it('UNKNOWN không được biến thành một lệnh cấm chèn', () => {
    const ton = catalogEntries(page()).find((entry) => entry.entryId === 'TON')!
    expect(ton.compatibility).toEqual({ kind: 'unknown', reason: null })
    expect(isInsertable(ton)).toBe(true)
  })

  it('lọc theo tên, nhóm, ngôn ngữ và kiểu dữ liệu của port', () => {
    const entries = catalogEntries(page())
    expect(filterCatalog(entries, { query: 'lim' }).map((entry) => entry.entryId)).toEqual(['LIMIT'])
    expect(filterCatalog(entries, { category: 'timer' }).map((entry) => entry.entryId)).toEqual(['TON'])
    expect(filterCatalog(entries, { dataType: 'TIME' }).map((entry) => entry.entryId)).toEqual(['TON'])
    // Mục ràng buộc ngôn ngữ ST bị loại khi đang mở POU FBD; mục không ràng
    // buộc thì vẫn hiện.
    expect(filterCatalog(entries, { language: 'FBD' }).map((entry) => entry.entryId)).toEqual(['LIMIT', 'PID', 'TON'])
    /* Không còn chip `'other'`: `AHU_HELPER` chưa được phân loại, và bản cũ quy
       cái vắng ấy về một nhóm tên `other` mà không ai đặt — người dùng bấm vào
       nó rồi tưởng đó là một phân loại thật của sản phẩm. */
    expect(catalogCategories(entries)).toEqual(['control', 'math', 'timer'])
  })

  it('đoạn ST cho FUNCTION là một lời gọi, cho FUNCTION_BLOCK có cả khai instance', () => {
    const entries = catalogEntries(page())
    expect(stCallStatement(entries.find((entry) => entry.entryId === 'LIMIT')!)).toBe('OUT := LIMIT(MN, IN, MX);')
    /* Lời gọi KHÔNG còn kèm khối `VAR ... END_VAR`: khai báo thuộc vùng khai
     * báo của POU, đặt nó giữa thân là lỗi cú pháp theo grammar ST §10 —
     * `planLibraryInsertion` mới là chỗ đặt hai phần về đúng chỗ. */
    const ton = stCallStatement(entries.find((entry) => entry.entryId === 'TON')!, 'TON_Fan')
    expect(ton).toBe('TON_Fan(IN := IN, PT := PT);')
    expect(ton).not.toContain('VAR')
  })

  it('parity SYSTEM giữa backend và registry sinh sẵn nói rõ lệch ở phía nào', () => {
    const entries = catalogEntries(page())
    expect(catalogParity(entries, ['LIMIT', 'TON', 'PID'])).toEqual({
      onlyInBackend: [], onlyInGenerated: [], matched: 3
    })
    // Palette từng chào block mà compiler không có: parity phải chỉ đúng phía sai.
    expect(catalogParity(entries, ['LIMIT', 'TON', 'PID', 'SCALE'])).toEqual({
      onlyInBackend: [], onlyInGenerated: ['SCALE'], matched: 3
    })
  })

  it('TC-LIB-CATS: catalogCategories trả về danh sách phân loại duy nhất, đã sắp xếp và loại bỏ null', () => {
    const rawEntries = catalogEntries(page())
    // Giả lập thêm entry trùng phân loại và entry có category là null
    const dummyEntries = [
      ...rawEntries,
      { ...rawEntries[0], entryId: 'EXTRA_MATH', category: 'math' },
      { ...rawEntries[0], entryId: 'ANOTHER_NULL', category: null },
      { ...rawEntries[0], entryId: 'ALPHA_CAT', category: 'arithmetic' },
    ]

    const categories = catalogCategories(dummyEntries)
    // Phân loại phải duy nhất (unique), loại bỏ null, và sắp xếp theo thứ tự bảng chữ cái
    expect(categories).toEqual(['arithmetic', 'control', 'math', 'timer'])
    expect(categories.includes(null as unknown as string)).toBe(false)
    expect(new Set(categories).size).toBe(categories.length)
  })

  it('TC-LIB-FILTER-CAT: filterCatalog với bộ lọc phân loại chỉ trả về các mục thuộc phân loại đó', () => {
    const entries = catalogEntries(page())
    const mathEntries = filterCatalog(entries, { category: 'math' })
    expect(mathEntries.length).toBeGreaterThan(0)
    expect(mathEntries.every((entry) => entry.category === 'math')).toBe(true)
    expect(mathEntries.map((entry) => entry.entryId)).toEqual(['LIMIT'])

    const timerEntries = filterCatalog(entries, { category: 'timer' })
    expect(timerEntries.every((entry) => entry.category === 'timer')).toBe(true)
    expect(timerEntries.map((entry) => entry.entryId)).toEqual(['TON'])

    // Lọc theo phân loại không tồn tại trả về mảng rỗng
    const emptyEntries = filterCatalog(entries, { category: 'non_existent_category' })
    expect(emptyEntries).toEqual([])
  })
})
