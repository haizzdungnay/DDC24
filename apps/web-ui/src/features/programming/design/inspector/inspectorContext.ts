import type { CatalogEntry } from '../library/libraryCatalog'
import type { StCursorSymbol } from '../editor/stReferenceIndex'
import type { StRuntimeOverlayItem, StRuntimeOverlayState } from '../editor/StRuntimeValueOverlay'
import type { FbdDocument, FbdNode, FbdPort, FbdWire } from '../../fbd/model'
import type { FbdSelection } from '../../fbd/commands'
import type { ProgrammingProgram } from '../../model/types'

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
  const entry = symbol.entry
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
