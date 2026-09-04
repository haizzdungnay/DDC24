import { describe, expect, it } from 'vitest'
import { pointDisplayId, pointKindLabel, pointSourceKind, pointSourceLabel } from './pointSourceLabels'

/* ISS-PIO-09 (F-PIO-026) — nhãn nguồn của hàng Point, và quyết định `AO`/`UO`
 * của chủ sở hữu: giữ `AO` xuyên suốt code/API/SHM để KHÔNG phá contract, chỉ
 * giao diện được hiện "UO — Universal Output". */

describe('pointSourceKind', () => {
  it('suy nhóm kênh từ tiền tố pointId của khối cấu hình sinh ra điểm', () => {
    expect(pointSourceKind({ category: 'LOCAL', pointId: 'UI-01' })).toBe('UI')
    expect(pointSourceKind({ category: 'LOCAL', pointId: 'AO-02' })).toBe('AO')
    expect(pointSourceKind({ category: 'LOCAL', pointId: 'DO-03' })).toBe('DO')
    expect(pointSourceKind({ category: 'VP', pointId: 'AV-01' })).toBe('VP')
    expect(pointSourceKind({ category: 'MB_RTU', pointId: 'VFD_Frequency' })).toBe('MB_RTU')
  })

  it('tiền tố lạ ra UNKNOWN chứ không bị ép vào một nhóm', () => {
    expect(pointSourceKind({ category: 'LOCAL', pointId: 'XX-01' })).toBe('UNKNOWN')
  })
})

describe('pointKindLabel', () => {
  it('chỉ AO được đổi nhãn thành UO', () => {
    expect(pointKindLabel('AO')).toBe('UO')
    expect(pointKindLabel('UI')).toBe('UI')
    expect(pointKindLabel('DO')).toBe('DO')
    expect(pointKindLabel('VP')).toBe('VP')
    expect(pointKindLabel('MB_RTU')).toBe('MB_RTU')
    expect(pointKindLabel('ALL')).toBe('Tất cả')
  })

  it('UO là NHÃN, không phải giá trị — nhóm kênh trên dây vẫn là AO', () => {
    // Nếu ngày nào đó có người "dọn dẹp" bằng cách đổi luôn giá trị, test này
    // đỏ trước khi contract vỡ ở io_config.conf / BuildProfile / io_map.
    expect(pointSourceKind({ category: 'LOCAL', pointId: 'AO-02' })).toBe('AO')
  })
})

describe('pointSourceLabel', () => {
  it('dựng nhãn nguồn theo đúng ví dụ của đề bài §29', () => {
    expect(pointSourceLabel({ category: 'LOCAL', pointId: 'UI-01' })).toBe('PHYSICAL · UI')
    expect(pointSourceLabel({ category: 'LOCAL', pointId: 'AO-02' })).toBe('PHYSICAL · UO')
    expect(pointSourceLabel({ category: 'VP', pointId: 'AV-01' })).toBe('VIRTUAL')
    expect(pointSourceLabel({ category: 'MB_RTU', pointId: 'VFD_Frequency', deviceLabel: 'VFD-01' })).toBe('MODBUS · VFD-01')
  })

  it('thiếu tên thiết bị thì CHỈ ghi MODBUS, không rơi về deviceId canonical', () => {
    // `bus-1-slave-3` trên màn hình chính là khiếm khuyết mà issue này sửa.
    expect(pointSourceLabel({ category: 'MB_RTU', pointId: 'VFD_Frequency' })).toBe('MODBUS')
  })
})

describe('pointDisplayId', () => {
  it('dùng định danh máy chủ dựng khi có', () => {
    expect(pointDisplayId({ displayId: 'MB-014', pointId: 'VFD_Frequency' })).toBe('MB-014')
  })

  it('quay về pointId khi máy chủ chưa dựng được — hàng vẫn phải nhận diện được', () => {
    expect(pointDisplayId({ pointId: 'VFD_Frequency' })).toBe('VFD_Frequency')
    expect(pointDisplayId({ displayId: '   ', pointId: 'VFD_Frequency' })).toBe('VFD_Frequency')
  })
})
