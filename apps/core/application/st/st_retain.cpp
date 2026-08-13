#include "st/st_retain.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>

#include <fcntl.h>
#include <sodium.h>
#include <sys/stat.h>
#include <unistd.h>

namespace core {
namespace {

constexpr std::size_t kCrcOffset = 144;
constexpr uint16_t kFlagHasRetainedFb = 1u << 0;

void put_u16(uint8_t* p, uint16_t value)
{
    p[0] = static_cast<uint8_t>(value & 0xFFu);
    p[1] = static_cast<uint8_t>((value >> 8u) & 0xFFu);
}

void put_u32(uint8_t* p, uint32_t value)
{
    for (int i = 0; i < 4; ++i)
        p[i] = static_cast<uint8_t>((value >> (8 * i)) & 0xFFu);
}

void put_u64(uint8_t* p, uint64_t value)
{
    for (int i = 0; i < 8; ++i)
        p[i] = static_cast<uint8_t>((value >> (8 * i)) & 0xFFu);
}

uint16_t rd_u16(const uint8_t* p)
{
    return static_cast<uint16_t>(p[0] | (static_cast<uint16_t>(p[1]) << 8u));
}

uint32_t rd_u32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8u) |
           (static_cast<uint32_t>(p[2]) << 16u) | (static_cast<uint32_t>(p[3]) << 24u);
}

uint64_t rd_u64(const uint8_t* p)
{
    uint64_t value = 0;
    for (int i = 7; i >= 0; --i) value = (value << 8u) | p[i];
    return value;
}

uint32_t crc32_update(uint32_t crc, const uint8_t* data, std::size_t size)
{
    for (std::size_t i = 0; i < size; ++i) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; ++bit)
            crc = (crc >> 1u) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return crc;
}

uint32_t record_crc(const uint8_t* data, std::size_t size)
{
    if (size < kCrcOffset + 4) return 0;
    uint32_t crc = crc32_update(0xFFFFFFFFu, data, kCrcOffset);
    static constexpr uint8_t zeros[4] = {0, 0, 0, 0};
    crc = crc32_update(crc, zeros, sizeof(zeros));
    crc = crc32_update(crc, data + kCrcOffset + 4, size - kCrcOffset - 4);
    return ~crc;
}

void sha256_identity(const std::string& stable_identity,
                     std::array<uint8_t, st_retain::kDigestBytes>* out)
{
    crypto_hash_sha256(out->data(),
                       reinterpret_cast<const unsigned char*>(stable_identity.data()),
                       stable_identity.size());
}

std::string hex_digest(const std::array<uint8_t, st_retain::kDigestBytes>& digest)
{
    static constexpr char hex[] = "0123456789abcdef";
    std::string result;
    result.resize(digest.size() * 2);
    for (std::size_t i = 0; i < digest.size(); ++i) {
        result[i * 2] = hex[digest[i] >> 4u];
        result[i * 2 + 1] = hex[digest[i] & 0x0Fu];
    }
    return result;
}

void hash_u8(crypto_hash_sha256_state* state, uint8_t value)
{
    crypto_hash_sha256_update(state, &value, 1);
}

void hash_u16(crypto_hash_sha256_state* state, uint16_t value)
{
    uint8_t bytes[2];
    put_u16(bytes, value);
    crypto_hash_sha256_update(state, bytes, sizeof(bytes));
}

void hash_u32(crypto_hash_sha256_state* state, uint32_t value)
{
    uint8_t bytes[4];
    put_u32(bytes, value);
    crypto_hash_sha256_update(state, bytes, sizeof(bytes));
}

void hash_string(crypto_hash_sha256_state* state, const std::string& value)
{
    hash_u16(state, static_cast<uint16_t>(value.size()));
    crypto_hash_sha256_update(
        state, reinterpret_cast<const unsigned char*>(value.data()), value.size());
}

std::size_t type_size(StType type)
{
    switch (type) {
    case StType::BOOL: return 1;
    case StType::INT:
    case StType::UINT: return 2;
    case StType::DINT:
    case StType::REAL: return 4;
    case StType::TIME: return 8;
    }
    return 0;
}

int64_t bounded_now(uint64_t now_ns)
{
    return now_ns > static_cast<uint64_t>(INT64_MAX) ? INT64_MAX
                                                      : static_cast<int64_t>(now_ns);
}

int64_t elapsed_since(int64_t now_ns, int64_t start_ns)
{
    if (now_ns <= start_ns) return 0;
    if (start_ns < 0 && now_ns > INT64_MAX + start_ns) return INT64_MAX;
    return now_ns - start_ns;
}

int64_t rebase_start(int64_t now_ns, int64_t elapsed_ns)
{
    if (elapsed_ns <= 0 || elapsed_ns > now_ns) return now_ns;
    return now_ns - elapsed_ns;
}

bool build_snapshot_payload(const StLoadedProgram& program, uint64_t now_ns,
                            StRetainSnapshot* snapshot) noexcept
{
    if (!snapshot || !program.has_retain() ||
        program.retain_record_size > snapshot->payload.size())
        return false;
    snapshot->payload.fill(0);
    snapshot->payload_size = program.retain_record_size;

    uint32_t end_of_variables = 0;
    for (const StIrRetainEntry& entry : program.retain_entries) {
        const std::size_t size = type_size(entry.type);
        if (entry.slot >= program.slots.size() || size == 0 ||
            static_cast<uint64_t>(entry.offset) + size > snapshot->payload_size)
            return false;
        const StCell& cell = program.slots[entry.slot];
        uint8_t* dst = snapshot->payload.data() + entry.offset;
        switch (entry.type) {
        case StType::BOOL: dst[0] = cell.b ? 1 : 0; break;
        case StType::INT:
        case StType::UINT: put_u16(dst, static_cast<uint16_t>(cell.i)); break;
        case StType::DINT: put_u32(dst, static_cast<uint32_t>(cell.i)); break;
        case StType::REAL:
            if (!std::isfinite(cell.r)) return false;
            std::memcpy(dst, &cell.r, sizeof(cell.r));
            break;
        case StType::TIME:
            if (cell.t < 0) return false;
            put_u64(dst, static_cast<uint64_t>(cell.t));
            break;
        }
        end_of_variables = std::max(end_of_variables,
                                    entry.offset + static_cast<uint32_t>(size));
    }

    uint32_t offset = end_of_variables;
    const int64_t now = bounded_now(now_ns);
    for (const StIrFbInstance& fb : program.fb_instances) {
        if (!fb.retained) continue;
        const std::size_t size = st_fb_retain_state_size(fb.fb_type);
        if (fb.state_index >= program.fb_states.size() || size == 0 ||
            static_cast<uint64_t>(offset) + size > snapshot->payload_size)
            return false;
        const StFbState& state = program.fb_states[fb.state_index];
        uint8_t* dst = snapshot->payload.data() + offset;
        switch (fb.fb_type) {
        case StFbType::TON:
        case StFbType::TOF:
            dst[0] = state.timing ? 1 : 0;
            put_u64(dst + 1, static_cast<uint64_t>(
                                 state.timing ? elapsed_since(now, state.start_ns) : 0));
            dst[9] = state.q ? 1 : 0;
            break;
        case StFbType::R_TRIG:
        case StFbType::F_TRIG:
            dst[0] = state.prev_clk ? 1 : 0;
            break;
        case StFbType::PID:
            if (!std::isfinite(state.pid_integral) || !std::isfinite(state.pid_prev_pv) ||
                !std::isfinite(state.pid_prev_output))
                return false;
            std::memcpy(dst, &state.pid_integral, 4);
            std::memcpy(dst + 4, &state.pid_prev_pv, 4);
            std::memcpy(dst + 8, &state.pid_prev_output, 4);
            dst[12] = state.pid_first ? 1 : 0;
            break;
        case StFbType::NONE:
            return false;
        }
        offset += static_cast<uint32_t>(size);
    }
    return offset == snapshot->payload_size;
}

bool validate_payload(const StLoadedProgram& program, const uint8_t* payload,
                      uint32_t payload_size)
{
    uint32_t end_of_variables = 0;
    for (const StIrRetainEntry& entry : program.retain_entries) {
        const std::size_t size = type_size(entry.type);
        if (entry.slot >= program.slots.size() || size == 0 ||
            static_cast<uint64_t>(entry.offset) + size > payload_size)
            return false;
        const uint8_t* src = payload + entry.offset;
        if (entry.type == StType::BOOL && src[0] > 1) return false;
        if (entry.type == StType::REAL) {
            float value = 0.0f;
            std::memcpy(&value, src, sizeof(value));
            if (!std::isfinite(value)) return false;
        }
        if (entry.type == StType::TIME && rd_u64(src) > static_cast<uint64_t>(INT64_MAX))
            return false;
        end_of_variables = std::max(end_of_variables,
                                    entry.offset + static_cast<uint32_t>(size));
    }

    uint32_t offset = end_of_variables;
    for (const StIrFbInstance& fb : program.fb_instances) {
        if (!fb.retained) continue;
        const std::size_t size = st_fb_retain_state_size(fb.fb_type);
        if (fb.state_index >= program.fb_states.size() || size == 0 ||
            static_cast<uint64_t>(offset) + size > payload_size)
            return false;
        const uint8_t* src = payload + offset;
        switch (fb.fb_type) {
        case StFbType::TON:
        case StFbType::TOF:
            if (src[0] > 1 || src[9] > 1 || rd_u64(src + 1) > static_cast<uint64_t>(INT64_MAX))
                return false;
            break;
        case StFbType::R_TRIG:
        case StFbType::F_TRIG:
            if (src[0] > 1) return false;
            break;
        case StFbType::PID: {
            float values[3]{};
            std::memcpy(values, src, sizeof(values));
            if (!std::isfinite(values[0]) || !std::isfinite(values[1]) ||
                !std::isfinite(values[2]) || src[12] > 1)
                return false;
            break;
        }
        case StFbType::NONE:
            return false;
        }
        offset += static_cast<uint32_t>(size);
    }
    return offset == payload_size;
}

void apply_payload(StLoadedProgram* program, const uint8_t* payload, uint64_t now_ns)
{
    uint32_t end_of_variables = 0;
    for (const StIrRetainEntry& entry : program->retain_entries) {
        StCell& cell = program->slots[entry.slot];
        const uint8_t* src = payload + entry.offset;
        switch (entry.type) {
        case StType::BOOL: cell.b = src[0] != 0; break;
        case StType::INT: cell.i = static_cast<int16_t>(rd_u16(src)); break;
        case StType::UINT: cell.i = rd_u16(src); break;
        case StType::DINT: cell.i = static_cast<int32_t>(rd_u32(src)); break;
        case StType::REAL: std::memcpy(&cell.r, src, sizeof(cell.r)); break;
        case StType::TIME: cell.t = static_cast<int64_t>(rd_u64(src)); break;
        }
        end_of_variables = std::max(
            end_of_variables,
            entry.offset + static_cast<uint32_t>(type_size(entry.type)));
    }

    uint32_t offset = end_of_variables;
    const int64_t now = bounded_now(now_ns);
    for (const StIrFbInstance& fb : program->fb_instances) {
        if (!fb.retained) continue;
        StFbState& state = program->fb_states[fb.state_index];
        const uint8_t* src = payload + offset;
        switch (fb.fb_type) {
        case StFbType::TON:
        case StFbType::TOF:
            state.timing = src[0] != 0;
            state.start_ns = state.timing
                                 ? rebase_start(now, static_cast<int64_t>(rd_u64(src + 1)))
                                 : 0;
            state.q = src[9] != 0;
            break;
        case StFbType::R_TRIG:
        case StFbType::F_TRIG:
            state.prev_clk = src[0] != 0;
            break;
        case StFbType::PID:
            std::memcpy(&state.pid_integral, src, 4);
            std::memcpy(&state.pid_prev_pv, src + 4, 4);
            std::memcpy(&state.pid_prev_output, src + 8, 4);
            /* Monotonic timestamp không có nghĩa qua process restart. Giữ
             * integral/feedback, nhưng ép chu kỳ đầu re-seed dt/derivative. */
            state.pid_prev_call_ns = now;
            state.pid_first = true;
            break;
        case StFbType::NONE:
            break;
        }
        offset += static_cast<uint32_t>(st_fb_retain_state_size(fb.fb_type));
    }
}

bool read_exact(int fd, uint8_t* data, std::size_t size)
{
    std::size_t done = 0;
    while (done < size) {
        const ssize_t count = ::read(fd, data + done, size - done);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return false;
        done += static_cast<std::size_t>(count);
    }
    return true;
}

bool fsync_parent(const std::string& path)
{
    const std::size_t slash = path.find_last_of('/');
    const std::string dir = slash == std::string::npos ? "." : path.substr(0, slash);
    const int fd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0) return false;
    const bool ok = ::fsync(fd) == 0;
    ::close(fd);
    return ok;
}

} // namespace

const char* st_retain_restore_state_name(StRetainRestoreState state)
{
    switch (state) {
    case StRetainRestoreState::NOT_APPLICABLE: return "NOT_APPLICABLE";
    case StRetainRestoreState::COLD_INIT_MISSING: return "COLD_INIT_MISSING";
    case StRetainRestoreState::COLD_INIT_REJECTED: return "COLD_INIT_REJECTED";
    case StRetainRestoreState::RESTORED: return "RESTORED";
    }
    return "NOT_APPLICABLE";
}

bool st_prepare_retain_layout_identity(StLoadedProgram* program)
{
    if (!program) return false;
    if (!program->has_retain()) {
        std::memset(program->retain_layout_sha256, 0, sizeof(program->retain_layout_sha256));
        return true;
    }

    crypto_hash_sha256_state state;
    crypto_hash_sha256_init(&state);
    static constexpr char prefix[] = "MKDDC-RETAIN-LAYOUT-SHA256-V1";
    crypto_hash_sha256_update(&state, reinterpret_cast<const unsigned char*>(prefix),
                              sizeof(prefix) - 1);
    hash_string(&state, program->program_name);
    for (const StIrRetainEntry& entry : program->retain_entries) {
        const StIrVariable* variable = nullptr;
        for (const StIrVariable& candidate : program->variables)
            if (candidate.slot == entry.slot) {
                variable = &candidate;
                break;
            }
        if (!variable || variable->storage != StStorage::VAR_RETAIN ||
            variable->type != entry.type)
            return false;
        hash_u8(&state, 'V');
        hash_string(&state, variable->name);
        hash_u16(&state, static_cast<uint16_t>(entry.type));
        hash_u32(&state, entry.offset);
        hash_u32(&state, static_cast<uint32_t>(type_size(entry.type)));
    }
    uint32_t offset = 0;
    for (const StIrRetainEntry& entry : program->retain_entries)
        offset = std::max(offset,
                          entry.offset + static_cast<uint32_t>(type_size(entry.type)));
    for (const StIrFbInstance& fb : program->fb_instances) {
        if (!fb.retained) continue;
        const uint32_t size = static_cast<uint32_t>(st_fb_retain_state_size(fb.fb_type));
        if (size == 0) return false;
        hash_u8(&state, 'F');
        hash_string(&state, fb.name);
        hash_u16(&state, static_cast<uint16_t>(fb.fb_type));
        hash_u32(&state, offset);
        hash_u32(&state, size);
        offset += size;
    }
    if (offset != program->retain_record_size) return false;
    crypto_hash_sha256_final(&state, program->retain_layout_sha256);
    return true;
}

StRetainStore::StRetainStore(std::string path, std::string stable_identity)
    : path_(std::move(path))
{
    sha256_identity(stable_identity, &instance_identity_);
}

StRetainResult StRetainStore::restore(StLoadedProgram* program, uint64_t now_ns)
{
    StRetainResult result;
    if (!program || !program->has_retain()) return result;
    if (!st_prepare_retain_layout_identity(program)) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadRecordSize;
        result.message = "runtime RETAIN layout is not canonical";
        return result;
    }

    const int fd = ::open(path_.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) {
        if (errno == ENOENT) {
            result.state = StRetainRestoreState::COLD_INIT_MISSING;
            result.message = "retain record missing; cold initialization";
        } else {
            result.state = StRetainRestoreState::COLD_INIT_REJECTED;
            result.reject_code = st_retain_error::kBadRecordSize;
            result.message = "cannot open retain record; cold initialization";
        }
        return result;
    }

    struct stat st {};
    const std::size_t max_file = st_retain::kHeaderSize + st_ir::kMaxRetainRecord;
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) ||
        st.st_size < st_retain::kHeaderSize ||
        static_cast<uint64_t>(st.st_size) > max_file) {
        ::close(fd);
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadRecordSize;
        result.message = "retain file size is outside bounded record range";
        return result;
    }

    std::vector<uint8_t> file(static_cast<std::size_t>(st.st_size));
    const bool read_ok = read_exact(fd, file.data(), file.size());
    ::close(fd);
    if (!read_ok) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadRecordSize;
        result.message = "retain file read was incomplete";
        return result;
    }

    const uint8_t* data = file.data();
    if (rd_u32(data) != st_retain::kMagic ||
        rd_u16(data + 4) != st_retain::kRecordVersion ||
        rd_u16(data + 6) != st_retain::kHeaderSize ||
        rd_u16(data + 8) != st_retain::kLayoutVersion) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadMagicOrVersion;
        result.message = "retain magic/record/layout version mismatch";
        return result;
    }
    const uint16_t flags = rd_u16(data + 10);
    const bool expected_retained_fb = std::any_of(
        program->fb_instances.begin(), program->fb_instances.end(),
        [](const StIrFbInstance& fb) { return fb.retained; });
    const bool reserved_zero = std::all_of(data + 148, data + st_retain::kHeaderSize,
                                           [](uint8_t value) { return value == 0; });
    if ((flags & ~kFlagHasRetainedFb) != 0 ||
        ((flags & kFlagHasRetainedFb) != 0) != expected_retained_fb ||
        rd_u32(data + 20) != 0 || !reserved_zero) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadMagicOrVersion;
        result.message = "retain header flags/reserved field is invalid";
        return result;
    }
    const uint32_t payload_size = rd_u32(data + 16);
    if (file.size() != st_retain::kHeaderSize + payload_size ||
        payload_size > st_ir::kMaxRetainRecord) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadRecordSize;
        result.message = "retain payload size does not match record boundary";
        return result;
    }
    if (record_crc(data, file.size()) != rd_u32(data + kCrcOffset)) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadCrc;
        result.message = "retain record CRC mismatch; cold initialization";
        return result;
    }
    if (std::memcmp(data + 48, instance_identity_.data(), instance_identity_.size()) != 0 ||
        rd_u32(data + 12) != program->retain_layout_hash ||
        std::memcmp(data + 80, program->retain_layout_sha256,
                    sizeof(program->retain_layout_sha256)) != 0) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kLayoutMismatch;
        result.message = "retain stable instance/variable identity or layout mismatch";
        return result;
    }
    if (payload_size != program->retain_record_size) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadRecordSize;
        result.message = "retain payload size does not match active layout";
        return result;
    }

    const uint8_t* payload = data + st_retain::kHeaderSize;
    if (!validate_payload(*program, payload, payload_size)) {
        result.state = StRetainRestoreState::COLD_INIT_REJECTED;
        result.reject_code = st_retain_error::kBadRecordSize;
        result.message = "retain payload contains invalid typed state";
        return result;
    }

    apply_payload(program, payload, now_ns);
    result.state = StRetainRestoreState::RESTORED;
    result.restored = true;
    result.generation = rd_u64(data + 24);
    last_generation_ = result.generation;
    /* captured_at_ns là monotonic của process trước, không được dùng để tính
     * giãn cách trong process mới. Payload giống nhau vẫn không ghi lại; khi
     * state đổi, checkpoint đầu tiên của process mới được phép ghi. */
    last_write_ns_ = 0;
    last_written_payload_.assign(payload, payload + payload_size);
    std::memcpy(last_layout_identity_.data(), data + 80, last_layout_identity_.size());
    return result;
}

StRetainSaveOutcome StRetainStore::save_snapshot_if_needed(const StRetainSnapshot& snapshot,
                                                            bool force)
{
    if (snapshot.payload_size == 0 || snapshot.payload_size > snapshot.payload.size() ||
        snapshot.instance_identity != instance_identity_)
        return StRetainSaveOutcome::ERROR;

    const bool same_layout = snapshot.layout_identity == last_layout_identity_;
    const bool same_payload = same_layout &&
        last_written_payload_.size() == snapshot.payload_size &&
        std::memcmp(last_written_payload_.data(), snapshot.payload.data(),
                    snapshot.payload_size) == 0;
    if (same_payload) return StRetainSaveOutcome::NO_CHANGE;
    if (!force && last_write_ns_ != 0 &&
        (snapshot.captured_at_ns <= last_write_ns_ ||
         snapshot.captured_at_ns - last_write_ns_ < st_retain::kMinWriteIntervalNs))
        return StRetainSaveOutcome::DEFERRED;

    std::vector<uint8_t> file(st_retain::kHeaderSize + snapshot.payload_size, 0);
    uint8_t* data = file.data();
    put_u32(data, st_retain::kMagic);
    put_u16(data + 4, st_retain::kRecordVersion);
    put_u16(data + 6, st_retain::kHeaderSize);
    put_u16(data + 8, st_retain::kLayoutVersion);
    put_u16(data + 10, snapshot.has_retained_fb ? kFlagHasRetainedFb : 0);
    put_u32(data + 12, snapshot.layout_hash);
    put_u32(data + 16, snapshot.payload_size);
    put_u64(data + 24, snapshot.generation);
    put_u64(data + 32, snapshot.captured_at_ns);
    put_u64(data + 40, snapshot.source_hash);
    std::memcpy(data + 48, snapshot.instance_identity.data(), snapshot.instance_identity.size());
    std::memcpy(data + 80, snapshot.layout_identity.data(), snapshot.layout_identity.size());
    std::memcpy(data + 112, snapshot.artifact_sha256.data(), snapshot.artifact_sha256.size());
    std::memcpy(data + st_retain::kHeaderSize, snapshot.payload.data(), snapshot.payload_size);
    put_u32(data + kCrcOffset, record_crc(data, file.size()));

    if (!write_atomic(file)) return StRetainSaveOutcome::ERROR;
    last_written_payload_.assign(snapshot.payload.begin(),
                                 snapshot.payload.begin() + snapshot.payload_size);
    last_layout_identity_ = snapshot.layout_identity;
    last_write_ns_ = snapshot.captured_at_ns;
    last_generation_ = snapshot.generation;
    ++write_count_;
    return StRetainSaveOutcome::WRITTEN;
}

bool StRetainStore::save_if_needed(const StLoadedProgram& program, uint64_t now_ns, bool force)
{
    StRetainSnapshot snapshot;
    snapshot.instance_identity = instance_identity_;
    std::memcpy(snapshot.layout_identity.data(), program.retain_layout_sha256,
                snapshot.layout_identity.size());
    std::memcpy(snapshot.artifact_sha256.data(), program.sha256,
                snapshot.artifact_sha256.size());
    snapshot.layout_hash = program.retain_layout_hash;
    snapshot.generation = standalone_generation_++;
    snapshot.captured_at_ns = now_ns;
    snapshot.source_hash = program.source_hash;
    for (const StIrFbInstance& fb : program.fb_instances)
        if (fb.retained) snapshot.has_retained_fb = true;
    if (!build_snapshot_payload(program, now_ns, &snapshot)) return false;
    return save_snapshot_if_needed(snapshot, force) == StRetainSaveOutcome::WRITTEN;
}

bool StRetainStore::write_atomic(const std::vector<uint8_t>& bytes) const
{
    const std::string tmp = path_ + ".tmp";
    const int fd = ::open(tmp.c_str(),
                          O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0640);
    if (fd < 0) return false;

    std::size_t written = 0;
    while (written < bytes.size()) {
        const ssize_t count = ::write(fd, bytes.data() + written, bytes.size() - written);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) {
            ::close(fd);
            ::unlink(tmp.c_str());
            return false;
        }
        written += static_cast<std::size_t>(count);
    }
    const bool synced = ::fsync(fd) == 0;
    const bool closed = ::close(fd) == 0;
    if (!synced || !closed) {
        ::unlink(tmp.c_str());
        return false;
    }
    if (::rename(tmp.c_str(), path_.c_str()) != 0) {
        ::unlink(tmp.c_str());
        return false;
    }
    return fsync_parent(path_);
}

bool StRetainStore::erase()
{
    if (::unlink(path_.c_str()) != 0 && errno != ENOENT) return false;
    if (!fsync_parent(path_)) return false;
    last_written_payload_.clear();
    last_layout_identity_.fill(0);
    last_write_ns_ = 0;
    last_generation_ = 0;
    return true;
}

bool StRetainMailbox::publish(const StLoadedProgram& program, uint64_t now_ns) noexcept
{
    if (!program.has_retain()) return false;
    int selected = -1;
    for (int index = 0; index < static_cast<int>(slots_.size()); ++index) {
        uint8_t expected = EMPTY;
        if (slots_[index].state.compare_exchange_strong(
                expected, WRITING, std::memory_order_acquire, std::memory_order_relaxed)) {
            selected = index;
            break;
        }
    }
    if (selected < 0) {
        for (int index = 0; index < static_cast<int>(slots_.size()); ++index) {
            uint8_t expected = READY;
            if (slots_[index].state.compare_exchange_strong(
                    expected, WRITING, std::memory_order_acquire, std::memory_order_relaxed)) {
                selected = index;
                break;
            }
        }
    }
    if (selected < 0) return false; /* worker đang đọc cả hai: cực hiếm, bỏ snapshot này */

    StRetainSnapshot& snapshot = slots_[selected].snapshot;
    snapshot.instance_identity = instance_identity_;
    std::memcpy(snapshot.layout_identity.data(), program.retain_layout_sha256,
                snapshot.layout_identity.size());
    std::memcpy(snapshot.artifact_sha256.data(), program.sha256,
                snapshot.artifact_sha256.size());
    snapshot.layout_hash = program.retain_layout_hash;
    snapshot.generation = next_generation_.fetch_add(1, std::memory_order_relaxed);
    snapshot.captured_at_ns = now_ns;
    snapshot.source_hash = program.source_hash;
    snapshot.has_retained_fb = false;
    for (const StIrFbInstance& fb : program.fb_instances)
        if (fb.retained) snapshot.has_retained_fb = true;

    if (!build_snapshot_payload(program, now_ns, &snapshot)) {
        slots_[selected].state.store(EMPTY, std::memory_order_release);
        return false;
    }
    slots_[selected].state.store(READY, std::memory_order_release);
    if (owner_) owner_->notify_worker();
    return true;
}

int StRetainMailbox::acquire_latest_ready() noexcept
{
    /* Phải claim READY -> READING TRƯỚC khi đọc snapshot.generation. Nếu đọc
     * generation rồi mới CAS, producer có thể đã đổi READY -> WRITING và đang
     * ghi đè cùng slot: đó là data race dù xác suất rất nhỏ. */
    std::array<int, 2> acquired{{-1, -1}};
    int acquired_count = 0;
    for (int index = 0; index < static_cast<int>(slots_.size()); ++index) {
        uint8_t expected = READY;
        if (slots_[index].state.compare_exchange_strong(
                expected, READING, std::memory_order_acquire, std::memory_order_relaxed))
            acquired[acquired_count++] = index;
    }
    if (acquired_count == 0) return -1;

    int selected = -1;
    uint64_t newest = 0;
    for (int cursor = 0; cursor < acquired_count; ++cursor) {
        const int index = acquired[cursor];
        if (selected < 0 || slots_[index].snapshot.generation > newest) {
            selected = index;
            newest = slots_[index].snapshot.generation;
        }
    }
    for (int cursor = 0; cursor < acquired_count; ++cursor)
        if (acquired[cursor] != selected)
            slots_[acquired[cursor]].state.store(EMPTY, std::memory_order_release);
    return selected;
}

void StRetainMailbox::release_after_save(int index, StRetainSaveOutcome outcome) noexcept
{
    if (index < 0 || index >= static_cast<int>(slots_.size())) return;
    const uint64_t generation = slots_[index].snapshot.generation;
    if (outcome == StRetainSaveOutcome::WRITTEN) {
        write_count_.fetch_add(1, std::memory_order_relaxed);
        last_saved_generation_.store(generation, std::memory_order_release);
    } else if (outcome == StRetainSaveOutcome::ERROR) {
        write_fail_count_.fetch_add(1, std::memory_order_relaxed);
    }
    if (outcome == StRetainSaveOutcome::DEFERRED || outcome == StRetainSaveOutcome::ERROR)
        slots_[index].state.store(READY, std::memory_order_release);
    else {
        slots_[index].state.store(EMPTY, std::memory_order_release);
        discard_older_ready(generation);
    }
}

void StRetainMailbox::discard_older_ready(uint64_t generation) noexcept
{
    for (Slot& slot : slots_) {
        uint8_t expected = READY;
        if (!slot.state.compare_exchange_strong(expected, READING, std::memory_order_acquire,
                                                std::memory_order_relaxed))
            continue;
        slot.state.store(slot.snapshot.generation <= generation ? EMPTY : READY,
                         std::memory_order_release);
    }
}

bool st_publish_retain_snapshot(StRetainMailbox* mailbox, const StLoadedProgram& program,
                                uint64_t now_ns) noexcept
{
    return mailbox && mailbox->publish(program, now_ns);
}

StRetainService::StRetainService(std::string root_dir, std::string controller_identity,
                                 bool start_worker)
    : root_dir_(std::move(root_dir)), controller_identity_(std::move(controller_identity))
{
    std::error_code error;
    std::filesystem::create_directories(root_dir_, error);
    if (error) {
        error_ = "cannot create RETAIN directory: " + error.message();
        return;
    }
    if (::chmod(root_dir_.c_str(), 0750) != 0) {
        error_ = "cannot set RETAIN directory permissions";
        return;
    }
    ready_ = true;
    if (start_worker) {
        worker_started_ = true;
        worker_ = std::thread(&StRetainService::worker_loop, this);
    }
}

StRetainService::~StRetainService()
{
    shutdown_and_flush();
}

StRetainService::Entry* StRetainService::find_entry_locked(const std::string& instance_id)
{
    for (const auto& entry : entries_)
        if (entry->instance_id == instance_id) return entry.get();
    return nullptr;
}

StRetainMailbox* StRetainService::register_instance(const std::string& instance_id)
{
    if (!ready_ || instance_id.empty() || instance_id.size() > 64) return nullptr;
    std::lock_guard<std::mutex> lock(entries_mutex_);
    if (Entry* existing = find_entry_locked(instance_id)) return &existing->mailbox;

    const std::string stable_identity = controller_identity_ + std::string(1, '\0') + instance_id;
    std::array<uint8_t, st_retain::kDigestBytes> digest{};
    sha256_identity(stable_identity, &digest);
    const std::string path = root_dir_ + "/" + hex_digest(digest) + ".bin";
    auto entry = std::make_unique<Entry>(instance_id, path, stable_identity);
    entry->mailbox.instance_identity_ = entry->store.instance_identity();
    entry->mailbox.owner_ = this;
    StRetainMailbox* mailbox = &entry->mailbox;
    entries_.push_back(std::move(entry));
    return mailbox;
}

StRetainResult StRetainService::restore(const std::string& instance_id,
                                        StLoadedProgram* program, uint64_t now_ns)
{
    Entry* entry = nullptr;
    {
        std::lock_guard<std::mutex> lock(entries_mutex_);
        entry = find_entry_locked(instance_id);
    }
    if (!entry) {
        StRetainResult result;
        if (program && program->has_retain()) {
            result.state = StRetainRestoreState::COLD_INIT_REJECTED;
            result.reject_code = st_retain_error::kBadRecordSize;
            result.message = "RETAIN instance is not registered";
        }
        return result;
    }
    std::lock_guard<std::mutex> io_lock(entry->io_mutex);
    StRetainResult result = entry->store.restore(program, now_ns);
    const uint64_t next = result.generation == UINT64_MAX ? UINT64_MAX : result.generation + 1;
    uint64_t current = entry->mailbox.next_generation_.load(std::memory_order_relaxed);
    while (current < next && !entry->mailbox.next_generation_.compare_exchange_weak(
                                 current, next, std::memory_order_relaxed)) {}
    return result;
}

void StRetainService::notify_worker() noexcept
{
    wake_cv_.notify_one();
}

void StRetainService::flush(bool force)
{
    std::lock_guard<std::mutex> entries_lock(entries_mutex_);
    for (const auto& entry : entries_) {
        const int index = entry->mailbox.acquire_latest_ready();
        if (index < 0) continue;
        StRetainSaveOutcome outcome;
        {
            std::lock_guard<std::mutex> io_lock(entry->io_mutex);
            outcome = entry->store.save_snapshot_if_needed(
                entry->mailbox.slots_[index].snapshot, force);
        }
        entry->mailbox.release_after_save(index, outcome);
    }
}

void StRetainService::worker_loop()
{
    while (!stop_.load(std::memory_order_acquire)) {
        std::unique_lock<std::mutex> lock(wake_mutex_);
        wake_cv_.wait_for(lock, std::chrono::seconds(1));
        lock.unlock();
        if (!stop_.load(std::memory_order_acquire)) flush(false);
    }
    flush(true);
}

void StRetainService::shutdown_and_flush()
{
    if (worker_started_) {
        stop_.store(true, std::memory_order_release);
        wake_cv_.notify_one();
        if (worker_.joinable()) worker_.join();
        worker_started_ = false;
    } else if (ready_) {
        flush(true);
    }
}

} // namespace core
