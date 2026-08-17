#include "programming/programming_runtime_coordinator.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <thread>
#include <vector>

#include <fcntl.h>
#include <sodium.h>
#include <sys/stat.h>
#include <unistd.h>

#include "st/st_ir.hpp"

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
    const bool has_checkpoint = read_active_checkpoint(&checkpoint, &checkpoint_error);
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
            (void)load_active_checkpoint(checkpoint, error);
        state_.store(LifecycleState::IDLE, std::memory_order_release);
        if (previous_revision_id_.empty()) {
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
        }
        return true;
    case StJournalBootAction::KEEP_OLD_ACTIVE_MARK_OPERATION_FAILED:
        if (!read.record.old_active_hash.empty() && has_checkpoint &&
            checkpoint.artifact_sha256 == read.record.old_active_hash)
            (void)load_active_checkpoint(checkpoint, error);
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
            load_active_checkpoint(checkpoint, error)) {
            detail_code_ = "JOURNAL_ACTIVE_CANDIDATE_ROLLED_BACK";
            state_.store(LifecycleState::ROLLED_BACK, std::memory_order_release);
        } else {
            detail_code_ = "JOURNAL_ACTIVE_CANDIDATE_RECOVERY_REQUIRED";
            state_.store(LifecycleState::RECOVERY_REQUIRED, std::memory_order_release);
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
            if (error) *error = "active candidate has no valid prior LKG checkpoint";
            return false;
        }
        return true;
    case StJournalBootAction::VERIFY_ACTIVE_THEN_FINISH_OR_LKG:
        if (has_checkpoint && checkpoint.operation_id == read.record.operation_id &&
            checkpoint.artifact_sha256 == read.record.candidate_hash &&
            checkpoint.plan_hash == read.record.plan_hash &&
            load_active_checkpoint(checkpoint, error)) {
            detail_code_.clear();
            state_.store(LifecycleState::COMMITTED, std::memory_order_release);
            previous_artifact_hash_ = read.record.old_active_hash;
            if (!append_phase(StJournalPhase::COMMITTED, error)) return false;
            previous_artifact_hash_ = artifact_hash_;
        } else if (!read.record.old_active_hash.empty() && has_checkpoint &&
                   checkpoint.artifact_sha256 == read.record.old_active_hash &&
                   load_active_checkpoint(checkpoint, error)) {
            detail_code_ = "JOURNAL_FIRST_CYCLE_ROLLED_BACK";
            state_.store(LifecycleState::ROLLED_BACK, std::memory_order_release);
        } else {
            detail_code_ = "JOURNAL_FIRST_CYCLE_VERIFY_REQUIRED";
            state_.store(LifecycleState::RECOVERY_REQUIRED, std::memory_order_release);
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
            if (error) *error = "first-cycle journal cannot be matched to active/LKG checkpoint";
            return false;
        }
        return true;
    case StJournalBootAction::USE_COMMITTED_ACTIVE:
        if (has_checkpoint && checkpoint.operation_id == read.record.operation_id &&
            checkpoint.artifact_sha256 == read.record.candidate_hash &&
            checkpoint.plan_hash == read.record.plan_hash &&
            load_active_checkpoint(checkpoint, error)) {
            detail_code_.clear();
            state_.store(LifecycleState::COMMITTED, std::memory_order_release);
        } else {
            detail_code_ = "JOURNAL_COMMITTED_CHECKPOINT_INVALID";
            state_.store(LifecycleState::RECOVERY_REQUIRED, std::memory_order_release);
            cutover_->request(CutoverMode::GRAPH_ONLY);
            (void)cutover_->apply_pending_at_boundary();
            if (error) *error = checkpoint_error.empty()
                ? "committed journal has no matching active checkpoint" : checkpoint_error;
            return false;
        }
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
    if (!read_staged_artifact(command, &bytes, &detail, error) || !ensure_instance(error) ||
        !scheduler_->stage_activation(instance_id_, bytes, error) ||
        !scheduler_->commit_staged_activation(instance_id_, false, error))
        return false;
    scheduler_->apply_pending_activations_at_boundary();
    StProgramInstance* instance = scheduler_->find_program(instance_id_);
    if (!instance || instance->state != StProgramState::ACTIVE ||
        !scheduler_->start(instance_id_, error)) return false;
    instance->last_known_good.swap(instance->activated_artifact);
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
    if (scheduler_->find_task(kTaskId) && scheduler_->find_program(instance_id_)) return true;
    if (error) *error = "Programming topology main/program-main was not prepared at bootstrap";
    return false;
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
    if (!canonical_uuid(command.operation_id) || !canonical_uuid(command.revision_id) ||
        command.instance_id != "program-main" || !lowercase_hex_64(command.plan_hash)) {
        if (detail_code) *detail_code = "IPC-PAYLOAD";
        if (error) *error = "operation/revision/instance/plan identity invalid";
        return false;
    }
    std::vector<uint8_t> bytes;
    if (!read_staged_artifact(command, &bytes, detail_code, error)) return false;
    instance_id_ = command.instance_id.empty() ? "program-main" : command.instance_id;
    if (!ensure_instance(error)) {
        if (detail_code) *detail_code = "IPC-RUNTIME-CONFIG";
        return false;
    }
    if (!scheduler_->stage_activation(instance_id_, bytes, error)) {
        if (detail_code) *detail_code = "IPC-STAGE-REJECTED";
        return false;
    }
    operation_id_ = command.operation_id;
    revision_id_ = command.revision_id;
    artifact_hash_ = hex_digest(command.sha256.data(), command.sha256.size());
    artifact_byte_size_ = command.byte_size;
    plan_hash_ = command.plan_hash;
    staged_restore_ = restore;
    detail_code_.clear();
    boundary_applied_.store(false, std::memory_order_relaxed);
    first_output_committed_.store(false, std::memory_order_relaxed);
    boundary_journaled_.store(false, std::memory_order_relaxed);
    first_cycle_journaled_.store(false, std::memory_order_relaxed);
    if (!append_phase(StJournalPhase::PREPARED, error)) {
        std::string ignored;
        (void)scheduler_->abort_staged_activation(instance_id_, &ignored);
        if (detail_code) *detail_code = "IPC-JOURNAL-FSYNC";
        return false;
    }
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
        command.operation_id != operation_id_ || command.staged_token != operation_id_ ||
        command.plan_hash != plan_hash_) {
        if (detail_code) *detail_code = "IPC-STAGED-TOKEN";
        if (error) *error = "staged operation/token/plan does not match";
        return false;
    }
    if (command.expected_active_revision_id != previous_revision_id_) {
        if (detail_code) *detail_code = "IPC-EXPECTED-ACTIVE";
        if (error) *error = "expected active revision mismatch";
        return false;
    }
    if (!append_phase(StJournalPhase::COMMIT_INTENT, error)) {
        if (detail_code) *detail_code = "IPC-JOURNAL-FSYNC";
        return false;
    }
    if (!scheduler_->commit_staged_activation(instance_id_, staged_restore_, error)) {
        if (detail_code) *detail_code = "IPC-ACTIVATE-ARM";
        return false;
    }
    cutover_->request(command.cutover);
    state_.store(LifecycleState::COMMIT_INTENT, std::memory_order_release);
    return true;
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

    const LifecycleState current = state_.load(std::memory_order_acquire);
    if (current == LifecycleState::ROLLING_BACK) {
        scheduler_->apply_pending_activations_at_boundary();
        (void)cutover_->apply_pending_at_boundary();
        StProgramInstance* instance = scheduler_->find_program(instance_id_);
        std::string ignored;
        if (instance && instance->state == StProgramState::ROLLED_BACK &&
            scheduler_->start(instance_id_, &ignored)) {
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
    scheduler_->apply_pending_activations_at_boundary();
    (void)cutover_->apply_pending_at_boundary();
    StProgramInstance* instance = scheduler_->find_program(instance_id_);
    if (!instance || (instance->state != StProgramState::ACTIVE &&
                      instance->state != StProgramState::ROLLED_BACK)) {
        cutover_->request(CutoverMode::GRAPH_ONLY);
        (void)cutover_->apply_pending_at_boundary();
        state_.store(LifecycleState::FAILED, std::memory_order_release);
        return;
    }
    std::string ignored;
    if (!scheduler_->start(instance_id_, &ignored)) {
        cutover_->request(CutoverMode::GRAPH_ONLY);
        (void)cutover_->apply_pending_at_boundary();
        state_.store(LifecycleState::FAILED, std::memory_order_release);
        return;
    }
    boundary_applied_.store(true, std::memory_order_release);
    state_.store(LifecycleState::ACTIVE_CANDIDATE, std::memory_order_release);
}

void ProgrammingRuntimeCoordinator::on_output_commit(bool committed) noexcept
{
    if (state_.load(std::memory_order_acquire) != LifecycleState::ACTIVE_CANDIDATE) return;
    StProgramInstance* instance = scheduler_->find_program(instance_id_);
    if (instance && instance->last_successful_base_step != scheduler_->base_step_count() &&
        instance->state == StProgramState::RUNNING)
        return; /* Task chu kỳ dài chưa đến hạn: chưa phải first-cycle failure. */
    if (!committed || !instance || instance->state != StProgramState::RUNNING ||
        instance->output_commit_generation != scheduler_->base_step_count()) {
        std::string ignored;
        if (instance && !instance->last_known_good.empty()) {
            if (scheduler_->rollback(instance_id_, &ignored))
                state_.store(LifecycleState::ROLLING_BACK, std::memory_order_release);
            else
                state_.store(LifecycleState::FAILED, std::memory_order_release);
        } else {
            state_.store(LifecycleState::FAILED, std::memory_order_release);
        }
        cutover_->request(CutoverMode::GRAPH_ONLY);
        return;
    }
    first_output_committed_.store(true, std::memory_order_release);
    state_.store(LifecycleState::FIRST_CYCLE_OK, std::memory_order_release);
}

bool ProgrammingRuntimeCoordinator::append_phase(StJournalPhase phase, std::string* error)
{
    StJournalRecord record;
    record.phase = phase;
    record.timestamp_ns = default_monotonic_wall_clock_ns();
    record.operation_id = operation_id_;
    record.old_active_hash = previous_artifact_hash_;
    record.candidate_hash = artifact_hash_;
    record.plan_hash = plan_hash_;
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
        previous_revision_id_ = revision_id_;
        /* Scheduler vừa promote chính artifact này thành LKG sau output commit;
         * read-back revision phải phản ánh đúng cùng authority đó. */
        lkg_revision_id_ = revision_id_;
        previous_artifact_hash_ = artifact_hash_;
        state_.store(LifecycleState::COMMITTED, std::memory_order_release);
    }
    return true;
}

RuntimeOperationSnapshot ProgrammingRuntimeCoordinator::snapshot() const
{
    RuntimeOperationSnapshot output;
    output.state = state_.load(std::memory_order_acquire);
    output.operation_id = operation_id_;
    output.requested_revision_id = revision_id_;
    output.active_revision_id = previous_revision_id_;
    output.lkg_revision_id = lkg_revision_id_;
    output.artifact_sha256 = artifact_hash_;
    output.detail_code = detail_code_;
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
