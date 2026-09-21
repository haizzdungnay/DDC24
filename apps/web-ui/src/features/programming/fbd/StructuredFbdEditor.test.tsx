import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useState } from 'react'
import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { I18nProvider, useI18n } from '../../../shared/i18n'
import { StructuredFbdEditor } from './StructuredFbdEditor'
import { FbdNodeInspector } from './FbdNodeInspector'
import { buildFbdNetworkGeometry } from './geometry'
import type { FbdNodeEditorTarget } from './nodeEditor'
import type { FbdDocument } from './model'
import type { UserPouInterface } from './userPou'
import type { ProgrammingDiagnostic } from '../model/types'

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

  it('Ctrl+A/C/V sao chép cả subgraph, Backspace xóa và Ctrl+Z hoàn tác', () => {
    renderEditor(golden())
    const editor = screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ })

    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'v', ctrlKey: true })

    expect(screen.getByTestId('fbd-block-count')).toHaveTextContent('8/256')
    expect(screen.getByTestId('fbd-wire-count')).toHaveTextContent('6/512')

    fireEvent.keyDown(editor, { key: 'Backspace' })
    expect(screen.getByTestId('fbd-block-count')).toHaveTextContent('4/256')
    expect(screen.getByTestId('fbd-wire-count')).toHaveTextContent('3/512')

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })
    expect(screen.getByTestId('fbd-block-count')).toHaveTextContent('8/256')
    expect(screen.getByTestId('fbd-wire-count')).toHaveTextContent('6/512')
  })

  it('Ctrl+D nhân đôi khối đang chọn và Shift+mũi tên dịch khối theo lưới', async () => {
    const document = golden()
    const andNode = document.networks[0].nodes.find((node) => node.typeRef === 'AND')!
    const beforeX = buildFbdNetworkGeometry(document.networks[0], document.layout).byNodeId.get(andNode.id)!.x
    const { onChange } = renderEditor(document)
    const editor = screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ })

    fireEvent.click(screen.getByRole('button', { name: /#2 · AND/ }))
    fireEvent.keyDown(editor, { key: 'ArrowRight', shiftKey: true })
    await waitFor(() => {
      const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
      expect(changed.layout?.nodes[andNode.id].x).toBe(beforeX + 8)
    })

    fireEvent.keyDown(editor, { key: 'd', ctrlKey: true })
    expect(screen.getByTestId('fbd-block-count')).toHaveTextContent('5/256')
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

    /* Chọn theo TÊN TRỢ NĂNG của khối, không theo chuỗi hiển thị. Nhãn vẽ trên
       khối nay tách danh tính (`ADD`) khỏi thứ tự thực thi (`#5`) — xem
       `fbdNodeIdentity` — nên một phép chọn bám chuỗi ghép sẽ đỏ mỗi lần thiết
       kế đổi cách trình bày, dù hành vi không đổi. `aria-label` mới là hợp đồng. */
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^#${addNode!.executionOrder} · ADD · FUNCTION`) }))
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
    fireEvent.click(screen.getByRole('button', { name: /^#4 · TON · FUNCTION_BLOCK/ }))
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
    /* `#674` bỏ hẳn nút "Network"; "Thêm khối" là nút toolbar tương đương để
       chứng minh focus quay về vùng editor sau khi Insert từ toolbar. */
    const addBlockButton = screen.getByRole('button', { name: /Thêm khối|Add block/ })
    addBlockButton.focus()

    fireEvent.keyDown(addBlockButton, { key: 'Insert' })

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

/**
 * `ISS-FBD-ECHO-001` — vòng công bố editor ⇄ buffer của trang.
 *
 * Editor phát `onChange(document)`; trang chỉ giữ chuỗi ấy rồi trả lại qua prop
 * `document`. Vòng đó KHÔNG tức thời: passive effect của React chạy sau commit,
 * nên khi thao tác tới nhanh hơn một vòng effect (Insert liên tiếp, kéo node),
 * cái quay về là bản CŨ HƠN state hiện tại. `REPLACE_DOCUMENT` vốn nhận vô điều
 * kiện, nên bản cũ ghi đè và các block vừa thêm biến mất — không báo lỗi, không
 * dấu vết. Triệu chứng ngoài đời là `TC-FBD-NAV-001` chập chờn (25 lần Insert
 * chỉ còn 16-22 block, ~20% số lần chạy dưới `--workers=4`); nhưng đây là lỗi
 * MẤT DỮ LIỆU của sản phẩm chứ không phải lỗi của test.
 *
 * Hai chiều phải giữ cùng lúc: tiếng vọng của chính mình thì bỏ qua, còn thay
 * đổi thật từ bên ngoài (Làm mới, đổi POU, draft đồng bộ) thì vẫn phải áp dụng
 * ngay — nếu chỉ khoá cứng prop `document` thì Làm mới sẽ chết lặng.
 */
describe('StructuredFbdEditor — tiếng vọng trễ của buffer trang', () => {
  function blockBadge(): string {
    /* Bám `data-testid`, KHÔNG bám câu chữ. Chip này từng đọc là `10/256 block`;
       bỏ chữ `block` để thanh công cụ gọn lại đã làm đỏ năm phép đo vốn chỉ cần
       một mỏ neo ổn định — mà câu chữ hiển thị thì không phải mỏ neo ổn định,
       nó là thứ thiết kế được phép đổi. Nhãn cho trình đọc màn hình vẫn còn
       (`sr-only`), và chính nó mới là hợp đồng trợ năng. */
    /* Lấy đúng phần `N/256`. `textContent` còn kèm nhãn `sr-only` (`Khối` /
       `Blocks`) — nhãn ấy là hợp đồng trợ năng nên phải có, nhưng nó không phải
       thứ phép đo này quan tâm. */
    const text = screen.getByTestId('fbd-block-count').textContent ?? ''
    return text.match(/\d+\/256/)?.[0] ?? text.trim()
  }

  it('bản CŨ HƠN do chính editor phát ra không được xoá block vừa thêm', () => {
    const published: FbdDocument[] = []
    const view = (doc: FbdDocument) => (
      <I18nProvider>
        <StructuredFbdEditor document={doc} canEdit onChange={(next) => published.push(next)} />
      </I18nProvider>
    )
    const { rerender } = render(view(golden()))
    const editor = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })
    const before = Number(blockBadge().split('/')[0])

    fireEvent.keyDown(editor, { key: 'Insert' })
    fireEvent.keyDown(editor, { key: 'Insert' })
    expect(published).toHaveLength(2)
    expect(blockBadge()).toBe(`${before + 2}/256`)

    // Trang mới kịp trả lại bản 1 block; editor đã đi trước một bước.
    rerender(view(published[0]))
    expect(blockBadge()).toBe(`${before + 2}/256`)
  })

  it('prop dựng lại cùng nội dung (object mới) không được cuốn theo phím đầu tiên', () => {
    /* Ngay sau khi tạo POU, draft refetch dựng lại đúng tài liệu ấy thành một
     * object khác. Effect chạy theo identity của prop, nên nếu không so nội
     * dung thì `REPLACE_DOCUMENT` cuốn theo thao tác vừa làm mà chưa kịp đi hết
     * một vòng buffer — đúng triệu chứng badge tụt về `0/256` sau phím đầu. */
    const base = golden()
    const view = (doc: FbdDocument) => (
      <I18nProvider>
        <StructuredFbdEditor document={doc} canEdit onChange={() => undefined} />
      </I18nProvider>
    )
    const { rerender } = render(view(base))
    const editor = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })
    const before = Number(blockBadge().split('/')[0])
    fireEvent.keyDown(editor, { key: 'Insert' })
    expect(blockBadge()).toBe(`${before + 1}/256`)

    rerender(view(JSON.parse(JSON.stringify(base)) as FbdDocument))
    expect(blockBadge()).toBe(`${before + 1}/256`)
  })

  it('gợi ý `activeNetworkId` lạc hậu không được nuốt lệnh Thêm block', () => {
    /* `FbdEditorPane` sửa `activeNetworkId` bằng passive effect nên nó đi sau
     * tài liệu đúng một commit. Trong cửa sổ đó gợi ý trỏ một network không còn
     * tồn tại; tin nó vô điều kiện thì `ADD_BLOCK` rơi vào nhánh `action = null`
     * và phím bị nuốt lặng lẽ. */
    render(
      <I18nProvider>
        <StructuredFbdEditor
          document={golden()}
          canEdit
          onChange={() => undefined}
          activeNetworkId="00000000-0000-4000-8000-00000000dead"
        />
      </I18nProvider>,
    )
    const editor = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })
    const before = Number(blockBadge().split('/')[0])
    fireEvent.keyDown(editor, { key: 'Insert' })
    expect(blockBadge()).toBe(`${before + 1}/256`)
  })

  it('tài liệu THẬT từ bên ngoài vẫn thay thế được state đang gõ', () => {
    const published: FbdDocument[] = []
    const view = (doc: FbdDocument) => (
      <I18nProvider>
        <StructuredFbdEditor document={doc} canEdit onChange={(next) => published.push(next)} />
      </I18nProvider>
    )
    const { rerender } = render(view(golden()))
    const editor = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })
    fireEvent.keyDown(editor, { key: 'Insert' })
    expect(published).toHaveLength(1)

    // Làm mới: nguồn canonical trở lại, không phải thứ editor từng phát ra.
    const fresh = golden()
    fresh.networks[0].nodes = fresh.networks[0].nodes.slice(0, 1)
    rerender(view(fresh))
    expect(blockBadge()).toBe('1/256')
  })

  /* `#674` — FBD chốt mô hình MỘT canvas. Ba phép kiểm dưới đây khoá hợp đồng
   * mới ở đúng ba mặt: thanh công cụ không còn mời gọi nhiều Network, phím tắt
   * còn trong contract không lặng lẽ tạo Network thứ hai, và tài liệu của mô
   * hình cũ mở được mà không ghi gì. */

  it('AC-674-2: thanh công cụ không còn badge network, badge `Network đang mở` hay nút thêm Network', () => {
    renderEditor(golden())
    expect(screen.queryByTestId('fbd-active-network')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Network$/ })).toBeNull()
    expect(screen.queryByText(/\/256 network/)).toBeNull()
    // Badge block/wire là số đo của chính canvas nên phải còn nguyên.
    expect(screen.getByTestId('fbd-block-count')).toBeInTheDocument()
    expect(screen.getByTestId('fbd-wire-count')).toBeInTheDocument()
  })

  it('AC-674-2: `Control+Shift+n` nói rõ mô hình một canvas thay vì thêm Network', () => {
    const onChange = vi.fn()
    renderEditor(golden(), true, onChange)
    const editor = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })

    fireEvent.keyDown(editor, { key: 'N', ctrlKey: true, shiftKey: true })

    expect(screen.getByText(/FBD dùng mô hình một canvas|single-canvas model/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('AC-674-4: tài liệu nhiều Network mở chỉ đọc kèm lý do và KHÔNG phát mutation nào', () => {
    const legacy = golden()
    legacy.networks.push({
      id: '90000000-0000-4000-8000-000000000002',
      name: 'NETWORK_2',
      order: 1,
      nodes: [],
      wires: [],
    })
    const onChange = vi.fn()
    renderEditor(legacy, true, onChange)

    // Lý do phải đọc được, không chỉ là một nút bị mờ đi.
    const notice = screen.getByTestId('fbd-multi-network-lock')
    expect(notice).toHaveTextContent(/2 Network|2 networks/)
    expect(notice).toHaveTextContent(/chỉ đọc|read-only/)
    expect(notice).toHaveTextContent(/không Network nào bị xóa hay gộp|no network is deleted or merged/)
    expect(screen.getByText(/Chỉ đọc|Read only/)).toBeInTheDocument()

    // Mọi đường sửa đều đóng: nút toolbar, phím tắt thêm block, phím xóa.
    expect(screen.getByRole('button', { name: /Thêm khối|Add block/ })).toBeDisabled()
    const editor = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })
    fireEvent.keyDown(editor, { key: 'Insert' })
    fireEvent.keyDown(editor, { key: 'N', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(editor, { key: 'Delete' })

    // 0 mutation: hợp đồng của AC-4 là số lần gọi, không phải câu chữ trên màn hình.
    expect(onChange).not.toHaveBeenCalled()
    // Và dữ liệu người dùng còn nguyên: không gộp, không xóa Network thừa.
    expect(legacy.networks).toHaveLength(2)
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })
})

describe('StructuredFbdEditor — TC-FBD-HEADER-003: Chẩn đoán stale trên Canvas', () => {
  it('chẩn đoán cũ (STALE) hiển thị marker stale và aria-label STALE DIAGNOSTIC', () => {
    const doc = golden()
    const targetNode = doc.networks[0].nodes[0]
    const pouId = 'P_ahu'
    const diagnostic: ProgrammingDiagnostic = {
      code: 'PRG-ERR-CHECK-001',
      detailCode: 'FBD-SEM-001',
      severity: 'ERROR',
      message: 'signal mismatch',
      messageKey: 'programming.error.check',
      location: {
        programId: pouId,
        pouId,
        revisionId: 'rev-1',
        nodeId: targetNode.id,
        sourceSha256: 'old-sha256',
        stLanguageProfileVersion: '1.0.0',
      },
    }

    render(
      <I18nProvider>
        <StructuredFbdEditor
          document={doc}
          canEdit
          onChange={() => undefined}
          diagnostics={[diagnostic]}
          openBuffer={{
            revisionId: 'rev-1',
            pouId,
            sourceSha256: 'new-sha256',
          }}
        />
      </I18nProvider>,
    )

    const staleMarker = document.querySelector(`[data-fbd-node-issue="stale"]`)
    expect(staleMarker).not.toBeNull()

    const nodeBtn = document.querySelector(`g[data-fbd-node-id="${targetNode.id}"] [role="button"]`)
    expect(nodeBtn?.getAttribute('aria-label')).toContain('STALE DIAGNOSTIC')
  })

  it('chẩn đoán mới (FRESH) hiển thị marker lỗi cảnh báo bình thường', () => {
    const doc = golden()
    const targetNode = doc.networks[0].nodes[0]
    const pouId = 'P_ahu'
    const diagnostic: ProgrammingDiagnostic = {
      code: 'PRG-ERR-CHECK-001',
      detailCode: 'FBD-SEM-001',
      severity: 'ERROR',
      message: 'signal mismatch',
      messageKey: 'programming.error.check',
      location: {
        programId: pouId,
        pouId,
        revisionId: 'rev-1',
        nodeId: targetNode.id,
        sourceSha256: 'matching-sha256',
        stLanguageProfileVersion: '1.0.0',
      },
    }

    render(
      <I18nProvider>
        <StructuredFbdEditor
          document={doc}
          canEdit
          onChange={() => undefined}
          diagnostics={[diagnostic]}
          openBuffer={{
            revisionId: 'rev-1',
            pouId,
            sourceSha256: 'matching-sha256',
          }}
        />
      </I18nProvider>,
    )

    const issueMarker = document.querySelector(`[data-fbd-node-issue="true"]`)
    expect(issueMarker).not.toBeNull()

    const staleMarker = document.querySelector(`[data-fbd-node-issue="stale"]`)
    expect(staleMarker).toBeNull()
  })
})
