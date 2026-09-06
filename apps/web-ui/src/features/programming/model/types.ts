/**
 * DTO chiếu 1-1 theo `contracts/openapi/openapi.yaml` nhóm `/programming/*`
 * (schema `ProgrammingCapabilities`, `ProgrammingRuntime`, `ProgrammingProject`
 * …). Generator `scripts/generate-programming-client.mjs` sinh type cho nhóm
 * Commission **và** cho bảng Programs của PGM-01 (`api/generated/client.ts`);
 * các schema đọc còn lại được khai tay ở đây và PHẢI khớp field/kiểu với
 * OpenAPI — không tự thêm field.
 *
 * LUẬT BẤT DI BẤT DỊCH: type nào generator đã sinh thì KHÔNG khai tay lại ở
 * file này. Hai bản khai cùng tên sẽ trôi xa nhau trong im lặng — đúng thứ đã
 * xảy ra với `ProgrammingProgramIntent`/`ProgrammingProgramIntentList`/
 * `ProgrammingProgramRuntimeState` (xem khối re-export ngay dưới).
 */

import type { ProgrammingFbdChange, ProgrammingImpact, ProgrammingStHunk } from '../api/generated/client'

/**
 * `GET /projects/{projectId}/programs` — re-export NGUYÊN VẸN từ client sinh
 * tự động, không có bản khai tay song song.
 *
 * TRIỆU CHỨNG (phát hiện khi thi hành `T60-016`)
 * ----------------------------------------------
 * File này từng khai tay ba type `ProgrammingProgramIntent`,
 * `ProgrammingProgramIntentList` và `ProgrammingProgramRuntimeState` theo hợp
 * đồng TRƯỚC `T60-013`. Sau `T60-013`/`T60-014` chúng nói dối ba chỗ:
 *
 * 1. Thiếu 13 trường read-back sống (`runtimeStateSource`, `coreState`,
 *    `enabled`, `observedAt`, `periodMs`, `lastExecNs`, `maxExecNs`,
 *    `missedReleaseCount`, `consecutiveMissedRelease`, `lastRunAtUtc`,
 *    `lastRunAgeMs`, `lane`, `health`) và toàn bộ phần bao trang
 *    (`schemaVersion`, `projectId`, `runtimeStateSource`, `observedAt`,
 *    `programsTruncated`).
 * 2. Khai `desiredEnabled: boolean` trong khi server nay gửi được `null`
 *    (nghĩa là "Project chưa từng ghi intent cho Program này" — KHÁC HẲN
 *    `false`, vốn nghĩa là đã có người tắt nó).
 * 3. Còn giữ `STARTING`/`STOPPING`, hai giá trị mà D-07 đã loại và server
 *    không bao giờ gửi.
 *
 * Ba type đó lại TRÙNG TÊN với type sinh ra ở `api/generated/client.ts`, nên
 * chỗ nào import nhầm nguồn thì trình biên dịch vẫn xanh trong khi kiểu đang
 * mô tả một hợp đồng không còn tồn tại. Cách chữa duy nhất đúng là xoá bản
 * khai tay và trỏ về đúng một nguồn.
 */
export type {
  ProgrammingFbdChange,
  ProgrammingProgramHealth,
  ProgrammingProgramListItem,
  ProgrammingProgramRuntimeState,
  ProgrammingProgramRuntimeStateSource,
  ProgrammingProgramsPage,
  ProgrammingStHunk
} from '../api/generated/client'

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
  /**
   * `T59-814` / `DDD-SW-PGM02-WORKSPACE-001` §5.5 — bổ sung ADDITIVE.
   *
   * Optional có chủ ý: server đời cũ không có trường này, và khi thiếu thì FE
   * phải coi mọi mode mới là UNAVAILABLE. Không suy ra "chắc là có" từ việc
   * bản build FE này biết về SIMULATE — đó chính là cách một giao diện hiện
   * nút cho một khả năng thiết bị không có.
   */
  workspaceModes?: ProgrammingWorkspaceModes
  /**
   * `ISS-STED-19` — BỘ BA TƯƠNG THÍCH thiết bị công bố, để FE so với hằng đã
   * build vào bundle của chính nó.
   *
   * REQUIRED trong OpenAPI, và khai required ở đây theo đúng hợp đồng. Nhưng
   * TypeScript chỉ ràng buộc lúc biên dịch: một thiết bị đời cũ vẫn có thể trả
   * về phản hồi thiếu khối này. Nên `programmingCompatibility()` vẫn nhận
   * `undefined` và coi đó là KHÔNG KIỂM CHỨNG ĐƯỢC ⇒ chặn — khác hẳn
   * `workspaceModes`, nơi thiếu nghĩa là "không có khả năng đó". Ở đây thiếu
   * bằng chứng KHÔNG phải bằng chứng khớp.
   */
  compatibility: ProgrammingCompatibility
}

/** `ISS-STED-19` — chiếu 1-1 `ProgrammingCapabilities.compatibility`. */
export interface ProgrammingCompatibility {
  stLanguageProfileVersion: string
  stLanguageProfileSha256: string
  libraryRegistryVersion: string
  libraryRegistrySha256: string
  compilerProfileId: string
  targetAbi: number
}

export interface ProgrammingWorkspaceModes {
  contractVersion: string
  edit: { supported: boolean }
  live: { supported: boolean }
  simulation: ProgrammingSimulationCapability
}

export interface ProgrammingSimulationCapability {
  supported: boolean
  workerVersion: string | null
  /** Server là authority cuối; FE lấy giao với capability local. v1 là `['admin']`. */
  mutationRoles: Array<'viewer' | 'operator' | 'engineer' | 'admin'>
  limits: {
    maxConcurrentSessionsPerController: number
    idleTtlSeconds: number
    hardTtlSeconds: number
    maxRssMiB: number
    maxCpuPercentOneCore: number
    maxActionsPerSecond: number
    maxTraceSamples: number
    maxVirtualInputs: number
    workerCommandTimeoutMs: number
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

/**
 * `T59-810` — dấu của NGƯỜI SẢN XUẤT số liệu (Core), đi kèm mọi snapshot runtime.
 *
 * `activeRevisionId` một mình không đủ để giữ mạch: hai snapshot CÙNG một
 * Revision vẫn có thể tới sai thứ tự (poll chồng nhau, retry), và khi đó giá trị
 * đi lùi mà không ai biết. `capturedMonotonicNs` tăng nghiêm ngặt trong một lần
 * chạy của Core và GIẢM khi Core khởi động lại, nên nó phân biệt được "snapshot
 * cũ hơn" với "producer đã restart" — hai thứ cần hai cách xử lý khác nhau.
 *
 * Là CHUỖI thập phân chứ không phải number: nanosecond kể từ boot vượt
 * `Number.MAX_SAFE_INTEGER` sau ~104 ngày uptime, nên kiểu số sẽ làm tròn im
 * lặng đúng lúc thiết bị chạy lâu nhất.
 */
export interface ProgrammingProducerStamp {
  capturedMonotonicNs: string
}

export interface ProgrammingMonitorPage {
  schemaVersion: string
  activeRevisionId: string | null
  producer?: ProgrammingProducerStamp
  safeState: boolean
  task: ProgrammingTaskMetrics | null
  items: ProgrammingMonitorSample[]
}

/** T59-504 — Published Signal runtime là snapshot riêng của `StSignalBus`,
 * không được suy ra từ Binding/Point monitor. `valid=false` bắt buộc đi cùng
 * `value=null`; UI vẫn fail-closed nếu payload ngoài contract vi phạm cặp này. */
export interface ProgrammingRuntimeSignal {
  signalId: string | null
  name: string
  producerProgramId: string
  dataType: 'BOOL' | 'INT' | 'DINT' | 'UINT' | 'REAL' | 'TIME'
  unit: string | null
  value: boolean | number | null
  valid: boolean
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD'
  freshness: 'FRESH' | 'STALE_HELD' | 'STALE_FALLBACK' | 'UNAVAILABLE' | 'NOT_DECLARED'
  stalePolicy: 'WAIT' | 'HOLD_LAST' | 'USE_FALLBACK' | 'SAFE_STATE'
  freshnessMs: number
  /** uint64 truyền dưới dạng chuỗi thập phân để không mất bit trong JavaScript. */
  publishedAtMonoNs: string
  generation: string
  definitionState: 'MATCHED' | 'MISMATCH' | 'CORE_ONLY' | 'REVISION_ONLY'
}

export interface ProgrammingRuntimeSignalPage {
  schemaVersion: '1.0'
  producerState: ProgrammingTargetState
  activeRevisionId: string | null
  observedAt: string
  items: ProgrammingRuntimeSignal[]
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

/**
 * `T59-810` — tuple Active mà phiên Trace được NEO vào lúc tạo.
 *
 * Một phiên Trace kéo dài qua một lần cutover sẽ ghép mẫu của hai chương trình
 * khác nhau vào cùng một đồ thị, và người đọc không có cách nào nhìn ra chỗ
 * nối. BE dừng phiên khi tuple trôi; `pin` là thứ cho phép UI nói ĐÚNG vì sao
 * phiên dừng, thay vì chỉ hiện `SOURCE_UNAVAILABLE` chung chung.
 */
export interface ProgrammingTracePin {
  revisionId: string | null
  producer: ProgrammingProducerStamp
}

export interface ProgrammingTrace {
  traceId: string
  state: 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'FAILED'
  pin?: ProgrammingTracePin
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
  /** Draft v2 — `objectId` của POU trong `objects[]`. Với POU do FE tạo, nó
   *  trùng `programId`, nhưng hai trục định danh này KHÁC nhau về nghĩa
   *  (`objectId` sở hữu mã nguồn, `programId` là identity runtime — DDD §4.2/§4.3)
   *  và có thể khác giá trị. Xoá một POU phải nhắm đúng `objectId`. */
  objectId?: string
  /** Draft v2 — POU này CÓ một mục trong `programs[]` (cấu hình chạy) hay không.
   *
   *  Kind không trả lời được câu đó: một POU kind `PROGRAM` hoàn toàn có thể
   *  KHÔNG có cấu hình chạy — hoặc vì mới được `upsertObject` tạo mà chưa xếp
   *  lịch, hoặc vì là di chứng của lỗi xoá cũ (gỡ cấu hình nhưng để lại POU).
   *  Gửi `removeProgram` cho một POU như vậy làm backend trả
   *  `operations[i].removeProgram` — đúng lỗi người dùng gặp khi cố xoá một
   *  chương trình "ma". `undefined` = document v1 đi qua nguyên trạng. */
  hasRuntimeConfig?: boolean
  name: string
  kind: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
  language: 'ST' | 'FBD'
  document: unknown
  /** Draft v2 — chu kỳ chạy riêng của POU này, lấy từ đúng mục `programs[]` của
   *  nó. `undefined` = POU chưa xếp lịch (hoặc document v1, nơi chu kỳ là của
   *  Task chung). KHÔNG suy từ `task.periodMs`: trong Project nhiều chu kỳ,
   *  giá trị đó chỉ là chu kỳ của Program ĐẦU TIÊN. */
  periodMs?: number
  /** Draft v2 — `objectId` của các POU mà POU này gọi. Dùng cho preflight xoá:
   *  xoá một FUNCTION còn người gọi sẽ hỏng Check chứ không hỏng ở đây. */
  dependencies?: readonly string[]
  executionOrder?: number
  functionalTags?: string[]
  /** `DEV-PROG-004` — mô tả nhiều dòng của POU, đọc từ `objects[].description`.
   *  `undefined` = Draft chưa có khoá đó (POU cũ, hoặc người dùng đã xoá mô
   *  tả). Khác hẳn chuỗi rỗng, nên Inspector phân biệt được "chưa ghi" với
   *  "ghi rồi rồi xoá". */
  description?: string
  /** `DEV-PROG-004` — ghi chú truy cập MỘT dòng do người dùng viết
   *  (`objects[].access`). Đây là chú thích của con người, KHÔNG phải một
   *  quyền do máy chủ cấp: RBAC thật vẫn nằm ở `x-rbac` của từng endpoint. */
  access?: string
}

/**
 * Payload ghi cho operation tương thích `upsertProgram` của Draft v2.
 *
 * `ProgrammingProgram` ở trên là view model nên còn mang các field lịch sử
 * như `executionOrder`/`functionalTags`. Decoder backend cố ý strict và Draft
 * v2 không có hai field đó; dùng một type hẹp tại biên ghi để không thể vô tình
 * serialize cả view model rồi nhận 400.
 */
/** Payload typed của `upsertObject` (Draft v2 `objects[]`). */
export interface ProgrammingPouObjectDraftInput {
  objectId: string
  kind: ProgrammingProgram['kind']
  name: string
  language: ProgrammingProgram['language']
  source: string
  interface?: unknown
  locals?: unknown[]
  dependencies?: string[]
}

export interface ProgrammingProgramDraftInput {
  programId: string
  name: string
  kind: ProgrammingProgram['kind']
  language: ProgrammingProgram['language']
  document: unknown
}

/**
 * Hình dạng hẹp của metadata interface nằm trong `objects[]` của Draft v2.
 * Đây là authority để sinh pin POU ở FBD; source ST/FBD không được parse lại ở
 * FE để đoán cùng một chữ ký lần thứ hai.
 *
 * `type` vẫn là chuỗi tại biên API. Adapter FBD phải đối chiếu nó với registry
 * type sinh từ profile trước khi đổi thành `FbdDataType`.
 */
export interface ProgrammingPouInterfacePort {
  name: string
  type: string
}

export interface ProgrammingPouInterface {
  inputs: ProgrammingPouInterfacePort[]
  outputs?: ProgrammingPouInterfacePort[]
  returnType?: string
}

export interface ProgrammingDraftObjectV2 {
  objectId: string
  kind: ProgrammingProgram['kind']
  name: string
  language: ProgrammingProgram['language']
  source: unknown
  interface?: ProgrammingPouInterface
  locals?: unknown[]
  dependencies?: string[]
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

/** Snapshot của revision là `ProgrammingResource` mở trong OpenAPI. Các field
 * dưới đây phản ánh payload mà Web API hiện phát và chỉ dùng để quan sát bản
 * immutable/active; FE không dùng chúng làm authority thay cho `/runtime`. */
export interface ProgrammingRevisionSnapshotObject {
  kind: string
  objectId: string
  sha256?: string
  payload?: unknown
}

export interface ProgrammingRevision {
  revisionId: string
  projectId: string
  state: 'DRAFT' | 'IMMUTABLE' | 'ACTIVE' | 'LKG' | 'SUPERSEDED'
  contentHash: string
  createdAt: string
  snapshot?: {
    manifest?: {
      label?: string
      comment?: string
      objects?: Array<{ kind: string; objectId: string; sha256?: string }>
    }
    objects?: ProgrammingRevisionSnapshotObject[]
  }
}

export type ProgrammingCheckState = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'TIMED_OUT'

/** WP-01 (Overview state model, D-01, `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15`
 *  §5.2) — Check gần nhất cho `baseRevisionId` hiện hành, bất kể state. */
export interface ProgrammingProjectLatestCheck {
  checkId: string
  revisionId: string
  state: ProgrammingCheckState
  createdAt: string
  completedAt?: string | null
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
  /** `null`/`undefined` khi Draft chưa từng niêm phong hoặc chưa từng Check. */
  latestCheck?: ProgrammingProjectLatestCheck | null
  /**
   * `T60-015` — ba trường dưới đây server LUÔN gửi khoá, kể cả khi giá trị là
   * `null`. `null` nghĩa là "đã xét và chưa biết", không phải `0`/`false`:
   * khẳng định Draft "sạch" khi chưa biết là giấu việc chưa phát hành.
   */
  dirty: boolean | null
  /** Số thứ tự Revision nền của Draft — nguồn của nhãn `Draft #14` (D-05). */
  draftSequence: number | null
  /** Số thứ tự Revision Core ĐANG chạy, chỉ khi nó thuộc đúng Project này. */
  activeSequence: number | null
}

/** Payload của từng phần tử `operations[]` trong `PATCH .../draft`
 * (IFSPEC-PROG-001 §4; `apps/web-api/internal/programming/application/draft.go`
 * là authority — đây chỉ là type FE, không phải nơi quyết định hợp lệ). */
export type ProgrammingDraftOperation =
  | { op: 'setFunctionalTags'; tags: string[] }
  | { op: 'replaceProgramSource'; programId: string; language: 'ST' | 'FBD'; source: string }
  | { op: 'upsertProgram'; program: ProgrammingProgramDraftInput }
  /** Draft v2 typed — tạo/ghi đè chính POU trong `objects[]`. Khác
   *  `upsertProgram` ở chỗ nó KHÔNG đụng tới `programs[]`: xếp lịch là một
   *  quyết định riêng, và FUNCTION/FUNCTION_BLOCK không bao giờ có mục ở đó. */
  | { op: 'upsertObject'; object: ProgrammingPouObjectDraftInput }
  /** Đổi tên tại chỗ, giữ nguyên `objectId` và mã nguồn. Không dùng
   *  `upsertObject` để đổi tên: gửi lại cả `source` sẽ ghi đè nội dung mà người
   *  dùng vừa sửa ở buffer khác. */
  | { op: 'renameObject'; objectId: string; name: string }
  /** `DEV-PROG-004` — ghi chú thích của POU, VÁ TẠI CHỖ (cùng lý do như
   *  `renameObject`: không gửi lại `source` thì không thể ghi đè mã nguồn của
   *  phiên khác). Chuỗi rỗng = XOÁ chú thích; bỏ hẳn khoá = giữ nguyên. */
  | { op: 'annotateObject'; objectId: string; description?: string; access?: string }
  /** Nhân bản nội dung với identity MỚI do client cấp — retry cùng request phải
   *  cho cùng một `newObjectId`, nếu không idempotency mất nghĩa. */
  | { op: 'duplicateObject'; objectId: string; newObjectId: string; name: string }
  | { op: 'removeProgram'; programId: string }
  /** Draft v2 — xoá chính POU khỏi `objects[]`. `removeProgram` chỉ gỡ CẤU HÌNH
   *  CHẠY; thiếu thao tác này thì mã nguồn POU vẫn nằm trong Draft, vẫn hiện
   *  trên giao diện (danh sách dựng từ `objects`) và vẫn có thể đi vào package ở
   *  lần Commission sau. Backend từ chối `removeObject` khi còn Program tham
   *  chiếu, nên thứ tự bắt buộc là `removeProgram` rồi mới `removeObject`. */
  | { op: 'removeObject'; objectId: string }
  | { op: 'upsertVariable'; variable: ProgrammingVariable }
  | { op: 'removeVariable'; variableId: string }
  | { op: 'upsertBinding'; binding: ProgrammingBinding }
  | { op: 'removeBinding'; bindingId: string }
  | { op: 'setTask'; task: ProgrammingTaskConfig }
  | { op: 'upsertSignal'; signal: ProgrammingSignalDraftInput }
  | { op: 'removeSignal'; signalId: string }

export interface ProgrammingDiagnostic {
  code: string
  detailCode?: string
  severity: 'ERROR' | 'WARNING' | 'INFO' | string
  /** Thông điệp kỹ thuật ngắn từ backend/compiler; vắng mặt khi diagnostic không xuất phát từ compiler. */
  message?: string
  messageKey: string
  /** `ISS-STED-18` — provenance đi kèm TỪNG diagnostic.
   *
   * Không có bốn trường này thì việc gạch lỗi trong trình soạn thảo tạo ra một
   * lỗi nguy hiểm hơn lỗi đang có: gạch một chỗ trên buffer đã đổi, tức chỉ vào
   * dòng KHÔNG CÒN là dòng sinh ra lỗi đó, và người dùng không có cách nào biết
   * mình đang bị chỉ sai.
   *
   * Tất cả đều tuỳ chọn vì diagnostic không đến từ compiler (scope, worker) sẽ
   * không có nguồn nào để chứng minh — và "không kiểm được" phải phân biệt được
   * với "kiểm rồi, khớp". */
  location?: {
    programId?: string
    line?: number
    column?: number
    bindingId?: string
    revisionId?: string
    pouId?: string
    sourceSha256?: string
    stLanguageProfileVersion?: string
    [key: string]: unknown
  }
  args?: Record<string, unknown>
}

/** `GET /point-catalog` — chiếu Point authority hiện hữu (LOCAL/VP/MB_RTU),
 * KHÔNG phải authority Point thứ hai. Quality sáu mức thật từ producer. */
/** Quyết định eligibility cho MỘT chiều binding, do SERVER cấp (`ISS-PIO-32`).
 *
 * `reasons` là văn bản để hiển thị NGUYÊN VĂN. FE không diễn giải lại, không
 * ánh xạ sang câu của riêng mình: bản diễn giải thứ hai chính là thứ đã trôi
 * khỏi Core và nói với người dùng rằng "Core chưa hỗ trợ MB_RTU" trong khi Core
 * đã hỗ trợ từ lâu. */
export interface ProgrammingPointMapEligibility {
  status: 'SUPPORTED' | 'UNSUPPORTED_BY_CORE' | 'UNSUPPORTED_IDENTITY' | 'INCOMPATIBLE'
  reasons: string[]
}

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
  /** Slot EXT 1-based của điểm Modbus. Vắng = catalog chưa cấp (`ISS-PIO-31`). */
  extIndex?: number
  /** `ISS-PIO-07` — mô tả tự do. Rỗng ở điểm Modbus vì `fieldbus.conf` không có
   *  trường tương ứng; đó là sự thật về hợp đồng, không phải thiếu dữ liệu. */
  description?: string
  /** Điểm có đang được dùng không. */
  enabled?: boolean
  /** Thiết bị công nghệ (`ADR-042`). Rỗng = CHƯA GÁN; cấm đoán từ tên điểm. */
  equipment?: string
  /** Định danh nguồn có tiền tố: `iop:` / `core:` / `modbus:`. Rỗng = chưa có
   *  nguồn (ví dụ VP chưa bind slot). */
  sourceRef?: string
  /** `ISS-PIO-09` — định danh ngắn theo nguồn (`UI-01`, `AV-01`, `MB-014`).
   *  Rỗng = máy chủ chưa dựng được ⇒ FE hiện `pointId`, KHÔNG bịa số. */
  displayId?: string
  /** Tên thiết bị Modbus do người vận hành đặt (`CK508-04`) — khác `deviceId`
   *  canonical (`bus-1-slave-4`). Chỉ điểm Modbus mới có. */
  deviceLabel?: string
  /** Chi tiết kỹ thuật đọc ngay trên hàng: `0-10V → 0…50 °C`, `RW · RETAIN`,
   *  `HR 102 · FC03`. Do MÁY CHỦ dựng vì dữ liệu nguồn nằm ở cấu hình. */
  sourceDetail?: string
  /** Quyết định của server cho từng chiều. Vắng mặt = server đời cũ ⇒ FE phải
   *  fail-closed chứ KHÔNG được tự suy lại. */
  mapping?: {
    input: ProgrammingPointMapEligibility
    output: ProgrammingPointMapEligibility
  }
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
  /**
   * `T59-819` — diff typed do MÁY CHỦ tính. Hai mảng này sinh thẳng từ schema
   * OpenAPI (`ProgrammingStHunk`/`ProgrammingFbdChange`) chứ không khai tay:
   * enum `changeType` của chúng quyết định UI vẽ "đổi logic" hay chỉ "đổi chỗ
   * đứng trên canvas", và một bản khai tay lệch sẽ lệch im lặng.
   *
   * Optional ở đây là để đọc được phản hồi của server đời cũ — và FE PHẢI phân
   * biệt `undefined` ("server chưa biết so") với `[]` ("đã so, không có gì").
   */
  stHunks?: ProgrammingStHunk[]
  fbdChanges?: ProgrammingFbdChange[]
  /** Danh sách chạm trần payload. Một danh sách bị cắt im lặng trông y hệt một
   * danh sách đầy đủ, nên cờ này phải được đọc và nói ra. */
  truncated?: boolean
  nextCursor?: string | null
}

/** `GET /operations/{operationId}` — DM-PROG-001 §3.9 state machine. */
export type ProgrammingOperationState =
  | 'QUEUED'
  | 'PREFLIGHT'
  | 'STAGING'
  | 'APPLYING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'ROLLED_BACK'
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

/** `ISS-STED-13` — chiếu 1-1 `ProgrammingCheck.symbols[]`. */
export interface ProgrammingCheckSymbol {
  pouId: string
  name: string
  direction: 'input' | 'output'
  type: 'BOOL' | 'INT' | 'DINT' | 'UINT' | 'REAL' | 'TIME'
  slot: number
}

export interface ProgrammingCheck {
  checkId: string
  revisionId: string
  state: 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'TIMED_OUT'
  diagnostics: ProgrammingDiagnostic[]
  /**
   * `ISS-STED-13` — bảng biến GIAO DIỆN do **compiler** công bố.
   *
   * FE có ba bộ đọc ST độc lập với compiler (tô màu, chỉ mục ký hiệu, formatter)
   * và trước đây không có cách nào biết mình đọc lệch. Mảng này là thứ để đối
   * chiếu. Rỗng là câu trả lời THẬT ("POU không khai cổng nào"), và Check chưa
   * PASSED cũng rỗng — nên tuyệt đối không đọc "rỗng" thành "khớp".
   */
  symbols: ProgrammingCheckSymbol[]
  /**
   * `stLanguageProfileVersion` (`ISS-STED-19`): phiên bản hồ sơ ngôn ngữ ST đi
   * CÙNG artifact, không chỉ nằm ở endpoint capabilities — một artifact đọc
   * lại sau này phải tự nói được nó biên dịch dưới hồ sơ nào.
   */
  artifact?: {
    artifactId: string
    sha256: string
    byteSize: number
    profile: string
    targetAbi: number
    compilerVersion: string
    libraryVersion: string
    stLanguageProfileVersion: string
  }
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
 * xuyên suốt sáu workspace; mỗi slice thêm field khi cần, không tạo state
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
  /** Unix milliseconds của lần đọc thành công gần nhất, nếu có.
   * Giữ riêng với `data` để UI phân biệt snapshot đang giữ lại với dữ liệu
   * vừa đọc; không phải authority runtime mới. */
  lastSuccessAt?: number | null
}

/** T59-202/203 — entry Control Library. `scope` phân biệt SYSTEM (registry chỉ
 * đọc) với PROJECT (do người dùng định nghĩa). */
export interface ProgrammingLibrarySignaturePort {
  name: string
  direction: 'INPUT' | 'OUTPUT'
  dataType: string
}

export interface ProgrammingLibrarySignature {
  category: string
  labelVi?: string
  labelEn?: string
  dispatch: 'OPERATOR' | 'FUNC_TABLE' | 'FB_TYPE' | 'EXPANSION'
  polymorphic: boolean
  allowedTypes: string[]
  defaultType?: string
  typedPortNames: string[]
  ports: ProgrammingLibrarySignaturePort[]
}

export interface ProgrammingLibraryEntry {
  scope: 'SYSTEM' | 'PROJECT'
  libraryRevisionId: string
  libraryVersion: string
  libraryState: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'
  entryId: string
  kind: 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'
  name: string
  language?: 'ST' | 'FBD'
  featureState: 'AVAILABLE' | 'REVIEW_REQUIRED'
  contentSha256: string
  interface?: unknown
  /** `T59-804` — chữ ký ĐÃ PHÂN GIẢI do backend công bố. Vắng field nghĩa là
   *  backend không đọc được chữ ký thô; FE không được coi đó là "không có port"
   *  mà phải nói ra. Backend cũ chưa có field này, nên FE vẫn parse `interface`
   *  làm đường lùi trong một chu kỳ nâng cấp. */
  signature?: ProgrammingLibrarySignature
  dependencies: { entryId: string; version: string }[]
  /** `false` nghĩa là layout CHƯA BIẾT, không phải bằng 0. */
  stateLayoutKnown: boolean
  stateSizeBytes: number
  /**
   * `T61-101` — metadata TRÌNH BÀY.
   *
   * Cả ba đều optional vì hợp đồng là additive. Field VẮNG nghĩa là "chưa ai
   * điền" và phải render `—`; đừng quy nó về chuỗi rỗng, vì chuỗi rỗng đọc như
   * một ô đã điền rồi.
   */
  category?: string
  description?: string
  /**
   * `T61-101` — thẻ, đã được MÁY CHỦ chuẩn hoá (trim, gộp khoảng trắng, hạ chữ
   * thường, khử trùng lặp, sắp tăng dần). FE **không** chuẩn hoá lại và không
   * sắp lại: mọi phép so/nhóm theo thẻ dùng thẳng giá trị này, nếu không hai
   * nơi sẽ gấp chữ theo hai luật.
   *
   * Vắng field = "chưa ai gắn thẻ". Mảng rỗng không phải trạng thái thứ ba —
   * đường ghi quy `[]` về vắng mặt.
   */
  tags?: string[]
  /** Băm riêng phần trình bày — KHÔNG phải `contentSha256`. Phủ cả
   *  `category`, `description` và `tags`. */
  presentationSha256?: string
  /**
   * `T61-101` — trạng thái tương thích với gói ĐANG VẬN HÀNH.
   *
   * Optional ở TS vì backend cũ trong một chu kỳ nâng cấp chưa gửi field này —
   * cùng đường lùi đã dùng cho `signature`. Nhưng vắng mặt **không** được đọc
   * thành "không sao": FE phải xử lý `undefined` y như `UNKNOWN`, tức là nói ra
   * rằng chưa đo được. Máy chủ hiện tại LUÔN gửi field này.
   */
  compatibility?: ProgrammingLibraryCompatibility
}

/**
 * `T61-101` / `LOCK-PGM04-CONTRACT-001` §4.
 *
 * `UNKNOWN` là giá trị MẶC ĐỊNH, không phải trường hợp lỗi: khi Project chưa
 * Commission Revision nào thì không có gì để so, và nói "tương thích" lúc ấy là
 * một khẳng định không có cơ sở.
 *
 * Ba trường sau là `string | null` chứ không optional: máy chủ luôn gửi khoá, và
 * `null` nghĩa là "đã xét, chưa đo được". Đừng quy `null` về chuỗi rỗng — chuỗi
 * rỗng đọc như một version đã đo và bằng rỗng.
 */
export interface ProgrammingLibraryCompatibility {
  state: 'COMPATIBLE' | 'REQUIRES_MIGRATION' | 'UNKNOWN'
  /** Version mà Revision đang vận hành pin. */
  requiredVersion: string | null
  /** Version PUBLISHED mới nhất mang entry này. */
  availableVersion: string | null
  /** Chỉ khác `null` khi `state` khác `COMPATIBLE`. */
  reason: string | null
}

/** `T61-105` — một mục Used-In: MỘT CẶP (Revision, POU), không phải một lần gọi. */
export interface ProgrammingLibraryUsageItem {
  projectId: string
  projectName: string
  revisionId: string
  objectId: string
  objectName: string
  requiredVersion: string
  /** `INSTANCE` mang trạng thái, `CALL` thì không. */
  usageKind: 'CALL' | 'INSTANCE'
  isActive: boolean
}

export interface ProgrammingLibraryUsageScope {
  /** Số mục CỦA TRANG NÀY, không phải tổng toàn cục — `truncated` nói phần còn lại. */
  count: number
  truncated: boolean
  items: ProgrammingLibraryUsageItem[]
  /**
   * `T61-101` — con trỏ trang kế. `null` = đã đọc hết.
   *
   * `truncated: true` mà không có `nextCursor` là ngõ cụt: giao diện nói "còn
   * nữa" rồi không có cách nào đọc tiếp. Hai trường đi cùng nhau.
   */
  nextCursor: string | null
}

/**
 * `T61-105` — Used-In hai phạm vi.
 *
 * `availability` là trường quyết định, và nó không phải chuyện trình bày:
 * `count: 0` nghĩa là "không chương trình nào dùng khối này" — một câu mời
 * người ta xoá nó. `UNAVAILABLE` nghĩa là "chưa đo được". FE **không được**
 * hiện số khi `availability` không phải `COMPLETE`/`SEALED_ONLY`.
 */
export interface ProgrammingLibraryUsage {
  sealed: ProgrammingLibraryUsageScope
  draft: ProgrammingLibraryUsageScope
  availability: 'COMPLETE' | 'SEALED_ONLY' | 'UNAVAILABLE'
}

export interface ProgrammingLibraryPage {
  items: ProgrammingLibraryEntry[]
  nextCursor?: string | null
}

/**
 * T59-203 — Published Signal của tài liệu Draft v2 (`signals[]`).
 *
 * Đây là hình dạng ĐÚNG NHƯ backend lưu và trả lại
 * (`application/draft_v2.go: upsertSignalDefinition`), không phải một view model
 * làm đẹp. Ba điểm dễ sai nếu khai lại theo trí nhớ:
 *
 * 1. `stalePolicy` đi trên dây bằng **tên runtime** (`HOLD_LAST`/`WAIT`), còn
 *    DDD §7.3 gọi chúng là `HOLD_PRIVATE`/`BLOCK_PROGRAM`. Hai bảng tên tồn tại
 *    song song và bản đồ 1-1 nằm ở `PLAN59-CONTRACT-LOCK-2026-08-24` §2.3 —
 *    giao diện hiển thị tên DDD, đường ghi gửi tên runtime.
 * 2. `fallbackValue` là **số**, kể cả cho `BOOL` (0/1) và `TIME` (mili giây):
 *    backend khai `*float64`. Gửi `true` hay `"5s"` là 400.
 * 3. `fallbackValue` bắt buộc CÓ khi `stalePolicy==='USE_FALLBACK'` và bắt buộc
 *    VẮNG với ba chính sách còn lại — backend từ chối cả hai chiều lệch.
 */
export type ProgrammingSignalType = 'BOOL' | 'INT' | 'DINT' | 'UINT' | 'REAL' | 'TIME'

/** Giá trị `stalePolicy` đi trên dây. `FAIL_CLOSED` backend còn nhận nhưng DDD
 *  §7.3 không đặt tên cho nó, nên giao diện chỉ ĐỌC được, không tạo mới. */
export type ProgrammingSignalStalePolicyWire = 'USE_FALLBACK' | 'HOLD_LAST' | 'WAIT' | 'FAIL_CLOSED'

/** Tên chính sách theo DDD §7.3 — thứ người dùng nhìn thấy. */
export type ProgrammingSignalStalePolicy = 'USE_FALLBACK' | 'HOLD_PRIVATE' | 'BLOCK_PROGRAM'

export interface ProgrammingPublishedSignal {
  signalId: string
  name: string
  type: ProgrammingSignalType
  unit?: string
  publisherProgramId: string
  freshnessMs: number
  stalePolicy: ProgrammingSignalStalePolicyWire
  fallbackValue?: number
}

/** Payload ghi của op `upsertSignal`. Hẹp hơn view model: decoder backend là
 *  strict nên một field thừa làm cả batch hỏng. */
export interface ProgrammingSignalDraftInput {
  signalId: string
  name: string
  type: ProgrammingSignalType
  unit?: string
  publisherProgramId: string
  freshnessMs: number
  stalePolicy: ProgrammingSignalStalePolicyWire
  fallbackValue?: number
}

/** Cấu hình chạy của một Program trong Draft v2 (`programs[]`). Tách khỏi POU
 *  (`objects[]`): đổi chu kỳ và sửa mã là hai việc khác nhau. */
export interface ProgrammingDraftProgramConfigV2 {
  programId: string
  objectId: string
  periodMs: number
  taskId?: string
}

/** Khoá version thư viện của Draft v2 (`library`). `projectLibraryRevisionId`
 *  `null` nghĩa là Project chưa từng có PROJECT library — KHÁC "chưa đọc được". */
export interface ProgrammingDraftLibraryLock {
  systemProfile: string
  systemVersion: string
  projectLibraryRevisionId: string | null
}
