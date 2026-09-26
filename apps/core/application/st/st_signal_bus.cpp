#include "st/st_signal_bus.hpp"

#include "st/st_limits.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>

namespace core {

namespace {

/* Freshness đọc bằng nanosecond để so trực tiếp với mốc chu kỳ; khai báo bằng
 * mili-giây vì đó là đơn vị người dùng nhìn thấy. */
uint64_t freshness_ns(uint32_t freshness_ms)
{
    return static_cast<uint64_t>(freshness_ms) * 1000000ull;
}

bool signal_name_valid(const std::string& value)
{
    if (value.empty() || value.size() > kMaxPouNameLength) return false;
    const unsigned char first = static_cast<unsigned char>(value.front());
    if (!std::isalpha(first) && value.front() != '_') return false;
    return std::all_of(value.begin() + 1, value.end(), [](char raw) {
        const unsigned char ch = static_cast<unsigned char>(raw);
        return std::isalnum(ch) || raw == '_';
    });
}

bool signal_name_equal(const std::string& left, const std::string& right)
{
    if (left.size() != right.size()) return false;
    for (std::size_t index = 0; index < left.size(); ++index) {
        if (std::toupper(static_cast<unsigned char>(left[index])) !=
            std::toupper(static_cast<unsigned char>(right[index])))
            return false;
    }
    return true;
}

bool fallback_value_valid(const StSignalDefinition& definition)
{
    if (!definition.has_fallback) return true;
    switch (definition.type) {
    case StType::BOOL: return true;
    case StType::DINT: return true;
    case StType::REAL: return std::isfinite(definition.fallback.r);
    case StType::TIME: return definition.fallback.t >= 0;
    case StType::INT:
        return definition.fallback.i >= -32768 && definition.fallback.i <= 32767;
    case StType::UINT:
        return definition.fallback.i >= 0 && definition.fallback.i <= 65535;
    }
    return false;
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

int StSignalBus::index_of(const Bank& bank, const std::string& name)
{
    for (std::size_t index = 0; index < bank.count; ++index)
        if (signal_name_equal(bank.definitions[index].name, name)) return static_cast<int>(index);
    return -1;
}

bool StSignalBus::declare(Bank* bank, const StSignalDefinition& definition, std::string* error)
{
    if (bank == nullptr) return false;
    if (bank->count >= kMaxRuntimeSignals) {
        if (error) *error = "vượt trần " + std::to_string(kMaxRuntimeSignals) + " signal";
        return false;
    }
    if (!signal_name_valid(definition.name)) {
        if (error) *error = "signal không có IEC identifier hợp lệ";
        return false;
    }
    if (definition.publisher_program.empty()) {
        if (error) *error = "signal '" + definition.name + "' không có publisher";
        return false;
    }
    if (static_cast<uint8_t>(definition.type) < static_cast<uint8_t>(StType::BOOL) ||
        static_cast<uint8_t>(definition.type) > static_cast<uint8_t>(StType::UINT) ||
        definition.freshness_ms < st_limits::kMinSignalFreshnessMs ||
        definition.freshness_ms > st_limits::kMaxSignalFreshnessMs ||
        static_cast<uint8_t>(definition.stale_policy) >
            static_cast<uint8_t>(StStalePolicy::WAIT) ||
        !fallback_value_valid(definition)) {
        if (error) *error = "signal '" + definition.name + "' có contract không hợp lệ";
        return false;
    }
    if (index_of(*bank, definition.name) >= 0) {
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
    bank->definitions[bank->count] = definition;
    bank->buffers[0][bank->count] = Slot{};
    bank->buffers[1][bank->count] = Slot{};
    bank->count++;
    return true;
}

uint8_t StSignalBus::acquire_active_bank() const noexcept
{
    for (;;) {
        const uint8_t bank = active_bank_.load(std::memory_order_acquire);
        bank_readers_[bank].fetch_add(1, std::memory_order_acq_rel);
        if (active_bank_.load(std::memory_order_acquire) == bank) return bank;
        bank_readers_[bank].fetch_sub(1, std::memory_order_release);
    }
}

void StSignalBus::release_bank(uint8_t bank) const noexcept
{
    bank_readers_[bank].fetch_sub(1, std::memory_order_release);
}

bool StSignalBus::declare(const StSignalDefinition& definition, std::string* error)
{
    /* API bootstrap/test cũ: chỉ hợp lệ khi chưa có reader concurrent. Runtime
     * package phải đi qua prepare_replacement(). */
    return declare(&banks_[active_bank_.load(std::memory_order_relaxed)], definition, error);
}

void StSignalBus::clear()
{
    Bank& bank = banks_[active_bank_.load(std::memory_order_relaxed)];
    bank.count = 0;
    bank.live.store(0, std::memory_order_release);
    bank.generation.store(0, std::memory_order_release);
    bank.unavailable_reads.store(0, std::memory_order_relaxed);
}

bool StSignalBus::prepare_replacement(
    const std::vector<StSignalDefinition>& definitions, std::string* error)
{
    if (prepared_bank_ >= 0) {
        if (error) *error = "đã có signal contract đang chờ activate";
        return false;
    }
    const uint8_t active = active_bank_.load(std::memory_order_acquire);
    int selected = -1;
    for (std::size_t index = 0; index < kContractBanks; ++index) {
        if (index == active || static_cast<int>(index) == previous_bank_) continue;
        if (bank_readers_[index].load(std::memory_order_acquire) == 0) {
            selected = static_cast<int>(index);
            break;
        }
    }
    if (selected < 0) {
        if (error) *error = "không có signal contract bank rảnh; reader cũ chưa kết thúc";
        return false;
    }

    Bank& bank = banks_[static_cast<std::size_t>(selected)];
    bank.count = 0;
    bank.live.store(0, std::memory_order_relaxed);
    bank.generation.store(0, std::memory_order_relaxed);
    bank.unavailable_reads.store(0, std::memory_order_relaxed);
    for (const StSignalDefinition& definition : definitions) {
        if (!declare(&bank, definition, error)) {
            bank.count = 0;
            return false;
        }
    }
    prepared_bank_ = static_cast<int8_t>(selected);
    return true;
}

void StSignalBus::discard_prepared_replacement() noexcept
{
    prepared_bank_ = -1;
}

bool StSignalBus::activate_prepared_replacement_at_boundary() noexcept
{
    if (prepared_bank_ < 0 || previous_bank_ >= 0) return false;
    previous_bank_ = static_cast<int8_t>(active_bank_.load(std::memory_order_relaxed));
    active_bank_.store(static_cast<uint8_t>(prepared_bank_), std::memory_order_release);
    prepared_bank_ = -1;
    return true;
}

bool StSignalBus::rollback_replacement_at_boundary() noexcept
{
    if (previous_bank_ < 0) return false;
    active_bank_.store(static_cast<uint8_t>(previous_bank_), std::memory_order_release);
    previous_bank_ = -1;
    return true;
}

void StSignalBus::commit_replacement() noexcept
{
    previous_bank_ = -1;
}

std::size_t StSignalBus::size() const
{
    const uint8_t bank = acquire_active_bank();
    const std::size_t result = banks_[bank].count;
    release_bank(bank);
    return result;
}

int StSignalBus::index_of(const std::string& name) const
{
    const uint8_t bank = acquire_active_bank();
    const int result = index_of(banks_[bank], name);
    release_bank(bank);
    return result;
}

bool StSignalBus::publish(int index, const StCell& value, uint64_t now_ns, const char* publisher)
{
    const uint8_t bank_index = acquire_active_bank();
    Bank& bank = banks_[bank_index];
    if (index < 0 || static_cast<std::size_t>(index) >= bank.count) {
        release_bank(bank_index);
        return false;
    }
    const StSignalDefinition& definition = bank.definitions[static_cast<std::size_t>(index)];
    if (publisher != nullptr && definition.publisher_program != publisher) {
        /* Chỉ publisher đã khai mới được ghi. Cho Program khác ghi nghĩa là tên
         * signal có hai nguồn sự thật, và không ai đọc được cấu hình để biết
         * nguồn nào đang thắng. */
        release_bank(bank_index);
        return false;
    }
    /* Ghi vào bản NHÁP — bản mà không consumer nào đang đọc. */
    const std::size_t draft = 1u - bank.live.load(std::memory_order_acquire);
    Slot& slot = bank.buffers[draft][static_cast<std::size_t>(index)];
    slot.value = value;
    slot.published_at_ns = now_ns;
    slot.ever_published = true;
    release_bank(bank_index);
    return true;
}

bool StSignalBus::publish_batch(const StIrSignalRef* refs, const StCell* values,
                                const uint8_t* writes, std::size_t count,
                                uint64_t now_ns, const char* publisher)
{
    if ((count != 0 && (refs == nullptr || values == nullptr || writes == nullptr)) ||
        publisher == nullptr)
        return false;
    const uint8_t bank_index = acquire_active_bank();
    Bank& bank = banks_[bank_index];
    /* Pha 1 chỉ kiểm, tuyệt đối chưa ghi draft. */
    for (std::size_t index = 0; index < count; ++index) {
        if (writes[index] == 0) continue;
        const int runtime_index = refs[index].runtime_index;
        if (!refs[index].publish || runtime_index < 0 ||
            static_cast<std::size_t>(runtime_index) >= bank.count) {
            release_bank(bank_index);
            return false;
        }
        const StSignalDefinition& definition =
            bank.definitions[static_cast<std::size_t>(runtime_index)];
        if (definition.name != refs[index].name ||
            definition.type != refs[index].type ||
            definition.publisher_program != publisher) {
            release_bank(bank_index);
            return false;
        }
    }
    /* Pha 2 chỉ chạy sau khi toàn batch đã hợp lệ. */
    const std::size_t draft = 1u - bank.live.load(std::memory_order_acquire);
    for (std::size_t index = 0; index < count; ++index) {
        if (writes[index] == 0) continue;
        Slot& slot = bank.buffers[draft]
            [static_cast<std::size_t>(refs[index].runtime_index)];
        slot.value = values[index];
        slot.published_at_ns = now_ns;
        slot.ever_published = true;
    }
    release_bank(bank_index);
    return true;
}

void StSignalBus::commit_at_boundary()
{
    const uint8_t bank_index = acquire_active_bank();
    Bank& bank = banks_[bank_index];
    const std::size_t live = bank.live.load(std::memory_order_acquire);
    const std::size_t draft = 1u - live;
    /* Chép các ô KHÔNG được publish trong chu kỳ này sang bản nháp trước khi
     * đổi bản. Không chép thì một signal chỉ publish mỗi 30 s sẽ "biến mất" ở
     * chu kỳ kế tiếp, và `HOLD_LAST` sẽ giữ một ô rỗng thay vì giá trị cuối. */
    for (std::size_t index = 0; index < bank.count; ++index) {
        Slot& draft_slot = bank.buffers[draft][index];
        const Slot& live_slot = bank.buffers[live][index];
        if (draft_slot.published_at_ns < live_slot.published_at_ns || !draft_slot.ever_published)
            draft_slot = live_slot;
    }
    /* THỨ TỰ Ở ĐÂY LÀ MỘT BẤT BIẾN, KHÔNG PHẢI SỞ THÍCH: đổi bản TRƯỚC, tăng
     * mốc SAU.
     *
     * Seqlock của `snapshot_slot` đọc theo thứ tự `generation` → `live` → dữ
     * liệu → `generation`, và nó tin rằng "mốc không đổi ⇒ chưa đổi bản". Mệnh
     * đề đó chỉ đúng nếu mốc tăng SAU cú đổi bản. Với thứ tự cũ (tăng mốc rồi
     * mới đổi bản) có một cửa sổ thật:
     *
     *   1. reader đọc `before = G+1` — sau khi mốc đã tăng, TRƯỚC khi đổi bản;
     *   2. reader đọc `live = L` — vẫn là bản cũ;
     *   3. writer đổi bản: `live = D`;
     *   4. `publish()` của chu kỳ kế tính `draft = 1 - live = L` và ghi đè
     *      ĐÚNG bản mà reader đang chép;
     *   5. reader đọc `after = G+1` — bằng `before`, nên nó CHẤP NHẬN một ô
     *      đã bị xé: `value` của chu kỳ này ghép `published_at_ns` của chu kỳ
     *      kia.
     *
     * Đó chính là thứ `ConcurrentInspectNeverPairsValueWithForeignTimestamp`
     * bắt được — đo thật: 1 lần đỏ trong 40 lần chạy `ctest`, và 1/51 khi chạy
     * thẳng binary. Một số đo "tươi" mang mốc thời gian không thuộc về nó là
     * loại sai nguy hiểm nhất ở Runtime Monitor: nó trông hoàn toàn hợp lệ.
     *
     * Đổi bản trước rồi mới tăng mốc thì hai nhánh đều kín:
     *   - reader thấy `before = G` (trước khi tăng) ⇒ nó đọc `live` trước cú
     *     đổi bản, và bản nó chép chưa thể thành draft của chu kỳ kế; `after`
     *     sẽ là `G+1` nên nó thử lại;
     *   - reader thấy `before = G+1` ⇒ nhờ `live.store(release)` xảy ra trước
     *     RMW trên `generation`, lần `live.load(acquire)` ngay sau đó BUỘC phải
     *     thấy bản mới, tức bản không ai ghi vào cho tới commit kế.
     *
     * Đổi bản vẫn là MỘT lần ghi atomic: consumer hoặc thấy trọn bản cũ hoặc
     * trọn bản mới. */
    bank.live.store(draft, std::memory_order_release);
    bank.generation.fetch_add(1, std::memory_order_acq_rel);
    release_bank(bank_index);
}

bool StSignalBus::snapshot_slot(const Bank& bank, std::size_t index, Slot* out,
                                uint64_t* generation) const noexcept
{
    /* Cùng khuôn seqlock đã dùng cho SHM ở `IobusReader::read_from`: đọc mốc
     * bằng acquire, chép, đọc lại mốc; khác nhau thì chép lại. Giữ nguyên khuôn
     * đó thay vì phát minh một biến thể thứ hai — hai cách làm cùng một việc
     * trong một hệ là thứ khiến người review sau phải đoán cái nào đúng.
     *
     * Số lần thử có trần: một writer commit liên tục không được biến một lần
     * đọc STATUS thành vòng lặp không giới hạn trên IPC worker thread. Với base
     * step 1 s của Rev A, chạm tới lần thử thứ hai đã là hiếm.
     *
     * KHÔNG dùng `std::atomic_thread_fence`: GCC từ chối biên dịch nó dưới
     * `-fsanitize=thread` (`-Werror=tsan`), tức là thêm nó vào đây sẽ làm mất
     * luôn khả năng chạy TSan trên chính module này — đắt hơn nhiều so với thứ
     * nó mua được. */
    constexpr int kMaxAttempts = 5;
    for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
        const uint64_t before = bank.generation.load(std::memory_order_acquire);
        const std::size_t live = bank.live.load(std::memory_order_acquire);
        *out = bank.buffers[live][index];
        const uint64_t after = bank.generation.load(std::memory_order_acquire);
        if (before == after) {
            *generation = after;
            return true;
        }
    }
    return false;
}

StSignalRead StSignalBus::read_impl(uint8_t bank_index, int index, uint64_t now_ns,
                                    bool count_unavailable) const
{
    StSignalRead result;
    const Bank& bank = banks_[bank_index];
    if (index < 0 || static_cast<std::size_t>(index) >= bank.count) {
        result.state = StSignalReadState::NOT_DECLARED;
        return result;
    }
    const StSignalDefinition& definition = bank.definitions[static_cast<std::size_t>(index)];
    Slot slot{};
    const bool consistent =
        snapshot_slot(bank, static_cast<std::size_t>(index), &slot, &result.generation);
    result.published_at_ns = slot.published_at_ns;

    auto unavailable = [&]() {
        if (count_unavailable)
            bank.unavailable_reads.fetch_add(1, std::memory_order_relaxed);
        result.state = StSignalReadState::UNAVAILABLE;
        if (definition.has_fallback) {
            result.value = definition.fallback;
            result.has_value = true;
        }
        return result;
    };

    if (!consistent) {
        /* Không chụp được một ảnh nhất quán trong số lần thử cho phép. Trả
         * UNAVAILABLE thay vì một cặp value/timestamp có thể lệch chu kỳ:
         * "chưa đọc được" là câu trả lời thật, "một số đo sai mốc" thì không. */
        return unavailable();
    }

    if (!slot.ever_published) {
        /* Chưa ai publish được xử như stale theo đúng policy. HOLD_LAST không
         * cần một value giả: executor thấy STALE_HELD và giữ nguyên biến local
         * của consumer. WAIT mới chặn chu kỳ. */
        if (definition.stale_policy == StStalePolicy::HOLD_LAST) {
            result.state = StSignalReadState::STALE_HELD;
            return result;
        }
        if (definition.stale_policy == StStalePolicy::USE_FALLBACK) {
            result.value = definition.fallback;
            result.has_value = true;
            result.state = StSignalReadState::STALE_FALLBACK;
            return result;
        }
        return unavailable();
    }

    const uint64_t age_ns = now_ns >= slot.published_at_ns ? now_ns - slot.published_at_ns : 0;
    if (age_ns <= freshness_ns(definition.freshness_ms)) {
        result.value = slot.value;
        result.has_value = true;
        result.state = StSignalReadState::FRESH;
        return result;
    }

    switch (definition.stale_policy) {
    case StStalePolicy::HOLD_LAST:
        result.value = slot.value;
        result.has_value = true;
        result.state = StSignalReadState::STALE_HELD;
        return result;
    case StStalePolicy::USE_FALLBACK:
        result.value = definition.fallback;
        result.has_value = true;
        result.state = StSignalReadState::STALE_FALLBACK;
        return result;
    case StStalePolicy::WAIT:
        return unavailable();
    }
    return unavailable();
}

StSignalRead StSignalBus::read(int index, uint64_t now_ns) const
{
    const uint8_t bank = acquire_active_bank();
    const StSignalRead result = read_impl(bank, index, now_ns, true);
    release_bank(bank);
    return result;
}

StSignalRead StSignalBus::inspect(int index, uint64_t now_ns) const
{
    const uint8_t bank = acquire_active_bank();
    const StSignalRead result = read_impl(bank, index, now_ns, false);
    release_bank(bank);
    return result;
}

std::vector<StSignalDiagnosticSnapshot> StSignalBus::inspect_all(uint64_t now_ns) const
{
    const uint8_t bank = acquire_active_bank();
    std::vector<StSignalDiagnosticSnapshot> result;
    try {
        result.reserve(banks_[bank].count);
        for (std::size_t index = 0; index < banks_[bank].count; ++index) {
            result.push_back({banks_[bank].definitions[index],
                              read_impl(bank, static_cast<int>(index), now_ns, false)});
        }
    } catch (...) {
        release_bank(bank);
        throw;
    }
    release_bank(bank);
    return result;
}

StSignalRead StSignalBus::read(const std::string& name, uint64_t now_ns) const
{
    const uint8_t bank = acquire_active_bank();
    const StSignalRead result = read_impl(bank, index_of(banks_[bank], name), now_ns, true);
    release_bank(bank);
    return result;
}

StSignalDefinition StSignalBus::definition(int index) const
{
    const uint8_t bank = acquire_active_bank();
    StSignalDefinition result;
    if (index >= 0 && static_cast<std::size_t>(index) < banks_[bank].count)
        result = banks_[bank].definitions[static_cast<std::size_t>(index)];
    release_bank(bank);
    return result;
}

uint32_t StSignalBus::unavailable_read_count() const
{
    const uint8_t bank = acquire_active_bank();
    const uint32_t result = banks_[bank].unavailable_reads.load(std::memory_order_relaxed);
    release_bank(bank);
    return result;
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
