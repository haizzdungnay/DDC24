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

#include <dirent.h>

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

/* "0-2,5" (dạng `Cpus_allowed_list`) có chứa `cpu` không. */
inline bool cpu_list_contains(const std::string& list, int cpu)
{
    std::size_t start = 0;
    while (start < list.size()) {
        std::size_t end = list.find(',', start);
        if (end == std::string::npos) end = list.size();
        const std::string item = list.substr(start, end - start);
        const std::size_t dash = item.find('-');
        char* tail = nullptr;
        const long first = std::strtol(item.c_str(), &tail, 10);
        const long last = dash == std::string::npos ? first
                                                    : std::strtol(item.c_str() + dash + 1, nullptr, 10);
        if (tail != item.c_str() && cpu >= first && cpu <= last) return true;
        start = end + 1;
    }
    return false;
}

/* Mask hex dạng "f" hoặc "00000000,00000007" (sysfs cpumask) có bit `cpu` không. */
inline bool cpu_hex_mask_contains(const std::string& mask, int cpu)
{
    int bit = 0;
    for (auto it = mask.rbegin(); it != mask.rend(); ++it) {
        const char c = *it;
        if (c == ',' || c == '\n' || c == ' ') continue;
        int nibble = -1;
        if (c >= '0' && c <= '9') nibble = c - '0';
        else if (c >= 'a' && c <= 'f') nibble = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') nibble = c - 'A' + 10;
        if (nibble < 0) return false;
        if (cpu >= bit && cpu < bit + 4) return ((nibble >> (cpu - bit)) & 1) != 0;
        bit += 4;
    }
    return false;
}

/* ADR-061 4.11 / F14 — CPU của vòng quét có còn phải chia cho việc nền không.
 *
 *        Đo trên Foxlinx 2026-09-26: chỉ ghim các service mkddc thì PID 1,
 *        journald, sshd và kworker unbound vẫn chạy trên CPU3; một lần
 *        `systemctl restart` làm vòng quét thức dậy trễ 2,3–3,8 ms (có lần 12 ms,
 *        lỡ một base step). Ghim chúng sang CPU0–2 thì còn 117–119 µs. */
struct HousekeepingExposure {
    bool pid1_known = false;
    bool pid1_on_cpu = false;
    std::string pid1_cpus;
    bool workqueue_known = false;
    bool workqueue_on_cpu = false;
    std::string workqueue_mask;
};

inline HousekeepingExposure housekeeping_exposure(const std::string& proc_root,
                                                  const std::string& sysfs_workqueue_mask, int cpu)
{
    HousekeepingExposure result;
    std::FILE* status = std::fopen((proc_root + "/1/status").c_str(), "r");
    if (status != nullptr) {
        char line[256];
        while (std::fgets(line, sizeof(line), status) != nullptr) {
            static constexpr char kKey[] = "Cpus_allowed_list:";
            if (std::strncmp(line, kKey, sizeof(kKey) - 1) != 0) continue;
            std::string value(line + sizeof(kKey) - 1);
            while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) value.erase(0, 1);
            while (!value.empty() && (value.back() == '\n' || value.back() == ' ')) value.pop_back();
            result.pid1_known = !value.empty();
            result.pid1_cpus = value;
            result.pid1_on_cpu = cpu_list_contains(value, cpu);
            break;
        }
        std::fclose(status);
    }
    std::string mask;
    if (cpu_idle_detail::read_first_line(sysfs_workqueue_mask, &mask) && !mask.empty()) {
        result.workqueue_known = true;
        result.workqueue_mask = mask;
        result.workqueue_on_cpu = cpu_hex_mask_contains(mask, cpu);
    }
    return result;
}

/* Cờ `PF_NO_SETAFFINITY` (include/linux/sched.h): kernel tự quản affinity của
 * thread (rescuer workqueue, kworker unbound, sugov) và từ chối mọi
 * `sched_setaffinity` từ user-space. */
constexpr unsigned long kPfNoSetAffinity = 0x04000000ul;

/* Trường `flags` (trường 9) của `/proc/<pid>/stat`; comm có thể chứa khoảng
 * trắng và ngoặc nên đọc từ sau dấu ')' CUỐI. Trả false khi không đọc được. */
inline bool read_task_flags(const std::string& stat_path, unsigned long* flags)
{
    std::FILE* file = std::fopen(stat_path.c_str(), "r");
    if (file == nullptr) return false;
    char buffer[1024] = {};
    const std::size_t length = std::fread(buffer, 1, sizeof(buffer) - 1, file);
    std::fclose(file);
    buffer[length] = '\0';
    const char* cursor = std::strrchr(buffer, ')');
    if (cursor == nullptr) return false;
    ++cursor;
    /* Sau ')': state ppid pgrp session tty_nr tpgid flags → flags là token thứ 7. */
    for (int token = 0; token < 6; ++token) {
        while (*cursor == ' ') ++cursor;
        while (*cursor != ' ' && *cursor != '\0') ++cursor;
    }
    char* end = nullptr;
    const unsigned long value = std::strtoul(cursor, &end, 10);
    if (end == cursor) return false;
    *flags = value;
    return true;
}

/* ADR-061 4.11 / F15 — số kernel thread KHÔNG gắn CPU (con của kthreadd, được
 * phép chạy trên nhiều CPU) còn được chạy trên `cpu` mà user-space DỜI ĐƯỢC.
 * Không tính: thread gắn một CPU (ksoftirqd/N, kworker/N:*) và thread có
 * `PF_NO_SETAFFINITY` (kernel tự quản, `rt-housekeeping` cũng không dời được —
 * trên Foxlinx có 35 thread loại này, đều là rescuer/kworker unbound).
 *
 *        Đo trên Foxlinx 2026-09-26: luồng TX của driver Wi-Fi (`RTW_*`) được
 *        đánh thức trên CPU3 mỗi lần web gửi gói, làm 0,73 % lần thức dậy của
 *        vòng quét vượt 100 µs; dời hết thread loại này sang CPU0–2 thì 0 lần
 *        vượt trong hai cửa sổ 60 s. `/usr/libexec/mkddc/rt-housekeeping` (unit
 *        mkddc-core) làm việc dời; hàm này chỉ ĐẾM để Core nói ra khi thiếu. */
inline int unbound_kthreads_on_cpu(const std::string& proc_root, int cpu)
{
    DIR* dir = ::opendir(proc_root.c_str());
    if (dir == nullptr) return -1;
    int count = 0;
    while (const struct dirent* entry = ::readdir(dir)) {
        const char* name = entry->d_name;
        if (name[0] < '0' || name[0] > '9') continue;
        std::FILE* status = std::fopen((proc_root + "/" + name + "/status").c_str(), "r");
        if (status == nullptr) continue;
        long ppid = -1;
        std::string allowed;
        char line[256];
        while (std::fgets(line, sizeof(line), status) != nullptr) {
            if (std::strncmp(line, "PPid:", 5) == 0) {
                ppid = std::strtol(line + 5, nullptr, 10);
            } else if (std::strncmp(line, "Cpus_allowed_list:", 18) == 0) {
                allowed.assign(line + 18);
                while (!allowed.empty() && (allowed.front() == ' ' || allowed.front() == '\t'))
                    allowed.erase(0, 1);
                while (!allowed.empty() && (allowed.back() == '\n' || allowed.back() == ' '))
                    allowed.pop_back();
            }
        }
        std::fclose(status);
        const bool kernel_thread = std::strcmp(name, "2") == 0 || ppid == 2;
        /* Gắn một CPU ⇒ danh sách không có '-' hay ',' (ví dụ "3"). */
        const bool bound = allowed.find_first_of("-,") == std::string::npos;
        if (!kernel_thread || bound || !cpu_list_contains(allowed, cpu)) continue;
        unsigned long flags = 0;
        if (read_task_flags(proc_root + "/" + name + "/stat", &flags) && (flags & kPfNoSetAffinity) != 0)
            continue;
        ++count;
    }
    ::closedir(dir);
    return count;
}

} // namespace core

#endif /* CORE_CPU_IDLE_CHECK_HPP */
