#include "platform/realtime.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>

#include <pthread.h>
#include <sys/mman.h>

namespace iobus {

bool set_rt(int prio)
{
    struct sched_param sp {};
    sp.sched_priority = prio;
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) != 0) {
        std::fprintf(stderr, "WARN  rt.sched_fifo_fail prio=%d errno=%d (degraded SCHED_OTHER)\n",
                     prio, errno);
        return false;
    }
    std::fprintf(stderr, "INFO  rt.sched_fifo prio=%d\n", prio);
    return true;
}

bool lock_mem()
{
    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
        std::fprintf(stderr, "WARN  rt.mlockall_fail errno=%d (%s) (degraded)\n",
                     errno, std::strerror(errno));
        return false;
    }
    return true;
}

} // namespace iobus
