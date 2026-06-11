/**
 * @file  realtime.hpp
 * @brief SCHED_FIFO + mlockall (06 §3.13). Thiếu cap → WARN, chạy degraded.
 */
#ifndef IOBUS_REALTIME_HPP
#define IOBUS_REALTIME_HPP

namespace iobus {

bool set_rt(int prio);   /* SCHED_FIFO cho thread hiện tại */
bool lock_mem();         /* mlockall(MCL_CURRENT|MCL_FUTURE) */

} // namespace iobus

#endif /* IOBUS_REALTIME_HPP */
