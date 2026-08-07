#include "schedule/schedule_clock.hpp"

#include <cstdlib>
#include <cstring>
#include <ctime>

namespace core {

namespace {

/* Mốc coi là "đồng hồ đã được đặt": 2020-01-01T00:00:00Z. */
constexpr int64_t kClockSyncedFloorEpochS = 1'577'836'800;

/* Đổi TZ của tiến trình là thao tác toàn cục và không rẻ, nên chỉ làm khi tên
 * múi giờ THỰC SỰ đổi. Trong thực tế mọi lịch trên một bo thường dùng chung
 * một múi giờ, nên đây là 0 lần gọi mỗi vòng quét sau lần đầu.
 *
 * An toàn vì core là một luồng duy nhất ở vòng quét; nếu sau này có luồng khác
 * đọc giờ thì phải bọc lại bằng khoá. */
class ProcessTimeZone {
public:
    bool apply(const std::string& name)
    {
        if (applied_ && current_ == name) return true;
        if (name.empty()) return false;
        if (::setenv("TZ", name.c_str(), 1) != 0) return false;
        ::tzset();
        applied_ = true;
        current_ = name;
        return true;
    }

private:
    bool applied_ = false;
    std::string current_;
};

ProcessTimeZone& process_tz()
{
    static ProcessTimeZone tz;
    return tz;
}

/* Múi giờ có tồn tại thật không.
 *
 * `tzset()` KHÔNG báo lỗi khi tên sai — glibc lặng lẽ dùng UTC. Đó đúng là
 * kiểu hỏng mà lớp này sinh ra để chặn, nên phải tự kiểm bằng cách so hai mốc
 * đã biết chắc là lệch nhau ở hầu hết múi giờ, và kiểm sự tồn tại của tệp
 * trong cơ sở dữ liệu múi giờ. */
bool timezone_exists(const std::string& name)
{
    if (name.empty()) return false;
    /* Chặn đường thoát khỏi thư mục zoneinfo trước khi chạm hệ thống tệp. */
    if (name.find("..") != std::string::npos || name.front() == '/') return false;
    if (name == "UTC" || name == "Etc/UTC") return true;

    const std::string path = "/usr/share/zoneinfo/" + name;
    if (FILE* f = std::fopen(path.c_str(), "rb")) {
        std::fclose(f);
        return true;
    }
    return false;
}

} // namespace

bool civil_time_in_zone(const std::string& timezone, int64_t utc_epoch_s, CivilTime* out)
{
    if (!out) return false;
    if (!timezone_exists(timezone)) return false;
    if (!process_tz().apply(timezone)) return false;

    const std::time_t t = static_cast<std::time_t>(utc_epoch_s);
    std::tm civil{};
    if (::localtime_r(&t, &civil) == nullptr) return false;

    *out = civil_from_tm(civil);
    return true;
}

bool system_clock_synced(int64_t utc_epoch_s)
{
    return utc_epoch_s >= kClockSyncedFloorEpochS;
}

TimeJumpDetector::Result TimeJumpDetector::observe(uint64_t monotonic_ns, int64_t utc_epoch_ms)
{
    Result result;
    if (!has_previous_) {
        has_previous_ = true;
        prev_monotonic_ns_ = monotonic_ns;
        prev_utc_epoch_ms_ = utc_epoch_ms;
        return result;
    }

    const int64_t mono_delta_ms =
        static_cast<int64_t>((monotonic_ns - prev_monotonic_ns_) / 1'000'000ull);
    const int64_t real_delta_ms = utc_epoch_ms - prev_utc_epoch_ms_;
    const int64_t drift_ms = real_delta_ms - mono_delta_ms;

    prev_monotonic_ns_ = monotonic_ns;
    prev_utc_epoch_ms_ = utc_epoch_ms;

    if (drift_ms > threshold_s_ * 1000 || drift_ms < -threshold_s_ * 1000) {
        result.jumped = true;
        result.delta_s = drift_ms / 1000;
    }
    return result;
}

} // namespace core
