#ifndef CORE_PROGRAMMING_TESTS_ENABLE_AT_BOUNDARY_HPP
#define CORE_PROGRAMMING_TESTS_ENABLE_AT_BOUNDARY_HPP

/**
 * @file  enable_at_boundary.hpp
 * @brief F-P59-ENABLE-BOUNDARY-001 — gọi `set_program_enabled()` trong test host.
 *
 *        `set_program_enabled()` chỉ trả lời SAU khi RT tiêu thụ yêu cầu tại
 *        safe boundary. Trên bo thật, boundary do scan loop (một luồng khác)
 *        gọi trong lúc IPC worker đang chờ. Test host đơn luồng không có luồng
 *        đó, nên gọi thẳng sẽ luôn `TIMED_OUT` — không phải vì code sai mà vì
 *        môi trường test không mô phỏng đúng mô hình luồng production.
 *
 *        Helper này dựng đúng luồng còn thiếu, và CHỈ bơm phần boundary của
 *        Enable/Disable. Không gọi `on_safe_boundary()` đầy đủ: hàm đó còn đẩy
 *        cả state machine activation/rollback, bơm nó ở nền sẽ làm test đang
 *        kiểm Commission chạy sang một pha khác giữa chừng.
 */

#include <atomic>
#include <chrono>
#include <string>
#include <thread>

#include "programming/programming_runtime_coordinator.hpp"
#include "st/st_scheduler.hpp"

namespace core::programming::test {

inline ProgramEnableOutcome enable_at_boundary(ProgrammingRuntimeCoordinator* coordinator,
                                               StScheduler* scheduler,
                                               const ProgramEnableCommand& command,
                                               std::string* detail, std::string* error)
{
    std::atomic<bool> stop{false};
    std::thread boundary([&] {
        while (!stop.load(std::memory_order_acquire)) {
            scheduler->apply_pending_enable_requests_at_boundary();
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    });
    const ProgramEnableOutcome outcome =
        coordinator->set_program_enabled(command, detail, error);
    stop.store(true, std::memory_order_release);
    boundary.join();
    return outcome;
}

} // namespace core::programming::test

#endif /* CORE_PROGRAMMING_TESTS_ENABLE_AT_BOUNDARY_HPP */
