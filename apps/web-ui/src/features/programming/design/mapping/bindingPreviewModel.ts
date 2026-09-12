import type { ProgrammingBindingPreview, ProgrammingBindingValidationIssue } from '../../api/generated/client'

export type BindingPreviewDecision = {
  status: 'ALLOW' | 'WARN' | 'BLOCK' | 'UNAVAILABLE'
  assignable: boolean
  issues: ProgrammingBindingValidationIssue[]
  reason?: 'MISSING_OR_OLD_SERVER' | 'MALFORMED_RESPONSE' | 'STALE_RESPONSE' | 'UNKNOWN_REASON_CODE'
}

export type BindingPreviewExpectation = Pick<ProgrammingBindingPreview,
  'projectId' | 'draftRevisionId' | 'baseRevisionId' | 'etag'>

const PUBLIC_CODE_BY_DETAIL = new Map<string, ProgrammingBindingValidationIssue['code']>([
  ['PGM-MAP-VARIABLE-001', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-BINDING-001', 'PRG-ERR-REQ-001'],
  ['PGM-MAP-BINDING-002', 'PRG-ERR-REQ-001'],
  ['PGM-MAP-POINT-001', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-DIRECTION-001', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-ELIGIBILITY-001', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-TYPE-001', 'PRG-ERR-MAP-004'],
  ['PGM-MAP-WRITABLE-001', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-WRITABLE-002', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-READABLE-001', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-UNIT-001', 'PRG-ERR-MAP-004'],
  ['PGM-MAP-QUALITY-POLICY-001', 'PRG-ERR-REQ-001'],
  ['PGM-MAP-QUALITY-001', 'PRG-ERR-MAP-003'],
  ['PGM-MAP-OWNER-001', 'PRG-ERR-OUTPUT-OWNER-001'],
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validationIssue(value: unknown): value is ProgrammingBindingValidationIssue {
  if (!value || typeof value !== 'object') return false
  const issue = value as Record<string, unknown>
  return typeof issue.code === 'string'
    && typeof issue.detailCode === 'string'
    && (issue.severity === 'WARNING' || issue.severity === 'ERROR')
    && typeof issue.field === 'string'
}

/**
 * Thu hẹp phản hồi preview tại biên FE. Hàm chỉ đọc verdict server; không so
 * type/unit/writable/quality lần thứ hai. Phản hồi thiếu, đời cũ, mâu thuẫn
 * hoặc mang reason code chưa biết đều khóa Assign để client không tự nới luật.
 */
export function bindingPreviewDecision(value: unknown, expected: BindingPreviewExpectation): BindingPreviewDecision {
  if (value === null || value === undefined) {
    return { status: 'UNAVAILABLE', assignable: false, issues: [], reason: 'MISSING_OR_OLD_SERVER' }
  }
  if (typeof value !== 'object') {
    return { status: 'UNAVAILABLE', assignable: false, issues: [], reason: 'MALFORMED_RESPONSE' }
  }
  const preview = value as Partial<ProgrammingBindingPreview>
  const verdict = preview.verdict
  if (preview.schemaVersion !== '1.0' || (verdict !== 'ALLOW' && verdict !== 'WARN' && verdict !== 'BLOCK')
    || !Array.isArray(preview.issues) || preview.issues.length > 32 || !preview.issues.every(validationIssue)
    || typeof preview.projectId !== 'string' || !UUID.test(preview.projectId)
    || typeof preview.draftRevisionId !== 'string' || !UUID.test(preview.draftRevisionId)
    || typeof preview.baseRevisionId !== 'string' || !UUID.test(preview.baseRevisionId)
    || typeof preview.etag !== 'string' || preview.etag.length === 0) {
    return { status: 'UNAVAILABLE', assignable: false, issues: [], reason: 'MALFORMED_RESPONSE' }
  }
  if (preview.projectId !== expected.projectId || preview.draftRevisionId !== expected.draftRevisionId
    || preview.baseRevisionId !== expected.baseRevisionId || preview.etag !== expected.etag) {
    return { status: 'UNAVAILABLE', assignable: false, issues: [], reason: 'STALE_RESPONSE' }
  }
  const issues = [...preview.issues]
  if (issues.some((issue) => !PUBLIC_CODE_BY_DETAIL.has(issue.detailCode))) {
    return { status: 'BLOCK', assignable: false, issues, reason: 'UNKNOWN_REASON_CODE' }
  }
  if (issues.some((issue) => PUBLIC_CODE_BY_DETAIL.get(issue.detailCode) !== issue.code)) {
    return { status: 'UNAVAILABLE', assignable: false, issues, reason: 'MALFORMED_RESPONSE' }
  }
  const hasError = issues.some((issue) => issue.severity === 'ERROR')
  const hasWarning = issues.some((issue) => issue.severity === 'WARNING')
  const consistent = verdict === 'ALLOW'
    ? issues.length === 0
    : verdict === 'WARN'
      ? hasWarning && !hasError
      : hasError
  if (!consistent) {
    return { status: 'UNAVAILABLE', assignable: false, issues, reason: 'MALFORMED_RESPONSE' }
  }
  return { status: verdict, assignable: verdict !== 'BLOCK', issues }
}
