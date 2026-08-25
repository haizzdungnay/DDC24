import { describe, expect, it } from 'vitest'
import type { ProgrammingLibraryPage } from '../../model/types'
import {
  catalogCategories,
  catalogEntries,
  catalogParity,
  filterCatalog,
  isInsertable,
  stInsertionSnippet
} from './libraryCatalog'

function signature(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    category: 'math',
    labelVi: 'Giới hạn (LIMIT)',
    labelEn: 'Limit',
    allowedTypes: ['REAL', 'INT'],
    defaultType: 'REAL',
    ports: [
      { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
      { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
      { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
      { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
    ],
    ...extra
  })
}

function page(): ProgrammingLibraryPage {
  return {
    items: [
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT', featureState: 'AVAILABLE',
        contentSha256: 'a'.repeat(64), interface: signature(), dependencies: [],
        stateLayoutKnown: true, stateSizeBytes: 0
      },
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'TON', kind: 'FUNCTION_BLOCK', name: 'TON', featureState: 'AVAILABLE',
        contentSha256: 'b'.repeat(64),
        interface: JSON.stringify({
          category: 'timer', labelVi: 'Trễ bật (TON)', labelEn: 'On delay', allowedTypes: [],
          ports: [
            { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
            { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
            { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' }
          ]
        }),
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 16
      },
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'PID', kind: 'FUNCTION_BLOCK', name: 'PID', featureState: 'REVIEW_REQUIRED',
        contentSha256: 'c'.repeat(64),
        interface: JSON.stringify({
          category: 'control', labelVi: 'PID', labelEn: 'PID', allowedTypes: [],
          ports: [{ name: 'PV', direction: 'INPUT', dataType: 'REAL' }, { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }]
        }),
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 64
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
    expect(entry.category).toBe('timer')
    expect(entry.ports.map((port) => port.name)).toEqual(['IN', 'Q'])
  })

  it('chuẩn hoá SYSTEM và PROJECT trong cùng một danh sách', () => {
    const entries = catalogEntries(page())
    expect(entries.map((entry) => entry.entryId)).toEqual(['LIMIT', 'TON', 'PID', 'AHU_HELPER'])
    expect(entries[0].category).toBe('math')
    expect(entries[0].ports).toHaveLength(4)
    // FB có trạng thái nội tại; FUNCTION thì không.
    expect(entries[1].stateful).toBe(true)
    expect(entries[0].stateful).toBe(false)
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

  it('lọc theo tên, nhóm, ngôn ngữ và kiểu dữ liệu của port', () => {
    const entries = catalogEntries(page())
    expect(filterCatalog(entries, { query: 'lim' }).map((entry) => entry.entryId)).toEqual(['LIMIT'])
    expect(filterCatalog(entries, { category: 'timer' }).map((entry) => entry.entryId)).toEqual(['TON'])
    expect(filterCatalog(entries, { dataType: 'TIME' }).map((entry) => entry.entryId)).toEqual(['TON'])
    // Mục ràng buộc ngôn ngữ ST bị loại khi đang mở POU FBD; mục không ràng
    // buộc thì vẫn hiện.
    expect(filterCatalog(entries, { language: 'FBD' }).map((entry) => entry.entryId)).toEqual(['LIMIT', 'TON', 'PID'])
    expect(catalogCategories(entries)).toEqual(['control', 'math', 'other', 'timer'])
  })

  it('đoạn ST cho FUNCTION là một lời gọi, cho FUNCTION_BLOCK có cả khai instance', () => {
    const entries = catalogEntries(page())
    expect(stInsertionSnippet(entries[0])).toBe('OUT := LIMIT(MN, IN, MX);')
    const ton = stInsertionSnippet(entries[1], 'TON_Fan')
    expect(ton).toContain('TON_Fan : TON;')
    expect(ton).toContain('TON_Fan(IN := IN, PT := PT);')
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
})
