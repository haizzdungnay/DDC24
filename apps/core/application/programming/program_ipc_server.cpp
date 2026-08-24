#include "programming/program_ipc_server.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <utility>

#include <nlohmann/json.hpp>
#include <sodium.h>

#include <sys/socket.h>

namespace core::programming {
namespace {

using json = nlohmann::json;

void set_error(ProgramCodecError* error, ProgramCodecError value)
{
    if (error != nullptr) *error = value;
}

std::string action_name(ProgramAction action)
{
    switch (action) {
    case ProgramAction::Capabilities: return "CAPABILITIES";
    case ProgramAction::Status: return "STATUS";
    case ProgramAction::Stage: return "STAGE";
    case ProgramAction::Activate: return "ACTIVATE";
    case ProgramAction::OperationStatus: return "OPERATION_STATUS";
    case ProgramAction::Restore: return "RESTORE";
    case ProgramAction::TraceStart: return "TRACE_START";
    case ProgramAction::RetainReset: return "RETAIN_RESET";
    case ProgramAction::RecoveryReset: return "RECOVERY_RESET";
    case ProgramAction::SetProgramEnabled: return "SET_PROGRAM_ENABLED";
    case ProgramAction::TraceStop: return "TRACE_STOP";
    case ProgramAction::TraceRead: return "TRACE_READ";
    }
    return {};
}

bool parse_action(const std::string& value, ProgramAction* action)
{
    if (value == "CAPABILITIES") *action = ProgramAction::Capabilities;
    else if (value == "STATUS") *action = ProgramAction::Status;
    else if (value == "STAGE") *action = ProgramAction::Stage;
    else if (value == "ACTIVATE") *action = ProgramAction::Activate;
    else if (value == "OPERATION_STATUS") *action = ProgramAction::OperationStatus;
    else if (value == "RESTORE") *action = ProgramAction::Restore;
    else if (value == "TRACE_START") *action = ProgramAction::TraceStart;
    else if (value == "RETAIN_RESET") *action = ProgramAction::RetainReset;
    else if (value == "RECOVERY_RESET") *action = ProgramAction::RecoveryReset;
    else if (value == "SET_PROGRAM_ENABLED") *action = ProgramAction::SetProgramEnabled;
    else if (value == "TRACE_STOP") *action = ProgramAction::TraceStop;
    else if (value == "TRACE_READ") *action = ProgramAction::TraceRead;
    else return false;
    return true;
}

std::string result_name(ProgramResult result)
{
    switch (result) {
    case ProgramResult::Ok: return "OK";
    case ProgramResult::Staged: return "STAGED";
    case ProgramResult::Accepted: return "ACCEPTED";
    case ProgramResult::Rejected: return "REJECTED";
    case ProgramResult::Unavailable: return "UNAVAILABLE";
    case ProgramResult::Busy: return "BUSY";
    }
    return {};
}

bool parse_result(const std::string& value, ProgramResult* result)
{
    if (value == "OK") *result = ProgramResult::Ok;
    else if (value == "STAGED") *result = ProgramResult::Staged;
    else if (value == "ACCEPTED") *result = ProgramResult::Accepted;
    else if (value == "REJECTED") *result = ProgramResult::Rejected;
    else if (value == "UNAVAILABLE") *result = ProgramResult::Unavailable;
    else if (value == "BUSY") *result = ProgramResult::Busy;
    else return false;
    return true;
}

bool binary_value(const json& value, std::vector<uint8_t>* output, std::size_t expected,
                  bool nullable = false)
{
    if (nullable && value.is_null()) {
        output->clear();
        return true;
    }
    if (!value.is_binary()) return false;
    const auto& binary = value.get_binary();
    if (binary.size() != expected) return false;
    output->assign(binary.begin(), binary.end());
    return true;
}

json binary_json(const std::vector<uint8_t>& value)
{
    return json::binary(value);
}

json nullable_binary_json(const std::vector<uint8_t>& value)
{
    return value.empty() ? json(nullptr) : binary_json(value);
}

bool valid_text(const std::string& value, std::size_t minimum, std::size_t maximum)
{
    return value.size() >= minimum && value.size() <= maximum;
}

bool valid_correlation(const std::string& value)
{
    if (!valid_text(value, 16, 64)) return false;
    for (const char ch : value) {
        const bool valid = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                           (ch >= '0' && ch <= '9') || ch == '.' || ch == '_' || ch == '-';
        if (!valid) return false;
    }
    return true;
}

bool mutation_action(ProgramAction action)
{
    return action == ProgramAction::Stage || action == ProgramAction::Activate ||
           action == ProgramAction::Restore || action == ProgramAction::TraceStart ||
           action == ProgramAction::RetainReset ||
           action == ProgramAction::RecoveryReset ||
           action == ProgramAction::SetProgramEnabled ||
           action == ProgramAction::TraceStop;
}

uint16_t float_to_half_rounded(float value)
{
    uint32_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    const uint16_t sign = static_cast<uint16_t>((bits >> 16) & 0x8000u);
    const uint32_t exponent = (bits >> 23) & 0xffu;
    uint32_t mantissa = bits & 0x7fffffu;
    if (exponent == 0xffu)
        return static_cast<uint16_t>(sign | 0x7c00u | (mantissa != 0 ? 0x0200u : 0u));

    int half_exponent = static_cast<int>(exponent) - 127 + 15;
    if (half_exponent >= 31) return static_cast<uint16_t>(sign | 0x7c00u);
    if (half_exponent <= 0) {
        if (half_exponent < -10) return sign;
        mantissa |= 0x800000u;
        const int shift = 14 - half_exponent;
        uint32_t rounded = mantissa >> shift;
        const uint32_t remainder = mantissa & ((uint32_t{1} << shift) - 1u);
        const uint32_t halfway = uint32_t{1} << (shift - 1);
        if (remainder > halfway || (remainder == halfway && (rounded & 1u) != 0)) ++rounded;
        return static_cast<uint16_t>(sign | rounded);
    }

    uint32_t rounded = mantissa >> 13;
    const uint32_t remainder = mantissa & 0x1fffu;
    if (remainder > 0x1000u || (remainder == 0x1000u && (rounded & 1u) != 0)) {
        ++rounded;
        if (rounded == 0x400u) {
            rounded = 0;
            ++half_exponent;
            if (half_exponent >= 31) return static_cast<uint16_t>(sign | 0x7c00u);
        }
    }
    return static_cast<uint16_t>(sign | (static_cast<uint16_t>(half_exponent) << 10) |
                                 static_cast<uint16_t>(rounded));
}

uint32_t half_to_float_bits(uint16_t half)
{
    const uint32_t sign = static_cast<uint32_t>(half & 0x8000u) << 16;
    uint32_t exponent = (half >> 10) & 0x1fu;
    uint32_t mantissa = half & 0x03ffu;
    if (exponent == 0) {
        if (mantissa == 0) return sign;
        int unbiased = -14;
        while ((mantissa & 0x0400u) == 0) {
            mantissa <<= 1;
            --unbiased;
        }
        mantissa &= 0x03ffu;
        return sign | (static_cast<uint32_t>(unbiased + 127) << 23) | (mantissa << 13);
    }
    if (exponent == 0x1fu) return sign | 0x7f800000u | (mantissa << 13);
    return sign | ((exponent - 15u + 127u) << 23) | (mantissa << 13);
}

bool exact_half(float value, uint16_t* half)
{
    uint32_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    const uint16_t candidate = float_to_half_rounded(value);
    if (half_to_float_bits(candidate) != bits) return false;
    if (half != nullptr) *half = candidate;
    return true;
}

bool read_cbor_argument(const std::vector<uint8_t>& payload, std::size_t* cursor,
                        uint8_t additional, uint64_t* value)
{
    if (additional < 24u) {
        *value = additional;
        return true;
    }
    std::size_t bytes = 0;
    uint64_t minimum = 0;
    switch (additional) {
    case 24: bytes = 1; minimum = 24; break;
    case 25: bytes = 2; minimum = 256; break;
    case 26: bytes = 4; minimum = 65536; break;
    case 27: bytes = 8; minimum = uint64_t{1} << 32; break;
    default: return false; /* indefinite/reserved */
    }
    if (*cursor + bytes > payload.size()) return false;
    uint64_t decoded = 0;
    for (std::size_t index = 0; index < bytes; ++index)
        decoded = (decoded << 8) | payload[(*cursor)++];
    if (decoded < minimum) return false;
    *value = decoded;
    return true;
}

bool canonical_cbor_item(const std::vector<uint8_t>& payload, std::size_t* cursor,
                         unsigned depth)
{
    if (*cursor >= payload.size() || depth > 8) return false;
    const uint8_t initial = payload[(*cursor)++];
    const uint8_t major = initial >> 5;
    const uint8_t additional = initial & 0x1fu;
    if (major <= 1) {
        uint64_t ignored = 0;
        return read_cbor_argument(payload, cursor, additional, &ignored);
    }
    if (major == 2 || major == 3) {
        uint64_t length = 0;
        if (!read_cbor_argument(payload, cursor, additional, &length) ||
            length > payload.size() - *cursor)
            return false;
        *cursor += static_cast<std::size_t>(length);
        return true;
    }
    if (major == 4) {
        uint64_t count = 0;
        if (!read_cbor_argument(payload, cursor, additional, &count) || count > 256)
            return false;
        for (uint64_t index = 0; index < count; ++index)
            if (!canonical_cbor_item(payload, cursor, depth + 1)) return false;
        return true;
    }
    if (major == 5 || major == 6) return false; /* contract chỉ dùng array, không tag/map */
    if (additional == 20u || additional == 21u || additional == 22u) return true;
    if (additional == 25u) {
        if (*cursor + 2 > payload.size()) return false;
        const uint16_t half = static_cast<uint16_t>(payload[*cursor] << 8) |
                              payload[*cursor + 1];
        *cursor += 2;
        /* NaN canonical duy nhất là quiet NaN 0x7e00. */
        return ((half & 0x7c00u) != 0x7c00u || (half & 0x03ffu) == 0u || half == 0x7e00u);
    }
    if (additional == 26u) {
        if (*cursor + 4 > payload.size()) return false;
        uint32_t bits = 0;
        for (int index = 0; index < 4; ++index) bits = (bits << 8) | payload[(*cursor)++];
        float value = 0.0f;
        std::memcpy(&value, &bits, sizeof(value));
        uint16_t half = 0;
        return std::isfinite(value) && !exact_half(value, &half);
    }
    /* Payload hiện chỉ có giá trị REAL float32; float64/simple lạ không thuộc
     * schema minor 4 và phải bị từ chối thay vì nới parser im lặng. */
    return false;
}

bool canonical_cbor(const std::vector<uint8_t>& payload)
{
    if (payload.empty()) return false;
    try {
        std::size_t cursor = 0;
        if (!canonical_cbor_item(payload, &cursor, 0) || cursor != payload.size()) return false;
        [[maybe_unused]] const json decoded =
            json::from_cbor(payload, true, true); /* UTF-8 và type syntax */
        return true;
    } catch (const json::exception&) {
        return false;
    }
}

void append_cbor_head(std::vector<uint8_t>* out, uint8_t major, uint64_t value)
{
    if (value < 24u) {
        out->push_back(static_cast<uint8_t>((major << 5) | value));
        return;
    }
    std::size_t bytes = 1;
    uint8_t additional = 24;
    if (value > 0xffu) { bytes = 2; additional = 25; }
    if (value > 0xffffu) { bytes = 4; additional = 26; }
    if (value > 0xffffffffu) { bytes = 8; additional = 27; }
    out->push_back(static_cast<uint8_t>((major << 5) | additional));
    for (std::size_t index = bytes; index > 0; --index)
        out->push_back(static_cast<uint8_t>(value >> ((index - 1) * 8)));
}

void append_cbor_array(std::vector<uint8_t>* out, std::size_t count)
{
    append_cbor_head(out, 4, count);
}

void append_cbor_text(std::vector<uint8_t>* out, const std::string& value)
{
    append_cbor_head(out, 3, value.size());
    out->insert(out->end(), value.begin(), value.end());
}

void append_cbor_uint(std::vector<uint8_t>* out, uint64_t value)
{
    append_cbor_head(out, 0, value);
}

void append_cbor_int(std::vector<uint8_t>* out, int64_t value)
{
    if (value >= 0) append_cbor_uint(out, static_cast<uint64_t>(value));
    else append_cbor_head(out, 1, static_cast<uint64_t>(-(value + 1)));
}

void append_cbor_bool(std::vector<uint8_t>* out, bool value)
{
    out->push_back(value ? 0xf5u : 0xf4u);
}

void append_cbor_null(std::vector<uint8_t>* out)
{
    out->push_back(0xf6u);
}

void append_cbor_float(std::vector<uint8_t>* out, float value)
{
    uint16_t half = 0;
    if (exact_half(value, &half)) {
        out->push_back(0xf9u);
        out->push_back(static_cast<uint8_t>(half >> 8));
        out->push_back(static_cast<uint8_t>(half));
        return;
    }
    uint32_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    out->push_back(0xfau);
    for (int shift = 24; shift >= 0; shift -= 8)
        out->push_back(static_cast<uint8_t>(bits >> shift));
}

bool request_valid(const ProgramRequest& request, ProgramCodecError* error)
{
    if (request.protocol_major != PROGRAM_IPC_PROTOCOL_MAJOR) {
        set_error(error, ProgramCodecError::UnsupportedMajor);
        return false;
    }
    if (request.protocol_minor > PROGRAM_IPC_PROTOCOL_MINOR) {
        set_error(error, ProgramCodecError::UnsupportedMinor);
        return false;
    }
    if (request.schema_version != "1.0") {
        set_error(error, ProgramCodecError::UnsupportedMajor);
        return false;
    }
    if (request.request_id.size() != 16 ||
        (!request.operation_id.empty() && request.operation_id.size() != 16) ||
        !valid_text(request.controller_id, 1, 64) || request.actor_id.size() > 128 ||
        request.deadline_mono_ns == 0 || !valid_correlation(request.correlation_id) ||
        request.payload.empty() || request.payload.size() > PROGRAM_IPC_MAX_PAYLOAD ||
        !canonical_cbor(request.payload) || action_name(request.action).empty()) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
    if (mutation_action(request.action) &&
        (request.operation_id.size() != 16 || request.actor_id.empty())) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(), request.payload.data(), request.payload.size());
    if (sodium_memcmp(digest.data(), request.payload_hash.data(), digest.size()) != 0) {
        set_error(error, ProgramCodecError::PayloadHashMismatch);
        return false;
    }
    set_error(error, ProgramCodecError::None);
    return true;
}

bool response_valid(const ProgramResponse& response, ProgramCodecError* error)
{
    if (response.protocol_major != PROGRAM_IPC_PROTOCOL_MAJOR) {
        set_error(error, ProgramCodecError::UnsupportedMajor);
        return false;
    }
    if (response.protocol_minor > PROGRAM_IPC_PROTOCOL_MINOR ||
        response.schema_version != "1.0") {
        set_error(error, ProgramCodecError::UnsupportedMinor);
        return false;
    }
    if (response.request_id.size() != 16 ||
        (!response.operation_id.empty() && response.operation_id.size() != 16) ||
        !valid_correlation(response.correlation_id) || result_name(response.result).empty() ||
        response.component.size() > 128 || response.payload.size() > PROGRAM_IPC_MAX_PAYLOAD ||
        !canonical_cbor(response.payload)) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
    set_error(error, ProgramCodecError::None);
    return true;
}

std::string hex_key(const std::vector<uint8_t>& bytes)
{
    static constexpr char HEX[] = "0123456789abcdef";
    std::string output(bytes.size() * 2, '0');
    for (std::size_t index = 0; index < bytes.size(); ++index) {
        output[index * 2] = HEX[bytes[index] >> 4U];
        output[index * 2 + 1] = HEX[bytes[index] & 0x0fU];
    }
    return output;
}

std::vector<uint8_t> capabilities_payload()
{
    json payload = json::array({"MK-DDC-24-REV-A", PROGRAM_IPC_MAX_FRAME,
                                PROGRAM_IPC_MAX_QUEUE, json::array({1000, 5000, 30000})});
    return json::to_cbor(payload);
}

std::string uuid_text(const std::vector<uint8_t>& raw)
{
    if (raw.size() != 16) return {};
    static constexpr char HEX[] = "0123456789abcdef";
    std::string output(36, '-');
    std::size_t source = 0;
    for (std::size_t target = 0; target < output.size(); ++target) {
        if (target == 8 || target == 13 || target == 18 || target == 23) continue;
        const uint8_t byte = raw[source / 2];
        output[target] = HEX[(source % 2 == 0) ? (byte >> 4U) : (byte & 0x0fU)];
        ++source;
    }
    return output;
}

bool parse_stage_payload(const ProgramRequest& request, StageCommand* output)
{
    try {
        const json value = json::from_cbor(request.payload, true, true);
        if (!value.is_array() || value.size() != 6 || !value[0].is_string() ||
            !value[1].is_string() || !value[2].is_string() ||
            !value[3].is_number_unsigned() || !value[4].is_binary() ||
            !value[5].is_string()) return false;
        const auto& digest = value[4].get_binary();
        if (digest.size() != crypto_hash_sha256_BYTES) return false;
        output->operation_id = uuid_text(request.operation_id);
        output->revision_id = value[0].get<std::string>();
        output->instance_id = value[1].get<std::string>();
        output->locator = value[2].get<std::string>();
        output->byte_size = value[3].get<uint64_t>();
        output->sha256.assign(digest.begin(), digest.end());
        output->plan_hash = value[5].get<std::string>();
        return true;
    } catch (const json::exception&) {
        return false;
    }
}

bool parse_activate_payload(const ProgramRequest& request, ActivateCommand* output)
{
    try {
        const json value = json::from_cbor(request.payload, true, true);
        if (!value.is_array() || value.size() != 4 ||
            (!value[0].is_null() && !value[0].is_string()) ||
            !value[1].is_string() || !value[2].is_string() || !value[3].is_string())
            return false;
        output->operation_id = uuid_text(request.operation_id);
        output->expected_active_revision_id = value[0].is_null()
            ? std::string() : value[0].get<std::string>();
        output->staged_token = value[1].get<std::string>();
        const std::string cutover = value[2].get<std::string>();
        if (cutover != "PROGRAM_ONLY") return false;
        output->cutover = CutoverMode::PROGRAM_ONLY;
        output->plan_hash = value[3].get<std::string>();
        return true;
    } catch (const json::exception&) {
        return false;
    }
}

/* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §3). Payload 2 phần tử:
 * `[expected_active_revision_id (string|null), instance_id (string)]` —
 * `operation_id` lấy từ envelope chung (`request.operation_id`), cùng mẫu
 * `parse_stage_payload`/`parse_activate_payload`. */
bool parse_retain_reset_payload(const ProgramRequest& request, RetainResetCommand* output)
{
    try {
        const json value = json::from_cbor(request.payload, true, true);
        if (!value.is_array() || value.size() != 2 ||
            (!value[0].is_null() && !value[0].is_string()) ||
            !value[1].is_string()) return false;
        output->operation_id = uuid_text(request.operation_id);
        output->expected_active_revision_id = value[0].is_null()
            ? std::string() : value[0].get<std::string>();
        output->instance_id = value[1].get<std::string>();
        return true;
    } catch (const json::exception&) {
        return false;
    }
}

/* T59-702. Payload 1 phần tử: `[actor_id (string)]`. `operation_id` lấy từ
 * envelope chung. Actor bắt buộc — một quyết định bỏ giao dịch mà không có chủ
 * thì không truy được về sau. */
bool parse_recovery_reset_payload(const ProgramRequest& request, RecoveryResetCommand* output)
{
    try {
        const json value = json::from_cbor(request.payload, true, true);
        if (!value.is_array() || value.size() != 1 || !value[0].is_string()) return false;
        output->operation_id = uuid_text(request.operation_id);
        output->actor_id = value[0].get<std::string>();
        return !output->actor_id.empty();
    } catch (const json::exception&) {
        return false;
    }
}

/* T59-405. Payload 2 phần tử: `[instance_id (string), enabled (bool)]`.
 * `operation_id` lấy từ envelope chung như mọi mutation khác. */
bool parse_set_enabled_payload(const ProgramRequest& request, ProgramEnableCommand* output)
{
    try {
        const json value = json::from_cbor(request.payload, true, true);
        if (!value.is_array() || value.size() != 2 || !value[0].is_string() ||
            !value[1].is_boolean()) return false;
        output->operation_id = uuid_text(request.operation_id);
        output->instance_id = value[0].get<std::string>();
        output->enabled = value[1].get<bool>();
        return true;
    } catch (const json::exception&) {
        return false;
    }
}

/* T59-408 — payload `TRACE_START`:
 * `[sessionId, samplePeriodMs, durationMs, [[instanceId, slot], ...]]`.
 * Biến khai bằng (instanceId, variableName). Số slot là kết quả của một lần
 * biên dịch cụ thể và không tồn tại ở bất kỳ nơi nào BE nhìn thấy — Revision chỉ
 * có tên biến. Core đã có bảng tên→slot trong chương trình đang nạp, nên phân
 * giải ở đây là phân giải ở nơi dữ liệu sống. */
bool parse_trace_start_payload(const ProgramRequest& request, std::string* session_id,
                               uint32_t* period_ms, uint32_t* duration_ms,
                               std::vector<StTraceVariable>* variables)
{
    try {
        const json value = json::from_cbor(request.payload, true, true);
        if (!value.is_array() || value.size() != 4 || !value[0].is_string() ||
            !value[1].is_number_unsigned() || !value[2].is_number_unsigned() ||
            !value[3].is_array())
            return false;
        *session_id = value[0].get<std::string>();
        *period_ms = value[1].get<uint32_t>();
        *duration_ms = value[2].get<uint32_t>();
        variables->clear();
        for (const json& item : value[3]) {
            if (!item.is_array() || item.size() != 2 || !item[0].is_string() ||
                !item[1].is_string())
                return false;
            StTraceVariable variable;
            variable.instance_id = item[0].get<std::string>();
            variable.variable_name = item[1].get<std::string>();
            if (variable.instance_id.empty() || variable.variable_name.empty()) return false;
            variables->push_back(std::move(variable));
        }
        return true;
    } catch (const json::exception&) {
        return false;
    }
}

/* Payload `TRACE_STOP` và `TRACE_READ`: `[sessionId]`. */
bool parse_trace_session_payload(const ProgramRequest& request, std::string* session_id)
{
    try {
        const json value = json::from_cbor(request.payload, true, true);
        if (!value.is_array() || value.size() != 1 || !value[0].is_string()) return false;
        *session_id = value[0].get<std::string>();
        return true;
    } catch (const json::exception&) {
        return false;
    }
}

ProgramResult result_for_state(LifecycleState state)
{
    switch (state) {
    case LifecycleState::IDLE: return ProgramResult::Ok;
    case LifecycleState::STAGED: return ProgramResult::Staged;
    case LifecycleState::COMMIT_INTENT:
    case LifecycleState::ACTIVE_CANDIDATE:
    case LifecycleState::FIRST_CYCLE_OK: return ProgramResult::Accepted;
    case LifecycleState::COMMITTED: return ProgramResult::Ok;
    case LifecycleState::ROLLING_BACK: return ProgramResult::Accepted;
    case LifecycleState::ROLLED_BACK: return ProgramResult::Rejected;
    case LifecycleState::FAILED: return ProgramResult::Rejected;
    case LifecycleState::RECOVERY_REQUIRED: return ProgramResult::Unavailable;
    }
    return ProgramResult::Unavailable;
}

void append_signal_cell(std::vector<uint8_t>* payload,
                        const StSignalDefinition& definition,
                        const StSignalRead& read, bool* valid)
{
    *valid = read.has_value &&
             read.state != StSignalReadState::UNAVAILABLE &&
             read.state != StSignalReadState::NOT_DECLARED;
    if (*valid && definition.type == StType::REAL && !std::isfinite(read.value.r))
        *valid = false;
    if (!*valid) {
        append_cbor_null(payload);
        return;
    }
    switch (definition.type) {
    case StType::BOOL: append_cbor_bool(payload, read.value.b); return;
    case StType::INT:
    case StType::DINT: append_cbor_int(payload, read.value.i); return;
    case StType::UINT:
        append_cbor_uint(payload, static_cast<uint32_t>(read.value.i));
        return;
    case StType::REAL: append_cbor_float(payload, read.value.r); return;
    case StType::TIME: append_cbor_int(payload, read.value.t); return;
    }
    *valid = false;
    append_cbor_null(payload);
}

const char* signal_read_state_name(StSignalReadState state)
{
    switch (state) {
    case StSignalReadState::FRESH: return "FRESH";
    case StSignalReadState::STALE_HELD: return "STALE_HELD";
    case StSignalReadState::STALE_FALLBACK: return "STALE_FALLBACK";
    case StSignalReadState::UNAVAILABLE: return "UNAVAILABLE";
    case StSignalReadState::NOT_DECLARED: return "NOT_DECLARED";
    }
    return "UNAVAILABLE";
}

std::vector<uint8_t> status_payload(const RuntimeOperationSnapshot& snapshot,
                                    const StScheduler* scheduler, uint64_t now_mono_ns)
{
    std::vector<StSignalDiagnosticSnapshot> signals;
    if (scheduler != nullptr && scheduler->signal_bus() != nullptr) {
        signals = scheduler->signal_bus()->inspect_all(now_mono_ns);
    }

    std::vector<uint8_t> payload;
    payload.reserve(128 + signals.size() * 96);
    append_cbor_array(&payload, 5);
    append_cbor_text(&payload, snapshot.producer_mode == CutoverMode::PROGRAM_ONLY
                                   ? "PROGRAM_ONLY" : "GRAPH_ONLY");
    if (snapshot.active_revision_id.empty()) append_cbor_null(&payload);
    else append_cbor_text(&payload, snapshot.active_revision_id);
    if (snapshot.lkg_revision_id.empty()) append_cbor_null(&payload);
    else append_cbor_text(&payload, snapshot.lkg_revision_id);
    append_cbor_array(&payload, snapshot.active_override_ids.size());
    for (const std::string& id : snapshot.active_override_ids) append_cbor_text(&payload, id);
    append_cbor_array(&payload, signals.size());
    for (const StSignalDiagnosticSnapshot& signal : signals) {
        const StSignalDefinition& definition = signal.definition;
        const StSignalRead& read = signal.read;
        append_cbor_array(&payload, 11);
        append_cbor_text(&payload, definition.name);
        append_cbor_text(&payload, definition.publisher_program);
        append_cbor_text(&payload, st_type_name(definition.type));
        bool valid = false;
        append_signal_cell(&payload, definition, read, &valid);
        append_cbor_bool(&payload, valid);
        /* HOLD_PRIVATE dùng STALE_HELD để executor giữ biến đích, kể cả trước
         * lần publish đầu. Ở contract diagnostics, chưa có value vẫn phải là
         * UNAVAILABLE/null; không để consumer API hiểu một ô zero nội bộ là
         * last-known-value. */
        const StSignalReadState reported_state =
            !read.has_value && read.state != StSignalReadState::NOT_DECLARED
                ? StSignalReadState::UNAVAILABLE
                : read.state;
        const bool stale = reported_state == StSignalReadState::STALE_HELD ||
                           reported_state == StSignalReadState::STALE_FALLBACK;
        append_cbor_text(&payload, valid ? (stale ? "UNCERTAIN" : "GOOD") : "BAD");
        append_cbor_text(&payload, signal_read_state_name(reported_state));
        append_cbor_text(&payload, st_stale_policy_name(definition.stale_policy));
        append_cbor_uint(&payload, definition.freshness_ms);
        append_cbor_uint(&payload, read.published_at_ns);
        append_cbor_uint(&payload, read.generation);
    }
    return payload;
}

} // namespace

std::vector<uint8_t> EncodeFrame(const std::vector<uint8_t>& cbor, ProgramCodecError* error)
{
    if (cbor.empty()) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return {};
    }
    if (cbor.size() > PROGRAM_IPC_MAX_FRAME) {
        set_error(error, ProgramCodecError::FrameTooLarge);
        return {};
    }
    std::vector<uint8_t> frame(4 + cbor.size());
    const uint32_t length = static_cast<uint32_t>(cbor.size());
    frame[0] = static_cast<uint8_t>(length & 0xffU);
    frame[1] = static_cast<uint8_t>((length >> 8U) & 0xffU);
    frame[2] = static_cast<uint8_t>((length >> 16U) & 0xffU);
    frame[3] = static_cast<uint8_t>((length >> 24U) & 0xffU);
    std::copy(cbor.begin(), cbor.end(), frame.begin() + 4);
    set_error(error, ProgramCodecError::None);
    return frame;
}

bool DecodeFrame(const std::vector<uint8_t>& frame, std::vector<uint8_t>* cbor,
                 ProgramCodecError* error)
{
    if (cbor == nullptr || frame.size() < 4) {
        set_error(error, ProgramCodecError::FrameTruncated);
        return false;
    }
    const uint32_t length = static_cast<uint32_t>(frame[0]) |
                            (static_cast<uint32_t>(frame[1]) << 8U) |
                            (static_cast<uint32_t>(frame[2]) << 16U) |
                            (static_cast<uint32_t>(frame[3]) << 24U);
    if (length == 0) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
    if (length > PROGRAM_IPC_MAX_FRAME) {
        set_error(error, ProgramCodecError::FrameTooLarge);
        return false;
    }
    if (static_cast<uint64_t>(length) + 4U != frame.size()) {
        set_error(error, ProgramCodecError::FrameTruncated);
        return false;
    }
    cbor->assign(frame.begin() + 4, frame.end());
    set_error(error, ProgramCodecError::None);
    return true;
}

std::vector<uint8_t> EncodeRequestFrame(const ProgramRequest& request, ProgramCodecError* error)
{
    if (!request_valid(request, error)) return {};
    json value = json::array({
        request.protocol_major,
        request.protocol_minor,
        request.schema_version,
        binary_json(request.request_id),
        nullable_binary_json(request.operation_id),
        request.controller_id,
        request.actor_id,
        request.deadline_mono_ns,
        json::binary(std::vector<uint8_t>(request.payload_hash.begin(), request.payload_hash.end())),
        action_name(request.action),
        request.correlation_id,
        binary_json(request.payload),
    });
    return EncodeFrame(json::to_cbor(value), error);
}

bool DecodeRequestFrame(const std::vector<uint8_t>& frame, ProgramRequest* request,
                        ProgramCodecError* error)
{
    if (request == nullptr) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
    std::vector<uint8_t> cbor;
    if (!DecodeFrame(frame, &cbor, error)) return false;
    try {
        const json value = json::from_cbor(cbor, true, true);
        if (!value.is_array() || value.size() != 12 || !value[0].is_number_unsigned() ||
            !value[1].is_number_unsigned() || !value[2].is_string() ||
            !value[5].is_string() || !value[6].is_string() ||
            !value[7].is_number_unsigned() || !value[9].is_string() ||
            !value[10].is_string()) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        ProgramRequest parsed;
        parsed.protocol_major = value[0].get<uint16_t>();
        parsed.protocol_minor = value[1].get<uint16_t>();
        parsed.schema_version = value[2].get<std::string>();
        if (!binary_value(value[3], &parsed.request_id, 16) ||
            !binary_value(value[4], &parsed.operation_id, 16, true)) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        parsed.controller_id = value[5].get<std::string>();
        parsed.actor_id = value[6].get<std::string>();
        parsed.deadline_mono_ns = value[7].get<uint64_t>();
        std::vector<uint8_t> hash;
        if (!binary_value(value[8], &hash, 32) ||
            !parse_action(value[9].get<std::string>(), &parsed.action) ||
            !binary_value(value[11], &parsed.payload, value[11].is_binary()
                                                         ? value[11].get_binary().size()
                                                         : 0)) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        std::copy(hash.begin(), hash.end(), parsed.payload_hash.begin());
        parsed.correlation_id = value[10].get<std::string>();
        if (!request_valid(parsed, error)) return false;
        if (json::to_cbor(value) != cbor) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        *request = std::move(parsed);
        return true;
    } catch (const json::exception&) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
}

std::vector<uint8_t> EncodeResponseFrame(const ProgramResponse& response, ProgramCodecError* error)
{
    if (!response_valid(response, error)) return {};
    json value = json::array({
        response.protocol_major,
        response.protocol_minor,
        response.schema_version,
        binary_json(response.request_id),
        nullable_binary_json(response.operation_id),
        response.correlation_id,
        result_name(response.result),
        response.has_active_revision ? json(response.active_revision_id) : json(nullptr),
        response.has_lkg_revision ? json(response.lkg_revision_id) : json(nullptr),
        response.keeps_running,
        response.has_detail_code ? json(response.detail_code) : json(nullptr),
        response.component,
        binary_json(response.payload),
    });
    return EncodeFrame(json::to_cbor(value), error);
}

bool DecodeResponseFrame(const std::vector<uint8_t>& frame, ProgramResponse* response,
                         ProgramCodecError* error)
{
    if (response == nullptr) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
    std::vector<uint8_t> cbor;
    if (!DecodeFrame(frame, &cbor, error)) return false;
    try {
        const json value = json::from_cbor(cbor, true, true);
        if (!value.is_array() || value.size() != 13 || !value[0].is_number_unsigned() ||
            !value[1].is_number_unsigned() || !value[2].is_string() ||
            !value[5].is_string() || !value[6].is_string() || !value[9].is_boolean() ||
            !value[11].is_string()) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        ProgramResponse parsed;
        parsed.protocol_major = value[0].get<uint16_t>();
        parsed.protocol_minor = value[1].get<uint16_t>();
        parsed.schema_version = value[2].get<std::string>();
        if (!binary_value(value[3], &parsed.request_id, 16) ||
            !binary_value(value[4], &parsed.operation_id, 16, true) ||
            !parse_result(value[6].get<std::string>(), &parsed.result)) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        parsed.correlation_id = value[5].get<std::string>();
        if (!value[7].is_null()) {
            if (!value[7].is_string()) return false;
            parsed.has_active_revision = true;
            parsed.active_revision_id = value[7].get<std::string>();
        }
        if (!value[8].is_null()) {
            if (!value[8].is_string()) return false;
            parsed.has_lkg_revision = true;
            parsed.lkg_revision_id = value[8].get<std::string>();
        }
        parsed.keeps_running = value[9].get<bool>();
        if (!value[10].is_null()) {
            if (!value[10].is_string()) return false;
            parsed.has_detail_code = true;
            parsed.detail_code = value[10].get<std::string>();
        }
        parsed.component = value[11].get<std::string>();
        const std::size_t payload_size = value[12].is_binary() ? value[12].get_binary().size() : 0;
        if (!binary_value(value[12], &parsed.payload, payload_size)) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        if (!response_valid(parsed, error)) return false;
        if (json::to_cbor(value) != cbor) {
            set_error(error, ProgramCodecError::InvalidEnvelope);
            return false;
        }
        *response = std::move(parsed);
        return true;
    } catch (const json::exception&) {
        set_error(error, ProgramCodecError::InvalidEnvelope);
        return false;
    }
}

PeerCredentials ReadPeerCredentials(int socket_fd)
{
    PeerCredentials output;
#ifdef SO_PEERCRED
    struct ucred credential {};
    socklen_t length = sizeof(credential);
    if (::getsockopt(socket_fd, SOL_SOCKET, SO_PEERCRED, &credential, &length) == 0 &&
        length == sizeof(credential)) {
        output.valid = true;
        output.uid = credential.uid;
        output.gid = credential.gid;
        output.pid = credential.pid;
    }
#else
    (void)socket_fd;
#endif
    return output;
}

ProgramResponse ProgramIpcServer::handle_trace(const ProgramRequest& request,
                                               uint64_t now_mono_ns) const
{
    if (value_trace_ == nullptr || trace_scheduler_ == nullptr) {
        /* Một `TRACE_START` "thành công" mà không có nơi lấy mẫu là lời hứa
         * suông: BE sẽ chờ dữ liệu không bao giờ tới. */
        return make_response(request, ProgramResult::Unavailable, "IPC-TRACE-UNAVAILABLE");
    }
    std::string session_id;
    std::string error;
    if (request.action == ProgramAction::TraceStart) {
        uint32_t period_ms = 0;
        uint32_t duration_ms = 0;
        std::vector<StTraceVariable> variables;
        if (!parse_trace_start_payload(request, &session_id, &period_ms, &duration_ms, &variables))
            return make_response(request, ProgramResult::Rejected, "IPC-PAYLOAD");
        /* Mốc bắt đầu là THỜI ĐIỂM HIỆN TẠI, không phải `deadline_mono_ns` —
         * deadline là mốc tương lai của request, và dùng nó sẽ đẩy mẫu đầu tiên
         * ra sau thời điểm người dùng bấm nút. */
        if (!value_trace_->start(session_id, *trace_scheduler_, variables.data(), variables.size(),
                                 period_ms, duration_ms, now_mono_ns, &error))
            return make_response(request, ProgramResult::Rejected, "IPC-TRACE-REJECTED");
        return make_response(request, ProgramResult::Accepted, nullptr);
    }
    if (!parse_trace_session_payload(request, &session_id))
        return make_response(request, ProgramResult::Rejected, "IPC-PAYLOAD");
    if (request.action == ProgramAction::TraceStop) {
        if (!value_trace_->stop(session_id, &error))
            return make_response(request, ProgramResult::Rejected, "IPC-TRACE-REJECTED");
        return make_response(request, ProgramResult::Ok, nullptr);
    }

    /* TRACE_READ: `[state, droppedCount, [[timestampNs, [[valid, bits], ...]], ...]]`.
     * Trả trọn nội dung ring; bounded theo trần Ô nên kích thước có giới hạn
     * trên biết trước. */
    const StTraceStatus status = value_trace_->status();
    if (status.session_id != session_id)
        return make_response(request, ProgramResult::Rejected, "IPC-TRACE-REJECTED");
    json samples = json::array();
    for (std::size_t index = 0; index < value_trace_->sample_count(); ++index) {
        const StTraceSample sample = value_trace_->sample(index);
        json values = json::array();
        for (std::size_t variable = 0; variable < value_trace_->variable_count(); ++variable) {
            uint64_t bits = 0;
            std::memcpy(&bits, &sample.values[variable], sizeof(bits));
            /* Gửi BIT thô của ô, không gửi số đã diễn giải: kiểu của ô là dữ
             * liệu của package, và diễn giải hai lần ở hai bên là hai chỗ để
             * lệch nhau. */
            values.push_back(json::array({sample.valid[variable], bits}));
        }
        samples.push_back(json::array({sample.timestamp_ns, values}));
    }
    const json body = json::array({st_trace_state_name(status.state), status.dropped_count, samples});
    return make_response(request, ProgramResult::Ok, nullptr, json::to_cbor(body));
}

ProgramResponse ProgramIpcServer::make_response(const ProgramRequest& request,
                                                ProgramResult result,
                                                const char* detail_code,
                                                std::vector<uint8_t> payload) const
{
    ProgramResponse response;
    response.request_id = request.request_id;
    response.operation_id = request.operation_id;
    response.correlation_id = request.correlation_id;
    response.result = result;
    response.keeps_running = true;
    response.payload = payload.empty() ? std::vector<uint8_t>{0x80} : std::move(payload);
    if (detail_code != nullptr && detail_code[0] != '\0') {
        response.has_detail_code = true;
        response.detail_code = detail_code;
    }
    return response;
}

void ProgramIpcServer::cache_response(const std::string& request_key,
                                      const std::vector<uint8_t>& request,
                                      const std::vector<uint8_t>& response)
{
    while (cache_order_.size() >= PROGRAM_IPC_CACHE_LIMIT) {
        cache_.erase(cache_order_.front());
        cache_order_.pop_front();
    }
    cache_order_.push_back(request_key);
    cache_[request_key] = CachedResponse{request, response};
}

std::vector<uint8_t> ProgramIpcServer::HandleFrame(const std::vector<uint8_t>& frame,
                                                   const PeerCredentials& peer,
                                                   uint64_t now_mono_ns)
{
    if (!peer.valid || peer.uid != allowed_peer_uid_) return {};

    ProgramRequest request;
    ProgramCodecError decode_error = ProgramCodecError::None;
    if (!DecodeRequestFrame(frame, &request, &decode_error)) return {};

    const std::string request_key = hex_key(request.request_id);
    const auto cached = cache_.find(request_key);
    if (cached != cache_.end()) {
        if (cached->second.request_frame == frame) return cached->second.response_frame;
        ProgramCodecError encode_error = ProgramCodecError::None;
        return EncodeResponseFrame(
            make_response(request, ProgramResult::Rejected, "IPC-REQUEST-ID-CONFLICT"),
            &encode_error);
    }

    ProgramResponse response;
    if (request.deadline_mono_ns <= now_mono_ns) {
        response = make_response(request, ProgramResult::Rejected, "IPC-DEADLINE");
    } else if (queue_depth_ >= PROGRAM_IPC_MAX_QUEUE) {
        response = make_response(request, ProgramResult::Busy, "IPC-QUEUE-FULL");
    } else {
        ++queue_depth_;
        if (request.action == ProgramAction::Capabilities) {
            response = make_response(request, ProgramResult::Ok, nullptr,
                                     capabilities_payload());
        } else if (request.action == ProgramAction::TraceStart ||
                   request.action == ProgramAction::TraceStop ||
                   request.action == ProgramAction::TraceRead) {
            /* Trace KHÔNG cần coordinator: nó đọc trạng thái Program đang chạy,
             * không đụng vòng đời gói. Bắt nó chờ coordinator sẽ làm chẩn đoán
             * không dùng được đúng lúc cần nhất — khi chưa có gói nào commission
             * thành công. */
            response = handle_trace(request, now_mono_ns);
        } else if (coordinator_ == nullptr) {
            response = make_response(request, ProgramResult::Unavailable,
                                     "IPC-RUNTIME-NOT-CONFIGURED");
        } else {
            std::string flush_error;
            if (!coordinator_->flush_progress(&flush_error)) {
                response = make_response(request, ProgramResult::Unavailable,
                                         "IPC-JOURNAL-FSYNC");
            } else if (request.action == ProgramAction::Status) {
                const RuntimeOperationSnapshot snapshot = coordinator_->snapshot();
                response = snapshot.impact_snapshot_valid
                    ? make_response(request, ProgramResult::Ok, nullptr,
                                    status_payload(snapshot, trace_scheduler_, now_mono_ns))
                    : make_response(request, ProgramResult::Unavailable,
                                    "IPC-IMPACT-NOT-READY");
                if (!snapshot.active_revision_id.empty()) {
                    response.has_active_revision = true;
                    response.active_revision_id = snapshot.active_revision_id;
                }
                if (!snapshot.lkg_revision_id.empty()) {
                    response.has_lkg_revision = true;
                    response.lkg_revision_id = snapshot.lkg_revision_id;
                }
            } else if (request.action == ProgramAction::OperationStatus) {
                const RuntimeOperationSnapshot snapshot = coordinator_->snapshot();
                if (snapshot.operation_id != uuid_text(request.operation_id)) {
                    response = make_response(request, ProgramResult::Rejected,
                                             "IPC-OPERATION-NOT-FOUND");
                } else {
                    response = make_response(request, result_for_state(snapshot.state),
                                             snapshot.detail_code.empty()
                                                 ? nullptr : snapshot.detail_code.c_str(),
                                             status_payload(snapshot, trace_scheduler_, now_mono_ns));
                    response.keeps_running = snapshot.keeps_running;
                    if (!snapshot.active_revision_id.empty()) {
                        response.has_active_revision = true;
                        response.active_revision_id = snapshot.active_revision_id;
                    }
                    if (!snapshot.lkg_revision_id.empty()) {
                        response.has_lkg_revision = true;
                        response.lkg_revision_id = snapshot.lkg_revision_id;
                    }
                }
            } else if (request.action == ProgramAction::Stage ||
                       request.action == ProgramAction::Restore) {
                StageCommand command;
                std::string detail;
                std::string error;
                const bool parsed = parse_stage_payload(request, &command);
                const bool staged = parsed &&
                    (request.action == ProgramAction::Restore
                         ? coordinator_->restore(command, &detail, &error)
                         : coordinator_->stage(command, &detail, &error));
                response = make_response(request, staged ? ProgramResult::Staged
                                                         : ProgramResult::Rejected,
                                         staged ? nullptr : (detail.empty()
                                             ? "IPC-PAYLOAD" : detail.c_str()));
            } else if (request.action == ProgramAction::Activate) {
                ActivateCommand command;
                std::string detail;
                std::string error;
                const bool activated = parse_activate_payload(request, &command) &&
                    coordinator_->activate(command, &detail, &error);
                response = make_response(request, activated ? ProgramResult::Accepted
                                                            : ProgramResult::Rejected,
                                         activated ? nullptr : (detail.empty()
                                             ? "IPC-PAYLOAD" : detail.c_str()));
            } else if (request.action == ProgramAction::RetainReset) {
                RetainResetCommand command;
                std::string detail;
                std::string error;
                ProgramResult result = ProgramResult::Rejected;
                if (parse_retain_reset_payload(request, &command)) {
                    switch (coordinator_->reset_retain(command, &detail, &error)) {
                    case RetainResetOutcome::APPLIED: result = ProgramResult::Ok; break;
                    case RetainResetOutcome::REJECTED: result = ProgramResult::Rejected; break;
                    case RetainResetOutcome::TIMED_OUT: result = ProgramResult::Busy; break;
                    }
                } else {
                    detail = "IPC-PAYLOAD";
                }
                response = make_response(request, result,
                                         result == ProgramResult::Ok ? nullptr
                                             : (detail.empty() ? "IPC-PAYLOAD" : detail.c_str()));
            } else if (request.action == ProgramAction::RecoveryReset) {
                RecoveryResetCommand command;
                std::string detail;
                std::string error;
                ProgramResult result = ProgramResult::Rejected;
                if (parse_recovery_reset_payload(request, &command)) {
                    switch (coordinator_->recovery_reset(command, &detail, &error)) {
                    case RecoveryResetOutcome::APPLIED: result = ProgramResult::Ok; break;
                    case RecoveryResetOutcome::NOT_IN_RECOVERY:
                    case RecoveryResetOutcome::REJECTED: result = ProgramResult::Rejected; break;
                    }
                } else {
                    detail = "IPC-PAYLOAD";
                }
                response = make_response(request, result,
                                         result == ProgramResult::Ok ? nullptr
                                             : (detail.empty() ? "IPC-PAYLOAD" : detail.c_str()));
            } else if (request.action == ProgramAction::SetProgramEnabled) {
                ProgramEnableCommand command;
                std::string detail;
                std::string error;
                ProgramResult result = ProgramResult::Rejected;
                if (parse_set_enabled_payload(request, &command)) {
                    switch (coordinator_->set_program_enabled(command, &detail, &error)) {
                    case ProgramEnableOutcome::APPLIED: result = ProgramResult::Ok; break;
                    case ProgramEnableOutcome::REJECTED: result = ProgramResult::Rejected; break;
                    /* Chưa qua safe boundary trong hạn — `Busy` chứ không phải
                     * `Rejected`: BE gọi lại được (lệnh idempotent), còn báo
                     * "đã từ chối" cho một lệnh có thể vẫn sắp áp dụng là nói sai. */
                    case ProgramEnableOutcome::TIMED_OUT: result = ProgramResult::Busy; break;
                    }
                } else {
                    detail = "IPC-PAYLOAD";
                }
                response = make_response(request, result,
                                         result == ProgramResult::Ok ? nullptr
                                             : (detail.empty() ? "IPC-PAYLOAD" : detail.c_str()));
            } else {
                response = make_response(request, ProgramResult::Unavailable,
                                         "IPC-ACTION-NOT-IMPLEMENTED");
            }
        }
        --queue_depth_;
    }
    ProgramCodecError encode_error = ProgramCodecError::None;
    std::vector<uint8_t> encoded = EncodeResponseFrame(response, &encode_error);
    if (encoded.empty()) return {};
    cache_response(request_key, frame, encoded);
    return encoded;
}

} // namespace core::programming
