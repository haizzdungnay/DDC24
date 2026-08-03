#include <gtest/gtest.h>

#include <ctime>
#include <cstring>

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

} // namespace
} // namespace hmi
