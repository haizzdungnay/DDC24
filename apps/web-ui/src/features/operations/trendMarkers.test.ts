import { describe, expect, it } from 'vitest'
import { buildTrendMarkers, TREND_MARKER_LIMIT } from './trendMarkers'
import type { ActivityEvent, AlarmHistoryEntry } from '../../shared/types'

/**
 * Khoá hành vi của dấu sự kiện trên biểu đồ — `T57-2.6`.
 *
 * Dấu ở đây là **bằng chứng nhân quả**: người đọc sẽ kết luận "đường gãy vì
 * lúc đó có người ép tay". Một dấu sai chỗ, sai người, hay dấu cho một lệnh đã
 * bị từ chối đều dẫn tới kết luận sai về nguyên nhân sự cố — nên mỗi luật lọc
 * cần một test riêng, không phủ gián tiếp qua render.
 */

const pick = (vi: string) => vi
const T0 = Date.parse('2026-08-19T10:00:00Z')

function activity(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 1,
    time: new Date(T0 + 60_000).toISOString(),
    kind: 'user',
    actor: 'admin',
    action: 'point_force',
    objectId: 'AO-01',
    outcome: 'accepted',
    ...overrides
  }
}

function alarm(overrides: Partial<AlarmHistoryEntry>): AlarmHistoryEntry {
  return {
    id: 'ALM-014',
    time: new Date(T0 + 120_000).toISOString(),
    severity: 'high',
    status: 'active',
    message: 'Nhiệt độ cao',
    source: 'UI-01 Gió hồi',
    value: '31',
    detail: '',
    event: 'started',
    ...overrides
  }
}

function build(input: Partial<Parameters<typeof buildTrendMarkers>[0]> = {}) {
  return buildTrendMarkers({
    activity: [],
    alarms: [],
    pointIds: ['AO-01', 'UI-01'],
    fromMs: T0,
    toMs: T0 + 600_000,
    pick,
    ...input
  })
}

describe('T57-2.6 — dựng dấu sự kiện cho biểu đồ', () => {
  it('lệnh ép tay của một điểm đang vẽ thành một dấu kèm tên người ra lệnh', () => {
    const { markers } = build({ activity: [activity({ actor: 'chuong' })] })
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ kind: 'override', pointId: 'AO-01', actor: 'chuong' })
  })

  it('cảnh báo bật của điểm đang vẽ thành một dấu, nhận id điểm từ chuỗi `source`', () => {
    const { markers } = build({ alarms: [alarm({})] })
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ kind: 'alarm', pointId: 'UI-01' })
    expect(markers[0].label).toContain('ALM-014')
  })

  it('lệnh BỊ TỪ CHỐI không được đánh dấu — nó chưa từng tới thiết bị', () => {
    expect(build({ activity: [activity({ outcome: 'rejected' })] }).markers).toEqual([])
  })

  it('thao tác khác trên cùng điểm (đổi tên) không phải lệnh điều khiển', () => {
    expect(build({ activity: [activity({ action: 'point_metadata' })] }).markers).toEqual([])
  })

  it('sự kiện của điểm KHÔNG có trên biểu đồ bị loại', () => {
    expect(build({ activity: [activity({ objectId: 'DO-07' })] }).markers).toEqual([])
    expect(build({ alarms: [alarm({ source: 'UI-09 Khác' })] }).markers).toEqual([])
  })

  it('sự kiện ngoài khoảng thời gian đang xem bị loại', () => {
    expect(build({ activity: [activity({ time: new Date(T0 - 60_000).toISOString() })] }).markers).toEqual([])
    expect(build({ activity: [activity({ time: new Date(T0 + 900_000).toISOString() })] }).markers).toEqual([])
  })

  it('ack và kết thúc cảnh báo KHÔNG đánh dấu — chúng là diễn biến xử lý, không phải hiện tượng', () => {
    expect(build({ alarms: [alarm({ event: 'acked' }), alarm({ event: 'ended' })] }).markers).toEqual([])
  })

  it('cảnh báo có `source` không chứa id điểm nào thì bỏ qua, không đoán', () => {
    expect(build({ alarms: [alarm({ source: 'Bộ điều khiển' })] }).markers).toEqual([])
  })

  it('dấu được sắp theo thời gian để đọc dọc trục', () => {
    const { markers } = build({
      activity: [
        activity({ id: 2, time: new Date(T0 + 300_000).toISOString() }),
        activity({ id: 3, time: new Date(T0 + 100_000).toISOString() })
      ]
    })
    expect(markers.map((marker) => marker.ts)).toEqual([T0 + 100_000, T0 + 300_000])
  })

  it('cùng sự kiện đến hai lần chỉ vẽ một vạch', () => {
    const { markers } = build({ activity: [activity({ id: 4 }), activity({ id: 4 })] })
    expect(markers).toHaveLength(1)
  })

  it('vượt trần thì cắt bớt VÀ nói ra đã cắt bao nhiêu', () => {
    const many = Array.from({ length: TREND_MARKER_LIMIT + 5 }, (_, index) =>
      activity({ id: index, time: new Date(T0 + index * 1000).toISOString() }))
    const { markers, omitted } = build({ activity: many })
    expect(markers).toHaveLength(TREND_MARKER_LIMIT)
    expect(omitted).toBe(5)
  })

  it('không có điểm nào đang vẽ ⇒ không có dấu nào, dù nhật ký đầy sự kiện', () => {
    expect(build({ pointIds: [], activity: [activity({})], alarms: [alarm({})] }).markers).toEqual([])
  })
})
