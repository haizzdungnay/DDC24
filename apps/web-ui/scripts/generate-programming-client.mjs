import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../..");
const sourcePath = resolve(repositoryRoot, "contracts/openapi/openapi.yaml");
const errorCatalogPath = resolve(repositoryRoot, "contracts/programming/error_catalog_v1.json");
const outputPath = resolve(
  repositoryRoot,
  "apps/web-ui/src/features/programming/api/generated/client.ts",
);
const checkOnly = process.argv.includes("--check");

const document = parse(await readFile(sourcePath, "utf8"));
const errorCatalog = JSON.parse(await readFile(errorCatalogPath, "utf8"));
const supportedMethods = ["get", "post", "put", "patch", "delete"];
const endpoints = [];

for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  if (!path.startsWith("/programming/")) continue;
  for (const method of supportedMethods) {
    const operation = pathItem?.[method];
    if (!operation) continue;
    if (!operation.operationId || !Array.isArray(operation["x-rbac"])) {
      throw new Error(`${method.toUpperCase()} ${path} thiếu operationId hoặc x-rbac`);
    }
    endpoints.push({
      operationId: operation.operationId,
      method: method.toUpperCase(),
      path: `/api/v1${path}`,
      roles: operation["x-rbac"],
    });
  }
}

endpoints.sort((left, right) => left.operationId.localeCompare(right.operationId));
if (endpoints.length !== 28) {
  throw new Error(`Programming OpenAPI phải có 28 operation, thực tế ${endpoints.length}`);
}
if (new Set(endpoints.map(({ operationId }) => operationId)).size !== endpoints.length) {
  throw new Error("Programming OpenAPI có operationId trùng");
}

const schemas = document.components?.schemas ?? {};
const schemaVersion = schemas.ProgrammingCapabilities?.properties?.schemaVersion?.const;
const errorCodes = schemas.ProgrammingPublicError?.properties?.code?.enum;
const impactStatuses = schemas.ProgrammingImpactStatus?.enum;
const impactKeys = schemas.ProgrammingImpactKey?.enum;
if (schemaVersion !== "1.0" || !errorCodes || !impactStatuses || !impactKeys) {
  throw new Error("Programming OpenAPI thiếu schemaVersion hoặc enum contract bắt buộc");
}
const catalogErrorCodes = errorCatalog.publicErrors?.map(({ code }) => code) ?? [];
const openapiErrorSet = new Set(errorCodes);
const catalogErrorSet = new Set(catalogErrorCodes);
if (
  openapiErrorSet.size !== errorCodes.length ||
  catalogErrorSet.size !== catalogErrorCodes.length ||
  errorCodes.some((code) => !catalogErrorSet.has(code)) ||
  catalogErrorCodes.some((code) => !openapiErrorSet.has(code))
) {
  throw new Error("Enum lỗi Programming trong OpenAPI lệch error_catalog_v1.json");
}

const quotedUnion = (items) => items.map((item) => JSON.stringify(item)).join(" | ");
const endpointLines = endpoints
  .map(
    ({ operationId, method, path, roles }) =>
      `  ${JSON.stringify(operationId)}: { method: ${JSON.stringify(method)}, path: ${JSON.stringify(path)}, roles: ${JSON.stringify(roles)} },`,
  )
  .join("\n");

const generated = `// Tệp sinh tự động từ contracts/openapi/openapi.yaml. Không sửa bằng tay.
// Chạy: npm run generate:programming-api

import {
  PROGRAMMING_ERROR_CATALOG,
  sanitizeProgrammingErrorArgs,
  type ProgrammingErrorCode,
} from "./errors";
export type { ProgrammingErrorCode } from "./errors";

export const PROGRAMMING_OPENAPI_VERSION = ${JSON.stringify(document.info.version)} as const;
export const PROGRAMMING_SCHEMA_VERSION = ${JSON.stringify(schemaVersion)} as const;
export type ProgrammingRole = "viewer" | "operator" | "admin";
export type ProgrammingHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ProgrammingImpactStatus = ${quotedUnion(impactStatuses)};
export type ProgrammingImpactKey = ${quotedUnion(impactKeys)};

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
  const field = typeof raw.field === "string" && /^[A-Za-z0-9_.[\\]-]{1,128}$/.test(raw.field)
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
${endpointLines}
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
  const resolved = template.replace(/\\{([^}]+)\\}/g, (_, key: string) => {
    const value = values[key];
    if (!value) throw new Error(\`Thiếu path parameter: \${key}\`);
    return encodeURIComponent(value);
  });
  if (resolved.includes("{")) throw new Error(\`Path chưa resolve: \${resolved}\`);
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
`;

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    throw new Error("Client Programming đã lệch OpenAPI; chạy npm run generate:programming-api");
  }
  console.log(`Programming API client đồng bộ: ${endpoints.length} operation`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated);
  console.log(`Đã sinh ${outputPath} từ ${endpoints.length} operation`);
}
