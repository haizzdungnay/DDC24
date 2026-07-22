/**
 * @file  test_io_cache.cpp
 * @brief Gap #4 analysis report: iobus restart (re-attach shm đã có magic)
 *        PHẢI giữ nguyên ao_setpoint[]/do_cmd[] của core; boot sạch init full.
 *        Dùng shm thật /dev/shm/mkddc_io_shm — SKIP nếu đang có instance chạy.
 */
#include <gtest/gtest.h>

#include <fcntl.h>
#include <cstddef>
#include <sys/mman.h>
#include <unistd.h>

#include "diagnostics/iobus_metrics.hpp"
#include "io/io_cache.hpp"

using namespace iobus;

static_assert(offsetof(kx_io_shm_t, ui_raw) == 80, "web io_shm raw offset changed");
static_assert(offsetof(kx_io_shm_t, ui_unit) == 176, "io_shm unit offset changed");
static_assert(offsetof(kx_io_shm_t, ui_raw_unit) == 304, "io_shm raw-unit offset changed");
static_assert(offsetof(kx_io_shm_t, iop_status) == 502, "web io_shm status offset changed");
static_assert(offsetof(kx_io_shm_t, iop_crc_err) == 512, "web io_shm metrics offset changed");
static_assert(sizeof(kx_io_shm_t) == 528, "web io_shm size changed");

namespace {

bool shm_exists()
{
    const int fd = shm_open("/mkddc_io_shm", O_RDONLY, 0);
    if (fd < 0) return false;
    ::close(fd);
    return true;
}

void cleanup_shm()
{
    shm_unlink("/mkddc_io_shm");
}

} // namespace

TEST(IoCache, CleanBootInitsDefaults)
{
    if (shm_exists())
        GTEST_SKIP() << "/dev/shm/mkddc_io_shm đang tồn tại (iobus thật đang chạy?) — skip";

    IoCache cache;
    ASSERT_TRUE(cache.attach());
    const kx_io_shm_t* s = cache.shm();
    EXPECT_EQ(s->magic, KX_SHM_MAGIC);
    EXPECT_EQ(s->iop_status, KX_IOP_FAULT);
    for (int i = 0; i < KX_N_UI; i++) {
        EXPECT_EQ(s->ui_quality[i], KX_Q_BAD);
        EXPECT_EQ(s->ui_reliability[i], KX_REL_COMMUNICATION_FAILURE);
    }
    for (int i = 0; i < KX_N_DO; i++)
        EXPECT_EQ(s->do_cmd[i], 0);
    cache.detach();
    cleanup_shm();
}

TEST(IoCache, StaleAndCommunicationFailureReliability)
{
    if (shm_exists())
        GTEST_SKIP() << "/dev/shm/mkddc_io_shm đang tồn tại (iobus thật đang chạy?) — skip";

    IoCache cache;
    IobusMetrics metrics;
    ASSERT_TRUE(cache.attach());
    cache.mark_inputs_unreliable();
    for (int i = 0; i < KX_N_UI; i++) {
        EXPECT_EQ(cache.shm()->ui_quality[i], KX_Q_UNCERTAIN);
        EXPECT_EQ(cache.shm()->ui_reliability[i], KX_REL_UNRELIABLE_OTHER);
    }
    cache.write_status(KX_IOP_SAFE, metrics);
    for (int i = 0; i < KX_N_UI; i++) {
        EXPECT_EQ(cache.shm()->ui_quality[i], KX_Q_BAD);
        EXPECT_EQ(cache.shm()->ui_reliability[i], KX_REL_COMMUNICATION_FAILURE);
    }
    cache.detach();
    cleanup_shm();
}

TEST(IoCache, ReattachPreservesCoreOwnedFields)
{
    if (shm_exists())
        GTEST_SKIP() << "/dev/shm/mkddc_io_shm đang tồn tại (iobus thật đang chạy?) — skip";

    /* lần 1: boot sạch + "core" ghi output */
    {
        IoCache cache;
        ASSERT_TRUE(cache.attach());
        kx_io_shm_t* s = const_cast<kx_io_shm_t*>(cache.shm());
        __atomic_store_n(&s->do_cmd[0], static_cast<uint8_t>(1), __ATOMIC_RELEASE);
        float v = 7.5f;
        __atomic_store(&s->ao_setpoint[2], &v, __ATOMIC_RELEASE);
        cache.detach();   /* iobus shutdown — KHÔNG unlink (core còn đọc) */
    }

    /* lần 2: iobus restart → re-attach */
    {
        IoCache cache;
        ASSERT_TRUE(cache.attach());
        const kx_io_shm_t* s = cache.shm();
        EXPECT_EQ(s->magic, KX_SHM_MAGIC);
        EXPECT_EQ(s->do_cmd[0], 1) << "restart KHÔNG được wipe do_cmd của core";
        EXPECT_FLOAT_EQ(s->ao_setpoint[2], 7.5f) << "restart KHÔNG được wipe ao_setpoint";
        /* field của iobus thì reset như thường */
        EXPECT_EQ(s->iop_status, KX_IOP_FAULT);
        for (int i = 0; i < KX_N_UI; i++)
            EXPECT_EQ(s->ui_quality[i], KX_Q_BAD);
        cache.detach();
    }
    cleanup_shm();
}
