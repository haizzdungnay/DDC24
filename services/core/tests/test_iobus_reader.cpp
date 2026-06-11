/**
 * @file  test_iobus_reader.cpp
 * @brief Seqlock đọc nhất quán: writer giả ghi đồng thời, reader không bao giờ
 *        thấy snapshot nửa-ghi (07 tests).
 */
#include <gtest/gtest.h>

#include <atomic>
#include <cstring>
#include <thread>

#include "iobus_reader.hpp"

using namespace core;

namespace {

kx_io_shm_t make_shm()
{
    kx_io_shm_t s;
    std::memset(&s, 0, sizeof(s));
    s.magic = KX_SHM_MAGIC;
    return s;
}

} // namespace

TEST(IobusReader, RejectsBadMagic)
{
    kx_io_shm_t shm = make_shm();
    shm.magic = 0xDEADBEEF;
    IoSnapshot out;
    EXPECT_FALSE(IobusReader::read_from(&shm, &out));
}

TEST(IobusReader, ReadsConsistentSnapshot)
{
    kx_io_shm_t shm = make_shm();
    for (int i = 0; i < KX_N_UI; i++) shm.ui_value[i] = 7.5f;
    shm.iop_status = KX_IOP_NORMAL;
    shm.ts_ns = 12345;

    IoSnapshot out;
    ASSERT_TRUE(IobusReader::read_from(&shm, &out));
    EXPECT_TRUE(out.valid);
    EXPECT_EQ(out.ts_ns, 12345u);
    EXPECT_EQ(out.iop_status, KX_IOP_NORMAL);
    for (int i = 0; i < KX_N_UI; i++) EXPECT_FLOAT_EQ(out.ui_value[i], 7.5f);
}

TEST(IobusReader, FailsWhileWriterHoldsSeqlock)
{
    kx_io_shm_t shm = make_shm();
    KX_WRITE_BEGIN(&shm);   /* seq lẻ — đang ghi */
    IoSnapshot out;
    EXPECT_FALSE(IobusReader::read_from(&shm, &out));
    KX_WRITE_END(&shm);
    EXPECT_TRUE(IobusReader::read_from(&shm, &out));
}

TEST(IobusReader, NoTornReadUnderConcurrentWriter)
{
    /* Writer ghi tất cả ui_value = cùng 1 giá trị tăng dần qua seqlock.
     * Snapshot hợp lệ ⇒ 8 giá trị PHẢI bằng nhau (không nửa-ghi). */
    alignas(64) kx_io_shm_t shm = make_shm();
    std::atomic<bool> stop{false};

    std::thread writer([&] {
        float v = 1.0f;
        while (!stop.load(std::memory_order_relaxed)) {
            KX_WRITE_BEGIN(&shm);
            for (int i = 0; i < KX_N_UI; i++)
                shm.ui_value[i] = v;
            shm.ts_ns++;
            KX_WRITE_END(&shm);
            v += 1.0f;
        }
    });

    int consistent_reads = 0;
    for (int iter = 0; iter < 200000; iter++) {
        IoSnapshot out;
        if (!IobusReader::read_from(&shm, &out))
            continue;   /* retry quá 5 lần — hợp lệ, không phải torn read */
        consistent_reads++;
        for (int i = 1; i < KX_N_UI; i++)
            ASSERT_FLOAT_EQ(out.ui_value[i], out.ui_value[0])
                << "torn read tại iter=" << iter;
    }
    stop.store(true);
    writer.join();
    EXPECT_GT(consistent_reads, 0) << "reader phải đọc được ít nhất vài snapshot";
}
