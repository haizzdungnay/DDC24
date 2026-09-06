// Tệp sinh tự động bởi scripts/generate_programming_errors.py. Không sửa bằng tay.
export const PROGRAMMING_ERROR_CATALOG_SHA256 = "555c28877e22f82997d044db6670222f1e03058dd3a92a4b11d8f3f8b2896bdd" as const;
export const PROGRAMMING_ERROR_CATALOG_VERSION = "1.11.0" as const;

export const PROGRAMMING_ERROR_CATALOG = {
  "PRG-ERR-REQ-001": { ownerComponent: "api", statusClass: "REQUEST", httpStatuses: [400, 413, 422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.request", allowedArgs: ["actual", "supportedMajor", "maxBytes", "detailCode"] },
  "PRG-ERR-NOT-FOUND-001": { ownerComponent: "api", statusClass: "NOT_FOUND", httpStatuses: [404], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.notFound", allowedArgs: [] },
  "PRG-ERR-CONFLICT-001": { ownerComponent: "api", statusClass: "CONFLICT", httpStatuses: [409, 428], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.conflict", allowedArgs: ["expected", "actual"] },
  "PRG-ERR-SCOPE-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.scope", allowedArgs: ["profile", "limit"] },
  "PRG-ERR-MAP-003": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.mappingIdentity", allowedArgs: ["pointId", "variable", "expected", "actual", "detailCode"] },
  "PRG-ERR-MAP-004": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.mappingType", allowedArgs: ["pointId", "variable", "expected", "actual", "detailCode"] },
  "PRG-ERR-CHECK-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.check", allowedArgs: ["line", "column", "length", "diagnosticCount"] },
  "PRG-ERR-ARTIFACT-001": { ownerComponent: "artifact-loader", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.artifact", allowedArgs: ["artifactId", "section"] },
  "PRG-ERR-TARGET-001": { ownerComponent: "artifact-loader", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.target", allowedArgs: ["expected", "actual"] },
  "PRG-ERR-CUTOVER-001": { ownerComponent: "runtime", statusClass: "CONFLICT", httpStatuses: [409], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.cutover", allowedArgs: ["requested", "activeMode"] },
  "PRG-ERR-RETAIN-001": { ownerComponent: "runtime", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.retain", allowedArgs: ["layoutVersion"] },
  "PRG-ERR-OP-001": { ownerComponent: "api", statusClass: "CONFLICT", httpStatuses: [409], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.operation", allowedArgs: ["operationId", "state"] },
  "PRG-ERR-COM-001": { ownerComponent: "runtime", statusClass: "OPERATION", httpStatuses: [409, 422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.commission", allowedArgs: ["operationId", "step"] },
  "PRG-ERR-RESTORE-001": { ownerComponent: "runtime", statusClass: "OPERATION", httpStatuses: [409, 422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.restore", allowedArgs: ["operationId", "step"] },
  "PRG-ERR-IMPORT-001": { ownerComponent: "api", statusClass: "VALIDATION", httpStatuses: [400, 413, 422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.import", allowedArgs: ["bundleId"] },
  "PRG-ERR-ACK-MISSING-001": { ownerComponent: "api", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.acknowledgementMissing", allowedArgs: ["key", "keys"] },
  "PRG-ERR-ACK-UNEXPECTED-001": { ownerComponent: "api", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.acknowledgementUnexpected", allowedArgs: ["key", "keys"] },
  "PRG-ERR-IMPACT-UNAVAILABLE-001": { ownerComponent: "api", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.impactUnavailable", allowedArgs: ["key"] },
  "PRG-ERR-IMPACT-STALE-001": { ownerComponent: "api", statusClass: "CONFLICT", httpStatuses: [409], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.impactStale", allowedArgs: ["expected", "actual"] },
  "PRG-ERR-UNAVAILABLE-001": { ownerComponent: "runtime", statusClass: "UNAVAILABLE", httpStatuses: [503, 504, 429], retryable: true, keepsRunningRevision: false, messageKey: "programming.error.unavailable", allowedArgs: ["retryAfterSeconds"] },
  "PRG-ERR-OUTPUT-OWNER-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.outputOwner", allowedArgs: ["pointId", "ownerProgramId", "conflictProgramId", "detailCode"] },
  "PRG-ERR-PID-REVIEW-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.pidReview", allowedArgs: ["entryId", "featureState"] },
  "PRG-ERR-POU-KIND-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.pouKind", allowedArgs: ["objectId", "kind", "expected", "actual"] },
  "PRG-ERR-POU-RECURSION-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.pouRecursion", allowedArgs: ["objectId", "cycleLength"] },
  "PRG-ERR-LIB-VERSION-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.libVersion", allowedArgs: ["entryId", "expected", "actual"] },
  "PRG-ERR-PROGRAM-LIMIT-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.programLimit", allowedArgs: ["profile", "limit", "actual"] },
  "PRG-ERR-SIGNAL-PUBLISHER-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.signalPublisher", allowedArgs: ["signalId", "ownerProgramId", "conflictProgramId"] },
  "PRG-ERR-SIGNAL-FRESHNESS-001": { ownerComponent: "compiler", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.signalFreshness", allowedArgs: ["signalId", "expected", "actual", "limit"] },
  "PRG-ERR-ENABLE-NOT-COMMISSIONED-001": { ownerComponent: "runtime", statusClass: "CONFLICT", httpStatuses: [409], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.enableNotCommissioned", allowedArgs: ["programId"] },
  "PRG-ERR-PROGRAM-STATE-001": { ownerComponent: "runtime", statusClass: "CONFLICT", httpStatuses: [409], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.programState", allowedArgs: ["programId", "state", "limit"] },
  "PRG-SIM-UNSUPPORTED": { ownerComponent: "simulation", statusClass: "UNAVAILABLE", httpStatuses: [409, 503], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.simUnsupported", allowedArgs: ["contractVersion", "workerVersion"] },
  "PRG-SIM-SAVE-REQUIRED": { ownerComponent: "simulation", statusClass: "CONFLICT", httpStatuses: [409], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.simSaveRequired", allowedArgs: ["expected", "actual"] },
  "PRG-SIM-FORBIDDEN": { ownerComponent: "simulation", statusClass: "FORBIDDEN", httpStatuses: [403], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.simForbidden", allowedArgs: ["requiredRole"] },
  "PRG-SIM-INPUT-NOT-ALLOWED": { ownerComponent: "simulation", statusClass: "VALIDATION", httpStatuses: [422], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.simInputNotAllowed", allowedArgs: ["observationId", "sourceKind", "expected", "actual", "minimum", "maximum"] },
  "PRG-SIM-STALE-SESSION": { ownerComponent: "simulation", statusClass: "CONFLICT", httpStatuses: [409, 412], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.simStaleSession", allowedArgs: ["expected", "actual"] },
  "PRG-SIM-QUOTA": { ownerComponent: "simulation", statusClass: "UNAVAILABLE", httpStatuses: [429], retryable: true, keepsRunningRevision: true, messageKey: "programming.error.simQuota", allowedArgs: ["limit", "retryAfterSeconds"] },
  "PRG-SIM-WORKER-FAILED": { ownerComponent: "simulation", statusClass: "OPERATION", httpStatuses: [503], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.simWorkerFailed", allowedArgs: ["phase", "timeoutMs"] },
  "PRG-SIM-EXPIRED": { ownerComponent: "simulation", statusClass: "CONFLICT", httpStatuses: [410], retryable: false, keepsRunningRevision: true, messageKey: "programming.error.simExpired", allowedArgs: ["limit"] },
} as const;

export type ProgrammingErrorCode = keyof typeof PROGRAMMING_ERROR_CATALOG;

const COMPONENT_ERROR_MAP: Readonly<Record<string, ProgrammingErrorCode>> = {
  "artifact-loader\u0000IR-E-001": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-002": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-003": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-004": "PRG-ERR-TARGET-001",
  "artifact-loader\u0000IR-E-005": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-006": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-007": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-008": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-009": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-010": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-011": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-012": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-013": "PRG-ERR-TARGET-001",
  "artifact-loader\u0000IR-E-014": "PRG-ERR-ARTIFACT-001",
  "artifact-loader\u0000IR-E-015": "PRG-ERR-ARTIFACT-001",
  "compiler\u0000ST-CLI-ARGS": "PRG-ERR-REQ-001",
  "compiler\u0000ST-CLI-IO": "PRG-ERR-UNAVAILABLE-001",
  "compiler\u0000ST-CLI-KEY": "PRG-ERR-UNAVAILABLE-001",
  "compiler\u0000ST-CLI-KEY-EXISTS": "PRG-ERR-CONFLICT-001",
  "compiler\u0000ST-CLI-KEY-REQUIRED": "PRG-ERR-UNAVAILABLE-001",
  "compiler\u0000ST-CLI-LIBRARY-LOCK": "PRG-ERR-LIB-VERSION-001",
  "compiler\u0000ST-CLI-LIMIT": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-CLI-POU-MANIFEST": "PRG-ERR-POU-KIND-001",
  "compiler\u0000ST-CLI-POU-PATH": "PRG-ERR-REQ-001",
  "compiler\u0000ST-CLI-SANDBOX": "PRG-ERR-UNAVAILABLE-001",
  "compiler\u0000ST-CLI-SIGNAL-MANIFEST": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-CLI-TOOLARGE": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-IOMAP-001": "PRG-ERR-MAP-003",
  "compiler\u0000ST-IOMAP-002": "PRG-ERR-MAP-003",
  "compiler\u0000ST-IOMAP-003": "PRG-ERR-MAP-004",
  "compiler\u0000ST-IOMAP-004": "PRG-ERR-MAP-003",
  "compiler\u0000ST-IOMAP-005": "PRG-ERR-MAP-003",
  "compiler\u0000ST-IOMAP-006": "PRG-ERR-MAP-003",
  "compiler\u0000ST-IOMAP-007": "PRG-ERR-MAP-003",
  "compiler\u0000ST-IOMAP-008": "PRG-ERR-MAP-003",
  "compiler\u0000ST-LEX-001": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-LEX-002": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-LEX-003": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-LIB-001": "PRG-ERR-LIB-VERSION-001",
  "compiler\u0000ST-LIB-002": "PRG-ERR-LIB-VERSION-001",
  "compiler\u0000ST-LIB-003": "PRG-ERR-POU-RECURSION-001",
  "compiler\u0000ST-LIM-001": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-002": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-003": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-004": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-005": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-006": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-007": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-008": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-LIM-009": "PRG-ERR-PROGRAM-LIMIT-001",
  "compiler\u0000ST-OWN-001": "PRG-ERR-OUTPUT-OWNER-001",
  "compiler\u0000ST-PID-001": "PRG-ERR-PID-REVIEW-001",
  "compiler\u0000ST-POU-001": "PRG-ERR-POU-KIND-001",
  "compiler\u0000ST-POU-002": "PRG-ERR-POU-KIND-001",
  "compiler\u0000ST-POU-003": "PRG-ERR-POU-RECURSION-001",
  "compiler\u0000ST-POU-004": "PRG-ERR-PROGRAM-LIMIT-001",
  "compiler\u0000ST-POU-005": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-001": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-002": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-003": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-004": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-005": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-SEM-006": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-SEM-007": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-008": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-009": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-010": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-011": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-012": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-013": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SEM-014": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SIG-001": "PRG-ERR-SIGNAL-PUBLISHER-001",
  "compiler\u0000ST-SIG-002": "PRG-ERR-MAP-004",
  "compiler\u0000ST-SIG-003": "PRG-ERR-SIGNAL-FRESHNESS-001",
  "compiler\u0000ST-SIG-004": "PRG-ERR-SIGNAL-PUBLISHER-001",
  "compiler\u0000ST-SIG-005": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SYN-001": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-SYN-002": "PRG-ERR-SCOPE-001",
  "compiler\u0000ST-WARN-001": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-WARN-002": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-WARN-003": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-WARN-004": "PRG-ERR-CHECK-001",
  "compiler\u0000ST-WORKER-CRASH": "PRG-ERR-UNAVAILABLE-001",
  "compiler\u0000ST-WORKER-TIMEOUT": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-ACTION-NOT-IMPLEMENTED": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-ACTIVATE-ARM": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-CONTRACT-ONLY": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-DEADLINE": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-EXPECTED-ACTIVE": "PRG-ERR-CONFLICT-001",
  "core-ipc\u0000IPC-IMPACT-NOT-READY": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-JOURNAL-FSYNC": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-OPERATION-BUSY": "PRG-ERR-OP-001",
  "core-ipc\u0000IPC-OPERATION-NOT-FOUND": "PRG-ERR-OP-001",
  "core-ipc\u0000IPC-PAYLOAD": "PRG-ERR-REQ-001",
  "core-ipc\u0000IPC-QUEUE-FULL": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-RECOVERY-REQUIRED": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-REQUEST-ID-CONFLICT": "PRG-ERR-OP-001",
  "core-ipc\u0000IPC-RETAIN-RESET-ARM": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-RETAIN-RESET-INSTANCE": "PRG-ERR-REQ-001",
  "core-ipc\u0000IPC-RETAIN-RESET-STATE": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-RETAIN-RESET-TIMEOUT": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-RUNTIME-CONFIG": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-RUNTIME-NOT-CONFIGURED": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-RUNTIME-STATE": "PRG-ERR-CONFLICT-001",
  "core-ipc\u0000IPC-STAGE-REJECTED": "PRG-ERR-ARTIFACT-001",
  "core-ipc\u0000IPC-STAGED-TOKEN": "PRG-ERR-OP-001",
  "core-ipc\u0000IPC-STAGING-HASH": "PRG-ERR-ARTIFACT-001",
  "core-ipc\u0000IPC-STAGING-LOCATOR": "PRG-ERR-ARTIFACT-001",
  "core-ipc\u0000IPC-STAGING-OPEN": "PRG-ERR-ARTIFACT-001",
  "core-ipc\u0000IPC-STAGING-TYPE-SIZE": "PRG-ERR-ARTIFACT-001",
  "core-ipc\u0000IPC-TRACE-REJECTED": "PRG-ERR-REQ-001",
  "core-ipc\u0000IPC-TRACE-UNAVAILABLE": "PRG-ERR-UNAVAILABLE-001",
  "core-ipc\u0000IPC-UNKNOWN-INSTANCE": "PRG-ERR-NOT-FOUND-001",
  "point-catalog\u0000PIO-SLOT-001": "PRG-ERR-MAP-003",
  "point-catalog\u0000PIO-SLOT-002": "PRG-ERR-MAP-003",
  "point-catalog\u0000PIO-SLOT-003": "PRG-ERR-MAP-003",
  "retain\u0000RT-RETAIN-001": "PRG-ERR-RETAIN-001",
  "retain\u0000RT-RETAIN-002": "PRG-ERR-RETAIN-001",
  "retain\u0000RT-RETAIN-003": "PRG-ERR-RETAIN-001",
  "retain\u0000RT-RETAIN-004": "PRG-ERR-RETAIN-001",
  "runtime\u0000ST-RT-001": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-002": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-003": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-004": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-005": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-006": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-007": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-008": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-009": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-010": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-011": "PRG-ERR-UNAVAILABLE-001",
  "runtime\u0000ST-RT-012": "PRG-ERR-COM-001",
  "runtime\u0000ST-RT-013": "PRG-ERR-COM-001",
  "sim-supervisor\u0000SIM-SUP-CAPABILITY": "PRG-SIM-UNSUPPORTED",
  "sim-supervisor\u0000SIM-SUP-CRASH": "PRG-SIM-WORKER-FAILED",
  "sim-supervisor\u0000SIM-SUP-EXPIRED": "PRG-SIM-EXPIRED",
  "sim-supervisor\u0000SIM-SUP-HANDSHAKE": "PRG-SIM-UNSUPPORTED",
  "sim-supervisor\u0000SIM-SUP-PROTOCOL": "PRG-SIM-WORKER-FAILED",
  "sim-supervisor\u0000SIM-SUP-QUOTA": "PRG-SIM-QUOTA",
  "sim-supervisor\u0000SIM-SUP-SPAWN": "PRG-SIM-WORKER-FAILED",
  "sim-supervisor\u0000SIM-SUP-TIMEOUT": "PRG-SIM-WORKER-FAILED",
  "sim-worker\u0000SIM-E-001": "PRG-SIM-WORKER-FAILED",
  "sim-worker\u0000SIM-E-002": "PRG-SIM-WORKER-FAILED",
  "sim-worker\u0000SIM-E-003": "PRG-SIM-WORKER-FAILED",
  "sim-worker\u0000SIM-E-004": "PRG-SIM-WORKER-FAILED",
  "sim-worker\u0000SIM-E-005": "PRG-SIM-INPUT-NOT-ALLOWED",
  "sim-worker\u0000SIM-E-006": "PRG-SIM-INPUT-NOT-ALLOWED",
  "sim-worker\u0000SIM-E-007": "PRG-SIM-STALE-SESSION",
  "sim-worker\u0000SIM-E-008": "PRG-SIM-QUOTA",
  "st-control-api\u0000API-E-001": "PRG-ERR-REQ-001",
  "st-control-api\u0000API-E-002": "PRG-ERR-REQ-001",
  "st-control-api\u0000API-E-003": "PRG-ERR-TARGET-001",
  "st-control-api\u0000API-E-004": "PRG-ERR-OP-001",
  "st-control-api\u0000API-E-005": "PRG-ERR-ARTIFACT-001",
  "st-control-api\u0000API-E-006": "PRG-ERR-ARTIFACT-001",
  "st-control-api\u0000API-E-007": "PRG-ERR-UNAVAILABLE-001",
  "st-control-api\u0000API-E-008": "PRG-ERR-ENABLE-NOT-COMMISSIONED-001",
  "st-control-api\u0000API-E-009": "PRG-ERR-PROGRAM-STATE-001",
};

export function mapComponentError(component: string, detailCode: string): ProgrammingErrorCode {
  return COMPONENT_ERROR_MAP[`${component}\u0000${detailCode}`] ?? "PRG-ERR-UNAVAILABLE-001";
}

export function isRetryable(code: ProgrammingErrorCode): boolean {
  return PROGRAMMING_ERROR_CATALOG[code].retryable;
}

export function messageKeyFor(code: ProgrammingErrorCode): string {
  return PROGRAMMING_ERROR_CATALOG[code].messageKey;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function sanitizeValue(value: unknown): unknown | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.length <= 128 && !hasControlCharacter(value) ? value : undefined;
  if (Array.isArray(value) && value.length <= 16 && value.every(
    (item) => typeof item === "string" && item.length <= 128 && !hasControlCharacter(item),
  )) return value;
  return undefined;
}

export function sanitizeProgrammingErrorArgs(
  code: ProgrammingErrorCode,
  args: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!args) return undefined;
  const allowed = new Set<string>(PROGRAMMING_ERROR_CATALOG[code].allowedArgs);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!allowed.has(key)) continue;
    const safe = sanitizeValue(value);
    if (safe !== undefined) sanitized[key] = safe;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
