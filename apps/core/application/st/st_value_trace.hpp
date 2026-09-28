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
 *
 *        HAI LUỒNG (F05 còn mở, ADR-061 4.10 bước 2): luồng IPC Programming gọi
 *        `start`/`stop`/`status`/`sample`… còn luồng quét gọi `on_boundary`.
 *        Trước bản này không có đồng bộ nào — `start()` ghi lại danh sách biến
 *        (chuỗi) đúng lúc luồng quét có thể đang đọc chúng để lấy mẫu, và còn
 *        đọc cấu trúc Program của scheduler từ luồng IPC. Nay:
 *          - mọi trường được bảo vệ bằng một khoá quay (spin) NGẮN;
 *          - luồng quét CHỈ `try_lock`: gặp khoá đang bị giữ thì bỏ lượt lấy
 *            mẫu của boundary đó (mẫu dời sang boundary kế, mốc thời gian vẫn là
 *            thời điểm thật) và đếm `contended_boundary_count` — không bao giờ
 *            chờ;
 *          - phân giải tên → slot chạy trên LUỒNG QUÉT ở boundary đầu tiên sau
 *            `start()`, vì chỉ luồng quét được đọc cấu trúc Program đang chạy.
 */
#ifndef CORE_ST_VALUE_TRACE_HPP
#define CORE_ST_VALUE_TRACE_HPP

#include <array>
#include <atomic>
#include <cstdint>
#include <string>

#include "graph/point_table.hpp"
#include "st/st_loader.hpp"

namespace core {

/* Trần của OD-PROG-011. `kMaxTraceCells` là tổng số Ô (biến × mẫu), không phải
 * số mẫu: 10.000 mẫu của 1 biến và 312 mẫu của 32 biến đều tiêu cùng một ngân
 * sách bộ nhớ, và ngân sách mới là thứ có giới hạn vật lý. */
constexpr std::size_t kMaxTraceCells = 10000;
constexpr std::size_t kMaxTraceVariables = 32;
constexpr uint32_t kMaxTraceDurationMs = 600000;  /* 10 phút */
/* ADR-061 4.6: dải yêu cầu 10..50000 ms, khớp tập chu kỳ của profile. Chu kỳ
 * lấy mẫu HIỆU LỰC = max(yêu cầu, base step): mẫu chỉ lấy được ở ranh giới
 * quét, nên hứa nhanh hơn một base step là hứa suông. */
constexpr uint32_t kMinTraceSamplePeriodMs = 10;
constexpr uint32_t kMaxTraceSamplePeriodMs = 50000;

/* Issue #798 — vì sao một ô KHÔNG có giá trị. Hai lý do khác nhau về bản chất:
 * UNRESOLVED là "biến/Program không tồn tại", NOT_RELEASED là "Program có thật
 * nhưng không chạy ở boundary này" — slot của nó lúc đó có đầu vào đã được nạp
 * lại cho lần chạy SAU nằm cạnh đầu ra của lần chạy TRƯỚC, nên chép slot ra là
 * trình bày một cặp vào/ra chưa từng cùng tồn tại. */
enum class StTraceCellReason : uint8_t {
    OK = 0,
    UNRESOLVED = 1,
    NOT_RELEASED = 2,
};

/* Issue #798 — kênh đọc lại của một ô: NONE = biến không gắn điểm đầu ra (biến
 * nội bộ/đầu vào), VALID = có số đọc lại từ bảng điểm, UNAVAILABLE = gắn điểm
 * đầu ra nhưng điểm không GOOD hoặc giá trị không đổi được về kiểu biến. */
enum class StTraceReadback : uint8_t {
    NONE = 0,
    VALID = 1,
    UNAVAILABLE = 2,
};

/* Lấy mẫu TẠI RELEASE (Issue #798): mẫu tới hạn được hoãn tới boundary có ít
 * nhất một Program được theo dõi vừa chạy. Chu kỳ Program dài nhất của profile
 * là 50 s, nên quá mốc này mà vẫn chưa có Program nào chạy thì lấy mẫu luôn (ô
 * mang NOT_RELEASED) thay vì để phiên đứng im không một dấu vết. */
constexpr uint64_t kMaxTraceReleaseDeferNs = static_cast<uint64_t>(kMaxTraceSamplePeriodMs) * 1000000ull;

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
    /* Issue #798 — chỉ số binding ĐẦU RA trong `io_bindings` của Program gắn với
     * slot này, -1 khi biến không ghi ra điểm nào. Phân giải cùng lúc với slot. */
    int16_t     output_binding = -1;
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
    /* Issue #798. `valid[i] == (reason[i] == OK)`. */
    std::array<StTraceCellReason, kMaxTraceVariables> reason{};
    /* Số release (`run_count`) của Program nguồn tại mẫu; 0 khi UNRESOLVED. Hai
     * mẫu liền nhau của cùng một biến mà số này cách nhau > 1 nghĩa là đã có lần
     * chạy không được lấy mẫu — khoảng trống nhìn thấy được, không lặng lẽ. */
    std::array<uint64_t, kMaxTraceVariables> release_seq{};
    std::array<StTraceReadback, kMaxTraceVariables> readback_state{};
    std::array<StCell, kMaxTraceVariables> readback{};
    std::array<uint32_t, kMaxTraceVariables> readback_age_ms{};
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
    /* Chu kỳ người gọi YÊU CẦU và chu kỳ Core THỰC SỰ lấy mẫu (ADR-061 4.6). */
    uint32_t     requested_sample_period_ms = 0;
    uint32_t     effective_sample_period_ms = 0;
    /* Số boundary luồng quét bỏ lượt vì luồng IPC đang giữ khoá (kể từ `start`). */
    uint32_t     contended_boundary_count = 0;
};

/* max(yêu cầu, base step làm tròn LÊN tới ms). Base step 0 (chưa biết) = không
 * kẹp. Hàm thuần để IPC và test dùng đúng một công thức. */
uint32_t st_trace_effective_sample_period_ms(uint32_t requested_ms, uint64_t base_step_ns);

class StScheduler;

/* Một session tại một thời điểm. Nhiều session đồng thời sẽ nhân ngân sách bộ
 * nhớ tĩnh lên theo số session — với 10.000 ô mỗi session thì đó là quyết định
 * về RAM của thiết bị, không phải chi tiết cài đặt. Rev A giữ MỘT session; BE
 * đã có quota riêng cho nhiều phiên logic. */
class StValueTrace {
public:
    /* Bắt đầu phiên. Trả false + `*error` khi tham số ngoài dải, khi đã có phiên
     * đang chạy, hoặc khi số biến vượt trần. Tên→slot được phân giải MỘT lần ở
     * boundary đầu tiên sau lời gọi này, trên luồng quét (xem đầu file); biến
     * không phân giải được vẫn được nhận nhưng mọi mẫu của nó mang
     * `valid=false` — từ chối cả phiên vì một biến gõ sai sẽ làm mất luôn dữ
     * liệu của những biến còn lại. `scheduler` ở đây chỉ được đọc base step.
     * KHÔNG cấp phát trong vòng lấy mẫu. */
    bool start(const std::string& session_id, const StScheduler& scheduler,
               const StTraceVariable* variables, std::size_t variable_count,
               uint32_t sample_period_ms, uint32_t duration_ms, uint64_t now_ns,
               std::string* error);

    /* Dừng phiên theo yêu cầu. Trả false nếu `session_id` không khớp phiên đang
     * chạy — dừng nhầm phiên của người khác là mất dữ liệu chẩn đoán của họ. */
    bool stop(const std::string& session_id, std::string* error);

    /* Gọi tại RANH GIỚI QUÉT, SAU `on_base_step` và output commit của cùng
     * boundary. Lấy mẫu nếu tới hạn VÀ có Program được theo dõi vừa release ở
     * boundary này (Issue #798; xem `kMaxTraceReleaseDeferNs`); tự chuyển
     * COMPLETED khi hết thời lượng hoặc hết chỗ. `table` (có thể null) cho giá
     * trị đọc lại của biến gắn điểm đầu ra. Không cấp phát, KHÔNG chờ khoá: khoá
     * đang bị luồng IPC giữ thì bỏ lượt này (đếm `contended_boundary_count`). */
    void on_boundary(const StScheduler& scheduler, uint64_t now_ns,
                     const PointTable* table = nullptr);

    /* Các hàm đọc dưới đây mỗi hàm tự lấy khoá — mỗi lời gọi nhất quán với
     * chính nó. Cần nhiều lời gọi nhất quán với NHAU thì dùng `ConsistentRead`. */
    StTraceStatus status() const;
    std::size_t sample_count() const;
    /* Mẫu theo thứ tự thời gian, 0 = cũ nhất còn giữ. Dựng struct lúc đọc chứ
     * không lưu sẵn — xem ghi chú ở `StTraceSample`. */
    StTraceSample sample(std::size_t index) const;
    /* Trả BẢN SAO: luồng quét ghi `slot`/`resolved` lúc phân giải, nên một tham
     * chiếu vào mảng nội bộ sẽ bị đọc trong lúc đang ghi. */
    StTraceVariable variable(std::size_t index) const;
    std::size_t variable_count() const;
    /* Số mẫu đã rơi vì hết chỗ — bounded nghĩa là có thể rơi, và giấu con số đó
     * sẽ làm người đọc đồ thị tưởng mình thấy toàn bộ. */
    uint32_t dropped_count() const;
    /* F18 (EV-PROG-FBD-ST-MB-20260925) — số thứ tự TUYỆT ĐỐI của mẫu, đánh từ 1
     * theo lần ghi trong phiên, KHÔNG phụ thuộc vị trí trong ring. Người đọc
     * (TRACE_READ) đọc tăng dần theo số này thay vì nhận lại TRỌN ring mỗi lần:
     * ring 10 ms đầy vượt trần phần tử của bộ giải mã phía web sau 256 mẫu
     * (2,56 s) và vượt trần payload IPC 32 KiB sau ~1 000 mẫu.
     *  - `first_sequence()` — số của mẫu cũ nhất còn giữ (`sample(0)`);
     *  - `next_sequence()`  — số mà mẫu kế tiếp sẽ mang.
     * Ring đã ghi đè thì `first_sequence() > 1`: phần hụt so với chỗ người đọc
     * dừng lần trước chính là số mẫu người đọc đã mất.
     * X19: luồng quét đổi hai số này ở mỗi mẫu, nên đọc chúng CÙNG với
     * `sample(i)` phải qua `ConsistentRead` — đọc rời từng hàm thì giữa hai lời
     * gọi ring có thể đã dịch một mẫu và số thứ tự gán cho mẫu bị lệch. */
    uint64_t next_sequence() const;
    uint64_t first_sequence() const;

    void reset();

    /* Giữ khoá suốt đời object để đọc nhiều trường nhất quán với nhau (ví dụ cả
     * vòng TRACE_READ). Luồng quét gặp khoá này thì bỏ lượt lấy mẫu, nên giữ
     * càng ngắn càng tốt và KHÔNG làm I/O trong lúc giữ. Không gọi các hàm đọc
     * công khai của trace trong lúc giữ (khoá không đệ quy). */
    class ConsistentRead {
    public:
        explicit ConsistentRead(const StValueTrace& trace);
        ~ConsistentRead();
        ConsistentRead(const ConsistentRead&) = delete;
        ConsistentRead& operator=(const ConsistentRead&) = delete;

        StTraceStatus status() const;
        std::size_t sample_count() const;
        StTraceSample sample(std::size_t index) const;
        std::size_t variable_count() const;
        uint64_t next_sequence() const;
        uint64_t first_sequence() const;

    private:
        const StValueTrace& trace_;
    };

private:
    /* Khoá quay tối giản: luồng quét chỉ `try_lock`, luồng IPC `lock` (quay +
     * nhường CPU). Không dùng std::mutex vì luồng quét tuyệt đối không được
     * ngủ chờ một luồng SCHED_OTHER. */
    class SpinGuard {
    public:
        bool try_lock() const noexcept
        {
            return !locked_.exchange(true, std::memory_order_acquire);
        }
        void lock() const noexcept;
        void unlock() const noexcept { locked_.store(false, std::memory_order_release); }

    private:
        mutable std::atomic<bool> locked_{false};
    };

    std::size_t capacity() const;
    void reset_locked();
    void resolve_locked(const StScheduler& scheduler);
    void sample_locked(const StScheduler& scheduler, uint64_t now_ns, const PointTable* table);
    StTraceStatus status_locked() const;
    StTraceSample sample_locked_at(std::size_t index) const;

    SpinGuard guard_;
    /* Tên→slot chưa phân giải: `start()` (luồng IPC) đặt, boundary kế (luồng
     * quét) phân giải rồi xoá. */
    bool resolve_pending_ = false;
    /* Luồng quét bỏ lượt khi KHÔNG giữ khoá, nên bộ đếm phải là atomic. */
    std::atomic<uint32_t> contended_boundaries_{0};

    std::string session_id_;
    StTraceState state_ = StTraceState::IDLE;
    std::array<StTraceVariable, kMaxTraceVariables> variables_{};
    std::size_t variable_count_ = 0;
    /* Kho theo Ô: `cells_[sample * variable_count_ + variable]`. Ngân sách bộ
     * nhớ tĩnh vì thế KHÔNG phụ thuộc số biến — 1 biến × 10.000 mẫu và 32 biến ×
     * 312 mẫu tiêu đúng cùng một chỗ. Trước #798 tổng ~170 KB (`cells_` 80 KB, `timestamps_`
     * 80 KB, `valid_` 10 KB): một con số cố định và nói ra được, thay vì một
     * mảng struct 3 MB. */
    std::array<StCell, kMaxTraceCells> cells_{};
    std::array<uint64_t, kMaxTraceCells> timestamps_{};
    /* Issue #798: bit 0..1 = `StTraceCellReason`, bit 2..3 = `StTraceReadback`. */
    std::array<uint8_t, kMaxTraceCells> valid_{};
    /* Issue #798 — +160 KB tĩnh (Q3 của `SW-TRACE-RELEASE-COHERENT`): số release
     * 32 bit (quấn sau ~497 ngày ở 10 ms; người đọc chỉ cần hiệu giữa hai mẫu
     * liền nhau), số đọc lại và tuổi của nó. */
    std::array<uint32_t, kMaxTraceCells> release_seq_{};
    std::array<StCell, kMaxTraceCells> readback_{};
    std::array<uint32_t, kMaxTraceCells> readback_age_ms_{};
    std::size_t head_ = 0;
    std::size_t sample_count_ = 0;
    uint32_t dropped_ = 0;
    uint64_t total_written_ = 0;
    uint32_t sample_period_ms_ = 0;
    uint32_t requested_sample_period_ms_ = 0;
    uint64_t started_at_ns_ = 0;
    uint64_t ends_at_ns_ = 0;
    uint64_t next_sample_ns_ = 0;
};

} // namespace core

#endif /* CORE_ST_VALUE_TRACE_HPP */
