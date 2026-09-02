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
    contentSha256: 'a'.repeat(64), usability: { kind: 'AVAILABLE' }, iecClassification: 'IEC_STANDARD',
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
    contentSha256: 'b'.repeat(64), usability: { kind: 'SIGNATURE_UNAVAILABLE' }, iecClassification: 'IEC_STANDARD',
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

describe('DEV-PROG-004 — Access/Description/tên Task đã có nguồn, nhưng vẫn cấm bịa', () => {
  // `UD-PROG-015` từng chốt: ba trường này KHÔNG được tồn tại trong kiểu, vì
  // Draft v2 không có nguồn cho chúng và một ô trống sẽ mời người sau điền
  // `"Public"` cho giống ảnh render. `DEV-PROG-004` đóng gap đó bằng nguồn
  // THẬT (`objects[].description`/`objects[].access`, `task.name`), nên điều
  // cần khẳng định đổi: trường có mặt, và khi Draft chưa ghi gì thì nó phải là
  // `unknown` — không bao giờ là một giá trị mặc định trông hợp lý.
  it('Draft chưa ghi chú thích ⇒ unknown, không phải chuỗi rỗng hay giá trị mẫu', () => {
    const context = contextFor({ program, cycleMs: 1000, enabled: true })
    if (context.kind !== 'PROGRAM') throw new Error('sai ngữ cảnh')
    expect(context.access.known).toBe(false)
    expect(context.description.known).toBe(false)
    expect(context.taskName.known).toBe(false)
    expect(JSON.stringify(context)).not.toContain('Public')
    expect(JSON.stringify(context)).not.toContain('Control_Main')
  })

  it('Draft CÓ chú thích ⇒ đi qua nguyên văn, không cắt và không chuẩn hoá thêm', () => {
    const context = contextFor({
      program: { ...program, description: 'Dòng một.\nDòng hai.', access: 'Kỹ sư vận hành' },
      cycleMs: 1000,
      taskName: 'Control_Main',
    })
    if (context.kind !== 'PROGRAM') throw new Error('sai ngữ cảnh')
    expect(context.description).toEqual({ known: true, value: 'Dòng một.\nDòng hai.' })
    expect(context.access).toEqual({ known: true, value: 'Kỹ sư vận hành' })
    expect(context.taskName).toEqual({ known: true, value: 'Control_Main' })
  })

  it('"chưa phân tích cổng" khác "POU không có cổng nào"', () => {
    // Gộp hai câu này là biến một phép đo chưa chạy thành một kết luận.
    const notAnalysed = contextFor({ program, cycleMs: 1000 })
    const analysedEmpty = contextFor({ program, cycleMs: 1000, parameters: [] })
    if (notAnalysed.kind !== 'PROGRAM' || analysedEmpty.kind !== 'PROGRAM') throw new Error('sai ngữ cảnh')
    expect(notAnalysed.parameters.known).toBe(false)
    expect(analysedEmpty).toMatchObject({ parameters: { known: true, value: [] } })
  })
  /* `ISS-STED-12` — năm trường mới. Điều được kiểm vẫn là nguyên tắc cũ của
   * module: biết khi nào mình KHÔNG biết. Năm trường này là chỗ dễ phá nguyên
   * tắc đó nhất, vì mỗi trường đều có một giá trị "trông hợp lý" để điền bừa:
   * `VAR` cho phạm vi, `0` cho khởi tạo, `—` cho điểm ánh xạ. */
  const stSymbol = {
    identifier: 'SupplyTemp', start: 10, end: 20,
    entry: {
      name: 'SupplyTemp', typeName: 'REAL', kind: 'VARIABLE' as const, declarationOffset: 42,
      occurrences: [
        { offset: 42, role: 'WRITE' as const },
        { offset: 80, role: 'READ' as const },
        { offset: 95, role: 'READ' as const },
      ],
    },
  }

  const supplyVariable = {
    variableId: 'var-supply', programId: 'program-1', name: 'SupplyTemp',
    type: 'REAL', class: 'INPUT' as const, initialValue: null, retain: false,
  }

  const supplyBinding = {
    bindingId: 'binding-supply', variableId: 'var-supply',
    point: { category: 'LOCAL' as const, pointId: 'UI-01' },
    direction: 'READ' as const, dataType: 'REAL', unit: 'degC',
    writable: false, qualityPolicy: 'REQUIRE_GOOD' as const,
  }

  it('Phạm vi/Điểm ánh xạ/Đơn vị lấy từ Draft, không dựng authority thứ hai', () => {
    const context = contextFor({
      program, cursorSymbol: stSymbol,
      variables: [supplyVariable], bindings: [supplyBinding],
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.scope).toEqual({ known: true, value: 'VAR_INPUT' })
    expect(context.mappedPoint).toEqual({ known: true, value: 'LOCAL/UI-01' })
    expect(context.unit).toEqual({ known: true, value: 'degC' })
  })

  it('điểm RTU kèm thiết bị — địa chỉ một mình không định danh được điểm nào', () => {
    const context = contextFor({
      program, cursorSymbol: stSymbol, variables: [supplyVariable],
      bindings: [{ ...supplyBinding, point: { category: 'MB_RTU', pointId: '40001', deviceId: 'dev-1' } }],
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.mappedPoint).toEqual({ known: true, value: 'MB_RTU/dev-1/40001' })
  })

  it('`retain` là cờ riêng, không phải một giá trị của `class`', () => {
    const context = contextFor({
      program, cursorSymbol: stSymbol,
      variables: [{ ...supplyVariable, class: 'LOCAL', retain: true }],
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    // Bỏ qua `retain` sẽ hiện `VAR` cho một biến giữ giá trị qua mất điện.
    expect(context.scope).toEqual({ known: true, value: 'VAR RETAIN' })
  })

  it('Khởi tạo nói rõ khi nó là mặc định của kiểu, không giả vờ ai đó đã đặt', () => {
    const context = contextFor({ program, cursorSymbol: stSymbol, variables: [supplyVariable] })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.initialValue).toEqual({ known: true, value: { text: '0.0', typeDefault: true } })

    const explicit = contextFor({
      program, cursorSymbol: stSymbol,
      variables: [{ ...supplyVariable, initialValue: 21.5 }],
    })
    if (explicit.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(explicit.initialValue).toEqual({ known: true, value: { text: '21.5', typeDefault: false } })
  })

  it('instance FB không có giá trị khởi tạo vô hướng ⇒ unknown, không bịa `0`', () => {
    const context = contextFor({
      program,
      cursorSymbol: {
        identifier: 'TON_1', start: 0, end: 5,
        entry: { name: 'TON_1', typeName: 'TON', kind: 'FB_INSTANCE', declarationOffset: 5, occurrences: [] },
      },
      variables: [{ ...supplyVariable, variableId: 'var-ton', name: 'TON_1', type: 'TON' }],
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.initialValue.known).toBe(false)
  })

  it('Đọc/Ghi đếm từ `occurrences.role`, không đếm lại bằng đường thứ hai', () => {
    const context = contextFor({ program, cursorSymbol: stSymbol })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.readWrite).toEqual({ known: true, value: { reads: 2, writes: 1 } })
    // Tổng vẫn phải khớp `referenceCount` — hai trường cùng một nguồn.
    expect(context.referenceCount).toEqual({ known: true, value: 3 })
  })

  it('biến chưa có trong Draft ⇒ Phạm vi/Điểm/Đơn vị đều unknown, KHÔNG đoán', () => {
    const context = contextFor({ program, cursorSymbol: stSymbol, variables: [], bindings: [] })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.scope.known).toBe(false)
    expect(context.mappedPoint.known).toBe(false)
    expect(context.unit.known).toBe(false)
    // Nhưng Đọc/Ghi vẫn biết được: nó đến từ chỉ mục văn bản, không từ Draft.
    expect(context.readWrite.known).toBe(true)
  })

  it('biến có trong Draft nhưng CHƯA ánh xạ ⇒ Điểm/Đơn vị unknown', () => {
    const context = contextFor({ program, cursorSymbol: stSymbol, variables: [supplyVariable], bindings: [] })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.scope.known).toBe(true)
    expect(context.mappedPoint.known).toBe(false)
    expect(context.unit.known).toBe(false)
  })

  it('binding không có đơn vị ⇒ Đơn vị unknown, không hiện chuỗi rỗng', () => {
    const context = contextFor({
      program, cursorSymbol: stSymbol, variables: [supplyVariable],
      bindings: [{ ...supplyBinding, unit: undefined }],
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.mappedPoint.known).toBe(true)
    expect(context.unit.known).toBe(false)
  })

  it('analyzer không tra được thì Đọc/Ghi cũng unknown, không phải `0 / 0`', () => {
    const context = contextFor({
      program, cursorSymbol: { identifier: 'KhongRo', start: 0, end: 7, entry: null },
      variables: [supplyVariable], bindings: [supplyBinding],
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    // `0 / 0` đọc thành "không ai đọc, không ai ghi" — một khẳng định sai.
    expect(context.readWrite.known).toBe(false)
  })
  /* `ISS-STED-13` — hạ cấp khi chỉ mục lệch khỏi compiler. */
  it('chỉ mục lệch ⇒ mọi trường SUY RA TỪ CHỈ MỤC hạ xuống unknown, kèm lý do', () => {
    const context = contextFor({
      program, cursorSymbol: stSymbol,
      variables: [supplyVariable], bindings: [supplyBinding],
      reconciliation: { degraded: true, reason: 'Chỉ mục ký hiệu LỆCH khỏi bảng của trình biên dịch.' },
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    expect(context.dataType.known).toBe(false)
    expect(context.definitionOffset.known).toBe(false)
    expect(context.referenceCount.known).toBe(false)
    expect(context.readWrite.known).toBe(false)
    expect(context.indexDegradedReason).toContain('LỆCH')
  })

  it('hạ cấp KHÔNG đụng các trường lấy từ Draft — lệch chỉ mục không nói gì về chúng', () => {
    const context = contextFor({
      program, cursorSymbol: stSymbol,
      variables: [supplyVariable], bindings: [supplyBinding],
      reconciliation: { degraded: true, reason: 'lệch' },
    })
    if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
    // Phạm vi/Điểm/Đơn vị đến từ Draft, không đi qua chỉ mục regex.
    expect(context.scope.known).toBe(true)
    expect(context.mappedPoint.known).toBe(true)
    expect(context.unit.known).toBe(true)
  })

  it('đối chiếu khớp (hoặc chưa so được) ⇒ không hạ cấp gì', () => {
    for (const reconciliation of [null, undefined, { degraded: false, reason: 'khớp' }]) {
      const context = contextFor({ program, cursorSymbol: stSymbol, reconciliation })
      if (context.kind !== 'ST_SYMBOL') throw new Error('sai ngữ cảnh')
      expect(context.dataType.known).toBe(true)
      expect(context.indexDegradedReason).toBeNull()
    }
  })
})
