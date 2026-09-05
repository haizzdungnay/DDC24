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
// 33 operation Rev A/R1-R2 + 7 operation Simulation R3 (T59-814)
// + 1 operation Used-In (T61-105) + 1 operation Check entry Library (T61-401)
// + 1 operation đọc mã nguồn entry (T61-404). Con số là contract: thêm endpoint
// mà quên sinh lại client sẽ đỏ ở đây thay vì lộ ra dưới dạng một hàm thiếu
// trong FE.
if (endpoints.length !== 43) {
  throw new Error(`Programming OpenAPI phải có 43 operation, thực tế ${endpoints.length}`);
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

// --- Sinh type TypeScript thẳng từ schema OpenAPI ---------------------------
//
// Trước T60-016 script này chỉ sinh bảng endpoint, nên mọi schema đọc phải khai
// TAY ở `model/types.ts` và không có gì bắt chúng khớp contract. Hệ quả đã thấy
// thật: enum `runtimeState` khai tay còn mang `STARTING`/`STOPPING` — hai giá
// trị mà D-07 nói rõ không bao giờ được bày ra. Type khai tay không lệch ồn ào;
// nó lệch im lặng cho tới khi có người đọc một trường không tồn tại.
//
// Danh sách dưới đây CÓ THỨ TỰ: một schema chỉ được `$ref` tới schema đứng
// TRƯỚC nó, và thứ tự này cũng là thứ tự khai báo trong tệp sinh ra. Ràng buộc
// đó cố ý chặt — nó biến một vòng tham chiếu thành lỗi lúc sinh, thay vì thành
// một type `any` ngầm ở phía dùng.
const generatedTypeSchemas = [
  "ProgrammingProgramRuntimeState",
  "ProgrammingProgramRuntimeStateSource",
  "ProgrammingProgramHealth",
  "ProgrammingProgramListItem",
  "ProgrammingProgramsPage",
  // T59-819 — typed diff của Compare. Hai schema này KHÔNG khai tay: enum
  // `changeType` của chúng là thứ quyết định UI vẽ "đổi logic" hay chỉ "đổi
  // chỗ đứng trên canvas", và một bản khai tay lệch sẽ lệch im lặng.
  "ProgrammingStHunk",
  "ProgrammingFbdChange",
];

const scalarTypeNames = {
  string: "string",
  integer: "number",
  number: "number",
  boolean: "boolean",
  null: "null",
};

// typeExpression dịch MỘT schema con sang biểu thức kiểu. Mọi nhánh không hiểu
// được đều NÉM lỗi thay vì trả `unknown`: một `unknown` lặng lẽ ở đây sẽ tắt
// đúng phần kiểm kiểu mà tệp sinh sinh ra để có.
function typeExpression(schema, owner, emitted) {
  if (!schema || typeof schema !== "object") {
    throw new Error(`${owner}: schema rỗng, không sinh được type`);
  }
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/components/schemas/", "");
    if (!emitted.has(name)) {
      throw new Error(`${owner}: $ref tới ${name} chưa sinh — thêm nó vào generatedTypeSchemas TRƯỚC schema này`);
    }
    return name;
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((member, index) => typeExpression(member, `${owner}.oneOf[${index}]`, emitted)).join(" | ");
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return quotedUnion(schema.enum);
  const kinds = Array.isArray(schema.type) ? schema.type : [schema.type];
  return kinds
    .map((kind) => {
      if (kind === "array") return `${typeExpression(schema.items, `${owner}[]`, emitted)}[]`;
      const scalar = scalarTypeNames[kind];
      if (!scalar) throw new Error(`${owner}: kiểu ${JSON.stringify(kind)} chưa hỗ trợ`);
      return scalar;
    })
    .join(" | ");
}

// generateSchemaType sinh khai báo cấp cao nhất cho một schema.
//
// Trường KHÔNG nằm trong `required` sinh ra `?`. Với nhóm schema này gần như mọi
// trường đều `required` dù nullable — đó chính là điều contract muốn nói: trường
// LUÔN CÓ MẶT, `null` là "server đã xét và chưa biết", còn vắng mặt là "server
// đời cũ chưa có trường này". Hai thứ đó không được phép trông giống nhau ở
// phía dùng.
function generateSchemaType(name, schema, emitted) {
  if (schema.type === "string" && Array.isArray(schema.enum)) {
    return `export type ${name} = ${quotedUnion(schema.enum)};`;
  }
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties)
      .map(([field, sub]) => `  ${field}${required.has(field) ? "" : "?"}: ${typeExpression(sub, `${name}.${field}`, emitted)};`)
      .join("\n");
    return `export interface ${name} {\n${fields}\n}`;
  }
  throw new Error(`Không sinh được type cho schema ${name}: chỉ hỗ trợ enum chuỗi và object có properties`);
}

const emittedSchemaTypes = new Set();
const schemaTypeBlocks = [];
for (const name of generatedTypeSchemas) {
  const schema = schemas[name];
  if (!schema) {
    throw new Error(`OpenAPI thiếu schema ${name}; client Programming không sinh được type đọc`);
  }
  schemaTypeBlocks.push(generateSchemaType(name, schema, emittedSchemaTypes));
  emittedSchemaTypes.add(name);
}
const schemaTypes = schemaTypeBlocks.join("\n\n");
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
export type ProgrammingRole = "viewer" | "operator" | "engineer" | "admin";
export type ProgrammingHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ProgrammingImpactStatus = ${quotedUnion(impactStatuses)};
export type ProgrammingImpactKey = ${quotedUnion(impactKeys)};

// --- Bảng Programs của PGM-01 (T60-013/T60-014), sinh thẳng từ schema OpenAPI.
// Trường nullable là \`| null\` chứ KHÔNG phải optional: server luôn gửi khoá, và
// \`null\` nghĩa là "đã xét, chưa biết" — không được suy thành \`0\`/\`false\`.
${schemaTypes}

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
${impactKeys.map((key) => `  ${key}: ProgrammingImpactGroup;`).join('\n')}
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
  /** \`T61-402\` — trần chờ của MỘT request. Mặc định
   *  \`PROGRAMMING_REQUEST_TIMEOUT_MS\`; đặt \`0\` để tắt (chỉ dùng cho test). */
  timeoutMs?: number;
}

/**
 * \`T61-402\` — trần chờ mặc định của một request Programming.
 *
 * Trước lát này client KHÔNG có trần nào: một request treo sẽ treo mãi, nên
 * đường ghi không bao giờ tới được trạng thái "không rõ kết quả" mà nó phải xử
 * lý — nó chỉ đứng im ở "đang gửi" và người dùng bấm lại.
 */
export const PROGRAMMING_REQUEST_TIMEOUT_MS = 15000;

/**
 * \`T61-402\` — request KHÔNG nhận được dòng trạng thái nào.
 *
 * Đây là lớp lỗi DUY NHẤT mà kết quả trên máy chủ là KHÔNG BIẾT: request có thể
 * đã tới nơi và đã commit, chỉ có phản hồi là mất. Mọi lỗi khác đều mang một mã
 * HTTP, nghĩa là máy chủ đã trả lời và transaction đã ngã ngũ.
 *
 * \`reason\` giữ nguyên nguyên nhân gốc để màn hình nói đúng chuyện đã xảy ra
 * thay vì gộp cả ba thành "lỗi mạng".
 */
export class ProgrammingNoResponseError extends Error {
  constructor(
    readonly reason: "timeout" | "abort" | "network",
    readonly timeoutMs: number,
    options?: { cause?: unknown },
  ) {
    super(\`Không nhận được phản hồi từ máy chủ (\${reason})\`);
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
    /* Trần chờ nằm ở ĐÂY, không ở từng chỗ gọi: một chỗ gọi quên đặt trần là
       một request có thể treo vô hạn, và một request treo vô hạn không bao giờ
       tới được nhánh "không rõ kết quả". \`AbortController\` riêng để không nuốt
       mất \`signal\` của caller — huỷ từ caller vẫn phải huỷ được request. */
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
         trên máy chủ là không biết. Phân biệt chúng ở \`reason\` để màn hình nói
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
