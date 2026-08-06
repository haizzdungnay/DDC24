#include <cstddef>

#include <gtest/gtest.h>

#include "mkddc_shm.h"

TEST(ShmLayout, IoShmV5OffsetsMatchWebAndTools)
{
    EXPECT_EQ(KX_SHM_MAGIC, 0x4B584405u);
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_raw), static_cast<std::size_t>(80));
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_reliability), static_cast<std::size_t>(160));
    EXPECT_EQ(offsetof(kx_io_shm_t, ui_raw_unit), static_cast<std::size_t>(304));
    EXPECT_EQ(offsetof(kx_io_shm_t, iop_status), static_cast<std::size_t>(502));
    EXPECT_EQ(offsetof(kx_io_shm_t, iop_rx), static_cast<std::size_t>(508));
    EXPECT_EQ(offsetof(kx_io_shm_t, modbus_diag), static_cast<std::size_t>(1560));
    EXPECT_EQ(sizeof(kx_modbus_diag_t), static_cast<std::size_t>(48));
    EXPECT_EQ(sizeof(kx_io_shm_t), static_cast<std::size_t>(3568));
}

/* Telemetry northbound/southbound (finding F-03/F-04) + MBR-B110.
 * Offset tới hết `fb_slave` giữ nguyên; stride của phần tử đổi vì counter lên
 * uint64, và đó là lý do magic đi từ v4 lên v5. */
TEST(ShmLayout, FieldbusTelemetryIsAppendedWithoutMovingLegacyFields)
{
    EXPECT_EQ(KX_SHM_MAGIC, 0x4B584405u);
    EXPECT_EQ(offsetof(kx_io_shm_t, bacnet_udp_port), static_cast<std::size_t>(524));
    EXPECT_EQ(offsetof(kx_io_shm_t, bacnet_bound), static_cast<std::size_t>(526));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_slave_count), static_cast<std::size_t>(527));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_publish_seq), static_cast<std::size_t>(528));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_slave), static_cast<std::size_t>(536));

    /* Stride 32 byte và uint64 đứng đầu: layout xác định trên cả x86-64 lẫn
     * aarch64. MBR-B110 nâng counter lên uint64 nên stride đổi 24 → 32. */
    EXPECT_EQ(sizeof(kx_slave_metrics_t), static_cast<std::size_t>(32));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, last_seen_ms), static_cast<std::size_t>(0));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, total_polls), static_cast<std::size_t>(8));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, total_errors), static_cast<std::size_t>(16));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, addr), static_cast<std::size_t>(24));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, online), static_cast<std::size_t>(25));
    EXPECT_EQ(offsetof(kx_slave_metrics_t, bus_id), static_cast<std::size_t>(26));
}

/* MBR-B305: số liệu bus phải có CHỖ trong contract, nếu không tầng API lại
 * phải bịa p50/p95/utilization như bản trước. */
TEST(ShmLayoutV2, BusMetricsAreCarriedInIoShm)
{
    EXPECT_EQ(sizeof(kx_bus_metrics_t), static_cast<std::size_t>(112));
    EXPECT_EQ(offsetof(kx_io_shm_t, producer_boot_id), static_cast<std::size_t>(3096));
    EXPECT_EQ(offsetof(kx_io_shm_t, counters_since_ms), static_cast<std::size_t>(3104));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_bus_count), static_cast<std::size_t>(3112));
    EXPECT_EQ(offsetof(kx_io_shm_t, fb_bus), static_cast<std::size_t>(3120));
    EXPECT_EQ(offsetof(kx_bus_metrics_t, latency_p50_us), static_cast<std::size_t>(24));
    EXPECT_EQ(offsetof(kx_bus_metrics_t, latency_p95_us), static_cast<std::size_t>(28));
    EXPECT_EQ(offsetof(kx_bus_metrics_t, utilization_pct_x100), static_cast<std::size_t>(40));
    EXPECT_EQ(offsetof(kx_bus_metrics_t, name), static_cast<std::size_t>(48));
    EXPECT_EQ(offsetof(kx_bus_metrics_t, device), static_cast<std::size_t>(64));
    EXPECT_EQ(offsetof(kx_bus_metrics_t, state), static_cast<std::size_t>(96));
}

TEST(ShmLayoutV2, ModbusDiagCarriesWriteCountersAndException)
{
    EXPECT_EQ(offsetof(kx_modbus_diag_t, timeout_errors), static_cast<std::size_t>(0));
    EXPECT_EQ(offsetof(kx_modbus_diag_t, crc_errors), static_cast<std::size_t>(8));
    EXPECT_EQ(offsetof(kx_modbus_diag_t, retry_attempts), static_cast<std::size_t>(16));
    EXPECT_EQ(offsetof(kx_modbus_diag_t, write_failed), static_cast<std::size_t>(24));
    EXPECT_EQ(offsetof(kx_modbus_diag_t, write_dropped), static_cast<std::size_t>(32));
    EXPECT_EQ(offsetof(kx_modbus_diag_t, consecutive_errors), static_cast<std::size_t>(40));
    EXPECT_EQ(offsetof(kx_modbus_diag_t, last_exception), static_cast<std::size_t>(41));
}

/* ===================== MBR-B005 — contract v2 (Đ-03) =====================
 *
 * Đây là ABI đồng bộ ba binary (iobus / core / web). Bộ khẳng định dưới đây
 * là thứ duy nhất bắt được lỗi "một bên đổi struct, hai bên kia không biết":
 * lỗi đó không gây crash, nó chỉ làm consumer đọc lệch trường và publish số
 * sai với nhãn GOOD.
 *
 * Số trong test phải khớp bảng hằng số Go ở apps/web-api/internal/app/core_client.go.
 * Sửa một bên mà không sửa bên kia là test đỏ — đúng ý đồ.
 */

/* Layout cố định lúc BIÊN DỊCH, không chỉ lúc chạy: một consumer viết sai
 * struct sẽ hỏng ngay ở khâu build chứ không lặng lẽ chạy trên board. */
static_assert(sizeof(kx_ext_point_t) == 64,
              "kx_ext_point_t v2 phải là 64 byte — đổi kích thước là ABI change");
static_assert(offsetof(kx_ext_point_t, value) == 24,
              "value phải 8-align ngay sau name[24]");
static_assert(offsetof(kx_ext_point_t, quality) == 56, "layout ext point đã đổi");
static_assert(sizeof(kx_ext_sample_v2_t) == 56, "sample v2 phải là 56 byte");
static_assert(offsetof(kx_ext_snapshot_v2_t, samples) == 72,
              "header snapshot v2 phải đúng 72 byte — consumer tính offset theo số này");

TEST(ShmLayoutV2, ExtPointCarriesTypedDoubleQualityAndSampleTimestamp)
{
    EXPECT_EQ(sizeof(kx_ext_point_t), static_cast<std::size_t>(64));
    EXPECT_EQ(offsetof(kx_ext_point_t, name), static_cast<std::size_t>(0));
    EXPECT_EQ(offsetof(kx_ext_point_t, value), static_cast<std::size_t>(24));
    EXPECT_EQ(offsetof(kx_ext_point_t, setpoint), static_cast<std::size_t>(32));
    EXPECT_EQ(offsetof(kx_ext_point_t, sample_utc_ms), static_cast<std::size_t>(40));
    EXPECT_EQ(offsetof(kx_ext_point_t, sample_mono_ns), static_cast<std::size_t>(48));
    EXPECT_EQ(offsetof(kx_ext_point_t, quality), static_cast<std::size_t>(56));
    EXPECT_EQ(offsetof(kx_ext_point_t, quality_reason), static_cast<std::size_t>(57));
    EXPECT_EQ(offsetof(kx_ext_point_t, exception_code), static_cast<std::size_t>(58));
    EXPECT_EQ(offsetof(kx_ext_point_t, slave_addr), static_cast<std::size_t>(59));
    EXPECT_EQ(offsetof(kx_ext_point_t, bus_id), static_cast<std::size_t>(60));
    EXPECT_EQ(offsetof(kx_ext_point_t, online), static_cast<std::size_t>(61));
    EXPECT_EQ(offsetof(kx_ext_point_t, writable), static_cast<std::size_t>(62));
    EXPECT_EQ(offsetof(kx_ext_point_t, dirty), static_cast<std::size_t>(63));

    /* double phải giữ nguyên số nguyên vượt 2^24 — lý do tồn tại của thay đổi
     * này. Với float32 phép gán dưới đây trả về 16777217 → 16777216. */
    kx_ext_point_t point{};
    point.value = 16777217.0;
    EXPECT_EQ(point.value, 16777217.0);
    point.value = 4294967295.0;   /* uint32 max — công-tơ kWh tích luỹ */
    EXPECT_EQ(point.value, 4294967295.0);
}

TEST(ShmLayoutV2, PlcShmOffsetsAfterExtMatchGoConstants)
{
    EXPECT_EQ(offsetof(kx_plc_shm_t, ext), static_cast<std::size_t>(6704));
    EXPECT_EQ(offsetof(kx_plc_shm_t, ext_count), static_cast<std::size_t>(23088));
    EXPECT_EQ(offsetof(kx_plc_shm_t, scan_count), static_cast<std::size_t>(23092));
    EXPECT_EQ(offsetof(kx_plc_shm_t, scan_overrun), static_cast<std::size_t>(23096));
    EXPECT_EQ(sizeof(kx_plc_shm_t), static_cast<std::size_t>(23104));
}

TEST(ShmLayoutV2, SnapshotV2HeaderCarriesProvenanceFields)
{
    EXPECT_EQ(KX_EXT_SNAP_V2_MAGIC, 0x45585402u);
    EXPECT_EQ(KX_EXT_SNAP_SCHEMA_VER, 2u);
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, magic), static_cast<std::size_t>(0));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, schema_version), static_cast<std::size_t>(4));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, count), static_cast<std::size_t>(6));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, sequence), static_cast<std::size_t>(8));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, generation), static_cast<std::size_t>(16));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, config_revision), static_cast<std::size_t>(24));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, producer_boot_id), static_cast<std::size_t>(32));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, publish_mono_ns), static_cast<std::size_t>(40));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, config_checksum), static_cast<std::size_t>(48));
    EXPECT_EQ(offsetof(kx_ext_snapshot_v2_t, samples), static_cast<std::size_t>(72));
    EXPECT_EQ(sizeof(kx_ext_sample_v2_t), static_cast<std::size_t>(56));
}

/* Magic v1 và v2 phải KHÁC nhau. Nếu ai đó "tiện tay" giữ nguyên magic khi đổi
 * layout thì consumer cũ sẽ chấp nhận datagram mới và đọc lệch 16 byte mỗi
 * phần tử — chính kịch bản deploy lệch version mà Đ-03 bắt phải nghiệm thu. */
TEST(ShmLayoutV2, MagicV1AndV2AreDistinctSoMismatchFailsLoudly)
{
    EXPECT_NE(KX_EXT_SNAP_MAGIC, KX_EXT_SNAP_V2_MAGIC);
    EXPECT_NE(sizeof(kx_ext_snapshot_msg_t), sizeof(kx_ext_snapshot_v2_t));
}

TEST(ShmLayoutV2, QualityEnumHasFiveLevelsAndTenReasons)
{
    /* 0/1/2 giữ nguyên số của kx_quality_t để đường map cũ không đổi nghĩa. */
    EXPECT_EQ(static_cast<int>(KX_EXTQ_GOOD), static_cast<int>(KX_Q_GOOD));
    EXPECT_EQ(static_cast<int>(KX_EXTQ_STALE), static_cast<int>(KX_Q_UNCERTAIN));
    EXPECT_EQ(static_cast<int>(KX_EXTQ_BAD), static_cast<int>(KX_Q_BAD));
    EXPECT_EQ(static_cast<int>(KX_EXTQ_OFFLINE), 3);
    EXPECT_EQ(static_cast<int>(KX_EXTQ_CONFIG_ERROR), 4);
    EXPECT_EQ(static_cast<int>(KX_EXTR_BUS_OVERLOAD), 10);
}
