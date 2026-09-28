/**
 * @file  allocation_probe.hpp
 * @brief Đếm số lần cấp phát heap trong một vùng code — dùng để biến "không
 *        cấp phát trong vòng poll IOP" từ ý định thành thuộc tính KIỂM ĐƯỢC
 *        (Plan 63 T63-004/T63-201).
 *
 *        Bản sao của `apps/core/tests/allocation_probe.*`: Core và iobus không
 *        có thư viện test dùng chung, và test không được link chéo app.
 *
 *        Toán tử new/delete toàn cục chỉ được ghi đè ở MỘT translation unit
 *        (allocation_probe.cpp) — nếu mỗi test tự ghi đè thì linker báo
 *        multiple definition. Test chỉ include header này.
 *
 *        Bộ đếm là thread_local: một test đo trên thread của nó không bị
 *        nhiễu bởi thread khác.
 */
#ifndef IOBUS_TESTS_ALLOCATION_PROBE_HPP
#define IOBUS_TESTS_ALLOCATION_PROBE_HPP

#include <cstddef>

namespace allocation_probe {

extern thread_local bool        enabled;
extern thread_local std::size_t count;

/* Bật đếm trong phạm vi khối, tự tắt khi ra khỏi khối kể cả khi test fail
 * giữa chừng — nếu không, một ASSERT_* thoát sớm sẽ để bộ đếm bật vĩnh viễn
 * và làm mọi test sau đó chậm và sai. */
class ScopedCounter {
public:
    ScopedCounter() { count = 0; enabled = true; }
    ~ScopedCounter() { enabled = false; }
    std::size_t allocations() const noexcept { return count; }

    ScopedCounter(const ScopedCounter&) = delete;
    ScopedCounter& operator=(const ScopedCounter&) = delete;
};

} // namespace allocation_probe

#endif /* IOBUS_TESTS_ALLOCATION_PROBE_HPP */
