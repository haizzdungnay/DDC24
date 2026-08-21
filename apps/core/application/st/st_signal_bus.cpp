#include "st/st_signal_bus.hpp"

#include <cstring>

namespace core {

namespace {

/* Freshness đọc bằng nanosecond để so trực tiếp với mốc chu kỳ; khai báo bằng
 * mili-giây vì đó là đơn vị người dùng nhìn thấy. */
uint64_t freshness_ns(uint32_t freshness_ms)
{
    return static_cast<uint64_t>(freshness_ms) * 1000000ull;
}

} // namespace

const char* st_stale_policy_name(StStalePolicy policy)
{
    switch (policy) {
    case StStalePolicy::HOLD_LAST: return "HOLD_LAST";
    case StStalePolicy::USE_FALLBACK: return "USE_FALLBACK";
    case StStalePolicy::WAIT: return "WAIT";
    }
    return "?";
}

bool st_stale_policy_from_name(const char* name, StStalePolicy* out)
{
    if (name == nullptr || out == nullptr) return false;
    if (std::strcmp(name, "HOLD_LAST") == 0) { *out = StStalePolicy::HOLD_LAST; return true; }
    if (std::strcmp(name, "USE_FALLBACK") == 0) { *out = StStalePolicy::USE_FALLBACK; return true; }
    if (std::strcmp(name, "WAIT") == 0) { *out = StStalePolicy::WAIT; return true; }
    /* Không có nhánh mặc định. Một chính sách thứ tư đi qua được biên nghĩa là
     * runtime phải đoán thiết bị làm gì khi mất dữ liệu. */
    return false;
}

bool StSignalBus::declare(const StSignalDefinition& definition, std::string* error)
{
    if (count_ >= kMaxRuntimeSignals) {
        if (error) *error = "vượt trần " + std::to_string(kMaxRuntimeSignals) + " signal";
        return false;
    }
    if (definition.name.empty()) {
        if (error) *error = "signal không có tên";
        return false;
    }
    if (index_of(definition.name) >= 0) {
        /* Một tên, một publisher, một nguồn sự thật. Hai khai báo cùng tên nghĩa
         * là consumer không có cách nào biết đọc cái nào. */
        if (error) *error = "signal '" + definition.name + "' đã được khai báo";
        return false;
    }
    if ((definition.stale_policy == StStalePolicy::USE_FALLBACK) != definition.has_fallback) {
        /* `USE_FALLBACK` không có giá trị dự phòng là chính sách rỗng; giá trị dự
         * phòng ở chính sách khác là dữ liệu không bao giờ được dùng nhưng vẫn
         * làm người đọc tin rằng nó sẽ được dùng. */
        if (error)
            *error = "signal '" + definition.name + "': USE_FALLBACK và giá trị dự phòng phải đi liền nhau";
        return false;
    }
    definitions_[count_] = definition;
    buffers_[0][count_] = Slot{};
    buffers_[1][count_] = Slot{};
    count_++;
    return true;
}

void StSignalBus::clear()
{
    count_ = 0;
    live_.store(0, std::memory_order_release);
    generation_.store(0, std::memory_order_release);
    unavailable_reads_.store(0, std::memory_order_relaxed);
}

int StSignalBus::index_of(const std::string& name) const
{
    for (std::size_t index = 0; index < count_; ++index)
        if (definitions_[index].name == name) return static_cast<int>(index);
    return -1;
}

bool StSignalBus::publish(int index, const StCell& value, uint64_t now_ns, const char* publisher)
{
    if (index < 0 || static_cast<std::size_t>(index) >= count_) return false;
    const StSignalDefinition& definition = definitions_[static_cast<std::size_t>(index)];
    if (publisher != nullptr && definition.publisher_program != publisher) {
        /* Chỉ publisher đã khai mới được ghi. Cho Program khác ghi nghĩa là tên
         * signal có hai nguồn sự thật, và không ai đọc được cấu hình để biết
         * nguồn nào đang thắng. */
        return false;
    }
    /* Ghi vào bản NHÁP — bản mà không consumer nào đang đọc. */
    const std::size_t draft = 1u - live_.load(std::memory_order_acquire);
    Slot& slot = buffers_[draft][static_cast<std::size_t>(index)];
    slot.value = value;
    slot.published_at_ns = now_ns;
    slot.ever_published = true;
    return true;
}

void StSignalBus::commit_at_boundary()
{
    const std::size_t live = live_.load(std::memory_order_acquire);
    const std::size_t draft = 1u - live;
    /* Chép các ô KHÔNG được publish trong chu kỳ này sang bản nháp trước khi
     * đổi bản. Không chép thì một signal chỉ publish mỗi 30 s sẽ "biến mất" ở
     * chu kỳ kế tiếp, và `HOLD_LAST` sẽ giữ một ô rỗng thay vì giá trị cuối. */
    for (std::size_t index = 0; index < count_; ++index) {
        Slot& draft_slot = buffers_[draft][index];
        const Slot& live_slot = buffers_[live][index];
        if (draft_slot.published_at_ns < live_slot.published_at_ns || !draft_slot.ever_published)
            draft_slot = live_slot;
    }
    generation_.fetch_add(1, std::memory_order_acq_rel);
    /* Đổi bản là MỘT lần ghi atomic: consumer hoặc thấy trọn bản cũ hoặc trọn
     * bản mới. */
    live_.store(draft, std::memory_order_release);
}

StSignalRead StSignalBus::read(int index, uint64_t now_ns) const
{
    StSignalRead result;
    if (index < 0 || static_cast<std::size_t>(index) >= count_) {
        result.state = StSignalReadState::NOT_DECLARED;
        return result;
    }
    const std::size_t live = live_.load(std::memory_order_acquire);
    const StSignalDefinition& definition = definitions_[static_cast<std::size_t>(index)];
    const Slot& slot = buffers_[live][static_cast<std::size_t>(index)];
    result.generation = generation_.load(std::memory_order_acquire);
    result.published_at_ns = slot.published_at_ns;

    auto unavailable = [&]() {
        unavailable_reads_.fetch_add(1, std::memory_order_relaxed);
        result.state = StSignalReadState::UNAVAILABLE;
        if (definition.has_fallback) result.value = definition.fallback;
        return result;
    };

    if (!slot.ever_published) {
        /* Chưa ai publish. `USE_FALLBACK` vẫn có câu trả lời khai báo; hai chính
         * sách kia thì không — và bịa một giá trị ở đây đúng là lối "im lặng
         * thay bằng 0" mà DDD §10 cấm. */
        if (definition.stale_policy == StStalePolicy::USE_FALLBACK) {
            result.value = definition.fallback;
            result.state = StSignalReadState::STALE_FALLBACK;
            return result;
        }
        return unavailable();
    }

    const uint64_t age_ns = now_ns >= slot.published_at_ns ? now_ns - slot.published_at_ns : 0;
    if (age_ns <= freshness_ns(definition.freshness_ms)) {
        result.value = slot.value;
        result.state = StSignalReadState::FRESH;
        return result;
    }

    switch (definition.stale_policy) {
    case StStalePolicy::HOLD_LAST:
        result.value = slot.value;
        result.state = StSignalReadState::STALE_HELD;
        return result;
    case StStalePolicy::USE_FALLBACK:
        result.value = definition.fallback;
        result.state = StSignalReadState::STALE_FALLBACK;
        return result;
    case StStalePolicy::WAIT:
        return unavailable();
    }
    return unavailable();
}

StSignalRead StSignalBus::read(const std::string& name, uint64_t now_ns) const
{
    return read(index_of(name), now_ns);
}

void StSignalBus::note_publisher_stopped(const std::string& publisher_program)
{
    /* Cố ý KHÔNG xoá giá trị. Producer dừng làm giá trị quá hạn theo đúng
     * freshness đã khai — xoá ngay sẽ biến một sự cố có thời hạn thành một sự cố
     * tức thì, và `HOLD_LAST` mất hết ý nghĩa đúng vào lúc nó cần có nghĩa nhất.
     *
     * Hàm vẫn tồn tại vì caller cần một chỗ tường minh để nói "producer này đã
     * dừng"; giữ nó rỗng và có lý do rõ ràng tốt hơn là để caller tự nghĩ ra một
     * hành vi nào đó.  */
    (void)publisher_program;
}

} // namespace core
