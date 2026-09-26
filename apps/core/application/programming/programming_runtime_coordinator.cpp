#include "programming/programming_runtime_coordinator.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <thread>
#include <vector>

#include <fcntl.h>
#include <sodium.h>
#include <sys/stat.h>
#include <unistd.h>

#include "st/st_ir.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"

namespace core::programming {
namespace {

constexpr const char* kTaskId = "main";
constexpr uint32_t kCheckpointMagic = 0x50434B4DU; /* "MKCP" little-endian */
constexpr uint16_t kCheckpointVersion = 1;
constexpr std::size_t kCheckpointFieldSize = 64;
constexpr std::size_t kCheckpointHeaderSize = 16;
constexpr std::size_t kCheckpointSize = kCheckpointHeaderSize + 4 * kCheckpointFieldSize + 4;

uint32_t crc32(const uint8_t* data, std::size_t size)
{
    uint32_t crc = 0xFFFFFFFFU;
    for (std::size_t index = 0; index < size; ++index) {
        crc ^= data[index];
        for (int bit = 0; bit < 8; ++bit)
            crc = (crc >> 1U) ^ (0xEDB88320U & (0U - (crc & 1U)));
    }
    return ~crc;
}

void put_u16(std::vector<uint8_t>* output, uint16_t value)
{
    output->push_back(static_cast<uint8_t>(value & 0xffU));
    output->push_back(static_cast<uint8_t>((value >> 8U) & 0xffU));
}

void put_u32(std::vector<uint8_t>* output, uint32_t value)
{
    for (int index = 0; index < 4; ++index)
        output->push_back(static_cast<uint8_t>((value >> (8 * index)) & 0xffU));
}

void put_u64(std::vector<uint8_t>* output, uint64_t value)
{
    for (int index = 0; index < 8; ++index)
        output->push_back(static_cast<uint8_t>((value >> (8 * index)) & 0xffU));
}

void put_checkpoint_field(std::vector<uint8_t>* output, const std::string& value)
{
    for (std::size_t index = 0; index < kCheckpointFieldSize; ++index)
        output->push_back(index < value.size() ? static_cast<uint8_t>(value[index]) : 0);
}

uint16_t read_u16(const uint8_t* input)
{
    return static_cast<uint16_t>(input[0] | (static_cast<uint16_t>(input[1]) << 8U));
}

uint32_t read_u32(const uint8_t* input)
{
    return static_cast<uint32_t>(input[0]) |
           (static_cast<uint32_t>(input[1]) << 8U) |
           (static_cast<uint32_t>(input[2]) << 16U) |
           (static_cast<uint32_t>(input[3]) << 24U);
}

uint64_t read_u64(const uint8_t* input)
{
    uint64_t value = 0;
    for (int index = 7; index >= 0; --index) value = (value << 8U) | input[index];
    return value;
}

std::string read_checkpoint_field(const uint8_t* input)
{
    const void* nul = std::memchr(input, 0, kCheckpointFieldSize);
    const std::size_t size = nul
        ? static_cast<std::size_t>(static_cast<const uint8_t*>(nul) - input)
        : kCheckpointFieldSize;
    return std::string(reinterpret_cast<const char*>(input), size);
}

bool decode_hex_digest(const std::string& value,
                       std::vector<uint8_t>* output)
{
    if (!output || value.size() != crypto_hash_sha256_BYTES * 2) return false;
    output->assign(crypto_hash_sha256_BYTES, 0);
    for (std::size_t index = 0; index < output->size(); ++index) {
        const auto nibble = [](char ch) -> int {
            if (ch >= '0' && ch <= '9') return ch - '0';
            if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
            return -1;
        };
        const int high = nibble(value[index * 2]);
        const int low = nibble(value[index * 2 + 1]);
        if (high < 0 || low < 0) { output->clear(); return false; }
        (*output)[index] = static_cast<uint8_t>((high << 4) | low);
    }
    return true;
}

std::string hex_digest(const uint8_t* data, std::size_t size)
{
    static constexpr char HEX[] = "0123456789abcdef";
    std::string output(size * 2, '0');
    for (std::size_t i = 0; i < size; ++i) {
        output[i * 2] = HEX[data[i] >> 4U];
        output[i * 2 + 1] = HEX[data[i] & 0x0fU];
    }
    return output;
}

bool bind_program_signal_refs(StPreparedProgram* prepared,
                              const std::string& instance_id,
                              const std::vector<StPackageSignal>& signals,
                              StSignalBus* bus, std::string* error)
{
    if (prepared == nullptr) {
        if (error) *error = "ảnh Program chuẩn bị không tồn tại";
        return false;
    }
    StLoadedProgram& program = prepared->program;
    if (!program.signal_refs.empty() && bus == nullptr) {
        if (error) *error = "artifact tham chiếu Published Signal nhưng runtime không có signal bus";
        return false;
    }
    for (StIrSignalRef& ref : program.signal_refs) {
        std::size_t matched = signals.size();
        for (std::size_t index = 0; index < signals.size(); ++index) {
            if (signals[index].name.size() == ref.name.size() &&
                std::equal(signals[index].name.begin(), signals[index].name.end(),
                           ref.name.begin(), [](char left, char right) {
                               return std::toupper(static_cast<unsigned char>(left)) ==
                                      std::toupper(static_cast<unsigned char>(right));
                           })) {
                matched = index;
                break;
            }
        }
        if (matched == signals.size()) {
            if (error) *error = "artifact tham chiếu signal không có trong package: '" +
                                ref.name + "'";
            return false;
        }
        const StPackageSignal& contract = signals[matched];
        if (static_cast<StType>(contract.data_type) != ref.type) {
            if (error) *error = "kiểu signal trong artifact không khớp package: '" +
                                ref.name + "'";
            return false;
        }
        if (ref.publish && contract.producer_program != instance_id) {
            if (error) *error = "Program '" + instance_id +
                                "' không phải publisher của signal '" + ref.name + "'";
            return false;
        }
        /* Semantic IEC không phân biệt hoa thường. Runtime dùng canonical name
         * của package để publish_batch phòng thủ bằng exact identity mà không
         * từ chối source viết khác case. */
        ref.name = contract.name;
        ref.runtime_index = static_cast<int16_t>(matched);
    }
    program.signal_bus = bus;
    program.runtime_instance_id = instance_id;
    return true;
}

bool path_within(const std::string& root, const std::string& candidate)
{
    if (root.empty() || candidate.size() <= root.size() || candidate.compare(0, root.size(), root) != 0)
        return false;
    return root.back() == '/' || candidate[root.size()] == '/';
}

int open_regular_beneath(const std::string& root, const std::string& candidate)
{
    if (!path_within(root, candidate)) { errno = EACCES; return -1; }
    std::size_t offset = root.size();
    if (root.back() != '/') ++offset;
    if (offset >= candidate.size()) { errno = EINVAL; return -1; }
    int directory = ::open(root.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (directory < 0) return -1;
    while (offset < candidate.size()) {
        const std::size_t separator = candidate.find('/', offset);
        const bool final = separator == std::string::npos;
        const std::string component = candidate.substr(
            offset, final ? std::string::npos : separator - offset);
        if (component.empty() || component == "." || component == "..") {
            ::close(directory);
            errno = EACCES;
            return -1;
        }
        const int flags = final
            ? (O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
            : (O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        const int next = ::openat(directory, component.c_str(), flags);
        ::close(directory);
        if (next < 0) return -1;
        if (final) return next;
        directory = next;
        offset = separator + 1;
    }
    ::close(directory);
    errno = EINVAL;
    return -1;
}

bool canonical_uuid(const std::string& value)
{
    if (value.size() != 36) return false;
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (index == 8 || index == 13 || index == 18 || index == 23) {
            if (value[index] != '-') return false;
            continue;
        }
        const char ch = value[index];
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
    }
    return true;
}

/* Instance id đi vào scheduler và vào journal, nên nó phải là identity ổn định:
 * ASCII in được, không dấu phân cách đường dẫn, không rỗng. Không ép nó phải là
 * một tên cố định — tên Program là dữ liệu của package (T59-401). */
bool valid_instance_id(const std::string& value)
{
    if (value.empty() || value.size() > 64) return false;
    for (const char character : value) {
        const bool alphanumeric = (character >= '0' && character <= '9') ||
                                  (character >= 'A' && character <= 'Z') ||
                                  (character >= 'a' && character <= 'z');
        if (!alphanumeric && character != '_' && character != '-' && character != '.') return false;
    }
    return true;
}

bool lowercase_hex_64(const std::string& value)
{
    if (value.size() != 64) return false;
    return std::all_of(value.begin(), value.end(), [](char ch) {
        return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
    });
}

} // namespace

const char* lifecycle_state_name(LifecycleState state)
{
    switch (state) {
    case LifecycleState::IDLE: return "IDLE";
    case LifecycleState::STAGED: return "STAGED";
    case LifecycleState::COMMIT_INTENT: return "COMMIT_INTENT";
    case LifecycleState::ACTIVE_CANDIDATE: return "ACTIVE_CANDIDATE";
    case LifecycleState::FIRST_CYCLE_OK: return "FIRST_CYCLE_OK";
    case LifecycleState::COMMITTED: return "COMMITTED";
    case LifecycleState::FAILED: return "FAILED";
    case LifecycleState::ROLLING_BACK: return "ROLLING_BACK";
    case LifecycleState::ROLLED_BACK: return "ROLLED_BACK";
    case LifecycleState::RECOVERY_REQUIRED: return "RECOVERY_REQUIRED";
    }
    return "RECOVERY_REQUIRED";
}

ProgrammingRuntimeCoordinator::ProgrammingRuntimeCoordinator(
    StScheduler* scheduler, ProgrammingCutover* cutover, std::string journal_path,
    std::string staging_root)
    : scheduler_(scheduler), cutover_(cutover), journal_(journal_path),
      staging_root_(std::move(staging_root)), checkpoint_path_(journal_path + ".active")
{
}

bool ProgrammingRuntimeCoordinator::recover(std::string* error)
{
    const StJournalReadResult read = journal_.read_last();
    const StJournalBootAction action = st_journal_decide_boot_action(read);
    ActiveCheckpoint checkpoint;
    std::string checkpoint_error;
    std::string load_error;
    const bool has_checkpoint = read_active_checkpoint(&checkpoint, &checkpoint_error);
    const auto load_checkpoint = [&]() {
        load_error.clear();
        return load_active_checkpoint(checkpoint, &load_error);
    };
    if (read.status == StJournalReadStatus::OK) {
        operation_id_ = read.record.operation_id;
        previous_artifact_hash_ = read.record.old_active_hash;
        artifact_hash_ = read.record.candidate_hash;
        plan_hash_ = read.record.plan_hash;
    }
    switch (action) {
    case StJournalBootAction::KEEP_OLD_ACTIVE_DISCARD_CANDIDATE:
        if (read.status == StJournalReadStatus::OK && !read.record.old_active_hash.empty() &&
            has_checkpoint && checkpoint.artifact_sha256 == read.record.old_active_hash)
            (void)load_checkpoint();
        state_.store(LifecycleState::IDLE, std::memory_order_release);
        if (previous_revision_id_.empty()) {
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
        }
        return true;
    case StJournalBootAction::KEEP_OLD_ACTIVE_MARK_OPERATION_FAILED:
        if (!read.record.old_active_hash.empty() && has_checkpoint &&
            checkpoint.artifact_sha256 == read.record.old_active_hash)
            (void)load_checkpoint();
        detail_code_ = "JOURNAL_COMMIT_INTENT_RECOVERED";
        state_.store(LifecycleState::FAILED, std::memory_order_release);
        if (previous_revision_id_.empty()) {
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
        }
        return true;
    case StJournalBootAction::USE_LKG_CANDIDATE_NOT_AUTO_PUBLISHED:
        if (!read.record.old_active_hash.empty() && has_checkpoint &&
            checkpoint.artifact_sha256 == read.record.old_active_hash &&
            load_checkpoint()) {
            detail_code_ = "JOURNAL_ACTIVE_CANDIDATE_ROLLED_BACK";
            state_.store(LifecycleState::ROLLED_BACK, std::memory_order_release);
        } else {
            detail_code_ = "JOURNAL_ACTIVE_CANDIDATE_RECOVERY_REQUIRED";
            state_.store(LifecycleState::RECOVERY_REQUIRED, std::memory_order_release);
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
            if (error) *error = load_error.empty()
                ? "active candidate has no valid prior LKG checkpoint" : load_error;
            return false;
        }
        return true;
    case StJournalBootAction::VERIFY_ACTIVE_THEN_FINISH_OR_LKG:
        if (has_checkpoint && checkpoint.operation_id == read.record.operation_id &&
            checkpoint.artifact_sha256 == read.record.candidate_hash &&
            checkpoint.plan_hash == read.record.plan_hash &&
            load_checkpoint()) {
            detail_code_.clear();
            state_.store(LifecycleState::COMMITTED, std::memory_order_release);
            previous_artifact_hash_ = read.record.old_active_hash;
            if (!append_phase(StJournalPhase::COMMITTED, error)) return false;
            previous_artifact_hash_ = artifact_hash_;
        } else if (!read.record.old_active_hash.empty() && has_checkpoint &&
                   checkpoint.artifact_sha256 == read.record.old_active_hash &&
                   load_checkpoint()) {
            detail_code_ = "JOURNAL_FIRST_CYCLE_ROLLED_BACK";
            state_.store(LifecycleState::ROLLED_BACK, std::memory_order_release);
        } else {
            detail_code_ = "JOURNAL_FIRST_CYCLE_VERIFY_REQUIRED";
            state_.store(LifecycleState::RECOVERY_REQUIRED, std::memory_order_release);
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
            if (error) *error = load_error.empty()
                ? "first-cycle journal cannot be matched to active/LKG checkpoint" : load_error;
            return false;
        }
        return true;
    case StJournalBootAction::USE_COMMITTED_ACTIVE:
        if (has_checkpoint && checkpoint.operation_id == read.record.operation_id &&
            checkpoint.artifact_sha256 == read.record.candidate_hash &&
            checkpoint.plan_hash == read.record.plan_hash &&
            load_checkpoint()) {
            detail_code_.clear();
            state_.store(LifecycleState::COMMITTED, std::memory_order_release);
        } else {
            detail_code_ = "JOURNAL_COMMITTED_CHECKPOINT_INVALID";
            state_.store(LifecycleState::RECOVERY_REQUIRED, std::memory_order_release);
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
            if (error) *error = !load_error.empty() ? load_error :
                (checkpoint_error.empty()
                    ? "committed journal has no matching active checkpoint" : checkpoint_error);
            return false;
        }
        return true;
    case StJournalBootAction::COLD_START_AFTER_RECOVERY_RESET:
        /* Operator đã bỏ giao dịch cũ. Boot sạch: không Active, không candidate,
         * graph giữ quyền output cho tới khi có Commission mới. */
        detail_code_ = "JOURNAL_RECOVERY_RESET";
        state_.store(LifecycleState::IDLE, std::memory_order_release);
        cutover_->request(CutoverMode::GRAPH_ONLY);
        (void)cutover_->apply_pending_at_boundary();
        return true;
    case StJournalBootAction::NO_VALID_RECORD_RAISE_INCIDENT:
        detail_code_ = "JOURNAL_CORRUPT";
        state_.store(LifecycleState::RECOVERY_REQUIRED, std::memory_order_release);
        if (!has_checkpoint || !load_active_checkpoint(checkpoint, error)) {
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
        }
        if (error) *error = "Programming journal corrupt; graph owner retained";
        return false;
    }
    return false;
}

bool ProgrammingRuntimeCoordinator::write_active_checkpoint(std::string* error) const
{
    if (!canonical_uuid(operation_id_) || !canonical_uuid(revision_id_) ||
        !lowercase_hex_64(artifact_hash_) || !lowercase_hex_64(plan_hash_) ||
        artifact_byte_size_ == 0) {
        if (error) *error = "active checkpoint identity invalid";
        return false;
    }
    std::vector<uint8_t> bytes;
    bytes.reserve(kCheckpointSize);
    put_u32(&bytes, kCheckpointMagic);
    put_u16(&bytes, kCheckpointVersion);
    put_u16(&bytes, 0);
    put_u64(&bytes, artifact_byte_size_);
    put_checkpoint_field(&bytes, operation_id_);
    put_checkpoint_field(&bytes, revision_id_);
    put_checkpoint_field(&bytes, artifact_hash_);
    put_checkpoint_field(&bytes, plan_hash_);
    put_u32(&bytes, crc32(bytes.data(), bytes.size()));

    const std::string temporary = checkpoint_path_ + ".tmp." + std::to_string(::getpid());
    (void)::unlink(temporary.c_str());
    const int fd = ::open(temporary.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
                          0640);
    if (fd < 0) { if (error) *error = std::strerror(errno); return false; }
    std::size_t written = 0;
    while (written < bytes.size()) {
        const ssize_t count = ::write(fd, bytes.data() + written, bytes.size() - written);
        if (count <= 0) { ::close(fd); ::unlink(temporary.c_str()); return false; }
        written += static_cast<std::size_t>(count);
    }
    const bool file_synced = ::fsync(fd) == 0;
    const bool file_closed = ::close(fd) == 0;
    if (!file_synced || !file_closed || ::rename(temporary.c_str(), checkpoint_path_.c_str()) != 0) {
        if (error) *error = std::strerror(errno);
        ::unlink(temporary.c_str());
        return false;
    }
    const std::size_t slash = checkpoint_path_.find_last_of('/');
    const std::string directory = slash == std::string::npos
        ? "." : checkpoint_path_.substr(0, slash);
    const int directory_fd = ::open(directory.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (directory_fd < 0 || ::fsync(directory_fd) != 0) {
        if (directory_fd >= 0) ::close(directory_fd);
        if (error) *error = "active checkpoint directory fsync failed";
        return false;
    }
    ::close(directory_fd);
    return true;
}

bool ProgrammingRuntimeCoordinator::read_active_checkpoint(
    ActiveCheckpoint* checkpoint, std::string* error) const
{
    if (!checkpoint) return false;
    const int fd = ::open(checkpoint_path_.c_str(),
                          O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) { if (error) *error = std::strerror(errno); return false; }
    struct stat statbuf {};
    if (::fstat(fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode) ||
        static_cast<std::size_t>(statbuf.st_size) != kCheckpointSize) {
        ::close(fd);
        if (error) *error = "active checkpoint type/size invalid";
        return false;
    }
    std::array<uint8_t, kCheckpointSize> bytes{};
    std::size_t offset = 0;
    while (offset < bytes.size()) {
        const ssize_t count = ::read(fd, bytes.data() + offset, bytes.size() - offset);
        if (count <= 0) { ::close(fd); if (error) *error = "active checkpoint truncated"; return false; }
        offset += static_cast<std::size_t>(count);
    }
    uint8_t trailing = 0;
    const ssize_t extra = ::read(fd, &trailing, 1);
    ::close(fd);
    if (extra != 0 || read_u32(bytes.data()) != kCheckpointMagic ||
        read_u16(bytes.data() + 4) != kCheckpointVersion || read_u16(bytes.data() + 6) != 0 ||
        read_u32(bytes.data() + bytes.size() - 4) != crc32(bytes.data(), bytes.size() - 4)) {
        if (error) *error = "active checkpoint CRC/version/size invalid";
        return false;
    }
    checkpoint->byte_size = read_u64(bytes.data() + 8);
    checkpoint->operation_id = read_checkpoint_field(bytes.data() + kCheckpointHeaderSize);
    checkpoint->revision_id = read_checkpoint_field(bytes.data() + kCheckpointHeaderSize + kCheckpointFieldSize);
    checkpoint->artifact_sha256 = read_checkpoint_field(bytes.data() + kCheckpointHeaderSize + kCheckpointFieldSize * 2);
    checkpoint->plan_hash = read_checkpoint_field(bytes.data() + kCheckpointHeaderSize + kCheckpointFieldSize * 3);
    if (checkpoint->byte_size == 0 || !canonical_uuid(checkpoint->operation_id) ||
        !canonical_uuid(checkpoint->revision_id) ||
        !lowercase_hex_64(checkpoint->artifact_sha256) ||
        !lowercase_hex_64(checkpoint->plan_hash)) {
        if (error) *error = "active checkpoint fields invalid";
        return false;
    }
    return true;
}

bool ProgrammingRuntimeCoordinator::load_active_checkpoint(
    const ActiveCheckpoint& checkpoint, std::string* error)
{
    StageCommand command;
    command.operation_id = checkpoint.operation_id;
    command.revision_id = checkpoint.revision_id;
    command.instance_id = instance_id_;
    command.locator = staging_root_ + "/" + checkpoint.operation_id + "/candidate.mkddcir";
    command.byte_size = checkpoint.byte_size;
    command.plan_hash = checkpoint.plan_hash;
    if (!decode_hex_digest(checkpoint.artifact_sha256, &command.sha256)) return false;
    std::vector<uint8_t> bytes;
    std::string detail;
    if (!read_staged_artifact(command, &bytes, &detail, error)) return false;

    /* Khôi phục phải đi qua ĐÚNG đường tách gói như lúc stage. Nạp nguyên khối
     * `bytes` vào một instance chỉ đúng với artifact v1; với package v2 nó đưa cả
     * container cho loader IR v1 và thiết bị tỉnh dậy KHÔNG có Program nào —
     * hỏng đúng vào lúc không ai đang nhìn. */
    std::vector<PackageProgramSlice> programs;
    std::vector<StPackageSignal> signals;
    if (!split_package(bytes, instance_id_, &programs, &signals, &detail, error)) return false;
    if (!rebuild_signal_bus(signals, &detail, error)) return false;
    for (const PackageProgramSlice& program : programs)
        if (!valid_instance_id(program.instance_id)) {
            if (error) *error = "checkpoint package program name is not a valid instance id";
            return false;
        }
    std::vector<StProgramSetEntry> entries;
    entries.reserve(programs.size());
    for (std::size_t index = 0; index < programs.size(); ++index) {
        StProgramSetEntry entry;
        entry.instance_id = programs[index].instance_id;
        entry.artifact = programs[index].ir_blob;
        entry.order = static_cast<uint16_t>(index);
        entry.period_ms = programs[index].period_ms;
        entry.enabled = false; /* boot luôn fail-closed, BE replay intent sau */
        entries.push_back(std::move(entry));
    }
    StPreparedProgramSet boot_prepared;
    if (!scheduler_->prepare_program_set(kTaskId, entries, &boot_prepared, error)) {
        if (StSignalBus* bus = scheduler_->signal_bus()) bus->clear();
        return false;
    }
    for (const auto& program : boot_prepared) {
        if (program == nullptr ||
            !bind_program_signal_refs(program->pending_program.get(), program->instance_id,
                                      signals, scheduler_->signal_bus(), error)) {
            boot_prepared.clear();
            if (StSignalBus* bus = scheduler_->signal_bus()) bus->clear();
            return false;
        }
    }
    if (!scheduler_->arm_prepared_program_set(&boot_prepared, false, error) ||
        !scheduler_->swap_prepared_program_set_at_boundary(kTaskId, &boot_prepared)) {
        boot_prepared.clear();
        if (StSignalBus* bus = scheduler_->signal_bus()) bus->clear();
        return false;
    }
    /* `boot_prepared` đang giữ topology bootstrap cũ sau swap; thu hồi ngoài
     * đường scan trước khi công bố checkpoint đã khôi phục. */
    boot_prepared.clear();
    for (const PackageProgramSlice& program : programs) {
        StProgramInstance* restored = scheduler_->find_program(program.instance_id);
        if (!restored || restored->state != StProgramState::DISABLED || restored->enabled) {
            if (error) *error = "checkpoint topology không ở trạng thái Disabled fail-closed";
            return false;
        }
        /* Checkpoint chỉ chứng minh package/artifact đã COMMITTED; nó không
         * chứa `desiredEnabled`. Vì vậy boot chỉ khôi phục topology rồi giữ
         * fail-closed ở Disabled. Intent bền vững phải được BE replay bằng
         * PROGRAM_ENABLE tường minh và đọc lại, Core tuyệt đối không tự start. */
        restored->last_known_good.swap(restored->activated_artifact);
    }
    instance_ids_.clear();
    for (const PackageProgramSlice& program : programs)
        instance_ids_.push_back(program.instance_id);
    instance_id_ = instance_ids_.front();
    revision_id_ = checkpoint.revision_id;
    previous_revision_id_ = checkpoint.revision_id;
    lkg_revision_id_ = checkpoint.revision_id;
    artifact_hash_ = checkpoint.artifact_sha256;
    previous_artifact_hash_ = checkpoint.artifact_sha256;
    plan_hash_ = checkpoint.plan_hash;
    artifact_byte_size_ = checkpoint.byte_size;
    cutover_->request(CutoverMode::PROGRAM_ONLY);
    (void)cutover_->apply_pending_at_boundary();
    return true;
}

bool ProgrammingRuntimeCoordinator::ensure_instance(std::string* error)
{
    /* Đường chưa có package trong tay: chỉ bảo đảm instance tồn tại và GIỮ
     * NGUYÊN chu kỳ đang chạy. Đặt 0 ở đây sẽ âm thầm hạ mọi Program về chu kỳ
     * của Task. */
    std::vector<PackageProgramSlice> slices;
    slices.reserve(instance_ids_.size());
    for (const std::string& id : instance_ids_) {
        PackageProgramSlice slice;
        slice.instance_id = id;
        const StProgramInstance* existing = scheduler_->find_program(id);
        slice.period_ms = existing != nullptr ? existing->period_ms : 0u;
        slices.push_back(std::move(slice));
    }
    return ensure_topology(slices, error);
}

std::vector<std::string> ProgrammingRuntimeCoordinator::instance_ids() const
{
    return instance_ids_;
}

bool ProgrammingRuntimeCoordinator::ensure_topology(
    const std::vector<PackageProgramSlice>& slices, std::string* error)
{
    if (!scheduler_->find_task(kTaskId)) {
        if (error) *error = "Programming task was not prepared at bootstrap";
        return false;
    }
    if (slices.empty()) {
        if (error) *error = "package has no program instance";
        return false;
    }
    /* Thêm instance còn thiếu thay vì đòi bootstrap biết trước tên Program.
     * Tên Program là dữ liệu của PACKAGE; bắt bootstrap khai trước nghĩa là mỗi
     * lần đổi tên Program phải sửa cả tiến trình khởi động. */
    uint16_t order = 0;
    for (const PackageProgramSlice& slice : slices) {
        if (scheduler_->find_program(slice.instance_id) == nullptr &&
            !scheduler_->add_program(kTaskId, slice.instance_id, order, error))
            return false;
        /* Chu kỳ lấy từ PACKAGE, không phải từ mặc định của Task. Đặt lại mỗi
         * lần dựng topology chứ không chỉ lúc tạo mới: một package mới có thể
         * đổi chu kỳ của Program đã tồn tại, và bỏ qua nó nghĩa là thiết bị chạy
         * theo chu kỳ của gói CŨ. */
        if (StProgramInstance* program = scheduler_->find_program(slice.instance_id))
            program->period_ms = slice.period_ms;
        ++order;
    }
    return true;
}

bool ProgrammingRuntimeCoordinator::prepare_signal_replacement(
    const std::vector<StPackageSignal>& signals, bool* prepared, std::string* detail_code,
    std::string* error)
{
    if (prepared != nullptr) *prepared = false;
    StSignalBus* bus = scheduler_->signal_bus();
    if (bus == nullptr) {
        /* Không có bus mà package khai signal nghĩa là consumer sẽ đọc vào hư
         * không. Không có bus và cũng không có signal thì đúng là không có gì
         * phải làm. */
        if (signals.empty()) return true;
        if (detail_code) *detail_code = "IPC-RUNTIME-CONFIG";
        if (error) *error = "package declares signals but runtime has no signal bus";
        return false;
    }

    std::vector<StSignalDefinition> definitions;
    definitions.reserve(signals.size());
    for (const StPackageSignal& signal : signals) {
        StSignalDefinition definition;
        if (!signal_definition_from_package(signal, &definition, detail_code, error)) return false;
        definitions.push_back(std::move(definition));
    }
    if (!bus->prepare_replacement(definitions, error)) {
        if (detail_code) *detail_code = "IPC-RUNTIME-CONFIG";
        return false;
    }
    if (prepared != nullptr) *prepared = true;
    return true;
}

ProgrammingRuntimeCoordinator::CoordinatorIdentity
ProgrammingRuntimeCoordinator::capture_identity() const
{
    CoordinatorIdentity identity;
    identity.instance_id = instance_id_;
    identity.instance_ids = instance_ids_;
    identity.operation_id = operation_id_;
    identity.revision_id = revision_id_;
    identity.artifact_hash = artifact_hash_;
    identity.plan_hash = plan_hash_;
    identity.detail_code = detail_code_;
    identity.artifact_byte_size = artifact_byte_size_;
    identity.staged_restore = staged_restore_;
    return identity;
}

void ProgrammingRuntimeCoordinator::swap_live_identity(CoordinatorIdentity* identity) noexcept
{
    if (identity == nullptr) return;
    instance_id_.swap(identity->instance_id);
    instance_ids_.swap(identity->instance_ids);
    operation_id_.swap(identity->operation_id);
    revision_id_.swap(identity->revision_id);
    artifact_hash_.swap(identity->artifact_hash);
    plan_hash_.swap(identity->plan_hash);
    detail_code_.swap(identity->detail_code);
    std::swap(artifact_byte_size_, identity->artifact_byte_size);
    std::swap(staged_restore_, identity->staged_restore);
}

bool ProgrammingRuntimeCoordinator::split_package(
    const std::vector<uint8_t>& bytes, const std::string& fallback_instance,
    std::vector<PackageProgramSlice>* out, std::vector<StPackageSignal>* signals_out,
    std::string* detail_code, std::string* error) const
{
    out->clear();
    if (signals_out != nullptr) signals_out->clear();
    bool is_v2 = false;
    const char* probe_error = nullptr;
    if (!ProbePackageFormat(bytes.data(), bytes.size(), &is_v2, &probe_error)) {
        if (detail_code) *detail_code = probe_error != nullptr ? probe_error : "PKG-E-001";
        if (error) *error = "artifact format is neither v1 nor package v2";
        return false;
    }
    if (!is_v2) {
        /* Artifact v1 mô tả ĐÚNG một Program; dual-reader DDD §12.1 buộc đường
         * này còn sống, nếu không một lần nâng cấp là mất bản LKG cuối cùng. */
        PackageProgramSlice slice;
        slice.instance_id = fallback_instance;
        slice.ir_blob = bytes;
        out->push_back(std::move(slice));
        return true;
    }
    StPackageContents contents;
    const char* load_error = nullptr;
    if (!UnpackPackageV2(bytes.data(), bytes.size(), st_profile_generated::kProfileCode,
                         st_profile_generated::kTargetAbi, &contents, &load_error)) {
        if (detail_code) *detail_code = load_error != nullptr ? load_error : "PKG-E-001";
        /* `ISS-STED-19` — "package v2 rejected by loader" là một câu KHÔNG nói
         * gì: nó không cho biết gói lệch ở đâu, cũng không cho biết bên nào là
         * bên cũ. Một artifact sai `targetAbi` bị từ chối đúng, nhưng người vận
         * hành chỉ đọc được "bị từ chối" thì vẫn không biết phải làm gì tiếp.
         * `DescribePackageRejection` nêu CẢ HAI phía; LKG không đổi vì đường
         * này trả false trước mọi thay đổi trạng thái. */
        if (error) *error = DescribePackageRejection(bytes.data(), bytes.size(),
                                                     st_profile_generated::kProfileCode,
                                                     st_profile_generated::kTargetAbi, load_error);
        return false;
    }
    if (signals_out != nullptr) signals_out->assign(contents.signals.begin(), contents.signals.end());
    for (std::size_t index = 0; index < contents.view.program_names.size(); ++index) {
        PackageProgramSlice slice;
        slice.instance_id = contents.view.program_names[index];
        slice.ir_blob = contents.program_ir[index];
        slice.period_ms = contents.view.program_periods_ms[index];
        out->push_back(std::move(slice));
    }
    return true;
}

bool ProgrammingRuntimeCoordinator::signal_definition_from_package(
    const StPackageSignal& signal, StSignalDefinition* out, std::string* detail_code,
    std::string* error)
{
    StSignalDefinition definition;
    definition.name = signal.name;
    definition.publisher_program = signal.producer_program;
    definition.type = static_cast<StType>(signal.data_type);
    definition.freshness_ms = signal.freshness_ms;
    switch (signal.stale_policy) {
    case 0: definition.stale_policy = StStalePolicy::HOLD_LAST; break;
    case 1: definition.stale_policy = StStalePolicy::USE_FALLBACK; break;
    case 2: definition.stale_policy = StStalePolicy::WAIT; break;
    default:
        if (detail_code) *detail_code = "IPC-RUNTIME-CONFIG";
        if (error) *error = "signal '" + signal.name + "' có chính sách stale không hợp lệ";
        return false;
    }
    definition.has_fallback = signal.has_fallback;
    if (signal.has_fallback)
        std::memcpy(&definition.fallback, &signal.fallback_bits, sizeof(definition.fallback));
    *out = std::move(definition);
    return true;
}

/* CHỈ dùng ở đường boot/recovery (`load_active_checkpoint`), nơi chưa có Program
 * nào chạy nên không có live state để bảo vệ. Đường Commission đi qua
 * `prepare_signal_replacement()` — xem F-P59-ATOMIC-001. */
bool ProgrammingRuntimeCoordinator::rebuild_signal_bus(
    const std::vector<StPackageSignal>& signals, std::string* detail_code, std::string* error)
{
    StSignalBus* bus = scheduler_->signal_bus();
    if (bus == nullptr) {
        /* Không có bus mà package khai signal nghĩa là consumer sẽ đọc vào hư
         * không. Không có bus và cũng không có signal thì đúng là không có gì
         * phải làm. */
        if (signals.empty()) return true;
        if (detail_code) *detail_code = "IPC-RUNTIME-CONFIG";
        if (error) *error = "package declares signals but runtime has no signal bus";
        return false;
    }
    /* Dựng LẠI từ đầu: giữ khai báo của gói cũ nghĩa là chạy gói mới với hợp
     * đồng gói cũ, và sai lệch đó không lộ ra cho tới khi ai đó đọc một signal
     * đã bị gói mới bỏ đi. */
    bus->clear();
    for (const StPackageSignal& signal : signals) {
        StSignalDefinition definition;
        if (!signal_definition_from_package(signal, &definition, detail_code, error)) {
            bus->clear();
            return false;
        }
        std::string declare_error;
        if (!bus->declare(definition, &declare_error)) {
            if (detail_code) *detail_code = "IPC-RUNTIME-CONFIG";
            if (error) *error = declare_error;
            /* Gói hỏng để lại 0 mutation, kể cả ở bus: một bus dựng dở là một
             * tập hợp đồng chưa từng được Check. */
            bus->clear();
            return false;
        }
    }
    return true;
}

bool ProgrammingRuntimeCoordinator::read_staged_artifact(
    const StageCommand& command, std::vector<uint8_t>* bytes, std::string* detail_code,
    std::string* error) const
{
    if (!bytes || command.locator.size() > 512 || command.byte_size == 0 ||
        command.byte_size > st_ir::kMaxArtifactSize ||
        command.sha256.size() != crypto_hash_sha256_BYTES ||
        !path_within(staging_root_, command.locator)) {
        if (detail_code) *detail_code = "IPC-STAGING-LOCATOR";
        if (error) *error = "artifact locator/size/hash invalid";
        return false;
    }
    const int fd = open_regular_beneath(staging_root_, command.locator);
    if (fd < 0) {
        if (detail_code) *detail_code = "IPC-STAGING-OPEN";
        if (error) *error = std::strerror(errno);
        return false;
    }
    struct stat statbuf {};
    if (::fstat(fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode) ||
        static_cast<uint64_t>(statbuf.st_size) != command.byte_size) {
        ::close(fd);
        if (detail_code) *detail_code = "IPC-STAGING-TYPE-SIZE";
        if (error) *error = "staging file is not regular or size mismatches";
        return false;
    }
    bytes->assign(static_cast<std::size_t>(command.byte_size), 0);
    std::size_t offset = 0;
    while (offset < bytes->size()) {
        const ssize_t count = ::read(fd, bytes->data() + offset, bytes->size() - offset);
        if (count <= 0) { ::close(fd); bytes->clear(); return false; }
        offset += static_cast<std::size_t>(count);
    }
    ::close(fd);
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(), bytes->data(), bytes->size());
    if (sodium_memcmp(digest.data(), command.sha256.data(), digest.size()) != 0) {
        bytes->clear();
        if (detail_code) *detail_code = "IPC-STAGING-HASH";
        if (error) *error = "staging SHA-256 mismatch";
        return false;
    }
    return true;
}

bool ProgrammingRuntimeCoordinator::stage_impl(const StageCommand& command, bool restore,
                                                std::string* detail_code, std::string* error)
{
    const LifecycleState current = state_.load(std::memory_order_acquire);
    if (current == LifecycleState::RECOVERY_REQUIRED) {
        if (detail_code) *detail_code = "IPC-RECOVERY-REQUIRED";
        if (error) *error = "journal recovery incident must be resolved before mutation";
        return false;
    }
    if (current != LifecycleState::IDLE && current != LifecycleState::COMMITTED &&
        current != LifecycleState::FAILED && current != LifecycleState::ROLLED_BACK) {
        if (detail_code) *detail_code = "IPC-OPERATION-BUSY";
        if (error) *error = "another lifecycle operation is active";
        return false;
    }
    /* T59-401: `instance_id` không còn bị khoá ở "program-main". Tên instance là
     * dữ liệu của package; khoá cứng một tên nghĩa là chỉ nạp được đúng một
     * Program mãi mãi. Vẫn ép định dạng để tên rác không đi vào scheduler. */
    if (!canonical_uuid(command.operation_id) || !canonical_uuid(command.revision_id) ||
        !valid_instance_id(command.instance_id) || !lowercase_hex_64(command.plan_hash)) {
        if (detail_code) *detail_code = "IPC-PAYLOAD";
        if (error) *error = "operation/revision/instance/plan identity invalid";
        return false;
    }
    std::vector<uint8_t> bytes;
    if (!read_staged_artifact(command, &bytes, detail_code, error)) return false;

    std::vector<PackageProgramSlice> programs;
    std::vector<StPackageSignal> signals;
    if (!split_package(bytes, command.instance_id, &programs, &signals, detail_code, error))
        return false;

    /* Mỗi giao dịch trước đã ở một state ổn định. Thu hồi shadow/ảnh
     * rollback của nó ở luồng non-RT trước khi dựng giao dịch kế tiếp;
     * không phần tử nào trong hai vector này còn thuộc topology live. */
    prepared_program_set_.clear();
    previous_program_set_.clear();
    previous_program_set_valid_ = false;
    prepared_identity_valid_ = false;
    prepared_identity_ = CoordinatorIdentity{};
    transaction_identity_ = CoordinatorIdentity{};
    previous_identity_ = CoordinatorIdentity{};
    signal_replacement_prepared_ = false;
    signal_replacement_active_ = false;
    if (StSignalBus* bus = scheduler_->signal_bus()) bus->discard_prepared_replacement();

    std::vector<StProgramSetEntry> entries;
    entries.reserve(programs.size());
    CoordinatorIdentity candidate;
    candidate.instance_ids.reserve(programs.size());
    for (std::size_t index = 0; index < programs.size(); ++index) {
        const PackageProgramSlice& program = programs[index];
        if (!valid_instance_id(program.instance_id)) {
            if (detail_code) *detail_code = "IPC-PAYLOAD";
            if (error) *error = "package program name is not a valid instance id";
            return false;
        }
        StProgramSetEntry entry;
        entry.instance_id = program.instance_id;
        entry.artifact = program.ir_blob;
        entry.order = static_cast<uint16_t>(index);
        entry.period_ms = program.period_ms;
        /* Giữ enable intent của Program cùng identity qua Revision. Program
         * mới luôn fail-closed ở Disabled: package v2 KHÔNG mang
         * `desiredEnabled` (T59-305 — gói không được tự bật chính nó), nên tự bật
         * nó vừa trái T59-305/405 vừa làm một gói 32 Program mới tự đụng trần 16
         * Enabled trước khi operator ra lệnh PROGRAM_ENABLE.
         *
         * Đây chỉ là giá trị NỀN. ADR-062: nếu ACTIVATE mang intent ĐÃ LƯU của
         * người vận hành thì `apply_activation_intents()` sửa lại cờ này trên
         * shadow trước arm, để Program có intent Enable chạy ngay tại boundary
         * kích hoạt thay vì chờ `SET_PROGRAM_ENABLED` sau boundary (F13). */
        const StProgramInstance* live = scheduler_->find_program(program.instance_id);
        entry.enabled = live != nullptr && live->enabled;
        entries.push_back(std::move(entry));
        candidate.instance_ids.push_back(program.instance_id);
    }

    /* `prepare_program_set` dựng TOÀN BỘ topology/IR/RETAIN trong shadow.
     * Nó không tra `find_program` để nạp đè instance live, do đó package có
     * thể thêm, bớt và đổi thứ tự mà `stage()` vẫn zero-mutation. */
    if (!scheduler_->prepare_program_set(kTaskId, entries, &prepared_program_set_, error)) {
        if (detail_code) *detail_code = "IPC-STAGE-REJECTED";
        return false;
    }
    bool signal_prepared = false;
    if (!prepare_signal_replacement(signals, &signal_prepared, detail_code, error)) {
        prepared_program_set_.clear();
        return false;
    }
    for (const auto& program : prepared_program_set_) {
        if (program == nullptr ||
            !bind_program_signal_refs(program->pending_program.get(),
                                      program->instance_id, signals,
                                      scheduler_->signal_bus(), error)) {
            prepared_program_set_.clear();
            if (signal_prepared && scheduler_->signal_bus() != nullptr)
                scheduler_->signal_bus()->discard_prepared_replacement();
            if (detail_code) *detail_code = "IPC-RUNTIME-CONFIG";
            return false;
        }
    }

    previous_identity_ = capture_identity();
    candidate.instance_id = candidate.instance_ids.front();
    candidate.operation_id = command.operation_id;
    candidate.revision_id = command.revision_id;
    candidate.artifact_hash = hex_digest(command.sha256.data(), command.sha256.size());
    candidate.plan_hash = command.plan_hash;
    candidate.artifact_byte_size = command.byte_size;
    candidate.staged_restore = restore;
    /* Một bản giữ nguyên transaction để STATUS báo đúng candidate sau rollback;
     * bản còn lại là carrier được swap O(1) với identity live ở boundary. Cả
     * hai bản được dựng ở luồng IPC/non-RT. */
    transaction_identity_ = candidate;
    prepared_identity_ = std::move(candidate);
    prepared_identity_valid_ = true;
    signal_replacement_prepared_ = signal_prepared;

    /* PREPARED là điểm bền vững đầu tiên. Tới khi append+fsync thành
     * công, danh tính live, topology, signal và candidate registry vẫn nguyên. */
    if (!append_phase(StJournalPhase::PREPARED, transaction_identity_, error)) {
        prepared_program_set_.clear();
        if (signal_replacement_prepared_ && scheduler_->signal_bus() != nullptr)
            scheduler_->signal_bus()->discard_prepared_replacement();
        signal_replacement_prepared_ = false;
        prepared_identity_valid_ = false;
        if (detail_code) *detail_code = "IPC-JOURNAL-FSYNC";
        return false;
    }
    boundary_applied_.store(false, std::memory_order_relaxed);
    first_output_committed_.store(false, std::memory_order_relaxed);
    boundary_journaled_.store(false, std::memory_order_relaxed);
    first_cycle_journaled_.store(false, std::memory_order_relaxed);
    state_.store(LifecycleState::STAGED, std::memory_order_release);
    return true;
}

bool ProgrammingRuntimeCoordinator::stage(const StageCommand& command,
                                           std::string* detail_code, std::string* error)
{
    return stage_impl(command, false, detail_code, error);
}

bool ProgrammingRuntimeCoordinator::restore(const StageCommand& command,
                                             std::string* detail_code, std::string* error)
{
    return stage_impl(command, true, detail_code, error);
}

bool ProgrammingRuntimeCoordinator::activate(const ActivateCommand& command,
                                              std::string* detail_code, std::string* error)
{
    if (!canonical_uuid(command.operation_id) ||
        (!command.expected_active_revision_id.empty() &&
         !canonical_uuid(command.expected_active_revision_id)) ||
        command.staged_token != command.operation_id || !lowercase_hex_64(command.plan_hash)) {
        if (detail_code) *detail_code = "IPC-PAYLOAD";
        if (error) *error = "activate identity/token/plan invalid";
        return false;
    }
    if (state_.load(std::memory_order_acquire) != LifecycleState::STAGED ||
        !prepared_identity_valid_ ||
        command.operation_id != transaction_identity_.operation_id ||
        command.staged_token != transaction_identity_.operation_id ||
        command.plan_hash != transaction_identity_.plan_hash) {
        if (detail_code) *detail_code = "IPC-STAGED-TOKEN";
        if (error) *error = "staged operation/token/plan does not match";
        return false;
    }
    if (command.expected_active_revision_id != previous_revision_id_) {
        if (detail_code) *detail_code = "IPC-EXPECTED-ACTIVE";
        if (error) *error = "expected active revision mismatch";
        return false;
    }
    /* ADR-062 — kiểm `programIntents` TRƯỚC mọi thay đổi trạng thái, cùng lớp lỗi
     * với identity sai ở trên. Id trùng là mâu thuẫn không có cách hiểu đúng (hai
     * giá trị khác nhau thì chọn cái nào?), nên từ chối chứ không tự chọn. */
    if (command.has_program_intents) {
        bool intents_valid = command.program_intents.size() <= kMaxActivateProgramIntents;
        for (std::size_t index = 0; intents_valid && index < command.program_intents.size();
             ++index) {
            const std::string& id = command.program_intents[index].instance_id;
            if (!valid_instance_id(id)) intents_valid = false;
            for (std::size_t prior = 0; intents_valid && prior < index; ++prior)
                if (command.program_intents[prior].instance_id == id) intents_valid = false;
        }
        if (!intents_valid) {
            if (detail_code) *detail_code = "IPC-PAYLOAD";
            if (error) *error = "activate programIntents invalid (count/id/duplicate)";
            return false;
        }
    }
    if (!append_phase(StJournalPhase::COMMIT_INTENT, transaction_identity_, error)) {
        if (detail_code) *detail_code = "IPC-JOURNAL-FSYNC";
        return false;
    }
    /* ADR-062 — áp intent SAU khi COMMIT_INTENT đã bền vững: nếu fsync hỏng,
     * ACTIVATE được gọi lại và shadow chưa bị đụng. Và TRƯỚC arm: sau arm, RT có
     * thể swap shadow ở bất kỳ boundary nào. `arm_prepared_program_set` vẫn đếm
     * lại trần Enabled như một lớp chặn thứ hai. */
    last_activate_intents_ = ActivateIntentSummary{};
    if (command.has_program_intents) {
        last_activate_intents_ = apply_activation_intents(command.program_intents);
        std::fprintf(stderr,
                     "INFO  programming.activate_intents operation=%s received=%zu enabled=%zu"
                     " disabled=%zu dropped_limit=%zu ignored=%zu\n",
                     command.operation_id.c_str(), command.program_intents.size(),
                     last_activate_intents_.enabled, last_activate_intents_.disabled,
                     last_activate_intents_.dropped_limit, last_activate_intents_.ignored);
    }
    /* Arm là thao tác cấp GÓI và chỉ xảy ra SAU COMMIT_INTENT bền
     * vững. API preflight toàn bộ shadow trước khi đặt bất kỳ cờ nào,
     * nên không có prefix package đã arm. */
    if (!scheduler_->arm_prepared_program_set(&prepared_program_set_,
                                               transaction_identity_.staged_restore, error)) {
        if (signal_replacement_prepared_ && scheduler_->signal_bus() != nullptr)
            scheduler_->signal_bus()->discard_prepared_replacement();
        signal_replacement_prepared_ = false;
        prepared_program_set_.clear();
        state_.store(LifecycleState::FAILED, std::memory_order_release);
        if (detail_code) *detail_code = "IPC-ACTIVATE-ARM";
        return false;
    }
    cutover_->request(command.cutover);
    state_.store(LifecycleState::COMMIT_INTENT, std::memory_order_release);
    return true;
}

ActivateIntentSummary ProgrammingRuntimeCoordinator::apply_activation_intents(
    const std::vector<ActivateProgramIntent>& intents)
{
    ActivateIntentSummary summary;
    auto find_intent = [&](const std::string& instance_id) -> const ActivateProgramIntent* {
        for (const ActivateProgramIntent& intent : intents)
            if (intent.instance_id == instance_id) return &intent;
        return nullptr;
    };

    /* Bước 1 — intent Disable trước. Đây là hướng fail-closed: nó không bao giờ
     * cần trần, và làm trước thì chỗ nó nhả ra được tính cho intent Enable ở
     * bước 2 thay vì bị một Program sắp tắt chiếm mất. */
    for (const auto& program : prepared_program_set_) {
        const ActivateProgramIntent* intent = find_intent(program->instance_id);
        if (intent == nullptr || intent->enabled || !program->enabled) continue;
        program->enabled = false;
        ++summary.disabled;
    }

    /* Bước 2 — intent Enable theo THỨ TỰ GÓI, trong trần của profile. Thứ tự gói
     * (sắp theo `objectId` ở Check) là tất định; thứ tự danh sách web gửi thì
     * không phải thứ Core nên tin. Vượt trần thì giữ Disabled và nói ra, KHÔNG
     * từ chối kích hoạt: từ chối ở đây là chặn cả một Restore vì một con số mà
     * vòng reconcile vẫn báo được về sau (`REJECTED_LIMIT`). */
    std::size_t enabled_count = 0;
    for (const auto& program : prepared_program_set_)
        if (program->enabled) ++enabled_count;
    const std::size_t max_enabled = scheduler_->max_enabled_programs();
    for (const auto& program : prepared_program_set_) {
        const ActivateProgramIntent* intent = find_intent(program->instance_id);
        if (intent == nullptr || !intent->enabled || program->enabled) continue;
        if (enabled_count >= max_enabled) {
            ++summary.dropped_limit;
            std::fprintf(stderr,
                         "WARN  programming.activate_intent_limit instance=%s limit=%zu"
                         " (giữ Disabled, không chặn kích hoạt)\n",
                         program->instance_id.c_str(), max_enabled);
            continue;
        }
        program->enabled = true;
        ++enabled_count;
        ++summary.enabled;
    }

    /* Intent cho instance không có trong gói: Program đã rời gói (F07). Bỏ qua,
     * vì intent vẫn còn nguyên ở store web và sẽ dùng lại khi Program quay về. */
    for (const ActivateProgramIntent& intent : intents) {
        bool in_package = false;
        for (const auto& program : prepared_program_set_)
            if (program->instance_id == intent.instance_id) in_package = true;
        if (!in_package) ++summary.ignored;
    }
    return summary;
}

ProgramEnableOutcome ProgrammingRuntimeCoordinator::set_program_enabled(
    const ProgramEnableCommand& command, std::string* detail_code, std::string* error)
{
    if (!canonical_uuid(command.operation_id) || !valid_instance_id(command.instance_id)) {
        if (detail_code) *detail_code = "IPC-PAYLOAD";
        if (error) *error = "operation/instance identity invalid";
        return ProgramEnableOutcome::REJECTED;
    }
    /* F-P59-ENABLE-BOUNDARY-001 — KHÔNG gọi `scheduler_->start/stop/enable/
     * disable` ở đây. Hàm này chạy trên IPC worker thread trong khi scan loop
     * RT đang tick cùng scheduler; bản trước ghi thẳng `state`/`enabled` từ
     * luồng này và `-fsanitize=thread` đo ra ba data race thật
     * (`stop`/`disable` ↔ `run_task`, vòng đếm trần 16 của `start` ↔
     * `run_program`). Chỉ ARM ý định; RT áp dụng tại safe boundary. */
    StProgramInstance* program = nullptr;
    uint64_t ack_baseline = 0;
    switch (scheduler_->request_program_enabled(command.instance_id, command.enabled, &program,
                                                &ack_baseline, error)) {
    case StScheduler::StEnableRequestOutcome::UNKNOWN_INSTANCE:
        if (detail_code) *detail_code = "IPC-UNKNOWN-INSTANCE";
        return ProgramEnableOutcome::REJECTED;
    case StScheduler::StEnableRequestOutcome::ALREADY_PENDING:
        /* Lượt trước chưa qua boundary. Idempotency của BE cho phép gọi lại;
         * trả BUSY để không ghi đè một lệnh đang chờ. */
        if (detail_code) *detail_code = "IPC-OPERATION-BUSY";
        return ProgramEnableOutcome::TIMED_OUT;
    case StScheduler::StEnableRequestOutcome::ARMED:
        break;
    }

    /* Bounded poll trên IPC WORKER thread (non-RT), không chặn RT. Cùng đánh
     * đổi và cùng mốc thời gian với `reset_retain()`: endpoint IPC là một
     * `poll()` loop ĐƠN LUỒNG nên chờ ở đây chiếm dụng cả endpoint, và mốc
     * 1500 ms là "một base step 1 s của Rev A + biên", không phải số tuỳ ý.
     * Enable/Disable là hành động vận hành hiếm, chấp nhận được; nếu về sau
     * base step dài hơn nhiều hoặc endpoint thành đa luồng thì nâng lên async
     * reconcile như Stage/Activate thay vì kéo dài mốc này. */
    constexpr int kPollIntervalMs = 20;
    constexpr int kMaxWaitMs = 1500;
    int waited_ms = 0;
    while (program->enable_ack_generation.load(std::memory_order_acquire) == ack_baseline) {
        if (waited_ms >= kMaxWaitMs) {
            /* KHÔNG rút lại cờ pending: RT có thể đang ở giữa lượt tiêu thụ.
             * Yêu cầu sẽ áp dụng ở boundary kế tiếp và BE đối chiếu lại bằng
             * lần đọc trạng thái sau — đoán rằng lệnh đã hỏng mới là thứ làm
             * người vận hành tin sai. */
            if (detail_code) *detail_code = "IPC-OPERATION-BUSY";
            if (error) *error = "timed out waiting for safe boundary to apply enable intent";
            return ProgramEnableOutcome::TIMED_OUT;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(kPollIntervalMs));
        waited_ms += kPollIntervalMs;
    }

    const auto result =
        static_cast<StEnableAckResult>(program->enable_ack_result.load(std::memory_order_relaxed));
    const auto state_at_request =
        static_cast<StProgramState>(program->enable_ack_state.load(std::memory_order_relaxed));
    switch (result) {
    case StEnableAckResult::APPLIED:
        return ProgramEnableOutcome::APPLIED;
    case StEnableAckResult::REJECTED_LIMIT:
        if (detail_code) *detail_code = "IPC-RUNTIME-STATE";
        if (error)
            *error = "too many running programs (limit " +
                     std::to_string(scheduler_->max_enabled_programs()) + ")";
        return ProgramEnableOutcome::REJECTED;
    case StEnableAckResult::REJECTED_STATE:
    case StEnableAckResult::NONE:
        break;
    }
    if (detail_code) *detail_code = "IPC-RUNTIME-STATE";
    if (error)
        *error = std::string("cannot enable from state ") + st_program_state_name(state_at_request);
    return ProgramEnableOutcome::REJECTED;
}

RetainResetOutcome ProgrammingRuntimeCoordinator::reset_retain(
    const RetainResetCommand& command, std::string* detail_code, std::string* error)
{
    if (!canonical_uuid(command.operation_id) ||
        (!command.expected_active_revision_id.empty() &&
         !canonical_uuid(command.expected_active_revision_id))) {
        if (detail_code) *detail_code = "IPC-PAYLOAD";
        if (error) *error = "retain reset identity invalid";
        return RetainResetOutcome::REJECTED;
    }
    /* Chỉ cho reset khi instance đang ở trạng thái ổn định — không giữa một
     * lượt Commission dở dang (STAGED/COMMIT_INTENT/ACTIVE_CANDIDATE/
     * FIRST_CYCLE_OK/ROLLING_BACK): trộn hai luồng non-RT cùng lúc vào
     * scheduler dễ tạo race giữa activation pending và retain-reset pending
     * trên cùng StProgramInstance. */
    if (state_.load(std::memory_order_acquire) != LifecycleState::COMMITTED) {
        if (detail_code) *detail_code = "IPC-RETAIN-RESET-STATE";
        if (error) *error = "instance is not in a stable COMMITTED state";
        return RetainResetOutcome::REJECTED;
    }
    if (command.expected_active_revision_id != previous_revision_id_) {
        if (detail_code) *detail_code = "IPC-EXPECTED-ACTIVE";
        if (error) *error = "expected active revision mismatch";
        return RetainResetOutcome::REJECTED;
    }
    StProgramInstance* instance = scheduler_->find_program(command.instance_id);
    if (!instance) {
        if (detail_code) *detail_code = "IPC-RETAIN-RESET-INSTANCE";
        if (error) *error = "unknown instance";
        return RetainResetOutcome::REJECTED;
    }
    const uint64_t baseline_ack =
        instance->retain_reset_ack_generation.load(std::memory_order_acquire);
    if (!scheduler_->request_retain_reset(command.instance_id, error)) {
        if (detail_code) *detail_code = "IPC-RETAIN-RESET-ARM";
        return RetainResetOutcome::REJECTED;
    }
    /* Chờ boundary áp dụng — bounded poll trên IPC WORKER thread (non-RT),
     * không chặn scan RT (scan chỉ chạm cờ atomic, không chờ ai). QUAN
     * TRỌNG: `ProgramIpcUnixEndpoint::run()` là một `poll()`/`accept4()`
     * loop ĐƠN LUỒNG (`apps/core/adapters/ipc/program_ipc_unix.cpp`) — chờ
     * ở đây thật sự CHIẾM DỤNG toàn bộ IPC endpoint (mọi Status/Check khác
     * cũng phải đợi), không chỉ request này. Giữ mốc timeout NGẮN có chủ
     * đích (~1 chu kỳ scan mặc định 1000ms + biên độ), không phải giá trị
     * tuỳ tiện: đây là đánh đổi Rev A chấp nhận được cho một hành động admin
     * hiếm khi gọi, KHÔNG áp dụng nếu action nào khác gọi thường xuyên hơn.
     * Timeout ở đây không phải lỗi — trả `TIMED_OUT` riêng, Go BE có thể gọi
     * lại (idempotent, `router.go` đã khai `idempotencyRequired`) thay vì
     * cần một async reconcile state machine mới. Nếu tương lai instance có
     * thể nằm trên Task chu kỳ rất dài (30s theo `taskPeriodsMs`
     * capability) hoặc endpoint IPC trở thành đa luồng, nâng cấp lên async
     * reconcile giống Stage/Activate (design §9) thay vì kéo dài mốc này. */
    constexpr int kPollIntervalMs = 20;
    constexpr int kMaxWaitMs = 1500;
    int waited_ms = 0;
    while (instance->retain_reset_ack_generation.load(std::memory_order_acquire) == baseline_ack) {
        if (waited_ms >= kMaxWaitMs) {
            if (detail_code) *detail_code = "IPC-RETAIN-RESET-TIMEOUT";
            if (error) *error = "timed out waiting for safe boundary to apply retain reset";
            return RetainResetOutcome::TIMED_OUT;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(kPollIntervalMs));
        waited_ms += kPollIntervalMs;
    }
    /* Force-flush bỏ qua cửa sổ autosave 60s (`StRetainStore::save_snapshot_if_needed`)
     * — tái dùng đúng API đã có cho shutdown (`main.cpp` gọi
     * `shutdown_and_flush()`), không viết cơ chế mới. */
    if (StRetainService* retain_service = scheduler_->retain_service(); retain_service != nullptr) {
        retain_service->flush(true);
    }
    return RetainResetOutcome::APPLIED;
}

void ProgrammingRuntimeCoordinator::capture_priority_overrides(
    const PriorityResolver& resolver) noexcept
{
    static_assert(KX_N_AO * 3 <= 64, "AO override snapshot vượt uint64_t");
    static_assert(KX_N_DO * 3 <= 64, "DO override snapshot vượt uint64_t");
    uint64_t analog = 0;
    uint64_t digital = 0;
    for (int channel = 0; channel < KX_N_AO; ++channel) {
        const int level = resolver.winning_ao_level(channel);
        if (level >= PRIO_FIRE_SAFETY && level < PRIO_LOCAL_LOGIC)
            analog |= static_cast<uint64_t>(level) << (channel * 3);
    }
    for (int channel = 0; channel < KX_N_DO; ++channel) {
        const int level = resolver.winning_do_level(channel);
        if (level >= PRIO_FIRE_SAFETY && level < PRIO_LOCAL_LOGIC)
            digital |= static_cast<uint64_t>(level) << (channel * 3);
    }
    ao_override_levels_.store(analog, std::memory_order_release);
    do_override_levels_.store(digital, std::memory_order_release);
    impact_snapshot_valid_.store(true, std::memory_order_release);
}

void ProgrammingRuntimeCoordinator::on_safe_boundary() noexcept
{
    /* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §1/§3). KHÔNG gated
     * theo LifecycleState như activation — reset phải áp dụng được ở trạng
     * thái ổn định COMMITTED (khi Program đang chạy bình thường), không chỉ
     * trong lúc đang commission. Vô hại khi không có yêu cầu đang chờ (no-op
     * per-instance, xem `StScheduler::apply_pending_retain_resets`). */
    scheduler_->apply_pending_retain_resets_at_boundary();
    /* F-P59-ENABLE-BOUNDARY-001: ý định Enable/Disable của người vận hành áp
     * dụng ở CÙNG boundary, trước khi tick kế tiếp dispatch — một Program vừa
     * bị Disable không được chạy thêm chu kỳ nào với quyền ghi đầu ra. Cũng
     * KHÔNG gated theo LifecycleState: Enable/Disable là lệnh vận hành ở trạng
     * thái ổn định, không phải một pha của Commission. */
    scheduler_->apply_pending_enable_requests_at_boundary();

    const LifecycleState current = state_.load(std::memory_order_acquire);
    if (current == LifecycleState::ROLLING_BACK) {
        const bool topology_restored = previous_program_set_valid_ &&
            scheduler_->restore_program_set_at_boundary(kTaskId, &previous_program_set_);
        bool signal_restored = !signal_replacement_active_;
        if (signal_replacement_active_) {
            if (StSignalBus* bus = scheduler_->signal_bus())
                signal_restored = bus->rollback_replacement_at_boundary();
            else
                signal_restored = false;
        }
        signal_replacement_active_ = !signal_restored;
        /* Chỉ khi CẢ topology và signal đã trở về mới được công bố
         * graph owner. Hai swap nằm trong cùng safe boundary; không Program
         * hay consumer nào chạy xen giữa. */
        cutover_->request(CutoverMode::GRAPH_ONLY);
        (void)cutover_->apply_pending_at_boundary();
        if (topology_restored && signal_restored) {
            if (candidates_ != nullptr) {
                for (const std::string& id : instance_ids_)
                    candidates_->withdraw_instance(id,
                                                   CandidateWithdrawReason::PACKAGE_REPLACED,
                                                   scheduler_->base_step_count());
                candidates_->clear();
            }
            swap_live_identity(&previous_identity_);
            previous_program_set_valid_ = false;
            state_.store(LifecycleState::ROLLED_BACK, std::memory_order_release);
        } else {
            state_.store(LifecycleState::FAILED, std::memory_order_release);
        }
        return;
    }
    if (current == LifecycleState::IDLE || current == LifecycleState::FAILED ||
        current == LifecycleState::RECOVERY_REQUIRED) {
        (void)cutover_->apply_pending_at_boundary();
        return;
    }
    if (current != LifecycleState::COMMIT_INTENT) return;
    if (!prepared_identity_valid_ ||
        !scheduler_->swap_prepared_program_set_at_boundary(kTaskId,
                                                            &prepared_program_set_)) {
        if (signal_replacement_prepared_ && scheduler_->signal_bus() != nullptr)
            scheduler_->signal_bus()->discard_prepared_replacement();
        signal_replacement_prepared_ = false;
        cutover_->request(CutoverMode::GRAPH_ONLY);
        (void)cutover_->apply_pending_at_boundary();
        state_.store(LifecycleState::FAILED, std::memory_order_release);
        return;
    }
    /* Sau swap, `prepared_program_set_` chứa topology cũ. Chuyển ownership
     * sang slot rollback bằng vector swap O(1), không huỷ object trong RT. */
    previous_program_set_.swap(prepared_program_set_);
    previous_program_set_valid_ = true;

    bool signal_swapped = !signal_replacement_prepared_;
    if (signal_replacement_prepared_) {
        if (StSignalBus* bus = scheduler_->signal_bus())
            signal_swapped = bus->activate_prepared_replacement_at_boundary();
        signal_replacement_prepared_ = false;
    }
    if (!signal_swapped) {
        /* Trường hợp phòng thủ: topology đã swap nhưng signal không thể
         * swap. Trả topology ngay trong CÙNG boundary trước khi consumer chạy. */
        (void)scheduler_->restore_program_set_at_boundary(kTaskId, &previous_program_set_);
        previous_program_set_valid_ = false;
        cutover_->request(CutoverMode::GRAPH_ONLY);
        (void)cutover_->apply_pending_at_boundary();
        state_.store(LifecycleState::FAILED, std::memory_order_release);
        return;
    }
    signal_replacement_active_ = scheduler_->signal_bus() != nullptr;

    /* Danh tính và sổ candidate chỉ đổi sau khi CẢ topology lẫn
     * signal đã handoff. Stage/PREPARED/arm không động tới chúng. */
    swap_live_identity(&prepared_identity_);
    if (candidates_ != nullptr) {
        for (const std::string& id : previous_identity_.instance_ids)
            candidates_->withdraw_instance(id, CandidateWithdrawReason::PACKAGE_REPLACED,
                                           scheduler_->base_step_count());
        candidates_->clear();
    }
    (void)cutover_->apply_pending_at_boundary();
    boundary_applied_.store(true, std::memory_order_release);
    state_.store(LifecycleState::ACTIVE_CANDIDATE, std::memory_order_release);
}

ProgrammingRuntimeCoordinator::PackageCycleVerdict
ProgrammingRuntimeCoordinator::package_first_cycle_verdict(bool committed) const
{
    bool all_committed = true;
    bool saw_instance = false;
    for (const std::string& id : instance_ids_) {
        const StProgramInstance* instance = scheduler_->find_program(id);
        if (instance == nullptr) return PackageCycleVerdict::FAILED;
        saw_instance = true;
        /* Program không chạy KHÔNG tham gia barrier: nó không sinh output, nên
         * đòi nó "chạy sạch một chu kỳ" là đòi một điều không thể xảy ra và sẽ
         * treo barrier vĩnh viễn. Nhưng FAULTED thì có tham gia — đó là hỏng,
         * không phải vắng mặt. */
        if (instance->state == StProgramState::FAULTED) return PackageCycleVerdict::FAILED;
        if (instance->state == StProgramState::DISABLED) continue;
        if (instance->state == StProgramState::WAITING) {
            all_committed = false;
            continue;
        }
        if (instance->state != StProgramState::RUNNING) return PackageCycleVerdict::FAILED;
        if (!instance->committed_since_activation) all_committed = false;
    }
    if (!saw_instance) return PackageCycleVerdict::FAILED;
    /* `committed == false` nghĩa là batch output của base step này bị từ chối.
     * Đó là hỏng ngay, không phải "chưa tới lượt". */
    if (!committed) return PackageCycleVerdict::FAILED;
    return all_committed ? PackageCycleVerdict::PASSED : PackageCycleVerdict::PENDING;
}

bool ProgrammingRuntimeCoordinator::rollback_package(std::string* error)
{
    /* Topology cũ được giữ nguyên bằng ownership, kể cả tập instance rỗng
     * hợp lệ ở lần Commission đầu. Không nạp LKG theo từng Program:
     * package add/shrink/reorder không có ánh xạ 1-1 để rollback kiểu đó. */
    if (!previous_program_set_valid_) {
        if (error) *error = "không có topology package trước để rollback";
        return false;
    }
    return true;
}

void ProgrammingRuntimeCoordinator::on_output_commit(bool committed) noexcept
{
    if (state_.load(std::memory_order_acquire) != LifecycleState::ACTIVE_CANDIDATE) return;
    /* T59-501 — barrier chu kỳ đầu là barrier của cả GÓI.
     *
     * Bản trước chỉ xét `instance_id_`. Với gói nhiều Program, một Program hỏng
     * chu kỳ đầu trong khi Program chính chạy sạch sẽ được tuyên bố
     * FIRST_CYCLE_OK — và gói đi tiếp với một Program đã chết. Ngược lại,
     * rollback cũng chỉ quay Program chính về, để lại gói NỬA CŨ NỬA MỚI. */
    switch (package_first_cycle_verdict(committed)) {
    case PackageCycleVerdict::PENDING:
        /* Gói trộn chu kỳ: Program 30 s chưa tới lượt. Chưa kết luận được —
         * tuyên bố thành công lúc này là tuyên bố thay cho một Program chưa
         * chạy lần nào. */
        return;
    case PackageCycleVerdict::FAILED: {
        std::string ignored;
        if (rollback_package(&ignored))
            state_.store(LifecycleState::ROLLING_BACK, std::memory_order_release);
        else
            state_.store(LifecycleState::FAILED, std::memory_order_release);
        cutover_->request(CutoverMode::GRAPH_ONLY);
        return;
    }
    case PackageCycleVerdict::PASSED:
        break;
    }
    first_output_committed_.store(true, std::memory_order_release);
    state_.store(LifecycleState::FIRST_CYCLE_OK, std::memory_order_release);
}

RecoveryResetOutcome ProgrammingRuntimeCoordinator::recovery_reset(
    const RecoveryResetCommand& command, std::string* detail_code, std::string* error)
{
    if (command.actor_id.empty() || command.actor_id.size() > kStJournalFieldMax) {
        if (detail_code) *detail_code = "RECOVERY_RESET_ACTOR_REQUIRED";
        if (error) *error = "recovery reset cần actorId";
        return RecoveryResetOutcome::REJECTED;
    }
    if (state_.load(std::memory_order_acquire) != LifecycleState::RECOVERY_REQUIRED) {
        if (detail_code) *detail_code = "RECOVERY_RESET_NOT_IN_RECOVERY";
        if (error) *error = "chỉ reset được khi đang RECOVERY_REQUIRED";
        return RecoveryResetOutcome::NOT_IN_RECOVERY;
    }

    /* Ghi TRƯỚC khi đổi state: nếu mất điện giữa chừng thì lần boot sau đọc được
     * quyết định đã ghi, chứ không thấy một Core "đã IDLE" mà journal vẫn nói
     * đang dở giao dịch. */
    StJournalRecord record;
    record.phase = StJournalPhase::RECOVERY_RESET;
    record.timestamp_ns = default_monotonic_wall_clock_ns();
    record.operation_id = command.operation_id;
    record.old_active_hash = command.actor_id;
    record.candidate_hash.clear();
    record.plan_hash.clear();
    if (!journal_.append(record)) {
        if (detail_code) *detail_code = "RECOVERY_RESET_JOURNAL_WRITE_FAILED";
        if (error) *error = "cannot append/fsync Programming journal";
        return RecoveryResetOutcome::REJECTED;
    }

    /* Không nạp gói nào, không đụng LKG, không đụng RETAIN. Chỉ mở khoá cho một
     * Commission tường minh sau đó. */
    operation_id_.clear();
    artifact_hash_.clear();
    plan_hash_.clear();
    previous_artifact_hash_.clear();
    previous_revision_id_.clear();
    boundary_applied_.store(false, std::memory_order_release);
    boundary_journaled_.store(false, std::memory_order_release);
    detail_code_ = "JOURNAL_RECOVERY_RESET";
    state_.store(LifecycleState::IDLE, std::memory_order_release);
    cutover_->request(CutoverMode::GRAPH_ONLY);
    (void)cutover_->apply_pending_at_boundary();
    if (detail_code) *detail_code = "RECOVERY_RESET_APPLIED";
    return RecoveryResetOutcome::APPLIED;
}

bool ProgrammingRuntimeCoordinator::append_phase(StJournalPhase phase, std::string* error)
{
    return append_phase(phase, capture_identity(), error);
}

bool ProgrammingRuntimeCoordinator::append_phase(StJournalPhase phase,
                                                  const CoordinatorIdentity& identity,
                                                  std::string* error)
{
    StJournalRecord record;
    record.phase = phase;
    record.timestamp_ns = default_monotonic_wall_clock_ns();
    record.operation_id = identity.operation_id;
    record.old_active_hash = previous_artifact_hash_;
    record.candidate_hash = identity.artifact_hash;
    record.plan_hash = identity.plan_hash;
    if (!journal_.append(record)) {
        if (error) *error = "cannot append/fsync Programming journal";
        return false;
    }
    return true;
}

bool ProgrammingRuntimeCoordinator::flush_progress(std::string* error)
{
    LifecycleState current = state_.load(std::memory_order_acquire);
    if ((current == LifecycleState::ACTIVE_CANDIDATE || current == LifecycleState::FIRST_CYCLE_OK) &&
        boundary_applied_.load(std::memory_order_acquire) &&
        !boundary_journaled_.exchange(true, std::memory_order_acq_rel)) {
        if (!append_phase(StJournalPhase::ACTIVE_CANDIDATE, error)) {
            boundary_journaled_.store(false, std::memory_order_release);
            return false;
        }
    }
    current = state_.load(std::memory_order_acquire);
    if (current == LifecycleState::FIRST_CYCLE_OK &&
        first_output_committed_.load(std::memory_order_acquire)) {
        if (!first_cycle_journaled_.exchange(true, std::memory_order_acq_rel)) {
            if (!append_phase(StJournalPhase::FIRST_CYCLE_OK, error)) {
                first_cycle_journaled_.store(false, std::memory_order_release);
                return false;
            }
        }
        if (!write_active_checkpoint(error)) return false;
        if (!append_phase(StJournalPhase::COMMITTED, error)) return false;
        /* Hợp đồng signal của gói mới đã qua chu kỳ đầu: thả bank cũ. Không thả
         * thì lần Commission thứ ba sẽ không còn bank rảnh và bị từ chối vì một
         * lý do không liên quan gì tới gói của nó. */
        if (signal_replacement_active_) {
            if (StSignalBus* bus = scheduler_->signal_bus()) bus->commit_replacement();
            signal_replacement_active_ = false;
        }
        previous_revision_id_ = revision_id_;
        /* Scheduler vừa promote chính artifact này thành LKG sau output commit;
         * read-back revision phải phản ánh đúng cùng authority đó. */
        lkg_revision_id_ = revision_id_;
        previous_artifact_hash_ = artifact_hash_;
        /* COMMITTED đã bền: topology cũ không còn là đích rollback.
         * Thu hồi ở luồng non-RT, không huỷ runtime image trong boundary. */
        previous_program_set_.clear();
        previous_program_set_valid_ = false;
        prepared_identity_valid_ = false;
        prepared_identity_ = CoordinatorIdentity{};
        transaction_identity_ = CoordinatorIdentity{};
        previous_identity_ = CoordinatorIdentity{};
        state_.store(LifecycleState::COMMITTED, std::memory_order_release);
    }
    return true;
}

RuntimeOperationSnapshot ProgrammingRuntimeCoordinator::snapshot() const
{
    RuntimeOperationSnapshot output;
    output.state = state_.load(std::memory_order_acquire);
    const bool report_transaction = prepared_identity_valid_ &&
        (output.state == LifecycleState::STAGED ||
         output.state == LifecycleState::COMMIT_INTENT ||
         output.state == LifecycleState::FAILED ||
         output.state == LifecycleState::ROLLING_BACK ||
         output.state == LifecycleState::ROLLED_BACK);
    const CoordinatorIdentity identity = report_transaction ? transaction_identity_
                                                            : capture_identity();
    output.operation_id = identity.operation_id;
    output.requested_revision_id = identity.revision_id;
    output.active_revision_id = previous_revision_id_;
    output.lkg_revision_id = lkg_revision_id_;
    output.artifact_sha256 = identity.artifact_hash;
    output.detail_code = identity.detail_code;
    /* detail_code_ chỉ được IPC worker gán ở các nhánh lỗi TRƯỚC safe
     * boundary (stage/activate payload/token) — mọi lỗi PHÁT SINH TRONG scan
     * RT (input quality, fault thực thi ST, output preflight/commit) chỉ
     * được StScheduler ghi vào StProgramInstance::last_fault_code (đã có sẵn,
     * dùng cho Runtime Monitor), coordinator trước đây không bao giờ đọc lại
     * nên Commission FAILED/ROLLED_BACK luôn "câm" — API trả về
     * RECONCILE_REJECTED/STAGE_REJECTED không kèm lý do thật (phát hiện thật
     * khi debug AHU_MasterSequence 2026-08-17, board Foxlinx). Bù trực tiếp ở
     * đây (non-RT, chỉ đọc con trỏ) thay vì sửa RT path. */
    if (output.detail_code.empty() && scheduler_ &&
        (output.state == LifecycleState::FAILED || output.state == LifecycleState::ROLLED_BACK ||
         output.state == LifecycleState::ROLLING_BACK)) {
        if (const StProgramInstance* instance = scheduler_->find_program(instance_id_);
            instance && instance->last_fault_code) {
            output.detail_code = std::string("RUNTIME_FAULT:") + instance->last_fault_code;
        }
    }
    output.producer_mode = cutover_->current();
    output.keeps_running = output.producer_mode == CutoverMode::GRAPH_ONLY ||
                           output.state == LifecycleState::COMMITTED ||
                           output.state == LifecycleState::ROLLED_BACK;
    output.impact_snapshot_valid = impact_snapshot_valid_.load(std::memory_order_acquire);
    if (output.impact_snapshot_valid) {
        const uint64_t analog = ao_override_levels_.load(std::memory_order_acquire);
        const uint64_t digital = do_override_levels_.load(std::memory_order_acquire);
        for (int channel = 0; channel < KX_N_AO; ++channel) {
            const int level = static_cast<int>((analog >> (channel * 3)) & 0x7U);
            if (level != 0)
                output.active_override_ids.push_back(
                    "AO-" + std::to_string(channel + 1) + ":" + prio_source_name(level));
        }
        for (int channel = 0; channel < KX_N_DO; ++channel) {
            const int level = static_cast<int>((digital >> (channel * 3)) & 0x7U);
            if (level != 0)
                output.active_override_ids.push_back(
                    "DO-" + std::to_string(channel + 1) + ":" + prio_source_name(level));
        }
    }
    return output;
}

} // namespace core::programming
