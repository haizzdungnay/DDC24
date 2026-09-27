/**
 * @file  spsc_ring.hpp
 * @brief ADR-061 4.10 bước 2 (X19) — hàng đợi MỘT luồng ghi, MỘT luồng đọc,
 *        dung lượng cố định, không khoá, không cấp phát.
 *
 * Dùng ở ranh giới giữa luồng quét (SCHED_FIFO, CPU của vòng quét) và luồng
 * phục vụ không-RT (SCHED_OTHER, CPU khác). Luồng quét chỉ được `try_push` /
 * `try_pop`: không chờ, không syscall, không cấp phát — mọi thứ nằm trong mảng
 * tĩnh của object.
 *
 * Đầy thì `try_push` trả `false` và KHÔNG ghi đè phần tử nào: hàng đợi này không
 * bao giờ âm thầm làm rơi dữ liệu, người gọi phải tự quyết định và nói ra kết
 * quả (ví dụ trả `busy` cho client).
 *
 * `T` phải trivially copyable: phần tử được chép bằng phép gán thường, và một
 * kiểu có cấp phát (std::string, std::vector) sẽ kéo cấp phát vào đường RT.
 * Kiểu nặng thì truyền CHỈ SỐ vào một mảng slot cấp phát sẵn (xem `WebIpc`).
 */
#ifndef CORE_SPSC_RING_HPP
#define CORE_SPSC_RING_HPP

#include <array>
#include <atomic>
#include <cstddef>
#include <type_traits>

namespace core {

template <typename T, std::size_t Capacity>
class SpscRing {
    static_assert(Capacity >= 2 && (Capacity & (Capacity - 1)) == 0,
                  "SpscRing: Capacity phai la luy thua cua 2");
    static_assert(std::is_trivially_copyable<T>::value,
                  "SpscRing: T phai trivially copyable (khong cap phat tren duong RT)");

public:
    static constexpr std::size_t capacity() noexcept { return Capacity; }

    /* Chỉ luồng GHI gọi. Đầy ⇒ false, hàng đợi giữ nguyên. */
    bool try_push(const T& value) noexcept
    {
        const std::size_t tail = tail_.load(std::memory_order_relaxed);
        const std::size_t head = head_.load(std::memory_order_acquire);
        if (tail - head >= Capacity) return false;
        slots_[tail & (Capacity - 1)] = value;
        /* release: phần tử vừa ghi phải thấy được TRƯỚC khi luồng đọc thấy tail mới. */
        tail_.store(tail + 1, std::memory_order_release);
        return true;
    }

    /* Chỉ luồng ĐỌC gọi. Rỗng ⇒ false, `*out` không đổi. */
    bool try_pop(T* out) noexcept
    {
        const std::size_t head = head_.load(std::memory_order_relaxed);
        const std::size_t tail = tail_.load(std::memory_order_acquire);
        if (head == tail) return false;
        *out = slots_[head & (Capacity - 1)];
        /* release: ô vừa đọc chỉ được trả cho luồng ghi SAU khi đã chép xong. */
        head_.store(head + 1, std::memory_order_release);
        return true;
    }

    /* Ước lượng: đúng tuyệt đối chỉ khi hai luồng đứng yên (dùng cho chẩn đoán). */
    std::size_t size_approx() const noexcept
    {
        const std::size_t tail = tail_.load(std::memory_order_acquire);
        const std::size_t head = head_.load(std::memory_order_acquire);
        return tail - head;
    }

private:
    /* head (luồng đọc ghi) và tail (luồng ghi ghi) nằm hai cache line khác nhau:
     * chung một line thì mỗi lần một bên ghi là bên kia mất line đó. */
    alignas(64) std::atomic<std::size_t> head_{0};
    alignas(64) std::atomic<std::size_t> tail_{0};
    alignas(64) std::array<T, Capacity> slots_{};
};

} // namespace core

#endif /* CORE_SPSC_RING_HPP */
