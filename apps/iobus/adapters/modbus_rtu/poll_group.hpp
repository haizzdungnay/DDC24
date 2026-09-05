/**
 * @file  poll_group.hpp
 * @brief `ISS-PIO-22`/`F-PIO-021` — nhóm poll theo ĐIỂM và ngưỡng stale riêng.
 *
 * Trước bản vá `poll_ms`/`timeout_ms` chỉ có ở cấp Device: một điểm cấu hình
 * (đọc một lần mỗi phút là đủ) bị poll cùng nhịp với tần số VFD (500 ms) và
 * tiêu băng thông RS-485 vô ích.
 *
 * Tách thành hàm thuần để kiểm thử được từng luật mà không cần bus thật.
 */
#ifndef IOBUS_POLL_GROUP_HPP
#define IOBUS_POLL_GROUP_HPP

#include <cstdint>

#include "device_profile.hpp"

namespace iobus::fieldbus {

/* Hệ số suy chu kỳ nhóm `Slow` từ `poll_ms` khi Device không khai riêng.
 * 10× là mức làm "chậm" thực sự khác "bình thường" mà vẫn giữ điểm cập nhật
 * trong khoảng người vận hành còn chờ được (1 s → 10 s). */
constexpr uint32_t kSlowPollFactor = 10;

/* Bội số chu kỳ dùng để suy ngưỡng STALE khi điểm không khai riêng. */
constexpr uint32_t kStaleIntervalFactor = 3;

/* Sàn/trần tuyệt đối cho ngưỡng suy ra. Sàn giữ điểm nhịp nhanh không nhấp
 * nháy vì một khung hỏng; trần giữ điểm nhịp rất chậm vẫn hạ stale trong đời
 * một ca trực. */
constexpr uint32_t kMinStaleAfterMs = 3000;
constexpr uint32_t kMaxStaleAfterMs = 600000;

/* Chu kỳ hiệu lực của một nhóm. `fast_ms`/`slow_ms` = 0 nghĩa là Device không
 * khai riêng ⇒ suy từ `poll_ms`. */
uint32_t group_interval_ms(PollGroup group, uint32_t poll_ms, uint32_t fast_ms, uint32_t slow_ms);

/* Ngưỡng STALE hiệu lực của một điểm. `stale_after_ms` = 0 ⇒ suy từ chu kỳ. */
uint32_t effective_stale_after_ms(uint32_t stale_after_ms, uint32_t interval_ms);

/* Một block đã đến hạn poll chưa. */
bool block_is_due(uint64_t last_poll_ms, uint64_t now_ms, uint32_t interval_ms);

} // namespace iobus::fieldbus

#endif /* IOBUS_POLL_GROUP_HPP */
