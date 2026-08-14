#include "graph/runtime_point_snapshot.hpp"

#include <cmath>
#include <charconv>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <limits>

namespace core {
namespace {

SnapshotSource source_for_level(int level)
{
    switch (level) {
    case PRIO_FIRE_SAFETY:  return SnapshotSource::SAFETY;
    case PRIO_LOCAL_MANUAL: return SnapshotSource::MANUAL;
    case PRIO_BACNET:       return SnapshotSource::BACNET;
    case PRIO_SCHEDULE:     return SnapshotSource::SCHEDULE;
    case PRIO_LOCAL_LOGIC:  return SnapshotSource::LOGIC;
    default:                return SnapshotSource::DEFAULT;
    }
}

void set_id(std::array<char, 6>& id, const char* prefix, int channel)
{
    /* Buffer 6 byte chứa đúng "XX-NN\0" — prefix 2 ký tự + '-' + 2 chữ số.
     * `snprintf` không tràn bộ nhớ, nhưng nếu số kênh vượt 99 thì ID bị CẮT
     * ÂM THẦM thành một ID khác hợp lệ về hình thức nhưng sai điểm — loại lỗi
     * không có cách nào phát hiện ở phía đọc.
     *
     * Kẹp tường minh ở đây thay vì tin caller: hôm nay KX_N_UI = 16 nên không
     * thể xảy ra, nhưng ràng buộc đó nằm ở file khác và sẽ không ai nhớ khi
     * tăng số kênh. Kẹp cũng cho compiler chứng minh được biên nên
     * -Wformat-truncation không còn cảnh báo. */
    const int ch = (channel + 1 < 1) ? 1 : ((channel + 1 > 99) ? 99 : channel + 1);
    std::snprintf(id.data(), id.size(), "%.2s-%02d", prefix, ch);
}

bool same_value(float left, float right)
{
    return left == right || (std::isnan(left) && std::isnan(right));
}

const char* kind_name(SnapshotPointKind kind)
{
    switch (kind) {
    case SnapshotPointKind::UI: return "UI";
    case SnapshotPointKind::AO: return "AO";
    case SnapshotPointKind::DO: return "DO";
    }
    return "UI";
}

const char* quality_name(kx_quality_t quality)
{
    switch (quality) {
    case KX_Q_GOOD: return "GOOD";
    case KX_Q_UNCERTAIN: return "UNCERTAIN";
    case KX_Q_BAD: return "BAD";
    }
    return "BAD";
}

const char* source_name(SnapshotSource source)
{
    switch (source) {
    case SnapshotSource::IO: return "io";
    case SnapshotSource::SAFETY: return "safety";
    case SnapshotSource::MANUAL: return "manual";
    case SnapshotSource::BACNET: return "bacnet";
    case SnapshotSource::SCHEDULE: return "schedule";
    case SnapshotSource::LOGIC: return "logic";
    case SnapshotSource::DEFAULT: return "default";
    }
    return "default";
}

const char* role_name(SnapshotRole role)
{
    switch (role) {
    case SnapshotRole::ENGINEERING_VALUE: return "engineering_value";
    case SnapshotRole::RESOLVED_SETPOINT: return "resolved_setpoint";
    case SnapshotRole::HARDWARE_FEEDBACK: return "hardware_feedback";
    }
    return "engineering_value";
}

template <std::size_t Size>
std::size_t fixed_length(const std::array<char, Size>& value)
{
    const void* end = std::memchr(value.data(), '\0', value.size());
    return end ? static_cast<const char*>(end) - value.data() : value.size();
}

class JsonWriter {
public:
    JsonWriter(char* output, std::size_t capacity) : output_(output), capacity_(capacity) {}

    bool append(const char* text, std::size_t length) noexcept
    {
        if (!ok_ || length > capacity_ - size_) {
            ok_ = false;
            return false;
        }
        std::memcpy(output_ + size_, text, length);
        size_ += length;
        return true;
    }
    bool append(const char* text) noexcept { return append(text, std::strlen(text)); }
    bool append_uint(uint64_t value) noexcept
    {
        char number[32];
        const auto result = std::to_chars(number, number + sizeof(number), value);
        return result.ec == std::errc{} && append(number, result.ptr - number);
    }
    bool append_float(float value) noexcept
    {
        char number[32];
        const auto result = std::to_chars(number, number + sizeof(number),
                                          static_cast<double>(value),
                                          std::chars_format::general,
                                          std::numeric_limits<double>::max_digits10);
        return result.ec == std::errc{} && append(number, result.ptr - number);
    }
    bool append_escaped(const char* text, std::size_t length) noexcept
    {
        static constexpr char hex[] = "0123456789abcdef";
        for (std::size_t i = 0; i < length;) {
            const unsigned char c = static_cast<unsigned char>(text[i]);
            if (c == '"') { append("\\\""); ++i; continue; }
            if (c == '\\') { append("\\\\"); ++i; continue; }
            if (c == '\b') { append("\\b"); ++i; continue; }
            if (c == '\f') { append("\\f"); ++i; continue; }
            if (c == '\n') { append("\\n"); ++i; continue; }
            if (c == '\r') { append("\\r"); ++i; continue; }
            if (c == '\t') { append("\\t"); ++i; continue; }
            if (c < 0x20) {
                const char escaped[6] = {'\\', 'u', '0', '0', hex[c >> 4], hex[c & 0x0f]};
                append(escaped, sizeof(escaped));
                ++i;
                continue;
            }
            if (c < 0x80) { append(text + i, 1); ++i; continue; }

            std::size_t sequence = 0;
            if (c >= 0xc2 && c <= 0xdf) sequence = 2;
            else if (c >= 0xe0 && c <= 0xef) sequence = 3;
            else if (c >= 0xf0 && c <= 0xf4) sequence = 4;
            bool valid = sequence != 0 && i + sequence <= length;
            for (std::size_t j = 1; valid && j < sequence; ++j)
                valid = (static_cast<unsigned char>(text[i + j]) & 0xc0) == 0x80;
            if (valid && sequence == 3) {
                const unsigned char second = static_cast<unsigned char>(text[i + 1]);
                valid = (c != 0xe0 || second >= 0xa0) && (c != 0xed || second < 0xa0);
            }
            if (valid && sequence == 4) {
                const unsigned char second = static_cast<unsigned char>(text[i + 1]);
                valid = (c != 0xf0 || second >= 0x90) && (c != 0xf4 || second < 0x90);
            }
            if (valid) {
                append(text + i, sequence);
                i += sequence;
            } else {
                append("\xef\xbf\xbd", 3);
                ++i;
            }
        }
        return ok_;
    }
    std::size_t size() const noexcept { return size_; }
    bool ok() const noexcept { return ok_; }

private:
    char* output_;
    std::size_t capacity_;
    std::size_t size_ = 0;
    bool ok_ = true;
};

bool append_utc_rfc3339_ms(JsonWriter& writer, uint64_t utc_ms) noexcept
{
    const std::time_t seconds = static_cast<std::time_t>(utc_ms / 1000u);
    struct tm utc{};
    if (!gmtime_r(&seconds, &utc)) return false;
    char timestamp[25];
    const int length = std::snprintf(timestamp, sizeof(timestamp),
                                     "%04d-%02d-%02dT%02d:%02d:%02d.%03lluZ",
                                     utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
                                     utc.tm_hour, utc.tm_min, utc.tm_sec,
                                     static_cast<unsigned long long>(utc_ms % 1000u));
    return length == 24 && writer.append(timestamp, 24);
}

} // namespace

bool serialize_runtime_point_snapshot(const RuntimePointSnapshot& snapshot, char* output,
                                      std::size_t capacity, std::size_t* length) noexcept
{
    if (!output || !length) return false;
    *length = 0;
    JsonWriter writer{output, capacity};
    writer.append("{\"snapshotId\":");
    writer.append_uint(snapshot.snapshot_id);
    writer.append(",\"snapshotObservedAtUtc\":\"");
    if (!append_utc_rfc3339_ms(writer, snapshot.observed_utc_ms)) return false;
    writer.append("\",\"capturedMonotonicNs\":");
    writer.append_uint(snapshot.captured_monotonic_ns);
    writer.append(",\"safeState\":");
    writer.append(snapshot.safe_state ? "true" : "false");
    writer.append(",\"task\":");
    if (!snapshot.task.present) {
        writer.append("null");
    } else {
        writer.append("{\"taskId\":\"");
        writer.append_escaped(snapshot.task.id.data(), fixed_length(snapshot.task.id));
        writer.append("\",\"periodMs\":"); writer.append_uint(snapshot.task.period_ms);
        writer.append(",\"budgetMs\":"); writer.append_uint(snapshot.task.budget_ms);
        writer.append(",\"state\":\"");
        writer.append_escaped(snapshot.task.state.data(), fixed_length(snapshot.task.state));
        writer.append("\",\"runCount\":"); writer.append_uint(snapshot.task.run_count);
        writer.append(",\"missedReleaseCount\":"); writer.append_uint(snapshot.task.missed_release_count);
        writer.append(",\"lastExecNs\":"); writer.append_uint(snapshot.task.last_exec_ns);
        writer.append(",\"maxExecNs\":"); writer.append_uint(snapshot.task.max_exec_ns);
        writer.append(",\"overrunCount\":"); writer.append_uint(snapshot.task.overrun_count);
        writer.append(",\"consecutiveOverruns\":"); writer.append_uint(snapshot.task.consecutive_overruns);
        writer.append("}");
    }
    writer.append(",\"points\":[");
    for (std::size_t index = 0; index < snapshot.rows.size(); ++index) {
        const RuntimePointSnapshotRow& row = snapshot.rows[index];
        const bool finite = std::isfinite(row.value);
        if (index != 0) writer.append(",");
        writer.append("{\"id\":\"");
        writer.append_escaped(row.id.data(), fixed_length(row.id));
        writer.append("\",\"kind\":\""); writer.append(kind_name(row.kind));
        writer.append("\",\"value\":");
        if (finite) writer.append_float(row.value); else writer.append("null");
        writer.append(",\"quality\":\"");
        writer.append(quality_name(finite ? row.quality : KX_Q_BAD));
        writer.append("\",\"source\":\""); writer.append(source_name(row.source));
        writer.append("\",\"role\":\""); writer.append(role_name(row.role));
        writer.append("\",\"unit\":\"");
        writer.append_escaped(row.unit.data(), fixed_length(row.unit));
        writer.append("\",\"updatedAtMonotonicNs\":");
        writer.append_uint(row.updated_at_monotonic_ns);
        writer.append(",\"generation\":"); writer.append_uint(row.generation);
        writer.append(",\"programValue\":");
        if (row.program_value_present && std::isfinite(row.program_value))
            writer.append_float(row.program_value);
        else
            writer.append("null");
        writer.append(",\"effectivePriority\":");
        if (row.effective_priority > 0) writer.append_uint(row.effective_priority);
        else writer.append("null");
        writer.append("}");
    }
    writer.append("]}");
    *length = writer.ok() ? writer.size() : 0;
    return writer.ok();
}

std::string serialize_runtime_point_snapshot(const RuntimePointSnapshot& snapshot)
{
    std::array<char, KX_POINT_SNAPSHOT_MAX_PAYLOAD> output{};
    std::size_t length = 0;
    if (!serialize_runtime_point_snapshot(snapshot, output.data(), output.size(), &length))
        return {};
    return {output.data(), length};
}

RuntimePointSnapshot RuntimePointSnapshotPublisher::build(
    uint64_t snapshot_id, uint64_t observed_utc_ms, uint64_t captured_monotonic_ns,
    const PointTable& table, const IoSnapshot& io, const OutputCmd& resolved,
    const PriorityResolver& resolver, bool safe_state_active)
{
    RuntimePointSnapshot snapshot;
    snapshot.snapshot_id = snapshot_id;
    snapshot.observed_utc_ms = observed_utc_ms;
    snapshot.captured_monotonic_ns = captured_monotonic_ns;
    snapshot.safe_state = safe_state_active;

    for (int channel = 0; channel < KX_N_UI; ++channel) {
        RuntimePointSnapshotRow& row = snapshot.rows[static_cast<std::size_t>(channel)];
        const Point point = table.get({PointKind::AI, channel});
        set_id(row.id, "UI", channel);
        row.kind = SnapshotPointKind::UI;
        row.value = point.value;
        row.quality = point.quality;
        row.source = SnapshotSource::IO;
        row.role = SnapshotRole::ENGINEERING_VALUE;
        std::memcpy(row.unit.data(), io.ui_unit[channel], sizeof(io.ui_unit[channel]));
        row.updated_at_monotonic_ns = io.ts_ns;
    }

    for (int channel = 0; channel < KX_N_AO; ++channel) {
        const std::size_t index = KX_N_UI + static_cast<std::size_t>(channel);
        RuntimePointSnapshotRow& row = snapshot.rows[index];
        const SnapshotSource source = safe_state_active
                                          ? SnapshotSource::SAFETY
                                          : source_for_level(resolver.winning_ao_level(channel));
        const bool finite_and_valid = resolved.ao_valid[channel] &&
                                      std::isfinite(resolved.ao[channel]);
        const kx_quality_t quality = finite_and_valid ? KX_Q_GOOD : KX_Q_BAD;
        const bool current_mode = io.ao_mode[channel] == 1;
        if (!ao_seen_[channel] || previous_ao_source_[channel] != source ||
            previous_ao_quality_[channel] != quality ||
            previous_ao_current_mode_[channel] != current_mode ||
            !same_value(previous_ao_value_[channel], resolved.ao[channel])) {
            ao_updated_at_[channel] = captured_monotonic_ns;
        }
        ao_seen_[channel] = true;
        previous_ao_value_[channel] = resolved.ao[channel];
        previous_ao_source_[channel] = source;
        previous_ao_quality_[channel] = quality;
        previous_ao_current_mode_[channel] = current_mode;

        set_id(row.id, "AO", channel);
        row.kind = SnapshotPointKind::AO;
        row.value = resolved.ao[channel];
        row.quality = quality;
        row.source = source;
        row.role = SnapshotRole::RESOLVED_SETPOINT;
        const char* unit = current_mode ? "mA" : "V";
        std::memcpy(row.unit.data(), unit, std::strlen(unit));
        row.updated_at_monotonic_ns = ao_updated_at_[channel];
        row.effective_priority = static_cast<uint8_t>(safe_state_active
            ? PRIO_FIRE_SAFETY : resolver.winning_ao_level(channel));
        row.program_value_present = resolver.ao_value_at_level(
            PRIO_LOCAL_LOGIC, channel, &row.program_value);
    }

    for (int channel = 0; channel < KX_N_DO; ++channel) {
        const std::size_t index = KX_N_UI + KX_N_AO + static_cast<std::size_t>(channel);
        RuntimePointSnapshotRow& row = snapshot.rows[index];
        const Point point = table.get({PointKind::BO, channel});
        set_id(row.id, "DO", channel);
        row.kind = SnapshotPointKind::DO;
        row.value = point.value;
        row.quality = point.quality;
        row.source = SnapshotSource::IO;
        row.role = SnapshotRole::HARDWARE_FEEDBACK;
        row.updated_at_monotonic_ns = io.ts_ns;
        row.effective_priority = static_cast<uint8_t>(safe_state_active
            ? PRIO_FIRE_SAFETY : resolver.winning_do_level(channel));
        bool program_value = false;
        row.program_value_present = resolver.do_value_at_level(
            PRIO_LOCAL_LOGIC, channel, &program_value);
        row.program_value = program_value ? 1.0f : 0.0f;
    }

    return snapshot;
}

} // namespace core
