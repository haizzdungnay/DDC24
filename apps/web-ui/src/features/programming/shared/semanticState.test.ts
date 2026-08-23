import { describe, expect, it } from 'vitest'
import { statusColor } from '../../../shared/utils'
import {
  SEMANTIC_STATES,
  semanticBadgeProps,
  semanticStateDescriptor,
  semanticStateHint,
  semanticStateLabel,
  type SemanticState
} from './semanticState'

const vi = (viText: string) => viText
const en = (_viText: string, enText: string) => enText

describe('semanticState — T60-104 (README §3)', () => {
  it('phủ đúng bảy trạng thái ngữ nghĩa của handoff, kể cả reconciling và disabled', () => {
    expect([...SEMANTIC_STATES]).toEqual(['good', 'warning', 'fault', 'unknown', 'stale', 'disabled', 'reconciling'])
    // Hai trạng thái mà StatusBadge KHÔNG có tên riêng — lý do module này tồn tại.
    expect(SEMANTIC_STATES).toContain('reconciling')
    expect(SEMANTIC_STATES).toContain('disabled')
  })

  it.each(SEMANTIC_STATES)('trạng thái %s có CẢ icon lẫn chữ — màu không phải tín hiệu duy nhất', (state) => {
    const descriptor = semanticStateDescriptor(state)
    expect(descriptor.icon).toBeTypeOf('object')
    expect(semanticStateLabel(vi, state).trim().length).toBeGreaterThan(0)
    expect(semanticStateLabel(en, state).trim().length).toBeGreaterThan(0)
    expect(semanticStateHint(vi, state).trim().length).toBeGreaterThan(0)
    expect(semanticStateHint(en, state).trim().length).toBeGreaterThan(0)
  })

  it('mỗi trạng thái có icon riêng — không hai trạng thái nào chỉ khác nhau bằng màu', () => {
    const icons = new Set(SEMANTIC_STATES.map((state) => semanticStateDescriptor(state).icon))
    expect(icons.size).toBe(SEMANTIC_STATES.length)
  })

  it('nhãn của bảy trạng thái đôi một khác nhau ở cả hai ngôn ngữ', () => {
    for (const pick of [vi, en]) {
      const labels = new Set(SEMANTIC_STATES.map((state) => semanticStateLabel(pick, state)))
      expect(labels.size).toBe(SEMANTIC_STATES.length)
    }
  })

  it.each([
    ['good', 'good', 'var(--c-good-fg)'],
    ['warning', 'warning', 'var(--c-warn-fg)'],
    ['fault', 'fault', 'var(--c-fault-fg)'],
    ['unknown', 'unknown', 'var(--c-text-dim)'],
    ['stale', 'stale', 'var(--c-warn-fg)'],
    // `disabled` là "tắt có chủ đích", phải rơi vào nhóm màu OFF chứ không phải fault.
    ['disabled', 'inactive', 'var(--c-off)'],
    // `reconciling` là "chưa kết luận", nhóm màu WARN chứ không phải good/fault.
    ['reconciling', 'uncertain', 'var(--c-warn-fg)']
  ] as const)('%s ánh xạ sang StatusBadge state "%s" và giữ đúng nhóm màu', (state, badgeState, color) => {
    expect(semanticStateDescriptor(state as SemanticState).badgeState).toBe(badgeState)
    expect(statusColor(badgeState)).toBe(color)
  })

  it('semanticBadgeProps luôn kèm chữ và title, theo đúng một ngôn ngữ tại một thời điểm (D-06)', () => {
    expect(semanticBadgeProps(vi, 'reconciling')).toEqual({
      state: 'uncertain',
      label: 'Đang đối soát',
      title: 'Chưa xác định kết quả; không suy thành thành công.'
    })
    expect(semanticBadgeProps(en, 'reconciling')).toEqual({
      state: 'uncertain',
      label: 'Reconciling',
      title: 'The result is undetermined; it is not assumed to have succeeded.'
    })
  })

  it('nhãn thay thế vẫn là chữ — không có đường nào trả về badge rỗng chỉ còn màu', () => {
    const props = semanticBadgeProps(vi, 'disabled', '2/5 đã tắt')
    expect(props.label).toBe('2/5 đã tắt')
    expect(props.title.length).toBeGreaterThan(0)
  })
})
