/**
 * @file  test_realtime_memlock.cpp
 * @brief Hồi quy: `lock_mem()` KHÔNG được biến trần RLIMIT_MEMLOCK hữu hạn
 *        thành một cái bẫy abort ở lần cấp mapping mới đầu tiên.
 *
 * Lỗi gốc: `mlockall(MCL_CURRENT|MCL_FUTURE)` vẫn trả về 0 dưới trần hữu hạn
 * (phần đang map vừa trong trần). Bẫy nằm ở MCL_FUTURE: từ đó MỌI mapping mới
 * đều phải khoá được, nên `pthread_create` xin stack mới hỏng với EAGAIN,
 * `std::thread` ném `std::system_error`, không ai bắt, và tiến trình abort.
 * `mkddc-iobus` lẫn `mkddc-core` chết đúng kiểu đó ngay lúc khởi động trên
 * runner CI (user thường, trần 8 MB); log dừng ở một dòng không nhắc memlock.
 *
 * Hai điều làm test này tất định:
 *  - Chạy trong tiến trình CON: `setrlimit`/`mlockall` là trạng thái toàn tiến
 *    trình; đặt trong tiến trình test sẽ rò sang mọi test chạy sau. Con abort
 *    thì cha đọc được qua wait status — đúng triệu chứng cần khoá.
 *  - Xin stack LỚN và tường minh: glibc giữ cache stack của thread đã join, nên
 *    một `std::thread` mặc định có thể tái dùng mapping cũ và KHÔNG cấp mapping
 *    mới — lúc đó bẫy không sập và phép kiểm mất răng. Kích thước lớn buộc phải
 *    có mapping mới, đúng như tiến trình thật lúc khởi động.
 */
#include <gtest/gtest.h>

#include <pthread.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cstdlib>
#include <thread>

#include "platform/realtime.hpp"

namespace {

/* Mã thoát của tiến trình con — phân biệt ba kết cục khác nhau về ý nghĩa. */
constexpr int kOk              = 0;   /* cấp được mapping mới */
constexpr int kMlockallRefused = 70;  /* mlockall hỏng: không gài được bẫy */
constexpr int kThreadRefused   = 71;  /* pthread_create hỏng: bẫy đã sập */
constexpr int kSetrlimitFailed = 90;

/* Trần và stack được chọn theo QUAN HỆ giữa chúng, không theo số tuyệt đối:
 *  - trần phải đủ lớn để `mlockall(MCL_CURRENT)` của CHÍNH binary test thành
 *    công (binary gtest này lớn hơn nhiều so với `mkddc-iobus`; lấy trần 8 MB
 *    như runner CI thì mlockall hỏng ngay và không gài được bẫy);
 *  - stack phải lớn hơn phần trần còn lại, để mapping mới chắc chắn vượt trần
 *    khi MCL_FUTURE đang bật.
 */
/* Trần phải NHỎ HƠN hard limit thừa kế: tiến trình không đặc quyền chỉ được HẠ
 * RLIMIT_MEMLOCK, không được nâng. 1 MB nhỏ hơn stack mặc định của một thread,
 * nên MCL_FUTURE (nếu bị bật) chắc chắn chặn mapping mới. */
constexpr rlim_t kMemlockLimit = 1u << 20;   /* 1 MB */
constexpr size_t kBigStack     = 32u << 20;  /* 32 MB */

void* noop(void*) { return nullptr; }

/* Tạo thread với stack lớn tường minh. Trả về mã thoát tương ứng. */
int spawn_thread_with_big_stack()
{
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, kBigStack);
    pthread_t tid;
    const int rc = pthread_create(&tid, &attr, noop, nullptr);
    pthread_attr_destroy(&attr);
    if (rc != 0) return kThreadRefused;
    pthread_join(tid, nullptr);
    return kOk;
}

int run_child_with_memlock(rlim_t limit_bytes, int (*body)())
{
    const pid_t pid = fork();
    if (pid == 0) {
        /* HẠ soft limit, GIỮ NGUYÊN hard limit.
         *
         * Tiến trình không đặc quyền chỉ được hạ `rlim_max`, không được nâng.
         * Đặt cứng cả hai bằng một hằng số làm test đỏ với mã 90 ở bất kỳ
         * container nào có hard limit thấp hơn hằng số đó — đỏ vì môi trường,
         * trước cả khi chạm tới hành vi đang cần kiểm. Hạ `rlim_cur` thì luôn
         * hợp lệ, và kẹp theo `rlim_max` thừa kế thì không bao giờ phải nâng. */
        struct rlimit lim {};
        if (getrlimit(RLIMIT_MEMLOCK, &lim) != 0) _exit(kSetrlimitFailed);
        if (lim.rlim_max != RLIM_INFINITY && lim.rlim_max < limit_bytes)
            limit_bytes = lim.rlim_max;
        lim.rlim_cur = limit_bytes;
        if (setrlimit(RLIMIT_MEMLOCK, &lim) != 0) _exit(kSetrlimitFailed);
        _exit(body());
    }
    int status = 0;
    waitpid(pid, &status, 0);
    return status;
}

int lock_mem_then_spawn()
{
    iobus::lock_mem();
    /* `std::thread` là lời gọi THẬT đã abort trong bản lỗi — giữ nguyên nó ở
     * đây để hồi quy bám đúng triệu chứng, rồi mới tới phép kiểm tất định. */
    std::thread t([] {});
    t.join();
    return spawn_thread_with_big_stack();
}

int arm_mcl_future_then_spawn()
{
    if (::mlockall(MCL_CURRENT | MCL_FUTURE) != 0) return kMlockallRefused;
    return spawn_thread_with_big_stack();
}

int report_future_allowed()
{
    return iobus::memlock_future_allowed() ? kOk : kThreadRefused;
}

/* Phép kiểm TẤT ĐỊNH của bất biến, chạy được ở mọi môi trường kể cả root:
 * dưới trần hữu hạn, quyết định phải là "không bật MCL_FUTURE". Phép kiểm hành
 * vi phía dưới chỉ có răng khi chạy không đặc quyền, nên mệnh đề này mới là cổng
 * chính. */
TEST(RealtimeMemlock, FiniteLimitMustNotAllowMclFuture)
{
    const int status = run_child_with_memlock(kMemlockLimit, report_future_allowed);

    ASSERT_TRUE(WIFEXITED(status));
    EXPECT_EQ(WEXITSTATUS(status), kThreadRefused)
        << "trần memlock hữu hạn mà vẫn cho phép MCL_FUTURE — đó chính là cái bẫy"
           " làm mkddc-iobus/mkddc-core abort lúc khởi động";
}

TEST(RealtimeMemlock, FiniteLimitDegradesInsteadOfAbortingOnFirstThread)
{
    const int status = run_child_with_memlock(kMemlockLimit, lock_mem_then_spawn);

    ASSERT_FALSE(WIFSIGNALED(status))
        << "tiến trình chết vì signal " << WTERMSIG(status)
        << " — lock_mem() bật MCL_FUTURE dưới trần hữu hạn và biến mapping mới"
           " đầu tiên thành abort";
    ASSERT_TRUE(WIFEXITED(status));
    EXPECT_EQ(WEXITSTATUS(status), kOk)
        << "con phải chạy hết: lock_mem() degrade, thread cấp được stack mới";
}

/* Đối chứng: cùng trần, nhưng bật MCL_FUTURE trực tiếp (hành vi cũ) thì KHÔNG
 * được chạy trót lọt. Không có mệnh đề này, phép kiểm trên vẫn xanh cả khi trần
 * memlock chẳng có tác dụng gì trong môi trường chạy test. */
TEST(RealtimeMemlock, MclFutureUnderFiniteLimitIsTheTrapWeGuardAgainst)
{
    /* CAP_IPC_LOCK cho phép BỎ QUA RLIMIT_MEMLOCK, nên chạy bằng root thì trần
     * đặt ở trên không được thi hành và bẫy không thể sập — nhánh đối chứng mất
     * ý nghĩa. Runner CI chạy user thường, đúng chỗ phép kiểm này có răng; ở đó
     * một kết cục "chạy trót lọt" vẫn là FAIL thật. */
    if (geteuid() == 0) {
        GTEST_SKIP() << "chạy với quyền root: CAP_IPC_LOCK bỏ qua RLIMIT_MEMLOCK,"
                        " không gài được bẫy để đối chứng";
    }
    const int status = run_child_with_memlock(kMemlockLimit, arm_mcl_future_then_spawn);

    ASSERT_TRUE(WIFEXITED(status))
        << "con chết vì signal " << WTERMSIG(status)
        << " — vẫn là bằng chứng bẫy sập, nhưng nhánh này mong đợi mã thoát";
    const int code = WEXITSTATUS(status);
    if (code == kMlockallRefused) {
        GTEST_SKIP() << "môi trường không bật được MCL_FUTURE (mlockall hỏng),"
                        " không gài được bẫy để đối chứng";
    }
    EXPECT_EQ(code, kThreadRefused)
        << "hành vi cũ phải bị từ chối cấp stack dưới trần hữu hạn;"
           " chạy trót lọt nghĩa là RLIMIT_MEMLOCK không có tác dụng"
           " và phép kiểm kia mất giá trị";
}

} // namespace
