/**
 * @file  st_scheduler.hpp
 * @brief Task scheduler cho Program Runtime, theo
 *        docs/02_design/software/PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md.
 *
 *        Mô hình: FIXED-PRIORITY, NON-PREEMPTIVE tại task boundary.
 *
 *        Không preempt làm cho "process image không đổi trong một lần thực thi
 *        Program" thành bất biến CẤU TRÚC chứ không phải quy ước cần kỷ luật,
 *        và loại bỏ hoàn toàn khoá khỏi đường điều khiển — nên không có
 *        priority inversion và không có biến động thời gian do khoá.
 *
 *        Đồng hồ do CALLER truyền vào và chụp MỘT LẦN cho cả tick. Nếu mỗi
 *        Task/FB tự đọc đồng hồ thì kết quả phụ thuộc thứ tự thực thi và thời
 *        gian chạy của các Program trước nó — hành vi không tất định, không
 *        tái lập được khi điều tra sự cố.
 */
#ifndef CORE_ST_SCHEDULER_HPP
#define CORE_ST_SCHEDULER_HPP

#include <array>
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "graph/point_table.hpp"
#include "safety/overrun_monitor.hpp"
#include "st/st_limits.hpp"
#include "st/st_retain.hpp"
#include "st/st_runtime.hpp"
#include "st/st_signal_bus.hpp"
#include "st/st_trace.hpp"

namespace core {

/* Đồng hồ monotonic thật, dùng mặc định để đo WCET/overrun (§5 SPEC). Tách
 * riêng khỏi header để test thay bằng giả không cần sleep thật. */
uint64_t default_monotonic_wall_clock_ns();

/* Trạng thái vòng đời của một Program Instance (SPEC §7.1). */
enum class StProgramState : uint8_t {
    EMPTY = 0,
    STAGED,
    VALIDATED,
    READY,
    ACTIVE,
    RUNNING,
    STOPPED,
    DISABLED,
    FAULTED,
    ROLLED_BACK,
    REJECTED,
    /* Published Signal BLOCK_PROGRAM/WAIT: trạng thái phục hồi được, vẫn
     * được release lại ở chu kỳ kế nhưng không được publish candidate. Đặt ở
     * cuối để không đổi wire/checkpoint value của các trạng thái đã có. */
    WAITING,
};

const char* st_program_state_name(StProgramState s);

/* Ý ĐỊNH Enable/Disable đang chờ RT tiêu thụ. Không mang trạng thái, chỉ mang
 * điều người vận hành yêu cầu — trạng thái thật vẫn chỉ do RT ghi. */
enum class StEnableRequest : uint8_t {
    NONE = 0,
    ENABLE,
    DISABLE,
};

/* Kết quả RT trả lại cho lượt Enable/Disable vừa tiêu thụ ở safe boundary. */
enum class StEnableAckResult : uint8_t {
    NONE = 0,
    APPLIED,
    /* Trạng thái nguồn không cho phép bật (FAULTED chưa reset, EMPTY...). */
    REJECTED_STATE,
    /* Vượt trần Program chạy đồng thời của profile (Rev A: 16). */
    REJECTED_LIMIT,
};

/* Giới hạn theo SPEC §2. */
namespace st_sched_limits {
/* Backstop vật lý của container supporting As-Built. Profile sản phẩm Rev A
 * siết xuống bằng st_profile_generated; không dùng các trần này để quảng bá
 * capability sản phẩm. */
constexpr std::size_t kMaxTasks = 8;
constexpr std::size_t kMaxProgramsPerTask = 16;
constexpr std::size_t kMaxProgramsTotal = 32;
constexpr uint32_t    kBaseTickMs = 50;
constexpr uint32_t    kMinPeriodMs = 50;
constexpr uint32_t    kMaxPeriodMs = 60000;
} // namespace st_sched_limits

/* Base step thuộc nền tảng, KHÔNG thuộc Task. Các giá trị này là quyết định
 * ADR-027/028; Task period vẫn chỉ do profile machine-readable quy định. */
namespace st_base_step {
constexpr uint32_t kDefaultMs = 1000;
constexpr uint32_t kMinMs = 500;
constexpr uint32_t kMaxMs = 2000;
/* Trần budget là quyết định profile, không phải hằng riêng của base step:
 * giữ hai bản sao thì mỗi lần profile đổi lại có một phía nói số cũ. */
constexpr uint32_t kMaxTaskBudgetPercent = st_profile_generated::kMaxTaskBudgetPercent;
} // namespace st_base_step

/* Hold-last TTL — ADR-051, DDD-CTRL-PROG-001 §6/§15.
 *
 * Con số này trả lời đúng một câu: thiết bị được phép giữ lệnh cuối cùng của
 * một Program đã ngừng publish trong bao lâu trước khi nhả quyền cho mức ưu
 * tiên tiếp theo/default. Trước ADR-051 nó là `0` — nghĩa là GIỮ VÔ HẠN: một
 * van có thể đứng ở 73% mãi mãi vì chương trình chết chứ không vì ai ra lệnh.
 *
 * 60 s được chọn theo ba ràng buộc, không phải theo cảm tính:
 *  1. `>= 2x` chu kỳ Task chậm nhất của profile (30 s). Tuổi của lệnh cuối tại
 *     lúc Program chết đã có thể bằng trọn một chu kỳ, nên TTL nhỏ hơn 2x chu
 *     kỳ làm thời gian giữ thực tế dao động tới tận 0 — không hứa được gì.
 *     Ràng buộc này được `static_assert` bên dưới canh, không phải ghi chú.
 *  2. Nằm trong dải fail-safe/watchdog quen thuộc của thiết bị BAS (10..60 s),
 *     nên hành vi không gây bất ngờ cho người vận hành đã quen gear khác.
 *  3. Ngắn hơn hằng số thời gian nhiệt của tải (phút tới hàng chục phút), nên
 *     cụm thiết bị không chạy mù đủ lâu để lệch trạng thái.
 *
 * TTL KHÔNG chờ người vận hành reset: FAULTED là trạng thái chốt, hồi phục cần
 * thao tác người. Giữ vô hạn để "đợi người" chính là lỗi mà ADR-051 đóng.
 */
namespace st_hold_ttl {
/* Giá trị đã ký. Wall-clock, KHÔNG phải số base step: base step cấu hình được
 * 500..2000 ms, ghim theo base step thì cùng một quyết định lại cho ra ba thời
 * gian giữ khác nhau tuỳ site. */
constexpr uint32_t kSignedTtlMs = 60000;

/* Trần cho override tại field. Vượt trần này thì "giữ tạm" đã thành "giữ vô
 * hạn" dưới một cái tên khác. */
constexpr uint32_t kMaxConfigurableMs = 600000;

constexpr uint32_t max_allowed_period_ms()
{
    uint32_t worst = 0;
    for (const uint32_t period : st_profile_generated::kAllowedPeriodMs)
        if (period > worst) worst = period;
    return worst;
}

/* Profile mọc thêm một lớp chu kỳ chậm hơn thì tiền đề của ADR-051 gãy — bắt
 * gãy ở lúc build, không phải lúc một van đứng im ngoài hiện trường. */
static_assert(kSignedTtlMs >= 2u * max_allowed_period_ms(),
              "hold TTL phải >= 2x chu kỳ Task chậm nhất của profile (ADR-051)");
static_assert(kSignedTtlMs <= kMaxConfigurableMs, "TTL đã ký không được vượt trần field");

constexpr uint64_t ns_from_ms(uint32_t ms) { return static_cast<uint64_t>(ms) * 1000000ull; }

/* TTL đo bằng ĐỒNG HỒ, không bằng số vòng quét. Đếm vòng quét chỉ xấp xỉ thời
 * gian khi vòng quét được nhịp đúng base step; mọi đường chạy nhanh hơn nhịp
 * thật (soak, replay, catch-up sau khi trễ) sẽ làm "60 s" co lại thành mili
 * giây mà không có gì báo. Một hẹn giờ an toàn không được phụ thuộc vào việc
 * vòng lặp có đang chạy đúng tốc độ hay không. */
constexpr uint64_t kSignedTtlNs = ns_from_ms(kSignedTtlMs);
} // namespace st_hold_ttl

enum class StSchedulerProfile : uint8_t {
    SUPPORTING_AS_BUILT = 0,
    REV_A,
};

const char* st_scheduler_profile_name(StSchedulerProfile profile);

/* Ảnh input cố định của một Program cho đúng một base-step. `cell` là value
 * typed đã convert nhưng chưa ghi vào runtime slot; metadata giữ identity,
 * quality, producer timestamp và source để Task 305 có thể publish health mà
 * không đọc ngược PointTable giữa cycle. */
struct StProcessInputSlot {
    StCell      cell{};
    uint16_t    slot = 0;
    StPointKind point_kind = StPointKind::UI;
    uint16_t    point_index = 0;
    uint8_t     quality = KX_Q_BAD;
    uint8_t     source = static_cast<uint8_t>(PointSource::DEFAULT);
    uint64_t    observed_at_ns = 0;
};

struct StProgramInstance {
    std::string instance_id;
    uint16_t    order = 0;
    bool        enabled = true;

    /* T59-402 — chu kỳ RIÊNG của từng Program (DDD §7.1: mỗi Program tự release
     * theo deadline của nó, Task không còn là đơn vị chạy chung).
     *
     * `0` nghĩa là "theo chu kỳ Task", giữ nguyên hành vi cho mọi Program chưa
     * khai chu kỳ — đổi mặc định sẽ làm mọi cấu hình cũ chạy khác đi mà không ai
     * yêu cầu. */
    uint32_t period_ms = 0;
    /* Mốc release LÝ THUYẾT kế tiếp. Bù trôi theo mốc lý thuyết chứ không theo
     * thời điểm chạy thật — nếu bám thời điểm thật, một tick trễ sẽ đẩy mọi
     * deadline sau đó trôi theo và Program 1 s không còn chạy 1 lần/giây. */
    uint64_t next_release_ns = 0;
    bool     release_started = false;
    /* Metrics theo Program. Task-level không thay được: với chu kỳ khác nhau,
     * một con số gộp không trả lời được "Program nào lỡ deadline". */
    uint32_t missed_release_count = 0;
    /* T60-002 — số chu kỳ lỡ LIÊN TIẾP tính tới lần release gần nhất; reset về
     * 0 ngay khi có một lần release đúng hạn.
     *
     * Vì sao cần thêm bên cạnh `missed_release_count`: bộ đếm tích luỹ không
     * bao giờ giảm, nên dùng nó để kết luận "sức khoẻ hiện tại" sẽ ghim Program
     * ở DEGRADED vĩnh viễn chỉ vì một lần lỡ nhịp cách đây một giờ. Đây là cùng
     * khuôn `total`/`consecutive` mà OverrunMonitor đã dùng cho Task. */
    uint32_t consecutive_missed_release = 0;
    /* THỜI LƯỢNG của lần chạy gần nhất (không phải mốc thời gian). */
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
    /* T60-002 — MỐC THỜI GIAN của lần chạy gần nhất, theo đúng đồng hồ `now_ns`
     * mà caller chụp một lần cho cả tick (cùng họ với
     * `RuntimePointSnapshot::captured_monotonic_ns`, nên "tuổi" của số đo tính
     * được bằng một phép trừ trong cùng một snapshot).
     *
     * KHÔNG tái dùng `last_successful_now_ns`: trường đó là mốc của lần chạy
     * THÀNH CÔNG gần nhất và đang là dấu thời gian nghiệp vụ của ảnh RETAIN
     * (`st_process_image.cpp`, `st_publish_retain_snapshot`). Ghép thêm nghĩa
     * "cột Last Exec của UI" vào nó sẽ trói hai thứ không liên quan vào một
     * biến, và với Program vừa FAULTED nó trả về mốc của lần chạy TỐT trước đó
     * — tức là báo sai thời điểm Program chết. Trường này ghi ở MỌI lần thân
     * chương trình được thực thi, kể cả lần kết thúc bằng fault. */
    uint64_t last_run_mono_ns = 0;

    /* T59-403 — lane là đơn vị SONG SONG. Program cùng lane chạy tuần tự theo
     * `order`; lane khác nhau độc lập nên có thể chạy đồng thời mà không đổi
     * kết quả. Mặc định 0: mọi Program một lane = hành vi tuần tự cũ.
     *
     * Lane KHÔNG được mang dữ liệu dùng chung. Trao đổi giữa Program đi qua
     * Published Signal có chính sách freshness/fallback khai báo (`T59-404`),
     * không qua biến chung — chia sẻ ngầm giữa hai lane là thứ làm kết quả phụ
     * thuộc vào việc lane nào chạy trước. */
    uint8_t     lane = 0;

    StProgramState   state = StProgramState::EMPTY;
    StProgramRuntime runtime;
    /* Last-known-good: artifact cuối cùng đã chạy >= 1 tick không fault.
     * Giữ bytes chứ không giữ StLoadedProgram để rollback luôn đi lại đúng
     * đường verify — rollback không được là cửa sau bỏ qua kiểm tra. */
    std::vector<uint8_t> last_known_good;
    std::vector<uint8_t> pending_artifact;
    /* Bytes của package vừa activate, chờ đủ 1 tick sạch để thành LKG. */
    std::vector<uint8_t> activated_artifact;
    /* Vùng giữ allocation cũ để safe boundary chỉ swap vector; giải phóng ở
     * request_activation() ngoài RT. */
    std::vector<uint8_t> retired_artifact;
    StPreparedProgramHandle pending_program;
    std::atomic<bool> has_pending{false};
    std::atomic<bool> pending_commit_requested{false};
    bool        pending_is_rollback = false;
    bool        pending_changed_state = false;
    StProgramState state_before_stage = StProgramState::EMPTY;

    const char* last_fault_code = nullptr;
    uint32_t    last_fault_pc = 0;
    int         last_fault_line = 0;
    uint32_t    fault_count = 0;
    uint32_t    run_count = 0;

    /* ProgramProcessImage: cấp phát tĩnh theo profile, không heap trong scan. */
    std::array<StProcessInputSlot, st_ir::kMaxIoBindings> process_inputs{};
    uint16_t    process_input_count = 0;
    uint64_t    input_snapshot_generation = 0;
    bool        input_snapshot_valid = true;
    uint64_t    last_successful_base_step = 0;
    /* T59-501 — đã publish output thành công ÍT NHẤT MỘT LẦN kể từ lần activate
     * gần nhất. Khác `output_commit_generation == base_step_count()` (chỉ đúng ở
     * đúng base step vừa commit): với gói trộn ba lớp chu kỳ, Program 30 s chỉ
     * commit mỗi 30 base step, nên đòi mọi Program cùng commit ở CÙNG một base
     * step là đòi một điều không bao giờ xảy ra. Đây là thứ barrier chu kỳ đầu
     * mức GÓI và phép thăng cấp LKG dùng để biết "đã đủ tư cách" hay chưa. */
    bool        committed_since_activation = false;
    uint64_t    output_commit_generation = 0;
    /* TASK-PROG-401, DDD-CTRL-PROG-001 §6: true sau khi proposal mức
     * PRIO_LOCAL_LOGIC của instance đã được rút (release_ao/release_do) —
     * tránh gọi release lặp mỗi tick và phân biệt "còn hold-last" với
     * "đã nhả quyền". Reset về false khi instance publish thành công
     * (st_apply_all_outputs) hoặc khi activate artifact mới. */
    bool        outputs_withdrawn = false;

    /* TASK-PROG-402: mailbox thuộc StRetainService, không sở hữu ở instance.
     * Scan chỉ publish fixed snapshot; worker mới ghi đĩa. */
    StRetainMailbox* retain_mailbox = nullptr;
    StRetainRestoreState retain_restore_state = StRetainRestoreState::NOT_APPLICABLE;
    const char* retain_reject_code = nullptr;
    uint64_t retain_generation = 0;
    StRetainRestoreState pending_retain_restore_state =
        StRetainRestoreState::NOT_APPLICABLE;
    const char* pending_retain_reject_code = nullptr;
    uint64_t pending_retain_generation = 0;
    uint64_t last_successful_now_ns = 0;
    /* ADR-051: mốc ĐỒNG HỒ của lần commit output gần nhất, đi kèm
     * `output_commit_generation` (mốc base step). TTL hold-last đọc mốc này chứ
     * không đọc số base step, xem `st_hold_ttl`. */
    uint64_t output_commit_now_ns = 0;

    /* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §3). Mẫu giống
     * `has_pending`/`pending_commit_requested`: non-RT set `true` (release),
     * RT tiêu thụ tại safe boundary rồi set lại `false` và tăng
     * `retain_reset_ack_generation` (cùng thao tác, cùng boundary — không
     * có cửa sổ race giữa "đã reset" và "đã ack"). Non-RT xác nhận đã áp
     * dụng bằng cách so `retain_reset_ack_generation` với giá trị đọc được
     * TRƯỚC khi set cờ — tăng lên nghĩa là đã qua đúng 1 boundary kể từ lúc
     * yêu cầu, không suy đoán theo thời gian chờ. */
    std::atomic<bool> pending_retain_reset{false};
    std::atomic<uint64_t> retain_reset_ack_generation{0};

    /* F-P59-ENABLE-BOUNDARY-001 — Enable/Disable đi CÙNG một con đường với
     * RETAIN reset: non-RT chỉ ARM một yêu cầu, RT áp dụng tại safe boundary.
     *
     * Vì sao không cho non-RT sửa thẳng `state`/`enabled` như bản trước: trên
     * bo thật `SET_PROGRAM_ENABLED` chạy trên IPC worker thread trong khi scan
     * loop RT đang tick cùng scheduler, nên `StScheduler::start/stop/enable/
     * disable` gọi từ đó ghi đè `state` ngay giữa lúc RT đang đọc để quyết
     * định dispatch và đang ghi khi Program fault. Đo bằng
     * `-fsanitize=thread` trên `EnableIntentAppliesAtSafeBoundaryWhileScanRuns`
     * ra ba data race: `stop`↔`run_task`, `disable`↔`run_task`,
     * `start`(vòng đếm trần 16)↔`run_program`. Hậu quả không phải chỉ là cảnh
     * báo công cụ: một lệnh Disable rơi đúng giữa tick có thể bị chính RT ghi
     * đè trạng thái ngay sau đó, và Program đã bị người vận hành tắt vẫn chạy
     * tiếp một chu kỳ với quyền ghi đầu ra.
     *
     * `enable_ack_result`/`enable_ack_state` ghi TRƯỚC, `enable_ack_generation`
     * tăng SAU bằng release — non-RT thấy generation tăng thì chắc chắn thấy
     * đúng kết quả của chính lượt đó. */
    std::atomic<uint8_t> pending_enable_request{
        static_cast<uint8_t>(StEnableRequest::NONE)};
    std::atomic<uint8_t> enable_ack_result{static_cast<uint8_t>(StEnableAckResult::NONE)};
    /* Trạng thái tại thời điểm RT từ chối, để non-RT nói được LÝ DO thật cho
     * người vận hành mà không phải đọc `state` (chính là thứ đang chạy đua). */
    std::atomic<uint8_t> enable_ack_state{static_cast<uint8_t>(StProgramState::EMPTY)};
    std::atomic<uint64_t> enable_ack_generation{0};
};

/* Ảnh topology/IR của cả package được dựng ngoài scheduler sống. Safe boundary
 * chỉ activate các handle đã chuẩn bị rồi swap vector ownership O(1); vì vậy
 * STAGE không đổi period/state/membership của Revision đang chạy. */
struct StProgramSetEntry {
    std::string instance_id;
    std::vector<uint8_t> artifact;
    uint16_t order = 0;
    uint32_t period_ms = 0;
    bool enabled = false;
};

using StPreparedProgramSet = std::vector<std::unique_ptr<StProgramInstance>>;

struct StTaskConfig {
    std::string id;
    uint8_t     priority = 0;       /* 0 = cao nhất */
    uint32_t    period_ms = 1000;
    uint32_t    budget_ms = 200;
    bool        enabled = true;
    uint32_t    overrun_threshold = 3;
};

/* T59-402 — release theo Program. Đặt ở đây (không ẩn trong .cpp) để test khoá
 * được luật deadline mà không phải dựng cả một scan loop. */
bool st_program_due(const StProgramInstance& program, uint32_t task_period_ms, uint64_t now_ns);
/* `tolerance_ns` phải là CÙNG dung sai `st_program_due` đã dùng để quyết định
 * release này (xem `st_release_tolerance_ns`); mặc định 0 chỉ dành cho caller
 * gọi đúng mốc lý thuyết. */
void st_program_mark_released(StProgramInstance* program, uint64_t now_ns,
                              uint64_t tolerance_ns = 0);
/* EV-PROG-FBD-ST-MB-20260925 F01 — dung sai so hạn = nửa chu kỳ của nhịp đánh
 * giá (tick). Mốc release được neo ở thời điểm quét THẬT, vốn đã mang jitter
 * vài chục µs; so chặt `now >= next` thì mọi tick có jitter nhỏ hơn tick neo bị
 * coi là "chưa tới hạn" và Program mất trọn một chu kỳ. Nửa tick là biên duy
 * nhất vừa nuốt được jitter vừa không bao giờ cho chạy sớm một tick. */
uint64_t st_release_tolerance_ns(uint64_t tick_period_ns);

struct StTaskStats {
    uint32_t run_count = 0;
    uint32_t skip_count = 0;       /* đến hạn nhưng bị bỏ vì disabled */
    uint32_t missed_release_count = 0; /* release lỡ do base step/step bị trễ */
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
};

class StTask {
public:
    explicit StTask(const StTaskConfig& cfg)
        : cfg_(cfg), monitor_(cfg.overrun_threshold) {}

    const StTaskConfig& config() const { return cfg_; }
    const StTaskStats&  stats() const { return stats_; }
    const OverrunMonitor& monitor() const { return monitor_; }
    OverrunMonitor& monitor() { return monitor_; }
    uint64_t last_dispatch_base_step() const { return last_dispatch_base_step_; }
    bool last_dispatch_succeeded() const { return last_dispatch_succeeded_; }

    void set_enabled(bool e);
    bool enabled() const { return cfg_.enabled; }

    /* Chỉ số chương trình theo `order` tăng dần — thứ tự thực thi cố định. */
    std::vector<std::unique_ptr<StProgramInstance>>& programs() { return programs_; }
    const std::vector<std::unique_ptr<StProgramInstance>>& programs() const { return programs_; }

    bool due(uint64_t now_ns) const;
    /* Cập nhật mốc chạy kế tiếp theo mốc LÝ THUYẾT (bù trôi, SPEC §4). */
    void mark_ran(uint64_t now_ns);

    /* Base step của nền tảng; 0 = chưa biết (Task period được coi là base
     * step, đúng cho Rev A). Chỉ dùng để giới hạn dung sai so hạn: Task 100 ms
     * trên base 10 ms không được chạy sớm tới 50 ms. */
    void set_base_step_ns(uint64_t ns) { base_step_ns_ = ns; }
    /* Dung sai so hạn của Task: nửa min(Task period, base step). */
    uint64_t release_tolerance_ns() const;

private:
    StTaskConfig   cfg_;
    OverrunMonitor monitor_;
    StTaskStats    stats_;
    std::vector<std::unique_ptr<StProgramInstance>> programs_;
    uint64_t last_run_ns_ = 0;
    uint64_t base_step_ns_ = 0;
    bool     started_ = false;
    uint64_t last_dispatch_base_step_ = 0;
    bool     last_dispatch_succeeded_ = false;

    friend class StScheduler;
};

/* Chế độ chạy lane. Hai chế độ phải cho ĐÚNG cùng kết quả quan sát được: nếu
 * khác, thì một trong hai đang chạy một chương trình khác với thứ người dùng
 * cấu hình, và không có cách nào biết là chế độ nào. */
enum class StLaneMode : uint8_t {
    /* Mặc định. Mọi lane chạy tuần tự theo số hiệu lane. */
    SEQUENTIAL = 0,
    /* Mỗi lane một worker đã tạo sẵn. Không cấp phát, không khoá trong chu kỳ. */
    PARALLEL,
};

/* Trần lane: bằng trần Program mỗi Task, để cấu hình "mỗi Program một lane" vẫn
 * hợp lệ. Cấp phát tĩnh theo trần này nên không có heap trong scan. */
constexpr std::size_t kMaxLanes = st_sched_limits::kMaxProgramsPerTask;

struct StSchedulerTickResult {
    uint64_t base_step_sequence = 0;
    uint32_t tasks_run = 0;
    uint32_t programs_run = 0;
    uint32_t faults = 0;
    bool     any_force_safe = false;
};

class StScheduler {
public:
    /* Supporting giữ nguyên hành vi component cũ cho host/backward tests.
     * Đường production Rev A bắt buộc khởi tạo tường minh REV_A; TASK-PROG-306
     * sẽ là điểm bootstrap duy nhất làm việc đó. */
    explicit StScheduler(StSchedulerProfile profile = StSchedulerProfile::SUPPORTING_AS_BUILT)
        : profile_(profile),
          /* F01: chưa ai báo base step thật thì lấy tick NHỎ NHẤT profile cho
           * phép — dung sai suy ra từ đó không bao giờ cho Task chạy sớm trọn
           * một tick. `main` ghi đè bằng base step thật. */
          base_step_ns_(static_cast<uint64_t>(profile == StSchedulerProfile::REV_A
                                                  ? st_base_step::kMinMs
                                                  : st_sched_limits::kBaseTickMs) *
                        1000000ull) {}
    /* Worker phải dừng TRƯỚC khi mọi thứ chúng đọc bị huỷ. Để mặc định huỷ là
     * để lại một luồng đang đọc bộ nhớ vừa được giải phóng. */
    ~StScheduler();
    StScheduler(const StScheduler&) = delete;
    StScheduler& operator=(const StScheduler&) = delete;

    StSchedulerProfile profile() const { return profile_; }
    uint64_t base_step_count() const { return base_step_count_; }
    /* Base step thật của ScanLoop; truyền xuống mọi Task (kể cả Task thêm sau)
     * để dung sai so hạn không vượt nửa base step. Gọi ngoài RT. */
    void set_base_step_ns(uint64_t ns);

    /* Đồng hồ của tick gần nhất (ns), đúng giá trị caller truyền vào
     * `on_base_step()`. Chính sách tính theo THỜI GIAN (hold TTL ADR-051) đọc ở
     * đây thay vì tự gọi đồng hồ: cả hệ đã thống nhất một đồng hồ chụp một lần
     * cho cả tick, thêm một nguồn thời gian thứ hai là thêm một cách để hai câu
     * trả lời lệch nhau. */
    uint64_t last_tick_now_ns() const { return last_tick_now_ns_; }

    /* Đồng hồ RIÊNG cho đo WCET/overrun (PROGRAM_TASK_SCHEDULER_SPEC §5:
     * `task_start`/`exec_ns`) — KHÁC với `now_ns` của on_base_step(), vốn
     * chụp một lần cho toàn tick để FB/deadline tất định (§4). Đo overrun
     * không phải logic chương trình nên đọc đồng hồ riêng ở đây không phá
     * bất biến đó; mặc định đồng hồ monotonic thật, test tiêm giả để không
     * cần sleep thật. */
    void set_wall_clock_for_test(std::function<uint64_t()> clock) { wall_clock_ = std::move(clock); }

    /* TASK-PROG-305: log bounded read-only cho RUNTIME_FAULT/OVERRUN/
     * ROLLBACK/ACTIVATION_RESULT — bounded event trace của OD-PROG-011,
     * KHÔNG PHẢI value-sampling historian 10.000 sample/10 phút của cùng
     * quyết định đó (phần đó cần selector/session riêng, còn mở — xem
     * DDD-CTRL-PROG-001 As-Built). nullptr = không log (mặc định), scheduler
     * không tự cấp phát trace log để giữ chủ quyền bounded-capacity ở caller. */
    /* T59-404 — bus Published Signal của package đang chạy. Scheduler chỉ chịu
     * trách nhiệm COMMIT ở boundary; khai báo và publish thuộc lớp nạp package
     * và thân chương trình. nullptr = package không có signal nào.
     *
     * Vì sao commit ở đây chứ không để mỗi Program tự đổi bản: trong cùng một
     * chu kỳ, mọi consumer phải thấy CÙNG một ảnh signal. Cho consumer thấy giá
     * trị ngay khi publisher ghi sẽ làm kết quả phụ thuộc vào lane nào chạy
     * trước — đúng thứ mà "single/multicore cùng ngữ nghĩa" cấm. */
    void set_signal_bus(StSignalBus* bus) { signal_bus_ = bus; }
    StSignalBus* signal_bus() const { return signal_bus_; }

    void set_trace_log(StSchedulerTrace* trace) { trace_ = trace; }
    const StSchedulerTrace* trace_log() const { return trace_; }

    /* T59-403 — chọn chế độ chạy lane. Đổi chế độ tạo/huỷ worker NGOÀI chu kỳ
     * quét; gọi giữa chừng một tick là lỗi lập trình, không phải trường hợp cần
     * hỗ trợ. Mặc định SEQUENTIAL: bật song song phải là quyết định tường minh
     * của người dựng hệ, không phải mặc định ai đó thừa hưởng. */
    void set_lane_mode(StLaneMode mode);
    StLaneMode lane_mode() const { return lane_mode_; }

    /* Gán lane cho một Program. Trả false nếu không tìm thấy instance hoặc lane
     * vượt trần. */
    bool set_program_lane(const std::string& instance_id, uint8_t lane, std::string* error);

    /* Trần Program chạy đồng thời của profile đang dùng (Rev A: 16). Hằng
     * số thuần tuý, không đọc trạng thái nên gọi được từ mọi luồng. */
    std::size_t max_enabled_programs() const noexcept;

    /* Trả false + *error nếu cấu hình vi phạm ràng buộc SPEC §3. Fail-fast:
     * cấu hình sai không được chạy với "phần hợp lệ", vì như vậy hệ chạy khác
     * điều engineer nghĩ mà không ai biết. */
    bool add_task(const StTaskConfig& cfg, std::string* error);

    /* Thêm instance vào task. `order` phải duy nhất trong task. */
    bool add_program(const std::string& task_id, const std::string& instance_id, uint16_t order,
                     std::string* error);

    StTask* find_task(const std::string& id);
    StProgramInstance* find_program(const std::string& instance_id);

    /* Xếp hàng artifact; áp dụng tại RANH GIỚI tick kế tiếp (SPEC §7.2).
     * `is_rollback=true` bỏ qua guard "candidate hiện tại chưa qua clean
     * tick" ở stage_activation() — xem ghi chú tại đó, đây là lối thoát BẮT
     * BUỘC cho chính candidate đang kẹt đó. */
    bool request_activation(const std::string& instance_id, const std::vector<uint8_t>& artifact,
                            std::string* error, bool is_rollback = false);

    /* Hai pha cho Commission: stage verify/preallocate ngoài RT nhưng CHƯA
     * cho safe boundary swap; activate chỉ arming O(1). API cũ phía trên giữ
     * hành vi một bước cho unit/supporting callers. */
    bool stage_activation(const std::string& instance_id, const std::vector<uint8_t>& artifact,
                          std::string* error, bool is_rollback = false);
    bool commit_staged_activation(const std::string& instance_id, bool rollback,
                                  std::string* error);
    bool abort_staged_activation(const std::string& instance_id, std::string* error);

    /* Package-atomic lifecycle. `prepare_program_set` làm toàn bộ loader/RETAIN/
     * heap ở non-RT trên một topology shadow. `arm` kiểm trước toàn bộ rồi mới
     * đặt cờ, không thể để nửa package armed. Safe boundary activate shadow và
     * swap cả vector; `*prepared` nhận lại nguyên topology cũ để rollback. */
    bool prepare_program_set(const std::string& task_id,
                             const std::vector<StProgramSetEntry>& entries,
                             StPreparedProgramSet* prepared, std::string* error);
    bool arm_prepared_program_set(StPreparedProgramSet* prepared, bool rollback,
                                  std::string* error);
    bool swap_prepared_program_set_at_boundary(const std::string& task_id,
                                               StPreparedProgramSet* prepared) noexcept;
    bool restore_program_set_at_boundary(const std::string& task_id,
                                         StPreparedProgramSet* previous) noexcept;

    /* Lệnh vòng đời (SPEC §7.3). Trả false nếu chuyển trạng thái không hợp lệ.
     *
     * CHỈ gọi khi KHÔNG có luồng scan nào đang tick scheduler này: bootstrap
     * trước khi scan chạy, hoặc test đơn luồng. Bốn hàm này ghi thẳng
     * `state`/`enabled` mà RT đang đọc mỗi tick. Đường lệnh của người vận
     * hành lúc hệ ĐANG CHẠY phải đi qua `request_program_enabled()` +
     * `apply_pending_enable_requests_at_boundary()` (F-P59-ENABLE-BOUNDARY-001). */
    bool start(const std::string& instance_id, std::string* error);
    bool stop(const std::string& instance_id, std::string* error);
    bool enable(const std::string& instance_id, std::string* error);
    bool disable(const std::string& instance_id, std::string* error);
    bool reset_fault(const std::string& instance_id, std::string* error);
    bool rollback(const std::string& instance_id, std::string* error);

    /* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §3). Non-RT: đặt cờ
     * pending, áp dụng thật tại boundary kế tiếp (không đồng bộ tại đây —
     * xem `apply_pending_retain_resets_at_boundary()`). Trả false nếu
     * instance không tồn tại hoặc chưa có program đang chạy (không có gì
     * retained để reset). Caller (coordinator) đọc
     * `find_program(id)->retain_reset_ack_generation` TRƯỚC khi gọi hàm
     * này để có mốc so sánh xác nhận đã áp dụng. */
    bool request_retain_reset(const std::string& instance_id, std::string* error);

    /* F-P59-ENABLE-BOUNDARY-001. Non-RT ARM ý định Enable/Disable; RT áp dụng
     * tại safe boundary kế tiếp (`apply_pending_enable_requests_at_boundary`).
     * KHÔNG gọi `start/stop/enable/disable` từ luồng non-RT khi scan đang
     * chạy — đó là đường ghi thẳng vào `state` mà RT đang đọc/ghi.
     *
     * `*instance` trả lại chính con trỏ vừa tra để caller poll
     * `enable_ack_generation` mà không phải tra lại; `*ack_baseline` đọc
     * TRƯỚC khi arm nên "generation tăng" luôn có nghĩa là đã qua đúng một
     * boundary kể từ yêu cầu này. */
    enum class StEnableRequestOutcome : uint8_t {
        ARMED = 0,
        UNKNOWN_INSTANCE,
        ALREADY_PENDING,
    };
    StEnableRequestOutcome request_program_enabled(const std::string& instance_id, bool enabled,
                                                   StProgramInstance** instance,
                                                   uint64_t* ack_baseline, std::string* error);

    /* Safe-boundary phase tách riêng để process image chụp input của candidate
     * vừa activate, không chụp artifact cũ rồi execute artifact mới. Gọi lặp
     * lại trong cùng boundary là no-op. */
    void apply_pending_activations_at_boundary();

    /* WP-12: áp dụng RETAIN reset đang chờ (nếu có) cho mọi instance, tại
     * CÙNG safe boundary với activation — không cấp phát, không throw. Gọi
     * cùng chỗ caller gọi `apply_pending_activations_at_boundary()` (xem
     * `ProgrammingRuntimeCoordinator::on_safe_boundary()`). Tách riêng khỏi
     * activation để không trộn hai luồng nghiệp vụ khác nhau vào một hàm. */
    void apply_pending_retain_resets_at_boundary();

    /* F-P59-ENABLE-BOUNDARY-001: áp dụng ý định Enable/Disable đang chờ cho
     * mọi instance, tại CÙNG safe boundary với activation/retain reset. Không
     * cấp phát, không throw, không lock. Gọi ở đúng chỗ caller gọi hai hàm
     * boundary kia (`ProgrammingRuntimeCoordinator::on_safe_boundary()`). */
    void apply_pending_enable_requests_at_boundary();

    /* Một base step. `now_ns` chụp MỘT LẦN bởi caller và dùng chung cho mọi
     * Task. Task period chỉ quyết định có dispatch hay không; tuyệt đối không
     * được dùng làm thời gian sleep của caller. */
    StSchedulerTickResult on_base_step(uint64_t now_ns);

    /* Alias tương thích cho supporting component cũ. Source production mới
     * phải gọi on_base_step() để ranh giới timing hiện rõ khi review. */
    StSchedulerTickResult tick(uint64_t now_ns) { return on_base_step(now_ns); }

    /* true nếu BẤT KỲ task nào đang yêu cầu safe-state do overrun. */
    bool any_force_safe() const;

    const std::vector<std::unique_ptr<StTask>>& tasks() const { return tasks_; }
    void set_loader_options(const StLoaderOptions& o) { loader_opts_ = o; }

    /* Chỉ cấu hình ngoài RT. Service phải sống lâu hơn scheduler. */
    void set_retain_service(StRetainService* service);
    StRetainService* retain_service() const { return retain_service_; }

    /* Gọi sau khi output batch của base-step hiện tại đã commit. Chỉ copy
     * snapshot bounded vào mailbox, không filesystem I/O/lock/allocation. */
    void publish_committed_retain_snapshots() noexcept;

    /* Chỉ promote artifact vừa activate thành LKG sau khi CHÍNH cycle đó đã
     * execute và publish output batch thành công. Một cycle chỉ execute sạch
     * nhưng bị output preflight/commit từ chối chưa đủ tư cách rollback. */
    void promote_output_committed_artifacts() noexcept;

private:
    StSchedulerProfile profile_ = StSchedulerProfile::SUPPORTING_AS_BUILT;
    uint64_t base_step_count_ = 0;
    uint64_t base_step_ns_;
    uint64_t last_tick_now_ns_ = 0;
    std::vector<std::unique_ptr<StTask>> tasks_;
    StLoaderOptions loader_opts_;
    std::function<uint64_t()> wall_clock_ = default_monotonic_wall_clock_ns;
    StSchedulerTrace* trace_ = nullptr;
    StSignalBus* signal_bus_ = nullptr;
    StRetainService* retain_service_ = nullptr;

    /* Kết quả MỘT lane trong MỘT lần chạy Task. Lane không được đụng vào
     * `StSchedulerTickResult` hay trace chung: hai lane ghi cùng lúc là một
     * data race, và thứ tự ghi sẽ phụ thuộc lane nào chạy nhanh hơn. Gom riêng
     * rồi trộn lại theo SỐ HIỆU LANE sau khi mọi lane xong — trộn theo thứ tự
     * hoàn thành sẽ làm kết quả khác nhau giữa hai lần chạy. */
    struct LaneOutcome {
        uint32_t ran = 0;
        uint32_t faults = 0;
        bool     dispatch_failed = false;
        /* Trace của lane, phát lại vào trace chung theo thứ tự lane. Bounded và
         * cấp phát tĩnh nên không có heap trong chu kỳ. */
        std::array<StRuntimeTraceEvent, st_sched_limits::kMaxProgramsPerTask> events{};
        std::size_t event_count = 0;
    };

    /* Một lane đang chờ chạy: dải chỉ số Program trong `task.programs()`.
     * Không giữ con trỏ Program để tránh mọi nghi vấn về tuổi thọ khi worker
     * chạy song song. */
    struct LaneWork {
        std::array<uint16_t, st_sched_limits::kMaxProgramsPerTask> program_index{};
        std::size_t program_count = 0;
    };

    void run_task(StTask& task, uint64_t now_ns, StSchedulerTickResult* out);
    /* Chạy đúng một Program. Trả về false nếu Program fault — caller quyết định
     * cô lập hay dừng, hàm này không biết chính sách đó. */
    bool run_program(StTask& task, StProgramInstance& program, uint64_t now_ns,
                     LaneOutcome* outcome);
    void run_lane(StTask& task, const LaneWork& work, uint64_t now_ns, LaneOutcome* outcome);
    void start_workers(std::size_t count);
    void stop_workers();
    void apply_pending_activations(StTask& task);
    bool stage_activation(StProgramInstance* program, const std::vector<uint8_t>& artifact,
                          std::string* error, bool is_rollback);
    void apply_pending_retain_resets(StTask& task);
    void apply_pending_enable_requests(StTask& task) noexcept;
    /* Số Program đang chiếm suất chạy (RUNNING/WAITING) trên TOÀN scheduler —
     * trần 16 là trần của thiết bị, không phải của một Task. Chỉ gọi từ RT
     * (boundary/lệnh bootstrap): vòng lặp này đọc `state` của mọi instance. */
    std::size_t running_program_count() const noexcept;
    void log_trace(StTraceEventKind kind, uint64_t now_ns, bool ok, const char* task_id,
                   const char* instance_id, const char* code);

    StLaneMode lane_mode_ = StLaneMode::SEQUENTIAL;
    /* Bộ đệm lane cấp phát MỘT LẦN, dùng lại mỗi tick: cấp phát trong chu kỳ
     * quét là thứ làm WCET không còn giới hạn trên. */
    std::array<LaneWork, kMaxLanes> lane_work_{};
    std::array<LaneOutcome, kMaxLanes> lane_outcome_{};

    /* Worker đã tạo sẵn cho chế độ PARALLEL. Tạo/huỷ chỉ xảy ra ở
     * `set_lane_mode`, ngoài chu kỳ quét. */
    struct Worker {
        StScheduler* owner = nullptr;
        std::thread thread;
        std::atomic<bool> has_work{false};
        std::atomic<bool> stop{false};
        StTask* task = nullptr;
        const LaneWork* work = nullptr;
        LaneOutcome* outcome = nullptr;
        uint64_t now_ns = 0;
    };
    std::vector<std::unique_ptr<Worker>> workers_;
};

} // namespace core

#endif /* CORE_ST_SCHEDULER_HPP */
