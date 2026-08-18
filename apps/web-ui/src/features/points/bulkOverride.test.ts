import { describe, expect, it, vi } from 'vitest'
import {
  isBulkBinaryPoint,
  isBulkSelectable,
  planBulkOverride,
  runBulkOverride,
  summarizeBulkOutcomes,
  type BulkPlanRow
} from './bulkOverride'
import type { Point } from '../../shared/types'

/**
 * Test khoá HÀNH VI cho ép tay hàng loạt (`T57-1.4`).
 *
 * Bốn luật an toàn ở docstring của `bulkOverride.ts` được khoá ở đây, và mỗi
 * mệnh đề đã kiểm ngược bằng mutant — một test chỉ `expect(outcomes).toHaveLength(3)`
 * sẽ vẫn xanh khi điểm thứ hai bị bỏ qua sai cách, nên không đủ.
 */

function point(over: Partial<Point> & Pick<Point, 'id'>): Point {
  return { tag: over.id, name: `Tên ${over.id}`, kind: 'DO', value: false, quality: 'good', source: 'core', ...over } as Point
}

function row(over: Partial<BulkPlanRow> & Pick<BulkPlanRow, 'pointId'>): BulkPlanRow {
  return { displayTag: over.pointId, name: 'x', isBinary: true, currentValue: false, nextValue: true, ...over }
}

describe('isBulkSelectable — chỉ điểm có TTL do Core cưỡng chế', () => {
  it('nhận DO và AO', () => {
    expect(isBulkSelectable(point({ id: 'DO-01', kind: 'DO' }))).toBe(true)
    expect(isBulkSelectable(point({ id: 'AO-01', kind: 'AO' }))).toBe(true)
  })

  it('loại điểm đọc-vào (UI) vì không ghi được', () => {
    expect(isBulkSelectable(point({ id: 'UI-01', kind: 'UI' }))).toBe(false)
  })

  it('loại điểm ảo dù ghi được — Core KHÔNG giữ TTL cho nó', () => {
    // Gộp VP vào một hộp thoại có "thời hạn dùng chung" sẽ hứa một thời hạn
    // không tồn tại cho riêng nó: `forcePointWithDuration` gửi VP không kèm ttlS.
    expect(isBulkSelectable(point({ id: 'VP-01', kind: 'virtual', writable: true }))).toBe(false)
  })
})

describe('isBulkBinaryPoint', () => {
  it('điểm ảo kiểu boolean CHƯA có số đo vẫn là nhị phân', () => {
    // Phân loại theo `typeof value === 'boolean'` một mình sẽ xếp nhầm điểm này
    // vào nhóm analog và gán cho nó một giá trị số.
    expect(isBulkBinaryPoint(point({ id: 'VP-01', kind: 'virtual', signalType: 'boolean', value: undefined }))).toBe(true)
  })

  it('AO là analog', () => {
    expect(isBulkBinaryPoint(point({ id: 'AO-01', kind: 'AO', value: 12.5 }))).toBe(false)
  })
})

describe('planBulkOverride — bảng hậu quả', () => {
  it('gán giá trị mới đúng nhóm: nhị phân lấy boolean, analog lấy số', () => {
    const plan = planBulkOverride(
      [point({ id: 'DO-01', kind: 'DO', value: false }), point({ id: 'AO-01', kind: 'AO', value: 12.5, unit: '%' })],
      true,
      100
    )
    expect(plan.find((item) => item.pointId === 'DO-01')?.nextValue).toBe(true)
    expect(plan.find((item) => item.pointId === 'AO-01')?.nextValue).toBe(100)
  })

  it('điểm chưa có số đo ⇒ currentValue undefined, KHÔNG đoán một con số', () => {
    // Cùng lớp lỗi với F-UX-09, chỉ nguy hiểm hơn vì ở đây có N điểm cùng lúc.
    const plan = planBulkOverride([point({ id: 'AO-02', kind: 'AO', value: undefined })], true, 50)
    expect(plan[0].currentValue).toBeUndefined()
    expect(plan[0].currentValue).not.toBe(0)
  })

  it('lọc bỏ điểm không ép tay được ngay trong kế hoạch, không chỉ ở giao diện', () => {
    const plan = planBulkOverride(
      [point({ id: 'DO-01', kind: 'DO' }), point({ id: 'UI-01', kind: 'UI' })],
      true,
      0
    )
    expect(plan.map((item) => item.pointId)).toEqual(['DO-01'])
  })

  it('sắp theo id để bảng ổn định và đối chiếu được với bảng Monitor', () => {
    const plan = planBulkOverride(
      [point({ id: 'DO-10', kind: 'DO' }), point({ id: 'DO-02', kind: 'DO' })],
      true,
      0
    )
    expect(plan.map((item) => item.pointId)).toEqual(['DO-02', 'DO-10'])
  })
})

describe('runBulkOverride — luật 1, 2, 3', () => {
  it('gửi TUẦN TỰ, một request mỗi điểm — n điểm ⇒ n lệnh ⇒ n vết audit', async () => {
    const order: string[] = []
    const send = vi.fn(async (item: BulkPlanRow) => { order.push(item.pointId) })
    const outcomes = await runBulkOverride([row({ pointId: 'A' }), row({ pointId: 'B' }), row({ pointId: 'C' })], send)
    expect(send).toHaveBeenCalledTimes(3)
    expect(order).toEqual(['A', 'B', 'C'])
    expect(outcomes.every((item) => item.status === 'sent')).toBe(true)
  })

  it('LUẬT 2 — một điểm hỏng KHÔNG làm dừng các điểm còn lại', async () => {
    const send = vi.fn(async (item: BulkPlanRow) => {
      if (item.pointId === 'B') throw new Error('403 forbidden')
    })
    const outcomes = await runBulkOverride([row({ pointId: 'A' }), row({ pointId: 'B' }), row({ pointId: 'C' })], send)
    expect(send).toHaveBeenCalledTimes(3)
    expect(outcomes.map((item) => item.status)).toEqual(['sent', 'failed', 'sent'])
  })

  it('giữ NGUYÊN VĂN lỗi backend, không diễn dịch thành câu chung chung', async () => {
    const send = vi.fn(async () => { throw new Error('403 forbidden') })
    const outcomes = await runBulkOverride([row({ pointId: 'A' })], send)
    expect(outcomes[0].message).toBe('403 forbidden')
  })

  it('LUẬT 3 — huỷ giữa chừng dừng phần CHƯA gửi, phần đã gửi giữ nguyên kết quả', async () => {
    let aborted = false
    const send = vi.fn(async (item: BulkPlanRow) => {
      if (item.pointId === 'A') aborted = true // người dùng bấm Huỷ ngay sau điểm đầu
    })
    const outcomes = await runBulkOverride(
      [row({ pointId: 'A' }), row({ pointId: 'B' }), row({ pointId: 'C' })],
      send,
      { isAborted: () => aborted }
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(outcomes.map((item) => item.status)).toEqual(['sent', 'skipped', 'skipped'])
  })

  it('cờ huỷ được ĐỌC LẠI trước mỗi điểm, không chụp một lần lúc bắt đầu', async () => {
    // Nếu `isAborted` bị đọc một lần rồi cache, nút Huỷ sẽ hoàn toàn vô nghĩa.
    let calls = 0
    const send = vi.fn(async () => { calls += 1 })
    const isAborted = vi.fn(() => calls >= 2)
    const outcomes = await runBulkOverride(
      [row({ pointId: 'A' }), row({ pointId: 'B' }), row({ pointId: 'C' })],
      send,
      { isAborted }
    )
    expect(isAborted.mock.calls.length).toBeGreaterThan(1)
    expect(outcomes.map((item) => item.status)).toEqual(['sent', 'sent', 'skipped'])
  })

  it('báo tiến độ từng điểm ngay khi có kết quả, không đợi tới cuối', async () => {
    const seen: string[] = []
    await runBulkOverride(
      [row({ pointId: 'A' }), row({ pointId: 'B' })],
      async () => {},
      { onProgress: (outcome) => seen.push(`${outcome.pointId}:${outcome.status}`) }
    )
    expect(seen).toEqual(['A:sent', 'B:sent'])
  })
})

describe('summarizeBulkOutcomes', () => {
  it('đếm tách bạch ba trạng thái', async () => {
    let aborted = false
    const outcomes = await runBulkOverride(
      [row({ pointId: 'A' }), row({ pointId: 'B' }), row({ pointId: 'C' })],
      async (item) => {
        if (item.pointId === 'A') throw new Error('boom')
        if (item.pointId === 'B') aborted = true
      },
      { isAborted: () => aborted }
    )
    expect(summarizeBulkOutcomes(outcomes)).toEqual({ sent: 1, failed: 1, skipped: 1 })
  })
})
