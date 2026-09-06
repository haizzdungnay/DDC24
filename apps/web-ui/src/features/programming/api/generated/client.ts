// Tệp sinh tự động từ contracts/openapi/openapi.yaml. Không sửa bằng tay.
// Chạy: npm run generate:programming-api

import {
  PROGRAMMING_ERROR_CATALOG,
  sanitizeProgrammingErrorArgs,
  type ProgrammingErrorCode,
} from "./errors";
export type { ProgrammingErrorCode } from "./errors";

export const PROGRAMMING_OPENAPI_VERSION = "1.39.0" as const;
export const PROGRAMMING_SCHEMA_VERSION = "1.0" as const;
export type ProgrammingRole = "viewer" | "operator" | "engineer" | "admin";
export type ProgrammingPermission = "read" | "program.edit" | "program.activate" | "simulation.run";
export type ProgrammingHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ProgrammingImpactStatus = "NONE" | "PRESENT" | "UNAVAILABLE";
export type ProgrammingImpactKey = "retain" | "activeOverrides" | "cutover" | "outputMappingChanges" | "publishedSignals" | "controlLibrary" | "programSet" | "enableIntent" | "physicalMappingChanges" | "virtualPointChanges" | "modbusMappingChanges" | "writableOutputsAffected";

// --- Bảng Programs của PGM-01 (T60-013/T60-014), sinh thẳng từ schema OpenAPI.
// Trường nullable là `| null` chứ KHÔNG phải optional: server luôn gửi khoá, và
// `null` nghĩa là "đã xét, chưa biết" — không được suy thành `0`/`false`.
export interface ProgrammingBindingPointIdentity {
  category: "LOCAL" | "VP" | "MB_RTU";
  pointId: string;
  deviceId?: string;
}

export interface ProgrammingBindingCandidate {
  bindingId: string;
  variableId: string;
  point: ProgrammingBindingPointIdentity;
  direction: "READ" | "WRITE";
  dataType: "BOOL" | "INT" | "DINT" | "UINT" | "REAL" | "TIME";
  unit?: string;
  writable: boolean;
  qualityPolicy: "REQUIRE_GOOD" | "ALLOW_UNCERTAIN" | "FAIL_POLICY";
}

export interface ProgrammingBindingPreviewRequest {
  schemaVersion: "1.0";
  baseRevisionId: string;
  binding: ProgrammingBindingCandidate;
}

export interface ProgrammingBindingValidationIssue {
  code: "PRG-ERR-REQ-001" | "PRG-ERR-MAP-003" | "PRG-ERR-MAP-004" | "PRG-ERR-OUTPUT-OWNER-001";
  detailCode: string;
  severity: "WARNING" | "ERROR";
  field: string;
  bindingId?: string;
  variableId?: string;
  programId?: string;
  ownerProgramId?: string;
  conflictProgramId?: string;
  category?: "LOCAL" | "VP" | "MB_RTU";
  deviceId?: string;
  pointId?: string;
  expected?: string;
  actual?: string;
}

export interface ProgrammingBindingPreview {
  schemaVersion: "1.0";
  verdict: "ALLOW" | "WARN" | "BLOCK";
  issues: ProgrammingBindingValidationIssue[];
  projectId: string;
  draftRevisionId: string;
  baseRevisionId: string;
  etag: string;
}

export type ProgrammingProgramRuntimeState = "RUNNING" | "WAITING" | "DISABLED" | "FAULTED" | "UNKNOWN";

export type ProgrammingProgramRuntimeStateSource = "CORE_LIVE" | "LAST_KNOWN" | "UNAVAILABLE";

export type ProgrammingProgramHealth = "HEALTHY" | "DEGRADED" | "FAULT" | "UNKNOWN";

export interface ProgrammingProgramListItem {
  programId: string;
  desiredEnabled: boolean | null;
  generation: number | null;
  updatedBy: string | null;
  updatedAtUtcMs: number | null;
  runtimeState: ProgrammingProgramRuntimeState;
  runtimeStateSource: ProgrammingProgramRuntimeStateSource;
  coreState: string | null;
  enabled: boolean | null;
  observedAt: string | null;
  periodMs: number | null;
  lastExecNs: number | null;
  maxExecNs: number | null;
  missedReleaseCount: number | null;
  consecutiveMissedRelease: number | null;
  lastRunAtUtc: string | null;
  lastRunAgeMs: number | null;
  lane: number | null;
  lastFaultCode: string | null;
  lastFaultLine: number | null;
  faultCount: number | null;
  health: ProgrammingProgramHealth | null;
}

export interface ProgrammingProgramsPage {
  schemaVersion: "1.0";
  projectId: string;
  runtimeStateSource: ProgrammingProgramRuntimeStateSource;
  observedAt: string | null;
  programsTruncated: boolean | null;
  items: ProgrammingProgramListItem[];
}

export interface ProgrammingStHunk {
  objectId: string;
  changeType: "ADDED" | "REMOVED" | "REPLACED";
  beforeStartLine: number;
  beforeLineCount: number;
  afterStartLine: number;
  afterLineCount: number;
  beforeText: string[];
  afterText: string[];
  truncated: boolean;
  coarse: boolean;
}

export interface ProgrammingFbdChange {
  objectId: string;
  element: "NETWORK" | "NODE" | "PORT" | "WIRE";
  elementId: string;
  changeType: "ADDED" | "REMOVED" | "UPDATED" | "ORDER_ONLY" | "GEOMETRY_ONLY";
  detail: string;
}

export interface ProgrammingPublicError {
  code: ProgrammingErrorCode;
  messageKey: string;
  args?: Record<string, unknown>;
  field?: string;
  retryable: boolean;
  keepsRunningRevision: boolean;
  correlationId: string;
}

export interface ProgrammingErrorEnvelope {
  error: ProgrammingPublicError;
}

const FALLBACK_PROGRAMMING_ERROR: ProgrammingErrorCode = "PRG-ERR-UNAVAILABLE-001";

function isProgrammingErrorCode(value: unknown): value is ProgrammingErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROGRAMMING_ERROR_CATALOG, value);
}

function normalizeProgrammingErrorEnvelope(payload: unknown, status: number): ProgrammingErrorEnvelope {
  const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const raw = typeof record.error === "object" && record.error !== null
    ? record.error as Record<string, unknown>
    : {};
  let knownCode = false;
  let rawCode: ProgrammingErrorCode = FALLBACK_PROGRAMMING_ERROR;
  if (isProgrammingErrorCode(raw.code)) {
    knownCode = true;
    rawCode = raw.code;
  }
  const rawMetadata = PROGRAMMING_ERROR_CATALOG[rawCode];
  const statusMatches = (rawMetadata.httpStatuses as readonly number[]).includes(status);
  const code: ProgrammingErrorCode = knownCode && statusMatches ? rawCode : FALLBACK_PROGRAMMING_ERROR;
  const metadata = PROGRAMMING_ERROR_CATALOG[code];
  const args = sanitizeProgrammingErrorArgs(
    code,
    typeof raw.args === "object" && raw.args !== null && !Array.isArray(raw.args)
      ? raw.args as Record<string, unknown>
      : undefined,
  );
  const field = typeof raw.field === "string" && /^[A-Za-z0-9_.[\]-]{1,128}$/.test(raw.field)
    ? raw.field
    : undefined;
  const correlationId = typeof raw.correlationId === "string" && /^[A-Za-z0-9._-]{16,64}$/.test(raw.correlationId)
    ? raw.correlationId
    : "invalid-correlation-id";
  return {
    error: {
      code,
      messageKey: metadata.messageKey,
      ...(args ? { args } : {}),
      ...(field ? { field } : {}),
      retryable: metadata.retryable,
      keepsRunningRevision: knownCode && statusMatches && typeof raw.keepsRunningRevision === "boolean"
        ? raw.keepsRunningRevision
        : metadata.keepsRunningRevision,
      correlationId,
    },
  };
}

export interface ProgrammingImpactGroup {
  status: ProgrammingImpactStatus;
  items: string[];
}

export interface ProgrammingImpact {
  impactRef: string;
  retain: ProgrammingImpactGroup;
  activeOverrides: ProgrammingImpactGroup;
  cutover: ProgrammingImpactGroup;
  outputMappingChanges: ProgrammingImpactGroup;
  publishedSignals: ProgrammingImpactGroup;
  controlLibrary: ProgrammingImpactGroup;
  programSet: ProgrammingImpactGroup;
  enableIntent: ProgrammingImpactGroup;
  physicalMappingChanges: ProgrammingImpactGroup;
  virtualPointChanges: ProgrammingImpactGroup;
  modbusMappingChanges: ProgrammingImpactGroup;
  writableOutputsAffected: ProgrammingImpactGroup;
}

export interface ProgrammingCommissionRequest {
  schemaVersion: typeof PROGRAMMING_SCHEMA_VERSION;
  revisionId: string;
  expectedActiveRevisionId: string | null;
  checkId: string;
  impactRef: string;
  acknowledgements: ProgrammingImpactKey[];
  cutover: {
    requested: "GRAPH_ONLY" | "PROGRAM_ONLY";
    graphBackupId?: string | null;
  };
}

export interface ProgrammingOperationAccepted {
  operationId: string;
  statusUrl: string;
  state: "QUEUED";
  requestHash: string;
  acceptedAt: string;
  correlationId: string;
}

export const PROGRAMMING_ENDPOINTS = {
  "actProgrammingSimulationSession": { method: "POST", path: "/api/v1/programming/simulation/sessions/{sessionId}/actions", roles: ["admin"], permission: "simulation.run" },
  "checkProgrammingLibraryEntry": { method: "POST", path: "/api/v1/programming/projects/{projectId}/library/entries/check", roles: ["engineer","admin"], permission: "program.edit" },
  "commissionProgrammingRevision": { method: "POST", path: "/api/v1/programming/operations/commission", roles: ["engineer","admin"], permission: "program.activate" },
  "compareProgrammingRevisions": { method: "GET", path: "/api/v1/programming/revisions/{from}/changes/{to}", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "createProgrammingCheck": { method: "POST", path: "/api/v1/programming/revisions/{revisionId}/checks", roles: ["engineer","admin"], permission: "program.edit" },
  "createProgrammingProject": { method: "POST", path: "/api/v1/programming/projects", roles: ["engineer","admin"], permission: "program.edit" },
  "createProgrammingRevision": { method: "POST", path: "/api/v1/programming/projects/{projectId}/draft/revisions", roles: ["engineer","admin"], permission: "program.edit" },
  "createProgrammingSimulationSession": { method: "POST", path: "/api/v1/programming/simulation/sessions", roles: ["admin"], permission: "simulation.run" },
  "createProgrammingTrace": { method: "POST", path: "/api/v1/programming/runtime/traces", roles: ["engineer","admin"], permission: "program.edit" },
  "deleteProgrammingLibraryEntry": { method: "DELETE", path: "/api/v1/programming/projects/{projectId}/library/entries/{entryId}", roles: ["engineer","admin"], permission: "program.edit" },
  "deprecateProgrammingLibraryRevision": { method: "POST", path: "/api/v1/programming/projects/{projectId}/library/revisions/{libraryRevisionId}/deprecate", roles: ["engineer","admin"], permission: "program.edit" },
  "exportProgrammingBundle": { method: "POST", path: "/api/v1/programming/bundles/export", roles: ["engineer","admin"], permission: "program.edit" },
  "getProgrammingCapabilities": { method: "GET", path: "/api/v1/programming/capabilities", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingCheck": { method: "GET", path: "/api/v1/programming/checks/{checkId}", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingLibraryEntrySource": { method: "GET", path: "/api/v1/programming/library-entry-source", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingOperation": { method: "GET", path: "/api/v1/programming/operations/{operationId}", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingPointCatalog": { method: "GET", path: "/api/v1/programming/point-catalog", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingProject": { method: "GET", path: "/api/v1/programming/projects/{projectId}", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingRevision": { method: "GET", path: "/api/v1/programming/revisions/{revisionId}", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingRuntime": { method: "GET", path: "/api/v1/programming/runtime", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingRuntimeMonitor": { method: "GET", path: "/api/v1/programming/runtime/monitor", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingRuntimeSignals": { method: "GET", path: "/api/v1/programming/runtime/signals", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingSimulationSession": { method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "getProgrammingTrace": { method: "GET", path: "/api/v1/programming/runtime/traces/{traceId}", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "importProgrammingBundle": { method: "POST", path: "/api/v1/programming/bundles/import", roles: ["engineer","admin"], permission: "program.activate" },
  "listProgrammingAudit": { method: "GET", path: "/api/v1/programming/audit", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "listProgrammingLibraryUsages": { method: "GET", path: "/api/v1/programming/library-usages", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "listProgrammingOperations": { method: "GET", path: "/api/v1/programming/operations", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "listProgrammingOverrides": { method: "GET", path: "/api/v1/programming/overrides", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "listProgrammingProgramIntents": { method: "GET", path: "/api/v1/programming/projects/{projectId}/programs", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "listProgrammingProjects": { method: "GET", path: "/api/v1/programming/projects", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "listProgrammingSimulationObservations": { method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}/observations", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "listProgrammingSimulationTrace": { method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}/trace", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "previewProgrammingBinding": { method: "POST", path: "/api/v1/programming/projects/{projectId}/draft/bindings/preview", roles: ["engineer","admin"], permission: "program.edit" },
  "resetProgrammingRecovery": { method: "POST", path: "/api/v1/programming/runtime/recovery-reset", roles: ["engineer","admin"], permission: "program.activate" },
  "resetProgrammingRetain": { method: "POST", path: "/api/v1/programming/retain/reset", roles: ["engineer","admin"], permission: "program.activate" },
  "restoreProgrammingRevision": { method: "POST", path: "/api/v1/programming/operations/restore", roles: ["engineer","admin"], permission: "program.activate" },
  "searchProgrammingLibraries": { method: "GET", path: "/api/v1/programming/libraries", roles: ["viewer","operator","engineer","admin"], permission: "read" },
  "setProgrammingProgramIntent": { method: "PUT", path: "/api/v1/programming/projects/{projectId}/programs/{programId}/runtime-intent", roles: ["engineer","admin"], permission: "program.activate" },
  "setProgrammingSimulationInput": { method: "PUT", path: "/api/v1/programming/simulation/sessions/{sessionId}/inputs/{observationId}", roles: ["admin"], permission: "simulation.run" },
  "stopProgrammingSimulationSession": { method: "DELETE", path: "/api/v1/programming/simulation/sessions/{sessionId}", roles: ["admin"], permission: "simulation.run" },
  "stopProgrammingTrace": { method: "DELETE", path: "/api/v1/programming/runtime/traces/{traceId}", roles: ["engineer","admin"], permission: "program.edit" },
  "updateProgrammingDraft": { method: "PATCH", path: "/api/v1/programming/projects/{projectId}/draft", roles: ["engineer","admin"], permission: "program.edit" },
  "upsertProgrammingLibraryEntry": { method: "POST", path: "/api/v1/programming/projects/{projectId}/library/entries", roles: ["engineer","admin"], permission: "program.edit" },
} as const satisfies Record<string, {
  method: ProgrammingHttpMethod;
  path: string;
  roles: readonly ProgrammingRole[];
  permission: ProgrammingPermission;
}>;

export type ProgrammingOperationId = keyof typeof PROGRAMMING_ENDPOINTS;

export interface ProgrammingRequestOptions<TBody = unknown> {
  path?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: TBody;
  correlationId?: string;
  idempotencyKey?: string;
  ifMatch?: string;
  signal?: AbortSignal;
  /** `T61-402` — trần chờ của MỘT request. Mặc định
   *  `PROGRAMMING_REQUEST_TIMEOUT_MS`; đặt `0` để tắt (chỉ dùng cho test). */
  timeoutMs?: number;
}

/**
 * `T61-402` — trần chờ mặc định của một request Programming.
 *
 * Trước lát này client KHÔNG có trần nào: một request treo sẽ treo mãi, nên
 * đường ghi không bao giờ tới được trạng thái "không rõ kết quả" mà nó phải xử
 * lý — nó chỉ đứng im ở "đang gửi" và người dùng bấm lại.
 */
export const PROGRAMMING_REQUEST_TIMEOUT_MS = 15000;

/**
 * `T61-402` — request KHÔNG nhận được dòng trạng thái nào.
 *
 * Đây là lớp lỗi DUY NHẤT mà kết quả trên máy chủ là KHÔNG BIẾT: request có thể
 * đã tới nơi và đã commit, chỉ có phản hồi là mất. Mọi lỗi khác đều mang một mã
 * HTTP, nghĩa là máy chủ đã trả lời và transaction đã ngã ngũ.
 *
 * `reason` giữ nguyên nguyên nhân gốc để màn hình nói đúng chuyện đã xảy ra
 * thay vì gộp cả ba thành "lỗi mạng".
 */
export class ProgrammingNoResponseError extends Error {
  constructor(
    readonly reason: "timeout" | "abort" | "network",
    readonly timeoutMs: number,
    options?: { cause?: unknown },
  ) {
    super(`Không nhận được phản hồi từ máy chủ (${reason})`);
    this.name = "ProgrammingNoResponseError";
    if (options && "cause" in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

export class ProgrammingApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ProgrammingErrorEnvelope,
  ) {
    super(envelope.error.messageKey);
    this.name = "ProgrammingApiError";
  }
}

function resolvePath(template: string, values: Record<string, string> = {}): string {
  const resolved = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = values[key];
    if (!value) throw new Error(`Thiếu path parameter: ${key}`);
    return encodeURIComponent(value);
  });
  if (resolved.includes("{")) throw new Error(`Path chưa resolve: ${resolved}`);
  return resolved;
}

export class ProgrammingApiClient {
  constructor(
    private readonly origin = "",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly onForbidden?: (permission: ProgrammingPermission, operationId: ProgrammingOperationId) => void,
  ) {}

  async request<TResponse, TBody = unknown>(
    operationId: ProgrammingOperationId,
    options: ProgrammingRequestOptions<TBody> = {},
  ): Promise<TResponse> {
    const endpoint = PROGRAMMING_ENDPOINTS[operationId];
    const url = new URL(resolvePath(endpoint.path, options.path), this.origin || window.location.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ Accept: "application/json" });
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.correlationId) headers.set("X-Correlation-ID", options.correlationId);
    if (options.idempotencyKey) headers.set("X-Idempotency-Key", options.idempotencyKey);
    if (options.ifMatch) headers.set("If-Match", options.ifMatch);
    /* Trần chờ nằm ở ĐÂY, không ở từng chỗ gọi: một chỗ gọi quên đặt trần là
       một request có thể treo vô hạn, và một request treo vô hạn không bao giờ
       tới được nhánh "không rõ kết quả". `AbortController` riêng để không nuốt
       mất `signal` của caller — huỷ từ caller vẫn phải huỷ được request. */
    const timeoutMs = options.timeoutMs ?? PROGRAMMING_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
      : undefined;
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: endpoint.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        credentials: "same-origin",
      });
    } catch (cause) {
      /* Ba nguyên nhân, MỘT kết luận: chưa có dòng trạng thái nào, nên kết quả
         trên máy chủ là không biết. Phân biệt chúng ở `reason` để màn hình nói
         đúng chuyện đã xảy ra. */
      if (timedOut) throw new ProgrammingNoResponseError("timeout", timeoutMs, { cause });
      if (options.signal?.aborted) throw new ProgrammingNoResponseError("abort", timeoutMs, { cause });
      throw new ProgrammingNoResponseError("network", timeoutMs, { cause });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined);
      const envelope = normalizeProgrammingErrorEnvelope(payload, response.status);
      /* ISS-PGM-RBAC-01: 403 là bằng chứng quyền đã bị thu hồi sau mount.
         Báo đúng capability của operation cho provider; không tự retry mutation. */
      if (response.status === 403) this.onForbidden?.(endpoint.permission, operationId);
      throw new ProgrammingApiError(response.status, envelope);
    }
    if (response.status === 204) return undefined as TResponse;
    return (await response.json()) as TResponse;
  }
}
