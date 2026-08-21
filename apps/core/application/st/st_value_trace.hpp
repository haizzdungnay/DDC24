/**
 * @file  st_value_trace.hpp
 * @brief T59-408 — trace lấy mẫu GIÁ TRỊ trong Core (OD-PROG-011).
 *
 *        Khác `StBoundedRuntimeTrace` (event trace: fault/overrun/rollback,
 *        128 sự kiện). Cái này là historian giá trị: 10.000 mẫu / 10 phút, lấy
 *        tại RANH GIỚI QUÉT.
 *
 *        Vì sao lấy mẫu trong Core chứ không để BE poll: BE poll ở nhịp riêng
 *        của nó, nên "mẫu tại t" thực chất là "thứ gì đó Core đã công bố quanh
 *        khoảng t" — hai biến trong cùng một mẫu có thể đến từ hai chu kỳ khác
 *        nhau. Với một đồ thị chẩn đoán, đó là dữ liệu nói dối theo cách khó
 *        thấy nhất: đường cong trông hợp lý nhưng quan hệ nhân quả giữa hai
 *        biến bị xáo. Lấy tại boundary thì mọi biến trong một mẫu đến từ ĐÚNG
 *        một chu kỳ.
 *
 *        Toàn bộ dung lượng cấp phát TĨNH: lấy mẫu nằm trong đường quét, và cấp
 *        phát ở đó là thứ làm WCET không còn giới hạn trên.
 */
#ifndef CORE_ST_VALUE_TRACE_HPP
#define CORE_ST_VALUE_TRACE_HPP

#include <array>
#include <cstdint>
#include <string>

#include "st/st_loader.hpp"

namespace core {

/* Trần của OD-PROG-011. `kMaxTraceCells` là tổng số Ô (biến × mẫu), không phải
 * số mẫu: 10.000 mẫu của 1 biến và 312 mẫu của 32 biến đều tiêu cùng một ngân
 * sách bộ nhớ, và ngân sách mới là thứ có giới hạn vật lý. */
constexpr std::size_t kMaxTraceCells = 10000;
constexpr std::size_t kMaxTraceVariables = 32;
constexpr uint32_t kMaxTraceDurationMs = 600000;  /* 10 phút */
constexpr uint32_t kMinTraceSamplePeriodMs = 100;
constexpr uint32_t kMaxTraceSamplePeriodMs = 30000;

/* Một biến được theo dõi.
 *
 * Khai bằng TÊN, không bằng số slot: số slot là kết quả của một lần biên dịch
 * cụ thể, và nó không tồn tại ở bất kỳ nơi nào BE nhìn thấy — Revision chỉ có
 * tên biến. Bắt BE gửi slot nghĩa là phải xuất bảng slot ra khỏi artifact chỉ để
 * phục vụ chẩn đoán, rồi giữ hai bản đồ tên→slot ở hai bên. Core đã có bảng đó
 * trong chương trình đang nạp; phân giải ở đây là phân giải ở nơi dữ liệu sống.
 *
 * `slot` là ô nhớ CACHE, phân giải một lần lúc `start()` để vòng lấy mẫu không
 * phải so chuỗi mỗi chu kỳ. */
struct StTraceVariable {
    std::string instance_id;
    std::string variable_name;
    uint16_t    slot = 0;
    bool        resolved = false;
};

/* Một mẫu ĐỌC RA: giá trị của MỌI biến tại cùng một mốc chu kỳ.
 *
 * Đây là kiểu TRẢ VỀ, không phải kiểu lưu trữ. Lưu 10.000 struct này sẽ tốn
 * ~3 MB tĩnh cho một tính năng chẩn đoán — không hợp lý trên một bộ điều khiển.
 * Kho thật lưu theo Ô (`cells_`), còn struct này chỉ dựng lúc đọc, ngoài đường
 * quét. */
struct StTraceSample {
    uint64_t timestamp_ns = 0;
    /* Song song 1-1 với danh sách biến của session. */
    std::array<StCell, kMaxTraceVariables> values{};
    /* Biến có Program chưa nạp / slot ngoài dải: đánh dấu thay vì bịa số 0.
     * "Không đo được" và "đo được giá trị 0" là hai sự thật khác nhau. */
    std::array<bool, kMaxTraceVariables> valid{};
};

enum class StTraceState : uint8_t {
    IDLE = 0,
    RUNNING,
    COMPLETED,
    STOPPED,
};

const char* st_trace_state_name(StTraceState state);

struct StTraceStatus {
    StTraceState state = StTraceState::IDLE;
    std::string  session_id;
    uint32_t     variable_count = 0;
    uint32_t     sample_count = 0;
    uint32_t     dropped_count = 0;
    uint64_t     started_at_ns = 0;
};

class StScheduler;

/* Một session tại một thời điểm. Nhiều session đồng thời sẽ nhân ngân sách bộ
 * nhớ tĩnh lên theo số session — với 10.000 ô mỗi session thì đó là quyết định
 * về RAM của thiết bị, không phải chi tiết cài đặt. Rev A giữ MỘT session; BE
 * đã có quota riêng cho nhiều phiên logic. */
class StValueTrace {
public:
    /* Bắt đầu phiên. Trả false + `*error` khi tham số ngoài dải, khi đã có phiên
     * đang chạy, hoặc khi số biến vượt trần. Phân giải tên→slot một lần tại đây
     * bằng `scheduler`; biến không phân giải được vẫn được nhận nhưng mọi mẫu
     * của nó mang `valid=false` — từ chối cả phiên vì một biến gõ sai sẽ làm mất
     * luôn dữ liệu của những biến còn lại. KHÔNG cấp phát trong vòng lấy mẫu. */
    bool start(const std::string& session_id, const StScheduler& scheduler,
               const StTraceVariable* variables, std::size_t variable_count,
               uint32_t sample_period_ms, uint32_t duration_ms, uint64_t now_ns,
               std::string* error);

    /* Dừng phiên theo yêu cầu. Trả false nếu `session_id` không khớp phiên đang
     * chạy — dừng nhầm phiên của người khác là mất dữ liệu chẩn đoán của họ. */
    bool stop(const std::string& session_id, std::string* error);

    /* Gọi tại RANH GIỚI QUÉT. Lấy mẫu nếu tới hạn; tự chuyển COMPLETED khi hết
     * thời lượng hoặc hết chỗ. Không cấp phát, không khoá. */
    void on_boundary(const StScheduler& scheduler, uint64_t now_ns);

    StTraceStatus status() const;
    std::size_t sample_count() const { return sample_count_; }
    /* Mẫu theo thứ tự thời gian, 0 = cũ nhất còn giữ. Dựng struct lúc đọc chứ
     * không lưu sẵn — xem ghi chú ở `StTraceSample`. */
    StTraceSample sample(std::size_t index) const;
    const StTraceVariable& variable(std::size_t index) const { return variables_[index]; }
    std::size_t variable_count() const { return variable_count_; }
    /* Số mẫu đã rơi vì hết chỗ — bounded nghĩa là có thể rơi, và giấu con số đó
     * sẽ làm người đọc đồ thị tưởng mình thấy toàn bộ. */
    uint32_t dropped_count() const { return dropped_; }

    void reset();

private:
    std::size_t capacity() const;

    std::string session_id_;
    StTraceState state_ = StTraceState::IDLE;
    std::array<StTraceVariable, kMaxTraceVariables> variables_{};
    std::size_t variable_count_ = 0;
    /* Kho theo Ô: `cells_[sample * variable_count_ + variable]`. Ngân sách bộ
     * nhớ tĩnh vì thế KHÔNG phụ thuộc số biến — 1 biến × 10.000 mẫu và 32 biến ×
     * 312 mẫu tiêu đúng cùng một chỗ. Tổng ~170 KB (`cells_` 80 KB, `timestamps_`
     * 80 KB, `valid_` 10 KB): một con số cố định và nói ra được, thay vì một
     * mảng struct 3 MB. */
    std::array<StCell, kMaxTraceCells> cells_{};
    std::array<uint64_t, kMaxTraceCells> timestamps_{};
    std::array<uint8_t, kMaxTraceCells> valid_{};
    std::size_t head_ = 0;
    std::size_t sample_count_ = 0;
    uint32_t dropped_ = 0;
    uint32_t sample_period_ms_ = 0;
    uint64_t started_at_ns_ = 0;
    uint64_t ends_at_ns_ = 0;
    uint64_t next_sample_ns_ = 0;
};

} // namespace core

#endif /* CORE_ST_VALUE_TRACE_HPP */
