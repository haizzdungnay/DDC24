/**
 * @file  latest_value_buffer.hpp
 * @brief ADR-061 4.10 bước 2 (X19) — trao "bản mới nhất" của một giá trị từ MỘT
 *        luồng ghi sang MỘT luồng đọc, không khoá, không rách (triple buffer).
 *
 * Luồng quét ghi snapshot mỗi base step; luồng IPC chỉ cần bản mới nhất lúc có
 * yêu cầu. Hàng đợi là sai công cụ ở đây: đầy thì phải chọn giữa chặn luồng quét
 * và bỏ bản mới. Ba vùng nhớ cố định giải quyết đúng bài toán:
 *
 *   - vùng GHI của writer: chỉ writer chạm;
 *   - vùng GIỮA: bản đã công bố, chưa ai lấy;
 *   - vùng ĐỌC của reader: chỉ reader chạm.
 *
 * `publish()` tráo vùng ghi với vùng giữa, `acquire_latest()` tráo vùng giữa với
 * vùng đọc, cả hai bằng MỘT phép `exchange` nguyên tử. Writer không bao giờ ghi
 * vào vùng reader đang đọc, nên bản đọc ra luôn là trọn vẹn MỘT lần ghi (không
 * rách), và writer không bao giờ phải chờ reader (bản chưa ai lấy bị bản mới
 * thay — đúng ngữ nghĩa "bản mới nhất").
 *
 * `T` phải trivially copyable: object sống trong mảng tĩnh, và phép gán không
 * được kéo cấp phát vào đường RT.
 */
#ifndef CORE_LATEST_VALUE_BUFFER_HPP
#define CORE_LATEST_VALUE_BUFFER_HPP

#include <array>
#include <atomic>
#include <cstdint>
#include <type_traits>

namespace core {

template <typename T>
class LatestValueBuffer {
    static_assert(std::is_trivially_copyable<T>::value,
                  "LatestValueBuffer: T phai trivially copyable (khong cap phat tren duong RT)");

public:
    /* --- Luồng GHI --- */

    /* Vùng ghi riêng của writer. Ghi xong gọi `publish()`. */
    T& write_slot() noexcept { return buffers_[write_index_]; }

    /* Công bố vùng vừa ghi là bản mới nhất. Không chờ, không cấp phát. */
    void publish() noexcept
    {
        const uint8_t previous = middle_.exchange(static_cast<uint8_t>(write_index_ | kFresh),
                                                  std::memory_order_acq_rel);
        write_index_ = static_cast<uint8_t>(previous & kIndexMask);
        published_count_.fetch_add(1, std::memory_order_relaxed);
    }

    /* Tiện dụng: chép `value` vào vùng ghi rồi công bố. */
    void publish(const T& value) noexcept
    {
        write_slot() = value;
        publish();
    }

    /* --- Luồng ĐỌC --- */

    /* Lấy bản mới nhất về vùng đọc. true khi có bản mới kể từ lần lấy trước;
     * false thì vùng đọc giữ nguyên bản cũ. */
    bool acquire_latest() noexcept
    {
        if ((middle_.load(std::memory_order_acquire) & kFresh) == 0) return false;
        const uint8_t previous = middle_.exchange(read_index_, std::memory_order_acq_rel);
        read_index_ = static_cast<uint8_t>(previous & kIndexMask);
        has_value_ = true;
        return true;
    }

    /* Bản đã lấy gần nhất. Chỉ có nghĩa khi `has_value()`. */
    const T& read_slot() const noexcept { return buffers_[read_index_]; }
    bool has_value() const noexcept { return has_value_; }

    /* Số lần writer đã công bố (chẩn đoán/test). */
    uint64_t published_count() const noexcept
    {
        return published_count_.load(std::memory_order_relaxed);
    }

private:
    static constexpr uint8_t kIndexMask = 0x3;
    static constexpr uint8_t kFresh = 0x4;

    std::array<T, 3> buffers_{};
    /* Mỗi chỉ số thuộc đúng một bên; ba chỉ số luôn là một hoán vị của {0,1,2}. */
    alignas(64) uint8_t write_index_ = 0;
    alignas(64) std::atomic<uint8_t> middle_{1};
    alignas(64) uint8_t read_index_ = 2;
    bool has_value_ = false;
    std::atomic<uint64_t> published_count_{0};
};

} // namespace core

#endif /* CORE_LATEST_VALUE_BUFFER_HPP */
