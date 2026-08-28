import { describe, expect, it } from 'vitest'
import {
  inspectorContextFor,
  inspectorHasUsefulContext,
  type InspectorInput,
} from './inspectorContext'
import type { CatalogEntry } from '../library/libraryCatalog'
import type { FbdDocument } from '../../fbd/model'
import type { StRuntimeOverlayState } from '../editor/StRuntimeValueOverlay'
import type { ProgrammingProgram } from '../../model/types'

/**
 * `TC-PGM02-INS-01/02/03`.
 *
 * Điều được kiểm ở đây không phải "hiện đúng chữ" mà là **biết khi nào mình
 * không biết**. Một Inspector đoán kiểu hoặc đoán chữ ký còn tệ hơn một
 * Inspector trống: người đọc không phân biệt được suy đoán với sự thật, rồi sửa
 * chương trình dựa trên suy đoán đó.
 */

const program: ProgrammingProgram = {
  programId: 'p-1', name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM AHU_MAIN\nEND_PROGRAM\n',
}

const catalog: CatalogEntry[] = [
  {
    entryId: 'sys-ton', scope: 'SYSTEM', kind: 'FUNCTION_BLOCK', name: 'TON',
    labelVi: 'TON', labelEn: 'TON', category: 'timer', libraryVersion: 'rev-a.3',
    contentSha256: 'a'.repeat(64), usability: { kind: 'AVAILABLE' },
    ports: [
      { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
      { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
    ],
    allowedTypes: [], stateful: true,
  },
  {
    entryId: 'sys-pid', scope: 'SYSTEM', kind: 'FUNCTION_BLOCK', name: 'PID',
    labelVi: 'PID', labelEn: 'PID', category: 'control', libraryVersion: 'rev-a.3',
    contentSha256: 'b'.repeat(64), usability: { kind: 'SIGNATURE_UNAVAILABLE' },
    ports: [], allowedTypes: [], stateful: true,
  },
]

function fbdDocument(): FbdDocument {
  return {
    schemaVersion: 2,
    networks: [{
      id: 'net-1', name: 'Net 1',
      nodes: [{
        id: 'node-ton-1', kind: 'FUNCTION_BLOCK', typeRef: 'TON', executionOrder: 1,
        parameters: { PT: 'T#5s', ENABLE: true },
        ports: [
          { id: 'port-in', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 },
          { id: 'port-pt', name: 'PT', direction: 'INPUT', dataType: 'TIME', unit: null, order: 1 },
          { id: 'port-q', name: 'Q', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
        ],
      }],
      wires: [{
        id: 'wire-1',
        from: { nodeId: 'node-ton-1', portId: 'port-q' },
        to: { nodeId: 'node-ton-1', portId: 'port-in' },
      }],
    }],
    layout: { nodes: {} },
  } as unknown as FbdDocument
}

const readyRuntime: StRuntimeOverlayState = {
  status: 'ready',
  items: [
    { variableId: 'v-1', variableName: 'Fan', value: true, valid: true, quality: 'GOOD', freshness: 'LIVE' },
    { variableId: 'v-2', variableName: 'Stale', value: 3, valid: true, quality: 'STALE', freshness: 'STALE' },
  ],
}

function contextFor(overrides: InspectorInput) {
  return inspectorContextFor(overrides)
}

describe('TC-PGM02-INS-01 — ngữ cảnh Program và ký hiệu ST', () => {
  it('không có gì đang mở ⇒ EMPTY, và Inspector không đáng chiếm chỗ', () => {
    const context = contextFor({})
    expect(context.kind).toBe('EMPTY')
    expect(inspectorHasUsefulContext(context)).toBe(false)
  })

  it('Program chỉ có tên và loại thì CHƯA đáng một khay riêng', () => {
    // Đây đúng hiện trạng mà `F-PGM02-AUD-001` chỉ ra: hai trường chiếm 300px.
    const context = contextFor({ program: { ...program, language: undefined as never } })
    expect(context.kind).toBe('PROGRAM')
    expect(inspectorHasUsefulContext(context)).toBe(false)
  })

  it('Program có chu kỳ/Enable ⇒ đủ nội dung, và chu kỳ KHÔNG bị đoán', () => {
    const context = contextFor({ program, cycleMs: 5000, enabled: true })
    if (context.kind !== 'PROGRAM') throw new Error('sai ngữ cảnh')
    expect(context.name).toEqual({ known: true, value: 'AHU_MAIN' })
    expect(context.cycleMs).toEqual({ known: true, value: 5000 })
    expect(context.enabled).toEqual({ known: true, value: true })
    expect(inspectorHasUsefulContext(context)).toBe(true)

    // Thiếu chu kỳ ⇒ `unknown`, tuyệt đối không mặc định 1000 ms.
    const noCycle = contextFor({ program, enabled: false })
    if (noCycle.kind !== 'PROGRAM') throw new Error('sai ngữ cảnh')
    expect(noCycle.cycleMs.known).toBe(false)
  })

  it('ký hiệu ST tra được: Definition/Type/References từ chỉ mục thật', () => {
    const context = contextFor({
      program,
      cursorSymbol: {
        identifier: 'Fan', start: 10, end: 13,
        entry: {
          name: 'Fan', typeName: 'BOOL', kind: 'VARIABLE', declarationOffset: 42,
          occurrences: [{ offset: 42, role: 'WRITE' }, { offset: 80, role: 'READ' }],
        },
      },
      runtime: readyRuntime,
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.dataType).toEqual({ known: true, value: 'BOOL' })
    expect(context.definitionOffset).toEqual({ known: true, value: 42 })
    expect(context.referenceCount).toEqual({ known: true, value: 2 })
    expect(context.runtime.status).toBe('ready')
    expect(context.runtime.item?.value).toBe(true)
  })

  it('analyzer KHÔNG tra được ⇒ mọi trường suy diễn đều unknown, cấm đoán', () => {
    const context = contextFor({
      program,
      cursorSymbol: { identifier: 'KhongRoLaGi', start: 0, end: 11, entry: null },
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.identifier).toBe('KhongRoLaGi')
    expect(context.dataType.known).toBe(false)
    expect(context.definitionOffset.known).toBe(false)
    expect(context.signature.known).toBe(false)
    expect(context.referenceCount.known).toBe(false)
    // Không có mẫu runtime ⇒ unavailable, KHÔNG phải 0.
    expect(context.runtime.status).toBe('unavailable')
    expect(context.runtime.item).toBeNull()
  })

  it('chữ ký lấy từ thư viện; thư viện nói không đọc được thì KHÔNG dựng thay', () => {
    const withSignature = contextFor({
      catalog,
      cursorSymbol: {
        identifier: 'dly', start: 0, end: 3,
        entry: { name: 'dly', typeName: 'TON', kind: 'FB_INSTANCE', declarationOffset: 5, occurrences: [] },
      },
    })
    if (withSignature.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(withSignature.signature).toEqual({
      known: true, value: 'TON(IN BOOL, PT TIME) → Q BOOL',
    })

    // `SIGNATURE_UNAVAILABLE`: backend nói thẳng nó không đọc được chữ ký.
    // Dựng chữ ký từ tên port ở FE là bịa ra một hợp đồng.
    const unavailable = contextFor({
      catalog,
      cursorSymbol: {
        identifier: 'loop', start: 0, end: 4,
        entry: { name: 'loop', typeName: 'PID', kind: 'FB_INSTANCE', declarationOffset: 5, occurrences: [] },
      },
    })
    if (unavailable.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(unavailable.signature.known).toBe(false)

    // Type không có trong thư viện cũng là `unknown`, không phải chuỗi rỗng.
    const missing = contextFor({
      catalog,
      cursorSymbol: {
        identifier: 'x', start: 0, end: 1,
        entry: { name: 'x', typeName: 'KHONG_CO', kind: 'FB_INSTANCE', declarationOffset: 5, occurrences: [] },
      },
    })
    if (missing.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(missing.signature.known).toBe(false)
  })
})

describe('TC-PGM02-INS-02 — ngữ cảnh FBD block và connection', () => {
  it('block giữ nguyên nodeId/portId và THỨ TỰ port đã khai', () => {
    const context = contextFor({
      catalog,
      fbd: { document: fbdDocument(), selection: { kind: 'node', networkId: 'net-1', nodeId: 'node-ton-1' } },
    })
    if (context.kind !== 'FBD_BLOCK') throw new Error('sai ngữ cảnh')
    expect(context.instanceId).toBe('node-ton-1')
    expect(context.typeRef).toBe('TON')
    // Sắp lại theo tên sẽ làm Inspector không còn khớp sơ đồ trên canvas.
    expect(context.ports.map((port) => port.name)).toEqual(['IN', 'PT', 'Q'])
    expect(context.ports.map((port) => port.portId)).toEqual(['port-in', 'port-pt', 'port-q'])
    expect(context.parameters).toEqual([
      { name: 'PT', value: 'T#5s' },
      { name: 'ENABLE', value: 'TRUE' },
    ])
    expect(context.signature.known).toBe(true)
  })

  it('retained là UNKNOWN — model chưa mang cờ đó, và false là một câu khác hẳn', () => {
    const context = contextFor({
      fbd: { document: fbdDocument(), selection: { kind: 'node', networkId: 'net-1', nodeId: 'node-ton-1' } },
    })
    if (context.kind !== 'FBD_BLOCK') throw new Error('sai ngữ cảnh')
    expect(context.retained.known).toBe(false)
  })

  it('chọn một PORT vẫn cho ngữ cảnh block chứa port đó', () => {
    const context = contextFor({
      fbd: {
        document: fbdDocument(),
        selection: { kind: 'port', networkId: 'net-1', nodeId: 'node-ton-1', portId: 'port-q' },
      },
    })
    expect(context.kind).toBe('FBD_BLOCK')
  })

  it('connection giữ nguyên wireId và hai đầu nối, kiểu lấy từ port nguồn', () => {
    const context = contextFor({
      fbd: { document: fbdDocument(), selection: { kind: 'wire', networkId: 'net-1', wireId: 'wire-1' } },
    })
    if (context.kind !== 'FBD_CONNECTION') throw new Error('sai ngữ cảnh')
    expect(context.wireId).toBe('wire-1')
    expect(context.source).toEqual({
      known: true, value: { nodeId: 'node-ton-1', portId: 'port-q', portName: 'Q' },
    })
    expect(context.destination).toEqual({
      known: true, value: { nodeId: 'node-ton-1', portId: 'port-in', portName: 'IN' },
    })
    expect(context.dataType).toEqual({ known: true, value: 'BOOL' })
  })

  it('lựa chọn FBD được ưu tiên hơn con trỏ ST — đó là thứ người dùng vừa chạm', () => {
    const context = contextFor({
      program,
      cursorSymbol: { identifier: 'Fan', start: 0, end: 3, entry: null },
      fbd: { document: fbdDocument(), selection: { kind: 'node', networkId: 'net-1', nodeId: 'node-ton-1' } },
    })
    expect(context.kind).toBe('FBD_BLOCK')
  })

  it('lựa chọn trỏ tới node/wire không tồn tại ⇒ không dựng ngữ cảnh giả', () => {
    const node = contextFor({
      program,
      fbd: { document: fbdDocument(), selection: { kind: 'node', networkId: 'net-1', nodeId: 'khong-co' } },
    })
    expect(node.kind).toBe('PROGRAM')
    const wire = contextFor({
      fbd: { document: fbdDocument(), selection: { kind: 'wire', networkId: 'net-1', wireId: 'khong-co' } },
    })
    expect(wire.kind).toBe('EMPTY')
  })
})

describe('TC-PGM02-INS-03 — giá trị LIVE/SIM trong Inspector', () => {
  it('dùng đúng value tuple của mode, mẫu cũ giữ nhãn của nó', () => {
    const context = contextFor({
      cursorSymbol: {
        identifier: 'Stale', start: 0, end: 5,
        entry: { name: 'Stale', typeName: 'INT', kind: 'VARIABLE', declarationOffset: 1, occurrences: [] },
      },
      runtime: readyRuntime,
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.runtime.item?.freshness).toBe('STALE')
    expect(context.runtime.item?.quality).toBe('STALE')
  })

  it('overlay chưa sẵn sàng ⇒ unavailable ở mọi ngữ cảnh, không bao giờ là 0', () => {
    for (const state of [
      { status: 'loading' } as StRuntimeOverlayState,
      { status: 'unavailable', reason: 'mất kết nối' } as StRuntimeOverlayState,
    ]) {
      const context = contextFor({
        cursorSymbol: {
          identifier: 'Fan', start: 0, end: 3,
          entry: { name: 'Fan', typeName: 'BOOL', kind: 'VARIABLE', declarationOffset: 1, occurrences: [] },
        },
        runtime: state,
      })
      if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
      expect(context.runtime.status).toBe('unavailable')
      expect(context.runtime.item).toBeNull()
    }
  })
})

describe('UD-PROG-015 — ba trường trong ảnh KHÔNG có nguồn dữ liệu', () => {
  it('kiểu dữ liệu của Inspector không hề có Access/Description/tên Task', () => {
    const context = contextFor({ program, cycleMs: 1000, enabled: true })
    const keys = Object.keys(context)
    // Không chỉ là "không render": chúng không tồn tại trong kiểu, nên không có
    // đường nào một bản sửa sau này điền `"Public"` cho giống ảnh.
    expect(keys).not.toContain('access')
    expect(keys).not.toContain('description')
    expect(keys).not.toContain('taskName')
    expect(JSON.stringify(context)).not.toContain('Public')
    expect(JSON.stringify(context)).not.toContain('Control_Main')
  })
})
