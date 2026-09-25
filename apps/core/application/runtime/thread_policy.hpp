/**
 * @file  thread_policy.hpp
 * @brief `MBA-FW-01` (audit Modbus 2026-09-25): đưa thread phụ của core về
 *        SCHED_OTHER và đặt tên cho nó.
 *
 * `main` đặt SCHED_FIFO cho CHÍNH NÓ (vòng scan) trước khi tạo thread phụ, và
 * `std::thread` thừa hưởng chính sách đó. Đo trên bo Forlinx 2026-09-25: cả 3
 * thread của `mkddc-core` chạy `policy=1 rtprio=80` — nghĩa là thread IPC
 * Programming (phục vụ Check/Commission/Simulate từ web) và thread ghi RETAIN
 * xuống đĩa đứng TRÊN vòng IOP 2 ms của `mkddc-iobus` (rtprio 70) và có thể
 * chiếm CPU của nó bất cứ lúc nào chúng bận. FW_SOM_DESIGN §2 chỉ cho
 * `scan_loop` chạy SCHED_FIFO.
 *
 * Worker PARALLEL của `StScheduler` KHÔNG dùng hàm này: chúng chạy lane của
 * chính vòng scan nên phải giữ mức RT của scan.
 */
#ifndef CORE_THREAD_POLICY_HPP
#define CORE_THREAD_POLICY_HPP

#include <cerrno>
#include <cstdio>
#include <pthread.h>
#include <sched.h>

namespace core {

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

} // namespace core

#endif /* CORE_THREAD_POLICY_HPP */
