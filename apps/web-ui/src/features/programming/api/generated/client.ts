// Tệp sinh tự động từ contracts/openapi/openapi.yaml. Không sửa bằng tay.
// Chạy: npm run generate:programming-api

import {
  PROGRAMMING_ERROR_CATALOG,
  sanitizeProgrammingErrorArgs,
  type ProgrammingErrorCode,
} from "./errors";
export type { ProgrammingErrorCode } from "./errors";

export const PROGRAMMING_OPENAPI_VERSION = "1.32.0" as const;
export const PROGRAMMING_SCHEMA_VERSION = "1.0" as const;
export type ProgrammingRole = "viewer" | "operator" | "engineer" | "admin";
export type ProgrammingHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ProgrammingImpactStatus = "NONE" | "PRESENT" | "UNAVAILABLE";
export type ProgrammingImpactKey = "retain" | "activeOverrides" | "cutover" | "outputMappingChanges" | "publishedSignals" | "controlLibrary" | "programSet" | "enableIntent";

// --- Bảng Programs của PGM-01 (T60-013/T60-014), sinh thẳng từ schema OpenAPI.
// Trường nullable là `| null` chứ KHÔNG phải optional: server luôn gửi khoá, và
// `null` nghĩa là "đã xét, chưa biết" — không được suy thành `0`/`false`.
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
  "actProgrammingSimulationSession": { method: "POST", path: "/api/v1/programming/simulation/sessions/{sessionId}/actions", roles: ["admin"] },
  "commissionProgrammingRevision": { method: "POST", path: "/api/v1/programming/operations/commission", roles: ["engineer","admin"] },
  "compareProgrammingRevisions": { method: "GET", path: "/api/v1/programming/revisions/{from}/changes/{to}", roles: ["viewer","operator","engineer","admin"] },
  "createProgrammingCheck": { method: "POST", path: "/api/v1/programming/revisions/{revisionId}/checks", roles: ["engineer","admin"] },
  "createProgrammingProject": { method: "POST", path: "/api/v1/programming/projects", roles: ["engineer","admin"] },
  "createProgrammingRevision": { method: "POST", path: "/api/v1/programming/projects/{projectId}/draft/revisions", roles: ["engineer","admin"] },
  "createProgrammingSimulationSession": { method: "POST", path: "/api/v1/programming/simulation/sessions", roles: ["admin"] },
  "createProgrammingTrace": { method: "POST", path: "/api/v1/programming/runtime/traces", roles: ["engineer","admin"] },
  "deleteProgrammingLibraryEntry": { method: "DELETE", path: "/api/v1/programming/projects/{projectId}/library/entries/{entryId}", roles: ["engineer","admin"] },
  "deprecateProgrammingLibraryRevision": { method: "POST", path: "/api/v1/programming/projects/{projectId}/library/revisions/{libraryRevisionId}/deprecate", roles: ["engineer","admin"] },
  "exportProgrammingBundle": { method: "POST", path: "/api/v1/programming/bundles/export", roles: ["engineer","admin"] },
  "getProgrammingCapabilities": { method: "GET", path: "/api/v1/programming/capabilities", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingCheck": { method: "GET", path: "/api/v1/programming/checks/{checkId}", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingOperation": { method: "GET", path: "/api/v1/programming/operations/{operationId}", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingPointCatalog": { method: "GET", path: "/api/v1/programming/point-catalog", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingProject": { method: "GET", path: "/api/v1/programming/projects/{projectId}", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingRevision": { method: "GET", path: "/api/v1/programming/revisions/{revisionId}", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingRuntime": { method: "GET", path: "/api/v1/programming/runtime", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingRuntimeMonitor": { method: "GET", path: "/api/v1/programming/runtime/monitor", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingRuntimeSignals": { method: "GET", path: "/api/v1/programming/runtime/signals", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingSimulationSession": { method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}", roles: ["viewer","operator","engineer","admin"] },
  "getProgrammingTrace": { method: "GET", path: "/api/v1/programming/runtime/traces/{traceId}", roles: ["viewer","operator","engineer","admin"] },
  "importProgrammingBundle": { method: "POST", path: "/api/v1/programming/bundles/import", roles: ["engineer","admin"] },
  "listProgrammingAudit": { method: "GET", path: "/api/v1/programming/audit", roles: ["viewer","operator","engineer","admin"] },
  "listProgrammingLibraryUsages": { method: "GET", path: "/api/v1/programming/library-usages", roles: ["viewer","operator","engineer","admin"] },
  "listProgrammingOperations": { method: "GET", path: "/api/v1/programming/operations", roles: ["viewer","operator","engineer","admin"] },
  "listProgrammingOverrides": { method: "GET", path: "/api/v1/programming/overrides", roles: ["viewer","operator","engineer","admin"] },
  "listProgrammingProgramIntents": { method: "GET", path: "/api/v1/programming/projects/{projectId}/programs", roles: ["viewer","operator","engineer","admin"] },
  "listProgrammingProjects": { method: "GET", path: "/api/v1/programming/projects", roles: ["viewer","operator","engineer","admin"] },
  "listProgrammingSimulationObservations": { method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}/observations", roles: ["viewer","operator","engineer","admin"] },
  "listProgrammingSimulationTrace": { method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}/trace", roles: ["viewer","operator","engineer","admin"] },
  "resetProgrammingRecovery": { method: "POST", path: "/api/v1/programming/runtime/recovery-reset", roles: ["engineer","admin"] },
  "resetProgrammingRetain": { method: "POST", path: "/api/v1/programming/retain/reset", roles: ["engineer","admin"] },
  "restoreProgrammingRevision": { method: "POST", path: "/api/v1/programming/operations/restore", roles: ["engineer","admin"] },
  "searchProgrammingLibraries": { method: "GET", path: "/api/v1/programming/libraries", roles: ["viewer","operator","engineer","admin"] },
  "setProgrammingProgramIntent": { method: "PUT", path: "/api/v1/programming/projects/{projectId}/programs/{programId}/runtime-intent", roles: ["engineer","admin"] },
  "setProgrammingSimulationInput": { method: "PUT", path: "/api/v1/programming/simulation/sessions/{sessionId}/inputs/{observationId}", roles: ["admin"] },
  "stopProgrammingSimulationSession": { method: "DELETE", path: "/api/v1/programming/simulation/sessions/{sessionId}", roles: ["admin"] },
  "stopProgrammingTrace": { method: "DELETE", path: "/api/v1/programming/runtime/traces/{traceId}", roles: ["engineer","admin"] },
  "updateProgrammingDraft": { method: "PATCH", path: "/api/v1/programming/projects/{projectId}/draft", roles: ["engineer","admin"] },
  "upsertProgrammingLibraryEntry": { method: "POST", path: "/api/v1/programming/projects/{projectId}/library/entries", roles: ["engineer","admin"] },
} as const satisfies Record<string, {
  method: ProgrammingHttpMethod;
  path: string;
  roles: readonly ProgrammingRole[];
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
    const response = await this.fetchImpl(url, {
      method: endpoint.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: "same-origin",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined);
      const envelope = normalizeProgrammingErrorEnvelope(payload, response.status);
      throw new ProgrammingApiError(response.status, envelope);
    }
    if (response.status === 204) return undefined as TResponse;
    return (await response.json()) as TResponse;
  }
}
