/**
 * Trình phân tích luồng điều khiển và đánh giá điều kiện chạy của mã ST
 * (IEC 61131-3 Structured Text) trong chế độ Gỡ lỗi (Debug Mode).
 *
 * Phục vụ yêu cầu nhảy dòng chính xác theo logic:
 * - Nhảy đúng nhánh IF ... THEN ... ELSIF ... ELSE ... END_IF thỏa mãn, bỏ qua các nhánh sai.
 * - Nhảy đúng nhánh CASE ... OF ... ELSE ... END_CASE theo giá trị selector.
 * - Tự động tìm vị trí khai báo/gán của biến vừa nhập từ Virtual Inputs để nhảy tới chạy lại.
 */

export function parseTimeToMs(s: string): number {
  const m = s.match(/T#(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?/i)
  if (!m) return 0
  const d = parseInt(m[1] || '0', 10)
  const h = parseInt(m[2] || '0', 10)
  const min = parseInt(m[3] || '0', 10)
  const sec = parseInt(m[4] || '0', 10)
  const ms = parseInt(m[5] || '0', 10)
  return (d * 86400 + h * 3600 + min * 60 + sec) * 1000 + ms
}

export function evaluateStExpression(
  expr: string,
  lookupVar: (name: string) => unknown,
): unknown {
  let jsExpr = expr.trim()
  if (!jsExpr) return null

  // Chuyển toán tử ST sang JS
  jsExpr = jsExpr
    .replace(/\bAND\b/gi, ' && ')
    .replace(/\bOR\b/gi, ' || ')
    .replace(/\bNOT\b/gi, ' ! ')
    .replace(/\bXOR\b/gi, ' !== ')
    .replace(/\bMOD\b/gi, ' % ')
    .replace(/<>/g, ' !== ')
    .replace(/<=/g, ' __LE__ ')
    .replace(/>=/g, ' __GE__ ')
    .replace(/:=/g, ' __ASSIGN__ ')
    .replace(/=/g, ' === ')
    .replace(/__LE__/g, ' <= ')
    .replace(/__GE__/g, ' >= ')
    .replace(/__ASSIGN__/g, ' = ')
    .replace(/\bTRUE\b/gi, ' true ')
    .replace(/\bFALSE\b/gi, ' false ')

  // Thay hằng thời gian T#... sang mili-giây
  jsExpr = jsExpr.replace(/T#[0-9a-zA-Z_]+/gi, (m) => String(parseTimeToMs(m)))

  // 1. Thay định danh biến và thuộc tính trước (bảo lưu tên hàm IEC chuẩn)
  jsExpr = jsExpr.replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?)\b/g, (match) => {
    const upper = match.toUpperCase()
    if (['TRUE', 'FALSE', 'NULL', 'UNDEFINED', 'SEL', 'LIMIT', 'MIN', 'MAX', 'MATH'].includes(upper)) {
      return match
    }
    const rawVal = lookupVar(match)
    if (rawVal === undefined || rawVal === null) return '0'
    if (typeof rawVal === 'boolean') return rawVal ? 'true' : 'false'
    if (typeof rawVal === 'number') return isFinite(rawVal) ? String(rawVal) : '0'
    const s = String(rawVal).trim()
    if (s.toUpperCase() === 'TRUE') return 'true'
    if (s.toUpperCase() === 'FALSE') return 'false'
    if (/^T#[0-9a-zA-Z_]+$/i.test(s)) return String(parseTimeToMs(s))
    if (!isNaN(Number(s)) && s !== '') return String(Number(s))
    return JSON.stringify(s)
  })

  // 2. Xử lý các hàm chuẩn IEC sau khi biến đã được thay thế (tránh xung đột từ khoá lồng)
  jsExpr = jsExpr.replace(/\bSEL\s*\(([^,]+),([^,]+),([^)]+)\)/gi, '($1 ? $3 : $2)')
  jsExpr = jsExpr.replace(/\bLIMIT\s*\(([^,]+),([^,]+),([^)]+)\)/gi, '__LIMIT__($2, $1, $3)')
  jsExpr = jsExpr.replace(/(?<!Math\.)\bMIN\s*\(([^,]+),([^)]+)\)/gi, 'Math.min($1, $2)')
  jsExpr = jsExpr.replace(/(?<!Math\.)\bMAX\s*\(([^,]+),([^)]+)\)/gi, 'Math.max($1, $2)')
  jsExpr = jsExpr.replace(/__LIMIT__\(([^,]+),([^,]+),([^)]+)\)/g, 'Math.min(Math.max($1, $2), $3)')

  try {
    return new Function('return (' + jsExpr + ')')()
  } catch {
    return null
  }
}

export function evaluateStCondition(
  expr: string,
  lookupVar: (name: string) => unknown,
): boolean {
  const val = evaluateStExpression(expr, lookupVar)
  return Boolean(val)
}

/**
 * Tìm vị trí kết thúc phần khai báo biến (sau END_VAR cuối cùng).
 * Các dòng sau mốc này chính là thân lệnh có thể chạy theo chu kỳ.
 */
export function findBodyStartIndex(maskedLines: string[]): number {
  let lastEndVar = -1
  for (let i = 0; i < maskedLines.length; i++) {
    if (/\bEND_VAR\b/i.test(maskedLines[i])) {
      lastEndVar = i
    }
  }
  return lastEndVar !== -1 ? lastEndVar + 1 : 0
}

/**
 * Trích xuất danh sách các dòng sẽ thực thi trong thân lệnh ST dựa trên giá trị biến hiện tại.
 */
function traceStatements(
  maskedLines: string[],
  start: number,
  end: number,
  lookupVar: (name: string) => unknown,
  outLines: number[],
) {
  let i = start
  while (i < end) {
    const text = maskedLines[i]?.trim() ?? ''
    if (!text) {
      i++
      continue
    }

    // 1. Kiểm tra cấu trúc IF
    const ifMatch = text.match(/\bIF\s+(.+?)\s+THEN\b/i)
    if (ifMatch && !/^\s*(?:[0-9]+(?:\s*,\s*[0-9]+)*|ELSE)\s*:/i.test(text)) {
      // Tìm các mốc ELSIF, ELSE, END_IF cùng cấp lồng
      let nest = 0
      let endIfIdx = -1
      const branchPoints: Array<{ type: 'if' | 'elsif' | 'else'; index: number; cond?: string }> = [
        { type: 'if', index: i, cond: ifMatch[1] },
      ]

      for (let j = i + 1; j < end; j++) {
        const line = maskedLines[j]?.trim() ?? ''
        if (/\bIF\s+(.+?)\s+THEN\b/i.test(line)) {
          nest++
        } else if (/\bEND_IF\b/i.test(line)) {
          if (nest === 0) {
            endIfIdx = j
            break
          }
          nest--
        } else if (nest === 0) {
          const elsifMatch = line.match(/\bELSIF\s+(.+?)\s+THEN\b/i)
          if (elsifMatch) {
            branchPoints.push({ type: 'elsif', index: j, cond: elsifMatch[1] })
          } else if (/^\s*ELSE\b/i.test(line)) {
            branchPoints.push({ type: 'else', index: j })
          }
        }
      }

      if (endIfIdx === -1) {
        // Thiếu END_IF, nhảy 1 dòng tránh lặp vô tận
        outLines.push(i)
        i++
        continue
      }

      // Đánh giá nhánh nào của IF được kích hoạt
      let activeBranchIndex = -1
      for (let b = 0; b < branchPoints.length; b++) {
        const bp = branchPoints[b]
        if (bp.type === 'if' || bp.type === 'elsif') {
          if (evaluateStCondition(bp.cond || '', lookupVar)) {
            activeBranchIndex = b
            break
          }
        } else if (bp.type === 'else') {
          activeBranchIndex = b
          break
        }
      }

      // Dòng IF luôn được thăm để người dùng thấy con trỏ kiểm tra điều kiện
      outLines.push(i)

      if (activeBranchIndex !== -1) {
        const activeBp = branchPoints[activeBranchIndex]
        if (activeBp.type !== 'if') {
          outLines.push(activeBp.index)
        }
        const bodyStart = activeBp.index + 1
        const bodyEnd =
          activeBranchIndex + 1 < branchPoints.length
            ? branchPoints[activeBranchIndex + 1].index
            : endIfIdx

        if (bodyStart < bodyEnd) {
          traceStatements(maskedLines, bodyStart, bodyEnd, lookupVar, outLines)
        }
      }

      i = endIfIdx + 1
      continue
    }

    // 2. Kiểm tra cấu trúc CASE
    const caseMatch = text.match(/\bCASE\s+(.+?)\s+OF\b/i)
    if (caseMatch) {
      const selectorExpr = caseMatch[1]
      let nest = 0
      let endCaseIdx = -1
      const caseBranches: Array<{
        index: number
        isElse: boolean
        matchValues: number[]
      }> = []

      for (let j = i + 1; j < end; j++) {
        const line = maskedLines[j]?.trim() ?? ''
        if (/\bCASE\s+(.+?)\s+OF\b/i.test(line)) {
          nest++
        } else if (/\bEND_CASE\b/i.test(line)) {
          if (nest === 0) {
            endCaseIdx = j
            break
          }
          nest--
        } else if (nest === 0) {
          const branchLabelMatch = line.match(/^\s*([0-9]+(?:\s*,\s*[0-9]+)*)\s*:/)
          if (branchLabelMatch) {
            const nums = branchLabelMatch[1].split(',').map((x) => parseInt(x.trim(), 10))
            caseBranches.push({ index: j, isElse: false, matchValues: nums })
          } else if (/^\s*ELSE\b/i.test(line)) {
            caseBranches.push({ index: j, isElse: true, matchValues: [] })
          }
        }
      }

      if (endCaseIdx === -1) {
        outLines.push(i)
        i++
        continue
      }

      outLines.push(i)

      const selectorVal = evaluateStExpression(selectorExpr, lookupVar)
      const selectorNum =
        typeof selectorVal === 'number'
          ? selectorVal
          : !isNaN(Number(selectorVal))
          ? Number(selectorVal)
          : -999999

      let matchingBranchIdx = -1
      let elseBranchIdx = -1

      for (let cb = 0; cb < caseBranches.length; cb++) {
        const b = caseBranches[cb]
        if (b.isElse) {
          elseBranchIdx = cb
        } else if (b.matchValues.includes(selectorNum)) {
          matchingBranchIdx = cb
          break
        }
      }

      const targetBranchIdx = matchingBranchIdx !== -1 ? matchingBranchIdx : elseBranchIdx
      if (targetBranchIdx !== -1) {
        const targetBranch = caseBranches[targetBranchIdx]
        outLines.push(targetBranch.index)

        const branchBodyStart = targetBranch.index + 1
        const branchBodyEnd =
          targetBranchIdx + 1 < caseBranches.length
            ? caseBranches[targetBranchIdx + 1].index
            : endCaseIdx

        if (branchBodyStart < branchBodyEnd) {
          traceStatements(maskedLines, branchBodyStart, branchBodyEnd, lookupVar, outLines)
        }
      }

      i = endCaseIdx + 1
      continue
    }

    // 3. Lệnh bình thường (gán, gọi hàm, v.v.)
    if (!/^\s*(?:END_IF|END_CASE|END_PROGRAM|PROGRAM)\b/i.test(text)) {
      outLines.push(i)
    }
    i++
  }
}

/**
 * Tính toán chuỗi các dòng thực thi của chương trình ST theo đúng luồng logic:
 * - Phần khai báo (trước body): đưa các dòng khai báo biến có giá trị vào chuỗi.
 * - Thân chương trình: chỉ đưa các dòng trên nhánh logic thực sự thỏa mãn.
 */
export function computeExecutedLineSequence(
  rawLines: string[],
  maskedLines: string[],
  lookupVar: (name: string) => unknown,
): number[] {
  const out: number[] = []
  const bodyStart = findBodyStartIndex(maskedLines)

  // 1. Dòng khai báo trước thân lệnh
  for (let i = 0; i < bodyStart; i++) {
    const t = maskedLines[i]?.trim() ?? ''
    if (t.length > 0 && !/^\s*(?:PROGRAM|VAR|VAR_INPUT|VAR_OUTPUT|VAR_RETAIN|VAR_TEMP|VAR_CONSTANT|END_VAR)\b/i.test(t)) {
      out.push(i)
    }
  }

  // 2. Thân lệnh thực thi
  traceStatements(maskedLines, bodyStart, maskedLines.length, lookupVar, out)

  return out
}

/**
 * Tìm dòng mã đầu tiên sử dụng biến (ưu tiên trong thân lệnh thực thi, sau đó mới tới khai báo).
 */
export function findFirstUsageLine(rawLines: string[], maskedLines: string[], varName: string): number {
  const bodyStart = findBodyStartIndex(maskedLines)
  const regex = new RegExp('\\b' + varName + '\\b', 'i')

  // 1. Tìm trong thân chương trình (lệnh thực thi)
  for (let i = bodyStart; i < rawLines.length; i++) {
    if (regex.test(maskedLines[i])) {
      return i
    }
  }

  // 2. Dự phòng: tìm dòng khai báo
  for (let i = 0; i < bodyStart; i++) {
    if (regex.test(maskedLines[i])) {
      return i
    }
  }

  return -1
}
