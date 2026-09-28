import type {
  ProgrammingCheckState,
  ProgrammingProgram,
  ProgrammingProgramHealth,
  ProgrammingProgramListItem,
  ProgrammingProgramRuntimeState,
  ProgrammingProgramRuntimeStateSource,
  ProgrammingProgramWaitingReason,
  ProgrammingProgramsPage,
  ProgrammingProject,
  ProgrammingRuntime,
  ProgrammingTargetState,
  ProgrammingTaskState,
  RemoteState
} from '../model/types'
import type { ActiveRevisionOwnership } from '../shared/activeRevisionOwnership'
import type { SemanticState } from '../shared/semanticState'
import type { ActiveProgramSet, ActiveProgramSetReason } from './activeProgramSet'
import { resolvePrimaryCta, type PrimaryCtaDecision } from './resolvePrimaryCta'

/**
 * `T60-201` — view model **thuần** của PGM-01 (handoff §5).
 *
 * Module này không import React, không gọi API và không đọc `useI18n`. Nó nhận
 * các read-model đã tải (Project, runtime, trang Programs, tập Program của
 * Active Revision) và trả về đúng những gì màn hình phải vẽ. Ba lý do:
 *
 * 1. Luật khó nhất của PGM-01 là luật **thiếu dữ liệu**: `AC-PGM01-04` cấm
 *    render số `0` cho một số liệu chưa đọc được. Luật đó phải kiểm được mà
 *    không cần mount trang và không cần mock mạng.
 * 2. Ghép hai nguồn (khai báo trong Active Revision × read-back sống của Core)
 *    là nơi dễ nói dối nhất — trộn im lặng chu kỳ khai báo vào ô "chu kỳ đang
 *    chạy" là một lỗi không ai nhìn thấy bằng mắt.
 * 3. `T60-202..206` sẽ dựng năm khối UI trên cùng một VM này; có một nguồn duy
 *    nhất thì năm khối đó không thể tự suy ra năm sự thật khác nhau.
 *
 * KHÔNG TỰ TÍNH `health`. Server là authority (D-04/README §5.4). Ở đây chỉ có
 * phép **giải thích vì sao `health` rỗng**, và lời giải thích đó cũng chỉ dựng
 * từ dữ kiện tường minh của chính dòng đó.
 */

type ResourceStatus = RemoteState<unknown>['status']

/* ------------------------------------------------------------------ *
 * Nhãn Revision — D-05                                                *
 * ------------------------------------------------------------------ */

/**
 * `Draft #14` / `Active #12`. `null` khi chưa phân giải được `sequence` —
 * KHÔNG rơi về UUID rút gọn (phương án đã bị D-05 loại) và không rơi về `#0`.
 */
export function revisionSequenceLabel(kind: 'draft' | 'active', sequence: number | null | undefined): string | null {
  if (typeof sequence !== 'number' || !Number.isFinite(sequence) || sequence < 1) return null
  return `${kind === 'draft' ? 'Draft' : 'Active'} #${Math.trunc(sequence)}`
}

/* ------------------------------------------------------------------ *
 * Chuẩn hoá giá trị enum đến từ mạng                                  *
 * ------------------------------------------------------------------ */

const RUNTIME_STATES: readonly ProgrammingProgramRuntimeState[] = ['RUNNING', 'WAITING', 'DISABLED', 'FAULTED', 'UNKNOWN']
const RUNTIME_STATE_SOURCES: readonly ProgrammingProgramRuntimeStateSource[] = ['CORE_LIVE', 'LAST_KNOWN', 'UNAVAILABLE']
const HEALTH_VALUES: readonly ProgrammingProgramHealth[] = ['HEALTHY', 'DEGRADED', 'FAULT', 'UNKNOWN']
const WAITING_REASONS: readonly ProgrammingProgramWaitingReason[] = ['INPUT_NOT_READY', 'SIGNAL_NOT_READY']

/**
 * Giá trị lạ (server đời cũ, hoặc `STARTING`/`STOPPING` mà D-07 đã loại) ra
 * `UNKNOWN`, KHÔNG ra `RUNNING`. Type sinh tự động chỉ ràng buộc lúc biên
 * dịch; thân phản hồi thật vẫn có thể mang bất cứ chuỗi nào.
 */
function normalizeRuntimeState(value: unknown): ProgrammingProgramRuntimeState {
  return RUNTIME_STATES.includes(value as ProgrammingProgramRuntimeState)
    ? (value as ProgrammingProgramRuntimeState)
    : 'UNKNOWN'
}

/** Không đọc được nguồn ⇒ `UNAVAILABLE`. Mặc định về `CORE_LIVE` là dán nhãn "sống" cho dữ liệu chưa chứng minh được. */
function normalizeSource(value: unknown): ProgrammingProgramRuntimeStateSource {
  return RUNTIME_STATE_SOURCES.includes(value as ProgrammingProgramRuntimeStateSource)
    ? (value as ProgrammingProgramRuntimeStateSource)
    : 'UNAVAILABLE'
}

function normalizeHealth(value: unknown): ProgrammingProgramHealth | null {
  return HEALTH_VALUES.includes(value as ProgrammingProgramHealth) ? (value as ProgrammingProgramHealth) : null
}

/** Issue #827 — giá trị lạ hoặc server đời cũ (khoá vắng) ⇒ `null`: nhãn WAITING chung. */
function normalizeWaitingReason(value: unknown): ProgrammingProgramWaitingReason | null {
  return WAITING_REASONS.includes(value as ProgrammingProgramWaitingReason)
    ? (value as ProgrammingProgramWaitingReason)
    : null
}

/** Số dương hữu hạn, hoặc `null`. `0` KHÔNG bao giờ là một chu kỳ hợp lệ (Plan 60 §4.2). */
function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/* ------------------------------------------------------------------ *
 * Dòng của `ProgramsSummaryTable` — D-02                              *
 * ------------------------------------------------------------------ */

/** Nguồn của con số trong cột `Cycle`. Không bao giờ trộn im lặng hai nguồn. */
export type ProgramCycleSource =
  /** `periodMs` Core đang thật sự chạy, đọc từ `point_snapshot`. */
  | 'CORE_LIVE'
  /** `periodMs` **khai báo** trong Active Revision — dùng khi Core im. */
  | 'DECLARED'

export type ProgramHealthMissingReason =
  /** `runtimeStateSource` của dòng không phải `CORE_LIVE`: chưa đọc được từ Core. */
  | 'NOT_READ_FROM_CORE'
  /** Core đọc được nhưng không kể tên Program này ⇒ không có gì để chấm điểm. */
  | 'NOT_REPORTED_BY_CORE'
  /** Core sống, server đã xét và cố ý không gán nhãn (D-04 điều 3). */
  | 'NOT_LABELLED'

export type ProgramRowOrigin =
  /** Có trong Active Revision và Core cũng kể tên. */
  | 'DECLARED_AND_LIVE'
  /** Có trong Active Revision nhưng Core không kể tên. */
  | 'DECLARED_ONLY'
  /** Core kể tên nhưng Active Revision không khai — lệch giữa gói đang chạy và bảng của Core. */
  | 'LIVE_ONLY'

export interface OverviewProgramRow {
  /** Khoá React. KHÔNG được render ra DOM: nó có thể là UUID (`AC-PGM01-01`). */
  key: string
  programId: string | null
  /** Định danh object POU trong Revision — khoá deep-link sang PGM-02. `null` ⇒ hàng không bấm được. */
  objectId: string | null
  /** Tên người-đọc-được. `null` ⇒ tầng hiển thị vẽ `—` kèm lý do, KHÔNG in UUID thay thế. */
  name: string | null
  language: ProgrammingProgram['language'] | null
  /** `null` khi cả read-back lẫn khai báo đều không cho biết chu kỳ. Không bao giờ là `0`. */
  cycle: { periodMs: number; source: ProgramCycleSource } | null
  runtimeState: ProgrammingProgramRuntimeState
  runtimeStateSource: ProgrammingProgramRuntimeStateSource
  /**
   * Issue #827 — VÌ SAO dòng đang `WAITING`. Chỉ khác `null` khi dòng đọc sống
   * từ Core (`CORE_LIVE`) và đang `WAITING`: lý do của một read-back cũ không
   * được trình bày như lý do hiện tại.
   */
  waitingReason: ProgrammingProgramWaitingReason | null
  /** MỐC lần chạy gần nhất. Dựng từ `lastRunAtUtc`/`lastRunAgeMs`, TUYỆT ĐỐI không từ `lastExecNs` (đó là thời lượng). */
  lastRun: { atUtc: string | null; ageMs: number | null } | null
  health: ProgrammingProgramHealth | null
  healthMissingReason: ProgramHealthMissingReason | null
  origin: ProgramRowOrigin
}

export type ProgramsEmptyReason =
  /** Còn đang đọc — chưa được kết luận "không có Program nào". */
  | 'LOADING'
  /** Đọc hỏng. Khác hẳn "có 0 Program". */
  | 'UNAVAILABLE'
  /** Đọc được cả hai nguồn và thật sự không có Program nào. */
  | 'NO_PROGRAM'

export interface ProgramsSummaryModel {
  rows: OverviewProgramRow[]
  /** Nguồn ở mức TRANG. Dòng vẫn có thể hạ xuống thấp hơn. */
  source: ProgrammingProgramRuntimeStateSource
  /** `true` khi Core đã cắt danh sách ở trần 32 Program ⇒ bảng KHÔNG đầy đủ. */
  truncated: boolean
  /** `null` khi và chỉ khi `rows` không rỗng. */
  emptyReason: ProgramsEmptyReason | null
  /** Lý do tập Program khai báo rỗng (`T60-017`); giữ nguyên để hiển thị câu giải thích đúng. */
  activeSetReason: ActiveProgramSetReason | null
  /** Nhãn `Active #12` của gói đã dựng nên danh sách này; `null` khi chưa phân giải được. */
  activeLabel: string | null
}

export interface ProgramsSummaryInput {
  programsStatus: ResourceStatus
  programs: ProgrammingProgramsPage | null
  activeSet: ActiveProgramSet
  activeSequence: number | null
}

/**
 * Ghép **tập Program khai báo trong Active Revision** với **read-back sống của
 * Core**, giữ ba loại lệch thay vì làm phẳng chúng.
 *
 * Thứ tự ưu tiên là khai báo: bảng phải trả lời "gói đang chạy gồm những
 * Program nào", nên gói mới là xương sống. Program mà Core kể tên nhưng gói
 * không khai (`LIVE_ONLY`) vẫn được liệt kê ở cuối — giấu nó đi là giấu đúng
 * thứ bất thường mà người vận hành cần thấy.
 */
export function overviewProgramRows(input: ProgramsSummaryInput): ProgramsSummaryModel {
  const pageSource = normalizeSource(input.programs?.runtimeStateSource)
  const activeLabel = revisionSequenceLabel('active', input.activeSequence)
  const truncated = input.programs?.programsTruncated === true

  const readBack = new Map<string, ProgrammingProgramListItem>()
  for (const item of input.programs?.items ?? []) {
    const programId = nonEmptyString(item?.programId)
    if (programId) readBack.set(programId, item)
  }

  const rows: OverviewProgramRow[] = []
  const consumed = new Set<string>()

  for (const declaration of input.activeSet.programs) {
    const item = declaration.programId ? readBack.get(declaration.programId) ?? null : null
    if (item && declaration.programId) consumed.add(declaration.programId)
    rows.push(buildRow({
      key: declaration.objectId,
      programId: declaration.programId,
      objectId: declaration.objectId,
      name: declaration.name,
      language: declaration.language,
      declaredPeriodMs: declaration.periodMs,
      item,
      pageSource,
      origin: item ? 'DECLARED_AND_LIVE' : 'DECLARED_ONLY'
    }))
  }

  for (const [programId, item] of readBack) {
    if (consumed.has(programId)) continue
    rows.push(buildRow({
      key: `live:${programId}`,
      programId,
      objectId: null,
      name: null,
      language: null,
      declaredPeriodMs: null,
      item,
      pageSource,
      origin: 'LIVE_ONLY'
    }))
  }

  return {
    rows,
    source: pageSource,
    truncated,
    emptyReason: rows.length > 0 ? null : emptyReason(input),
    activeSetReason: input.activeSet.reason,
    activeLabel
  }
}

function emptyReason({ programsStatus, activeSet }: ProgramsSummaryInput): ProgramsEmptyReason {
  // Đang đọc bất kỳ nguồn nào ⇒ chưa được kết luận "không có Program".
  if (programsStatus === 'loading' || activeSet.reason === 'REVISION_LOADING') return 'LOADING'
  if (programsStatus === 'error') return 'UNAVAILABLE'
  if (activeSet.reason === 'REVISION_UNAVAILABLE' || activeSet.reason === 'REVISION_MISMATCH' ||
      activeSet.reason === 'SNAPSHOT_UNREADABLE' ||
      /* `ISS-PGUI-01` — có gói đang chạy mà không quy được về Project nào là
         "chưa kết luận được", KHÔNG phải "không có Program nào". Ngược lại,
         `ACTIVE_OTHER_PROJECT` ĐÃ kết luận: gói đang chạy là của Project khác,
         nên Project này thật sự không có Program đang chạy — nó rơi xuống
         `NO_PROGRAM` kèm đúng câu giải thích ấy. */
      activeSet.reason === 'ACTIVE_PROJECT_UNRESOLVED') {
    return 'UNAVAILABLE'
  }
  return 'NO_PROGRAM'
}

function buildRow(args: {
  key: string
  programId: string | null
  objectId: string | null
  name: string | null
  language: ProgrammingProgram['language'] | null
  declaredPeriodMs: number | null
  item: ProgrammingProgramListItem | null
  pageSource: ProgrammingProgramRuntimeStateSource
  origin: ProgramRowOrigin
}): OverviewProgramRow {
  const { item } = args
  // Dòng không có read-back thì nguồn của nó là nguồn của TRANG, và trạng thái
  // là `UNKNOWN` — không mượn `desiredEnabled` để suy ra đang chạy hay không.
  const runtimeStateSource = item ? normalizeSource(item.runtimeStateSource) : args.pageSource
  const runtimeState = item ? normalizeRuntimeState(item.runtimeState) : 'UNKNOWN'

  // Chu kỳ: chỉ nhận số của Core khi chính dòng đó đọc được từ Core. Nếu không,
  // dùng chu kỳ KHAI BÁO và nói rõ là khai báo.
  const livePeriodMs = runtimeStateSource === 'CORE_LIVE' ? positiveNumber(item?.periodMs) : null
  const declaredPeriodMs = positiveNumber(args.declaredPeriodMs)
  const cycle = livePeriodMs !== null
    ? { periodMs: livePeriodMs, source: 'CORE_LIVE' as const }
    : declaredPeriodMs !== null
      ? { periodMs: declaredPeriodMs, source: 'DECLARED' as const }
      : null

  const lastRunAtUtc = nonEmptyString(item?.lastRunAtUtc)
  const lastRunAgeMs = nonNegativeNumber(item?.lastRunAgeMs)
  const lastRun = lastRunAtUtc !== null || lastRunAgeMs !== null
    ? { atUtc: lastRunAtUtc, ageMs: lastRunAgeMs }
    : null

  const health = normalizeHealth(item?.health)
  const waitingReason = runtimeStateSource === 'CORE_LIVE' && runtimeState === 'WAITING'
    ? normalizeWaitingReason(item?.waitingReason)
    : null
  return {
    key: args.key,
    programId: args.programId,
    objectId: args.objectId,
    name: args.name,
    language: args.language,
    cycle,
    runtimeState,
    runtimeStateSource,
    waitingReason,
    lastRun,
    health,
    healthMissingReason: health !== null
      ? null
      : runtimeStateSource !== 'CORE_LIVE'
        ? 'NOT_READ_FROM_CORE'
        : item === null
          ? 'NOT_REPORTED_BY_CORE'
          : 'NOT_LABELLED',
    origin: args.origin
  }
}

/** Trạng thái ngữ nghĩa của một dòng — dùng cho badge cột `State` (`T60-104`). */
export function programRuntimeSemanticState(state: ProgrammingProgramRuntimeState): SemanticState {
  switch (state) {
    case 'RUNNING':
      return 'good'
    case 'WAITING':
      // Đã nạp và được phép chạy nhưng chưa chạy — không phải lỗi, cũng không
      // phải "bình thường". `warning` là mức duy nhất nói đúng cả hai điều đó.
      return 'warning'
    case 'DISABLED':
      return 'disabled'
    case 'FAULTED':
      return 'fault'
    case 'UNKNOWN':
      return 'unknown'
  }
}

/** Trạng thái ngữ nghĩa của cột `Health`. `null` ⇒ `unknown` (ô sẽ vẽ `—` kèm lý do). */
export function programHealthSemanticState(health: ProgrammingProgramHealth | null): SemanticState {
  switch (health) {
    case 'HEALTHY':
      return 'good'
    case 'DEGRADED':
      return 'warning'
    case 'FAULT':
      return 'fault'
    default:
      return 'unknown'
  }
}

/* ------------------------------------------------------------------ *
 * View model của cả trang                                             *
 * ------------------------------------------------------------------ */

export interface OverviewViewModelInput {
  projectStatus: ResourceStatus
  project: ProgrammingProject | null
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  programsStatus: ResourceStatus
  programs: ProgrammingProgramsPage | null
  activeSet: ActiveProgramSet
  /**
   * `ISS-PGUI-01` — Revision đang chạy có THUỘC Project này không.
   *
   * `runtime.activeRevisionId` là của CONTROLLER, không của Project. Đọc nó
   * thẳng để kết luận "Project này đang vận hành" là cách màn hình khẳng định
   * `Active: Yes` cho một gói thuộc Project khác. Chỗ gọi phải trả lời câu này
   * bằng `activeRevisionOwnership`, không bằng `runtime.activeRevisionId !== null`.
   *
   * Truyền cả `kind` chứ không phải một cờ nhị phân: "chưa quy được về Project
   * nào" và "thiết bị chưa Commission" đều làm `present` sai, nhưng thẻ so
   * sánh phải nói HAI câu khác nhau — nói "controller chưa đưa gói nào vào vận
   * hành" cho một thiết bị đang chạy là một khẳng định sai.
   */
  activeOwnership: ActiveRevisionOwnership['kind']
}

export interface OverviewViewModel {
  projectId: string | null
  projectName: string | null
  draft: {
    /** `Draft #14`; `null` khi chưa phân giải được `sequence` (D-05). */
    label: string | null
    sequence: number | null
    /** `null` = server đã xét và chưa biết. Không được hiểu thành "sạch". */
    dirty: boolean | null
    checkState: ProgrammingCheckState | null
  }
  active: {
    /** `Active #12`; `null` khi chưa phân giải được. */
    label: string | null
    sequence: number | null
    /**
     * `true` khi Core nói có một Active Revision **và** gói ấy thuộc ĐÚNG
     * Project này (dù DB Web chưa phân giải được số của nó).
     */
    present: boolean
    /** `ISS-PGUI-01` — vì sao `present` sai, để thẻ so sánh nói đúng câu. */
    ownership: ActiveRevisionOwnership['kind']
    taskState: ProgrammingTaskState | null
  }
  core: {
    semantic: SemanticState
    producerState: ProgrammingTargetState | null
    observedAt: string | null
  }
  safeState: {
    /** `null` khi chưa đọc được runtime — KHÔNG mặc định `false`. */
    active: boolean | null
    /** Safe-state chỉ vì chưa Program nào ghi output vật lý: cảnh báo NHẸ, không phải lỗi. */
    noControllerOnly: boolean
  }
  programs: ProgramsSummaryModel
  primaryCta: PrimaryCtaDecision
}

export function overviewViewModel(input: OverviewViewModelInput): OverviewViewModel {
  const { project, runtime } = input
  const runtimeReadable = input.runtimeStatus === 'ready' && runtime !== null
  const producerState = runtimeReadable ? runtime.producerState : null

  return {
    projectId: project?.projectId ?? null,
    projectName: nonEmptyString(project?.name),
    draft: {
      label: revisionSequenceLabel('draft', project?.draftSequence ?? null),
      sequence: project?.draftSequence ?? null,
      dirty: project?.dirty ?? null,
      checkState: project?.latestCheck?.state ?? null
    },
    active: {
      label: revisionSequenceLabel('active', project?.activeSequence ?? null),
      sequence: project?.activeSequence ?? null,
      present: runtimeReadable && runtime.activeRevisionId !== null && input.activeOwnership === 'owned',
      ownership: input.activeOwnership,
      taskState: runtimeReadable ? runtime.taskState : null
    },
    core: {
      semantic: coreSemanticState(input.runtimeStatus, producerState),
      producerState,
      observedAt: runtimeReadable ? nonEmptyString(runtime.observedAt) : null
    },
    safeState: {
      active: runtimeReadable ? runtime.safeState : null,
      noControllerOnly: runtimeReadable ? runtime.safeStateNoControllerOnly === true : false
    },
    programs: overviewProgramRows({
      programsStatus: input.programsStatus,
      programs: input.programs,
      activeSet: input.activeSet,
      activeSequence: project?.activeSequence ?? null
    }),
    primaryCta: resolvePrimaryCta({
      projectStatus: input.projectStatus,
      projectId: project?.projectId ?? null,
      baseRevisionId: project?.baseRevisionId ?? null,
      dirty: project?.dirty ?? null,
      latestCheckState: project?.latestCheck?.state ?? null,
      runtimeStatus: input.runtimeStatus,
      producerState,
      activeRevisionId: runtimeReadable ? runtime.activeRevisionId : null
    })
  }
}

/** Core: `stale` cho `DEGRADED` (dữ liệu cũ), `fault` cho mất kết nối. Không có nhánh nào ra `good` khi chưa đọc được. */
export function coreSemanticState(status: ResourceStatus, producerState: ProgrammingTargetState | null): SemanticState {
  if (status === 'loading') return 'unknown'
  if (status === 'error' || producerState === null || producerState === 'UNAVAILABLE') return 'fault'
  return producerState === 'DEGRADED' ? 'stale' : 'good'
}
