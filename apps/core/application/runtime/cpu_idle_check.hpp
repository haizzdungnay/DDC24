/**
 * @file  cpu_idle_check.hpp
 * @brief ADR-061 C4 / 4.11 — CPU chạy vòng quét có còn được phép vào trạng thái
 *        nghỉ sâu hay không.
 *
 *        Đo trên Foxlinx 2026-09-26 (RV1126B, kernel 6.1 non-RT): CPU3 có trạng
 *        thái `cpu-sleep` với exit latency 370 µs, residency 900 µs. Vòng quét
 *        ngủ 10 ms giữa hai base step, nên governor `menu` chọn `cpu-sleep` gần
 *        như mọi lần và lần thức dậy trễ tới vài trăm µs: 785/6008 lần thức dậy
 *        (13,07 %) lệch quá 100 µs. Đặt `pm_qos_resume_latency_us=20` cho CPU3
 *        (governor chỉ còn chọn WFI) hạ xuống 9/6006 (0,15 %) trong cùng điều
 *        kiện. `cyclictest` không gặp hiện tượng này vì mặc định nó giữ
 *        `/dev/cpu_dma_latency=0`.
 *
 *        Ràng buộc QoS là việc của nền tảng (unit systemd chạy bằng root);
 *        Core chạy bằng user `mkddc` không ghi được sysfs. Header này chỉ ĐỌC
 *        để Core nói ra lúc khởi động khi nền tảng thiếu ràng buộc đó — thiếu
 *        thì C4 không thể đạt, và điều đó phải nằm trong log chứ không phải
 *        chờ ai đó đi đo.
 *
 *        Quy ước sysfs (drivers/base/power/sysfs.c, kernel ≥ 4.16):
 *          - `pm_qos_resume_latency_us` đọc "0"   ⇒ KHÔNG ràng buộc;
 *          - đọc "n/a"                            ⇒ ràng buộc 0 µs (chỉ còn
 *            trạng thái nghỉ nông nhất);
 *          - đọc N > 0                            ⇒ governor chỉ chọn trạng thái
 *            có exit latency ≤ N µs (menu: `exit_latency_ns > latency_req` thì
 *            dừng).
 *        `state0` luôn được phép (governor luôn có đường lui về nó).
 *
 *        Chỉ gọi lúc khởi động, không gọi trên đường RT.
 */
#ifndef CORE_CPU_IDLE_CHECK_HPP
#define CORE_CPU_IDLE_CHECK_HPP

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace core {

struct CpuIdleExposure {
    /* false: không đọc được cpuidle của CPU này (không có driver, không phải
     * Linux, sysfs không mount) — không kết luận gì. */
    bool known = false;
    /* Exit latency (µs) lớn nhất mà governor vẫn được phép chọn. */
    int worst_allowed_exit_latency_us = 0;
    /* Tên trạng thái ứng với con số trên, ví dụ "cpu-sleep". */
    std::string worst_state_name;
    /* Ràng buộc QoS đang áp cho CPU: -1 = không ràng buộc. */
    int qos_resume_latency_us = -1;
};

namespace cpu_idle_detail {

inline bool read_first_line(const std::string& path, std::string* out)
{
    std::FILE* file = std::fopen(path.c_str(), "r");
    if (file == nullptr) return false;
    char buffer[128] = {};
    const bool ok = std::fgets(buffer, sizeof(buffer), file) != nullptr;
    std::fclose(file);
    if (!ok) return false;
    std::size_t length = std::strlen(buffer);
    while (length > 0 && (buffer[length - 1] == '\n' || buffer[length - 1] == ' ')) --length;
    out->assign(buffer, length);
    return true;
}

inline bool read_int(const std::string& path, int* out)
{
    std::string text;
    if (!read_first_line(path, &text) || text.empty()) return false;
    char* end = nullptr;
    const long value = std::strtol(text.c_str(), &end, 10);
    if (end == text.c_str() || *end != '\0') return false;
    *out = static_cast<int>(value);
    return true;
}

} // namespace cpu_idle_detail

/* `sysfs_cpu_root` thường là "/sys/devices/system/cpu"; test truyền thư mục
 * tạm có cùng cấu trúc. */
inline CpuIdleExposure cpu_idle_exposure(const std::string& sysfs_cpu_root, int cpu)
{
    using cpu_idle_detail::read_first_line;
    using cpu_idle_detail::read_int;

    CpuIdleExposure result;
    const std::string cpu_dir = sysfs_cpu_root + "/cpu" + std::to_string(cpu);

    std::string qos_text;
    if (read_first_line(cpu_dir + "/power/pm_qos_resume_latency_us", &qos_text)) {
        if (qos_text == "n/a") {
            result.qos_resume_latency_us = 0;
        } else {
            int qos = 0;
            if (read_int(cpu_dir + "/power/pm_qos_resume_latency_us", &qos) && qos > 0)
                result.qos_resume_latency_us = qos;
        }
    }

    for (int index = 0; index < 16; ++index) {
        const std::string state_dir = cpu_dir + "/cpuidle/state" + std::to_string(index);
        int latency_us = 0;
        if (!read_int(state_dir + "/latency", &latency_us)) break;
        result.known = true;
        int disabled = 0;
        if (read_int(state_dir + "/disable", &disabled) && disabled != 0) continue;
        const bool allowed = index == 0 || result.qos_resume_latency_us < 0 ||
                             latency_us <= result.qos_resume_latency_us;
        if (!allowed || latency_us < result.worst_allowed_exit_latency_us) continue;
        result.worst_allowed_exit_latency_us = latency_us;
        std::string name;
        result.worst_state_name =
            read_first_line(state_dir + "/name", &name) ? name : "state" + std::to_string(index);
    }
    return result;
}

} // namespace core

#endif /* CORE_CPU_IDLE_CHECK_HPP */
