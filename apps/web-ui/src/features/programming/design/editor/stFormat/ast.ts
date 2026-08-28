/**
 * `DEV-PROG-019` — cây cú pháp ST cho formatter.
 *
 * Cây này TÁCH BẠCH hai loại thông tin, và sự tách bạch đó là điều kiện để
 * formatter chứng minh được nó không đổi logic:
 *
 * - **Ngữ nghĩa**: tên, toán tử, literal, cấu trúc khối. So sánh trước/sau khi
 *   in ra chính là phép kiểm "AST trước == AST sau".
 * - **Trình bày** (`Trivia`): chú thích và dòng trống. Chúng được GIỮ nguyên
 *   văn nhưng KHÔNG tham gia phép so ngữ nghĩa — trừ dãy chú thích, được so
 *   riêng để formatter không thể đánh rơi một dòng chú thích nào.
 */

export interface StComment {
  /** Nguyên văn kể cả `(*`/`*)` hay `//`. Formatter KHÔNG sửa nội dung. */
  text: string
  blankBefore: boolean
}

export interface StTrivia {
  /** Chú thích đứng riêng dòng, phía trên node. */
  leading: StComment[]
  /** Chú thích nằm CÙNG dòng, sau node. `null` = không có. */
  trailing: string | null
  /** Có ít nhất một dòng trống ngay phía trên node. */
  blankBefore: boolean
}

export function emptyTrivia(): StTrivia {
  return { leading: [], trailing: null, blankBefore: false }
}

export type StExpr =
  | { kind: 'Literal'; literal: 'number' | 'time' | 'string' | 'bool'; text: string }
  | { kind: 'Ident'; name: string }
  | { kind: 'Member'; object: StExpr; name: string }
  | { kind: 'Index'; object: StExpr; index: StExpr }
  | { kind: 'Call'; callee: StExpr; args: StArg[] }
  | { kind: 'Unary'; operator: string; operand: StExpr }
  | { kind: 'Binary'; operator: string; left: StExpr; right: StExpr }
  | { kind: 'Paren'; inner: StExpr }

export interface StArg {
  /** Tên tham số của `IN := x`; `null` cho tham số theo vị trí. */
  name: string | null
  /** `=>` của tham số ra (`Q => Done`). `:=` là mặc định. */
  output: boolean
  value: StExpr
}

export interface StVarDecl {
  kind: 'VarDecl'
  names: string[]
  typeName: string
  /** Phần sau tên kiểu, giữ NGUYÊN VĂN (ví dụ `[1..10] OF INT`). */
  typeSuffix: string | null
  initial: StExpr | null
  trivia: StTrivia
}

export interface StVarBlock {
  kind: 'VarBlock'
  /** `VAR`, `VAR_INPUT`, hoặc `VAR` + `RETAIN` — giữ đúng thứ tự đã viết. */
  keywords: string[]
  decls: StVarDecl[]
  trivia: StTrivia
  /** Chú thích đứng ngay trên `END_VAR`. */
  endTrivia: StTrivia
}

export interface StIfBranch {
  condition: StExpr
  body: StStmt[]
  /** Chú thích của chính dòng `IF`/`ELSIF`. */
  trivia: StTrivia
}

export interface StCaseBranch {
  /** Nhãn nguyên văn (`0`, `10`, `1..5`, `A, B`) — giữ nguyên, không tính lại. */
  labels: string[]
  body: StStmt[]
  trivia: StTrivia
}

export type StStmt =
  | { kind: 'Assign'; target: StExpr; value: StExpr; trivia: StTrivia }
  | { kind: 'CallStmt'; callee: StExpr; args: StArg[]; trivia: StTrivia }
  | {
      kind: 'If'
      branches: StIfBranch[]
      elseBody: StStmt[] | null
      elseTrivia: StTrivia
      trivia: StTrivia
      endTrivia: StTrivia
    }
  | {
      kind: 'Case'
      selector: StExpr
      branches: StCaseBranch[]
      elseBody: StStmt[] | null
      elseTrivia: StTrivia
      trivia: StTrivia
      endTrivia: StTrivia
    }
  | {
      kind: 'For'
      variable: string
      from: StExpr
      to: StExpr
      by: StExpr | null
      body: StStmt[]
      trivia: StTrivia
      endTrivia: StTrivia
    }
  | { kind: 'While'; condition: StExpr; body: StStmt[]; trivia: StTrivia; endTrivia: StTrivia }
  | { kind: 'Repeat'; body: StStmt[]; condition: StExpr; trivia: StTrivia; endTrivia: StTrivia }
  | { kind: 'Jump'; keyword: 'RETURN' | 'EXIT' | 'CONTINUE'; trivia: StTrivia }

export interface StPou {
  kind: 'Pou'
  keyword: string
  name: string
  /** Kiểu trả về của FUNCTION (`: REAL`); `null` với PROGRAM/FUNCTION_BLOCK. */
  returnType: string | null
  varBlocks: StVarBlock[]
  body: StStmt[]
  trivia: StTrivia
  endTrivia: StTrivia
}

export interface StUnit {
  kind: 'Unit'
  pous: StPou[]
  /** Chú thích còn lại sau POU cuối — không được đánh rơi. */
  trailingComments: StComment[]
}
