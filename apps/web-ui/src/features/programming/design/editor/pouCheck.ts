import type {
  ProgrammingDiagnostic,
  ProgrammingDraftDocument,
  ProgrammingProgram,
} from '../../model/types'
import { readFbdDocument } from '../../fbd/readDocument'
import { validateFbdDocument, type FbdDocument } from '../../fbd/model'
import { FBD_PALETTE } from '../../fbd/palette'
import { maskStComments } from './stInstanceInsertion'
import { parseSt } from './stFormat/parser'
import { buildStReferenceIndex } from './stReferenceIndex'
import { createUuid } from '../../../../shared/crypto'

export interface PouTestVector {
  variableName: string
  typeName: string
  direction: 'INPUT' | 'OUTPUT' | 'LOCAL'
  value: string
  rawValue: unknown
}

export interface PouCheckLog {
  id: string
  timestamp: string
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' | 'TEST'
  message: string
}

export interface PouCheckResult {
  diagnostics: ProgrammingDiagnostic[]
  checkedProgramIds: string[]
  checkedProgramNames: string[]
  testVectors: PouTestVector[]
  logs: PouCheckLog[]
}

const BASE_TYPES = new Set([
  'BOOL', 'INT', 'DINT', 'UINT', 'SINT', 'USINT', 'REAL', 'LREAL', 'TIME', 'STRING', 'BYTE', 'WORD', 'DWORD',
])

export function generateRandomValue(type: string): { raw: unknown; formatted: string } {
  const t = type.toUpperCase()
  if (t === 'BOOL') {
    const val = Math.random() >= 0.5
    return { raw: val, formatted: val ? '1 (TRUE)' : '0 (FALSE)' }
  }
  if (t === 'REAL' || t === 'LREAL') {
    const val = Number((1.0 + Math.random() * 4.0).toFixed(2))
    return { raw: val, formatted: val.toFixed(2) }
  }
  if (['INT', 'DINT', 'SINT', 'LINT', 'UINT', 'UDINT', 'USINT', 'WORD', 'BYTE'].includes(t)) {
    const val = Math.floor(Math.random() * 20 + 1)
    return { raw: val, formatted: String(val) }
  }
  if (t === 'TIME') {
    const sec = Math.floor(Math.random() * 10 + 1)
    return { raw: `T#${sec}s`, formatted: `T#${sec}s` }
  }
  if (t === 'STRING') {
    const s = 'STR_' + Math.floor(Math.random() * 100)
    return { raw: s, formatted: `'${s}'` }
  }
  return { raw: 1, formatted: '1' }
}

export function extractStVariables(source: string): Array<{ name: string; type: string; direction: 'INPUT' | 'OUTPUT' | 'LOCAL' }> {
  const vars: Array<{ name: string; type: string; direction: 'INPUT' | 'OUTPUT' | 'LOCAL' }> = []
  const masked = maskStComments(source)
  const blockRegex = new RegExp('VAR(?:_(INPUT|OUTPUT|IN_OUT|TEMP))?\\b([\\s\\S]*?)END_VAR', 'gi')
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRegex.exec(masked)) !== null) {
    const dir = blockMatch[1] ? (blockMatch[1].toUpperCase() as 'INPUT' | 'OUTPUT') : 'LOCAL'
    const body = blockMatch[2]
    const declRegex = new RegExp('([A-Za-z_][A-Za-z0-9_]*)\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*)', 'g')
    let declMatch: RegExpExecArray | null
    while ((declMatch = declRegex.exec(body)) !== null) {
      vars.push({
        name: declMatch[1],
        type: declMatch[2].toUpperCase(),
        direction: dir,
      })
    }
  }
  return vars
}

export function findPouDependencies(
  targetProgramId: string,
  document: ProgrammingDraftDocument,
  buffers?: Record<string, string>,
): ProgrammingProgram[] {
  const target = document.programs.find(
    (p) => p.programId === targetProgramId || p.objectId === targetProgramId,
  )
  if (!target) return []

  const visited = new Map<string, ProgrammingProgram>()
  visited.set(target.programId, target)
  const queue: ProgrammingProgram[] = [target]

  while (queue.length > 0) {
    const current = queue.shift()!
    const otherPrograms = document.programs.filter((p) => p.programId !== current.programId)

    if (current.language === 'FBD') {
      const rawDoc = buffers?.[current.programId] ?? current.document
      const parsedRes = readFbdDocument(rawDoc)
      if (parsedRes.ok) {
        for (const network of parsedRes.document.networks) {
          for (const node of network.nodes) {
            const match = otherPrograms.find(
              (p) => p.name.toUpperCase() === node.typeRef.toUpperCase(),
            )
            if (match && !visited.has(match.programId)) {
              visited.set(match.programId, match)
              queue.push(match)
            }
          }
        }
      }
    } else {
      const source =
        buffers?.[current.programId] ??
        (typeof current.document === 'string' ? current.document : '')
      const masked = maskStComments(source)
      for (const candidate of otherPrograms) {
        if (visited.has(candidate.programId)) continue
        const pattern = new RegExp(`\\b${candidate.name}\\b`, 'i')
        if (pattern.test(masked)) {
          visited.set(candidate.programId, candidate)
          queue.push(candidate)
        }
      }
    }
  }

  return Array.from(visited.values())
}

export function checkPouAndDependencies(
  targetProgramId: string,
  document: ProgrammingDraftDocument,
  buffers?: Record<string, string>,
): PouCheckResult {
  const targetPrograms = findPouDependencies(targetProgramId, document, buffers)
  if (targetPrograms.length === 0) {
    return {
      diagnostics: [],
      checkedProgramIds: [],
      checkedProgramNames: [],
      testVectors: [],
      logs: [],
    }
  }

  const allProgramNames = new Set(document.programs.map((p) => p.name.toUpperCase()))
  const diagnostics: ProgrammingDiagnostic[] = []
  const logs: PouCheckLog[] = []
  const testVectors: PouTestVector[] = []

  const now = new Date()
  const timeStr = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':')

  const addLog = (level: PouCheckLog['level'], message: string) => {
    logs.push({
      id: createUuid(),
      timestamp: timeStr,
      level,
      message,
    })
  }

  const primary = targetPrograms[0]
  addLog('INFO', `[TIẾN TRÌNH] Bắt đầu kiểm tra POU '${primary.name}' (${primary.language}) và các phụ thuộc...`)

  for (const prog of targetPrograms) {
    addLog('INFO', `[PHÂN TÍCH] Đang kiểm tra POU '${prog.name}' (kind: ${prog.kind}, lang: ${prog.language})...`)

    if (prog.language === 'FBD') {
      const rawDoc = buffers?.[prog.programId] ?? prog.document
      const parsedRes = readFbdDocument(rawDoc)
      if (!parsedRes.ok) {
        diagnostics.push({
          code: 'FBD-SCHEMA-JSON-001',
          severity: 'ERROR',
          message: 'Tài liệu FBD không đọc được: định dạng JSON không hợp lệ.',
          messageKey: 'fbd.parse.failed',
          location: { programId: prog.programId, line: 1, column: 1 },
        })
        addLog('ERROR', `[LỖI SƠ ĐỒ] Tài liệu FBD của '${prog.name}' không đọc được định dạng JSON.`)
        continue
      }

      const fbdDoc: FbdDocument = parsedRes.document
      const issues = validateFbdDocument(fbdDoc)
      for (const issue of issues) {
        diagnostics.push({
          code: issue.code,
          severity: 'ERROR',
          message: `Lỗi cấu trúc sơ đồ FBD: ${issue.path}`,
          messageKey: issue.code,
          location: { programId: prog.programId, line: 1, column: 1 },
        })
        addLog('ERROR', `[CẤU TRÚC FBD] Lỗi ${issue.code} tại đường dẫn ${issue.path}`)
      }

      // Collect inputs for test vectors in FBD
      for (const network of fbdDoc.networks) {
        for (const node of network.nodes) {
          if (node.kind === 'INPUT' || node.kind === 'CONSTANT' || node.kind === 'SIGNAL_READ') {
            const varName = typeof node.parameters?.variable === 'string'
              ? node.parameters.variable
              : typeof node.parameters?.signal === 'string'
                ? node.parameters.signal
                : `Node_${node.executionOrder}_${node.typeRef}`
            const rand = generateRandomValue(node.typeRef)
            testVectors.push({
              variableName: varName,
              typeName: node.typeRef,
              direction: 'INPUT',
              value: rand.formatted,
              rawValue: rand.raw,
            })
          }
        }
      }

      for (const network of fbdDoc.networks) {
        const portIdSet = new Set(network.nodes.flatMap((n) => n.ports.map((p) => p.id)))
        for (const node of network.nodes) {
          const typeUpper = node.typeRef.toUpperCase()
          const isDataOrIoNode = ['INPUT', 'OUTPUT', 'CONSTANT', 'SIGNAL_READ', 'SIGNAL_PUBLISH', 'COMMENT'].includes(node.kind)
          const isValidType = isDataOrIoNode
            ? BASE_TYPES.has(typeUpper)
            : allProgramNames.has(typeUpper) ||
              FBD_PALETTE.some((p) => p.typeRef.toUpperCase() === typeUpper) ||
              BASE_TYPES.has(typeUpper)

          if (!isValidType) {
            diagnostics.push({
              code: 'FBD-UNKNOWN-BLOCK',
              severity: 'ERROR',
              message: `Khối '${node.typeRef}' không tồn tại trong dự án hoặc thư viện.`,
              messageKey: 'fbd.unknown.block',
              location: { programId: prog.programId, line: 1, column: 1 },
            })
            addLog('ERROR', `[LỖI KHỐI] Khối '${node.typeRef}' không tồn tại trong thư viện.`)
          }
        }

        for (const wire of network.wires) {
          const fromPortId = wire.from?.portId
          const toPortId = wire.to?.portId
          if (fromPortId && toPortId && (!portIdSet.has(fromPortId) || !portIdSet.has(toPortId))) {
            diagnostics.push({
              code: 'FBD-DANGLING-WIRE',
              severity: 'ERROR',
              message: 'Dây nối (wire) liên kết tới cổng không tồn tại trên block.',
              messageKey: 'fbd.dangling.wire',
              location: { programId: prog.programId, line: 1, column: 1 },
            })
            addLog('ERROR', '[DÂY NỐI] Dây nối trỏ tới cổng không tồn tại.')
          }
        }
      }

      addLog('INFO', `[SƠ ĐỒ FBD] Sơ đồ '${prog.name}' có ${fbdDoc.networks.length} network, ${fbdDoc.networks.reduce((sum, n) => sum + n.nodes.length, 0)} khối, ${fbdDoc.networks.reduce((sum, n) => sum + n.wires.length, 0)} dây.`)
    } else {
      const source =
        buffers?.[prog.programId] ??
        (typeof prog.document === 'string' ? prog.document : '')

      if (!source.trim()) {
        diagnostics.push({
          code: 'ST-EMPTY-SOURCE',
          severity: 'ERROR',
          message: 'Mã nguồn ST không được để trống.',
          messageKey: 'st.empty',
          location: { programId: prog.programId, line: 1, column: 1 },
        })
        addLog('ERROR', `[CÚ PHÁP] Mã nguồn của '${prog.name}' đang để trống.`)
        continue
      }

      try {
        parseSt(source)
        addLog('INFO', `[CÚ PHÁP] Cú pháp ST của '${prog.name}' phân tích thành công (AST hợp lệ).`)
      } catch (err: unknown) {
        const line =
          typeof (err as { line?: number })?.line === 'number'
            ? (err as { line: number }).line
            : 1
        const message = (err as Error)?.message || 'Lỗi cú pháp ST'
        diagnostics.push({
          code: 'ST-SYNTAX-ERROR',
          severity: 'ERROR',
          message,
          messageKey: 'st.syntax.error',
          location: { programId: prog.programId, line, column: 1 },
        })
        addLog('ERROR', `[LỖI CÚ PHÁP] Dòng ${line}: ${message}`)
      }

      const masked = maskStComments(source)
      const kind = prog.kind
      if (kind === 'FUNCTION_BLOCK') {
        const headerMatch = /\bFUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i.exec(masked)
        if (!headerMatch) {
          diagnostics.push({
            code: 'ST-HEADER-MISSING',
            severity: 'ERROR',
            message: `Thiếu khai báo FUNCTION_BLOCK ${prog.name}.`,
            messageKey: 'st.header.missing',
            location: { programId: prog.programId, line: 1, column: 1 },
          })
        } else if (headerMatch[1].toUpperCase() !== prog.name.toUpperCase()) {
          diagnostics.push({
            code: 'ST-HEADER-MISMATCH',
            severity: 'ERROR',
            message: `Tên FUNCTION_BLOCK '${headerMatch[1]}' không khớp với tên POU '${prog.name}'.`,
            messageKey: 'st.header.mismatch',
            location: { programId: prog.programId, line: 1, column: 1 },
          })
        }
        if (!/\bEND_FUNCTION_BLOCK\b/i.test(masked)) {
          diagnostics.push({
            code: 'ST-MISSING-END',
            severity: 'ERROR',
            message: 'Thiếu END_FUNCTION_BLOCK ở cuối khối hàm.',
            messageKey: 'st.missing.end',
            location: { programId: prog.programId, line: source.split('\n').length, column: 1 },
          })
        }
      } else if (kind === 'PROGRAM') {
        const headerMatch = /\bPROGRAM\s+([A-Za-z0-9_]+)/i.exec(masked)
        if (!headerMatch) {
          diagnostics.push({
            code: 'ST-HEADER-MISSING',
            severity: 'ERROR',
            message: `Thiếu khai báo PROGRAM ${prog.name}.`,
            messageKey: 'st.header.missing',
            location: { programId: prog.programId, line: 1, column: 1 },
          })
        } else if (headerMatch[1].toUpperCase() !== prog.name.toUpperCase()) {
          diagnostics.push({
            code: 'ST-HEADER-MISMATCH',
            severity: 'ERROR',
            message: `Tên PROGRAM '${headerMatch[1]}' không khớp với tên POU '${prog.name}'.`,
            messageKey: 'st.header.mismatch',
            location: { programId: prog.programId, line: 1, column: 1 },
          })
        }
        if (!/\bEND_PROGRAM\b/i.test(masked)) {
          diagnostics.push({
            code: 'ST-MISSING-END',
            severity: 'ERROR',
            message: 'Thiếu END_PROGRAM ở cuối chương trình.',
            messageKey: 'st.missing.end',
            location: { programId: prog.programId, line: source.split('\n').length, column: 1 },
          })
        }
      } else if (kind === 'FUNCTION') {
        const headerMatch = /\bFUNCTION\s+([A-Za-z0-9_]+)/i.exec(masked)
        if (!headerMatch) {
          diagnostics.push({
            code: 'ST-HEADER-MISSING',
            severity: 'ERROR',
            message: `Thiếu khai báo FUNCTION ${prog.name}.`,
            messageKey: 'st.header.missing',
            location: { programId: prog.programId, line: 1, column: 1 },
          })
        } else if (headerMatch[1].toUpperCase() !== prog.name.toUpperCase()) {
          diagnostics.push({
            code: 'ST-HEADER-MISMATCH',
            severity: 'ERROR',
            message: `Tên FUNCTION '${headerMatch[1]}' không khớp với tên POU '${prog.name}'.`,
            messageKey: 'st.header.mismatch',
            location: { programId: prog.programId, line: 1, column: 1 },
          })
        }
        if (!/\bEND_FUNCTION\b/i.test(masked)) {
          diagnostics.push({
            code: 'ST-MISSING-END',
            severity: 'ERROR',
            message: 'Thiếu END_FUNCTION ở cuối hàm.',
            messageKey: 'st.missing.end',
            location: { programId: prog.programId, line: source.split('\n').length, column: 1 },
          })
        }
      }

      // Check division by literal zero
      const divZeroRegex = /\/[ \t]*0(?:\.0+)?\b/g
      let divZeroMatch: RegExpExecArray | null
      while ((divZeroMatch = divZeroRegex.exec(masked)) !== null) {
        const line = source.slice(0, divZeroMatch.index).split('\n').length
        diagnostics.push({
          code: 'ST-DIVISION-BY-ZERO',
          severity: 'ERROR',
          message: 'Phát hiện phép chia cho 0 trong biểu thức logic.',
          messageKey: 'st.division.zero',
          location: { programId: prog.programId, line, column: 1 },
        })
        addLog('ERROR', `[LỖI LOGIC] Dòng ${line}: Phát hiện phép chia cho 0.`)
      }

      // Extract ST variables and generate independent random test vectors
      const stVars = extractStVariables(source)
      for (const v of stVars) {
        const rand = generateRandomValue(v.type)
        testVectors.push({
          variableName: v.name,
          typeName: v.type,
          direction: v.direction,
          value: rand.formatted,
          rawValue: rand.raw,
        })
      }

      const refIndex = buildStReferenceIndex(source)
      for (const entry of refIndex.symbols) {
        const typeUpper = entry.typeName.toUpperCase()
        const isValidType =
          BASE_TYPES.has(typeUpper) ||
          allProgramNames.has(typeUpper) ||
          FBD_PALETTE.some((p) => p.typeRef.toUpperCase() === typeUpper)

        if (!isValidType) {
          const line = source.slice(0, entry.declarationOffset).split('\n').length
          diagnostics.push({
            code: 'ST-UNKNOWN-TYPE',
            severity: 'ERROR',
            message: `Kiểu dữ liệu '${entry.typeName}' của biến '${entry.name}' không tồn tại trong dự án.`,
            messageKey: 'st.unknown.type',
            location: { programId: prog.programId, line, column: 1 },
          })
          addLog('ERROR', `[KIỂU DỮ LIỆU] Dòng ${line}: Kiểu '${entry.typeName}' của biến '${entry.name}' không tồn tại.`)
        }
      }
    }
  }

  // Log test vectors
  const inputVectors = testVectors.filter((v) => v.direction === 'INPUT')
  if (inputVectors.length > 0) {
    addLog('TEST', `[VÉC-TƠ KIỂM THỬ] Đã khởi tạo ngẫu nhiên độc lập cho ${inputVectors.length} biến đầu vào:`)
    for (const tv of inputVectors) {
      addLog('TEST', `  • ${tv.variableName} (${tv.typeName}): ${tv.value}`)
    }
    addLog('INFO', '[MÔ PHỎNG LOGIC] Đang chạy kiểm thử logic với tập giá trị véc-tơ thử nghiệm...')

    // Check simple relational expressions against test vectors
    const vectorMap = new Map(testVectors.map((v) => [v.variableName.toUpperCase(), v.rawValue]))
    if (primary.language === 'ST') {
      const source = buffers?.[primary.programId] ?? (typeof primary.document === 'string' ? primary.document : '')
      const relRegex = new RegExp('([A-Za-z_][A-Za-z0-9_]*)\\s*:=\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*(>|<|>=|<=|=)\\s*([0-9.]+)', 'g')
      let match: RegExpExecArray | null
      while ((match = relRegex.exec(source)) !== null) {
        const targetVar = match[1]
        const srcVar = match[2].toUpperCase()
        const op = match[3]
        const threshold = parseFloat(match[4])
        const val = vectorMap.get(srcVar)
        if (typeof val === 'number') {
          let resBool = false
          if (op === '>') resBool = val > threshold
          else if (op === '<') resBool = val < threshold
          else if (op === '>=') resBool = val >= threshold
          else if (op === '<=') resBool = val <= threshold
          else if (op === '=') resBool = val === threshold
          addLog('TEST', `  [Logic] ${targetVar} := ${match[2]} (${val}) ${op} ${threshold} => ${resBool ? 'TRUE (1)' : 'FALSE (0)'}`)
        }
      }
    }
  } else {
    addLog('INFO', '[VÉC-TƠ KIỂM THỬ] Không có biến đầu vào (VAR_INPUT) nào cần tạo giá trị thử nghiệm.')
  }

  if (diagnostics.length === 0) {
    addLog('SUCCESS', '[HOÀN TẤT] Kiểm tra thành công! Không có lỗi cú pháp, cấu trúc hay logic.')
  } else {
    addLog('WARN', `[HOÀN TẤT] Kiểm tra hoàn tất với ${diagnostics.length} cảnh báo/lỗi. Xem chi tiết tại tab Vấn đề.`)
  }

  return {
    diagnostics,
    checkedProgramIds: targetPrograms.map((p) => p.programId),
    checkedProgramNames: targetPrograms.map((p) => p.name),
    testVectors,
    logs,
  }
}
