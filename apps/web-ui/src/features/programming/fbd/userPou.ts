import type { FbdDataType, FbdNodeKind, FbdPort } from './model'
import type { FbdPaletteEntry, FbdPalettePortTemplate } from './palette'

/**
 * T59-105 — sinh pin cho node FBD trỏ một POU do người dùng hoặc Control Library
 * định nghĩa.
 *
 * POU người dùng KHÔNG nằm trong registry tĩnh, nên palette không thể biết trước
 * hình dạng pin của nó. Hình dạng đó đến từ chính interface của POU — cùng thông
 * tin mà `st_pou_registry` phía Core công bố qua bảng `signatures`. Ở đây chỉ có
 * một phép biến đổi thuần, không trạng thái, để hai phía không thể mô tả cùng một
 * POU theo hai cách khác nhau.
 */

/** Mô tả interface của một POU. Gương của `StPouSignature` phía Core. */
export interface UserPouInterface {
  name: string
  kind: Extract<FbdNodeKind, 'FUNCTION' | 'FUNCTION_BLOCK'>
  /** Theo đúng thứ tự khai báo; thứ tự này quyết định thứ tự đối số. */
  inputs: readonly { name: string; dataType: FbdDataType }[]
  /** Chỉ FUNCTION_BLOCK dùng; FUNCTION trả đúng một giá trị qua `returnType`. */
  outputs?: readonly { name: string; dataType: FbdDataType }[]
  returnType?: FbdDataType
  fromLibrary?: boolean
  /** Cảnh báo hiển thị, ví dụ entry còn ở trạng thái chờ duyệt. */
  warning?: { vi: string; en: string }
}

export const USER_POU_RETURN_PORT = 'OUT'

export class UserPouInterfaceError extends Error {}

function assertInterface(pou: UserPouInterface): void {
  if (pou.kind === 'FUNCTION') {
    if (!pou.returnType) {
      throw new UserPouInterfaceError(`FUNCTION '${pou.name}' thiếu kiểu trả về`)
    }
    if (pou.outputs && pou.outputs.length > 0) {
      throw new UserPouInterfaceError(
        `FUNCTION '${pou.name}' không được có VAR_OUTPUT; nó trả đúng một giá trị`,
      )
    }
  } else {
    if (pou.returnType) {
      throw new UserPouInterfaceError(`FUNCTION_BLOCK '${pou.name}' không có kiểu trả về`)
    }
    if (!pou.outputs || pou.outputs.length === 0) {
      throw new UserPouInterfaceError(`FUNCTION_BLOCK '${pou.name}' phải có ít nhất một đầu ra`)
    }
  }

  // Trùng tên cổng làm dây nối trở nên mơ hồ, nên nó phải chết ở đây chứ không
  // phải lúc người dùng đã vẽ xong sơ đồ.
  const seen = new Set<string>()
  const all = [...pou.inputs, ...(pou.outputs ?? [])]
  for (const port of all) {
    if (seen.has(port.name)) {
      throw new UserPouInterfaceError(`POU '${pou.name}' có cổng trùng tên '${port.name}'`)
    }
    seen.add(port.name)
  }
  if (pou.kind === 'FUNCTION' && seen.has(USER_POU_RETURN_PORT)) {
    throw new UserPouInterfaceError(
      `POU '${pou.name}' dùng '${USER_POU_RETURN_PORT}' cho cổng vào; tên này dành cho giá trị trả về`,
    )
  }
}

/** Sinh danh sách pin theo ĐÚNG thứ tự khai báo của interface. */
export function userPouPorts(pou: UserPouInterface): FbdPalettePortTemplate[] {
  assertInterface(pou)
  const ports: FbdPalettePortTemplate[] = pou.inputs.map((input) => ({
    name: input.name,
    direction: 'INPUT' as const,
    dataType: input.dataType,
  }))
  if (pou.kind === 'FUNCTION') {
    ports.push({ name: USER_POU_RETURN_PORT, direction: 'OUTPUT', dataType: pou.returnType! })
  } else {
    for (const output of pou.outputs ?? []) {
      ports.push({ name: output.name, direction: 'OUTPUT', dataType: output.dataType })
    }
  }
  return ports
}

/**
 * Entry palette cho một POU người dùng. `polymorphic` luôn false: kiểu của POU do
 * chính interface của nó quyết định, không phải do người dùng chọn lúc thả node.
 */
export function userPouPaletteEntry(pou: UserPouInterface): FbdPaletteEntry {
  const ports = userPouPorts(pou)
  const defaultType =
    pou.kind === 'FUNCTION' ? pou.returnType! : (pou.outputs?.[0]?.dataType ?? 'BOOL')
  return {
    id: pou.name,
    kind: pou.kind,
    typeRef: pou.name,
    category: pou.kind === 'FUNCTION' ? 'math' : 'control',
    labelVi: pou.fromLibrary ? `${pou.name} (thư viện)` : pou.name,
    labelEn: pou.fromLibrary ? `${pou.name} (library)` : pou.name,
    polymorphic: false,
    allowedTypes: [defaultType],
    defaultType,
    typedPortNames: [],
    ...(pou.warning ? { warning: pou.warning } : {}),
    buildPorts: () => ports,
  }
}

/** Dựng node FBD hoàn chỉnh; `makePortId` để test và UI kiểm soát được id. */
export function userPouNode(
  pou: UserPouInterface,
  options: { nodeId: string; executionOrder: number; makePortId: (index: number) => string },
): { id: string; kind: FbdNodeKind; typeRef: string; executionOrder: number
     parameters: Record<string, never>; ports: FbdPort[] } {
  const ports = userPouPorts(pou).map((port, index) => ({
    id: options.makePortId(index),
    name: port.name,
    direction: port.direction,
    dataType: port.dataType,
    unit: null,
    order: index,
  }))
  return {
    id: options.nodeId,
    kind: pou.kind,
    typeRef: pou.name,
    executionOrder: options.executionOrder,
    parameters: {},
    ports,
  }
}
