#include "safety/overrun_monitor.hpp"

namespace core {

void OverrunMonitor::record(uint64_t exec_ns, uint64_t budget_ns)
{
    stats_.last_exec_ns = exec_ns;
    if (exec_ns > stats_.max_exec_ns) stats_.max_exec_ns = exec_ns;

    if (exec_ns > budget_ns) {
        stats_.total++;
        stats_.consecutive++;
        stats_.recovery_streak = 0;
        if (stats_.consecutive >= threshold_) forcing_safe_ = true;
        return;
    }

    /* Chạy trong budget. */
    stats_.consecutive = 0;
    if (!forcing_safe_) return;

    /* BẤT ĐỐI XỨNG CÓ CHỦ Ý (SPEC §6.3): vào safe sau `threshold` lần hỏng,
     * nhưng RA cũng cần `threshold` lần tốt liên tiếp. Ra ngay sau một lần
     * tốt sẽ gây dao động vào/ra safe-state khi tải dao động quanh ngưỡng —
     * trạng thái tệ hơn cả việc ở yên trong safe. */
    if (++stats_.recovery_streak >= threshold_) {
        forcing_safe_ = false;
        stats_.recovery_streak = 0;
    }
}

void OverrunMonitor::reset()
{
    forcing_safe_ = false;
    stats_.consecutive = 0;
    stats_.recovery_streak = 0;
    /* total/max KHÔNG reset: chúng là số liệu tích luỹ để chẩn đoán, reset
     * chúng sẽ xoá dấu vết một Task từng có vấn đề. */
}

} // namespace core
