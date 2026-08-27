import { describe, expect, it } from 'vitest'

import { compareDiffStateFor, compareGateFor, nonSourceChanges } from './compareModel'
import type { ProgrammingRevisionChanges, ProgrammingStHunk } from '../../model/types'

/**
 * Luật của khay So sánh — kiểm ở lớp thuần vì chúng là luật, không phải pixel.
 */

const impact = {
  impactRef: 'ref', retain: { status: 'NONE' as const, items: [] },
  activeOverrides: { status: 'NONE' as const, items: [] },
  cutover: { status: 'NONE' as const, items: [] },
  outputMappingChanges: { status: 'NONE' as const, items: [] },
  publishedSignals: { status: 'NONE' as const, items: [] },
  controlLibrary: { status: 'NONE' as const, items: [] },
  programSet: { status: 'NONE' as const, items: [] },
  enableIntent: { status: 'NONE' as const, items: [] },
}

function view(patch: Partial<ProgrammingRevisionChanges>): ProgrammingRevisionChanges {
  return { fromRevisionId: 'rev-active', toRevisionId: 'rev-draft', impact, changes: [], ...patch }
}

const hunk: ProgrammingStHunk = {
  objectId: 'obj-1', changeType: 'REPLACED',
  beforeStartLine: 3, beforeLineCount: 1, afterStartLine: 3, afterLineCount: 1,
  beforeText: ['Fan := TRUE;'], afterText: ['Fan := FALSE;'], truncated: false, coarse: false,
}

describe('cổng So sánh — không bao giờ so một ảnh chụp có thể đổi dưới chân mình', () => {
  it('Draft bẩn ⇒ đòi Lưu trước, không so', () => {
    expect(compareGateFor({ dirty: true, activeRevisionId: 'a', sealedRevisionId: 's' }))
      .toEqual({ kind: 'MUST_SAVE', fromRevisionId: 'a', toRevisionId: null })
  })

  it('Draft sạch nhưng chưa niêm phong ⇒ đòi Niêm phong, KHÔNG dùng draftRevisionId', () => {
    // `draftRevisionId` trỏ một Revision còn ở trạng thái DRAFT — nó đổi mỗi
    // lần người dùng lưu. So với nó là so với một thứ có thể khác đi ngay sau
    // khi bảng vẽ xong.
    expect(compareGateFor({ dirty: false, activeRevisionId: 'a', sealedRevisionId: null }))
      .toEqual({ kind: 'MUST_SEAL', fromRevisionId: 'a', toRevisionId: null })
  })

  it('không có Active ⇒ trạng thái rỗng có lý do, và nó thắng cả hai bước kia', () => {
    // Bắt người dùng Lưu rồi Niêm phong xong mới báo "không có gì để đối chiếu"
    // là dẫn họ vào ngõ cụt sau hai mutation thật.
    expect(compareGateFor({ dirty: true, activeRevisionId: null, sealedRevisionId: null }))
      .toEqual({ kind: 'NO_ACTIVE', fromRevisionId: null, toRevisionId: null })
  })

  it('đủ điều kiện ⇒ so Active (mốc) với Revision đã niêm phong (bản ứng viên)', () => {
    const gate = compareGateFor({ dirty: false, activeRevisionId: 'rev-active', sealedRevisionId: 'rev-sealed' })
    expect(gate).toEqual({ kind: 'READY', fromRevisionId: 'rev-active', toRevisionId: 'rev-sealed' })
  })

  it('candidate trùng Active ⇒ không phát request from=to', () => {
    expect(compareGateFor({ dirty: false, activeRevisionId: 'same', sealedRevisionId: 'same' }))
      .toEqual({ kind: 'SAME_REVISION', fromRevisionId: 'same', toRevisionId: 'same' })
  })
})

describe('trạng thái diff — "chưa so" không được trông giống "không có khác biệt"', () => {
  it('server không gửi khoá ⇒ UNSUPPORTED', () => {
    expect(compareDiffStateFor(view({}), new Map()).kind).toBe('UNSUPPORTED')
  })

  it('gửi khoá nhưng mảng rỗng ⇒ EMPTY', () => {
    expect(compareDiffStateFor(view({ stHunks: [], fbdChanges: [] }), new Map()).kind).toBe('EMPTY')
  })

  it('có hunk ⇒ ENTRIES giữ nguyên thứ tự máy chủ và gắn tên POU tra được', () => {
    const state = compareDiffStateFor(
      view({ stHunks: [hunk], fbdChanges: [{ objectId: 'obj-2', element: 'NODE', elementId: 'blk-1', changeType: 'ORDER_ONLY', detail: 'executionOrder' }] }),
      new Map([['obj-1', 'AHU_MAIN']]),
    )
    if (state.kind !== 'ENTRIES') throw new Error(`kind=${state.kind}`)
    expect(state.entries.map((entry) => entry.kind)).toEqual(['ST', 'FBD'])
    expect(state.entries[0].pouName).toBe('AHU_MAIN')
    // Tên tra không ra là `null`, KHÔNG phải một chuỗi bịa hay chính objectId
    // đội lốt tên: người đọc phải biết mình đang nhìn một mã máy.
    expect(state.entries[1].pouName).toBeNull()
  })

  it('cờ cắt và cursor được đọc ra, không bị nuốt', () => {
    const state = compareDiffStateFor(
      view({ stHunks: [hunk], fbdChanges: [], truncated: true, nextCursor: '200' }),
      new Map(),
    )
    if (state.kind !== 'ENTRIES') throw new Error(`kind=${state.kind}`)
    expect(state.truncated).toBe(true)
    expect(state.nextCursor).toBe('200')
  })

  it('mã định danh mục là duy nhất kể cả khi hai hunk trùng vị trí', () => {
    const state = compareDiffStateFor(view({ stHunks: [hunk, hunk], fbdChanges: [] }), new Map())
    if (state.kind !== 'ENTRIES') throw new Error(`kind=${state.kind}`)
    expect(new Set(state.entries.map((entry) => entry.entryId)).size).toBe(2)
  })
})

describe('thay đổi ngoài mã nguồn không được biến mất', () => {
  it('Revision chỉ đổi ánh xạ đầu ra vẫn phải liệt kê được', () => {
    const changes = nonSourceChanges(view({
      stHunks: [hunk], fbdChanges: [],
      changes: [
        { objectId: 'b-1', kind: 'BINDING', changeType: 'MODIFIED', category: 'OUTPUT_MAPPING', beforeSha256: null, afterSha256: null },
        { objectId: 'obj-1', kind: 'PROGRAM', changeType: 'MODIFIED', category: 'SOURCE', beforeSha256: null, afterSha256: null },
      ],
    }))
    // POU đã có diff typed riêng; phần còn lại là thứ diff mã nguồn KHÔNG nhìn
    // thấy, nên nó phải có chỗ đứng riêng thay vì lẫn vào "không có khác biệt".
    expect(changes.map((change) => change.kind)).toEqual(['BINDING'])
  })

  it('PROGRAM chưa có typed entry vẫn phải hiện ở thay đổi cấp Revision', () => {
    const changes = nonSourceChanges(view({
      stHunks: [], fbdChanges: [],
      changes: [
        { objectId: 'obj-1', kind: 'PROGRAM', changeType: 'MODIFIED', category: 'SOURCE', beforeSha256: null, afterSha256: null },
      ],
    }))
    expect(changes.map((change) => change.objectId)).toEqual(['obj-1'])
  })
})
