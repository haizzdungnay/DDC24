#include <gtest/gtest.h>

#include <ctime>
#include <cstring>
#include <vector>

#include "data/shm_reader.hpp"

namespace hmi {
namespace {

uint64_t monotonic_ns()
{
    struct timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull +
           static_cast<uint64_t>(ts.tv_nsec);
}

TEST(ShmReaderTest, ReadsStableIoAndPlcSnapshots)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 2;
    io.ts_ns = monotonic_ns() - 1000000ull;
    io.ui_value[0] = 12.5f;
    io.ui_quality[0] = KX_Q_GOOD;
    std::strcpy(io.ui_unit[0], "degC");
    io.iop_status = KX_IOP_NORMAL;

    kx_plc_shm_t plc{};
    plc.magic = KX_SHM_MAGIC;
    plc.seq = 4;
    plc.ts_ns = io.ts_ns;
    plc.ai[0].value = 42.0f;
    plc.ext_count = 1;
    plc.plc_running = 1;

    ShmReader reader;
    reader.attach_external_io(&io);
    reader.attach_external_plc(&plc);
    DataCache cache;
    const ReadStatus st = reader.read_all(&cache);
    ASSERT_TRUE(st.io_ok);
    ASSERT_TRUE(st.plc_ok);
    EXPECT_TRUE(cache.io_valid);
    EXPECT_TRUE(cache.plc_valid);
    EXPECT_FLOAT_EQ(cache.ui_value[0], 12.5f);
    EXPECT_STREQ(cache.ui_unit[0], "degC");
    EXPECT_FLOAT_EQ(cache.ai[0].value, 42.0f);
    EXPECT_EQ(cache.ext_count, 1);
    EXPECT_LT(cache.age_ns, 1000000000ull);
}

TEST(ShmReaderTest, RejectsBadMagicAndBusyWriter)
{
    kx_io_shm_t io{};
    ShmReader reader;
    reader.attach_external_io(&io);
    DataCache cache;
    EXPECT_FALSE(reader.read_all(&cache).io_ok);
    EXPECT_FALSE(cache.io_valid);

    io.magic = KX_SHM_MAGIC;
    io.seq = 1;
    EXPECT_FALSE(reader.read_all(&cache).io_ok);
    EXPECT_FALSE(cache.io_valid);
}

/* F-03 — DataCache được TÁI DÙNG qua từng chu kỳ ở main.cpp. Một chu kỳ đọc tốt
 * theo sau bởi một chu kỳ đọc trượt (magic sai — đúng cửa sổ iobus restart)
 * không được để iop_status=NORMAL cũ sống sót, nếu không banner vẫn xanh và
 * E001 không kích. */
TEST(ShmReaderTest, FailedReadClearsStaleAnnunciationOnReusedCache)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 2;
    io.ts_ns = monotonic_ns() - 1000000ull;
    io.iop_status = KX_IOP_NORMAL;
    io.fault_flags = 0;
    io.ui_value[0] = 21.5f;

    ShmReader reader;
    reader.attach_external_io(&io);
    DataCache cache;

    ASSERT_TRUE(reader.read_all(&cache).io_ok);
    ASSERT_EQ(cache.iop_status, KX_IOP_NORMAL);
    ASSERT_TRUE(cache.io_valid);

    /* iobus crash + restart: magic chưa set xong */
    io.magic = 0u;
    const ReadStatus st = reader.read_all(&cache);
    EXPECT_FALSE(st.io_ok);
    EXPECT_FALSE(cache.io_valid);
    EXPECT_EQ(cache.iop_status, KX_IOP_FAULT);   /* fail-safe, không giữ NORMAL */
    EXPECT_EQ(cache.fault_flags, 0u);
    /* Đường hiển thị giá trị KHÔNG bị xoá — age_ns lo phần đánh dấu stale */
    EXPECT_FLOAT_EQ(cache.ui_value[0], 21.5f);
}

/* Cùng kịch bản nhưng writer treo giữa lúc ghi (seq lẻ suốt 5 lần retry). */
TEST(ShmReaderTest, ExhaustedSeqlockRetriesClearsStaleAnnunciation)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 2;
    io.ts_ns = monotonic_ns() - 1000000ull;
    io.iop_status = KX_IOP_NORMAL;
    io.fault_flags = 0x0001u;

    ShmReader reader;
    reader.attach_external_io(&io);
    DataCache cache;
    ASSERT_TRUE(reader.read_all(&cache).io_ok);
    ASSERT_EQ(cache.iop_status, KX_IOP_NORMAL);
    ASSERT_EQ(cache.fault_flags, 0x0001u);

    io.seq = 3;   /* lẻ = writer đang ghi → cả 5 lần retry đều trượt */
    EXPECT_FALSE(reader.read_all(&cache).io_ok);
    EXPECT_FALSE(cache.io_valid);
    EXPECT_EQ(cache.iop_status, KX_IOP_FAULT);
    EXPECT_EQ(cache.fault_flags, 0u);
}

/* plc_valid cũng phải được reset — trước đây read_all bỏ luôn giá trị trả về
 * của seqlock_read_plc và plc_valid không bao giờ về false. */
TEST(ShmReaderTest, FailedPlcReadReportsAndClearsPlcValid)
{
    kx_plc_shm_t plc{};
    plc.magic = KX_SHM_MAGIC;
    plc.seq = 2;
    plc.ext_count = 3;

    ShmReader reader;
    reader.attach_external_plc(&plc);
    DataCache cache;
    ASSERT_TRUE(reader.read_all(&cache).plc_ok);
    ASSERT_TRUE(cache.plc_valid);

    plc.magic = 0u;
    const ReadStatus st = reader.read_all(&cache);
    EXPECT_FALSE(st.plc_ok);
    EXPECT_FALSE(cache.plc_valid);
}

/* ------------------------------------------------------------------------
 * T63-102 (PERF-API-01): retry theo deadline ≤ 1 ms, nhường CPU giữa các lần
 * thử — cùng chính sách T63-101 của web. Bản cũ thử 5 vòng liền trong < 1 µs
 * nên một writer giữ seq lẻ vài chục µs (một lần ghi bình thường bị ngắt) đã
 * đủ làm HMI mất chu kỳ dữ liệu.
 *
 * Kịch bản "writer giữ lẻ 50/200 µs" chạy trên ĐỒNG HỒ GIẢ của chính policy:
 * writer nhả seqlock khi đồng hồ giả qua mốc giữ. Tất định — một test dùng
 * luồng thật + đồng hồ thật trên máy CI dùng chung đo được ~10 % lượt đỏ vì
 * luồng writer bị lịch hoãn quá 1 ms, tức đo lịch của máy chứ không đo policy.
 * Số đo với luồng thật nằm ở gói bàn giao (HOST), không ở cổng ctest.
 * ---------------------------------------------------------------------- */

/* Đồng hồ giả: mỗi lần nhường CPU tốn 1 µs giả; mỗi lần ngủ vượt thêm 200 µs
 * (xấu hơn độ vượt nanosleep đo được ở T63-101). Writer giả nhả seqlock khi
 * đồng hồ tới `release_at` (nếu có). */
struct FakeSeqlockClock {
    static constexpr uint64_t kDeadline = 1000000ull;
    uint64_t now = 1000000000ull;
    uint64_t start = 1000000000ull;
    std::vector<uint64_t> sleep_started_remaining;
    int yields = 0;
    kx_io_shm_t* writer_shm = nullptr;
    uint64_t release_at = UINT64_MAX;
    int release_after_yields = -1;

    void maybe_release()
    {
        if (!writer_shm) return;
        const bool by_time = now >= release_at;
        const bool by_yield = release_after_yields >= 0 && yields >= release_after_yields;
        if ((by_time || by_yield) && (writer_shm->seq & 1u)) KX_WRITE_END(writer_shm);
    }
    static uint64_t now_ns(void* ctx) { return static_cast<FakeSeqlockClock*>(ctx)->now; }
    static void sleep_ns(void* ctx, uint64_t ns)
    {
        auto* self = static_cast<FakeSeqlockClock*>(ctx);
        self->sleep_started_remaining.push_back(kDeadline - (self->now - self->start));
        self->now += ns + 200000ull;
        self->maybe_release();
    }
    static void yield(void* ctx)
    {
        auto* self = static_cast<FakeSeqlockClock*>(ctx);
        self->now += 1000ull;
        ++self->yields;
        self->maybe_release();
    }
    SeqlockPolicy policy()
    {
        SeqlockPolicy p;
        p.now_ns = &FakeSeqlockClock::now_ns;
        p.sleep_ns = &FakeSeqlockClock::sleep_ns;
        p.yield = &FakeSeqlockClock::yield;
        p.ctx = this;
        return p;
    }
};

/* Writer giả giữ seq LẺ `hold_ns` kể từ lúc reader bắt đầu đọc, rồi KX_WRITE_END. */
void expect_read_survives_writer_hold(uint64_t hold_ns)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 3;   /* lẻ: writer đang ở giữa KX_WRITE_BEGIN/KX_WRITE_END */
    io.ts_ns = monotonic_ns();
    io.iop_status = KX_IOP_NORMAL;
    io.ui_value[0] = 7.25f;

    ShmReader reader;
    reader.attach_external_io(&io);
    FakeSeqlockClock clock;
    clock.writer_shm = &io;
    clock.release_at = clock.start + hold_ns;
    reader.set_seqlock_policy_for_test(clock.policy());

    DataCache cache;
    const ReadStatus st = reader.read_all(&cache);
    EXPECT_TRUE(st.io_ok) << "writer giữ lẻ " << hold_ns / 1000 << " µs — reader phải chờ được";
    EXPECT_TRUE(cache.io_valid);
    EXPECT_EQ(cache.iop_status, KX_IOP_NORMAL);
    EXPECT_FLOAT_EQ(cache.ui_value[0], 7.25f);
    EXPECT_LT(clock.now - clock.start, FakeSeqlockClock::kDeadline);
    const SeqlockStats stats = reader.seqlock_stats();
    EXPECT_EQ(stats.io.reads, 1u);
    EXPECT_GT(stats.io.retries, 5u) << "phải thử lại vượt 5 vòng của bản cũ";
    EXPECT_EQ(stats.io.failures, 0u);
    EXPECT_GE(stats.io.max_wait_us, hold_ns / 1000ull);
}

TEST(ShmReaderT63102, WriterHolding50usIsReadAfterRetry)
{
    expect_read_survives_writer_hold(50000ull);
}

TEST(ShmReaderT63102, WriterHolding200usIsReadAfterRetry)
{
    expect_read_survives_writer_hold(200000ull);
}

/* Writer treo vĩnh viễn: thất bại ĐÚNG tại deadline (không trễ thêm một nhịp
 * ngủ), chỉ ngủ khi hạn còn ≥ backoff + slack, 8 lần đầu chỉ nhường CPU. */
TEST(ShmReaderT63102, WriterStuckFailsAtDeadlineWithoutOversleeping)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 1;
    ShmReader reader;
    reader.attach_external_io(&io);
    FakeSeqlockClock clock;
    reader.set_seqlock_policy_for_test(clock.policy());

    DataCache cache;
    EXPECT_FALSE(reader.read_all(&cache).io_ok);
    const uint64_t spent = clock.now - clock.start;
    EXPECT_GE(spent, FakeSeqlockClock::kDeadline);
    EXPECT_LE(spent, FakeSeqlockClock::kDeadline + 1000ull)
        << "kết thúc tại deadline, không trễ thêm một nhịp ngủ";
    ASSERT_FALSE(clock.sleep_started_remaining.empty()) << "hết lượt nhường CPU thì phải ngủ để nhả CPU";
    for (uint64_t remaining : clock.sleep_started_remaining)
        EXPECT_GE(remaining, 50000ull + 250000ull) << "chỉ ngủ khi hạn còn ≥ backoff + slack";
    EXPECT_GE(clock.yields, 8) << "8 lần đầu chỉ nhường CPU";
    EXPECT_EQ(reader.seqlock_stats().io.failures, 1u);
}

/* Cùng kịch bản trên đồng hồ THẬT (production hook): đọc có giới hạn — không
 * trả trước deadline, không treo; fail-safe và bộ đếm như hợp đồng. Trần trên
 * rộng (50 ms) vì chỉ khẳng định "có giới hạn"; độ chính xác của deadline do
 * test đồng hồ giả ở trên khoá. */
TEST(ShmReaderT63102, WriterStuckOnRealClockIsBoundedAndFailSafe)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 2;
    io.ts_ns = monotonic_ns();
    io.iop_status = KX_IOP_NORMAL;
    io.ui_value[0] = 3.5f;

    ShmReader reader;
    reader.attach_external_io(&io);
    DataCache cache;
    ASSERT_TRUE(reader.read_all(&cache).io_ok);

    io.seq = 5;   /* writer chết giữa lúc ghi */
    const uint64_t t0 = monotonic_ns();
    const ReadStatus st = reader.read_all(&cache);
    const uint64_t elapsed = monotonic_ns() - t0;

    EXPECT_FALSE(st.io_ok);
    EXPECT_FALSE(cache.io_valid);
    EXPECT_EQ(cache.iop_status, KX_IOP_FAULT) << "hết hạn vẫn fail-safe";
    EXPECT_FLOAT_EQ(cache.ui_value[0], 3.5f) << "giá trị giữ bản cũ, age_ns lo phần stale";
    EXPECT_GE(elapsed, 1000000ull) << "phải chờ đủ deadline trước khi bỏ";
    EXPECT_LT(elapsed, 50000000ull) << "đọc phải có giới hạn";
    const SeqlockStats stats = reader.seqlock_stats();
    EXPECT_EQ(stats.io.reads, 2u);
    EXPECT_EQ(stats.io.failures, 1u);
    EXPECT_GE(stats.io.max_wait_us, 1000u);
    EXPECT_EQ(stats.plc.reads, 0u) << "bộ đếm tách theo segment";
}

/* Writer nhả seqlock sau lần nhường CPU thứ 3 ⇒ đọc thành công với đúng 3 lần
 * thử lại, không ngủ lần nào. */
TEST(ShmReaderT63102, SucceedsAsSoonAsWriterReleases)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 1;
    io.iop_status = KX_IOP_NORMAL;
    ShmReader reader;
    reader.attach_external_io(&io);
    FakeSeqlockClock clock;
    clock.writer_shm = &io;
    clock.release_after_yields = 3;
    reader.set_seqlock_policy_for_test(clock.policy());

    DataCache cache;
    EXPECT_TRUE(reader.read_all(&cache).io_ok);
    EXPECT_EQ(cache.iop_status, KX_IOP_NORMAL);
    EXPECT_TRUE(clock.sleep_started_remaining.empty());
    EXPECT_EQ(reader.seqlock_stats().io.retries, 3u);
    EXPECT_EQ(reader.seqlock_stats().io.failures, 0u);
}

/* T63-102: dòng log phút của counter reader — đúng grammar probe
 * `INFO  <event> k=v …` (scripts/forlinx_perf_probe.py EVENT_RE/KV_RE), đủ 8
 * khoá, và dòng xấu nhất (mọi counter = UINT64_MAX) vừa buffer của main.cpp. */
TEST(ShmReaderT63102, StatsLineMatchesProbeGrammar)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 1;
    ShmReader reader;
    reader.attach_external_io(&io);
    FakeSeqlockClock clock;
    clock.writer_shm = &io;
    clock.release_after_yields = 3;
    reader.set_seqlock_policy_for_test(clock.policy());
    DataCache cache;
    ASSERT_TRUE(reader.read_all(&cache).io_ok);

    char line[kSeqlockStatsLineCapacity];
    const int n = format_seqlock_stats_line(line, sizeof(line), reader.seqlock_stats());
    ASSERT_GT(n, 0);
    EXPECT_STREQ(line, "hmi.shm_reader io_reads=1 io_retries=3 io_failures=0 io_max_wait_us=3"
                       " plc_reads=0 plc_retries=0 plc_failures=0 plc_max_wait_us=0");

    SeqlockStats worst;
    worst.io = {UINT64_MAX, UINT64_MAX, UINT64_MAX, UINT64_MAX};
    worst.plc = worst.io;
    const int worst_n = format_seqlock_stats_line(line, sizeof(line), worst);
    ASSERT_GT(worst_n, 0);
    EXPECT_LT(static_cast<std::size_t>(worst_n), sizeof(line)) << "không được cắt khoá cuối";
    EXPECT_NE(std::strstr(line, " plc_max_wait_us=18446744073709551615"), nullptr);
}

} // namespace
} // namespace hmi
