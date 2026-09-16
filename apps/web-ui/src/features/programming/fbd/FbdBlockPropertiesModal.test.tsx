import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { FbdBlockPropertiesModal, type FbdBlockPropertiesModalProps } from './FbdBlockPropertiesModal'
import type { FbdNetwork, FbdNode } from './model'
import type {
  ProgrammingBinding,
  ProgrammingPointCatalogEntry,
  ProgrammingProgram,
} from '../model/types'

const mockNode: FbdNode = {
  id: 'node-fb-1',
  kind: 'FUNCTION_BLOCK',
  typeRef: 'NewFunctionBlock',
  executionOrder: 3,
  parameters: {
    instance: 'FB_Instance_1',
    retained: true,
    Kp: 2.5,
    Ki: 0.1,
  },
  ports: [
    {
      id: 'port-pv',
      name: 'pv',
      direction: 'INPUT',
      dataType: 'REAL',
      unit: null,
      order: 0,
    },
    {
      id: 'port-q',
      name: 'q',
      direction: 'OUTPUT',
      dataType: 'BOOL',
      unit: null,
      order: 1,
    },
  ],
}

const mockNetwork: FbdNetwork = {
  id: 'net-1',
  name: 'network_1',
  order: 0,
  nodes: [mockNode],
  wires: [
    {
      id: 'wire-12345678-90ab',
      from: { nodeId: 'node-and', portId: 'out-1' },
      to: { nodeId: 'node-fb-1', portId: 'port-pv' },
    },
  ],
}

const mockPrograms: ProgrammingProgram[] = [
  {
    programId: 'prog-fb',
    objectId: 'obj-fb',
    name: 'NewFunctionBlock',
    kind: 'FUNCTION_BLOCK',
    language: 'ST',
    document: 'FUNCTION_BLOCK NewFunctionBlock...',
    access: 'Kỹ sư vận hành cấp cao',
    description: 'Khối hàm xử lý tín hiệu đầu vào và điều khiển quạt gió.',
  },
]

const mockBindings: ProgrammingBinding[] = [
  {
    bindingId: 'b-1',
    variableId: 'port-pv',
    point: { category: 'LOCAL', pointId: 'AO-01' },
    direction: 'READ',
    dataType: 'REAL',
    unit: 'V',
    writable: true,
    qualityPolicy: 'REQUIRE_GOOD',
  },
]

const mockPoints: ProgrammingPointCatalogEntry[] = [
  {
    category: 'LOCAL',
    pointId: 'AO-01',
    displayId: 'AO-01',
    name: 'Fan Speed Command',
    dataType: 'REAL',
    unit: 'V',
    direction: 'READ_WRITE',
    writable: true,
    quality: 'GOOD',
    value: 5,
  },
]

function renderModal(overrides: Partial<FbdBlockPropertiesModalProps> = {}) {
  const onClose = vi.fn()
  const onRequestPortMapping = vi.fn()
  render(
    <I18nProvider>
      <FbdBlockPropertiesModal
        node={mockNode}
        nodeGeometry={{ id: 'node-fb-1', x: 264, y: 336, width: 168, height: 80, ports: [], auto: false }}
        network={mockNetwork}
        programs={mockPrograms}
        bindings={mockBindings}
        pointCatalogItems={mockPoints}
        onClose={onClose}
        onRequestPortMapping={onRequestPortMapping}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onClose, onRequestPortMapping }
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
})

afterEach(cleanup)

describe('FbdBlockPropertiesModal', () => {
  it('hiển thị đầy đủ thông tin Header và Thuộc tính POU (Tên, Loại, Instance, ExecutionOrder, Retained)', () => {
    renderModal()

    // Header
    expect(screen.getByRole('heading', { name: 'NewFunctionBlock' })).toBeInTheDocument()
    expect(screen.getAllByText('#3').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/FUNCTION_BLOCK/i).length).toBeGreaterThanOrEqual(1)

    // Section 1: POU Properties
    expect(screen.getByText('Thuộc tính POU (POU Properties)')).toBeInTheDocument()
    expect(screen.getByText('FB_Instance_1')).toBeInTheDocument()
    expect(screen.getByText((content) => content.includes('TRUE'))).toBeInTheDocument()
  })

  it('hiển thị đầy đủ phần Quyền truy cập và Mô tả POU', () => {
    renderModal()

    expect(screen.getByText('Truy cập & Mô tả (Access & Description)')).toBeInTheDocument()
    expect(screen.getByText('Kỹ sư vận hành cấp cao')).toBeInTheDocument()
    expect(screen.getByText('Khối hàm xử lý tín hiệu đầu vào và điều khiển quạt gió.')).toBeInTheDocument()
  })

  it('hiển thị các tham số chỉnh định (General Parameters)', () => {
    renderModal()

    expect(screen.getByText('Tham số chung (General Parameters)')).toBeInTheDocument()
    expect(screen.getByText('Kp:')).toBeInTheDocument()
    expect(screen.getByText('2.5')).toBeInTheDocument()
    expect(screen.getByText('Ki:')).toBeInTheDocument()
    expect(screen.getByText('0.1')).toBeInTheDocument()
  })

  it('hiển thị cổng I/O kèm thông tin điểm đã mapping và giá trị realtime (AO-01: 5V)', () => {
    renderModal()

    expect(screen.getByText('Cổng I/O & Ánh xạ điểm (I/O & Mappings)')).toBeInTheDocument()
    expect(screen.getByText('pv')).toBeInTheDocument()
    expect(screen.getByText('AO-01: 5V')).toBeInTheDocument()

    // Cổng q chưa map
    expect(screen.getByText('q')).toBeInTheDocument()
    expect(screen.getByText('Chưa ánh xạ')).toBeInTheDocument()
  })

  it('hiển thị Trạng thái (Validation) và Thuộc tính mở rộng kèm Dây nối', () => {
    renderModal()

    expect(screen.getByText('Trạng thái (Status)')).toBeInTheDocument()
    expect(screen.getByText('Hợp lệ (Valid)')).toBeInTheDocument()

    expect(screen.getByText('Thuộc tính mở rộng & Dây nối (Attributes & Wires)')).toBeInTheDocument()
    expect(screen.getByText(/X: 264, Y: 336/)).toBeInTheDocument()
    expect(screen.getByText(/168 × 80 px/)).toBeInTheDocument()
    expect(screen.getByText(/Wire: wire-123/)).toBeInTheDocument()
  })

  it('nút Đóng và phím Esc kích hoạt onClose', () => {
    const { onClose } = renderModal()

    // Nút Đóng ở footer (hoặc nút X ở header)
    const closeBtn = screen.getAllByRole('button', { name: /Đóng|Close/ })[0]
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Phím Esc
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('nút Ánh xạ trên cổng gọi onRequestPortMapping và đóng modal properties', () => {
    const { onClose, onRequestPortMapping } = renderModal()

    const mapBtn = screen.getByRole('button', { name: 'Ánh xạ' })
    fireEvent.click(mapBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRequestPortMapping).toHaveBeenCalledTimes(1)
    expect(onRequestPortMapping).toHaveBeenCalledWith({
      nodeId: 'node-fb-1',
      portId: 'port-q',
      portName: 'q',
      nodeName: 'NewFunctionBlock',
      portDirection: 'OUTPUT',
      portDataType: 'BOOL',
    })
  })
})

