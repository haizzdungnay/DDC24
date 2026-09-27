/**
 * @file  thread_policy.hpp
 * @brief `MBA-FW-01` (audit Modbus 2026-09-25): đưa thread phụ của core về
 *        SCHED_OTHER và đặt tên cho nó. ADR-061 4.10 bước 2 (X19): đồng thời
 *        dời nó RA KHỎI CPU của vòng quét.
 *
 * `main` đặt SCHED_FIFO cho CHÍNH NÓ (vòng scan) trước khi tạo thread phụ, và
 * `std::thread` thừa hưởng chính sách đó. Đo trên bo Forlinx 2026-09-25: cả 3
 * thread của `mkddc-core` chạy `policy=1 rtprio=80` — nghĩa là thread IPC
 * Programming (phục vụ Check/Commission/Simulate từ web) và thread ghi RETAIN
 * xuống đĩa đứng TRÊN vòng IOP 2 ms của `mkddc-iobus` (rtprio 70) và có thể
 * chiếm CPU của nó bất cứ lúc nào chúng bận. FW_SOM_DESIGN §2 chỉ cho
 * `scan_loop` chạy SCHED_FIFO.
 *
 * Hạ về SCHED_OTHER CHƯA ĐỦ. Unit core đặt `CPUAffinity=3` cho cả tiến trình,
 * nên thread phụ vẫn thừa hưởng affinity {3}: nó chạy trên CPU của vòng quét
 * mỗi lúc vòng quét ngủ. Trên kernel `PREEMPT_VOLUNTARY`, một syscall dài của
 * nó (ghi file, fsync, gửi socket) giữ CPU3 tới khi syscall nhả, và vòng quét
 * thức dậy trễ đúng bằng thời gian đó — cùng họ lỗi với F14 (tiến trình hệ
 * thống trên CPU3), chỉ khác là lần này do chính Core. Vì vậy thread phụ phải
 * tự `pthread_setaffinity_np` sang các CPU còn lại, và nói ra khi không rời được.
 *
 * Worker PARALLEL của `StScheduler` KHÔNG dùng hàm này: chúng chạy lane của
 * chính vòng scan nên phải giữ mức RT của scan.
 */
#ifndef CORE_THREAD_POLICY_HPP
#define CORE_THREAD_POLICY_HPP

#include <atomic>
#include <cerrno>
#include <cstddef>
#include <cstdio>
#include <pthread.h>
#include <sched.h>
#include <unistd.h>

namespace core {

namespace thread_policy_detail {

struct ScanCpus {
    std::atomic<bool> known{false};
    bool pinned = false;
    cpu_set_t set{};
};

/* Một thực thể duy nhất cho mọi translation unit (hàm inline C++17). */
inline ScanCpus& scan_cpus()
{
    static ScanCpus cpus;
    return cpus;
}

inline long configured_cpus()
{
    const long count = ::sysconf(_SC_NPROCESSORS_CONF);
    return count > 0 && count <= CPU_SETSIZE ? count : 1;
}

/* Tiến trình được ghim CPU riêng khi affinity là tập con THẬT SỰ của CPU của
 * máy — cùng quy tắc với kiểm `rt.scan_cpu_not_pinned` trong `main.cpp`. Không
 * ghim (máy dev) thì không có "CPU của vòng quét" nào phải tránh. */
inline bool pinned_subset(const cpu_set_t& affinity)
{
    const int count = CPU_COUNT(&affinity);
    const long online = ::sysconf(_SC_NPROCESSORS_ONLN);
    return count > 0 && online > 0 && count < online;
}

inline void format_cpus(const cpu_set_t& set, char* out, std::size_t size)
{
    std::size_t used = 0;
    if (size == 0) return;
    out[0] = '\0';
    for (int cpu = 0; cpu < CPU_SETSIZE && used + 1 < size; ++cpu) {
        if (!CPU_ISSET(cpu, &set)) continue;
        const int written = std::snprintf(out + used, size - used, used == 0 ? "%d" : ",%d", cpu);
        if (written < 0) break;
        used += static_cast<std::size_t>(written);
    }
    if (used == 0) std::snprintf(out, size, "-");
}

} // namespace thread_policy_detail

/* `main` gọi MỘT LẦN, trên luồng quét, TRƯỚC khi tạo bất kỳ thread phụ nào:
 * ghi nhận affinity lúc đó là tập CPU của vòng quét. Không gọi thì thread phụ
 * suy ra từ affinity nó thừa hưởng (đúng khi nó được tạo từ luồng quét). */
inline void remember_scan_cpus()
{
    thread_policy_detail::ScanCpus& cpus = thread_policy_detail::scan_cpus();
    cpu_set_t affinity;
    CPU_ZERO(&affinity);
    if (::sched_getaffinity(0, sizeof(affinity), &affinity) != 0) return;
    cpus.set = affinity;
    cpus.pinned = thread_policy_detail::pinned_subset(affinity);
    cpus.known.store(true, std::memory_order_release);
}

/* Dời THREAD GỌI HÀM ra khỏi `scan_cpus` (sang mọi CPU còn lại) rồi đọc lại
 * affinity thật để xác nhận. true = không còn CPU nào của vòng quét trong
 * affinity. false = còn (log `WARN rt.thread_on_scan_cpu`). */
inline bool move_off_cpus(const cpu_set_t& scan_cpus, const char* thread_name)
{
    const char* name = thread_name && thread_name[0] != '\0' ? thread_name : "-";
    cpu_set_t allowed;
    CPU_ZERO(&allowed);
    const long cpus = thread_policy_detail::configured_cpus();
    for (int cpu = 0; cpu < cpus; ++cpu)
        if (!CPU_ISSET(cpu, &scan_cpus)) CPU_SET(cpu, &allowed);
    char scan_text[64];
    thread_policy_detail::format_cpus(scan_cpus, scan_text, sizeof(scan_text));
    if (CPU_COUNT(&allowed) == 0) {
        std::fprintf(stderr,
                     "WARN  rt.thread_on_scan_cpu name=%s scan_cpus=%s reason=no_other_cpu"
                     " — luong khong-RT phai chung CPU voi vong quet (ADR-061 4.10)\n",
                     name, scan_text);
        return false;
    }
    const int rc = ::pthread_setaffinity_np(::pthread_self(), sizeof(allowed), &allowed);
    cpu_set_t actual;
    CPU_ZERO(&actual);
    const bool read_back = ::pthread_getaffinity_np(::pthread_self(), sizeof(actual), &actual) == 0;
    bool on_scan = !read_back;
    for (int cpu = 0; read_back && cpu < CPU_SETSIZE; ++cpu)
        if (CPU_ISSET(cpu, &actual) && CPU_ISSET(cpu, &scan_cpus)) on_scan = true;
    char actual_text[64];
    thread_policy_detail::format_cpus(actual, actual_text, sizeof(actual_text));
    if (rc != 0 || on_scan) {
        std::fprintf(stderr,
                     "WARN  rt.thread_on_scan_cpu name=%s scan_cpus=%s cpus=%s rc=%d"
                     " — luong khong-RT KHONG roi duoc CPU vong quet; syscall dai cua no"
                     " co the lam vong quet thuc day tre (C4, ADR-061 4.10)\n",
                     name, scan_text, actual_text, rc);
        return false;
    }
    std::fprintf(stderr, "INFO  rt.thread_off_scan_cpu name=%s scan_cpus=%s cpus=%s\n", name,
                 scan_text, actual_text);
    return true;
}

/* Hạ thread GỌI HÀM về SCHED_OTHER, đặt tên, và dời nó khỏi CPU của vòng quét.
 * true chỉ khi CẢ HAI thành công. */
inline bool demote_to_normal_sched(const char* thread_name)
{
    if (thread_name && thread_name[0] != '\0') {
        char name[16] = {};
        std::snprintf(name, sizeof(name), "%s", thread_name);
        (void)::pthread_setname_np(::pthread_self(), name);
    }
    struct sched_param sp {};
    sp.sched_priority = 0;
    if (::pthread_setschedparam(::pthread_self(), SCHED_OTHER, &sp) != 0) {
        std::fprintf(stderr, "WARN  rt.thread_demote_fail name=%s errno=%d\n",
                     thread_name ? thread_name : "-", errno);
    }

    /* Tập CPU phải tránh: bản `main` đã ghi nhận, nếu không thì suy từ affinity
     * thừa hưởng (thread tạo từ luồng quét mang affinity của luồng quét). */
    bool left_scan_cpus = true;
    const thread_policy_detail::ScanCpus& cpus = thread_policy_detail::scan_cpus();
    if (cpus.known.load(std::memory_order_acquire)) {
        if (cpus.pinned) left_scan_cpus = move_off_cpus(cpus.set, thread_name);
    } else {
        cpu_set_t inherited;
        CPU_ZERO(&inherited);
        if (::pthread_getaffinity_np(::pthread_self(), sizeof(inherited), &inherited) == 0 &&
            thread_policy_detail::pinned_subset(inherited))
            left_scan_cpus = move_off_cpus(inherited, thread_name);
    }

    int policy = -1;
    struct sched_param now {};
    if (::pthread_getschedparam(::pthread_self(), &policy, &now) != 0) return false;
    return policy == SCHED_OTHER && left_scan_cpus;
}

} // namespace core

#endif /* CORE_THREAD_POLICY_HPP */
