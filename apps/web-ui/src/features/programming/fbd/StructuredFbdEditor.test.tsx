import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useState } from 'react'
import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { I18nProvider, useI18n } from '../../../shared/i18n'
import { StructuredFbdEditor } from './StructuredFbdEditor'
import { FbdNodeInspector } from './FbdNodeInspector'
import type { FbdNodeEditorTarget } from './nodeEditor'
import type { FbdDocument } from './model'
import type { UserPouInterface } from './userPou'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function EditorTestHarness({
  document,
  canEdit,
  onChange,
  userPouInterfaces,
}: {
  document: FbdDocument
  canEdit: boolean
  onChange: (doc: FbdDocument) => void
  userPouInterfaces: readonly UserPouInterface[]
}) {
  const { pick } = useI18n()
  const [target, setTarget] = useState<FbdNodeEditorTarget | null>(null)
  return (
    <>
      <StructuredFbdEditor
        document={document}
        canEdit={canEdit}
        onChange={onChange}
        userPouInterfaces={userPouInterfaces}
        onNodeEditorTargetChange={setTarget}
      />
      {target && <FbdNodeInspector target={target} pick={pick} />}
    </>
  )
}

function renderEditor(
  document: FbdDocument,
  canEdit = true,
  onChange = vi.fn(),
  userPouInterfaces: readonly UserPouInterface[] = [],
) {
  return {
    onChange,
    ...render(
      <I18nProvider>
        <EditorTestHarness
          document={document}
          canEdit={canEdit}
          onChange={onChange}
          userPouInterfaces={userPouInterfaces}
        />
      </I18nProvider>,
    ),
  }
}

afterEach(cleanup)

describe('StructuredFbdEditor', () => {
  it('hiển thị graph canonical, toolbar và trợ giúp keyboard', () => {
    renderEditor(golden())
    expect(screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ })).toBeTruthy()
    expect(screen.getByText('FBD · AHU_FAN_ENABLE')).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: /FBD commands|Lệnh FBD/ })).toBeTruthy()
    expect(screen.getByText(/Insert.*block/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /OUTPUT OUT BOOL/ })).toHaveLength(3)
  })

  it('AC-FBD-004: hoàn tất một wire chỉ bằng Arrow và Enter — mỗi nối đều do người dùng xác nhận', async () => {
    const document = golden()
    document.networks[0].wires = document.networks[0].wires.slice(1)
    const { onChange } = renderEditor(document)
    const editor = screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ })
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'Enter' })
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    expect(changed.networks[0].wires).toHaveLength(3)
  })

  it('Delete xóa block đang chọn và wire liên quan', async () => {
    const { onChange } = renderEditor(golden())
    fireEvent.click(screen.getByRole('button', { name: /#2 · AND/ }))
    fireEvent.keyDown(screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ }), { key: 'Delete' })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    expect(changed.networks[0].nodes).toHaveLength(3)
    expect(changed.networks[0].wires).toHaveLength(0)
  })

  it('AC-PGM02-010 / AC-FBD-009: chế độ chỉ đọc chặn cả toolbar và shortcut mutation', () => {
    const { onChange } = renderEditor(golden(), false)
    expect(screen.getByText(/Read only|Chỉ đọc/)).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ }), { key: 'Insert' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('badge Draft issue số ít khi chỉ có đúng 1 lỗi (BUG-019)', () => {
    const document = golden()
    document.name = 'not a valid identifier' // vi phạm FBD-SCHEMA-ROOT-001, đúng 1 issue
    renderEditor(document)
    expect(screen.getByText('1 Draft issue')).toBeTruthy()
    expect(screen.queryByText('1 Draft issues')).toBeNull()
  })
})

describe('StructuredFbdEditor — Palette (WP-05)', () => {
  it('AC-FBD-003 / AC-FBD-005: thêm block từ palette (không chỉ AND) và Inspector cho phép đổi kiểu toán hạng', async () => {
    const { onChange } = renderEditor(golden())
    fireEvent.change(screen.getByLabelText(/^Block$|^Khối$/), { target: { value: 'OR' } })
    fireEvent.click(screen.getByRole('button', { name: /Add block|Thêm khối/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    let changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    expect(changed.networks[0].nodes.some((node) => node.typeRef === 'OR')).toBe(true)

    fireEvent.change(screen.getByLabelText(/^Block$|^Khối$/), { target: { value: 'ADD' } })
    fireEvent.click(screen.getByRole('button', { name: /Add block|Thêm khối/ }))
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2))
    changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    const addNode = changed.networks[0].nodes.find((node) => node.typeRef === 'ADD')
    expect(addNode?.ports.every((port) => port.dataType === 'REAL')).toBe(true)

    fireEvent.click(screen.getByText(`#${addNode!.executionOrder} · ADD`))
    fireEvent.change(screen.getByLabelText(/Operand type|Kiểu toán hạng/), { target: { value: 'DINT' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$|^Lưu$/ }))
    await waitFor(() => {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
      expect(last.networks[0].nodes.find((node) => node.id === addNode!.id)?.ports.every((port) => port.dataType === 'DINT')).toBe(true)
    })
  })

  it('cảnh báo PID chưa Controls+Safety review hiện trong palette', () => {
    renderEditor(golden())
    fireEvent.change(screen.getByLabelText(/^Block$|^Khối$/), { target: { value: 'PID' } })
    expect(screen.getByText(/Controls\+Safety review/)).toBeTruthy()
  })

  it('tạo INPUT mới qua form và đổi được biến/đơn vị qua Inspector', async () => {
    const { onChange } = renderEditor(golden())
    fireEvent.click(screen.getByRole('button', { name: /^Input$/ }))
    fireEvent.change(screen.getByLabelText(/Variable name|Tên biến/), { target: { value: 'SETPOINT' } })
    fireEvent.change(screen.getByLabelText(/^Type$|^Kiểu$/), { target: { value: 'REAL' } })
    fireEvent.change(screen.getByLabelText(/Unit \(optional\)|Đơn vị \(tuỳ chọn\)/), { target: { value: 'degC' } })
    fireEvent.click(screen.getByRole('button', { name: /^Create$|^Tạo$/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    const created = changed.networks[0].nodes.find((node) => node.parameters.variable === 'SETPOINT')
    expect(created?.kind).toBe('INPUT')
    expect(created?.typeRef).toBe('REAL')
    expect(created?.ports[0].unit).toBe('degC')
  })

  it('từ chối tên biến INPUT không hợp lệ, không tạo node', () => {
    const { onChange } = renderEditor(golden())
    fireEvent.click(screen.getByRole('button', { name: /^Input$/ }))
    fireEvent.change(screen.getByLabelText(/Variable name|Tên biến/), { target: { value: '1-bad' } })
    fireEvent.click(screen.getByRole('button', { name: /^Create$|^Tạo$/ }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Invalid variable name|Tên biến không hợp lệ/)).toBeTruthy()
  })

  it('tạo CONSTANT REAL mới qua form', async () => {
    const { onChange } = renderEditor(golden())
    fireEvent.click(screen.getByRole('button', { name: /^Constant$/ }))
    fireEvent.change(screen.getAllByLabelText(/^Type$|^Kiểu$/)[0], { target: { value: 'REAL' } })
    fireEvent.change(screen.getByLabelText(/^Value$|^Giá trị$/), { target: { value: '21.5' } })
    fireEvent.click(screen.getByRole('button', { name: /^Create$|^Tạo$/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    const created = changed.networks[0].nodes.find((node) => node.kind === 'CONSTANT')
    expect(created?.typeRef).toBe('REAL')
    expect(created?.parameters.value).toBe(21.5)
  })

  it('Inspector FUNCTION_BLOCK cho sửa instance + RETAIN', async () => {
    const document = golden()
    document.networks[0].nodes.push({
      id: '20000000-0000-4000-8000-0000000000f9', kind: 'FUNCTION_BLOCK', typeRef: 'TON', executionOrder: 4, parameters: {},
      ports: [
        { id: '20000000-0000-4000-8000-0000000000fa', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 },
        { id: '20000000-0000-4000-8000-0000000000fb', name: 'PT', direction: 'INPUT', dataType: 'TIME', unit: null, order: 1 },
        { id: '20000000-0000-4000-8000-0000000000fc', name: 'Q', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
        { id: '20000000-0000-4000-8000-0000000000fd', name: 'ET', direction: 'OUTPUT', dataType: 'TIME', unit: null, order: 3 },
      ],
    })
    const { onChange } = renderEditor(document)
    fireEvent.click(screen.getByText('#4 · TON'))
    fireEvent.change(screen.getByLabelText(/Instance name|Tên instance/), { target: { value: 'FanDelay' } })
    fireEvent.click(screen.getByLabelText(/RETAIN/))
    fireEvent.click(screen.getByRole('button', { name: /^Save$|^Lưu$/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    const fb = changed.networks[0].nodes.find((node) => node.typeRef === 'TON')
    expect(fb?.parameters).toEqual({ instance: 'FanDelay', retained: true })
  })
})

describe('StructuredFbdEditor — POU và keyboard/a11y (T59-506)', () => {
  const blend: UserPouInterface = {
    name: 'Blend',
    kind: 'FUNCTION',
    inputs: [
      { name: 'A', dataType: 'REAL' },
      { name: 'B', dataType: 'REAL' },
    ],
    returnType: 'REAL',
  }

  it('AC-FBD-003: đưa POU typed vào palette và Insert thêm đúng POU đang chọn bằng bàn phím', async () => {
    const onChange = vi.fn()
    renderEditor(golden(), true, onChange, [blend])
    const palette = screen.getByLabelText(/^Block$|^Khối$/)
    expect(screen.getByRole('option', { name: /Blend · FUNCTION/ })).toBeTruthy()
    fireEvent.change(palette, { target: { value: 'Blend' } })

    const editor = screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ })
    fireEvent.keyDown(editor, { key: 'Insert' })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    const node = changed.networks[0].nodes.find((candidate) => candidate.typeRef === 'Blend')
    expect(node?.kind).toBe('FUNCTION')
    expect(node?.ports.map((port) => `${port.direction}:${port.name}:${port.dataType}`)).toEqual([
      'INPUT:A:REAL', 'INPUT:B:REAL', 'OUTPUT:OUT:REAL',
    ])
  })

  it('Insert vẫn thêm block khi focus đang ở toolbar sau khi Tab tới editor', async () => {
    const onChange = vi.fn()
    renderEditor(golden(), true, onChange)
    const networkButton = screen.getByRole('button', { name: /^Network$/ })
    networkButton.focus()

    fireEvent.keyDown(networkButton, { key: 'Insert' })

    expect(document.activeElement).toBe(screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    expect(changed.networks[0].nodes).toHaveLength(golden().networks[0].nodes.length + 1)
  })

  it('AC-ST-010: interface POU lỗi không làm crash editor và được báo rõ thay vì sinh pin đoán', () => {
    renderEditor(golden(), true, vi.fn(), [{ ...blend, name: '1 bad POU' }])
    expect(screen.getByRole('status').textContent).toMatch(/POU không thể đưa vào palette|POUs are unavailable/)
    expect(screen.queryByRole('option', { name: /1 bad POU/ })).toBeNull()
  })

  it('TC-FBD-LIB-003: số trong nhãn bộ lọc cổng tương thích luôn bằng đúng số option thật trong DOM', () => {
    const document = golden()
    // Thêm một node INPUT kiểu REAL để có cổng REAL trên canvas bên cạnh các cổng BOOL sẵn có
    document.networks[0].nodes.push({
      id: '30000000-0000-4000-8000-000000000099',
      kind: 'INPUT',
      typeRef: 'REAL',
      executionOrder: 4,
      parameters: { variable: 'TEMP' },
      ports: [
        {
          id: '40000000-0000-4000-8000-000000000099',
          name: 'OUT',
          direction: 'OUTPUT',
          dataType: 'REAL',
          unit: 'degC',
          order: 0,
        },
      ],
    })

    renderEditor(document)

    function getFilterCount(): number {
      const label = screen.getByText(/Chỉ khối khớp cổng|Only blocks matching the/i)
      const match = label.textContent?.match(/\((\d+)\)/)
      if (!match) throw new Error('Không tìm thấy số đếm trong nhãn bộ lọc cổng')
      return parseInt(match[1], 10)
    }

    function getOptionCount(): number {
      const select = screen.getByLabelText(/^Block$|^Khối$/) as HTMLSelectElement
      return select.querySelectorAll('option').length
    }

    // 1. Chọn cổng BOOL
    const boolPort = screen.getAllByRole('button', { name: /OUTPUT OUT BOOL/ })[0]
    fireEvent.click(boolPort)

    const boolCheckbox = screen.getByRole('checkbox', {
      name: /Chỉ khối khớp cổng BOOL|Only blocks matching the BOOL port/i,
    })
    // Mặc định compatibleFilterOn khởi tạo là true
    expect(boolCheckbox).toBeChecked()
    const boolFilteredCount = getFilterCount()
    expect(boolFilteredCount).toBe(getOptionCount())

    // Tắt bộ lọc tương thích BOOL
    fireEvent.click(boolCheckbox)
    expect(boolCheckbox).not.toBeChecked()
    const allCountUnfiltered = getFilterCount()
    expect(allCountUnfiltered).toBe(getOptionCount())
    expect(allCountUnfiltered).toBeGreaterThan(boolFilteredCount)

    // Bật lại bộ lọc
    fireEvent.click(boolCheckbox)
    expect(boolCheckbox).toBeChecked()
    expect(getFilterCount()).toBe(getOptionCount())
    expect(getFilterCount()).toBe(boolFilteredCount)

    // 2. Chọn cổng REAL
    const realPort = screen.getByRole('button', { name: /REAL OUTPUT OUT REAL/i })
    fireEvent.click(realPort)

    const realCheckbox = screen.getByRole('checkbox', {
      name: /Chỉ khối khớp cổng REAL|Only blocks matching the REAL port/i,
    })
    expect(realCheckbox).toBeChecked()
    const realFilteredCount = getFilterCount()
    expect(realFilteredCount).toBe(getOptionCount())

    // Tắt bộ lọc tương thích REAL
    fireEvent.click(realCheckbox)
    expect(realCheckbox).not.toBeChecked()
    expect(getFilterCount()).toBe(getOptionCount())
    expect(getFilterCount()).toBe(allCountUnfiltered)

    // Bật lại bộ lọc REAL
    fireEvent.click(realCheckbox)
    expect(realCheckbox).toBeChecked()
    expect(getFilterCount()).toBe(getOptionCount())
    expect(getFilterCount()).toBe(realFilteredCount)
  })
})
