// Tệp sinh tự động từ contracts/openapi/openapi.yaml. Không sửa bằng tay.
// Chạy: npm run generate:programming-api

import {
  PROGRAMMING_ERROR_CATALOG,
  sanitizeProgrammingErrorArgs,
  type ProgrammingErrorCode,
} from "./errors";
export type { ProgrammingErrorCode } from "./errors";

export const PROGRAMMING_OPENAPI_VERSION = "1.26.0" as const;
export const PROGRAMMING_SCHEMA_VERSION = "1.0" as const;
export type ProgrammingRole = "viewer" | "operator" | "admin";
export type ProgrammingHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ProgrammingImpactStatus = "NONE" | "PRESENT" | "UNAVAILABLE";
export type ProgrammingImpactKey = "retain" | "activeOverrides" | "cutover" | "outputMappingChanges" | "publishedSignals" | "controlLibrary" | "programSet" | "enableIntent";

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
  "commissionProgrammingRevision": { method: "POST", path: "/api/v1/programming/operations/commission", roles: ["admin"] },
  "compareProgrammingRevisions": { method: "GET", path: "/api/v1/programming/revisions/{from}/changes/{to}", roles: ["viewer","operator","admin"] },
  "createProgrammingCheck": { method: "POST", path: "/api/v1/programming/revisions/{revisionId}/checks", roles: ["admin"] },
  "createProgrammingProject": { method: "POST", path: "/api/v1/programming/projects", roles: ["admin"] },
  "createProgrammingRevision": { method: "POST", path: "/api/v1/programming/projects/{projectId}/draft/revisions", roles: ["admin"] },
  "createProgrammingTrace": { method: "POST", path: "/api/v1/programming/runtime/traces", roles: ["admin"] },
  "deleteProgrammingLibraryEntry": { method: "DELETE", path: "/api/v1/programming/projects/{projectId}/library/entries/{entryId}", roles: ["admin"] },
  "exportProgrammingBundle": { method: "POST", path: "/api/v1/programming/bundles/export", roles: ["admin"] },
  "getProgrammingCapabilities": { method: "GET", path: "/api/v1/programming/capabilities", roles: ["viewer","operator","admin"] },
  "getProgrammingCheck": { method: "GET", path: "/api/v1/programming/checks/{checkId}", roles: ["viewer","operator","admin"] },
  "getProgrammingOperation": { method: "GET", path: "/api/v1/programming/operations/{operationId}", roles: ["viewer","operator","admin"] },
  "getProgrammingPointCatalog": { method: "GET", path: "/api/v1/programming/point-catalog", roles: ["viewer","operator","admin"] },
  "getProgrammingProject": { method: "GET", path: "/api/v1/programming/projects/{projectId}", roles: ["viewer","operator","admin"] },
  "getProgrammingRevision": { method: "GET", path: "/api/v1/programming/revisions/{revisionId}", roles: ["viewer","operator","admin"] },
  "getProgrammingRuntime": { method: "GET", path: "/api/v1/programming/runtime", roles: ["viewer","operator","admin"] },
  "getProgrammingRuntimeMonitor": { method: "GET", path: "/api/v1/programming/runtime/monitor", roles: ["viewer","operator","admin"] },
  "getProgrammingRuntimeSignals": { method: "GET", path: "/api/v1/programming/runtime/signals", roles: ["viewer","operator","admin"] },
  "getProgrammingTrace": { method: "GET", path: "/api/v1/programming/runtime/traces/{traceId}", roles: ["viewer","operator","admin"] },
  "importProgrammingBundle": { method: "POST", path: "/api/v1/programming/bundles/import", roles: ["admin"] },
  "listProgrammingAudit": { method: "GET", path: "/api/v1/programming/audit", roles: ["viewer","operator","admin"] },
  "listProgrammingOperations": { method: "GET", path: "/api/v1/programming/operations", roles: ["viewer","operator","admin"] },
  "listProgrammingOverrides": { method: "GET", path: "/api/v1/programming/overrides", roles: ["viewer","operator","admin"] },
  "listProgrammingProgramIntents": { method: "GET", path: "/api/v1/programming/projects/{projectId}/programs", roles: ["viewer","operator","admin"] },
  "listProgrammingProjects": { method: "GET", path: "/api/v1/programming/projects", roles: ["viewer","operator","admin"] },
  "resetProgrammingRecovery": { method: "POST", path: "/api/v1/programming/runtime/recovery-reset", roles: ["admin"] },
  "resetProgrammingRetain": { method: "POST", path: "/api/v1/programming/retain/reset", roles: ["admin"] },
  "restoreProgrammingRevision": { method: "POST", path: "/api/v1/programming/operations/restore", roles: ["admin"] },
  "searchProgrammingLibraries": { method: "GET", path: "/api/v1/programming/libraries", roles: ["viewer","operator","admin"] },
  "setProgrammingProgramIntent": { method: "PUT", path: "/api/v1/programming/projects/{projectId}/programs/{programId}/runtime-intent", roles: ["admin"] },
  "stopProgrammingTrace": { method: "DELETE", path: "/api/v1/programming/runtime/traces/{traceId}", roles: ["admin"] },
  "updateProgrammingDraft": { method: "PATCH", path: "/api/v1/programming/projects/{projectId}/draft", roles: ["admin"] },
  "upsertProgrammingLibraryEntry": { method: "POST", path: "/api/v1/programming/projects/{projectId}/library/entries", roles: ["admin"] },
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
