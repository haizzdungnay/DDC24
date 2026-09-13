import { describe, expect, it } from 'vitest'

import { buildFbdRuntimeOverlay, fbdNodeRuntimeName } from './runtimeOverlay'
import type { FbdDocument, FbdNode, FbdPort } from './model'
import type { StRuntimeOverlayItem, StRuntimeOverlayState } from '../design/editor/StRuntimeValueOverlay'

function port(id: string, name: string, direction: FbdPort['direction'], unit: string | null = null): FbdPort {
  return { id, name, direction, dataType: 'REAL', unit, order: 0 }
}

function node(partial: Partial<FbdNode> & Pick<FbdNode, 'id' | 'kind' | 'typeRef'>): FbdNode {
  return { executionOrder: 0, parameters: {}, ports: [], ...partial }
}

function documentWith(nodes: FbdNode[]): FbdDocument {
  return {
    $schema: '../../fbd_v1.schema.json',
    schemaVersion: 1,
    profileId: 'revA-1t-1-5-30',
    graphId: 'g',
    name: 'N',
    networks: [{ id: 'net', name: 'net', order: 0, nodes, wires: [] }],
  } as FbdDocument
}

function item(partial: Partial<StRuntimeOverlayItem> & Pick<StRuntimeOverlayItem, 'variableName'>): StRuntimeOverlayItem {
  return {
    variableId: partial.variableName,
    value: 1,
    valid: true,
    quality: 'GOOD',
    freshness: 'LIVE',
    ...partial,
  }
}

function ready(items: StRuntimeOverlayItem[]): StRuntimeOverlayState {
  return { status: 'ready', items }
}

const INPUT_NODE = node({
  id: 'n-in', kind: 'INPUT', typeRef: 'REAL',
  parameters: { variable: 'AI_Temp_SAT' },
  ports: [port('p-in-out', 'OUT', 'OUTPUT', '°C')],
})

const PID_NODE = node({
  id: 'n-pid', kind: 'FUNCTION_BLOCK', typeRef: 'PID',
  parameters: { instance: 'FB_PID_01' },
  ports: [port('p-pid-pv', 'PV', 'INPUT'), port('p-pid-out', 'OUT', 'OUTPUT', '%')],
})

describe('fbdNodeRuntimeName — danh tính runtime lấy từ TÀI LIỆU, không đoán', () => {
  it('đọc đúng khoá theo từng loại node', () => {
    expect(fbdNodeRuntimeName(INPUT_NODE)).toBe('AI_Temp_SAT')
    expect(fbdNodeRuntimeName(PID_NODE)).toBe('FB_PID_01')
    expect(fbdNodeRuntimeName(node({
      id: 'n-out', kind: 'OUTPUT', typeRef: 'BOOL', parameters: { variable: 'DO_Fan' },
    }))).toBe('DO_Fan')
  })

  it('hằng số và hàm thuần KHÔNG có danh tính runtime', () => {
    /* Hằng số đã mang giá trị trong chính tài liệu. Hỏi runtime về nó là mở
       đường cho hai con số khác nhau về cùng một hằng — và con số nào đúng thì
       người đọc không có cách nào biết. */
    expect(fbdNodeRuntimeName(node({ id: 'c', kind: 'CONSTANT', typeRef: 'REAL', parameters: { value: 1 } }))).toBeNull()
    expect(fbdNodeRuntimeName(node({ id: 'f', kind: 'FUNCTION', typeRef: 'ADD' }))).toBeNull()
  })

  it('tham số rỗng hoặc chỉ khoảng trắng KHÔNG thành danh tính', () => {
    expect(fbdNodeRuntimeName(node({ id: 'x', kind: 'INPUT', typeRef: 'REAL', parameters: { variable: '   ' } }))).toBeNull()
  })
})

describe('buildFbdRuntimeOverlay — fail-closed và ánh xạ theo danh tính', () => {
  it('overlay chưa sẵn sàng ⇒ null, không vẽ số nào', () => {
    /* `unavailable` là kết luận fail-closed khi Revision lệch hoặc dấu producer
       không đọc được — tức "số này có thể không thuộc sơ đồ đang hiện". */
    const document = documentWith([INPUT_NODE])
    expect(buildFbdRuntimeOverlay(document, { status: 'loading' })).toBeNull()
    expect(buildFbdRuntimeOverlay(document, { status: 'unavailable' })).toBeNull()
    expect(buildFbdRuntimeOverlay(document, null)).toBeNull()
    expect(buildFbdRuntimeOverlay(document, undefined)).toBeNull()
  })

  it('không khớp được danh tính nào ⇒ null, KHÔNG trả bản đồ rỗng', () => {
    const overlay = buildFbdRuntimeOverlay(documentWith([INPUT_NODE]), ready([item({ variableName: 'BienKhac' })]))
    expect(overlay).toBeNull()
  })

  it('nút vào/ra khớp theo `parameters.variable`, giá trị gắn cả nút lẫn chân', () => {
    const overlay = buildFbdRuntimeOverlay(
      documentWith([INPUT_NODE]),
      ready([item({ variableName: 'AI_Temp_SAT', value: 23.4, unit: '°C' })]),
    )
    expect(overlay?.byNodeId.get('n-in')).toEqual({ display: '23.4', state: 'live', unit: '°C', name: 'AI_Temp_SAT' })
    expect(overlay?.byPortId.get('p-in-out')?.display).toBe('23.4')
  })

  it('khối hàm khớp theo `instance.PORT`, và giá trị đại diện là CHÂN RA', () => {
    const overlay = buildFbdRuntimeOverlay(
      documentWith([PID_NODE]),
      ready([
        item({ variableName: 'FB_PID_01.PV', value: 23.4, unit: '°C' }),
        item({ variableName: 'FB_PID_01.OUT', value: 42.3, unit: '%' }),
      ]),
    )
    expect(overlay?.byPortId.get('p-pid-pv')?.display).toBe('23.4')
    expect(overlay?.byPortId.get('p-pid-out')?.display).toBe('42.3')
    /* Đại diện phải là ĐẦU RA: đó là câu trả lời cho "khối này đang cho ra bao
       nhiêu", chứ không phải giá trị nó đang nhận vào. */
    expect(overlay?.byNodeId.get('n-pid')?.display).toBe('42.3')
    expect(overlay?.byNodeId.get('n-pid')?.unit).toBe('%')
  })

  it('không có chân ra nào khớp ⇒ khối không có giá trị đại diện, nhưng chân vào vẫn có', () => {
    const overlay = buildFbdRuntimeOverlay(
      documentWith([PID_NODE]),
      ready([item({ variableName: 'FB_PID_01.PV', value: 23.4 })]),
    )
    expect(overlay?.byNodeId.has('n-pid')).toBe(false)
    expect(overlay?.byPortId.get('p-pid-pv')?.display).toBe('23.4')
  })

  it('giá trị không hợp lệ hiện `—` và BỎ đơn vị', () => {
    /* `— °C` đọc như một phép đo bằng không độ C. Nó không phải phép đo nào cả. */
    const overlay = buildFbdRuntimeOverlay(
      documentWith([INPUT_NODE]),
      ready([item({ variableName: 'AI_Temp_SAT', value: 0, valid: false, unit: '°C' })]),
    )
    expect(overlay?.byNodeId.get('n-in')).toEqual({ display: '—', state: 'invalid', unit: null, name: 'AI_Temp_SAT' })
  })

  it('BAD/OFFLINE không bao giờ thành 0', () => {
    for (const quality of ['BAD', 'OFFLINE', 'UNKNOWN'] as const) {
      const overlay = buildFbdRuntimeOverlay(
        documentWith([INPUT_NODE]),
        ready([item({ variableName: 'AI_Temp_SAT', value: 0, quality })]),
      )
      expect(overlay?.byNodeId.get('n-in')?.display).toBe('—')
    }
  })

  it('STALE giữ giá trị cuối cùng nhưng đổi trạng thái', () => {
    const overlay = buildFbdRuntimeOverlay(
      documentWith([INPUT_NODE]),
      ready([item({ variableName: 'AI_Temp_SAT', value: 23.4, freshness: 'STALE' })]),
    )
    expect(overlay?.byNodeId.get('n-in')).toMatchObject({ display: '23.4', state: 'stale' })
  })

  it('BOOL hiện TRUE/FALSE chứ không phải 1/0', () => {
    const overlay = buildFbdRuntimeOverlay(
      documentWith([node({
        id: 'n-do', kind: 'OUTPUT', typeRef: 'BOOL',
        parameters: { variable: 'DO_Fan_Supply' },
        ports: [port('p-do', 'IN', 'INPUT')],
      })]),
      ready([item({ variableName: 'DO_Fan_Supply', value: true })]),
    )
    expect(overlay?.byNodeId.get('n-do')?.display).toBe('TRUE')
  })

  it('trùng tên biến thì chọn TẤT ĐỊNH bản đầu tiên', () => {
    /* Danh sách vào đã được sắp xếp tất định ở `runtimeOverlayByProgramId`, nên
       "bản đầu tiên" là một quy tắc lặp lại được — khác hẳn "bản nào cũng được". */
    const overlay = buildFbdRuntimeOverlay(
      documentWith([INPUT_NODE]),
      ready([
        item({ variableId: 'a', variableName: 'AI_Temp_SAT', value: 1 }),
        item({ variableId: 'b', variableName: 'AI_Temp_SAT', value: 2 }),
      ]),
    )
    expect(overlay?.byNodeId.get('n-in')?.display).toBe('1')
  })
})
