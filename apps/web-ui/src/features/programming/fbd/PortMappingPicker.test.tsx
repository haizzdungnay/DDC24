import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { PortMappingPicker, checkPointEligibility, type PortMappingPickerProps } from './PortMappingPicker'
import type { ProgrammingPointCatalogEntry } from '../model/types'

const mockPoints: ProgrammingPointCatalogEntry[] = [
  {
    category: 'LOCAL',
    pointId: 'DO-01',
    displayId: 'DO-01',
    name: 'Exhaust Fan On/Off',
    dataType: 'BOOL',
    direction: 'READ_WRITE',
    writable: true,
    quality: 'GOOD',
    value: true,
  },
  {
    category: 'LOCAL',
    pointId: 'AO-01',
    displayId: 'AO-01',
    name: 'Fan Speed',
    dataType: 'REAL',
    unit: 'V',
    direction: 'READ_WRITE',
    writable: true,
    quality: 'GOOD',
    value: 5,
  },
  {
    category: 'VP',
    pointId: 'VP-01',
    displayId: 'VP-01',
    name: 'Virtual Temperature',
    dataType: 'REAL',
    unit: 'degC',
    direction: 'READ',
    writable: false,
    quality: 'UNCERTAIN',
    value: 23.5,
  },
  {
    category: 'MB_RTU',
    pointId: 'MB-01',
    displayId: 'MB-01',
    name: 'Modbus Relay',
    dataType: 'BOOL',
    direction: 'WRITE',
    writable: true,
    quality: 'OFFLINE',
    value: null,
  },
]

function renderPicker(overrides: Partial<PortMappingPickerProps> = {}) {
  const onSelect = vi.fn().mockResolvedValue({ ok: true })
  const onUnmap = vi.fn().mockResolvedValue({ ok: true })
  const onClose = vi.fn()
  render(
    <I18nProvider>
      <PortMappingPicker
        portId="port-in2"
        portDirection="INPUT"
        portDataType="BOOL"
        portName="IN2"
        nodeName="AND"
        points={mockPoints}
        onSelect={onSelect}
        onUnmap={onUnmap}
        onClose={onClose}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onSelect, onUnmap, onClose }
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
})

afterEach(cleanup)

describe('PortMappingPicker — Comment 1 & 2', () => {
  it('hiển thị đúng giá trị realtime số đo và huy hiệu chất lượng của điểm', () => {
    renderPicker()

    expect(screen.getByText('5V')).toBeInTheDocument()
    expect(screen.getByText('23.5 degC')).toBeInTheDocument()
    expect(screen.getByText('TRUE')).toBeInTheDocument()

    expect(screen.getAllByText('GOOD').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('UNCERTAIN')).toBeInTheDocument()
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
  })

  it('điểm phù hợp hiện nút Map, điểm không phù hợp hiện nút Can\'t map', () => {
    renderPicker()

    const mapButtons = screen.getAllByRole('button', { name: /Ánh xạ|Map/ })
    expect(mapButtons.length).toBe(1) // Chỉ DO-01 hợp lệ

    // 1 nút toggle ở thanh filter + 3 nút của 3 hàng
    const cantMapButtons = screen.getAllByRole('button', { name: /Không thể map/ })
    expect(cantMapButtons.length).toBe(4)
  })

  it('khi ấn Map: hộp thoại KHÔNG biến mất, nút chuyển thành "Đã map" và hiện box báo thành công', async () => {
    const { onSelect, onClose } = renderPicker()

    const mapBtn = screen.getByRole('button', { name: /Ánh xạ|Map/ })
    fireEvent.click(mapBtn)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(mockPoints[0])

    // Hộp thoại KHÔNG đóng (onClose không được gọi)
    expect(onClose).not.toHaveBeenCalled()

    // Xuất hiện box báo thành công
    const statusBox = await screen.findByTestId('port-mapping-status-box')
    expect(statusBox).toHaveTextContent(/Ánh xạ thành công|Mapping successful/)
    expect(statusBox).toHaveTextContent(/DO-01/)

    // Nút Map chuyển thành trạng thái "Đã map"
    expect(await screen.findByText(/Đã map|Mapped/)).toBeInTheDocument()
  })

  it('khi ấn Map thất bại: hiện box báo lỗi và lý do thất bại', async () => {
    const onSelect = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Máy chủ từ chối lưu thay đổi Draft',
      detail: 'ETAG_MISMATCH',
    })
    renderPicker({ onSelect })

    const mapBtn = screen.getByRole('button', { name: /Ánh xạ|Map/ })
    fireEvent.click(mapBtn)

    const statusBox = await screen.findByTestId('port-mapping-status-box')
    expect(statusBox).toHaveTextContent(/Ánh xạ thất bại|Mapping failed/)
    expect(statusBox).toHaveTextContent('Máy chủ từ chối lưu thay đổi Draft')
    expect(statusBox).toHaveTextContent('ETAG_MISMATCH')
  })

  it('khi bấm nút "Không thể map": box hiện lên giải thích lý do cụ thể tại sao không map được', async () => {
    renderPicker()

    // Bấm nút "Không thể map" của AO-01 (sai kiểu dữ liệu REAL vs BOOL)
    const cantMapButtons = screen.getAllByRole('button', { name: /^Không thể map$/ })
    fireEvent.click(cantMapButtons[0])

    const statusBox = await screen.findByTestId('port-mapping-status-box')
    expect(statusBox).toHaveTextContent(/Không thể ánh xạ điểm "AO-01"/)
    expect(statusBox).toHaveTextContent(/REAL ≠ BOOL/)
  })

  it('bật trường lọc "Có thể map" chỉ hiện điểm có thể map', () => {
    renderPicker()

    const canMapToggle = screen.getByTestId('filter-can-map')
    fireEvent.click(canMapToggle)

    expect(screen.getByText('DO-01')).toBeInTheDocument()
    expect(screen.queryByText('AO-01')).toBeNull()
    expect(screen.queryByText('VP-01')).toBeNull()
    expect(screen.queryByText('MB-01')).toBeNull()

    // Tắt lại bộ lọc
    fireEvent.click(canMapToggle)
    expect(screen.getByText('AO-01')).toBeInTheDocument()
  })

  it('bật trường lọc Không thể map chỉ hiện điểm không thể map', () => {
    renderPicker()

    const cantMapToggle = screen.getByTestId('filter-cant-map')
    fireEvent.click(cantMapToggle)

    expect(screen.queryByText('DO-01')).toBeNull()
    expect(screen.getByText('AO-01')).toBeInTheDocument()
    expect(screen.getByText('VP-01')).toBeInTheDocument()
  })

  it('bộ lọc Category kết hợp tốt với bộ lọc Có thể map', () => {
    renderPicker({
      portDirection: 'OUTPUT',
      portDataType: 'REAL',
    })

    fireEvent.click(screen.getByRole('button', { name: 'I/O' }))
    fireEvent.click(screen.getByTestId('filter-can-map'))

    expect(screen.getByText('AO-01')).toBeInTheDocument()
    expect(screen.queryByText('VP-01')).toBeNull()
  })

  it('ô tìm kiếm lọc theo tên hoặc display ID', () => {
    renderPicker()

    const searchInput = screen.getByPlaceholderText(/Tìm điểm/i)
    fireEvent.change(searchInput, { target: { value: 'Exhaust' } })

    expect(screen.getByText('DO-01')).toBeInTheDocument()
    expect(screen.queryByText('AO-01')).toBeNull()
  })

  it('người dùng chủ động đóng hộp thoại bằng nút Đóng hoặc phím Esc', () => {
    const { onClose } = renderPicker()

    // Nút đóng (nút X trên header hoặc nút Đóng ở footer)
    const closeBtn = screen.getAllByRole('button', { name: /Đóng|Close/ })[0]
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Phím Esc
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('mỗi port chỉ map với 1 point: khi map sang point khác, ô mapped của point cũ trở lại nút Map', async () => {
    const multiMappablePoints: ProgrammingPointCatalogEntry[] = [
      ...mockPoints,
      {
        category: 'LOCAL',
        pointId: 'DO-02',
        displayId: 'DO-02',
        name: 'Supply Fan On/Off',
        dataType: 'BOOL',
        direction: 'READ_WRITE',
        writable: true,
        quality: 'GOOD',
        value: false,
      },
    ]

    const { onSelect } = renderPicker({ points: multiMappablePoints })

    // Ban đầu cả 2 đều có nút Map
    expect(screen.getByTestId('map-btn-DO-01')).toBeInTheDocument()
    expect(screen.getByTestId('map-btn-DO-02')).toBeInTheDocument()

    // Map DO-01
    fireEvent.click(screen.getByTestId('map-btn-DO-01'))
    expect(onSelect).toHaveBeenCalledWith(multiMappablePoints[0])

    // DO-01 thành "Đã map" và có nút "Hủy map", DO-02 vẫn là nút Map
    expect(await screen.findByTestId('unmap-btn-DO-01')).toBeInTheDocument()
    expect(screen.queryByTestId('map-btn-DO-01')).toBeNull()
    expect(screen.getByTestId('map-btn-DO-02')).toBeInTheDocument()

    // Giờ map sang DO-02 (không bấm unmap DO-01)
    fireEvent.click(screen.getByTestId('map-btn-DO-02'))
    expect(onSelect).toHaveBeenCalledWith(multiMappablePoints[4])

    // DO-02 trở thành "Đã map" kèm nút "Hủy map", DO-01 trở lại nút Map!
    expect(await screen.findByTestId('unmap-btn-DO-02')).toBeInTheDocument()
    expect(screen.getByTestId('map-btn-DO-01')).toBeInTheDocument()
    expect(screen.queryByTestId('unmap-btn-DO-01')).toBeNull()

    // Chỉ có duy nhất 1 huy hiệu "Đã map"
    expect(screen.getAllByText(/Đã map|Mapped/).length).toBe(1)
  })

  it('nút Hủy map: khi bấm vào thì hủy ánh xạ, điểm trở lại nút Map và hiện thông báo thành công', async () => {
    const { onUnmap } = renderPicker({
      bindings: [
        {
          bindingId: 'b-1',
          variableId: 'port-in2',
          point: { category: 'LOCAL', pointId: 'DO-01' },
          direction: 'READ',
          dataType: 'BOOL',
          writable: true,
          qualityPolicy: 'REQUIRE_GOOD',
        },
      ],
    })

    // DO-01 khởi tạo ở trạng thái Đã map và có nút Hủy map
    const unmapBtn = screen.getByTestId('unmap-btn-DO-01')
    expect(unmapBtn).toBeInTheDocument()

    // Bấm nút Hủy map
    fireEvent.click(unmapBtn)
    expect(onUnmap).toHaveBeenCalledTimes(1)
    expect(onUnmap).toHaveBeenCalledWith(mockPoints[0])

    // DO-01 trở về nút Map
    expect(await screen.findByTestId('map-btn-DO-01')).toBeInTheDocument()
    expect(screen.queryByTestId('unmap-btn-DO-01')).toBeNull()

    // Hiện box thông báo thành công
    const statusBox = await screen.findByTestId('port-mapping-status-box')
    expect(statusBox).toHaveTextContent(/Đã hủy ánh xạ|Successfully unmapped/)
    expect(statusBox).toHaveTextContent(/DO-01/)
  })

  it('khi hủy map thất bại: hiện box báo lỗi và giữ nguyên trạng thái Đã map', async () => {
    const onUnmap = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Máy chủ từ chối hủy ánh xạ Draft',
      detail: 'LOCK_CONFLICT',
    })

    renderPicker({
      bindings: [
        {
          bindingId: 'b-1',
          variableId: 'port-in2',
          point: { category: 'LOCAL', pointId: 'DO-01' },
          direction: 'READ',
          dataType: 'BOOL',
          writable: true,
          qualityPolicy: 'REQUIRE_GOOD',
        },
      ],
      onUnmap,
    })

    const unmapBtn = screen.getByTestId('unmap-btn-DO-01')
    fireEvent.click(unmapBtn)

    const statusBox = await screen.findByTestId('port-mapping-status-box')
    expect(statusBox).toHaveTextContent(/Hủy ánh xạ thất bại|Unmapping failed/)
    expect(statusBox).toHaveTextContent('Máy chủ từ chối hủy ánh xạ Draft')
    expect(statusBox).toHaveTextContent('LOCK_CONFLICT')

    // Trạng thái Đã map vẫn được giữ nguyên
    expect(screen.getByTestId('unmap-btn-DO-01')).toBeInTheDocument()
  })
})

/* Issue #840 — chất lượng live chỉ chặn chân ĐẦU VÀO.
 *
 * `DDD-CTRL-PROG-001` §5: binding đầu ra chỉ cần Point writable và
 * range/unit/rate hợp lệ. VP do chính Program ghi về BAD khi Program không
 * chạy; chặn map chân đầu ra vì thế là chặn đúng việc sửa Program đó. */
describe('checkPointEligibility — chất lượng live theo chiều (Issue #840)', () => {
  const pick = (vi: string) => vi
  const programOwnedBad: ProgrammingPointCatalogEntry = {
    category: 'VP', pointId: 'AV-06', displayId: 'AV-06', name: 'DO16_STS_ON',
    dataType: 'REAL', direction: 'READ_WRITE', writable: true, quality: 'BAD', value: null,
  }

  it('chân OUTPUT map được vào điểm ghi đang BAD/OFFLINE', () => {
    expect(checkPointEligibility(programOwnedBad, 'OUTPUT', 'REAL', pick)).toEqual({ canMap: true, reason: 'Có thể ánh xạ' })
    const offlineRelay = mockPoints.find((point) => point.pointId === 'MB-01')!
    expect(checkPointEligibility(offlineRelay, 'OUTPUT', 'BOOL', pick).canMap).toBe(true)
  })

  it('chân INPUT vẫn không map được vào điểm không GOOD', () => {
    const result = checkPointEligibility(programOwnedBad, 'INPUT', 'REAL', pick)
    expect(result.canMap).toBe(false)
    expect(result.reason).toContain('Chất lượng điểm không đạt (BAD)')
  })

  it('chân OUTPUT vẫn bị chặn khi điểm không ghi được, bất kể chất lượng', () => {
    const readOnly = mockPoints.find((point) => point.pointId === 'VP-01')!
    expect(checkPointEligibility(readOnly, 'OUTPUT', 'REAL', pick).canMap).toBe(false)
  })
})
