/**
 * @file  realtime.hpp
 * @brief SCHED_FIFO + mlockall (06 §3.13). Thiếu cap → WARN, chạy degraded.
 */
#ifndef IOBUS_REALTIME_HPP
#define IOBUS_REALTIME_HPP

namespace iobus {

bool set_rt(int prio);   /* SCHED_FIFO cho thread hiện tại */

/* true khi RLIMIT_MEMLOCK vô hạn — điều kiện DUY NHẤT khiến MCL_FUTURE an toàn.
 * Công bố ra header để bất biến này kiểm được trực tiếp, thay vì chỉ suy ra từ
 * việc tiến trình có sống sót hay không (phép suy đó chỉ có răng khi chạy không
 * đặc quyền, vì CAP_IPC_LOCK bỏ qua RLIMIT_MEMLOCK). */
bool memlock_future_allowed();

/* mlockall: MCL_CURRENT|MCL_FUTURE khi `memlock_future_allowed()`, ngược lại chỉ
 * MCL_CURRENT. Trả về true chỉ khi khoá được đầy đủ (RT guarantee còn nguyên). */
bool lock_mem();

} // namespace iobus

#endif /* IOBUS_REALTIME_HPP */
