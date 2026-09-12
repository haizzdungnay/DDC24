export interface StInterfaceVariable {
  name: string
  type: string
  direction: 'INPUT' | 'OUTPUT' | 'INOUT'
}

const ST_INTERFACE_BLOCK_START = /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT)\b/gi
const ST_INTERFACE_DECLARATION =
  /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(BOOL|INT|DINT|UINT|REAL|TIME)\b/gi

/** Biến biên ngoài của Program ST — khai báo trong `VAR_INPUT`/`VAR_OUTPUT`
 *  (§2 ST_SUBSET_SPEC). Dùng để mời Mapping tab chọn đúng biến đã khai báo
 *  thay vì bắt gõ tay tên không đối chiếu được với source thật. */
export function collectStInterfaceVariables(source: string): StInterfaceVariable[] {
  const output: StInterfaceVariable[] = []
  const blockStart = new RegExp(ST_INTERFACE_BLOCK_START.source, ST_INTERFACE_BLOCK_START.flags)
  let block: RegExpExecArray | null
  while ((block = blockStart.exec(source)) !== null) {
    const keyword = block[1].toUpperCase()
    const direction: StInterfaceVariable['direction'] = keyword === 'VAR_INPUT'
      ? 'INPUT'
      : keyword === 'VAR_OUTPUT' ? 'OUTPUT' : 'INOUT'
    const bodyStart = block.index + block[0].length
    const relativeEnd = source.slice(bodyStart).search(/\bEND_VAR\b/i)
    const body =
      relativeEnd === -1
        ? source.slice(bodyStart)
        : source.slice(bodyStart, bodyStart + relativeEnd)
    const declaration = new RegExp(
      ST_INTERFACE_DECLARATION.source,
      ST_INTERFACE_DECLARATION.flags
    )
    let decl: RegExpExecArray | null
    while ((decl = declaration.exec(body)) !== null) {
      output.push({ name: decl[1], type: decl[2].toUpperCase(), direction })
    }
  }
  return output
}

/** Kiểu trả về FUNCTION lấy từ header ST; null khi source không công bố/không hợp lệ. */
export function collectStFunctionReturnType(source: string): string | null {
  const match = /^\s*FUNCTION\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*(BOOL|INT|DINT|UINT|REAL|TIME)\b/im.exec(source)
  return match ? match[1].toUpperCase() : null
}
