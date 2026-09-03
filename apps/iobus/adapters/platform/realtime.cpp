#include "platform/realtime.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>

#include <pthread.h>
#include <sys/mman.h>
#include <sys/resource.h>

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

/* MCL_FUTURE chỉ an toàn khi RLIMIT_MEMLOCK là vô hạn.
 *
 * Với một trần hữu hạn, `mlockall(MCL_CURRENT|MCL_FUTURE)` vẫn TRẢ VỀ 0 — nó chỉ
 * khoá phần đang map, vừa trong trần. Cái bẫy nằm ở MCL_FUTURE: từ đó trở đi MỌI
 * mapping mới đều phải khoá được, nên `pthread_create` (stack 8 MB) hỏng với
 * EAGAIN, `std::thread` ném `std::system_error` và tiến trình abort — cách chỗ
 * gọi mlockall vài chục dòng, với một thông điệp không nhắc gì tới memlock.
 *
 * Đây đúng là cách `mkddc-iobus` và `mkddc-core` chết ngay lúc khởi động ở lane
 * E2E real-backend trên CI: runner chạy user thường với trần 8 MB, log dừng ở
 * "terminate called after throwing an instance of 'std::system_error'".
 *
 * Unit systemd của bản thật đặt `LimitMEMLOCK=infinity` + `CAP_IPC_LOCK`, nên bo
 * thật đi đúng nhánh đầy đủ. Ở nơi không có trần đó, hợp đồng đã ghi ngay trên
 * hàm này là "thiếu cap → WARN, chạy degraded" — nên phải degrade thật: khoá
 * MCL_CURRENT (có giá trị, không gài mìn) và báo suy giảm, chứ không chết.
 */
bool memlock_future_allowed()
{
    struct rlimit lim {};
    if (getrlimit(RLIMIT_MEMLOCK, &lim) != 0) return false;
    return lim.rlim_cur == RLIM_INFINITY;
}

bool lock_mem()
{
    if (!memlock_future_allowed()) {
        std::fprintf(stderr,
                     "WARN  rt.mlockall_partial RLIMIT_MEMLOCK hữu hạn — chỉ khoá MCL_CURRENT,"
                     " KHÔNG bật MCL_FUTURE (degraded; cần LimitMEMLOCK=infinity + CAP_IPC_LOCK)\n");
        if (mlockall(MCL_CURRENT) != 0)
            std::fprintf(stderr, "WARN  rt.mlockall_fail errno=%d (%s) (degraded)\n",
                         errno, std::strerror(errno));
        return false;
    }
    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
        std::fprintf(stderr, "WARN  rt.mlockall_fail errno=%d (%s) (degraded)\n",
                     errno, std::strerror(errno));
        return false;
    }
    return true;
}

} // namespace iobus
