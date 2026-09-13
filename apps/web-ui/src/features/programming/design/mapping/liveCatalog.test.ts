import { describe, expect, it } from 'vitest'
import type { Point } from '../../../../shared/types'
import type { ProgrammingPointCatalogEntry } from '../../model/types'
import { catalogIdentitiesDiverged, indexLivePoints, mergeCatalogWithLive, normalizeLiveQuality } from './liveCatalog'

function entry(pointId: string, over: Partial<ProgrammingPointCatalogEntry> = {}): ProgrammingPointCatalogEntry {
  return {
    category: 'LOCAL', pointId, name: pointId, dataType: 'REAL', direction: 'READ',
    writable: false, quality: 'GOOD', value: 1, observedAt: '2026-09-13T03:00:00.000Z',
    ...over,
  }
}

function point(id: string, over: Partial<Point> = {}): Point {
  return {
    id, tag: id, name: id, kind: 'UI', value: 1, quality: 'good', source: 'iop',
    updatedAt: '2026-09-13T03:00:00.000Z',
    ...over,
  } as Point
}

describe('normalizeLiveQuality', () => {
  it('đưa chữ thường của WS về đúng bảng chất lượng của catalog', () => {
    expect(normalizeLiveQuality('good')).toBe('GOOD')
    expect(normalizeLiveQuality('STALE')).toBe('STALE')
  })

  it('giá trị lạ thành UNKNOWN chứ không đi thẳng vào StatusBadge', () => {
    expect(normalizeLiveQuality('weird')).toBe('UNKNOWN')
    expect(normalizeLiveQuality(undefined)).toBe('UNKNOWN')
    expect(normalizeLiveQuality(7)).toBe('UNKNOWN')
  })
})

describe('mergeCatalogWithLive', () => {
  it('không có gì đổi ⇒ trả về CHÍNH mảng cũ (không ép render lại)', () => {
    const items = [entry('UI-01'), entry('UI-02')]
    const live = indexLivePoints([point('UI-01'), point('UI-02')])
    expect(mergeCatalogWithLive(items, live)).toBe(items)
  })

  it('một điểm đổi ⇒ chỉ item đó là object mới, các item khác giữ nguyên reference', () => {
    const items = [entry('UI-01'), entry('UI-02'), entry('UI-03')]
    const live = indexLivePoints([
      point('UI-01'),
      point('UI-02', { value: 42, updatedAt: '2026-09-13T03:00:05.000Z' }),
      point('UI-03'),
    ])
    const merged = mergeCatalogWithLive(items, live)
    expect(merged).not.toBe(items)
    expect(merged[0]).toBe(items[0])
    expect(merged[2]).toBe(items[2])
    expect(merged[1]).not.toBe(items[1])
    expect(merged[1].value).toBe(42)
    expect(merged[1].observedAt).toBe('2026-09-13T03:00:05.000Z')
  })

  it('chưa có gói WS nào ⇒ giữ nguyên seed của lần đọc danh mục', () => {
    const items = [entry('UI-01', { value: 21.5 })]
    const merged = mergeCatalogWithLive(items, new Map())
    expect(merged).toBe(items)
    expect(merged[0].value).toBe(21.5)
  })

  it('điểm không có mẫu sống giữ nguyên giá trị danh mục, không bị xoá về rỗng', () => {
    const items = [entry('UI-01', { value: 3 }), entry('VP-09', { category: 'VP', value: 9 })]
    const merged = mergeCatalogWithLive(items, indexLivePoints([point('UI-01', { value: 4 })]))
    expect(merged[0].value).toBe(4)
    expect(merged[1].value).toBe(9)
  })

  it('mất kênh sống ⇒ quality thành STALE và giữ GIÁ TRỊ SỐNG CUỐI CÙNG, không lùi về số của danh mục', () => {
    const items = [entry('UI-01', { value: 21.5, quality: 'GOOD' })]
    const live = indexLivePoints([point('UI-01', { value: 22.9, updatedAt: '2026-09-13T03:00:20.000Z' })])
    const merged = mergeCatalogWithLive(items, live, { stale: true })
    expect(merged[0].quality).toBe('STALE')
    expect(merged[0].value).toBe(22.9)
    expect(merged[0].observedAt).toBe('2026-09-13T03:00:20.000Z')
    // đã STALE với đúng mẫu đó rồi thì không tạo object mới nữa
    expect(mergeCatalogWithLive(merged, live, { stale: true })).toBe(merged)
  })

  it('mất kênh sống khi CHƯA từng có mẫu ⇒ chỉ gắn STALE lên số của danh mục', () => {
    const items = [entry('UI-01', { value: 21.5, quality: 'GOOD' })]
    const merged = mergeCatalogWithLive(items, new Map(), { stale: true })
    expect(merged[0].quality).toBe('STALE')
    expect(merged[0].value).toBe(21.5)
  })
})

describe('catalogIdentitiesDiverged', () => {
  it('chưa có gói WS ⇒ không coi là lệch (tránh vòng nạp lại vô hạn)', () => {
    expect(catalogIdentitiesDiverged([entry('UI-01')], new Map())).toBe(false)
  })

  it('cùng tập định danh ⇒ không lệch', () => {
    expect(catalogIdentitiesDiverged([entry('UI-01'), entry('UI-02')], indexLivePoints([point('UI-01'), point('UI-02')]))).toBe(false)
  })

  it('WS có điểm mới hoặc thiếu điểm ⇒ lệch, đây là tín hiệu nạp lại danh mục', () => {
    const items = [entry('UI-01'), entry('UI-02')]
    expect(catalogIdentitiesDiverged(items, indexLivePoints([point('UI-01'), point('UI-02'), point('UI-03')]))).toBe(true)
    expect(catalogIdentitiesDiverged(items, indexLivePoints([point('UI-01'), point('UI-09')]))).toBe(true)
  })
})
