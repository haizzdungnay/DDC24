export interface StInterfaceVariable {
  name: string
  type: string
  direction: 'INPUT' | 'OUTPUT'
}

const ST_INTERFACE_BLOCK_START = /\b(VAR_INPUT|VAR_OUTPUT)\b/gi
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
    const direction: 'INPUT' | 'OUTPUT' =
      block[1].toUpperCase() === 'VAR_INPUT' ? 'INPUT' : 'OUTPUT'
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
