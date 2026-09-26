/**
 * @file  st_retain.hpp
 * @brief RETAIN v2 cho Program Instance: stable identity, layout version,
 *        CRC toàn record, ghi atomic và cold-init có chẩn đoán.
 */
#ifndef CORE_ST_RETAIN_HPP
#define CORE_ST_RETAIN_HPP

#include <array>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "st/st_loader.hpp"

namespace core {

namespace st_retain_error {
constexpr const char* kBadMagicOrVersion = "RT-RETAIN-001";
constexpr const char* kBadCrc            = "RT-RETAIN-002";
constexpr const char* kLayoutMismatch    = "RT-RETAIN-003";
constexpr const char* kBadRecordSize     = "RT-RETAIN-004";
} // namespace st_retain_error

namespace st_retain {
constexpr uint32_t kMagic = 0x54524B4Du; /* "MKRT" little-endian */
constexpr uint16_t kRecordVersion = 2;
constexpr uint16_t kLayoutVersion = 1;
constexpr uint16_t kHeaderSize = 160;
constexpr uint64_t kMinWriteIntervalNs = 60ull * 1000000000ull;
constexpr std::size_t kDigestBytes = 32;
} // namespace st_retain

enum class StRetainRestoreState : uint8_t {
    NOT_APPLICABLE = 0,
    COLD_INIT_MISSING,
    COLD_INIT_REJECTED,
    RESTORED,
};

const char* st_retain_restore_state_name(StRetainRestoreState state);

struct StRetainResult {
    StRetainRestoreState state = StRetainRestoreState::NOT_APPLICABLE;
    bool        restored = false;
    const char* reject_code = nullptr;
    uint64_t    generation = 0;
    std::string message;
};

struct StRetainSnapshot {
    std::array<uint8_t, st_retain::kDigestBytes> instance_identity{};
    std::array<uint8_t, st_retain::kDigestBytes> layout_identity{};
    std::array<uint8_t, st_retain::kDigestBytes> artifact_sha256{};
    uint32_t layout_hash = 0;
    uint32_t payload_size = 0;
    uint64_t generation = 0;
    uint64_t captured_at_ns = 0;
    uint64_t source_hash = 0;
    bool has_retained_fb = false;
    std::array<uint8_t, st_ir::kMaxRetainRecord> payload{};
};

enum class StRetainSaveOutcome : uint8_t {
    NO_CHANGE = 0,
    DEFERRED,
    WRITTEN,
    ERROR,
};

/* Dựng SHA-256 canonical của Program/variable/FB identity + type + offset.
 * Gọi một lần ở đường prepare non-RT; không hash string trong scan. */
bool st_prepare_retain_layout_identity(StLoadedProgram* program);

class StRetainService;

/* Mailbox SPSC hai slot: scan chỉ copy tối đa 4 KiB vào slot không READING;
 * worker mới làm filesystem I/O. READY cũ có thể bị ghi đè để coalesce latest,
 * nhưng slot READING không bao giờ bị chạm nên không có data race. */
class StRetainMailbox {
public:
    uint32_t write_count() const { return write_count_.load(std::memory_order_relaxed); }
    uint32_t write_fail_count() const
    {
        return write_fail_count_.load(std::memory_order_relaxed);
    }
    uint64_t last_saved_generation() const
    {
        return last_saved_generation_.load(std::memory_order_acquire);
    }

private:
    enum SlotState : uint8_t { EMPTY = 0, WRITING, READY, READING };
    struct Slot {
        std::atomic<uint8_t> state{EMPTY};
        StRetainSnapshot snapshot;
    };

    std::array<Slot, 2> slots_{};
    std::array<uint8_t, st_retain::kDigestBytes> instance_identity_{};
    std::atomic<uint64_t> next_generation_{1};
    std::atomic<uint32_t> write_count_{0};
    std::atomic<uint32_t> write_fail_count_{0};
    std::atomic<uint64_t> last_saved_generation_{0};
    StRetainService* owner_ = nullptr;
    /* ADR-061 X14 — chỉ luồng RT (publish) đọc/ghi: mốc lần đánh thức worker gần
     * nhất. Ở chu kỳ 10 ms, đánh thức mỗi lần publish là 100 lần futex/s trên
     * luồng quét trong khi worker vẫn tự thức mỗi 1 s và ghi đĩa tối đa 1 lần
     * mỗi `kMinWriteIntervalNs`; đánh thức dày hơn 1 lần/giây không đổi gì. */
    uint64_t last_notify_ns_ = 0;
    bool     notified_once_ = false;

    bool publish(const StLoadedProgram& program, uint64_t now_ns) noexcept;
    int acquire_latest_ready() noexcept;
    void release_after_save(int index, StRetainSaveOutcome outcome) noexcept;
    void discard_older_ready(uint64_t generation) noexcept;

    friend class StRetainService;
    friend bool st_publish_retain_snapshot(StRetainMailbox*, const StLoadedProgram&,
                                           uint64_t) noexcept;
};

bool st_publish_retain_snapshot(StRetainMailbox* mailbox, const StLoadedProgram& program,
                                uint64_t now_ns) noexcept;

class StRetainStore {
public:
    explicit StRetainStore(std::string path, std::string stable_identity = "standalone");

    StRetainResult restore(StLoadedProgram* program, uint64_t now_ns = 0);
    StRetainSaveOutcome save_snapshot_if_needed(const StRetainSnapshot& snapshot,
                                                bool force = false);
    /* API tiện cho unit test/component non-RT. */
    bool save_if_needed(const StLoadedProgram& program, uint64_t now_ns,
                        bool force = false);

    uint32_t write_count() const { return write_count_; }
    uint64_t last_write_ns() const { return last_write_ns_; }
    uint64_t last_generation() const { return last_generation_; }
    const std::array<uint8_t, st_retain::kDigestBytes>& instance_identity() const
    {
        return instance_identity_;
    }

    /* Reset idempotent; thành công cả khi file chưa tồn tại. */
    bool erase();

private:
    std::string path_;
    std::array<uint8_t, st_retain::kDigestBytes> instance_identity_{};
    std::vector<uint8_t> last_written_payload_;
    std::array<uint8_t, st_retain::kDigestBytes> last_layout_identity_{};
    uint64_t last_write_ns_ = 0;
    uint64_t last_generation_ = 0;
    uint32_t write_count_ = 0;
    uint64_t standalone_generation_ = 1;

    bool write_atomic(const std::vector<uint8_t>& bytes) const;
};

/* Owner của filesystem/thread. register/restore chạy non-RT; publish qua
 * mailbox chạy trong scan và không lock/allocate/I/O. */
class StRetainService {
public:
    StRetainService(std::string root_dir, std::string controller_identity,
                    bool start_worker = true);
    ~StRetainService();

    StRetainService(const StRetainService&) = delete;
    StRetainService& operator=(const StRetainService&) = delete;

    bool ready() const { return ready_; }
    const std::string& error() const { return error_; }
    StRetainMailbox* register_instance(const std::string& instance_id);
    StRetainResult restore(const std::string& instance_id, StLoadedProgram* program,
                           uint64_t now_ns);

    /* Dùng ở test và shutdown. force=true bỏ qua giãn cách 60 s. */
    void flush(bool force);
    void shutdown_and_flush();

private:
    struct Entry {
        Entry(std::string id, std::string path, const std::string& stable_identity)
            : instance_id(std::move(id)), store(std::move(path), stable_identity) {}
        std::string instance_id;
        StRetainMailbox mailbox;
        StRetainStore store;
        std::mutex io_mutex;
    };

    std::string root_dir_;
    std::string controller_identity_;
    bool ready_ = false;
    std::string error_;
    std::mutex entries_mutex_;
    std::vector<std::unique_ptr<Entry>> entries_;

    std::atomic<bool> stop_{false};
    bool worker_started_ = false;
    std::thread worker_;
    std::mutex wake_mutex_;
    std::condition_variable wake_cv_;

    Entry* find_entry_locked(const std::string& instance_id);
    void notify_worker() noexcept;
    void worker_loop();

    friend class StRetainMailbox;
};

} // namespace core

#endif /* CORE_ST_RETAIN_HPP */
