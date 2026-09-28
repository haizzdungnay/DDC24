/**
 * @file  test_poll_loop_timing.cpp
 * @brief T63-004 (PERF-SYS-05/07): thống kê phút của vòng poll IOP tách đúng
 *        độ trễ đánh thức, thời gian làm việc, khoảng IO_RESP, SỰ KIỆN trễ và
 *        số vòng chạy bù — đo bằng đồng hồ giả, không phụ thuộc máy chạy test.
 *
 *        `SimLoop` tái hiện đúng nhịp của `apps/iobus/bootstrap/main.cpp`:
 *        ngủ `TIMER_ABSTIME` tới mốc (mốc ở quá khứ ⇒ không ngủ), rồi mốc kế
 *        tiếp = mốc cũ + một chu kỳ, không kiểm mốc đã qua (`sleep_until`).
 *        Chế độ `skip_missed` tái hiện chính sách "lỡ thì bỏ" của Core
 *        (`BaseStepPacer::advance`) để khoá rằng `late_events` giữ nghĩa khi
 *        T63-201 đổi chính sách.
 */
#include <gtest/gtest.h>

#include <cstring>
#include <regex>
#include <string>

#include "diagnostics/poll_loop_timing.hpp"
#include "tests/allocation_probe.hpp"

using iobus::PollLoopMinute;
using iobus::PollLoopTiming;

namespace {

constexpr uint64_t kUs = 1000ull;
constexpr uint64_t kMs = 1000000ull;
constexpr uint64_t kPeriod = 2 * kMs;          /* IOP_GET_IO_PERIOD_MS */
constexpr uint64_t kWork = 1400 * kUs;         /* giao dịch IOP ≈1,4 ms (iop_protocol.h) */
constexpr uint64_t kWakeLatency = 50 * kUs;

struct SimLoop {
    uint64_t clock_ns = 1000 * kMs;
    uint64_t period_ns = kPeriod;
    /* Mốc đầu ở tương lai để cả vòng đầu cũng ngủ và thức trễ như mọi vòng
     * ổn định khác — khoảng IO_RESP ở trạng thái ổn định đúng bằng một chu kỳ. */
    uint64_t deadline_ns = clock_ns + kPeriod;
    bool skip_missed = false;
    PollLoopTiming timing;
    /* Luật đếm của dòng `iobus.jitter` cũ: mỗi vòng có lệch > 1 chu kỳ là một
     * `overrun` — giữ ở đây để so với `late_events`. */
    uint64_t legacy_overruns = 0;

    void iterate(uint64_t work_ns = kWork, uint64_t wake_latency_ns = kWakeLatency,
                 bool io_ok = true)
    {
        if (clock_ns < deadline_ns) clock_ns = deadline_ns + wake_latency_ns;
        if (clock_ns > deadline_ns && clock_ns - deadline_ns > period_ns) ++legacy_overruns;
        timing.on_wake(deadline_ns, clock_ns);
        clock_ns += work_ns;
        if (io_ok) timing.on_io_resp(clock_ns);
        timing.on_work_end(clock_ns, period_ns);
        uint64_t next = deadline_ns + period_ns;
        if (skip_missed && clock_ns >= next)
            next += ((clock_ns - next) / period_ns + 1u) * period_ns;
        deadline_ns = next;
    }

    void run(int iterations)
    {
        for (int i = 0; i < iterations; ++i) iterate();
    }
};

} // namespace

TEST(PollLoopTiming, SteadyStateHasNoLateEventAndNoCatchup)
{
    SimLoop loop;
    loop.run(1000);
    const PollLoopMinute m = loop.timing.minute_at(loop.clock_ns);
    EXPECT_EQ(m.iterations, 1000u);
    EXPECT_EQ(m.late_events, 0u);
    EXPECT_EQ(m.catchup_iterations, 0u);
    EXPECT_EQ(m.wake_late_max_ns, kWakeLatency);
    EXPECT_EQ(m.work_max_ns, kWork);
    EXPECT_EQ(m.io_resp_count, 1000u);
    EXPECT_EQ(m.io_resp_gap_max_ns, kPeriod);
    EXPECT_EQ(loop.legacy_overruns, 0u);
}

/* AC T63-004: "test đồng hồ giả cho một lần kẹt 16 ms ⇒ late_events=1".
 * Kẹt trong phần làm việc (vd UART chặn): vòng kẹt làm xong ở D+16,05 ms, sau
 * đó 24 vòng chạy bù liền nhau mới bắt kịp lưới (mỗi vòng chỉ gỡ được
 * 2 − 1,4 = 0,6 ms). Luật `overruns` cũ đếm 21 lần cho cùng một lần kẹt. */
TEST(PollLoopTiming, OneWorkStallOf16msIsOneLateEvent)
{
    SimLoop loop;
    loop.run(100);
    loop.iterate(16 * kMs);
    loop.run(200);
    const PollLoopMinute m = loop.timing.minute();
    EXPECT_EQ(m.late_events, 1u);
    EXPECT_EQ(m.catchup_iterations, 24u);
    EXPECT_EQ(loop.legacy_overruns, 21u) << "luật cũ đếm từng vòng chạy bù";
    EXPECT_EQ(m.work_max_ns, 16 * kMs);
    /* Vòng chạy bù không ngủ ⇒ không góp vào độ trễ đánh thức. */
    EXPECT_EQ(m.wake_late_max_ns, kWakeLatency);
    /* IO_RESP trước kẹt ở D−0,55 ms, IO_RESP của vòng kẹt ở D+16,05 ms. */
    EXPECT_EQ(m.io_resp_gap_max_ns, 16600 * kUs);
}

/* Kẹt ở phía scheduler (luồng không được chạy 16 ms lúc đang ngủ): cùng một sự
 * kiện, nhưng nay số nằm ở `wake_late_max` chứ không ở `work_max`. */
TEST(PollLoopTiming, OneWakeStallOf16msIsOneLateEvent)
{
    SimLoop loop;
    loop.run(100);
    loop.iterate(kWork, 16 * kMs);
    loop.run(200);
    const PollLoopMinute m = loop.timing.minute();
    EXPECT_EQ(m.late_events, 1u);
    EXPECT_EQ(m.catchup_iterations, 26u);
    EXPECT_EQ(m.wake_late_max_ns, 16 * kMs);
    EXPECT_EQ(m.work_max_ns, kWork);
    EXPECT_GT(loop.legacy_overruns, 1u);
}

TEST(PollLoopTiming, TwoSeparateStallsAreTwoLateEvents)
{
    SimLoop loop;
    loop.run(50);
    loop.iterate(16 * kMs);
    loop.run(100);
    loop.iterate(kWork, 10 * kMs);
    loop.run(100);
    EXPECT_EQ(loop.timing.minute().late_events, 2u);
}

/* Vòng làm quá chu kỳ một chút nhưng vẫn xong trước mốc kế tiếp: không lỡ mốc
 * nào ⇒ không phải sự kiện trễ, không có vòng chạy bù. */
TEST(PollLoopTiming, FinishingBeforeNextTickIsNotLate)
{
    SimLoop loop;
    loop.run(10);
    loop.iterate(1900 * kUs, 99 * kUs);   /* xong ở D + 1,999 ms */
    loop.run(10);
    const PollLoopMinute m = loop.timing.minute();
    EXPECT_EQ(m.late_events, 0u);
    EXPECT_EQ(m.catchup_iterations, 0u);
    EXPECT_EQ(m.work_max_ns, 1900 * kUs);
}

/* Biên: xong ĐÚNG mốc kế tiếp thì `clock_nanosleep(TIMER_ABSTIME)` không ngủ
 * ⇒ đã lỡ mốc, vòng sau là vòng chạy bù. */
TEST(PollLoopTiming, FinishingExactlyAtNextTickIsLate)
{
    SimLoop loop;
    loop.run(10);
    loop.iterate(kPeriod - kWakeLatency);   /* xong ở D + 2 ms */
    loop.run(10);
    const PollLoopMinute m = loop.timing.minute();
    EXPECT_EQ(m.late_events, 1u);
    EXPECT_EQ(m.catchup_iterations, 1u);
}

/* Quá tải kéo dài (mọi vòng dài hơn chu kỳ) là MỘT sự kiện chưa kết thúc,
 * không phải mỗi vòng một sự kiện; số vòng chạy bù vẫn tăng theo từng vòng. */
TEST(PollLoopTiming, SustainedOverloadIsOneEvent)
{
    SimLoop loop;
    loop.run(10);
    for (int i = 0; i < 50; ++i) loop.iterate(2500 * kUs);
    const PollLoopMinute m = loop.timing.minute();
    EXPECT_EQ(m.late_events, 1u);
    EXPECT_EQ(m.catchup_iterations, 49u);
}

/* Ranh giới phút: sự kiện thuộc phút nó BẮT ĐẦU; phút sau thấy phần chạy bù
 * còn lại nhưng không đếm lại sự kiện. */
TEST(PollLoopTiming, MinuteResetDoesNotDoubleCountAnEvent)
{
    SimLoop loop;
    loop.run(10);
    loop.iterate(16 * kMs);
    loop.run(5);                            /* còn giữa đợt chạy bù */
    EXPECT_EQ(loop.timing.minute().late_events, 1u);
    EXPECT_EQ(loop.timing.minute().catchup_iterations, 5u);
    loop.timing.reset_minute();
    loop.run(100);
    const PollLoopMinute m = loop.timing.minute();
    EXPECT_EQ(m.late_events, 0u);
    EXPECT_EQ(m.catchup_iterations, 19u);
    EXPECT_EQ(m.iterations, 100u);
}

/* Chính sách "lỡ thì bỏ" (T63-201): cùng lần kẹt 16 ms vẫn là đúng một sự
 * kiện trễ, còn chạy bù phải bằng 0 — ngữ nghĩa log phút không đổi theo chính
 * sách tick. */
TEST(PollLoopTiming, SkipPolicyKeepsLateEventAndHasNoCatchup)
{
    SimLoop loop;
    loop.skip_missed = true;
    loop.run(100);
    loop.iterate(16 * kMs);
    loop.run(200);
    const PollLoopMinute m = loop.timing.minute();
    EXPECT_EQ(m.late_events, 1u);
    EXPECT_EQ(m.catchup_iterations, 0u);
    EXPECT_EQ(m.wake_late_max_ns, kWakeLatency);
}

TEST(PollLoopTiming, IoRespGapCountsMissedResponsesAndOpenGap)
{
    SimLoop loop;
    loop.run(10);
    for (int i = 0; i < 3; ++i) loop.iterate(kWork, kWakeLatency, false);
    loop.run(10);
    EXPECT_EQ(loop.timing.minute().io_resp_gap_max_ns, 4 * kPeriod);
    EXPECT_EQ(loop.timing.minute().io_resp_count, 20u);

    /* Sang phút mới, MCU im lặng hoàn toàn: khoảng đang mở phải hiện ra thay
     * vì `io_resp_gap_max_us=0`. */
    loop.timing.reset_minute();
    const uint64_t last_resp = loop.clock_ns;
    for (int i = 0; i < 100; ++i) loop.iterate(kWork, kWakeLatency, false);
    const PollLoopMinute m = loop.timing.minute_at(loop.clock_ns);
    EXPECT_EQ(m.io_resp_count, 0u);
    EXPECT_EQ(m.io_resp_gap_max_ns, loop.clock_ns - last_resp);
    EXPECT_EQ(loop.timing.minute().io_resp_gap_max_ns, 0u)
        << "minute() không cộng khoảng mở; chỉ minute_at() làm";
}

TEST(PollLoopTiming, NoResponseYetReportsNoGap)
{
    PollLoopTiming timing;
    timing.on_wake(0, 0);
    timing.on_work_end(kWork, kPeriod);
    EXPECT_EQ(timing.minute_at(10 * kMs).io_resp_gap_max_ns, 0u);
    EXPECT_EQ(timing.minute_at(10 * kMs).io_resp_count, 0u);
}

TEST(PollLoopTiming, FormatLineUsesProbeGrammarAndRoundsUp)
{
    PollLoopMinute m;
    m.iterations = 30000;
    m.wake_late_max_ns = 50001;       /* 50,001 µs ⇒ 51: vượt ngưỡng không được hiện thành số dưới ngưỡng */
    m.work_max_ns = 16 * kMs;
    m.io_resp_count = 29990;
    m.io_resp_gap_max_ns = 16600 * kUs;
    m.late_events = 1;
    m.catchup_iterations = 24;
    char line[PollLoopTiming::kLineCapacity];
    const int n = PollLoopTiming::format_line(line, sizeof(line), m, kPeriod);
    ASSERT_GT(n, 0);
    ASSERT_LT(static_cast<std::size_t>(n), sizeof(line));
    EXPECT_STREQ(line,
                 "iobus.loop_timing wake_late_max_us=51 work_max_us=16000"
                 " io_resp_gap_max_us=16600 late_events=1 catchup_iterations=24"
                 " iterations=30000 io_resp_count=29990 period_us=2000");
    /* Cùng regex EVENT_RE/KV_RE của scripts/forlinx_perf_probe.py. */
    const std::string full = std::string("INFO  ") + line;
    std::smatch match;
    ASSERT_TRUE(std::regex_search(
        full, match, std::regex(R"(\b(?:INFO|WARN|ERROR)\s+([a-z_]+\.[a-z_.]+)\b(.*)$)")));
    EXPECT_EQ(match[1].str(), "iobus.loop_timing");
    for (const char* key : {"wake_late_max_us=", "work_max_us=", "io_resp_gap_max_us=",
                            "late_events=", "catchup_iterations="})
        EXPECT_NE(match[2].str().find(key), std::string::npos) << key;
}

/* main.cpp cấp đúng `kLineCapacity` byte trên stack; dòng xấu nhất không được
 * bị cắt (cắt thì mất khoá cuối, probe đọc thiếu mà không báo). */
TEST(PollLoopTiming, WorstCaseLineFitsLineCapacity)
{
    PollLoopMinute m;
    m.iterations = m.wake_late_max_ns = m.work_max_ns = m.io_resp_count =
        m.io_resp_gap_max_ns = m.late_events = m.catchup_iterations = UINT64_MAX;
    char line[PollLoopTiming::kLineCapacity];
    const int n = PollLoopTiming::format_line(line, sizeof(line), m, UINT64_MAX);
    ASSERT_GT(n, 0);
    EXPECT_LT(static_cast<std::size_t>(n), sizeof(line));
    EXPECT_NE(std::string(line).find(" period_us="), std::string::npos);
}

/* AC T63-004: "Không cấp phát/khoá thêm trong vòng poll". Mọi lời gọi mà
 * main.cpp đặt trong vòng poll — kể cả định dạng dòng log phút — chạy dưới bộ
 * đếm cấp phát và phải ra 0. */
TEST(PollLoopTiming, HotPathDoesNotAllocate)
{
    {
        allocation_probe::ScopedCounter sanity;
        /* `volatile` giữ con trỏ lại: GCC được phép bỏ cặp new/delete không
         * dùng tới (-fallocation-dce), khi đó bộ đếm sẽ đọc 0 oan. */
        int* volatile probe = new int(7);
        delete probe;
        ASSERT_GE(sanity.allocations(), 1u) << "bộ đếm phải thấy cấp phát, nếu không test vô nghĩa";
    }

    SimLoop loop;
    char line[PollLoopTiming::kLineCapacity];
    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (int minute = 0; minute < 3; ++minute) {
            loop.run(1000);
            loop.iterate(16 * kMs);
            loop.run(1000);
            const PollLoopMinute m = loop.timing.minute_at(loop.clock_ns);
            (void)PollLoopTiming::format_line(line, sizeof(line), m, loop.period_ns);
            loop.timing.reset_minute();
        }
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
    EXPECT_EQ(std::strncmp(line, "iobus.loop_timing ", 18), 0);
}
