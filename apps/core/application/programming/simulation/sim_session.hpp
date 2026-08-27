/**
 * @file  sim_session.hpp
 * @brief `T59-814` — máy chạy mô phỏng riêng của một phiên Simulation.
 *
 *        ADR-053 §4: phiên được phép DÙNG LẠI loader/executor production, và
 *        bị cấm chạm production SHM/device/iobus/output writer/RETAIN. Bản
 *        dịch của hai câu đó thành mã nguồn là file này:
 *
 *          - nạp artifact bằng `UnpackPackageV2` + `StProgramRuntime` — đúng bộ
 *            ngữ nghĩa đang chạy trên tủ, không có bộ thứ hai "gần đúng";
 *          - nhưng scheduler, đồng hồ, ảnh vào/ra và RETAIN là RIÊNG của phiên,
 *            không phải `StScheduler`/`PointTable`/`PriorityResolver`.
 *
 *        Vì sao không dùng `StScheduler` production: nó nhận `PointTable` và
 *        `PriorityResolver` — tức chính đường ghi ra thiết bị. Link nó vào
 *        worker là mở đúng cái cạnh mà ADR-053 tồn tại để cắt, và không một
 *        lượng review nào bù lại được cho một cạnh đã có sẵn trong binary.
 *
 *        Đồng hồ ảo là tham số của `execute()`, không phải đồng hồ hệ thống:
 *        executor production vốn đã nhận `now_ns` từ caller, nên tất định ở đây
 *        là thuộc tính có sẵn chứ không phải thứ phải mô phỏng thêm.
 */
#ifndef CORE_PROGRAMMING_SIM_SESSION_HPP
#define CORE_PROGRAMMING_SIM_SESSION_HPP

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "st/st_package_v2.hpp"
#include "st/st_program.hpp"
#include "st/st_runtime.hpp"

namespace core::programming::sim {

/* Trần do chính worker thi hành. Supervisor cũng có trần riêng; hai lớp trùng
 * nhau là cố ý — worker không được tin rằng phía gọi luôn còn sống và đúng. */
constexpr std::size_t kMaxVirtualInputs = 256;
constexpr std::size_t kMaxTraceSamples  = 10000;
constexpr std::size_t kMaxObservations  = 4096;

enum class SimSourceKind : uint8_t {
    VAR_INPUT = 0,
    READ_BINDING = 1,
};

/* Một ô được phép ghi từ ngoài. Danh sách này sinh từ artifact đã seal, không
 * từ yêu cầu của client: allowlist do người gọi cung cấp thì không phải
 * allowlist. */
struct SimInputDescriptor {
    std::string   observation_id;   /* "<Program>.<Variable>" — ổn định theo artifact */
    std::string   program_name;
    std::string   variable;
    SimSourceKind source_kind = SimSourceKind::VAR_INPUT;
    StType        type = StType::REAL;
    std::string   unit;
    bool          has_range = false;
    double        range_min = 0.0;
    double        range_max = 0.0;
};

enum class SimObservationKind : uint8_t {
    INPUT = 0,
    OUTPUT = 1,
};

struct SimObservation {
    std::string        observation_id;
    std::string        program_name;
    std::string        variable;
    SimObservationKind kind = SimObservationKind::OUTPUT;
    StType             type = StType::REAL;
    StValue            value;
    /* GOOD sau một chu kỳ commit thành công; UNAVAILABLE khi chưa có chu kỳ nào
     * hoặc Program chưa từng đến hạn. Không có "0 mặc định": một số 0 không
     * phân biệt được với một số 0 thật là đúng loại lỗi LIVE/SIM phải tránh. */
    bool               has_value = false;
};

struct SimTraceSample {
    uint64_t virtual_time_ms = 0;
    uint64_t snapshot_sequence = 0;
    /* Chỉ số vào bảng observation của phiên, kèm giá trị tại thời điểm commit. */
    std::vector<StValue> values;
};

struct SimProgramState {
    std::string program_name;
    uint32_t    period_ms = 0;
    uint64_t    next_release_ms = 0;
    /* Thứ tự ổn định: đúng thứ tự PROGRAM_TABLE của package đã seal. Không
     * sắp xếp lại theo tên lúc chạy — thứ tự phải do artifact quyết định, để
     * hai lần chạy cùng artifact cho cùng thứ tự bất kể locale hay hash map. */
    uint16_t    order = 0;
    bool        released_once = false;
};

class SimSession {
public:
    /* Tập khoá tin cậy để verify artifact.
     *
     * BẮT BUỘC đặt trước `prepare()` và phải TRÙNG với tập Core đang dùng. Nếu
     * worker chỉ tin khoá nhúng lúc build thì nó từ chối mọi artifact ký bằng
     * khoá THIẾT BỊ — tức mô phỏng không bao giờ chạy được trên một bo thật,
     * và triệu chứng chỉ là `SIM-E-002` ở tận lớp HTTP. */
    void set_loader_options(const StLoaderOptions& options) { loader_options_ = options; }

    /* Nạp package đã seal. Trả false + `*error_code` (SIM-E-*) khi hỏng; khi đó
     * phiên ở trạng thái chưa chuẩn bị và không có tài nguyên nào bị giữ lại. */
    bool prepare(const std::vector<uint8_t>& artifact, uint16_t expected_profile,
                 uint32_t expected_abi, const char** error_code, std::string* detail);

    bool prepared() const { return prepared_; }
    uint32_t base_tick_ms() const { return base_tick_ms_; }
    uint64_t virtual_time_ms() const { return virtual_time_ms_; }
    uint64_t snapshot_sequence() const { return snapshot_sequence_; }
    uint64_t reset_epoch() const { return reset_epoch_; }

    const std::vector<SimInputDescriptor>& inputs() const { return inputs_; }
    const std::vector<SimProgramState>& programs() const { return programs_; }

    /* Ghi một virtual input. Chỉ nhận `observation_id` có trong allowlist, đúng
     * kiểu và trong miền. Từ chối KHÔNG đổi giá trị đã commit trước đó. */
    bool set_input(const std::string& observation_id, const StValue& value,
                   const char** error_code);

    /* Một `STEP_CYCLE`: chụp input một lần, chạy mọi Program đến hạn theo thứ
     * tự ổn định, commit đúng một batch, tăng đồng hồ ảo đúng một base tick rồi
     * dừng. Trả false + `*error_code` khi có runtime fault. */
    bool step(const char** error_code, std::string* detail);

    /* `t=0`, mọi `nextRelease=0`, dựng lại ảnh process từ initializer của
     * artifact, xoá giá trị input đã ghi nhưng GIỮ manifest, tăng resetEpoch.
     * Tuyệt đối không đọc production RETAIN. */
    bool reset(const char** error_code, std::string* detail);

    std::vector<SimObservation> observations() const;
    const std::vector<SimTraceSample>& trace() const { return trace_; }
    std::size_t trace_dropped() const { return trace_dropped_; }

private:
    struct ProgramRuntime {
        std::unique_ptr<StProgramRuntime> runtime;
        std::vector<uint8_t> ir_blob;
    };

    bool activate_all(const char** error_code, std::string* detail);
    void build_manifest();
    void commit_observations();

    bool prepared_ = false;
    uint16_t expected_profile_ = 0;
    uint32_t expected_abi_ = 0;
    std::vector<uint8_t> artifact_;
    StPackageContents contents_;

    std::vector<ProgramRuntime> runtimes_;
    std::vector<SimProgramState> programs_;
    std::vector<SimInputDescriptor> inputs_;
    /* Giá trị input ĐÃ COMMIT, song song 1-1 với `inputs_`. */
    std::vector<StValue> input_values_;
    std::vector<uint8_t> input_written_;

    std::vector<SimObservation> observations_;
    std::vector<SimTraceSample> trace_;
    std::size_t trace_dropped_ = 0;

    StLoaderOptions loader_options_;
    uint32_t base_tick_ms_ = 0;
    uint64_t virtual_time_ms_ = 0;
    uint64_t snapshot_sequence_ = 0;
    uint64_t reset_epoch_ = 0;
};

/* GCD của tập chu kỳ. Trả 0 khi tập rỗng hoặc chứa 0 — caller phải coi đó là
 * `SIM-E-003` chứ không được thay bằng một base tick đoán. */
uint32_t sim_base_tick_ms(const std::vector<uint32_t>& periods_ms);

const char* sim_source_kind_name(SimSourceKind kind);

} // namespace core::programming::sim

#endif /* CORE_PROGRAMMING_SIM_SESSION_HPP */
