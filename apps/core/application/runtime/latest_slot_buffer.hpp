/**
 * @file  latest_slot_buffer.hpp
 * @brief T63-203 — "bản mới nhất" từ MỘT luồng ghi sang MỘT luồng đọc cho giá trị
 *        KHÔNG trivially copyable (vd `std::vector<PersistEntry>`), không khoá,
 *        không rách.
 *
 * Cùng thuật toán triple buffer với `LatestValueBuffer` (ba vùng ghi / giữa /
 * đọc, tráo chỉ số bằng MỘT `exchange` nguyên tử), khác ở một điểm: không có
 * `publish(const T&)`. Writer PHẢI điền `write_slot()` TẠI CHỖ bằng phép dùng
 * lại sức chứa sẵn có (vd `GraphRuntime::fill_persist_state`), vì một phép gán
 * cả object có thể kéo cấp phát vào luồng quét — đó là lý do `LatestValueBuffer`
 * đòi trivially copyable.
 *
 * `prewarm_all()` cho phép điền trước CẢ BA vùng (chỉ gọi khi CHƯA có luồng nào
 * dùng buffer), để lần bàn giao đầu tiên trên luồng quét cũng không cấp phát.
 *
 * Writer không bao giờ chờ reader: bản chưa được lấy bị bản mới thay (đúng ngữ
 * nghĩa "bản mới nhất"). Reader đang giữ vùng đọc (vd đang ghi đĩa) thì writer
 * vẫn tráo được giữa vùng ghi và vùng giữa.
 */
#ifndef CORE_LATEST_SLOT_BUFFER_HPP
#define CORE_LATEST_SLOT_BUFFER_HPP

#include <array>
#include <atomic>
#include <cstdint>

namespace core {

template <typename T>
class LatestSlotBuffer {
public:
    /* --- Chỉ khi chưa có luồng nào dùng buffer --- */
    template <typename Fn>
    void prewarm_all(Fn&& fill)
    {
        for (T& slot : buffers_) fill(slot);
    }

    /* --- Luồng GHI --- */
    T& write_slot() noexcept { return buffers_[write_index_]; }

    /* Công bố vùng vừa điền là bản mới nhất. Không chờ, không cấp phát. Trả true
     * khi bản công bố trước đó CHƯA được reader lấy (bị thay thế). */
    bool publish() noexcept
    {
        const uint8_t previous = middle_.exchange(static_cast<uint8_t>(write_index_ | kFresh),
                                                  std::memory_order_acq_rel);
        write_index_ = static_cast<uint8_t>(previous & kIndexMask);
        published_count_.fetch_add(1, std::memory_order_relaxed);
        return (previous & kFresh) != 0;
    }

    /* --- Luồng ĐỌC --- */
    bool has_fresh() const noexcept
    {
        return (middle_.load(std::memory_order_acquire) & kFresh) != 0;
    }

    bool acquire_latest() noexcept
    {
        if (!has_fresh()) return false;
        const uint8_t previous = middle_.exchange(read_index_, std::memory_order_acq_rel);
        read_index_ = static_cast<uint8_t>(previous & kIndexMask);
        return true;
    }

    const T& read_slot() const noexcept { return buffers_[read_index_]; }

    uint64_t published_count() const noexcept
    {
        return published_count_.load(std::memory_order_relaxed);
    }

private:
    static constexpr uint8_t kIndexMask = 0x3;
    static constexpr uint8_t kFresh = 0x4;

    std::array<T, 3> buffers_{};
    alignas(64) uint8_t write_index_ = 0;
    alignas(64) std::atomic<uint8_t> middle_{1};
    alignas(64) uint8_t read_index_ = 2;
    std::atomic<uint64_t> published_count_{0};
};

} // namespace core

#endif /* CORE_LATEST_SLOT_BUFFER_HPP */
