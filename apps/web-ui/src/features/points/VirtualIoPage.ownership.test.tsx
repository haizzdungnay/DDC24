import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { ToastProvider } from '../../shared/components/Toast'
import { OwnerField, VirtualPointsPage, normalizeVirtualPoint, virtualPointOwner, virtualPointWritable } from './VirtualIoPage'
import type { Point, VirtualPoint } from '../../shared/types'

const api = vi.hoisted(() => ({
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  updateVirtualPoint: vi.fn(),
  createVirtualPoint: vi.fn(),
  deleteVirtualPoint: vi.fn(),
  getVirtualPointUsage: vi.fn(),
  forcePoint: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[] }))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: () => ({ data: hookState.points, loading: false, error: null, refetch: vi.fn() })
}))
vi.mock('../../shared/components/PointLoggingSection', () => ({
  PointLoggingSection: () => <div />
}))
vi.mock('../../shared/components/TrendChart', () => ({ TrendChart: () => <div data-testid="trend-chart" /> }))

/* `ISS-PIO-16` — quyền sở hữu VP (WEB / PROGRAM) phải nhìn thấy được (F-PIO-017).
 *
 * Backend tách đúng hai trục `writable` / `source` từ lâu, nhưng trục thứ hai
 * chưa từng có mặt ở giao diện: không trong type, không ô đặt, không nhãn. Người
 * kỹ sư thấy một VP "chỉ đọc" mà không manh mối nào vì sao.
 */

afterEach(cleanup)

function vp(overrides: Partial<VirtualPoint> = {}): VirtualPoint {
  return {
    id: 'VP1', channel: 25, tag: 'FAN_CMD', name: 'Fan', label: 'Fan',
    signalType: 'float', enabled: true, writable: true, logEnabled: false,
    value: 1, boundPointId: 'AV-01', ...overrides
  }
}

describe('chủ sở hữu hiệu lực', () => {
  /* Vắng mặt = WEB, khớp cách backend chuẩn hoá. Giao diện không được tự nghĩ
   * ra nghĩa thứ ba cho chuỗi rỗng. */
  it('vắng mặt đọc thành WEB', () => {
    expect(virtualPointOwner(vp({ source: undefined }))).toBe('WEB')
    expect(virtualPointOwner(vp({ source: 'WEB' }))).toBe('WEB')
    expect(virtualPointOwner(vp({ source: 'PROGRAM' }))).toBe('PROGRAM')
  })
})

describe('khả năng ghi thật', () => {
  /* Một VP `writable: true` do chương trình sở hữu vẫn bị backend từ chối mọi
   * lệnh ghi. Dựng nút Write theo cờ thô là dựng một nút bấm vào không có gì
   * xảy ra — đúng khiếu nại của F-PIO-017. */
  it('writable: true + PROGRAM ⇒ KHÔNG ghi được', () => {
    expect(virtualPointWritable(vp({ writable: true, source: 'PROGRAM' }))).toBe(false)
  })

  it('writable: true + WEB ⇒ ghi được', () => {
    expect(virtualPointWritable(vp({ writable: true, source: 'WEB' }))).toBe(true)
  })

  // Cờ `writable: false` của cấu hình vẫn có hiệu lực — hai trục vẫn tách.
  it('writable: false ⇒ không ghi được bất kể chủ sở hữu', () => {
    expect(virtualPointWritable(vp({ writable: false, source: 'WEB' }))).toBe(false)
    expect(virtualPointWritable(vp({ writable: false, source: 'PROGRAM' }))).toBe(false)
  })
})

describe('ô chọn chủ sở hữu', () => {
  it('hiện đúng chủ sở hữu hiện tại và đổi được', async () => {
    const onChange = vi.fn()
    render(<I18nProvider><OwnerField item={vp({ source: 'WEB' })} onChange={onChange} /></I18nProvider>)
    const select = screen.getByLabelText(/Chủ sở hữu giá trị|Value owner/) as HTMLSelectElement
    expect(select.value).toBe('WEB')
    await userEvent.selectOptions(select, 'PROGRAM')
    expect(onChange).toHaveBeenCalledWith({ source: 'PROGRAM' })
  })

  /* PROGRAM bị KHOÁ khi điểm chưa gắn slot Core: quyền sở hữu chỉ có nghĩa khi
   * có một slot để sở hữu, và backend từ chối đúng như vậy. Khoá kèm lời giải
   * thích tốt hơn là để người dùng chọn rồi nhận 400 mà không hiểu. */
  it('khoá PROGRAM khi chưa gắn slot Core, kèm lý do', () => {
    render(<I18nProvider><OwnerField item={vp({ boundPointId: undefined, source: 'WEB' })} onChange={() => {}} /></I18nProvider>)
    const option = screen.getByRole('option', { name: /PROGRAM/ }) as HTMLOptionElement
    expect(option.disabled).toBe(true)
    expect(screen.getByText(/slot Core|Core slot/)).toBeInTheDocument()
  })

  // Điểm ĐANG là PROGRAM thì không được khoá chính lựa chọn nó đang mang —
  // khoá là biến ô select thành một trạng thái không tự thoát ra được.
  it('không khoá PROGRAM khi điểm đang mang giá trị đó', () => {
    render(<I18nProvider><OwnerField item={vp({ boundPointId: undefined, source: 'PROGRAM' })} onChange={() => {}} /></I18nProvider>)
    expect((screen.getByRole('option', { name: /PROGRAM/ }) as HTMLOptionElement).disabled).toBe(false)
  })

  // Ô này khác "Writable" và phải nói ra, vì đó chính là điều người dùng nhầm.
  it('giải thích khác biệt với Writable', () => {
    render(<I18nProvider><OwnerField item={vp()} onChange={() => {}} /></I18nProvider>)
    expect(screen.getByText(/Writable/)).toBeInTheDocument()
  })
})

describe('chuẩn hoá trước khi gửi', () => {
  it('giữ PROGRAM khi còn gắn slot', () => {
    expect(normalizeVirtualPoint(vp({ source: 'PROGRAM', boundPointId: 'AV-01' })).source).toBe('PROGRAM')
  })

  /* Mất slot thì `PROGRAM` là một tổ hợp backend chắc chắn từ chối. Rơi về
   * `WEB` ở đây để form không gửi lên một yêu cầu đã biết trước là 400. */
  it('rơi về WEB khi không còn slot', () => {
    expect(normalizeVirtualPoint(vp({ source: 'PROGRAM', boundPointId: undefined })).source).toBe('WEB')
  })

  it('điểm chưa khai source chuẩn hoá thành WEB', () => {
    expect(normalizeVirtualPoint(vp({ source: undefined })).source).toBe('WEB')
  })
})


/* Khối "Write Value" phải nói VÌ SAO điểm chỉ đọc.
 *
 * Đây là toàn bộ nội dung khiếu nại F-PIO-017: nhãn "Read only" trần trụi trả
 * lời đúng câu hỏi sai. Hai lý do khác nhau cần hai câu khác nhau, vì hai cách
 * gỡ khác nhau: bật `writable` trong cấu hình, hay đổi chủ sở hữu / sửa chương
 * trình. */
describe('lý do chỉ đọc hiện trên màn hình', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'vi')
    api.getVirtualPointUsage.mockResolvedValue({ pointId: 'VP1', references: [], scanned: [], incomplete: false })
    api.updateVirtualPoint.mockImplementation(async (point: VirtualPoint) => point)
    api.forcePoint.mockResolvedValue(undefined)
    hookState.points = []
  })
  afterEach(() => { vi.clearAllMocks(); hookState.points = [] })

  function renderPage() {
    return render(
      <MemoryRouter><I18nProvider><ToastProvider><VirtualPointsPage /></ToastProvider></I18nProvider></MemoryRouter>
    )
  }

  it('điểm do chương trình sở hữu: nói rõ chương trình ST và cách lấy lại quyền ghi', async () => {
    api.getVirtualPoints.mockResolvedValue([vp({ writable: true, source: 'PROGRAM', boundPointId: 'AV-01' })])
    renderPage()
    expect(await screen.findByText(/chương trình ST sở hữu slot này/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write' })).not.toBeInTheDocument()
  })

  it('điểm chưa bật Writable: nói đúng lý do CỦA NÓ, không đổ cho chương trình', async () => {
    api.getVirtualPoints.mockResolvedValue([vp({ writable: false, source: 'WEB' })])
    renderPage()
    expect(await screen.findByText(/không bật "Writable"/)).toBeInTheDocument()
    expect(screen.queryByText(/chương trình ST sở hữu/)).not.toBeInTheDocument()
  })

  it('điểm ghi được vẫn có nút Write', async () => {
    api.getVirtualPoints.mockResolvedValue([vp({ writable: true, source: 'WEB' })])
    renderPage()
    expect(await screen.findByRole('button', { name: 'Write' })).toBeInTheDocument()
  })
})
