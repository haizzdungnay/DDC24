import type { ProgrammingLibraryEntry } from '../model/types'
import type { LibraryEntryGroup } from '../model/library'
import type { LibraryEntryDraft } from '../api/mutations'

/**
 * `T61-401` / `ISS-PGM04-11` — máy trạng thái của wizard Create/Edit PROJECT
 * Library.
 *
 * Tách khỏi React có chủ ý. Bản trước là MỘT form duy nhất nằm trong một
 * `Modal`, nên mọi luật ("bước này đã đủ chưa", "đã bẩn chưa", "thay đổi nào là
 * nội dung, thay đổi nào là trình bày") chỉ tồn tại dưới dạng biểu thức rải rác
 * trong JSX và không có cách nào kiểm được ngoài việc dựng cả cây DOM. Đưa
 * chúng ra một mô-đun thuần làm mỗi luật thành một hàm có tên, kiểm được trực
 * tiếp — và làm phép tiêm lỗi có chỗ để bám.
 */

export const LIBRARY_WIZARD_STEPS = ['metadata', 'interface', 'implementation', 'check', 'review'] as const
export type LibraryWizardStep = (typeof LIBRARY_WIZARD_STEPS)[number]

/** Kiểu dữ liệu cổng, lấy đúng tập của registry (`LibraryPort['dataType']`).
 *  Mở rộng ở FE mà registry chưa biết sẽ tạo ra một khối không ai dựng được. */
export const LIBRARY_WIZARD_DATA_TYPES = ['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'] as const
export type LibraryWizardDataType = (typeof LIBRARY_WIZARD_DATA_TYPES)[number]

/** Cùng biểu thức mà store ép (`ValidLibraryEntryName`) và cùng biểu thức mà
 *  bước Check của máy chủ chạy. Chặt hơn thì chặn một tên máy chủ nhận; lỏng hơn
 *  thì đẩy lỗi xuống 400 sau khi wizard đã nói "được". */
const LIBRARY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const LIBRARY_SOURCE_MAX_BYTES = 65536
const LIBRARY_CATEGORY_MAX_CHARS = 32
const LIBRARY_DESCRIPTION_MAX_CHARS = 512
const LIBRARY_MAX_TAGS = 8
const LIBRARY_TAG_MAX_CHARS = 24

/**
 * Ký tự điều khiển bị chặn ở CẢ hai đầu — `validText` của máy chủ chặn đúng dải
 * này (`< 0x20` và `0x7f`).
 *
 * `allowSourceWhitespace` là khác biệt DUY NHẤT giữa hai chỗ dùng: mã nguồn POU
 * bắt buộc có `\t`, `\n`, `\r`, nên áp cùng một luật cho cả tên lẫn mã nguồn sẽ
 * từ chối mọi mã nguồn hợp lệ. Viết thành một hàm quét mã điểm thay vì hai biểu
 * thức chính quy chứa ký tự điều khiển: hai biểu thức là hai bản luật, và bản
 * nào lệch thì lệch âm thầm.
 */
function hasControlCharacter(value: string, allowSourceWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (allowSourceWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)) continue
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export interface LibraryWizardPort {
  name: string
  type: LibraryWizardDataType
}

export interface LibraryWizardValues {
  name: string
  kind: 'FUNCTION' | 'FUNCTION_BLOCK'
  language: 'ST' | 'FBD'
  category: string
  description: string
  tags: string[]
  inputs: LibraryWizardPort[]
  outputs: LibraryWizardPort[]
  /** Chỉ có nghĩa với FUNCTION. Rỗng = chưa khai kiểu trả về. */
  returnType: '' | LibraryWizardDataType
  source: string
  dependencies: string[]
  /**
   * Các khoá KHÁC trong `interface` đã lưu mà wizard không mô hình hoá.
   *
   * `interface` là một phần của `contentSha256`, và upsert là phép GHI ĐÈ toàn
   * phần: dựng lại nó chỉ từ ba khoá wizard biết sẽ ÂM THẦM XOÁ mọi khoá khác
   * mà một bản cũ (hoặc một bundle import) đã ghi vào — một lần sửa mô tả cũng
   * đủ làm mất hợp đồng POU. Giữ nguyên phần không hiểu và ghi lại y như cũ.
   */
  interfaceExtras: Record<string, unknown>
}

/**
 * Một phát hiện gắn vào ĐÚNG một trường và ĐÚNG một bước.
 *
 * `code` dùng chung bảng mã với `LibraryEntryDiagnostic` của máy chủ ở những chỗ
 * hai bên cùng kiểm. Trùng mã là cố ý: khi cả hai cùng chỉ vào một dòng, người
 * đọc không phải tự đoán hai câu có nói về cùng một thứ hay không.
 */
export interface LibraryWizardIssue {
  step: LibraryWizardStep
  field: string
  code: string
  message: string
}

export interface LibraryWizardContext {
  entryId: string
  mode: 'create' | 'edit'
  /** Các entry PROJECT khác trong cùng thư viện (đã bỏ chính entry đang sửa). */
  siblings: { entryId: string; name: string; dependencies: string[] }[]
  /**
   * Máy chủ có trả lại mã nguồn đã lưu hay không.
   *
   * `false` là trạng thái THẬT hôm nay (`T61-404` chưa landing):
   * `SearchLibraryEntries` không mang `source`, nên khi sửa một khối, ô mã nguồn
   * bắt đầu TRỐNG. Cờ này tồn tại để wizard nói ra điều đó thay vì để người dùng
   * tưởng khối không có mã — và để ngày `T61-404` landing thì chỉ một chỗ đổi.
   */
  storedSourceAvailable: boolean
}

export function emptyLibraryWizardValues(): LibraryWizardValues {
  return {
    name: '', kind: 'FUNCTION', language: 'ST', category: '', description: '', tags: [],
    inputs: [], outputs: [], returnType: '', source: '', dependencies: [], interfaceExtras: {},
  }
}

/** Mọi khoá của `interface` mà wizard KHÔNG dựng lại từ các ô trên màn hình. */
function readInterfaceExtras(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {}
  const extras: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'inputs' || key === 'outputs' || key === 'returnType') continue
    extras[key] = item
  }
  return extras
}

function readPorts(value: unknown, key: 'inputs' | 'outputs'): LibraryWizardPort[] {
  if (typeof value !== 'object' || value === null) return []
  const raw = (value as Record<string, unknown>)[key]
  if (!Array.isArray(raw)) return []
  const ports: LibraryWizardPort[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const port = item as Record<string, unknown>
    if (typeof port.name !== 'string') continue
    /* Kiểu lạ được giữ NGUYÊN chuỗi. Quy nó về `BOOL` cho hợp kiểu TypeScript sẽ
       là một lời nói dối im lặng: interface trên màn hình khác interface đã lưu,
       và người dùng lưu lại là mất kiểu thật. `libraryWizardIssues` chỉ ra nó. */
    ports.push({ name: port.name, type: (typeof port.type === 'string' ? port.type : '') as LibraryWizardDataType })
  }
  return ports
}

function readReturnType(value: unknown): '' | LibraryWizardDataType {
  if (typeof value !== 'object' || value === null) return ''
  const raw = (value as Record<string, unknown>).returnType
  return typeof raw === 'string' ? (raw as LibraryWizardDataType) : ''
}

/**
 * Nạp wizard từ một entry đã lưu.
 *
 * `source` cố ý KHÔNG được bịa: hợp đồng đọc hiện tại không mang mã nguồn, nên
 * điền một chuỗi rỗng rồi để nó trôi vào payload ghi đè sẽ thay mã của khối bằng
 * rỗng. Ô bắt đầu trống và bước Implementation nói rõ vì sao.
 */
export function libraryWizardValuesFrom(entry: ProgrammingLibraryEntry): LibraryWizardValues {
  return {
    name: entry.name,
    kind: entry.kind === 'FUNCTION_BLOCK' ? 'FUNCTION_BLOCK' : 'FUNCTION',
    language: entry.language === 'FBD' ? 'FBD' : 'ST',
    category: entry.category ?? '',
    description: entry.description ?? '',
    tags: [...(entry.tags ?? [])],
    inputs: readPorts(entry.interface, 'inputs'),
    outputs: readPorts(entry.interface, 'outputs'),
    returnType: readReturnType(entry.interface),
    source: '',
    dependencies: entry.dependencies.map((item) => item.entryId),
    interfaceExtras: readInterfaceExtras(entry.interface),
  }
}

export function libraryWizardStepIndex(step: LibraryWizardStep): number {
  return LIBRARY_WIZARD_STEPS.indexOf(step)
}

export function nextLibraryWizardStep(step: LibraryWizardStep): LibraryWizardStep {
  const index = libraryWizardStepIndex(step)
  return LIBRARY_WIZARD_STEPS[Math.min(index + 1, LIBRARY_WIZARD_STEPS.length - 1)]
}

export function previousLibraryWizardStep(step: LibraryWizardStep): LibraryWizardStep {
  const index = libraryWizardStepIndex(step)
  return LIBRARY_WIZARD_STEPS[Math.max(index - 1, 0)]
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

function isJsonObject(value: string): boolean {
  if (!value.trimStart().startsWith('{')) return false
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Dò vòng phụ thuộc NGAY TẠI FORM.
 *
 * Đây là bản sao của phép dò mà máy chủ chạy, và nó tồn tại vì một lý do hẹp:
 * nói ra vòng trong lúc người dùng còn đang tick ô, thay vì sau một vòng mạng.
 * Máy chủ vẫn là nơi quyết định — `POST .../entries/check` chạy chính hàm mà
 * đường ghi chạy — nên khi hai bên lệch nhau thì bên thắng là máy chủ.
 */
function findDependencyCycle(context: LibraryWizardContext, dependencies: string[]): string[] | null {
  const adjacency = new Map<string, string[]>()
  for (const sibling of context.siblings) {
    adjacency.set(sibling.entryId, [...sibling.dependencies])
  }
  adjacency.set(context.entryId, [...dependencies])

  const visiting = new Set<string>()
  const done = new Set<string>()
  const stack: string[] = []

  function visit(node: string): string[] | null {
    visiting.add(node)
    stack.push(node)
    for (const next of adjacency.get(node) ?? []) {
      if (done.has(next)) continue
      if (visiting.has(next)) {
        return [...stack.slice(stack.indexOf(next)), next]
      }
      const cycle = visit(next)
      if (cycle) return cycle
    }
    stack.pop()
    visiting.delete(node)
    done.add(node)
    return null
  }
  return visit(context.entryId)
}

/**
 * MỌI phát hiện của một lần soạn, không dừng ở cái đầu tiên.
 *
 * Dừng sớm là cách một form bắt người dùng đi qua năm vòng để biết năm lỗi. Các
 * bước sau đó lọc theo `step`, nên thứ tự trong danh sách là thứ tự đọc.
 */
export function libraryWizardIssues(
  values: LibraryWizardValues,
  context: LibraryWizardContext
): LibraryWizardIssue[] {
  const issues: LibraryWizardIssue[] = []
  const add = (step: LibraryWizardStep, field: string, code: string, message: string) =>
    issues.push({ step, field, code, message })

  const name = values.name.trim()
  if (!LIBRARY_NAME_PATTERN.test(name)) {
    add('metadata', 'name', 'LIB_NAME_INVALID',
      'Tên phải bắt đầu bằng chữ cái và chỉ gồm chữ, số hoặc gạch dưới, tối đa 64 ký tự.')
  } else if (context.siblings.some((sibling) => sibling.name.toUpperCase() === name.toUpperCase())) {
    /* Tên trùng KHÔNG PHÂN BIỆT HOA THƯỜNG. Store fold theo IEC rồi mới so, nên
       `Scale_Lin` và `SCALE_LIN` là một; để FE so phân biệt hoa thường thì người
       dùng nhận 409 sau khi đã đi hết wizard. */
    add('metadata', 'name', 'LIB_NAME_TAKEN', 'PROJECT Library đã có một khối tên này (không phân biệt hoa thường).')
  }
  if (values.category !== '' && [...values.category].length > LIBRARY_CATEGORY_MAX_CHARS) {
    add('metadata', 'category', 'LIB_CATEGORY_INVALID', `Phân loại tối đa ${LIBRARY_CATEGORY_MAX_CHARS} ký tự.`)
  }
  if ([...values.description].length > LIBRARY_DESCRIPTION_MAX_CHARS) {
    add('metadata', 'description', 'LIB_DESCRIPTION_INVALID', `Mô tả tối đa ${LIBRARY_DESCRIPTION_MAX_CHARS} ký tự.`)
  }
  if (hasControlCharacter(values.description, false) || hasControlCharacter(values.category, false)) {
    add('metadata', 'description', 'LIB_DESCRIPTION_INVALID', 'Phân loại và mô tả không được chứa ký tự điều khiển.')
  }
  if (values.tags.length > LIBRARY_MAX_TAGS) {
    add('metadata', 'tags', 'LIB_TAGS_INVALID', `Tối đa ${LIBRARY_MAX_TAGS} thẻ.`)
  }
  if (values.tags.some((tag) => [...tag.trim()].length > LIBRARY_TAG_MAX_CHARS || hasControlCharacter(tag, false))) {
    add('metadata', 'tags', 'LIB_TAGS_INVALID',
      `Mỗi thẻ tối đa ${LIBRARY_TAG_MAX_CHARS} ký tự và không chứa ký tự điều khiển.`)
  }

  const ports = [...values.inputs, ...values.outputs]
  const seenPorts = new Set<string>()
  for (const port of ports) {
    if (!LIBRARY_NAME_PATTERN.test(port.name.trim())) {
      add('interface', 'ports', 'LIB_PORT_NAME_INVALID',
        `Tên cổng ${port.name === '' ? '(trống)' : `"${port.name}"`} phải là một định danh IEC.`)
      continue
    }
    if (!(LIBRARY_WIZARD_DATA_TYPES as readonly string[]).includes(port.type)) {
      add('interface', 'ports', 'LIB_PORT_TYPE_INVALID',
        `Cổng "${port.name}" mang kiểu "${port.type}" không thuộc tập kiểu của registry.`)
      continue
    }
    const key = port.name.trim().toUpperCase()
    if (seenPorts.has(key)) {
      add('interface', 'ports', 'LIB_PORT_DUPLICATE', `Cổng "${port.name}" bị khai hai lần.`)
      continue
    }
    seenPorts.add(key)
  }
  if (values.kind === 'FUNCTION' && values.returnType === '') {
    /* FUNCTION KHÔNG có kiểu trả về là một khối không gọi được. Để trống rồi lưu
       sẽ tạo ra một entry mà bộ dịch từ chối ở lần Check Revision — xa chỗ gây
       lỗi và không nói được nguyên nhân. */
    add('interface', 'returnType', 'LIB_RETURN_TYPE_MISSING', 'FUNCTION phải khai kiểu trả về.')
  }
  if (values.kind === 'FUNCTION_BLOCK' && values.outputs.length === 0) {
    add('interface', 'ports', 'LIB_OUTPUT_MISSING', 'FUNCTION_BLOCK phải có ít nhất một cổng ra.')
  }

  const sourceBytes = utf8Bytes(values.source)
  if (sourceBytes < 1) {
    add('implementation', 'source', 'LIB_SOURCE_INVALID',
      context.mode === 'edit' && !context.storedSourceAvailable
        ? 'Máy chủ chưa trả lại mã nguồn đã lưu, nên ô này bắt đầu trống. Dán lại toàn bộ mã của phiên bản mới trước khi lưu.'
        : 'Mã nguồn không được để trống.')
  } else if (sourceBytes > LIBRARY_SOURCE_MAX_BYTES) {
    add('implementation', 'source', 'LIB_SOURCE_INVALID',
      `Mã nguồn tối đa ${LIBRARY_SOURCE_MAX_BYTES} byte (đang ${sourceBytes}).`)
  } else if (hasControlCharacter(values.source, true)) {
    add('implementation', 'source', 'LIB_SOURCE_INVALID',
      'Mã nguồn chỉ được chứa xuống dòng và tab; các ký tự điều khiển khác bị chặn.')
  } else if (values.language === 'FBD' && !isJsonObject(values.source)) {
    add('implementation', 'source', 'LIB_SOURCE_NOT_JSON', 'Nội dung FBD phải là một object JSON.')
  }

  const seenDependencies = new Set<string>()
  for (const entryId of values.dependencies) {
    if (entryId === context.entryId) {
      add('implementation', 'dependencies', 'LIB_DEPENDENCY_SELF', 'Một khối không thể phụ thuộc vào chính nó.')
      continue
    }
    if (seenDependencies.has(entryId)) {
      add('implementation', 'dependencies', 'LIB_DEPENDENCY_DUPLICATE', 'Một phụ thuộc được khai hai lần.')
      continue
    }
    seenDependencies.add(entryId)
    if (!context.siblings.some((sibling) => sibling.entryId === entryId)) {
      add('implementation', 'dependencies', 'LIB_DEPENDENCY_UNKNOWN',
        `Phụ thuộc ${entryId} không có trong PROJECT Library của Project này.`)
    }
  }
  const cycle = findDependencyCycle(context, [...seenDependencies])
  if (cycle) {
    const label = (entryId: string) =>
      context.siblings.find((sibling) => sibling.entryId === entryId)?.name ?? entryId
    add('implementation', 'dependencies', 'LIB_DEPENDENCY_CYCLE',
      `Phụ thuộc tạo thành vòng: ${cycle.map(label).join(' → ')}.`)
  }
  return issues
}

export function libraryWizardStepIssues(
  issues: LibraryWizardIssue[],
  step: LibraryWizardStep
): LibraryWizardIssue[] {
  return issues.filter((issue) => issue.step === step)
}

/**
 * Bước `step` đã đủ để đi tiếp chưa.
 *
 * Chỉ xét lỗi CỦA CHÍNH bước đó. Chặn "Tiếp" vì một lỗi ở bước sau là bắt người
 * dùng sửa một ô họ chưa nhìn thấy; và bước Check mới là cái cổng cuối, nên
 * không có đường nào lưu được khi còn lỗi.
 */
export function libraryWizardCanAdvance(issues: LibraryWizardIssue[], step: LibraryWizardStep): boolean {
  return libraryWizardStepIssues(issues, step).length === 0
}

/** Đã chạm vào gì chưa. So GIÁ TRỊ, không dùng một cờ `touched`: một cờ bật lên
 *  ở lần gõ đầu tiên vẫn bật sau khi người dùng xoá lại về đúng như cũ, và hộp
 *  thoại "mất dữ liệu?" hiện ra khi không có gì để mất sẽ bị bấm qua theo phản
 *  xạ — đúng lúc nó thật sự có nghĩa thì nó đã mất tác dụng. */
export function libraryWizardDirty(values: LibraryWizardValues, baseline: LibraryWizardValues): boolean {
  return JSON.stringify(values) !== JSON.stringify(baseline)
}

export interface LibraryWizardChange {
  field: string
  label: string
  before: string
  after: string
  /**
   * `D61-09` — thay đổi NỘI DUNG đổi `contentSha256` (danh tính thực thi; mọi
   * artifact pin tới đều thành lỗi thời), thay đổi TRÌNH BÀY chỉ đổi
   * `presentationSha256`. Gộp hai loại vào một danh sách làm người duyệt không
   * phân biệt được một lần sửa chính tả với một lần đổi thuật toán.
   */
  impact: 'content' | 'presentation'
}

function portsLabel(ports: LibraryWizardPort[]): string {
  return ports.length === 0 ? '—' : ports.map((port) => `${port.name}:${port.type}`).join(', ')
}

export function libraryWizardChanges(
  values: LibraryWizardValues,
  baseline: LibraryWizardValues
): LibraryWizardChange[] {
  const rows: LibraryWizardChange[] = [
    { field: 'name', label: 'Tên khối', before: baseline.name, after: values.name, impact: 'content' },
    { field: 'kind', label: 'Loại', before: baseline.kind, after: values.kind, impact: 'content' },
    { field: 'language', label: 'Ngôn ngữ', before: baseline.language, after: values.language, impact: 'content' },
    { field: 'inputs', label: 'Cổng vào', before: portsLabel(baseline.inputs), after: portsLabel(values.inputs), impact: 'content' },
    { field: 'outputs', label: 'Cổng ra', before: portsLabel(baseline.outputs), after: portsLabel(values.outputs), impact: 'content' },
    { field: 'returnType', label: 'Kiểu trả về', before: baseline.returnType, after: values.returnType, impact: 'content' },
    {
      field: 'source', label: 'Mã nguồn',
      before: baseline.source === '' ? '' : `${utf8Bytes(baseline.source)} byte`,
      after: values.source === '' ? '' : `${utf8Bytes(values.source)} byte`,
      impact: 'content',
    },
    {
      field: 'dependencies', label: 'Phụ thuộc',
      before: baseline.dependencies.join(', '), after: values.dependencies.join(', '), impact: 'content',
    },
    { field: 'category', label: 'Phân loại', before: baseline.category, after: values.category, impact: 'presentation' },
    { field: 'description', label: 'Mô tả', before: baseline.description, after: values.description, impact: 'presentation' },
    { field: 'tags', label: 'Thẻ', before: baseline.tags.join(', '), after: values.tags.join(', '), impact: 'presentation' },
  ]
  return rows.filter((row) => row.before !== row.after)
}

/**
 * Payload gửi lên. `interface` LUÔN được dựng lại từ các ô đã khai, kể cả khi
 * người dùng không đụng tới nó: chép lại `entry.interface` cũ trong khi các ô
 * cổng trên màn hình nói một chuyện khác là cách hai nguồn sự thật cùng tồn tại
 * trong một form.
 */
export function libraryWizardDraft(
  values: LibraryWizardValues,
  context: LibraryWizardContext,
  projectEntries: LibraryEntryGroup[]
): LibraryEntryDraft {
  const category = values.category.trim()
  const description = values.description.trim()
  const tags = values.tags.map((tag) => tag.trim()).filter((tag) => tag !== '')
  return {
    entryId: context.entryId,
    kind: values.kind,
    name: values.name.trim(),
    language: values.language,
    source: values.source,
    interface: {
      ...values.interfaceExtras,
      inputs: values.inputs.map((port) => ({ name: port.name.trim(), type: port.type })),
      ...(values.outputs.length > 0
        ? { outputs: values.outputs.map((port) => ({ name: port.name.trim(), type: port.type })) }
        : {}),
      ...(values.returnType === '' ? {} : { returnType: values.returnType }),
    },
    /* Field VẮNG khi người dùng để trống, KHÔNG phải chuỗi rỗng: upsert ghi đè
       toàn phần, và một chuỗi rỗng được lưu thành "đã điền, nội dung rỗng" —
       khối sẽ hiện như đã phân loại vào một nhóm không tên thay vì hiện `—`. */
    ...(category ? { category } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    dependencies: values.dependencies.map((entryId) => ({
      entryId,
      version: projectEntries.find((group) => group.entryId === entryId)?.current.libraryVersion ?? '1.0.0',
    })),
  }
}
