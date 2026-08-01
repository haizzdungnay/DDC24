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

/* Offset CŨ phải bất biến: đây là bằng chứng phần telemetry 2026-07-31 được NỐI
 * vào cuối chứ không chèn giữa, nên binary cũ đọc SHM mới vẫn đúng. */
static_assert(offsetof(kx_io_shm_t, ui_raw) == 80, "web io_shm raw offset changed");
static_assert(offsetof(kx_io_shm_t, ui_unit) == 176, "web io_shm unit offset changed");
static_assert(offsetof(kx_io_shm_t, ui_raw_unit) == 304, "web io_shm raw-unit offset changed");
static_assert(offsetof(kx_io_shm_t, iop_status) == 502, "web io_shm status offset changed");
static_assert(offsetof(kx_io_shm_t, iop_crc_err) == 512, "web io_shm metrics offset changed");

/* Offset MỚI phải khớp hằng số trong web/backend/core_client.go. */
static_assert(offsetof(kx_io_shm_t, bacnet_udp_port) == 524, "web io_shm bacnet port offset changed");
static_assert(offsetof(kx_io_shm_t, bacnet_bound) == 526, "web io_shm bacnet bound offset changed");
static_assert(offsetof(kx_io_shm_t, fb_slave_count) == 527, "web io_shm slave count offset changed");
static_assert(offsetof(kx_io_shm_t, fb_publish_seq) == 528, "web io_shm publish seq offset changed");
static_assert(offsetof(kx_io_shm_t, fb_slave) == 536, "web io_shm slave array offset changed");
static_assert(sizeof(kx_slave_metrics_t) == 24, "web slave metrics stride changed");
static_assert(sizeof(kx_io_shm_t) == 1304, "web io_shm size changed");

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

/* F-03: Web phải phân biệt được "iobus chưa publish lần nào" với "đã publish, 0
 * slave". Nếu không, màn hình lại quay về suy diễn — đúng lỗi cũ. */
TEST(IoCache, FieldbusPublishSeqDistinguishesNeverPublishedFromEmpty)
{
    if (shm_exists())
        GTEST_SKIP() << "/dev/shm/mkddc_io_shm đang tồn tại (iobus thật đang chạy?) — skip";

    IoCache cache;
    ASSERT_TRUE(cache.attach());
    EXPECT_EQ(cache.shm()->fb_publish_seq, 0u) << "boot sạch = chưa publish";
    EXPECT_EQ(cache.shm()->fb_slave_count, 0u);

    cache.write_fieldbus_metrics(nullptr, 0);
    EXPECT_GT(cache.shm()->fb_publish_seq, 0u) << "đã publish dù không có slave nào";
    EXPECT_EQ(cache.shm()->fb_slave_count, 0u);

    cache.detach();
    cleanup_shm();
}

TEST(IoCache, FieldbusMetricsRoundTripTruncatesAndClearsRemovedSlaves)
{
    if (shm_exists())
        GTEST_SKIP() << "/dev/shm/mkddc_io_shm đang tồn tại (iobus thật đang chạy?) — skip";

    IoCache cache;
    ASSERT_TRUE(cache.attach());

    kx_slave_metrics_t in[3] = {};
    in[0] = {1234u, 100u, 7u, 11u, 1u, {}};
    in[1] = {2345u, 200u, 0u, 12u, 1u, {}};
    in[2] = {3456u, 50u, 50u, 13u, 0u, {}};
    cache.write_fieldbus_metrics(in, 3);

    ASSERT_EQ(cache.shm()->fb_slave_count, 3u);
    EXPECT_EQ(cache.shm()->fb_slave[0].addr, 11u);
    EXPECT_EQ(cache.shm()->fb_slave[0].total_polls, 100u);
    EXPECT_EQ(cache.shm()->fb_slave[0].total_errors, 7u);
    EXPECT_EQ(cache.shm()->fb_slave[0].last_seen_ms, 1234u);
    EXPECT_EQ(cache.shm()->fb_slave[2].online, 0u) << "slave offline phải publish đúng là offline";

    /* Gỡ bớt slave khỏi config: phần đuôi phải bị xoá, nếu không Web sẽ hiển thị
     * lại số liệu của thiết bị đã tháo. */
    cache.write_fieldbus_metrics(in, 1);
    EXPECT_EQ(cache.shm()->fb_slave_count, 1u);
    EXPECT_EQ(cache.shm()->fb_slave[1].addr, 0u);
    EXPECT_EQ(cache.shm()->fb_slave[1].total_polls, 0u);
    EXPECT_EQ(cache.shm()->fb_slave[2].last_seen_ms, 0u);

    /* Vượt trần thì cắt chứ không tràn bộ nhớ. */
    kx_slave_metrics_t many[KX_N_FB_SLAVE + 8] = {};
    cache.write_fieldbus_metrics(many, KX_N_FB_SLAVE + 8);
    EXPECT_EQ(cache.shm()->fb_slave_count, static_cast<uint8_t>(KX_N_FB_SLAVE));

    cache.detach();
    cleanup_shm();
}

/* F-04: cờ bind phải phản ánh kết quả bip_init() thật, và khi mất bind thì port
 * phải về 0 để Web không hiển thị một cổng không còn phục vụ. */
TEST(IoCache, BacnetBindStateReflectsRealSocketAndClearsPortWhenUnbound)
{
    if (shm_exists())
        GTEST_SKIP() << "/dev/shm/mkddc_io_shm đang tồn tại (iobus thật đang chạy?) — skip";

    IoCache cache;
    ASSERT_TRUE(cache.attach());
    EXPECT_EQ(cache.shm()->bacnet_bound, 0u);
    EXPECT_EQ(cache.shm()->bacnet_udp_port, 0u);

    cache.write_bacnet_bind(true, 47808);
    EXPECT_EQ(cache.shm()->bacnet_bound, 1u);
    EXPECT_EQ(cache.shm()->bacnet_udp_port, 47808u);

    cache.write_bacnet_bind(false, 47808);
    EXPECT_EQ(cache.shm()->bacnet_bound, 0u);
    EXPECT_EQ(cache.shm()->bacnet_udp_port, 0u) << "rebind hỏng: không được giữ cổng cũ";

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
