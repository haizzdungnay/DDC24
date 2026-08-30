#ifndef CORE_RUNTIME_POINT_SNAPSHOT_HPP
#define CORE_RUNTIME_POINT_SNAPSHOT_HPP

#include <array>
#include <cstdint>
#include <string>

#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"

namespace core {

constexpr std::size_t KX_HIST_PHYSICAL_COUNT = KX_N_UI + KX_N_AO + KX_N_DO;
constexpr std::size_t KX_POINT_SNAPSHOT_MAX_PAYLOAD = 64u * 1024u;

enum class SnapshotPointKind : uint8_t { UI, AO, DO };
enum class SnapshotSource : uint8_t { IO, SAFETY, MANUAL, BACNET, SCHEDULE, LOGIC, DEFAULT };
enum class SnapshotRole : uint8_t { ENGINEERING_VALUE, RESOLVED_SETPOINT, HARDWARE_FEEDBACK };

struct RuntimePointSnapshotRow {
    std::array<char, 6> id{};
    SnapshotPointKind kind = SnapshotPointKind::UI;
    float value = 0.0f;
    kx_quality_t quality = KX_Q_BAD;
    SnapshotSource source = SnapshotSource::DEFAULT;
    SnapshotRole role = SnapshotRole::ENGINEERING_VALUE;
    std::array<char, 9> unit{};
    uint64_t updated_at_monotonic_ns = 0;
    uint32_t generation = 1;
    bool program_value_present = false;
    float program_value = 0.0f;
    uint8_t effective_priority = 0;
};

struct RuntimeTaskSnapshot {
    bool present = false;
    std::array<char, 33> id{};
    uint32_t period_ms = 0;
    uint32_t budget_ms = 0;
    std::array<char, 12> state{};
    uint32_t run_count = 0;
    uint32_t missed_release_count = 0;
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
    uint32_t overrun_count = 0;
    uint32_t consecutive_overruns = 0;
};

/* T60-001 — trần của mảng `programs[]` trong snapshot.
 *
 * Đây là bản SAO CÓ KIỂM của `st_sched_limits::kMaxProgramsTotal` (=32), không
 * phải một con số thứ hai được đặt ra ở đây: lớp `apps/core/domain` bị cấm
 * include `st/…` (boundary domain ↔ application, canh bởi
 * `tools/restructure/verify_repository.py::validate_dependency_boundaries`),
 * nên hằng buộc phải khai lại trong lớp domain. Ràng buộc "hai số luôn bằng
 * nhau" được canh bằng `static_assert` ngay tại chỗ ĐIỀN mảng
 * (`application/runtime/scan_loop.cpp`) — nơi cả hai header đều nhìn thấy nhau;
 * số lệch đi làm GÃY BUILD chứ không âm thầm cắt mất Program.
 *
 * Trần là kMaxProgramsTotal chứ KHÔNG phải kMaxProgramsPerTask (=16):
 * `programs[]` là danh sách TOÀN HỆ THỐNG (mọi Task), dùng trần per-task sẽ cắt
 * mất một nửa cấu hình 32 Program hợp lệ. */
constexpr std::size_t KX_POINT_SNAPSHOT_MAX_PROGRAMS = 32;

/* T60-001 — trạng thái quan sát được của MỘT Program Instance, cho bảng
 * Programs của PGM-01 (Plan 60 §4.1/§4.2). Toàn bộ phép đo đã có sẵn trong
 * scheduler; struct này chỉ mở đường truyền.
 *
 * Không chuỗi động, không con trỏ: struct nằm trên đường realtime và được copy
 * nguyên khối vào cache của WebIpc mỗi scan cycle, nên phải giữ trivially
 * destructible và bounded như `rows`/`task`. */
struct RuntimeProgramSnapshot {
    /* 64 ký tự là trần instance_id mà `StScheduler::add_program` ép; +1 cho NUL. */
    std::array<char, 65> instance_id{};
    /* Tên `StProgramState` dài nhất là "ROLLED_BACK" (11 ký tự) + NUL. */
    std::array<char, 12> state{};
    bool     enabled = false;
    /* Chu kỳ HIỆU LỰC (ms). Program khai `period_ms = 0` nghĩa là "theo chu kỳ
     * Task", nên chỗ điền phải phân giải về chu kỳ Task chứ không phát `0` ra
     * ngoài — `0` ở cột Cycle là số bịa, đúng thứ Plan 60 §6 `T60-205` cấm. */
    uint32_t period_ms = 0;
    /* THỜI LƯỢNG một lần chạy gần nhất (`wall_clock_() - program_start`,
     * st_scheduler.cpp). KHÔNG phải mốc thời gian — mốc nằm ở
     * `last_run_mono_ns`. Hai thứ này rất dễ đọc nhầm nhau. */
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
    /* LÝ DO fault gần nhất.
     *
     * `StScheduler` vốn đã ghi `last_fault_code`/`last_fault_line` vào chính
     * Program, nhưng trước lát này chúng CHẾT Ở ĐÓ: không vào snapshot, không
     * ra IPC, không tới API. Hệ quả thực tế đo được trên bo: một Program nằm
     * `FAULTED` suốt hai ngày mà không nơi nào nói vì sao — người vận hành chỉ
     * thấy `coreState=FAULTED, lastExecNs=0` và không có gì để lần theo.
     *
     * Mã rỗng nghĩa là "chưa từng fault", KHÁC HẲN "fault mà không rõ lý do". */
    std::array<char, 24> last_fault_code{};
    uint32_t last_fault_line = 0;
    uint32_t fault_count = 0;
    /* Bộ đếm TÍCH LUỸ từ lúc release lần đầu. */
    uint32_t missed_release_count = 0;
    /* T60-002 — số chu kỳ lỡ LIÊN TIẾP tính tới lần release gần nhất, reset về 0
     * mỗi lần release đúng hạn. Công thức `health` (Plan 60 §4.2 điều 4) phải
     * dùng trường này chứ không dùng bộ đếm tích luỹ: một lần lỡ nhịp cách đây
     * một giờ sẽ ghim Program ở DEGRADED vĩnh viễn. */
    uint32_t consecutive_missed_release = 0;
    /* T60-002 — MỐC THỜI GIAN (đồng hồ monotonic của tick, cùng họ với
     * `captured_monotonic_ns`) của lần chạy gần nhất. 0 = chưa chạy lần nào kể
     * từ lần activate gần nhất. */
    uint64_t last_run_mono_ns = 0;
    uint8_t  lane = 0;
};

struct RuntimePointSnapshot {
    uint64_t snapshot_id = 0;
    uint64_t observed_utc_ms = 0;
    uint64_t captured_monotonic_ns = 0;
    bool safe_state = false;
    /* true CHỈ KHI safe_state đến từ SafeState::Triggers::no_controller đơn
     * độc — không có iop_fault/stale/graph_input_bad/overrun đi kèm. Phân
     * biệt "chưa ai điều khiển" (Commission một Program có output sẽ tự giải
     * quyết) khỏi safe-state do lỗi thật (I/O fault/stale/overrun — Commission
     * không được phép coi là an toàn để bỏ qua). Xem safety/safe_state.hpp §5.2. */
    bool safe_state_no_controller_only = false;
    RuntimeTaskSnapshot task{};
    /* T60-001 — danh sách Program TOÀN HỆ THỐNG (mọi Task), không phải của một
     * Task. `program_count` là số phần tử hợp lệ; phần còn lại của mảng giữ giá
     * trị mặc định và KHÔNG được serialize. */
    std::array<RuntimeProgramSnapshot, KX_POINT_SNAPSHOT_MAX_PROGRAMS> programs{};
    std::size_t program_count = 0;
    /* true khi số Program của hệ vượt trần mảng. Cắt phải NÓI RA: bỏ bớt trong
     * im lặng làm UI hiển thị một danh sách thiếu mà không có gì cho biết là
     * thiếu. */
    bool programs_truncated = false;
    std::array<RuntimePointSnapshotRow, KX_HIST_PHYSICAL_COUNT> rows{};
};

std::string serialize_runtime_point_snapshot(const RuntimePointSnapshot& snapshot);
bool serialize_runtime_point_snapshot(const RuntimePointSnapshot& snapshot, char* output,
                                      std::size_t capacity, std::size_t* length) noexcept;

class RuntimePointSnapshotPublisher {
public:
    RuntimePointSnapshot build(uint64_t snapshot_id, uint64_t observed_utc_ms,
                               uint64_t captured_monotonic_ns, const PointTable& table,
                               const IoSnapshot& io, const OutputCmd& resolved,
                               const PriorityResolver& resolver, bool safe_state_active,
                               bool safe_state_no_controller_only = false);

private:
    std::array<float, KX_N_AO> previous_ao_value_{};
    std::array<SnapshotSource, KX_N_AO> previous_ao_source_{};
    std::array<kx_quality_t, KX_N_AO> previous_ao_quality_{};
    std::array<bool, KX_N_AO> previous_ao_current_mode_{};
    std::array<uint64_t, KX_N_AO> ao_updated_at_{};
    std::array<bool, KX_N_AO> ao_seen_{};
};

} // namespace core

#endif /* CORE_RUNTIME_POINT_SNAPSHOT_HPP */
