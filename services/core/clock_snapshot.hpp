#ifndef CORE_CLOCK_SNAPSHOT_HPP
#define CORE_CLOCK_SNAPSHOT_HPP

#include <cstdint>
#include <ctime>

namespace core {

struct ClockSnapshot {
    uint64_t monotonic_ns = 0;
    int64_t utc_epoch_ms = 0;
    std::tm civil_time{};
};

inline ClockSnapshot capture_clock_snapshot()
{
    timespec monotonic{};
    timespec realtime{};
    clock_gettime(CLOCK_MONOTONIC, &monotonic);
    clock_gettime(CLOCK_REALTIME, &realtime);

    ClockSnapshot snapshot;
    snapshot.monotonic_ns = static_cast<uint64_t>(monotonic.tv_sec) * 1000000000ull +
                            static_cast<uint64_t>(monotonic.tv_nsec);
    snapshot.utc_epoch_ms = static_cast<int64_t>(realtime.tv_sec) * 1000ll +
                            static_cast<int64_t>(realtime.tv_nsec) / 1000000ll;
    const std::time_t local_seconds = realtime.tv_sec;
#if defined(_WIN32)
    localtime_s(&snapshot.civil_time, &local_seconds);
#else
    localtime_r(&local_seconds, &snapshot.civil_time);
#endif
    return snapshot;
}

} // namespace core

#endif /* CORE_CLOCK_SNAPSHOT_HPP */
