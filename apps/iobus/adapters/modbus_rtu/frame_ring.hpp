#ifndef IOBUS_MODBUS_FRAME_RING_HPP
#define IOBUS_MODBUS_FRAME_RING_HPP

#include <array>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <mutex>
#include <string>

namespace iobus::fieldbus {

/* Mốc thời gian của khung phải là ĐỒNG HỒ TƯỜNG (epoch ms), không phải đồng hồ
 * đơn điệu.
 *
 * Vòng quét của iobus dùng `CLOCK_MONOTONIC` — đúng cho việc đo nhịp, sai cho
 * việc hiển thị: giao diện đọc trường này bằng `new Date(at)`, nên một giá trị
 * uptime sẽ hiện thành một giờ năm 1970. Cột thời gian là thứ người kỹ thuật
 * dùng để đối chiếu khung với thao tác họ vừa làm ở tủ; một cột thời gian sai
 * còn tệ hơn không có cột nào. Lỗi này bị bắt tại test `BusWorkerFrames`
 * (2026-08-19) trước khi kịp lên board. */
inline uint64_t frame_wall_clock_ms()
{
    timespec ts{};
    clock_gettime(CLOCK_REALTIME, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000ull +
           static_cast<uint64_t>(ts.tv_nsec) / 1000000ull;
}

/* Vòng nhớ giao dịch Modbus RTU — `T57-3.9`, theo `ADR-046` bản sửa 2026-08-19.
 *
 * VÌ SAO LÀ BẢN GHI GIAO DỊCH CHỨ KHÔNG PHẢI BYTE THÔ
 *
 * `ADR-046` bản đầu hứa "byte thô dạng hex". Không làm được: libmodbus không lộ
 * bộ đệm wire ra ngoài, muốn có byte thô phải thay lớp transport của chính thư
 * viện đang điều khiển bus RS-485 thật — rủi ro không tương xứng với một tính
 * năng chẩn đoán. ADR đã được sửa; đây là hình dạng đã chốt.
 *
 * Ba câu hỏi hiện trường vẫn trả lời được đủ:
 *   · khung có ra dây không   → có bản ghi, `attempt` tăng khi phát lại;
 *   · slave có trả lời không  → `ok`;
 *   · CRC đúng không          → `reason` = `crc`.
 *
 * BA RÀNG BUỘC KHÔNG ĐƯỢC VI PHẠM
 *
 * 1. **CHỈ-ĐỌC.** Lớp này chỉ được gọi SAU khi một giao dịch của chu kỳ poll
 *    bình thường đã xong. Nó không phát gì, không giữ cổng, không lên lịch gì.
 *    Không một byte nào được phát thêm vì mục đích quan sát (`ADR-046` điều 1,
 *    và ranh giới tách `T57-3.9` khỏi `T57-3.8` đang hoãn sang Rev B).
 * 2. **Mất khi restart.** Vòng nhớ nằm trong tiến trình iobus. Đây là công cụ
 *    chẩn đoán tại chỗ, không phải nhật ký lưu trữ — giao diện phải nói ra.
 * 3. **Không chặn vòng quét.** `record()` chỉ ghi vào một mảng cố định dưới một
 *    mutex không tranh chấp; không cấp phát, không I/O. Ghi log đồng bộ trong
 *    vòng quét realtime chính là lỗi `F-PRIO-001` vừa phải vá hôm nay.
 */

/* 200 khung theo `ADR-046`. Ở nhịp poll 1 s với vài slave, đây là vài phút gần
 * nhất — đủ để soi một sự cố vừa xảy ra, và đủ nhỏ để không ăn RAM của bo. */
inline constexpr size_t kFrameRingCapacity = 200;

struct FrameRecord {
    uint64_t at_ms = 0;
    uint8_t  bus = 0;
    uint8_t  slave = 0;
    uint8_t  fc = 0;
    uint16_t addr = 0;
    uint16_t count = 0;
    uint32_t elapsed_us = 0;
    uint8_t  attempt = 1;
    bool     ok = false;
    /* `ok` · `timeout` · `crc` · `exception` · `error` — phân loại đã có sẵn ở
     * chỗ gọi, không suy đoán lại ở đây. */
    char reason[12] = "ok";
};

class FrameRing {
public:
    void record(const FrameRecord& record)
    {
        std::lock_guard<std::mutex> guard(mu_);
        items_[next_ % kFrameRingCapacity] = record;
        next_++;
        if (size_ < kFrameRingCapacity) size_++;
    }

    /* Trả JSON mảng khung, MỚI NHẤT TRƯỚC.
     *
     * `bus_filter = 0` nghĩa là mọi bus (id bus hợp lệ bắt đầu từ 1). `limit`
     * bị kẹp vào [1, kFrameRingCapacity] — một tham số ngoài dải là lỗi của
     * caller, không phải lý do để trả cả vòng nhớ hay trả rỗng. */
    std::string to_json(uint8_t bus_filter, int limit) const
    {
        if (limit <= 0) limit = static_cast<int>(kFrameRingCapacity);
        if (limit > static_cast<int>(kFrameRingCapacity)) limit = static_cast<int>(kFrameRingCapacity);

        std::lock_guard<std::mutex> guard(mu_);
        std::string out = "[";
        int emitted = 0;
        for (uint64_t back = 0; back < size_ && emitted < limit; back++) {
            const FrameRecord& item = items_[(next_ - 1 - back) % kFrameRingCapacity];
            if (bus_filter != 0 && item.bus != bus_filter) continue;
            char buf[256];
            std::snprintf(buf, sizeof(buf),
                          "%s{\"at\":%llu,\"bus\":%u,\"slave\":%u,\"fc\":%u,\"addr\":%u,"
                          "\"count\":%u,\"ok\":%s,\"reason\":\"%s\",\"elapsedUs\":%u,\"attempt\":%u}",
                          emitted ? "," : "",
                          static_cast<unsigned long long>(item.at_ms),
                          item.bus, item.slave, item.fc, item.addr, item.count,
                          item.ok ? "true" : "false", item.reason,
                          item.elapsed_us, item.attempt);
            out += buf;
            emitted++;
        }
        out += "]";
        return out;
    }

    size_t size() const
    {
        std::lock_guard<std::mutex> guard(mu_);
        return size_;
    }

private:
    mutable std::mutex mu_;
    std::array<FrameRecord, kFrameRingCapacity> items_{};
    uint64_t next_ = 0;
    size_t   size_ = 0;
};

} // namespace iobus::fieldbus

#endif // IOBUS_MODBUS_FRAME_RING_HPP
