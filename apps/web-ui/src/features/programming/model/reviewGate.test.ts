import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { createFbdEditorState, fbdEditorReducer } from '../fbd/commands'
import type { FbdDocument, FbdNode } from '../fbd/model'
import { fbdPaletteEntry } from '../fbd/palette'
import { buildStCompletions } from '../design/editor/stEditorSupport'
import { stSignatureHelp } from '../design/editor/stSignatureHelp'
import { effectiveFeatureState, isReviewApproved } from './reviewGate'

/* Issue #802 — trạng thái PRODUCTION sau khi `PID` được ký token Controls/Safety
   (`EV-PROG-PID-APPROVAL-20260928`). Các file kiểm cơ chế khoá khối
   REVIEW_REQUIRED (palette, canvas, reducer, gợi ý ST, chữ ký) dựng bảng giả
   "PID chưa duyệt"; file này khoá chiều ngược lại trên bảng thật: PID dùng
   được ở MỌI bề mặt mà trước đây chặn nó. */

describe('effectiveFeatureState — cơ chế', () => {
  const pending = [{ featureId: 'PID', approved: false }] as const
  const approved = [{ featureId: 'PID', approved: true }] as const

  it('REVIEW_REQUIRED chỉ thành AVAILABLE khi bảng có đúng khối đó và đã duyệt', () => {
    expect(effectiveFeatureState('PID', 'REVIEW_REQUIRED', pending)).toBe('REVIEW_REQUIRED')
    expect(effectiveFeatureState('PID', 'REVIEW_REQUIRED', approved)).toBe('AVAILABLE')
  })

  it('fail-closed: khối REVIEW_REQUIRED không có trong bảng vẫn bị khoá', () => {
    expect(effectiveFeatureState('PID_CASCADE', 'REVIEW_REQUIRED', approved)).toBe('REVIEW_REQUIRED')
    expect(isReviewApproved('PID_CASCADE', approved)).toBe(false)
  })

  it('AVAILABLE không bao giờ bị bảng review biến thành REVIEW_REQUIRED', () => {
    expect(effectiveFeatureState('TON', 'AVAILABLE', pending)).toBe('AVAILABLE')
  })
})

describe('PID sau #802 — bảng production', () => {
  it('profile mang token duyệt cho PID', () => {
    expect(isReviewApproved('PID')).toBe(true)
  })

  it('palette FBD cho dùng PID và không còn cảnh báo "chưa review"', () => {
    const pid = fbdPaletteEntry('PID')
    expect(pid?.featureState).toBe('AVAILABLE')
    expect(pid?.warning).toBeUndefined()
  })

  it('reducer FBD nhận ADD_NODE PID (không còn block-review-required)', () => {
    const document = JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
    const entry = fbdPaletteEntry('PID')!
    const node: FbdNode = {
      id: '70000000-0000-4000-8000-0000000000a1',
      kind: 'FUNCTION_BLOCK',
      typeRef: 'PID',
      executionOrder: 0,
      parameters: {},
      ports: entry.buildPorts('REAL').map((port, index) => ({
        id: `71000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
        name: port.name,
        direction: port.direction,
        dataType: port.dataType,
        unit: null,
        order: index,
      })),
    }
    const before = createFbdEditorState(document)
    const after = fbdEditorReducer(before, {
      type: 'ADD_NODE',
      networkId: document.networks[0].id,
      node,
      position: { x: 10, y: 10 },
    })
    expect(after.announcement.code).not.toBe('block-review-required')
    expect(after.past).toHaveLength(1)
    expect(after.document.networks[0].nodes.some((item) => item.typeRef === 'PID')).toBe(true)
  })

  it('gợi ý ST không còn gắn nhãn "Kiểm tra sẽ từ chối" cho PID', () => {
    const item = buildStCompletions('PI', []).find((entry) => entry.label === 'PID')
    expect(item).toBeDefined()
    expect(item?.reviewGated).toBeUndefined()
    expect(item?.detail ?? '').not.toMatch(/từ chối/)
  })

  it('chữ ký PID không còn cờ reviewGated', () => {
    const help = stSignatureHelp('PID_1(', 6, [{ name: 'PID_1', type: 'PID' }])
    expect(help).not.toBeNull()
    expect(help!.reviewGated).toBe(false)
  })
})
