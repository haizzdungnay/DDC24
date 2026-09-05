/**
 * @file test_write_verify.cpp
 * @brief `ISS-PIO-23`/`F-PIO-022` — xác nhận sau khi ghi (đề bài §26).
 *
 * Trước bản vá `readback` chỉ ĐỌC LẠI rồi báo con số; nó không bao giờ SO SÁNH
 * với giá trị vừa ghi, và `status` vẫn là `applied` kể cả khi thiết bị trả về
 * một giá trị khác hẳn.
 */
#include <gtest/gtest.h>

#include <cmath>
#include <limits>

#include "modbus_rtu/write_verify.hpp"

using namespace iobus::fieldbus;

TEST(WriteVerify, ExactValueMatches)
{
    EXPECT_TRUE(readback_matches(23.4, 23.4, 0.1, 0.0));
    EXPECT_TRUE(readback_matches(0.0, 0.0, 1.0, 0.0));
    EXPECT_TRUE(readback_matches(-5.0, -5.0, 1.0, 0.0));
}

/* Sai số làm tròn của chính `encode`/`decode` KHÔNG được báo là lệch.
 * `scale=0.1` biến 23.4 thành 234 rồi ngược lại thành 23.400000572; một phép so
 * bằng tuyệt đối sẽ báo lệch cho mọi lệnh ghi ĐÚNG. */
TEST(WriteVerify, RoundTripQuantisationIsNotAMismatch)
{
    EXPECT_TRUE(readback_matches(23.4, 23.400000572, 0.1, 0.0));
    EXPECT_TRUE(readback_matches(100.0, 99.9999999, 1.0, 0.0));
}

/* Đây là ca mà issue nêu đích danh: VFD có tham số bị khoá ACK lệnh rồi giữ
 * nguyên giá trị cũ. Nửa bước lượng tử phải đủ chặt để bắt được. */
TEST(WriteVerify, DeviceKeepingItsOldValueIsAMismatch)
{
    EXPECT_FALSE(readback_matches(50.0, 45.0, 0.1, 0.0));
    EXPECT_FALSE(readback_matches(23.4, 23.5, 0.1, 0.0)) << "lệch đúng một bước lượng tử";
}

TEST(WriteVerify, ToleranceDerivesFromScaleWhenNotDeclared)
{
    EXPECT_DOUBLE_EQ(default_readback_tolerance(0.1), 0.05);
    EXPECT_DOUBLE_EQ(default_readback_tolerance(1.0), 0.5);
    EXPECT_DOUBLE_EQ(default_readback_tolerance(-0.1), 0.05) << "scale âm vẫn cho bước dương";
}

/* `scale` không hợp lệ thì không suy được bước lượng tử. Rơi về một dung sai
 * rất nhỏ chứ KHÔNG phải 0: so bằng tuyệt đối trên `double` sẽ báo lệch vì
 * chính phép nhân/chia của encode/decode. */
TEST(WriteVerify, InvalidScaleFallsBackToATinyToleranceNotZero)
{
    EXPECT_GT(default_readback_tolerance(0.0), 0.0);
    EXPECT_GT(default_readback_tolerance(std::nan("")), 0.0);
    EXPECT_LT(default_readback_tolerance(0.0), 1e-6);
}

TEST(WriteVerify, DeclaredToleranceWins)
{
    // Người vận hành biết thiết bị của mình làm tròn thô hơn thì có quyền nới.
    EXPECT_TRUE(readback_matches(50.0, 49.5, 0.1, 1.0));
    EXPECT_FALSE(readback_matches(50.0, 48.0, 0.1, 1.0));
}

/* Giá trị không hữu hạn ở BẤT KỲ vế nào là KHÔNG khớp. `NaN != NaN` nên một
 * phép so ngây thơ sẽ luôn báo lệch, còn coi nó là khớp thì lại nuốt mất một
 * lỗi decode thật — cả hai đều sai, nên phải nói rõ là không khớp. */
TEST(WriteVerify, NonFiniteValuesNeverMatch)
{
    const double nan = std::nan("");
    const double inf = std::numeric_limits<double>::infinity();
    EXPECT_FALSE(readback_matches(nan, nan, 1.0, 0.0));
    EXPECT_FALSE(readback_matches(1.0, nan, 1.0, 0.0));
    EXPECT_FALSE(readback_matches(nan, 1.0, 1.0, 0.0));
    EXPECT_FALSE(readback_matches(inf, inf, 1.0, 0.0));
}

/* Coil chỉ có hai trạng thái; đối chiếu phải chặt tuyệt đối ở đây vì nhóm điểm
 * này (relay đóng/cắt) là nhóm nguy hiểm nhất khi báo sai. */
TEST(WriteVerify, CoilStatesCompareExactly)
{
    EXPECT_TRUE(readback_matches(1.0, 1.0, 1.0, 0.0));
    EXPECT_TRUE(readback_matches(0.0, 0.0, 1.0, 0.0));
    EXPECT_FALSE(readback_matches(1.0, 0.0, 1.0, 0.0)) << "lệnh đóng mà relay vẫn mở";
    EXPECT_FALSE(readback_matches(0.0, 1.0, 1.0, 0.0)) << "lệnh cắt mà relay vẫn đóng";
}

/* ---- Kết luận: khi nào ĐƯỢC nói `applied` ----
 *
 * Đây là tiêu chí chấp nhận thứ hai của issue: "thất bại read-back ⇒ báo rõ,
 * không im lặng coi là thành công". */

TEST(WriteVerify, MatchingReadbackIsTheOnlyWayToSayApplied)
{
    const auto ok = verify_write_outcome(true, 23.4, 23.4, 0.1, 0.0);
    EXPECT_STREQ(ok.status, "applied");
    EXPECT_STREQ(ok.reason, "");
}

/* Bản MBR-B107 đặt `reason = "readback_failed"` nhưng vẫn để `status =
 * "applied"`, nên không consumer nào phân biệt được với một lệnh đã xác nhận
 * thật. Slave ACK lệnh ghi chỉ nói nó NHẬN khung, không nói nó GIỮ giá trị. */
TEST(WriteVerify, FailedReadbackIsNeverApplied)
{
    const auto failed = verify_write_outcome(false, 23.4, 0.0, 0.1, 0.0);
    EXPECT_STREQ(failed.status, "unverified");
    EXPECT_STREQ(failed.reason, "readback_failed");
}

/* Ca mà issue nêu đích danh: VFD có tham số bị khoá ACK lệnh rồi giữ nguyên
 * giá trị cũ. */
TEST(WriteVerify, MismatchedReadbackIsNeverApplied)
{
    const auto bad = verify_write_outcome(true, 50.0, 45.0, 0.1, 0.0);
    EXPECT_STREQ(bad.status, "unverified");
    EXPECT_STREQ(bad.reason, "readback_mismatch");
}

/* `unverified` KHÔNG được gộp vào `rejected`: lệnh đã thật sự đi xuống dây và
 * có thể đã có tác dụng một phần. Gộp vào một trong hai đầu đều nói sai một nửa. */
TEST(WriteVerify, UnverifiedIsItsOwnStatusNotRejected)
{
    for (const auto& outcome : {verify_write_outcome(false, 1.0, 0.0, 1.0, 0.0),
                                verify_write_outcome(true, 1.0, 0.0, 1.0, 0.0)}) {
        EXPECT_STRNE(outcome.status, "rejected");
        EXPECT_STRNE(outcome.status, "applied");
        EXPECT_STREQ(outcome.status, "unverified");
    }
}

/* Relay: lệnh đóng mà đọc lại thấy vẫn mở là ca nguy hiểm nhất khi báo sai. */
TEST(WriteVerify, CoilMismatchIsReportedNotSwallowed)
{
    const auto bad = verify_write_outcome(true, 1.0, 0.0, 1.0, 0.0);
    EXPECT_STREQ(bad.status, "unverified");
    EXPECT_STREQ(bad.reason, "readback_mismatch");
}
