#include <cstddef>

#include <gtest/gtest.h>

#include "mkddc_shm.h"

TEST(ShmLayout, IoShmV4OffsetsMatchWebAndTools)
{
    EXPECT_EQ(KX_SHM_MAGIC, 0x4B584404u);
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_raw), static_cast<std::size_t>(80));
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_reliability), static_cast<std::size_t>(160));
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_raw_unit), static_cast<std::size_t>(304));
    EXPECT_EQ(offsetof(kx_io_shm_t, iop_status), static_cast<std::size_t>(502));
    EXPECT_EQ(offsetof(kx_io_shm_t, iop_rx), static_cast<std::size_t>(508));
    EXPECT_EQ(offsetof(kx_io_shm_t, modbus_diag), static_cast<std::size_t>(1304));
    EXPECT_EQ(sizeof(kx_modbus_diag_t), static_cast<std::size_t>(16));
    EXPECT_EQ(sizeof(kx_io_shm_t), static_cast<std::size_t>(1816));
}

/* Telemetry northbound/southbound nối thêm 2026-07-31 (finding F-03/F-04).
 * Magic KHÔNG đổi vì mọi offset cũ giữ nguyên — test trên đã chốt điều đó. */
TEST(ShmLayout, FieldbusTelemetryIsAppendedWithoutMovingLegacyFields)
{
    EXPECT_EQ(KX_SHM_MAGIC, 0x4B584404u);   /* nối cuối => magic giữ nguyên */
    EXPECT_EQ(offsetof(kx_io_shm_t, bacnet_udp_port), static_cast<std::size_t>(524));
    EXPECT_EQ(offsetof(kx_io_shm_t, bacnet_bound), static_cast<std::size_t>(526));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_slave_count), static_cast<std::size_t>(527));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_publish_seq), static_cast<std::size_t>(528));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_slave), static_cast<std::size_t>(536));

    /* Stride 24 byte và uint64 đứng đầu: layout xác định trên cả x86-64 lẫn aarch64. */
    EXPECT_EQ(sizeof(kx_slave_metrics_t), static_cast<std::size_t>(24));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, last_seen_ms), static_cast<std::size_t>(0));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, total_polls), static_cast<std::size_t>(8));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, total_errors), static_cast<std::size_t>(12));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, addr), static_cast<std::size_t>(16));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, online), static_cast<std::size_t>(17));
}
