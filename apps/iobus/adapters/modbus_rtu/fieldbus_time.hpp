/**
 * @file  fieldbus_time.hpp
 * @brief MBR-B103: mốc thời gian của MẪU đo.
 *
 * Hai đồng hồ, hai vai trò khác nhau, và không thay thế được cho nhau:
 *
 *  - `monotonic_ns()` dùng để TÍNH TUỔI mẫu (GOOD → STALE → OFFLINE). Nó không
 *    nhảy khi NTP chỉnh giờ, nên ngưỡng stale không bao giờ bị một lần đồng bộ
 *    NTP làm sai. Đây là đồng hồ duy nhất được phép quyết định quality.
 *  - `utc_ms()` dùng để HIỂN THỊ và ghi historian. Nó nhảy khi NTP chỉnh, và
 *    trước lần đồng bộ đầu tiên có thể là 1970 — nên tuyệt đối không dùng nó
 *    để so tuổi mẫu.
 *
 * FW_SOM_DESIGN §6: khi NTP chưa đồng bộ, quality KHÔNG đổi; chỉ mốc hiển thị
 * là không tin được, và đó là việc của tầng trình bày chứ không phải producer.
 */
#ifndef IOBUS_FIELDBUS_TIME_HPP
#define IOBUS_FIELDBUS_TIME_HPP

#include <cstdint>
#include <ctime>

namespace iobus::fieldbus {

inline int64_t monotonic_ns()
{
    struct timespec ts {};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000000000ll + ts.tv_nsec;
}

inline uint64_t monotonic_ms()
{
    return static_cast<uint64_t>(monotonic_ns() / 1000000ll);
}

inline int64_t utc_ms()
{
    struct timespec ts {};
    clock_gettime(CLOCK_REALTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000ll + ts.tv_nsec / 1000000ll;
}

} // namespace iobus::fieldbus

#endif /* IOBUS_FIELDBUS_TIME_HPP */
