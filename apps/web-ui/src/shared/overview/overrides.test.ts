import { describe, expect, it } from 'vitest'
import {
  OVERRIDE_EXPIRING_SOON_S,
  collectOverrideOwners,
  isOverrideExpiringSoon,
  summarizeOverrides
} from './overrides'
import type { ActivityEvent, Point } from '../types'

/**
 * Test khoá HÀNH VI cho `BB-4` Override registry (`T57-1.1`).
 *
 * Bài học đắt nhất của phiên trước: ba hồi quy thật lọt qua 729 test vì test chỉ
 * kiểm SỰ TỒN TẠI chứ không kiểm HÀNH VI. Nên mỗi `it` dưới đây khoá một mệnh
 * đề có thể sai theo một cách cụ thể, và mỗi mệnh đề đã được kiểm ngược bằng
 * cách áp mutant vào `overrides.ts` rồi chạy lại.
 */

function point(over: Partial<Point> & Pick<Point, 'id'>): Point {
  return {
    tag: over.id,
    name: `Tên ${over.id}`,
    kind: 'DO',
    value: false,
    quality: 'good',
    source: 'core',
    ...over
  } as Point
}

function event(over: Partial<ActivityEvent> & Pick<ActivityEvent, 'id' | 'objectId'>): ActivityEvent {
  return {
    time: '2026-08-18T07:00:00Z',
    kind: 'user',
    actor: 'chuong',
    role: 'operator',
    action: 'point_force',
    outcome: 'accepted',
    ...over
  } as ActivityEvent
}

describe('collectOverrideOwners — lọc và gán người ra lệnh', () => {
  it('chỉ nhận điểm forced=true; forced=false và forced=undefined đều bị loại', () => {
    const owners = collectOverrideOwners([
      point({ id: 'DO-01', forced: true }),
      point({ id: 'DO-02', forced: false }),
      point({ id: 'DO-03' })
    ])
    expect(owners.map((owner) => owner.pointId)).toEqual(['DO-01'])
  })

  it('gán actor từ vết Activity MỚI NHẤT, không phải vết đầu tiên gặp', () => {
    // Điểm bị ép bởi `an` lúc trước, nhả, rồi `binh` ép lại. Người đang giữ
    // quyền là `binh`. Lấy vết cũ sẽ quy sai trách nhiệm cho người đã nhả rồi.
    const owners = collectOverrideOwners(
      [point({ id: 'DO-01', forced: true })],
      [
        event({ id: 10, objectId: 'DO-01', actor: 'an' }),
        event({ id: 42, objectId: 'DO-01', actor: 'binh', role: 'admin' })
      ]
    )
    expect(owners[0].actor).toBe('binh')
    expect(owners[0].actorRole).toBe('admin')
  })

  it('không có vết trong Activity ⇒ actor là undefined, KHÔNG phải "hệ thống"', () => {
    const owners = collectOverrideOwners([point({ id: 'DO-01', forced: true })], [])
    expect(owners[0].actor).toBeUndefined()
    expect(owners[0].commandedAt).toBeUndefined()
  })

  it('bỏ qua vết có outcome rejected — lệnh bị từ chối không tới thiết bị', () => {
    const owners = collectOverrideOwners(
      [point({ id: 'DO-01', forced: true })],
      [event({ id: 7, objectId: 'DO-01', actor: 'viewer1', outcome: 'rejected' })]
    )
    expect(owners[0].actor).toBeUndefined()
  })

  it('bỏ qua action không phải lệnh ép — point_metadata là đổi tên, không phải ép tay', () => {
    const owners = collectOverrideOwners(
      [point({ id: 'DO-01', forced: true })],
      [event({ id: 7, objectId: 'DO-01', actor: 'an', action: 'point_metadata' })]
    )
    expect(owners[0].actor).toBeUndefined()
  })

  it('không lấy nhầm vết của điểm khác', () => {
    const owners = collectOverrideOwners(
      [point({ id: 'DO-01', forced: true })],
      [event({ id: 9, objectId: 'DO-02', actor: 'an' })]
    )
    expect(owners[0].actor).toBeUndefined()
  })
})

describe('collectOverrideOwners — TTL do Core cấp', () => {
  it('lấy nguyên overrideExpiresInS của Core, không tự tính lại', () => {
    const owners = collectOverrideOwners([point({ id: 'AO-01', forced: true, overrideExpiresInS: 137 })])
    expect(owners[0].remainingS).toBe(137)
  })

  it('overrideExpiresInS undefined ⇒ remainingS undefined, TUYỆT ĐỐI không hoá 0', () => {
    // `0` trên giao diện đọc là "vừa hết hạn"; `undefined` nghĩa là lệnh không
    // có thời hạn tự nhả. Gộp hai thứ này là nói sai về trạng thái thiết bị.
    const owners = collectOverrideOwners([point({ id: 'VP-01', forced: true })])
    expect(owners[0].remainingS).toBeUndefined()
    expect(owners[0].remainingS).not.toBe(0)
  })

  it('giá trị không hữu hạn bị coi như không có TTL', () => {
    const owners = collectOverrideOwners([point({ id: 'VP-01', forced: true, overrideExpiresInS: Number.NaN })])
    expect(owners[0].remainingS).toBeUndefined()
  })
})

describe('collectOverrideOwners — thứ tự khẩn cấp', () => {
  it('điểm có TTL lên trước điểm không TTL, và trong nhóm có TTL thì ít nhất lên đầu', () => {
    const owners = collectOverrideOwners([
      point({ id: 'DO-09', forced: true }),
      point({ id: 'DO-01', forced: true, overrideExpiresInS: 900 }),
      point({ id: 'DO-05', forced: true, overrideExpiresInS: 30 })
    ])
    expect(owners.map((owner) => owner.pointId)).toEqual(['DO-05', 'DO-01', 'DO-09'])
  })

  it('cùng nhóm không TTL thì sắp theo id để thứ tự ổn định giữa hai lần render', () => {
    const owners = collectOverrideOwners([
      point({ id: 'DO-10', forced: true }),
      point({ id: 'DO-02', forced: true })
    ])
    expect(owners.map((owner) => owner.pointId)).toEqual(['DO-02', 'DO-10'])
  })
})

describe('isOverrideExpiringSoon', () => {
  it('undefined KHÔNG phải "sắp hết hạn" — đó là một tình trạng khác', () => {
    expect(isOverrideExpiringSoon(undefined)).toBe(false)
  })

  it('đúng ngưỡng vẫn tính là sắp hết hạn, vượt ngưỡng thì không', () => {
    expect(isOverrideExpiringSoon(OVERRIDE_EXPIRING_SOON_S)).toBe(true)
    expect(isOverrideExpiringSoon(OVERRIDE_EXPIRING_SOON_S + 1)).toBe(false)
  })

  it('giá trị <= 0 không tính là "sắp hết hạn" vì nó đã hết hạn rồi', () => {
    expect(isOverrideExpiringSoon(0)).toBe(false)
    expect(isOverrideExpiringSoon(-5)).toBe(false)
  })
})

describe('summarizeOverrides', () => {
  it('đếm tách bạch: sắp hết hạn và không có thời hạn là hai nhóm khác nhau', () => {
    const owners = collectOverrideOwners([
      point({ id: 'DO-01', forced: true, overrideExpiresInS: 60 }),
      point({ id: 'DO-02', forced: true, overrideExpiresInS: 3600 }),
      point({ id: 'VP-01', forced: true })
    ])
    expect(summarizeOverrides(owners)).toEqual({ total: 3, expiringSoon: 1, withoutTtl: 1 })
  })

  it('điểm không TTL không bao giờ bị đếm vào expiringSoon', () => {
    const owners = collectOverrideOwners([point({ id: 'VP-01', forced: true })])
    const summary = summarizeOverrides(owners)
    expect(summary.expiringSoon).toBe(0)
    expect(summary.withoutTtl).toBe(1)
  })
})
