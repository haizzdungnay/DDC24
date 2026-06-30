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
    ASSERT_TRUE(reader.read_all(&cache));
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
    EXPECT_FALSE(reader.read_all(&cache));
    EXPECT_FALSE(cache.io_valid);

    io.magic = KX_SHM_MAGIC;
    io.seq = 1;
    EXPECT_FALSE(reader.read_all(&cache));
    EXPECT_FALSE(cache.io_valid);
}

} // namespace
} // namespace hmi
