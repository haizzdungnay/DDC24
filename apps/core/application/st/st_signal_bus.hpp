/**
 * @file  st_signal_bus.hpp
 * @brief T59-404 — Published Signal ở runtime: double-buffer, freshness và ba
 *        chính sách stale (DDD-SW-PROG-UNIFIED-001 §4.5/§10, kiến trúc §5).
 *
 *        Vì sao double-buffer chứ không phải một ô nhớ có khoá: publisher ghi
 *        trong lúc consumer đọc là chuyện bình thường khi hai Program ở hai lane
 *        khác nhau. Một ô nhớ chung sẽ cho consumer đọc được NỬA giá trị mới và
 *        nửa giá trị cũ — với REAL 8 byte trên bus 32 bit, đó là một số chưa
 *        từng được Program nào ghi. Khoá thì đưa đường quét vào chờ, thứ mà
 *        `T59-403` vừa loại bỏ.
 *
 *        Vì sao commit ở BOUNDARY chứ không ngay khi publish: trong cùng một chu
 *        kỳ, hai consumer chạy ở hai thời điểm khác nhau phải thấy CÙNG một ảnh
 *        signal. Cho consumer thấy giá trị ngay khi publisher ghi sẽ làm kết quả
 *        phụ thuộc vào việc lane nào chạy trước — đúng thứ mà "single/multicore
 *        cùng ngữ nghĩa" cấm.
 */
#ifndef CORE_ST_SIGNAL_BUS_HPP
#define CORE_ST_SIGNAL_BUS_HPP

#include <array>
#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#include "st/st_loader.hpp"
#include "st/st_program.hpp"

namespace core {

/* Trần signal của profile sản phẩm. Cấp phát tĩnh theo trần này: cấp phát trong
 * chu kỳ quét là thứ làm WCET không còn giới hạn trên. */
constexpr std::size_t kMaxRuntimeSignals = 512;

/* Ba chính sách khi giá trị quá hạn freshness. Enum ĐÓNG: một chính sách thứ tư
 * đi qua được biên nghĩa là runtime phải đoán, và đoán ở đây là chọn thay người
 * thiết kế xem thiết bị làm gì khi mất dữ liệu. */
enum class StStalePolicy : uint8_t {
    /* Giữ giá trị cuối cùng, đánh dấu stale. Consumer vẫn chạy. */
    HOLD_LAST = 0,
    /* Dùng giá trị dự phòng KHAI BÁO. Không phải 0 ngầm — DDD §10 cấm đúng lối
     * "im lặng thay bằng 0". */
    USE_FALLBACK,
    /* Không có giá trị dùng được: consumer phải chờ, không được chạy bằng dữ
     * liệu cũ. */
    WAIT,
};

const char* st_stale_policy_name(StStalePolicy policy);
/* Phân giải tên chính sách. Trả false cho MỌI chuỗi ngoài ba tên trên — im lặng
 * quay về mặc định sẽ biến một cấu hình sai thành một hành vi không ai chọn. */
bool st_stale_policy_from_name(const char* name, StStalePolicy* out);

/* Trạng thái một lần đọc signal. `WAIT` là câu trả lời hợp lệ, không phải lỗi:
 * nó nói "chưa có dữ liệu dùng được", khác hẳn với "không có signal này". */
enum class StSignalReadState : uint8_t {
    /* Còn trong hạn freshness. */
    FRESH = 0,
    /* Quá hạn, đang dùng giá trị cuối (HOLD_LAST). */
    STALE_HELD,
    /* Quá hạn, đang dùng giá trị dự phòng (USE_FALLBACK). */
    STALE_FALLBACK,
    /* Quá hạn với chính sách WAIT, hoặc chưa từng có ai publish. */
    UNAVAILABLE,
    /* Không có signal mang tên này trong package. */
    NOT_DECLARED,
};

struct StSignalRead {
    StCell            value{};
    StSignalReadState state = StSignalReadState::NOT_DECLARED;
    uint64_t          published_at_ns = 0;
    /* Số thứ tự bản commit đang đọc. Hai lần đọc cùng generation phải cho cùng
     * giá trị — đây là thứ test dùng để chứng minh không có đọc rách. */
    uint64_t          generation = 0;
};

struct StSignalDefinition {
    std::string   name;
    std::string   publisher_program;
    StType        type = StType::REAL;
    uint32_t      freshness_ms = 1000;
    StStalePolicy stale_policy = StStalePolicy::HOLD_LAST;
    StCell        fallback{};
    bool          has_fallback = false;
};

/* Bus signal của một package. Không thread-safe cho việc THÊM signal (chỉ xảy ra
 * lúc nạp package, ngoài chu kỳ quét); publish và read thì an toàn cho một
 * publisher + nhiều consumer đồng thời.
 */
class StSignalBus {
public:
    /* Khai báo signal. Trả false + `*error` nếu trùng tên, vượt trần, hoặc
     * `USE_FALLBACK` mà không có giá trị dự phòng. */
    bool declare(const StSignalDefinition& definition, std::string* error);
    void clear();

    /* Chuẩn bị một contract thay thế ở bank không-live. Mọi copy/validate chuỗi
     * diễn ra ở luồng non-RT; safe boundary chỉ đổi chỉ số bank bằng atomic.
     * Bank live cũ được giữ lại cho tới commit/rollback nên IPC reader đã chụp
     * contract cũ không bao giờ đọc vùng đang bị ghi lại. */
    bool prepare_replacement(const std::vector<StSignalDefinition>& definitions,
                             std::string* error);
    void discard_prepared_replacement() noexcept;
    bool activate_prepared_replacement_at_boundary() noexcept;
    bool rollback_replacement_at_boundary() noexcept;
    void commit_replacement() noexcept;

    std::size_t size() const;
    /* Chỉ số nội bộ để consumer tra một lần lúc nạp thay vì so chuỗi mỗi chu kỳ.
     * Trả -1 nếu không có. */
    int index_of(const std::string& name) const;

    /* Publisher ghi vào bản NHÁP. Giá trị chưa ai đọc được cho tới
     * `commit_at_boundary()`. Trả false nếu chỉ số sai hoặc kiểu không khớp
     * khai báo — ghi sai kiểu vào một ô đã khai kiểu là hỏng dữ liệu, không
     * phải một phép chuyển đổi ngầm. */
    bool publish(int index, const StCell& value, uint64_t now_ns, const char* publisher);

    /* Đổi bản nháp thành bản đọc được. Gọi ĐÚNG MỘT LẦN mỗi chu kỳ, tại boundary,
     * trên luồng quét. */
    void commit_at_boundary();

    /* Đọc theo chính sách stale đã khai. `now_ns` là mốc logic của chu kỳ, dùng
     * chung cho mọi consumer trong chu kỳ đó. */
    StSignalRead read(int index, uint64_t now_ns) const;
    StSignalRead read(const std::string& name, uint64_t now_ns) const;

    /* Ảnh chẩn đoán chỉ-đọc cho IPC/monitor. Khác `read()`, phép này KHÔNG
     * tăng `unavailable_read_count`: một màn hình poll trạng thái không phải là
     * consumer runtime và không được làm méo số đo lỗi của consumer thật. */
    StSignalRead inspect(int index, uint64_t now_ns) const;

    /* Producer bị disable/fault: giá trị dừng lại ở lần publish cuối và sẽ quá
     * hạn theo đúng freshness của nó. KHÔNG xoá giá trị — xoá nghĩa là biến một
     * sự cố có thời hạn thành một sự cố tức thì, và `HOLD_LAST` mất nghĩa. */
    void note_publisher_stopped(const std::string& publisher_program);
    /* Số lần một consumer nhận `UNAVAILABLE`. Số đo cho `T59-408`. */
    uint32_t unavailable_read_count() const;

    /* Trả bằng giá trị để reference không thoát khỏi lease bank. STATUS là
     * đường non-RT; copy hai string ở đây không đi vào scan hot path. */
    StSignalDefinition definition(int index) const;

private:
    static constexpr std::size_t kContractBanks = 3;

    struct Slot {
        StCell   value{};
        uint64_t published_at_ns = 0;
        bool     ever_published = false;
    };

    struct Bank {
        std::array<StSignalDefinition, kMaxRuntimeSignals> definitions{};
        std::array<std::array<Slot, kMaxRuntimeSignals>, 2> buffers{};
        std::size_t count = 0;
        std::atomic<std::size_t> live{0};
        std::atomic<uint64_t> generation{0};
        mutable std::atomic<uint32_t> unavailable_reads{0};
    };

    uint8_t acquire_active_bank() const noexcept;
    void release_bank(uint8_t bank) const noexcept;
    static int index_of(const Bank& bank, const std::string& name);
    static bool declare(Bank* bank, const StSignalDefinition& definition, std::string* error);
    StSignalRead read_impl(uint8_t bank, int index, uint64_t now_ns,
                           bool count_unavailable) const;

    /* Hai bản: `[0]` và `[1]`. `live_` chỉ bản đang đọc được; publisher luôn ghi
     * vào `1 - live_`. Đổi bản là MỘT lần ghi atomic, nên consumer hoặc thấy
     * trọn bản cũ hoặc trọn bản mới — không bao giờ thấy nửa nọ nửa kia. */
    std::array<Bank, kContractBanks> banks_{};
    mutable std::array<std::atomic<uint32_t>, kContractBanks> bank_readers_{};
    std::atomic<uint8_t> active_bank_{0};
    /* Chỉ coordinator IPC ghi và scan boundary đọc sau publish state release;
     * -1 nghĩa là không có bank được reserve. */
    int8_t prepared_bank_ = -1;
    int8_t previous_bank_ = -1;
};

} // namespace core

#endif /* CORE_ST_SIGNAL_BUS_HPP */
