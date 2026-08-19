#include "screens/screen_control.hpp"

#include <gtest/gtest.h>

/* `T57-3.19` — đếm ngược TTL lệnh ép tay trên màn Control.
 *
 * Quy tắc đáng khoá ở đây là quy tắc AN TOÀN chứ không phải phép trừ: đồng hồ
 * phải NGỪNG khi mất liên lạc. Một đồng hồ vẫn chạy sau khi kết nối chết nói
 * với người đứng trước tủ rằng "lệnh ép tay còn 4 phút nữa sẽ tự nhả" — trong
 * khi sự thật là ta không còn biết gì về lệnh đó. */

TEST(OverrideCountdownTest, CountsDownWhileLinkIsAlive)
{
    EXPECT_EQ(hmi::override_remaining_seconds(true, 300u, 0u, true), 300);
    EXPECT_EQ(hmi::override_remaining_seconds(true, 300u, 1000u, true), 299);
    EXPECT_EQ(hmi::override_remaining_seconds(true, 300u, 9000u, true), 291);
}

TEST(OverrideCountdownTest, StopsCountingWhenLinkIsDown)
{
    // Mất liên lạc ⇒ "không rõ", KHÔNG phải một con số nhỏ dần.
    EXPECT_EQ(hmi::override_remaining_seconds(true, 300u, 1000u, false), -1);
}

TEST(OverrideCountdownTest, StopsCountingWhenValueIsStale)
{
    // Còn "available" nhưng đã lâu không có phản hồi mới: cũng là không rõ.
    EXPECT_EQ(hmi::override_remaining_seconds(true, 300u, hmi::kOverrideTtlStaleMs + 1u, true), -1);
}

TEST(OverrideCountdownTest, NoTtlFromCoreIsUnknownNotZero)
{
    /* Core KHÔNG báo `overrideExpiresInS` nghĩa là không có lệnh có thời hạn —
     * khác hẳn "vừa hết hạn". Trả 0 ở đây sẽ hiện "00:00" và người đọc sẽ tưởng
     * lệnh vừa nhả. */
    EXPECT_EQ(hmi::override_remaining_seconds(false, 0u, 0u, true), -1);
}

TEST(OverrideCountdownTest, ReachesZeroExactlyAtExpiry)
{
    EXPECT_EQ(hmi::override_remaining_seconds(true, 5u, 5000u, true), 0);
    EXPECT_EQ(hmi::override_remaining_seconds(true, 5u, 6000u, true), 0);
}
