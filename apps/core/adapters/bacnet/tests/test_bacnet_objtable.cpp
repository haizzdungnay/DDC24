/**
 * @file  test_bacnet_objtable.cpp
 * @brief BAC-004 unit tests — quality_to_reliability mapping + publish behavior.
 */
#include <cstddef>
#include <sys/socket.h>
#include <gtest/gtest.h>
#include "bacnet/bacnet_objtable.hpp"
#include "mkddc_shm.h"
#include "iop_protocol.h"

using namespace core;

/* ---- quality_to_reliability ---- */

TEST(BacnetObjtable, GoodQualityNoFault)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, 0, 0), 0u);  /* NO_FAULT */
}

TEST(BacnetObjtable, UncertainQuality)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_UNCERTAIN, 0, 0), 5u);  /* COMM_FAILURE */
}

TEST(BacnetObjtable, BadQuality)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_BAD, 0, 0), 5u);  /* COMM_FAILURE */
}

TEST(BacnetObjtable, AdcFaultGivesCommFailure)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_ADC1, 0), 5u);
}

TEST(BacnetObjtable, UIOverRangeCh0)
{
    /* IOP v2 (ADR-010): aggregate IOP_FAULT_UI_OV covers all 16 channels */
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 0), 1u);  /* OVER_RANGE */
}

TEST(BacnetObjtable, UIOverRangeCh3)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 3), 1u);
}

TEST(BacnetObjtable, UIOverRangeCh8)
{
    /* Second ADS131M08 channels must also trigger OVER_RANGE */
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 8), 1u);
}

TEST(BacnetObjtable, UIOverRangeCh15)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 15), 1u);
}

TEST(BacnetObjtable, NoOverRangeWithoutFlag)
{
    /* IOP_FAULT_UI_OV not set → NO_FAULT for any channel */
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, 0, 8), 0u);
}

/* ---- publish (stub shm via attach) ---- */

TEST(BacnetObjtable, AttachDetach)
{
    BacnetObjTable obj;
    /* attach() requires /dev/shm — may succeed or fail depending on env */
    const bool ok = obj.attach();
    if (ok) {
        EXPECT_TRUE(obj.attached());
        obj.detach();
        EXPECT_FALSE(obj.attached());
    } else {
        EXPECT_FALSE(obj.attached());
        SUCCEED();  /* CI without shm is acceptable */
    }
}

TEST(BacnetObjtable, ReadExtNopWhenSockNeg)
{
    BacnetObjTable obj;
    /* sockfd = -1 → no-op, no crash */
    obj.read_ext(-1);
    SUCCEED();
}

/* MOD-012 checkbox #9 + MBR-B104: core nhận snapshot v2 → plc_shm.ext[] */
TEST(BacnetObjtable, ReadExtReceivesSnapshot)
{
    BacnetObjTable obj;
    if (!obj.attach()) {
        SUCCEED();   /* /dev/shm không khả dụng trong môi trường này */
        return;
    }

    int sv[2];
    ASSERT_EQ(::socketpair(AF_UNIX, SOCK_DGRAM, 0, sv), 0);

    kx_ext_snapshot_v2_t msg{};
    msg.magic           = KX_EXT_SNAP_V2_MAGIC;
    msg.schema_version  = KX_EXT_SNAP_SCHEMA_VER;
    msg.count           = 2;
    msg.sequence        = 1;
    msg.generation      = 3;
    msg.config_revision = 11;
    msg.samples[0].value          = 3.14;
    msg.samples[0].quality        = KX_EXTQ_GOOD;
    msg.samples[0].online         = 1;
    msg.samples[0].slave_addr     = 10;
    msg.samples[0].bus_id         = 2;
    msg.samples[0].sample_utc_ms  = 1'700'000'000'000ll;
    /* Giá trị vượt 2^24: nếu ABI còn là float32 thì phép so sánh dưới sẽ trượt. */
    msg.samples[1].value          = 16777217.0;
    msg.samples[1].quality        = KX_EXTQ_CONFIG_ERROR;
    msg.samples[1].quality_reason = KX_EXTR_CONFIG_ERROR;
    msg.samples[1].online         = 0;

    ::send(sv[0], &msg, sizeof(msg), 0);
    obj.read_ext(sv[1]);

    const kx_plc_shm_t* shm = obj.shm();
    ASSERT_NE(shm, nullptr);
    EXPECT_EQ(shm->ext_count, 2u);
    EXPECT_DOUBLE_EQ(shm->ext[0].value, 3.14);
    EXPECT_EQ(shm->ext[0].quality,    KX_EXTQ_GOOD);
    EXPECT_EQ(shm->ext[0].online,     1u);
    EXPECT_EQ(shm->ext[0].slave_addr, 10u);
    EXPECT_EQ(shm->ext[0].bus_id,     2u);
    EXPECT_EQ(shm->ext[0].sample_utc_ms, 1'700'000'000'000ll);
    EXPECT_DOUBLE_EQ(shm->ext[1].value, 16777217.0);
    EXPECT_EQ(shm->ext[1].quality,        KX_EXTQ_CONFIG_ERROR);
    EXPECT_EQ(shm->ext[1].quality_reason, KX_EXTR_CONFIG_ERROR);

    /* Provenance phải đi kèm ảnh: thiếu nó thì không ai trả lời được câu hỏi
     * "iobus đang chạy cấu hình nào" ngoài cách đoán. */
    EXPECT_EQ(obj.ext_provenance().sequence, 1u);
    EXPECT_EQ(obj.ext_provenance().generation, 3u);
    EXPECT_EQ(obj.ext_provenance().config_revision, 11u);

    ::close(sv[0]);
    ::close(sv[1]);
    obj.detach();
}

/* MBR-B005 / Đ-03 — kịch bản deploy LỆCH VERSION phải fail-closed.
 *
 * iobus cũ (v1) gửi cho core mới (v2). Nếu core "đọc tạm", mỗi phần tử lệch
 * 24 byte và giá trị của Point A được publish dưới tên Point B với nhãn GOOD:
 * sai lặng lẽ, historian ghi vào DB, không ai phát hiện. */
TEST(BacnetObjtable, RejectsV1SnapshotFromStaleProducer)
{
    BacnetObjTable obj;
    if (!obj.attach()) {
        SUCCEED();
        return;
    }
    int sv[2];
    ASSERT_EQ(::socketpair(AF_UNIX, SOCK_DGRAM, 0, sv), 0);

    kx_ext_snapshot_msg_t legacy{};
    legacy.magic = KX_EXT_SNAP_MAGIC;   /* "EXT\1" — producer chưa nâng cấp */
    legacy.count = 2;
    ::send(sv[0], &legacy, sizeof(legacy), 0);
    obj.read_ext(sv[1]);

    /* Không có ext nào được nạp: từ chối là hành vi đúng. */
    EXPECT_EQ(obj.shm()->ext_count, 0u);
    EXPECT_EQ(obj.ext_provenance().sequence, 0u);

    /* Cùng magic v2 nhưng schema_version lạ ⇒ cũng phải từ chối. */
    kx_ext_snapshot_v2_t future{};
    future.magic          = KX_EXT_SNAP_V2_MAGIC;
    future.schema_version = KX_EXT_SNAP_SCHEMA_VER + 1;
    future.count          = 1;
    ::send(sv[0], &future, sizeof(future), 0);
    obj.read_ext(sv[1]);
    EXPECT_EQ(obj.shm()->ext_count, 0u);

    ::close(sv[0]);
    ::close(sv[1]);
    obj.detach();
}

/* ---- ABI: nối field RT health vào cuối KHÔNG được dịch offset cũ ----
 * apps/web-api/internal/app/core_client.go đọc plc_shm bằng offset CỨNG và kiểm độ dài theo
 * ngữ nghĩa min-length. Nối thêm vào cuối là tương thích ngược, nhưng chỉ khi
 * mọi offset cũ giữ nguyên — test này khoá điều đó lại. */

TEST(BacnetObjTableAbi, OffsetsMatchGoConstantsAfterExtV2)
{
    /* Các hằng dưới đây COPY từ apps/web-api/internal/app/core_client.go. Nếu ai đổi layout
     * làm chúng lệch, test fail và người sửa buộc phải đồng bộ cả hai phía.
     *
     * Đ-03 (2026-08-05) mở rộng kx_ext_point_t 40 → 64 byte, nên mọi offset SAU
     * ext[] dịch chỗ. Đây là ABI change có chủ đích và đi kèm magic v5. */
    EXPECT_EQ(offsetof(kx_plc_shm_t, ai), 16u);
    EXPECT_EQ(sizeof(kx_point_t), 76u);
    EXPECT_EQ(sizeof(kx_ext_point_t), 64u);
    EXPECT_EQ(offsetof(kx_plc_shm_t, ext), 6704u);
    EXPECT_EQ(offsetof(kx_plc_shm_t, scan_count), 23092u);
    EXPECT_EQ(offsetof(kx_plc_shm_t, scan_overrun), 23096u);
    EXPECT_EQ(sizeof(kx_plc_shm_t), 23104u);
}

TEST(BacnetObjTableAbi, RtHealthFieldsComeAfterLegacyRegion)
{
    EXPECT_GT(offsetof(kx_plc_shm_t, rt_sched_policy), offsetof(kx_plc_shm_t, ext));
    EXPECT_GT(offsetof(kx_plc_shm_t, rt_degraded), offsetof(kx_plc_shm_t, scan_overrun));
}

TEST(BacnetObjTableAbi, MagicBumpedSoStaleReadersFailLoudly)
{
    /* Layout của ext[] đổi thứ tự/kiểu/kích thước ⇒ magic BẮT BUỘC phải đổi.
     * Giữ nguyên magic ở đây nghĩa là một web binary cũ vẫn chấp nhận SHM mới
     * và đọc lệch trường trong im lặng — sai kiểu tệ nhất. */
    EXPECT_EQ(KX_SHM_MAGIC, 0x4B584406u);
    EXPECT_NE(KX_SHM_MAGIC, 0x4B584405u);
    EXPECT_NE(KX_SHM_MAGIC, 0x4B584404u);
}

TEST(BacnetObjTable, PublishesRtHealthSoDegradationIsObservable)
{
    BacnetObjTable t;
    BacnetObjTable::RtHealth h;
    h.sched_policy = 1;      /* SCHED_FIFO */
    h.sched_priority = 80;
    h.mlock_ok = true;
    h.degraded = false;
    t.set_rt_health(h);
    ASSERT_TRUE(t.attach());

    PointTable table;
    /* publish() deref ui_reliability[] vô điều kiện — truyền mảng thật. */
    const uint8_t rel[KX_N_UI] = {0};
    t.publish(table, 0, 0, 0, KX_IOP_NORMAL, rel);
    ASSERT_NE(t.shm(), nullptr);
    EXPECT_EQ(t.shm()->rt_sched_policy, 1u);
    EXPECT_EQ(t.shm()->rt_sched_priority, 80u);
    EXPECT_EQ(t.shm()->rt_mlock_ok, 1u);
    EXPECT_EQ(t.shm()->rt_degraded, 0u);
}

TEST(BacnetObjTable, DegradedRtIsVisibleInShm)
{
    BacnetObjTable t;
    BacnetObjTable::RtHealth h;   /* mặc định: degraded = true */
    t.set_rt_health(h);
    ASSERT_TRUE(t.attach());

    PointTable table;
    const uint8_t rel[KX_N_UI] = {0};
    t.publish(table, 0, 0, 0, KX_IOP_NORMAL, rel);
    ASSERT_NE(t.shm(), nullptr);
    EXPECT_EQ(t.shm()->rt_degraded, 1u)
        << "suy giảm RT phải quan sát được liên tục, không chỉ ở một dòng log";
}
