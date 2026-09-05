/**
 * @file poll_group.cpp
 * @brief `ISS-PIO-22` — nhóm poll theo điểm và ngưỡng stale riêng (đề bài §22).
 */
#include "poll_group.hpp"

#include <cstring>

namespace iobus::fieldbus {

PollGroup poll_group_from_string(const char* s)
{
    if (s == nullptr) return PollGroup::Normal;
    if (std::strcmp(s, "fast") == 0) return PollGroup::Fast;
    if (std::strcmp(s, "slow") == 0) return PollGroup::Slow;
    return PollGroup::Normal;
}

const char* poll_group_name(PollGroup g)
{
    switch (g) {
    case PollGroup::Fast: return "fast";
    case PollGroup::Slow: return "slow";
    default:              return "normal";
    }
}

uint32_t group_interval_ms(PollGroup group, uint32_t poll_ms, uint32_t fast_ms, uint32_t slow_ms)
{
    /* `poll_ms == 0` là cấu hình hỏng chứ không phải "poll liên tục": trả về 0
     * sẽ làm mọi block luôn đến hạn và chiếm trọn dây. Rơi về mặc định 1000 ms
     * giống `SlaveConfig`. */
    if (poll_ms == 0) poll_ms = 1000;
    switch (group) {
    case PollGroup::Fast:
        return fast_ms > 0 ? fast_ms : poll_ms;
    case PollGroup::Slow:
        return slow_ms > 0 ? slow_ms : poll_ms * kSlowPollFactor;
    default:
        return poll_ms;
    }
}

uint32_t effective_stale_after_ms(uint32_t stale_after_ms, uint32_t interval_ms)
{
    /* Khai rõ thì dùng đúng con số đó. Không kẹp xuống theo chu kỳ: người vận
     * hành có quyền chấp nhận một điểm cũ hơn vài chu kỳ. */
    if (stale_after_ms > 0) return stale_after_ms;
    /* Suy: bội số của chu kỳ, tối thiểu một sàn tuyệt đối.
     *
     * Vì sao phải có bội số > 1: hạ STALE ngay khi trễ một chu kỳ sẽ biến mọi
     * nhiễu RS-485 thoáng qua — thứ `retry` sinh ra để chịu đựng — thành một
     * lần nhấp nháy quality trên toàn hệ thống. */
    const uint64_t derived = static_cast<uint64_t>(interval_ms) * kStaleIntervalFactor;
    if (derived < kMinStaleAfterMs) return kMinStaleAfterMs;
    if (derived > kMaxStaleAfterMs) return kMaxStaleAfterMs;
    return static_cast<uint32_t>(derived);
}

bool block_is_due(uint64_t last_poll_ms, uint64_t now_ms, uint32_t interval_ms)
{
    /* Chưa poll lần nào (`last_poll_ms == 0`) thì đến hạn ngay: một điểm mới
     * cấu hình phải có mẫu đầu tiên sớm nhất có thể, không phải sau một chu kỳ
     * `slow` dài cả phút. */
    if (last_poll_ms == 0) return true;
    if (now_ms < last_poll_ms) return true; /* đồng hồ lùi ⇒ poll lại thay vì treo */
    return now_ms - last_poll_ms >= interval_ms;
}

} // namespace iobus::fieldbus
