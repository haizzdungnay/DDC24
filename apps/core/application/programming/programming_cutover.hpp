#ifndef CORE_APPLICATION_PROGRAMMING_PROGRAMMING_CUTOVER_HPP
#define CORE_APPLICATION_PROGRAMMING_PROGRAMMING_CUTOVER_HPP

#include <atomic>
#include <cstdint>

namespace core {

enum class CutoverMode : uint8_t { GRAPH_ONLY = 0, PROGRAM_ONLY = 1 };

/* Mailbox lock-free giữa worker IPC và ScanLoop. Worker chỉ request; scan là
 * writer duy nhất của current mode tại safe boundary. */
class ProgrammingCutover {
public:
    explicit ProgrammingCutover(CutoverMode initial) noexcept
        : current_(static_cast<uint8_t>(initial)), requested_(static_cast<uint8_t>(initial)) {}

    CutoverMode current() const noexcept
    { return static_cast<CutoverMode>(current_.load(std::memory_order_acquire)); }

    bool request(CutoverMode mode) noexcept
    {
        requested_.store(static_cast<uint8_t>(mode), std::memory_order_release);
        pending_.store(true, std::memory_order_release);
        return true;
    }

    bool apply_pending_at_boundary() noexcept
    {
        if (!pending_.exchange(false, std::memory_order_acq_rel)) return false;
        current_.store(requested_.load(std::memory_order_acquire), std::memory_order_release);
        generation_.fetch_add(1, std::memory_order_release);
        return true;
    }

    uint64_t generation() const noexcept
    { return generation_.load(std::memory_order_acquire); }

private:
    std::atomic<uint8_t> current_;
    std::atomic<uint8_t> requested_;
    std::atomic<bool> pending_{false};
    std::atomic<uint64_t> generation_{0};
};

} // namespace core

#endif
