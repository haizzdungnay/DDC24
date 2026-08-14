/**
 * DTO chiếu 1-1 theo `contracts/openapi/openapi.yaml` nhóm `/programming/*`
 * (schema `ProgrammingCapabilities`, `ProgrammingRuntime`, `ProgrammingProject`
 * …). Generator `scripts/generate-programming-client.mjs` chỉ sinh type cho
 * nhóm Commission (`api/generated/client.ts`); các schema đọc còn lại được
 * khai tay ở đây và PHẢI khớp field/kiểu với OpenAPI — không tự thêm field.
 */

import type { ProgrammingImpact } from '../api/generated/client'

export type ProgrammingTargetState = 'READY' | 'DEGRADED' | 'UNAVAILABLE'

export interface ProgrammingCapabilities {
  schemaVersion: string
  profile: string
  targetState: ProgrammingTargetState
  languages: Array<'ST' | 'FBD'>
  types: Array<'BOOL' | 'INT' | 'DINT' | 'UINT' | 'REAL' | 'TIME'>
  taskPeriodsMs: number[]
  limits: {
    projectsPerController: number
    tasks: number
    stSourceBytes: number
    variables: number
    statements: number
    fbdBlocks: number
    fbdConnections: number
    artifactBytes: number
    bindings: number
  }
}

export type ProgrammingTaskState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'FAULT' | 'UNKNOWN'

export interface ProgrammingRuntime {
  schemaVersion: string
  controllerId: string
  producerState: ProgrammingTargetState
  activeRevisionId: string | null
  lkgRevisionId: string | null
  taskState: ProgrammingTaskState
  safeState: boolean
  /** true CHỈ KHI `safeState` đến từ trigger T7 (no_controller) đơn độc ở
   *  Core — không có iop_fault/stale/graph_input_bad/overrun đi kèm. Commission
   *  một Program có output sẽ tự giải quyết trường hợp này. */
  safeStateNoControllerOnly: boolean
  observedAt: string
  task?: ProgrammingTaskMetrics | null
}

export interface ProgrammingTaskMetrics {
  taskId: string
  periodMs: number
  budgetMs: number
  state: 'STOPPED' | 'RUNNING' | 'FAULT'
  runCount: number
  missedReleaseCount: number
  lastExecNs: number
  maxExecNs: number
  overrunCount: number
  consecutiveOverruns: number
}

export interface ProgrammingMonitorSample {
  variableId: string
  variableName: string
  programId: string
  point: ProgrammingPointIdentity
  direction: 'READ' | 'WRITE' | 'READ_WRITE'
  dataType: string
  unit?: string
  programValue: unknown
  actualValue: unknown
  overriddenBy: string | null
  effectivePriority: number | null
  overrideActor: string | null
  overrideRemainingS: number | null
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'OFFLINE' | 'UNKNOWN'
  observedAt: string
  freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE'
}

export interface ProgrammingMonitorPage {
  schemaVersion: string
  activeRevisionId: string | null
  safeState: boolean
  task: ProgrammingTaskMetrics | null
  items: ProgrammingMonitorSample[]
}

export interface ProgrammingTraceRequest {
  schemaVersion: '1.0'
  variableIds: string[]
  durationMs: number
  samplePeriodMs: number
}

export interface ProgrammingTraceAccepted {
  traceId: string
  statusUrl: string
  state: 'RUNNING' | 'COMPLETED'
  requestHash: string
  acceptedAt: string
  correlationId: string
}

export interface ProgrammingTraceValue {
  variableId: string
  programValue: unknown
  actualValue: unknown
  overriddenBy: string | null
  effectivePriority: number | null
  quality: ProgrammingMonitorSample['quality']
  freshness: ProgrammingMonitorSample['freshness']
}

export interface ProgrammingTrace {
  traceId: string
  state: 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'FAILED'
  variableIds: string[]
  durationMs: number
  samplePeriodMs: number
  startedAt: string
  updatedAt: string
  stopReason: 'DURATION_REACHED' | 'QUOTA_REACHED' | 'USER_STOPPED' | 'SOURCE_UNAVAILABLE' | null
  droppedSamples: number
  samples: Array<{ sequence: number; observedAt: string; values: ProgrammingTraceValue[] }>
}

/** Data Model §3.3 — Program document. `document` là source ST (string) khi
 * `language==='ST'`, hoặc `FbdDocument` (xem `features/programming/fbd/model`)
 * khi `language==='FBD'`. */
export interface ProgrammingProgram {
  programId: string
  name: string
  kind: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
  language: 'ST' | 'FBD'
  document: unknown
  executionOrder?: number
  functionalTags?: string[]
}

/** Data Model §3.4. */
export interface ProgrammingVariable {
  variableId: string
  programId: string
  name: string
  type: string
  class: 'LOCAL' | 'INPUT' | 'OUTPUT' | 'INOUT' | 'GLOBAL' | 'MAPPED' | 'RETAIN' | 'CONSTANT' | 'PARAMETER'
  initialValue: unknown
  retain: boolean
}

export type ProgrammingPointCategory = 'LOCAL' | 'VP' | 'MB_RTU'

export interface ProgrammingPointIdentity {
  category: ProgrammingPointCategory
  pointId: string
  deviceId?: string
}

/** Data Model §3.5 — identity là discriminated union; RTU luôn có `deviceId`. */
export interface ProgrammingBinding {
  bindingId: string
  variableId: string
  point: ProgrammingPointIdentity
  direction: 'READ' | 'WRITE' | 'READ_WRITE'
  dataType: string
  unit?: string
  writable: boolean
  qualityPolicy: 'REQUIRE_GOOD' | 'ALLOW_UNCERTAIN' | 'FAIL_POLICY'
}

/** Data Model §3.6 — Rev A đúng một Task. */
export interface ProgrammingTaskConfig {
  taskId: string
  name?: string
  enabled?: boolean
  periodMs: 1000 | 5000 | 30000
  programOrder: string[]
}

/** Data Model §7 — canonical document của Draft (`drafts.content_json`). */
export interface ProgrammingDraftDocument {
  schemaVersion: number
  project: { projectId: string; name: string; functionalTags: string[] }
  programs: ProgrammingProgram[]
  variables: ProgrammingVariable[]
  bindings: ProgrammingBinding[]
  task: ProgrammingTaskConfig
  library: { profile: string; version: string }
}

export interface ProgrammingProject {
  projectId: string
  name: string
  etag: string
  activeRevisionId: string | null
  draftRevisionId: string
  /** Revision nền hiện hành; dùng cho save/seal kế tiếp, không đồng nhất với Draft ID sau lần seal đầu. */
  baseRevisionId: string
  updatedAt: string
  /** Chỉ có ở `GET /projects/{projectId}`, không có ở item của `GET /projects`. */
  draft?: ProgrammingDraftDocument
}

/** Payload của từng phần tử `operations[]` trong `PATCH .../draft`
 * (IFSPEC-PROG-001 §4; `apps/web-api/internal/programming/application/draft.go`
 * là authority — đây chỉ là type FE, không phải nơi quyết định hợp lệ). */
export type ProgrammingDraftOperation =
  | { op: 'setFunctionalTags'; tags: string[] }
  | { op: 'replaceProgramSource'; programId: string; language: 'ST' | 'FBD'; source: string }
  | { op: 'upsertProgram'; program: ProgrammingProgram }
  | { op: 'removeProgram'; programId: string }
  | { op: 'upsertVariable'; variable: ProgrammingVariable }
  | { op: 'removeVariable'; variableId: string }
  | { op: 'upsertBinding'; binding: ProgrammingBinding }
  | { op: 'removeBinding'; bindingId: string }
  | { op: 'setTask'; task: ProgrammingTaskConfig }

export interface ProgrammingDiagnostic {
  code: string
  detailCode?: string
  severity: 'ERROR' | 'WARNING' | 'INFO' | string
  messageKey: string
  location?: { programId?: string; line?: number; column?: number; bindingId?: string; [key: string]: unknown }
  args?: Record<string, unknown>
}

/** `GET /point-catalog` — chiếu Point authority hiện hữu (LOCAL/VP/MB_RTU),
 * KHÔNG phải authority Point thứ hai. Quality sáu mức thật từ producer. */
export interface ProgrammingPointCatalogEntry {
  category: ProgrammingPointCategory
  pointId: string
  deviceId?: string
  name: string
  dataType: string
  unit?: string
  direction: 'READ' | 'WRITE' | 'READ_WRITE'
  writable: boolean
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'OFFLINE' | 'UNKNOWN'
  value: unknown
  observedAt?: string
}

export interface ProgrammingPointCatalogPage {
  items: ProgrammingPointCatalogEntry[]
  nextCursor?: string | null
}

export interface ProgrammingRevisionChange {
  objectId: string
  kind: string
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED'
  category: string
  beforeSha256?: string | null
  afterSha256?: string | null
}

export interface ProgrammingRevisionChanges {
  fromRevisionId: string
  toRevisionId: string
  impact: ProgrammingImpact
  changes: ProgrammingRevisionChange[]
}

/** `GET /operations/{operationId}` — DM-PROG-001 §3.9 state machine. */
export type ProgrammingOperationState =
  | 'REQUESTED'
  | 'PREFLIGHT'
  | 'STAGED'
  | 'APPLYING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED'
  | 'UNKNOWN_RECONCILING'

export interface ProgrammingOperationView {
  operationId: string
  kind?: 'COMMISSION' | 'RESTORE' | 'IMPORT' | 'RESET_RETAIN' | string
  state: ProgrammingOperationState
  step: string
  requestedRevisionId: string | null
  previousActiveRevisionId: string | null
  actualActiveRevisionId: string | null
  keepsRunningRevision: boolean
  startedAt: string
  updatedAt: string
}

export interface ProgrammingOperationPage {
  items: ProgrammingOperationView[]
  nextCursor?: string | null
}

/** `GET /overrides` — chỉ Point đang thật sự bị force; `actorId` rỗng khi
 * registry không biết ai đã force (không được bịa — RSK-PROG-010). */
export interface ProgrammingOverrideEntry {
  category: ProgrammingPointCategory
  pointId: string
  deviceId?: string
  value: unknown
  source: string
  actorId?: string
  effectivePriority?: number
  remainingS: number | null
}

export interface ProgrammingOverridePage {
  items: ProgrammingOverrideEntry[]
  nextCursor?: string | null
}

export interface ProgrammingCheck {
  checkId: string
  revisionId: string
  state: 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'TIMED_OUT'
  diagnostics: ProgrammingDiagnostic[]
  artifact?: { artifactId: string; sha256: string; byteSize: number; profile: string; targetAbi: number; compilerVersion: string; libraryVersion: string }
  createdAt: string
  startedAt?: string
  completedAt?: string
  attemptCount: number
}

export interface ProgrammingProjectPage {
  items: ProgrammingProject[]
  nextCursor?: string | null
}

export interface ProgrammingAuditRecord {
  auditId: string
  sequence: number
  actorId: string
  role: string
  action: string
  targetType: string
  targetId: string
  revisionId?: string
  operationId?: string
  occurredAt: string
  resultCode: string
  correlationId: string
}

export interface ProgrammingAuditPage {
  items: ProgrammingAuditRecord[]
  nextCursor?: string | null
}

/**
 * Mô hình state hợp nhất theo `DDD-FE-PROG-001` §3 — KHÔNG dùng một boolean
 * `isRunning`. Đây là phần "editing/check/commission/core/runtime" dùng
 * xuyên suốt bốn workspace; mỗi slice thêm field khi cần, không tạo state
 * machine song song.
 */
export interface ProgrammingEditingState {
  draftId?: string
  revisionId?: string
  baseRevisionId?: string
  etag?: string
  dirty: boolean
  save: 'idle' | 'saving' | 'saved' | 'error'
}

export type ProgrammingCheckStatus = 'idle' | 'running' | 'passed' | 'failed' | 'timed_out'

export type ProgrammingOperationUiState =
  | 'idle'
  | 'confirming'
  | 'submitting'
  | 'applying'
  | 'verifying'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'unknown_reconciling'

/** Freshness của một giá trị đọc từ Core — không bao giờ suy ra "LIVE" khi chưa xác nhận. */
export type ProgrammingFreshness = 'LIVE' | 'STALE' | 'UNAVAILABLE'

/** `RemoteState` là hình dạng chung cho mọi hook đọc — tách hẳn `loading`
 * khỏi `data` rỗng để không vẽ "0 kết quả" trong lúc còn đang tải. */
export interface RemoteState<T> {
  status: 'loading' | 'ready' | 'error'
  data: T | null
  error: string | null
  refresh: () => void
}
