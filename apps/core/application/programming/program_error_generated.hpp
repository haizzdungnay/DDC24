// GENERATED bởi scripts/generate_programming_errors.py; không sửa tay.
#ifndef CORE_PROGRAM_ERROR_GENERATED_HPP
#define CORE_PROGRAM_ERROR_GENERATED_HPP

#include <array>
#include <cstdint>
#include <string_view>

namespace core::programming {
inline constexpr std::string_view kProgramErrorCatalogSha256 = "d5757655b0d84ec1d836d7742ad7ee6c9e15d486873169ac2f8586e289d7a11b";
inline constexpr std::string_view kProgramErrorCatalogVersion = "1.7.1";

enum class ProgramPublicError : uint8_t {
    Request,
    NotFound,
    Conflict,
    Scope,
    MapIdentity,
    MapType,
    Check,
    Artifact,
    Target,
    Cutover,
    Retain,
    Operation,
    Commission,
    Restore,
    Import,
    AckMissing,
    AckUnexpected,
    ImpactUnavailable,
    ImpactStale,
    Unavailable,
    OutputOwner,
    PidReview,
    PouKind,
    PouRecursion,
    LibVersion,
    ProgramLimit,
    SignalPublisher,
    SignalFreshness,
    EnableNotCommissioned,
    ProgramState,
};

struct ProgramErrorMetadata {
    ProgramPublicError code;
    std::string_view public_code;
    std::string_view owner_component;
    std::string_view status_class;
    int default_http_status;
    bool retryable;
    bool keeps_running_revision;
    std::string_view message_key;
};

inline constexpr std::array<ProgramErrorMetadata, 30> kProgramErrorMetadata = {{
    {ProgramPublicError::Request, "PRG-ERR-REQ-001", "api", "REQUEST", 400, false, true, "programming.error.request" },
    {ProgramPublicError::NotFound, "PRG-ERR-NOT-FOUND-001", "api", "NOT_FOUND", 404, false, true, "programming.error.notFound" },
    {ProgramPublicError::Conflict, "PRG-ERR-CONFLICT-001", "api", "CONFLICT", 409, false, true, "programming.error.conflict" },
    {ProgramPublicError::Scope, "PRG-ERR-SCOPE-001", "compiler", "VALIDATION", 422, false, true, "programming.error.scope" },
    {ProgramPublicError::MapIdentity, "PRG-ERR-MAP-003", "compiler", "VALIDATION", 422, false, true, "programming.error.mappingIdentity" },
    {ProgramPublicError::MapType, "PRG-ERR-MAP-004", "compiler", "VALIDATION", 422, false, true, "programming.error.mappingType" },
    {ProgramPublicError::Check, "PRG-ERR-CHECK-001", "compiler", "VALIDATION", 422, false, true, "programming.error.check" },
    {ProgramPublicError::Artifact, "PRG-ERR-ARTIFACT-001", "artifact-loader", "VALIDATION", 422, false, true, "programming.error.artifact" },
    {ProgramPublicError::Target, "PRG-ERR-TARGET-001", "artifact-loader", "VALIDATION", 422, false, true, "programming.error.target" },
    {ProgramPublicError::Cutover, "PRG-ERR-CUTOVER-001", "runtime", "CONFLICT", 409, false, true, "programming.error.cutover" },
    {ProgramPublicError::Retain, "PRG-ERR-RETAIN-001", "runtime", "VALIDATION", 422, false, true, "programming.error.retain" },
    {ProgramPublicError::Operation, "PRG-ERR-OP-001", "api", "CONFLICT", 409, false, true, "programming.error.operation" },
    {ProgramPublicError::Commission, "PRG-ERR-COM-001", "runtime", "OPERATION", 409, false, true, "programming.error.commission" },
    {ProgramPublicError::Restore, "PRG-ERR-RESTORE-001", "runtime", "OPERATION", 409, false, true, "programming.error.restore" },
    {ProgramPublicError::Import, "PRG-ERR-IMPORT-001", "api", "VALIDATION", 400, false, true, "programming.error.import" },
    {ProgramPublicError::AckMissing, "PRG-ERR-ACK-MISSING-001", "api", "VALIDATION", 422, false, true, "programming.error.acknowledgementMissing" },
    {ProgramPublicError::AckUnexpected, "PRG-ERR-ACK-UNEXPECTED-001", "api", "VALIDATION", 422, false, true, "programming.error.acknowledgementUnexpected" },
    {ProgramPublicError::ImpactUnavailable, "PRG-ERR-IMPACT-UNAVAILABLE-001", "api", "VALIDATION", 422, false, true, "programming.error.impactUnavailable" },
    {ProgramPublicError::ImpactStale, "PRG-ERR-IMPACT-STALE-001", "api", "CONFLICT", 409, false, true, "programming.error.impactStale" },
    {ProgramPublicError::Unavailable, "PRG-ERR-UNAVAILABLE-001", "runtime", "UNAVAILABLE", 503, true, false, "programming.error.unavailable" },
    {ProgramPublicError::OutputOwner, "PRG-ERR-OUTPUT-OWNER-001", "compiler", "VALIDATION", 422, false, true, "programming.error.outputOwner" },
    {ProgramPublicError::PidReview, "PRG-ERR-PID-REVIEW-001", "compiler", "VALIDATION", 422, false, true, "programming.error.pidReview" },
    {ProgramPublicError::PouKind, "PRG-ERR-POU-KIND-001", "compiler", "VALIDATION", 422, false, true, "programming.error.pouKind" },
    {ProgramPublicError::PouRecursion, "PRG-ERR-POU-RECURSION-001", "compiler", "VALIDATION", 422, false, true, "programming.error.pouRecursion" },
    {ProgramPublicError::LibVersion, "PRG-ERR-LIB-VERSION-001", "compiler", "VALIDATION", 422, false, true, "programming.error.libVersion" },
    {ProgramPublicError::ProgramLimit, "PRG-ERR-PROGRAM-LIMIT-001", "compiler", "VALIDATION", 422, false, true, "programming.error.programLimit" },
    {ProgramPublicError::SignalPublisher, "PRG-ERR-SIGNAL-PUBLISHER-001", "compiler", "VALIDATION", 422, false, true, "programming.error.signalPublisher" },
    {ProgramPublicError::SignalFreshness, "PRG-ERR-SIGNAL-FRESHNESS-001", "compiler", "VALIDATION", 422, false, true, "programming.error.signalFreshness" },
    {ProgramPublicError::EnableNotCommissioned, "PRG-ERR-ENABLE-NOT-COMMISSIONED-001", "runtime", "CONFLICT", 409, false, true, "programming.error.enableNotCommissioned" },
    {ProgramPublicError::ProgramState, "PRG-ERR-PROGRAM-STATE-001", "runtime", "CONFLICT", 409, false, true, "programming.error.programState" },
}};

struct ComponentErrorMapping {
    std::string_view component;
    std::string_view detail_code;
    ProgramPublicError public_code;
};

inline constexpr std::array<ComponentErrorMapping, 134> kComponentErrorMappings = {{
    {"artifact-loader", "IR-E-001", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-002", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-003", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-004", ProgramPublicError::Target },
    {"artifact-loader", "IR-E-005", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-006", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-007", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-008", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-009", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-010", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-011", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-012", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-013", ProgramPublicError::Target },
    {"artifact-loader", "IR-E-014", ProgramPublicError::Artifact },
    {"artifact-loader", "IR-E-015", ProgramPublicError::Artifact },
    {"compiler", "ST-CLI-ARGS", ProgramPublicError::Request },
    {"compiler", "ST-CLI-IO", ProgramPublicError::Unavailable },
    {"compiler", "ST-CLI-KEY", ProgramPublicError::Unavailable },
    {"compiler", "ST-CLI-KEY-EXISTS", ProgramPublicError::Conflict },
    {"compiler", "ST-CLI-KEY-REQUIRED", ProgramPublicError::Unavailable },
    {"compiler", "ST-CLI-LIBRARY-LOCK", ProgramPublicError::LibVersion },
    {"compiler", "ST-CLI-LIMIT", ProgramPublicError::Scope },
    {"compiler", "ST-CLI-POU-MANIFEST", ProgramPublicError::PouKind },
    {"compiler", "ST-CLI-POU-PATH", ProgramPublicError::Request },
    {"compiler", "ST-CLI-SANDBOX", ProgramPublicError::Unavailable },
    {"compiler", "ST-CLI-SIGNAL-MANIFEST", ProgramPublicError::Check },
    {"compiler", "ST-CLI-TOOLARGE", ProgramPublicError::Scope },
    {"compiler", "ST-IOMAP-001", ProgramPublicError::MapIdentity },
    {"compiler", "ST-IOMAP-002", ProgramPublicError::MapIdentity },
    {"compiler", "ST-IOMAP-003", ProgramPublicError::MapType },
    {"compiler", "ST-IOMAP-004", ProgramPublicError::MapIdentity },
    {"compiler", "ST-IOMAP-005", ProgramPublicError::MapIdentity },
    {"compiler", "ST-IOMAP-006", ProgramPublicError::MapIdentity },
    {"compiler", "ST-IOMAP-007", ProgramPublicError::MapIdentity },
    {"compiler", "ST-IOMAP-008", ProgramPublicError::MapIdentity },
    {"compiler", "ST-LEX-001", ProgramPublicError::Check },
    {"compiler", "ST-LEX-002", ProgramPublicError::Check },
    {"compiler", "ST-LEX-003", ProgramPublicError::Check },
    {"compiler", "ST-LIB-001", ProgramPublicError::LibVersion },
    {"compiler", "ST-LIB-002", ProgramPublicError::LibVersion },
    {"compiler", "ST-LIB-003", ProgramPublicError::PouRecursion },
    {"compiler", "ST-LIM-001", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-002", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-003", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-004", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-005", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-006", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-007", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-008", ProgramPublicError::Scope },
    {"compiler", "ST-LIM-009", ProgramPublicError::ProgramLimit },
    {"compiler", "ST-OWN-001", ProgramPublicError::OutputOwner },
    {"compiler", "ST-PID-001", ProgramPublicError::PidReview },
    {"compiler", "ST-POU-001", ProgramPublicError::PouKind },
    {"compiler", "ST-POU-002", ProgramPublicError::PouKind },
    {"compiler", "ST-POU-003", ProgramPublicError::PouRecursion },
    {"compiler", "ST-POU-004", ProgramPublicError::ProgramLimit },
    {"compiler", "ST-SEM-001", ProgramPublicError::Check },
    {"compiler", "ST-SEM-002", ProgramPublicError::Check },
    {"compiler", "ST-SEM-003", ProgramPublicError::Check },
    {"compiler", "ST-SEM-004", ProgramPublicError::Check },
    {"compiler", "ST-SEM-005", ProgramPublicError::Scope },
    {"compiler", "ST-SEM-006", ProgramPublicError::Scope },
    {"compiler", "ST-SEM-007", ProgramPublicError::Check },
    {"compiler", "ST-SEM-008", ProgramPublicError::Check },
    {"compiler", "ST-SEM-009", ProgramPublicError::Check },
    {"compiler", "ST-SEM-010", ProgramPublicError::Check },
    {"compiler", "ST-SEM-011", ProgramPublicError::Check },
    {"compiler", "ST-SEM-012", ProgramPublicError::Check },
    {"compiler", "ST-SEM-013", ProgramPublicError::Check },
    {"compiler", "ST-SEM-014", ProgramPublicError::Check },
    {"compiler", "ST-SIG-001", ProgramPublicError::SignalPublisher },
    {"compiler", "ST-SIG-002", ProgramPublicError::MapType },
    {"compiler", "ST-SIG-003", ProgramPublicError::SignalFreshness },
    {"compiler", "ST-SIG-004", ProgramPublicError::SignalPublisher },
    {"compiler", "ST-SIG-005", ProgramPublicError::Check },
    {"compiler", "ST-SYN-001", ProgramPublicError::Check },
    {"compiler", "ST-SYN-002", ProgramPublicError::Scope },
    {"compiler", "ST-WORKER-CRASH", ProgramPublicError::Unavailable },
    {"compiler", "ST-WORKER-TIMEOUT", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-ACTION-NOT-IMPLEMENTED", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-ACTIVATE-ARM", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-CONTRACT-ONLY", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-DEADLINE", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-EXPECTED-ACTIVE", ProgramPublicError::Conflict },
    {"core-ipc", "IPC-IMPACT-NOT-READY", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-JOURNAL-FSYNC", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-OPERATION-BUSY", ProgramPublicError::Operation },
    {"core-ipc", "IPC-OPERATION-NOT-FOUND", ProgramPublicError::Operation },
    {"core-ipc", "IPC-PAYLOAD", ProgramPublicError::Request },
    {"core-ipc", "IPC-QUEUE-FULL", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-RECOVERY-REQUIRED", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-REQUEST-ID-CONFLICT", ProgramPublicError::Operation },
    {"core-ipc", "IPC-RETAIN-RESET-ARM", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-RETAIN-RESET-INSTANCE", ProgramPublicError::Request },
    {"core-ipc", "IPC-RETAIN-RESET-STATE", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-RETAIN-RESET-TIMEOUT", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-RUNTIME-CONFIG", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-RUNTIME-NOT-CONFIGURED", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-RUNTIME-STATE", ProgramPublicError::Conflict },
    {"core-ipc", "IPC-STAGE-REJECTED", ProgramPublicError::Artifact },
    {"core-ipc", "IPC-STAGED-TOKEN", ProgramPublicError::Operation },
    {"core-ipc", "IPC-STAGING-HASH", ProgramPublicError::Artifact },
    {"core-ipc", "IPC-STAGING-LOCATOR", ProgramPublicError::Artifact },
    {"core-ipc", "IPC-STAGING-OPEN", ProgramPublicError::Artifact },
    {"core-ipc", "IPC-STAGING-TYPE-SIZE", ProgramPublicError::Artifact },
    {"core-ipc", "IPC-TRACE-REJECTED", ProgramPublicError::Request },
    {"core-ipc", "IPC-TRACE-UNAVAILABLE", ProgramPublicError::Unavailable },
    {"core-ipc", "IPC-UNKNOWN-INSTANCE", ProgramPublicError::NotFound },
    {"retain", "RT-RETAIN-001", ProgramPublicError::Retain },
    {"retain", "RT-RETAIN-002", ProgramPublicError::Retain },
    {"retain", "RT-RETAIN-003", ProgramPublicError::Retain },
    {"retain", "RT-RETAIN-004", ProgramPublicError::Retain },
    {"runtime", "ST-RT-001", ProgramPublicError::Commission },
    {"runtime", "ST-RT-002", ProgramPublicError::Commission },
    {"runtime", "ST-RT-003", ProgramPublicError::Commission },
    {"runtime", "ST-RT-004", ProgramPublicError::Commission },
    {"runtime", "ST-RT-005", ProgramPublicError::Commission },
    {"runtime", "ST-RT-006", ProgramPublicError::Commission },
    {"runtime", "ST-RT-007", ProgramPublicError::Commission },
    {"runtime", "ST-RT-008", ProgramPublicError::Commission },
    {"runtime", "ST-RT-009", ProgramPublicError::Commission },
    {"runtime", "ST-RT-010", ProgramPublicError::Commission },
    {"runtime", "ST-RT-011", ProgramPublicError::Unavailable },
    {"runtime", "ST-RT-012", ProgramPublicError::Commission },
    {"runtime", "ST-RT-013", ProgramPublicError::Commission },
    {"st-control-api", "API-E-001", ProgramPublicError::Request },
    {"st-control-api", "API-E-002", ProgramPublicError::Request },
    {"st-control-api", "API-E-003", ProgramPublicError::Target },
    {"st-control-api", "API-E-004", ProgramPublicError::Operation },
    {"st-control-api", "API-E-005", ProgramPublicError::Artifact },
    {"st-control-api", "API-E-006", ProgramPublicError::Artifact },
    {"st-control-api", "API-E-007", ProgramPublicError::Unavailable },
    {"st-control-api", "API-E-008", ProgramPublicError::EnableNotCommissioned },
    {"st-control-api", "API-E-009", ProgramPublicError::ProgramState },
}};

constexpr ProgramPublicError MapComponentError(std::string_view component,
                                                std::string_view detail_code)
{
    for (const auto& mapping : kComponentErrorMappings) {
        if (mapping.component == component && mapping.detail_code == detail_code)
            return mapping.public_code;
    }
    return ProgramPublicError::Unavailable;
}

constexpr const ProgramErrorMetadata& ProgramErrorMetadataFor(ProgramPublicError code)
{
    for (const auto& metadata : kProgramErrorMetadata) {
        if (metadata.code == code) return metadata;
    }
    return kProgramErrorMetadata[19];
}

constexpr bool IsRetryable(ProgramPublicError code)
{
    return ProgramErrorMetadataFor(code).retryable;
}

constexpr std::string_view MessageKeyFor(ProgramPublicError code)
{
    return ProgramErrorMetadataFor(code).message_key;
}
} // namespace core::programming

#endif // CORE_PROGRAM_ERROR_GENERATED_HPP
