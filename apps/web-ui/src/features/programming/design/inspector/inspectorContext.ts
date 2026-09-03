import type { CatalogEntry } from '../library/libraryCatalog'
import type { StCursorSymbol } from '../editor/stReferenceIndex'
import type { StRuntimeOverlayItem, StRuntimeOverlayState } from '../editor/StRuntimeValueOverlay'
import type { FbdDocument, FbdNode, FbdPort, FbdWire } from '../../fbd/model'
import type { FbdSelection } from '../../fbd/commands'
import type { ProgrammingBinding, ProgrammingProgram, ProgrammingVariable } from '../../model/types'

/**
 * `T59-818` / `PGM02-V22-WP-14` — ngữ cảnh của Inspector, tách khỏi React.
 *
 * Handoff §9 quy định năm ngữ cảnh, và điều khó nhất ở đây không phải hiển thị
 * mà là **biết khi nào mình không biết**. Một Inspector đoán kiểu hoặc đoán chữ
 * ký còn tệ hơn một Inspector trống: người đọc không có cách nào phân biệt một
 * suy đoán với một sự thật, và họ sẽ sửa chương trình dựa trên suy đoán đó.
 *
 * Vì vậy mọi trường đi qua `InspectorField`: hoặc `known` kèm giá trị, hoặc
 * `unknown` — không có `''`, không có `0`, không có giá trị mặc định.
 *
 * `UD-PROG-015` ĐÃ ĐÓNG bằng `DEV-PROG-004`: ba trường `Access`, `Description`
 * và TÊN Task nay CÓ nguồn thật — hai trường đầu là chú thích do người dùng ghi
 * (`objects[].description`/`objects[].access`, operation `annotateObject`), tên
 * Task đọc từ `task.name` của Draft. Chúng vẫn đi qua `InspectorField` như mọi
 * trường khác: không có nguồn thì `unknown`, không bao giờ là `"Public"` hay
 * một chuỗi rỗng trông như đã điền.
 */

export type InspectorField<T> = { known: true; value: T } | { known: false }

export function known<T>(value: T): InspectorField<T> {
  return { known: true, value }
}
export const unknownField: InspectorField<never> = { known: false }

/** Giá trị runtime của một ô, dùng chung cho LIVE và SIMULATE. */
export interface InspectorRuntimeValue {
  item: StRuntimeOverlayItem | null
  /** `unavailable` = chưa đọc được. Hiển thị `—`, tuyệt đối không phải 0. */
  status: 'unavailable' | 'ready'
}

export interface InspectorProgramContext {
  kind: 'PROGRAM'
  name: InspectorField<string>
  language: InspectorField<'ST' | 'FBD'>
  pouKind: InspectorField<ProgrammingProgram['kind']>
  /** Chu kỳ chiếu từ `programs[].periodMs`; KHÔNG nhân bản bảng Thực thi. */
  cycleMs: InspectorField<number>
  enabled: InspectorField<boolean>
  /** `DEV-PROG-004` — ghi chú truy cập một dòng do người dùng viết. */
  access: InspectorField<string>
  /** `DEV-PROG-004` — mô tả nhiều dòng do người dùng viết. */
  description: InspectorField<string>
  /** `DEV-PROG-004` — TÊN Task chứa Program, để "Chu kỳ" đọc được thành
   *  "Control_Main (1 s)". Task không đặt tên ⇒ `unknown`, không tự đặt. */
  taskName: InspectorField<string>
  /** `DEV-PROG-004` — cổng giao diện của POU (VAR_INPUT/VAR_OUTPUT). Rỗng là
   *  một câu trả lời THẬT ("POU không khai cổng nào"), khác `unknown`. */
  parameters: InspectorField<readonly InspectorPouParameter[]>
  /** `DEV-PROG-004` — cặp khoá/giá trị metadata có thật của POU. */
  attributes: readonly { key: string; value: string }[]
  /**
   * `DEV-PROG-011` — POU có mục trong `programs[]` (cấu hình chạy) hay không.
   *
   * Trường này TỪNG nằm ở khay "Thuộc tính POU" trong thanh bên; nó chuyển về
   * đây cùng lúc thanh bên rút gọn còn cây + tìm kiếm. Chuyển chỗ chứ KHÔNG bỏ:
   * một POU kind `PROGRAM` chưa xếp lịch chạy sẽ làm Kiểm tra fail-closed, và
   * đó đúng là thứ người dùng cần biết trước khi bấm Kiểm tra.
   */
  scheduled: InspectorField<boolean>
}

export interface InspectorPouParameter {
  name: string
  direction: 'INPUT' | 'OUTPUT' | 'IN_OUT'
  dataType: string
}

export interface InspectorVariableContext {
  kind: 'VARIABLE'
  name: string
  dataType: InspectorField<string>
  scope: InspectorField<string>
  mapping: InspectorField<string>
  runtime: InspectorRuntimeValue
  referenceCount: InspectorField<number>
}

export interface InspectorStSymbolContext {
  kind: 'ST_SYMBOL'
  identifier: string
  /** Offset khai báo — `unknown` khi analyzer không tra được. */
  definitionOffset: InspectorField<number>
  dataType: InspectorField<string>
  /** Chữ ký chuẩn hoá của thư viện; `unknown` khi thư viện không công bố. */
  signature: InspectorField<string>
  referenceCount: InspectorField<number>
  runtime: InspectorRuntimeValue
  /**
   * `ISS-STED-12` — năm trường dưới đây trả lời những câu người đọc mã ST hỏi
   * trước tiên: biến này ở đâu ra, bắt đầu bằng gì, có nối ra ngoài không, đơn
   * vị là gì, và ai ghi vào nó.
   *
   * Cả năm đều đi qua `InspectorField` như mọi trường khác. Đây là chỗ dễ phá
   * nguyên tắc nhất của module: một biến chưa có trong Draft mà hiện Scope
   * `VAR` sẽ trông y hệt một sự thật, và người đọc sẽ sửa chương trình dựa
   * trên nó.
   */
  /** `VAR`/`VAR_INPUT`/`VAR_OUTPUT`/`VAR RETAIN` — nguồn là Draft, không suy. */
  scope: InspectorField<string>
  /**
   * Giá trị khởi tạo. Subset ST **không cho** khai giá trị khởi tạo trong `VAR`
   * (`st_parser.cpp` đòi `;` ngay sau tên kiểu), nên khi Draft không ghi
   * `initialValue` thì giá trị thật là **mặc định của kiểu** theo
   * `ST_SUBSET_SPEC` §3.1 — một sự thật tra được, không phải một suy đoán.
   * `typeDefault` cho UI nói rõ nó đến từ đâu.
   */
  initialValue: InspectorField<{ text: string; typeDefault: boolean }>
  /** Điểm đã ánh xạ, đọc từ `bindings[]` của Draft — KHÔNG dựng authority Point
   *  thứ hai ở Inspector. Rỗng ⇒ `unknown`, không phải "chưa ánh xạ". */
  mappedPoint: InspectorField<string>
  /** Đơn vị kỹ thuật, cũng từ chính binding đó. */
  unit: InspectorField<string>
  /** Số lần đọc / ghi, đếm từ `occurrences.role` — một đường đếm duy nhất. */
  readWrite: InspectorField<{ reads: number; writes: number }>
  /** `ISS-STED-13` — lý do chỉ mục bị hạ cấp; `null` khi chỉ mục còn dùng được. */
  indexDegradedReason: string | null
}

export interface InspectorFbdPortView {
  portId: string
  name: string
  direction: FbdPort['direction']
  dataType: string
  unit: string | null
  order: number
}

export interface InspectorFbdBlockContext {
  kind: 'FBD_BLOCK'
  /** `nodeId` canonical — KHÔNG thay bằng nhãn hiển thị. */
  instanceId: string
  typeRef: string
  parameters: readonly { name: string; value: string }[]
  /** Model FBD chưa mang cờ retained ⇒ `unknown`, không phải `false`. */
  retained: InspectorField<boolean>
  ports: readonly InspectorFbdPortView[]
  signature: InspectorField<string>
  runtime: InspectorRuntimeValue
}

export interface InspectorFbdConnectionContext {
  kind: 'FBD_CONNECTION'
  wireId: string
  source: InspectorField<{ nodeId: string; portId: string; portName: string }>
  destination: InspectorField<{ nodeId: string; portId: string; portName: string }>
  dataType: InspectorField<string>
  runtime: InspectorRuntimeValue
}

export type InspectorContext =
  | { kind: 'EMPTY' }
  | InspectorProgramContext
  | InspectorVariableContext
  | InspectorStSymbolContext
  | InspectorFbdBlockContext
  | InspectorFbdConnectionContext

export interface InspectorInput {
  program?: ProgrammingProgram | null
  /** Chu kỳ của Program đang chọn, đọc từ bảng Thực thi/Draft. */
  cycleMs?: number | null
  /** Tên Task chứa Program (`task.name` của Draft). */
  taskName?: string | null
  /** Cổng giao diện của POU đang mở; `undefined` = chưa phân tích. */
  parameters?: readonly InspectorPouParameter[]
  enabled?: boolean | null
  /** Ký hiệu dưới con trỏ ST; `entry === null` nghĩa là analyzer không tra được. */
  cursorSymbol?: StCursorSymbol | null
  /**
   * `ISS-STED-12` — bảng biến và bảng binding của Draft.
   *
   * Đây là AUTHORITY cho Scope/Initial/Mapped point/Unit. Inspector không tự
   * đọc catalog Point và cũng không tự suy scope từ văn bản: hai đường sẽ lệch
   * nhau, và lệch ở đây nghĩa là Inspector nói biến nối tới một điểm mà Kiểm
   * tra không thấy.
   */
  variables?: readonly ProgrammingVariable[]
  bindings?: readonly ProgrammingBinding[]
  /**
   * `ISS-STED-13` — phán quyết đối chiếu chỉ mục ký hiệu của FE với bảng
   * compiler công bố. `degraded` ⇒ mọi trường SUY RA TỪ CHỈ MỤC hạ xuống
   * `unknown`: chỉ mục vừa được chứng minh là đọc lệch, nên hiển thị tiếp giá
   * trị của nó là hiển thị thông tin đã biết là sai.
   *
   * Các trường lấy từ Draft (Phạm vi, Điểm ánh xạ, Đơn vị) KHÔNG bị hạ: chúng
   * không đi qua chỉ mục, nên lệch của chỉ mục không nói gì về chúng.
   */
  reconciliation?: { degraded: boolean; reason: string } | null
  catalog?: readonly CatalogEntry[]
  fbd?: { document: FbdDocument; selection: FbdSelection | null } | null
  runtime?: StRuntimeOverlayState | null
}

/**
 * Chọn ngữ cảnh theo thứ tự ưu tiên: lựa chọn FBD tường minh → ký hiệu dưới con
 * trỏ ST → Program đang mở → rỗng.
 *
 * Thứ tự này theo đúng thứ người dùng vừa chạm vào: một lựa chọn FBD là hành
 * động chủ động, còn Program chỉ là bối cảnh nền.
 */
export function inspectorContextFor(input: InspectorInput): InspectorContext {
  const fbdContext = fbdContextFor(input)
  if (fbdContext) return fbdContext

  const symbolContext = stSymbolContextFor(input)
  if (symbolContext) return symbolContext

  if (input.program) {
    const program = input.program
    return {
      kind: 'PROGRAM',
      name: program.name ? known(program.name) : unknownField,
      language: program.language ? known(program.language) : unknownField,
      pouKind: program.kind ? known(program.kind) : unknownField,
      /* `periodMs` không có ⇒ `unknown`. KHÔNG mặc định 1000 ms: một chu kỳ
       * đoán làm người đọc tin rằng lịch chạy đã được cấu hình. */
      cycleMs: typeof input.cycleMs === 'number' && input.cycleMs > 0
        ? known(input.cycleMs) : unknownField,
      enabled: typeof input.enabled === 'boolean' ? known(input.enabled) : unknownField,
      access: program.access ? known(program.access) : unknownField,
      description: program.description ? known(program.description) : unknownField,
      taskName: input.taskName ? known(input.taskName) : unknownField,
      /* `undefined` (chưa ai phân tích giao diện) khác `[]` (đã phân tích và
       * POU không khai cổng nào). Gộp hai thứ đó lại là biến "chưa đọc" thành
       * "không có". */
      parameters: input.parameters === undefined ? unknownField : known(input.parameters),
      attributes: pouAttributes(program),
      /* `hasRuntimeConfig === undefined` là document v1 đi qua nguyên trạng: ở
       * đó mọi Program đều có cấu hình chạy nên suy theo kind là đúng — cùng
       * luật với `pouItems`, không dựng bản thứ hai. */
      scheduled: program.kind === 'PROGRAM'
        ? known(program.hasRuntimeConfig ?? true)
        : known(false),
    }
  }
  return { kind: 'EMPTY' }
}

/**
 * Metadata cặp khoá/giá trị CÓ THẬT của POU.
 *
 * Chỉ liệt kê thứ Draft nói ra. `hasRuntimeConfig` là dữ kiện quan trọng nhất ở
 * đây và cũng là thứ hay bị hiểu nhầm nhất: một POU kind `PROGRAM` hoàn toàn có
 * thể chưa được xếp lịch chạy, và khi đó Check sẽ fail-closed thay vì tự đặt
 * chu kỳ.
 */
function pouAttributes(program: ProgrammingProgram): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = []
  if (program.objectId) rows.push({ key: 'objectId', value: program.objectId })
  rows.push({ key: 'programId', value: program.programId })
  if (typeof program.hasRuntimeConfig === 'boolean') {
    rows.push({ key: 'hasRuntimeConfig', value: String(program.hasRuntimeConfig) })
  }
  if (typeof program.executionOrder === 'number') {
    rows.push({ key: 'executionOrder', value: String(program.executionOrder) })
  }
  if (program.functionalTags && program.functionalTags.length > 0) {
    rows.push({ key: 'functionalTags', value: program.functionalTags.join(', ') })
  }
  if (program.dependencies && program.dependencies.length > 0) {
    rows.push({ key: 'dependencies', value: String(program.dependencies.length) })
  }
  return rows
}

function runtimeFor(runtime: StRuntimeOverlayState | null | undefined, name: string): InspectorRuntimeValue {
  if (!runtime || runtime.status !== 'ready') return { item: null, status: 'unavailable' }
  const item = runtime.items.find((candidate) => candidate.variableName === name) ?? null
  if (!item) return { item: null, status: 'unavailable' }
  return { item, status: 'ready' }
}

/**
 * Chữ ký chuẩn hoá của một type từ catalog thư viện.
 *
 * `SIGNATURE_UNAVAILABLE` ⇒ `unknown`. Backend đã nói thẳng là nó không đọc
 * được chữ ký; dựng một chữ ký từ tên port ở FE là bịa ra một hợp đồng.
 */
function signatureOfType(catalog: readonly CatalogEntry[] | undefined, typeName: string): InspectorField<string> {
  if (!catalog || !typeName) return unknownField
  const entry = catalog.find((candidate) => candidate.name.toUpperCase() === typeName.toUpperCase())
  if (!entry) return unknownField
  if (entry.usability.kind === 'SIGNATURE_UNAVAILABLE') return unknownField
  if (entry.ports.length === 0) return unknownField
  const inputs = entry.ports.filter((port) => port.direction === 'INPUT')
    .map((port) => `${port.name} ${port.dataType}`)
  const outputs = entry.ports.filter((port) => port.direction === 'OUTPUT')
    .map((port) => `${port.name} ${port.dataType}`)
  return known(`${entry.name}(${inputs.join(', ')})${outputs.length ? ` → ${outputs.join(', ')}` : ''}`)
}

/* `ISS-STED-12` — nhãn scope theo đúng cách ST viết ra, không theo tên nội bộ
 * của Data Model. Người đọc đang nhìn mã ST, nên `VAR_INPUT` mới là thứ họ tìm
 * lại được trong buffer; `INPUT` thì không. */
const SCOPE_LABEL: Record<ProgrammingVariable['class'], string> = {
  LOCAL: 'VAR',
  INPUT: 'VAR_INPUT',
  OUTPUT: 'VAR_OUTPUT',
  INOUT: 'VAR_IN_OUT',
  GLOBAL: 'VAR_GLOBAL',
  MAPPED: 'VAR',
  RETAIN: 'VAR RETAIN',
  CONSTANT: 'VAR CONSTANT',
  PARAMETER: 'VAR',
}

/* Giá trị khởi tạo mặc định theo `ST_SUBSET_SPEC` §3.1. Subset không cho khai
 * giá trị khởi tạo trong `VAR`, nên với biến vô hướng đây là giá trị THẬT lúc
 * cold start — tra được, không phải đoán. Kiểu ngoài bảng (instance FB, kiểu
 * người dùng) không có giá trị vô hướng nào để nói. */
const TYPE_DEFAULT: Record<string, string> = {
  BOOL: 'FALSE',
  INT: '0',
  DINT: '0',
  UINT: '0',
  REAL: '0.0',
  TIME: 'T#0s',
}

function scopeOf(variable: ProgrammingVariable | undefined): InspectorField<string> {
  if (!variable) return unknownField
  const label = SCOPE_LABEL[variable.class]
  if (!label) return unknownField
  /* `retain` là một cờ RIÊNG trong Data Model, không phải một giá trị của
   * `class`. Bỏ qua nó sẽ hiện `VAR` cho một biến thực ra giữ giá trị qua
   * mất điện — đúng thứ khác biệt mà người vận hành cần thấy. */
  if (variable.retain && !label.includes('RETAIN')) return known(`${label} RETAIN`)
  return known(label)
}

function initialValueOf(
  variable: ProgrammingVariable | undefined,
  typeName: string | undefined,
): InspectorField<{ text: string; typeDefault: boolean }> {
  if (variable && variable.initialValue !== null && variable.initialValue !== undefined) {
    return known({ text: String(variable.initialValue), typeDefault: false })
  }
  const type = (variable?.type ?? typeName ?? '').toUpperCase()
  const fallback = TYPE_DEFAULT[type]
  if (!fallback) return unknownField
  return known({ text: fallback, typeDefault: true })
}

function bindingOf(
  variable: ProgrammingVariable | undefined,
  bindings: readonly ProgrammingBinding[] | undefined,
): ProgrammingBinding | undefined {
  if (!variable || !bindings) return undefined
  return bindings.find((binding) => binding.variableId === variable.variableId)
}

/** Điểm đọc được: `LOCAL/UI-01`, và RTU thì kèm thiết bị vì `40001` một mình
 *  không định danh được điểm nào cả. */
function pointLabel(binding: ProgrammingBinding): string {
  const device = binding.point.deviceId ? `${binding.point.deviceId}/` : ''
  return `${binding.point.category}/${device}${binding.point.pointId}`
}

function readWriteOf(entry: StCursorSymbol['entry']): InspectorField<{ reads: number; writes: number }> {
  if (!entry) return unknownField
  let reads = 0
  let writes = 0
  for (const occurrence of entry.occurrences) {
    if (occurrence.role === 'WRITE') writes += 1
    else reads += 1
  }
  return known({ reads, writes })
}

/**
 * Ngữ cảnh của một ký hiệu ST.
 *
 * `export` để hover (`T59-820`) dùng ĐÚNG hàm này thay vì dựng đường phân giải
 * thứ hai. Hai đường sẽ lệch nhau đúng lúc điều đó khó thấy nhất — một định
 * danh mà thư viện không công bố chữ ký — và người đọc sẽ thấy Inspector nói
 * một đằng, tooltip nói một nẻo về cùng một tên.
 */
export function stSymbolContextFor(input: InspectorInput): InspectorStSymbolContext | null {
  const symbol = input.cursorSymbol
  if (!symbol) return null
  /* Chỉ mục đã được chứng minh lệch ⇒ coi như không tra được. Đây đúng là hành
   * vi mà `F-STED-011` đòi: hạ cấp có thông báo, không im lặng sai. */
  const entry = input.reconciliation?.degraded ? null : symbol.entry
  /* Khớp theo TÊN, phân biệt hoa/thường theo đúng cách ST xử lý định danh
   * (không phân biệt). Draft là authority; chỉ số văn bản chỉ nói được vị trí
   * và vai trò đọc/ghi. */
  const variable = input.variables?.find(
    (candidate) => candidate.name.toUpperCase() === symbol.identifier.toUpperCase(),
  )
  const binding = bindingOf(variable, input.bindings)
  return {
    kind: 'ST_SYMBOL',
    identifier: symbol.identifier,
    definitionOffset: entry ? known(entry.declarationOffset) : unknownField,
    dataType: entry ? known(entry.typeName) : unknownField,
    signature: entry && entry.kind === 'FB_INSTANCE'
      ? signatureOfType(input.catalog, entry.typeName)
      : unknownField,
    referenceCount: entry ? known(entry.occurrences.length) : unknownField,
    runtime: runtimeFor(input.runtime, symbol.identifier),
    scope: scopeOf(variable),
    /* Instance FB không có giá trị khởi tạo vô hướng: trạng thái của nó do
     * chính khối quản. Nói "0.0" ở đây là bịa. */
    initialValue: entry?.kind === 'FB_INSTANCE'
      ? unknownField
      : initialValueOf(variable, entry?.typeName),
    mappedPoint: binding ? known(pointLabel(binding)) : unknownField,
    /* Đơn vị lấy từ chính binding đã dùng cho điểm — không tra catalog Point
     * lần nữa, vì hai lần tra là hai câu trả lời có thể khác nhau. */
    unit: binding?.unit ? known(binding.unit) : unknownField,
    readWrite: readWriteOf(entry),
    indexDegradedReason: input.reconciliation?.degraded ? input.reconciliation.reason : null,
  }
}

function fbdContextFor(input: InspectorInput): InspectorContext | null {
  const fbd = input.fbd
  if (!fbd || !fbd.selection) return null
  const selection = fbd.selection

  if (selection.kind === 'node' || selection.kind === 'port') {
    const node = findNode(fbd.document, selection.nodeId)
    if (!node) return null
    return {
      kind: 'FBD_BLOCK',
      instanceId: node.id,
      typeRef: node.typeRef,
      parameters: Object.entries(node.parameters).map(([name, value]) => ({
        name, value: formatParameter(value),
      })),
      /* Model FBD canonical chưa mang cờ retained. Trả `unknown` chứ không
       * `false`: "không biết" và "chắc chắn không giữ trạng thái" là hai câu
       * khác nhau, và câu thứ hai ảnh hưởng tới cách người ta hiểu chương trình
       * sau khi mất điện. */
      retained: unknownField,
      /* Giữ NGUYÊN thứ tự port đã khai. Sắp lại theo tên sẽ làm sơ đồ trong
       * Inspector không còn khớp sơ đồ trên canvas. */
      ports: node.ports.map((port) => ({
        portId: port.id, name: port.name, direction: port.direction,
        dataType: port.dataType, unit: port.unit, order: port.order,
      })),
      signature: signatureOfType(input.catalog, node.typeRef),
      runtime: runtimeFor(input.runtime, node.id),
    }
  }

  if (selection.kind === 'wire') {
    const wire = findWire(fbd.document, selection.wireId)
    if (!wire) return null
    const source = endpointView(fbd.document, wire.from.nodeId, wire.from.portId)
    const destination = endpointView(fbd.document, wire.to.nodeId, wire.to.portId)
    const sourcePort = findPort(fbd.document, wire.from.nodeId, wire.from.portId)
    return {
      kind: 'FBD_CONNECTION',
      wireId: wire.id,
      source, destination,
      dataType: sourcePort ? known(sourcePort.dataType) : unknownField,
      runtime: runtimeFor(input.runtime, wire.from.nodeId),
    }
  }
  return null
}

function formatParameter(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function findNode(document: FbdDocument, nodeId: string): FbdNode | undefined {
  for (const network of document.networks) {
    const node = network.nodes.find((candidate) => candidate.id === nodeId)
    if (node) return node
  }
  return undefined
}

function findWire(document: FbdDocument, wireId: string): FbdWire | undefined {
  for (const network of document.networks) {
    const wire = network.wires.find((candidate) => candidate.id === wireId)
    if (wire) return wire
  }
  return undefined
}

function findPort(document: FbdDocument, nodeId: string, portId: string): FbdPort | undefined {
  return findNode(document, nodeId)?.ports.find((port) => port.id === portId)
}

function endpointView(
  document: FbdDocument, nodeId: string, portId: string,
): InspectorField<{ nodeId: string; portId: string; portName: string }> {
  const port = findPort(document, nodeId, portId)
  if (!port) return unknownField
  return known({ nodeId, portId, portName: port.name })
}

/**
 * Inspector có nội dung đáng chiếm chỗ hay không.
 *
 * Handoff §9 cấm thẳng việc chiếm 300 px cho hai trường. Đây là hàm quyết định
 * điều đó, và nó nằm ở lớp thuần để test kiểm được mà không đo pixel.
 */
export function inspectorHasUsefulContext(context: InspectorContext): boolean {
  if (context.kind === 'EMPTY') return false
  if (context.kind === 'PROGRAM') {
    // Chỉ có tên và loại thì chưa đáng một khay riêng — đó đúng là hiện trạng
    // mà `F-PGM02-AUD-001` chỉ ra.
    return context.cycleMs.known || context.enabled.known || context.language.known
      || context.description.known || context.access.known
  }
  return true
}
