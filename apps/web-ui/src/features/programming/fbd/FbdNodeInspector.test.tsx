import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { FbdNodeInspector, type FbdNodeInspectorProps } from './FbdNodeInspector'
import type { FbdNodeEditorTarget } from './nodeEditor'
import type { FbdNode } from './model'
import type { ProgrammingPointCatalogEntry } from '../model/types'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function pick(viText: string, _enText: string) {
  return viText
}

function renderInspectorWithI18n(props: FbdNodeInspectorProps) {
  localStorage.setItem('mkddc-lang', 'vi')
  return render(
    <I18nProvider>
      <FbdNodeInspector {...props} />
    </I18nProvider>,
  )
}

function makeTarget(node: FbdNode, canEdit = true, apply = vi.fn()): FbdNodeEditorTarget {
  return {
    networkId: 'net-1',
    node,
    canEdit,
    apply,
  }
}

describe('FbdNodeInspector', () => {
  it('A-T1: Sửa CONSTANT hợp lệ gọi apply đúng 1 lần', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-const',
      kind: 'CONSTANT',
      typeRef: 'REAL',
      executionOrder: 1,
      parameters: { value: 10 },
      ports: [
        {
          id: 'p-out',
          name: 'OUT',
          direction: 'OUTPUT',
          dataType: 'REAL',
          unit: null,
          order: 1,
        },
      ],
    }

    render(<FbdNodeInspector target={makeTarget(node, true, apply)} pick={pick} />)

    const valueInput = screen.getByLabelText('Giá trị')
    fireEvent.change(valueInput, { target: { value: '25.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({ kind: 'value', value: 25.5 })
  })

  it('A-T2: Tên biến INPUT không hợp lệ báo lỗi tại chỗ, 0 dispatch', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-in',
      kind: 'INPUT',
      typeRef: 'BOOL',
      executionOrder: 1,
      parameters: { variable: 'Valid_Name' },
      ports: [
        {
          id: 'p-out',
          name: 'OUT',
          direction: 'OUTPUT',
          dataType: 'BOOL',
          unit: null,
          order: 1,
        },
      ],
    }

    render(<FbdNodeInspector target={makeTarget(node, true, apply)} pick={pick} />)

    const varInput = screen.getByLabelText('Tên biến')
    fireEvent.change(varInput, { target: { value: '123_invalid!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(screen.getByText('Tên biến không hợp lệ')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
  })

  it('A-T3: Sửa FUNCTION_BLOCK instance và retained', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-fb',
      kind: 'FUNCTION_BLOCK',
      typeRef: 'TON',
      executionOrder: 2,
      parameters: { instance: 'TON_1', retained: false },
      ports: [
        { id: 'p-in', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 1 },
        { id: 'p-q', name: 'Q', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
      ],
    }

    render(<FbdNodeInspector target={makeTarget(node, true, apply)} pick={pick} />)

    const instInput = screen.getByLabelText(/Tên instance/i)
    fireEvent.change(instInput, { target: { value: 'TON_MAIN' } })

    const retainCheckbox = screen.getByLabelText(/RETAIN/i)
    fireEvent.click(retainCheckbox)

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({
      kind: 'fbParams',
      instance: 'TON_MAIN',
      retained: true,
    })
  })

  it('A-T4: Sửa kiểu toán hạng node đa hình', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-poly',
      kind: 'FUNCTION',
      typeRef: 'ADD',
      executionOrder: 3,
      parameters: {},
      ports: [
        { id: 'p-in1', name: 'IN1', direction: 'INPUT', dataType: 'INT', unit: null, order: 1 },
        { id: 'p-in2', name: 'IN2', direction: 'INPUT', dataType: 'INT', unit: null, order: 2 },
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'INT', unit: null, order: 3 },
      ],
    }

    render(<FbdNodeInspector target={makeTarget(node, true, apply)} pick={pick} />)

    const typeSelect = screen.getByLabelText('Kiểu toán hạng')
    fireEvent.change(typeSelect, { target: { value: 'REAL' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({ kind: 'dataType', dataType: 'REAL' })
  })

  it('A-T7: canEdit = false vô hiệu hoá toàn bộ controls, 0 dispatch', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-in',
      kind: 'INPUT',
      typeRef: 'BOOL',
      executionOrder: 1,
      parameters: { variable: 'Sensor' },
      ports: [
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 },
      ],
    }

    render(<FbdNodeInspector target={makeTarget(node, false, apply)} pick={pick} />)

    const varInput = screen.getByLabelText('Tên biến')
    expect(varInput).toBeDisabled()
    const saveButton = screen.getByRole('button', { name: 'Lưu' })
    expect(saveButton).toBeDisabled()

    fireEvent.click(saveButton)
    expect(apply).not.toHaveBeenCalled()
  })

  it('A-T9: Chế độ EDIT không render số runtime nào trên form', () => {
    const node: FbdNode = {
      id: 'node-const',
      kind: 'CONSTANT',
      typeRef: 'INT',
      executionOrder: 1,
      parameters: { value: 0 },
      ports: [
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'INT', unit: null, order: 1 },
      ],
    }

    const { container } = render(<FbdNodeInspector target={makeTarget(node, true)} pick={pick} />)
    expect(container.querySelector('[data-testid="inspector-runtime-value"]')).toBeNull()
  })

  it('A-T14: Node cố định hiển thị thông báo không có tham số', () => {
    const node: FbdNode = {
      id: 'node-fixed',
      kind: 'FUNCTION',
      typeRef: 'NOT',
      executionOrder: 1,
      parameters: {},
      ports: [
        { id: 'p-in', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 1 },
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
      ],
    }

    render(<FbdNodeInspector target={makeTarget(node, true)} pick={pick} />)
    expect(screen.getByText('Block cố định — không có tham số để sửa.')).toBeInTheDocument()
  })

  it('A-T13 (test hồi quy di dời từ StructuredFbdEditor): Arrow/Delete/Ctrl+Z trong ô nhập giữ hành vi native, không biến thành lệnh sửa graph', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-in',
      kind: 'INPUT',
      typeRef: 'BOOL',
      executionOrder: 1,
      parameters: { variable: 'MyVar' },
      ports: [
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 },
      ],
    }

    render(<FbdNodeInspector target={makeTarget(node, true, apply)} pick={pick} />)

    const variableInput = screen.getByLabelText('Tên biến') as HTMLInputElement
    variableInput.focus()

    fireEvent.keyDown(variableInput, { key: 'ArrowDown' })
    fireEvent.keyDown(variableInput, { key: 'Delete' })
    fireEvent.keyDown(variableInput, { key: 'z', ctrlKey: true })

    expect(document.activeElement).toBe(variableInput)
    expect(apply).not.toHaveBeenCalled()
  })

  it('B-T1: Node INPUT, mở picker, chọn 1 point => trường tên/kiểu/đơn vị điền đúng từ entry', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-in-1',
      kind: 'INPUT',
      typeRef: 'BOOL',
      executionOrder: 1,
      parameters: { variable: 'OldVar' },
      ports: [
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 },
      ],
    }
    const mockPoint: ProgrammingPointCatalogEntry = {
      category: 'LOCAL',
      pointId: 'UI_TEMP_01',
      name: 'Temperature Sensor',
      dataType: 'REAL',
      unit: 'degC',
      direction: 'READ',
      writable: false,
      quality: 'GOOD',
      value: 23.5,
    }

    renderInspectorWithI18n({
      target: makeTarget(node, true, apply),
      pick,
      pointCatalogStatus: 'ready',
      pointCatalogItems: [mockPoint],
    })

    // Mở picker bằng nút Chọn…
    const pickBtn = screen.getByRole('button', { name: 'Chọn…' })
    fireEvent.click(pickBtn)

    // Chọn point UI_TEMP_01
    const pointBtn = screen.getByRole('button', { name: /UI_TEMP_01/i })
    fireEvent.click(pointBtn)

    // Sau khi chọn: variable = UI_TEMP_01, type = REAL, unit = degC
    const varInput = screen.getByLabelText('Tên biến') as HTMLInputElement
    const typeSelect = screen.getByLabelText('Kiểu') as HTMLSelectElement
    const unitInput = screen.getByLabelText('Đơn vị (tuỳ chọn)') as HTMLInputElement

    expect(varInput.value).toBe('UI_TEMP_01')
    expect(typeSelect.value).toBe('REAL')
    expect(unitInput.value).toBe('degC')
  })

  it('B-T2: Chọn point rồi Áp dụng => target.apply chỉ nhận kind: "variable" (variable, unit) và "dataType"; KHÔNG mang variableId/pointId/deviceId', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-in-2',
      kind: 'INPUT',
      typeRef: 'BOOL',
      executionOrder: 1,
      parameters: { variable: 'OldVar' },
      ports: [
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 },
      ],
    }
    const mockPoint: ProgrammingPointCatalogEntry = {
      category: 'MB_RTU',
      pointId: 'MB_FLOW_01',
      deviceId: 'DEV-999',
      name: 'Flow Rate',
      dataType: 'REAL',
      unit: 'l/s',
      direction: 'READ',
      writable: false,
      quality: 'GOOD',
      value: 12.0,
    }

    renderInspectorWithI18n({
      target: makeTarget(node, true, apply),
      pick,
      pointCatalogStatus: 'ready',
      pointCatalogItems: [mockPoint],
    })

    // Mở picker và chọn point
    fireEvent.click(screen.getByRole('button', { name: 'Chọn…' }))
    fireEvent.click(screen.getByRole('button', { name: /MB_FLOW_01/i }))

    // Bấm Lưu
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    // Kiểm tra các lệnh apply
    expect(apply).toHaveBeenCalledWith({ kind: 'dataType', dataType: 'REAL' })
    expect(apply).toHaveBeenCalledWith({
      kind: 'variable',
      variable: 'MB_FLOW_01',
      unit: 'l/s',
    })

    // Khẳng định nghiêm ngặt: mọi cuộc gọi apply KHÔNG chứa variableId, pointId, deviceId
    for (const call of apply.mock.calls) {
      const payload = call[0] as Record<string, unknown>
      expect(payload).not.toHaveProperty('variableId')
      expect(payload).not.toHaveProperty('pointId')
      expect(payload).not.toHaveProperty('deviceId')
    }
  })

  it('B-T3: Không sinh Mapping/Binding => R-01 không gọi API ghi, form không phát sinh action ngoài nodeEditor target', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-out-1',
      kind: 'OUTPUT',
      typeRef: 'BOOL',
      executionOrder: 1,
      parameters: { variable: 'OldOut' },
      ports: [
        { id: 'p-in', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 1 },
      ],
    }
    const mockPoint: ProgrammingPointCatalogEntry = {
      category: 'LOCAL',
      pointId: 'DO_FAN_CMD',
      name: 'Fan Start Command',
      dataType: 'BOOL',
      direction: 'WRITE',
      writable: true,
      quality: 'GOOD',
      value: false,
    }

    renderInspectorWithI18n({
      target: makeTarget(node, true, apply),
      pick,
      pointCatalogStatus: 'ready',
      pointCatalogItems: [mockPoint],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Chọn…' }))
    fireEvent.click(screen.getByRole('button', { name: /DO_FAN_CMD/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    // Node typeRef là BOOL, point dataType là BOOL => không đổi type, chỉ phát đúng 1 lệnh 'variable'
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({
      kind: 'variable',
      variable: 'DO_FAN_CMD',
      unit: null,
    })

    const payload = apply.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['kind', 'unit', 'variable'])
    expect(payload).not.toHaveProperty('pointId')
    expect(payload).not.toHaveProperty('deviceId')
    expect(payload).not.toHaveProperty('variableId')
  })

  it('B-T6: Point thiếu unit => đơn vị hiện "không xác định được", không hiện chuỗi rỗng', () => {
    const apply = vi.fn()
    const node: FbdNode = {
      id: 'node-in-nounit',
      kind: 'INPUT',
      typeRef: 'BOOL',
      executionOrder: 1,
      parameters: { variable: 'OldVar' },
      ports: [
        { id: 'p-out', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 },
      ],
    }
    const mockPointNoUnit: ProgrammingPointCatalogEntry = {
      category: 'LOCAL',
      pointId: 'DI_STATUS_01',
      name: 'Status Switch',
      dataType: 'BOOL',
      // unit bị thiếu (undefined)
      direction: 'READ',
      writable: false,
      quality: 'GOOD',
      value: true,
    }

    renderInspectorWithI18n({
      target: makeTarget(node, true, apply),
      pick,
      pointCatalogStatus: 'ready',
      pointCatalogItems: [mockPointNoUnit],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Chọn…' }))
    fireEvent.click(screen.getByRole('button', { name: /DI_STATUS_01/i }))

    const unitInput = screen.getByLabelText('Đơn vị (tuỳ chọn)') as HTMLInputElement
    expect(unitInput.value).toBe('không xác định được')
  })
})
