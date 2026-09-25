/**
 * @file  thread_policy.hpp
 * @brief `MBA-FW-01`: đưa một thread KHÔNG thuộc vòng IOP về SCHED_OTHER và đặt
 *        tên cho nó.
 *
 * Vì sao cần gọi tường minh: `main` gọi `set_rt()` (SCHED_FIFO) cho CHÍNH NÓ
 * trước khi tạo các thread phụ, và thread tạo bằng `std::thread` thừa hưởng
 * chính sách lập lịch của thread cha (`PTHREAD_INHERIT_SCHED` là mặc định của
 * glibc). Đo trên bo Forlinx 2026-09-25: cả 5 thread của `mkddc-iobus` — gồm
 * hai BusWorker Modbus, luồng publish và kênh điều khiển — đều chạy
 * `policy=1 rtprio=70`, đúng mức của vòng IOP 2 ms. Bất biến
 * FW_SOM_DESIGN §2 "Modbus không bao giờ chạy SCHED_FIFO" vì vậy bị vi phạm
 * trên target dù chú thích trong mã nói ngược lại.
 *
 * Đặt tên thread (≤ 15 ký tự) để `/proc/<pid>/task/<tid>/comm` và `top -H`
 * phân biệt được luồng nào đang ngốn CPU — trước bản này cả 5 thread đều mang
 * tên `mkddc-iobus`.
 */
#ifndef IOBUS_THREAD_POLICY_HPP
#define IOBUS_THREAD_POLICY_HPP

#include <cerrno>
#include <cstdio>
#include <pthread.h>
#include <sched.h>

namespace iobus::fieldbus {

/* Trả true nếu thread hiện tại đã ở SCHED_OTHER sau lời gọi. */
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
    int policy = -1;
    struct sched_param now {};
    if (::pthread_getschedparam(::pthread_self(), &policy, &now) != 0) return false;
    return policy == SCHED_OTHER;
}

} // namespace iobus::fieldbus

#endif /* IOBUS_THREAD_POLICY_HPP */
