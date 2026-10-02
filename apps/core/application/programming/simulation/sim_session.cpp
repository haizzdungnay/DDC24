#include "programming/simulation/sim_session.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

#include "programming/simulation/sim_error.hpp"
#include "st/st_profile_generated.hpp"

namespace core::programming::sim {

namespace {

/* `now_ns` mà executor nhận là đồng hồ ẢO của phiên, không phải đồng hồ hệ
 * thống. Đây là điểm khiến toàn bộ phiên tất định: cùng artifact + cùng chuỗi
 * input + cùng số bước ⇒ cùng chuỗi `now_ns` ⇒ cùng kết quả, bất kể máy chạy
 * nhanh chậm ra sao hay speed factor là 1×, 10× hay 60×. */
int64_t virtual_now_ns(uint64_t virtual_time_ms)
{
    return static_cast<int64_t>(virtual_time_ms) * 1000000;
}

bool value_is_finite(const StValue& value)
{
    if (value.type != StType::REAL) return true;
    return std::isfinite(value.r);
}

double numeric_of(const StValue& value)
{
    switch (value.type) {
    case StType::BOOL: return value.b ? 1.0 : 0.0;
    case StType::REAL: return static_cast<double>(value.r);
    case StType::TIME: return static_cast<double>(value.t);
    case StType::INT:
    case StType::DINT:
    case StType::UINT: return static_cast<double>(value.i);
    }
    return 0.0;
}

} // namespace

uint32_t sim_base_tick_ms(const std::vector<uint32_t>& periods_ms)
{
    uint32_t accumulator = 0;
    for (uint32_t period : periods_ms) {
        if (period == 0) return 0;
        accumulator = std::gcd(accumulator, period);
    }
    return accumulator;
}

const char* sim_source_kind_name(SimSourceKind kind)
{
    return kind == SimSourceKind::READ_BINDING ? "READ_BINDING" : "VAR_INPUT";
}

bool SimSession::prepare(const std::vector<uint8_t>& artifact, uint16_t expected_profile,
                         uint32_t expected_abi, const char** error_code, std::string* detail)
{
    prepared_ = false;
    runtimes_.clear();
    programs_.clear();
    inputs_.clear();
    input_values_.clear();
    input_written_.clear();
    observations_.clear();
    trace_.clear();
    trace_dropped_ = 0;

    const char* load_error = nullptr;
    StPackageContents contents;
    if (!UnpackPackageV2(artifact.data(), artifact.size(), expected_profile, expected_abi,
                         &contents, &load_error)) {
        if (error_code) *error_code = kErrArtifact;
        if (detail) *detail = load_error != nullptr ? load_error : "PKG-E-001";
        return false;
    }

    /* Chu kỳ phải đến TỪ artifact. Package v2 legacy có thể mang 0; khi đó
     * không có base tick đúng nào để chọn, và đoán một giá trị nghĩa là bịa ra
     * một lịch chạy khác với lịch trên tủ. */
    const std::vector<uint32_t>& periods = contents.view.program_periods_ms;
    if (periods.empty()) {
        if (error_code) *error_code = kErrNoSchedule;
        if (detail) *detail = "package không khai Program nào";
        return false;
    }
    const uint32_t base_tick = sim_base_tick_ms(periods);
    if (base_tick == 0) {
        if (error_code) *error_code = kErrNoSchedule;
        if (detail) *detail = "package khai chu kỳ 0 — không tính được base tick";
        return false;
    }

    artifact_ = artifact;
    contents_ = std::move(contents);
    expected_profile_ = expected_profile;
    expected_abi_ = expected_abi;
    base_tick_ms_ = base_tick;
    virtual_time_ms_ = 0;
    snapshot_sequence_ = 0;
    reset_epoch_ = 0;

    if (!activate_all(error_code, detail)) return false;
    build_manifest();
    if (inputs_.size() > kMaxVirtualInputs) {
        if (error_code) *error_code = kErrLimit;
        if (detail) *detail = "vượt trần virtual input";
        runtimes_.clear();
        programs_.clear();
        inputs_.clear();
        return false;
    }
    commit_observations();
    prepared_ = true;
    return true;
}

bool SimSession::activate_all(const char** error_code, std::string* detail)
{
    runtimes_.clear();
    programs_.clear();

    const std::size_t count = contents_.view.program_names.size();
    for (std::size_t index = 0; index < count; ++index) {
        ProgramRuntime entry;
        entry.ir_blob = contents_.program_ir[index];
        entry.runtime = std::make_unique<StProgramRuntime>();

        StLoadError load_error;
        if (!entry.runtime->activate(entry.ir_blob.data(), entry.ir_blob.size(), &load_error,
                                     &loader_options_)) {
            if (error_code) *error_code = kErrArtifact;
            if (detail) {
                *detail = load_error.code.empty() ? std::string("IR-E-001") : load_error.code;
            }
            runtimes_.clear();
            programs_.clear();
            return false;
        }

        SimProgramState state;
        state.program_name = contents_.view.program_names[index];
        state.period_ms = contents_.view.program_periods_ms[index];
        state.next_release_ms = 0;
        state.order = static_cast<uint16_t>(index);
        state.released_once = false;

        runtimes_.push_back(std::move(entry));
        programs_.push_back(std::move(state));
    }
    return true;
}

void SimSession::build_manifest()
{
    inputs_.clear();
    observations_.clear();

    for (std::size_t index = 0; index < runtimes_.size(); ++index) {
        const StLoadedProgram* program = runtimes_[index].runtime->program();
        if (program == nullptr) continue;
        const std::string& program_name = programs_[index].program_name;

        /* Binding READ tra theo slot: một biến vừa là `VAR_INPUT` vừa có
         * binding đọc thì nguồn của nó là binding, và miền scale của binding là
         * miền hợp lệ. Binding GHI (`is_output`) không bao giờ vào allowlist —
         * đó đúng là cạnh mà sandbox tồn tại để cắt. */
        for (const StIrVariable& variable : program->variables) {
            const StIrIoBinding* binding = nullptr;
            for (const StIrIoBinding& candidate : program->io_bindings) {
                if (candidate.slot == variable.slot) { binding = &candidate; break; }
            }

            const bool writable_source =
                variable.storage == StStorage::VAR_INPUT ||
                (binding != nullptr && !binding->is_output);
            const bool denied_source =
                variable.storage == StStorage::VAR_OUTPUT ||
                variable.storage == StStorage::VAR_RETAIN ||
                variable.storage == StStorage::VAR_LOCAL ||
                (binding != nullptr && binding->is_output);

            const std::string observation_id = program_name + "." + variable.name;

            if (writable_source && !denied_source) {
                SimInputDescriptor descriptor;
                descriptor.observation_id = observation_id;
                descriptor.program_name = program_name;
                descriptor.variable = variable.name;
                descriptor.source_kind = (binding != nullptr && !binding->is_output)
                                             ? SimSourceKind::READ_BINDING
                                             : SimSourceKind::VAR_INPUT;
                descriptor.type = variable.type;
                if (binding != nullptr && binding->scale_max > binding->scale_min) {
                    descriptor.has_range = true;
                    descriptor.range_min = static_cast<double>(binding->scale_min);
                    descriptor.range_max = static_cast<double>(binding->scale_max);
                }
                inputs_.push_back(std::move(descriptor));
            }

            if ((variable.storage == StStorage::VAR_INPUT ||
                 variable.storage == StStorage::VAR_OUTPUT ||
                 variable.storage == StStorage::VAR_LOCAL ||
                 variable.storage == StStorage::VAR_RETAIN) &&
                variable.name.rfind("__", 0) != 0) {
                SimObservation observation;
                observation.observation_id = observation_id;
                observation.program_name = program_name;
                observation.variable = variable.name;
                observation.kind = variable.storage == StStorage::VAR_OUTPUT
                                       ? SimObservationKind::OUTPUT
                                       : SimObservationKind::INPUT;
                observation.type = variable.type;
                observation.has_value = false;
                if (observations_.size() < kMaxObservations) {
                    observations_.push_back(std::move(observation));
                }
            }
        }
    }

    input_values_.assign(inputs_.size(), StValue{});
    input_written_.assign(inputs_.size(), 0);
    for (std::size_t index = 0; index < inputs_.size(); ++index) {
        input_values_[index].type = inputs_[index].type;
    }
}

bool SimSession::set_input(const std::string& observation_id, const StValue& value,
                           const char** error_code)
{
    if (!prepared_) {
        if (error_code) *error_code = kErrCommandState;
        return false;
    }
    std::size_t found = inputs_.size();
    for (std::size_t index = 0; index < inputs_.size(); ++index) {
        if (inputs_[index].observation_id == observation_id) { found = index; break; }
    }
    if (found == inputs_.size()) {
        if (error_code) *error_code = kErrInputUnknown;
        return false;
    }
    const SimInputDescriptor& descriptor = inputs_[found];
    if (value.type != descriptor.type) {
        if (error_code) *error_code = kErrInputValue;
        return false;
    }
    if (!value_is_finite(value)) {
        if (error_code) *error_code = kErrInputValue;
        return false;
    }
    if (descriptor.has_range) {
        const double numeric = numeric_of(value);
        if (numeric < descriptor.range_min || numeric > descriptor.range_max) {
            if (error_code) *error_code = kErrInputValue;
            return false;
        }
    }
    /* Chỉ commit sau khi mọi phép kiểm đã qua: một input bị từ chối phải để lại
     * giá trị trước đó y nguyên, không phải một giá trị nửa vời. */
    input_values_[found] = value;
    input_written_[found] = 1;
    return true;
}

bool SimSession::step(const char** error_code, std::string* detail)
{
    if (!prepared_) {
        if (error_code) *error_code = kErrCommandState;
        return false;
    }

    /* (1) Chụp input ĐÚNG MỘT LẦN cho cả tick. Nếu chụp lại giữa các Program
     * thì hai Program đến hạn cùng tick có thể thấy hai giá trị khác nhau của
     * cùng một biến — mất tất định mà không có dấu hiệu nào bên ngoài. */
    const std::vector<StValue> input_snapshot = input_values_;
    const std::vector<uint8_t> written_snapshot = input_written_;

    const int64_t now_ns = virtual_now_ns(virtual_time_ms_);

    for (std::size_t index = 0; index < programs_.size(); ++index) {
        SimProgramState& state = programs_[index];
        if (state.next_release_ms > virtual_time_ms_) continue;

        StProgramRuntime& runtime = *runtimes_[index].runtime;
        for (std::size_t slot = 0; slot < inputs_.size(); ++slot) {
            if (written_snapshot[slot] == 0) continue;
            if (inputs_[slot].program_name != state.program_name) continue;
            runtime.set_variable(inputs_[slot].variable, input_snapshot[slot]);
        }

        const StExecResult result = runtime.execute(now_ns);
        if (!result.ok && !result.waiting) {
            if (error_code) *error_code = kErrExecFault;
            if (detail) {
                *detail = result.fault_code != nullptr ? result.fault_code
                        : (result.error != nullptr ? result.error : "ST-RT-000");
            }
            return false;
        }

        /* Timer của Program chỉ tiến khi chính Program đó release: `next_release`
         * cộng đúng một period, không bám theo đồng hồ. Nhờ vậy Program 5 s chỉ
         * thấy `now_ns` nhảy 5 s một lần, đúng như trên tủ. */
        state.next_release_ms += state.period_ms;
        state.released_once = true;
    }

    commit_observations();

    if (trace_.size() < kMaxTraceSamples) {
        SimTraceSample sample;
        sample.virtual_time_ms = virtual_time_ms_;
        sample.snapshot_sequence = snapshot_sequence_ + 1;
        sample.values.reserve(observations_.size());
        for (const SimObservation& observation : observations_) {
            sample.values.push_back(observation.value);
        }
        trace_.push_back(std::move(sample));
    } else {
        /* Đầy thì DỪNG ghi và đếm, không cuộn vòng im lặng: một trace bị cuộn
         * trông y hệt một trace đầy đủ, và người đọc sẽ kết luận sai về đoạn
         * đầu phiên. */
        ++trace_dropped_;
    }

    virtual_time_ms_ += base_tick_ms_;
    ++snapshot_sequence_;
    return true;
}

void SimSession::commit_observations()
{
    for (SimObservation& observation : observations_) {
        for (std::size_t index = 0; index < programs_.size(); ++index) {
            if (programs_[index].program_name != observation.program_name) continue;
            if (!programs_[index].released_once) break;
            StValue value;
            if (runtimes_[index].runtime->get_variable(observation.variable, &value)) {
                observation.value = value;
                observation.has_value = true;
            }
            break;
        }
    }
}

bool SimSession::reset(const char** error_code, std::string* detail)
{
    if (!prepared_) {
        if (error_code) *error_code = kErrCommandState;
        return false;
    }
    /* Dựng lại ảnh process từ chính artifact đã seal. Không có đường nào đọc
     * RETAIN production ở đây, và cũng không có đường nào giữ lại state của
     * lần chạy trước: reset mà còn nhớ là reset dối. */
    if (!activate_all(error_code, detail)) {
        prepared_ = false;
        return false;
    }
    const std::vector<SimInputDescriptor> manifest = inputs_;
    build_manifest();
    inputs_ = manifest;
    input_values_.assign(inputs_.size(), StValue{});
    input_written_.assign(inputs_.size(), 0);
    for (std::size_t index = 0; index < inputs_.size(); ++index) {
        input_values_[index].type = inputs_[index].type;
    }

    virtual_time_ms_ = 0;
    snapshot_sequence_ = 0;
    ++reset_epoch_;
    trace_.clear();
    trace_dropped_ = 0;
    commit_observations();
    return true;
}

std::vector<SimObservation> SimSession::observations() const
{
    return observations_;
}

} // namespace core::programming::sim
