/**
 * DTO chiếu 1-1 theo `contracts/openapi/openapi.yaml` nhóm `/programming/*`
 * (schema `ProgrammingCapabilities`, `ProgrammingRuntime`, `ProgrammingProject`
 * …). Generator `scripts/generate-programming-client.mjs` chỉ sinh type cho
 * nhóm Commission (`api/generated/client.ts`); các schema đọc còn lại được
 * khai tay ở đây và PHẢI khớp field/kiểu với OpenAPI — không tự thêm field.
 */

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
  producerState: ProgrammingTargetState
  activeRevisionId: string | null
  lkgRevisionId: string | null
  taskState: ProgrammingTaskState
  safeState: boolean
  observedAt: string
}

export interface ProgrammingProject {
  projectId: string
  name: string
  etag: string
  activeRevisionId: string | null
  draftRevisionId: string
  updatedAt: string
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
