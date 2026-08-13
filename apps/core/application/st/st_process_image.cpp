#include "st/st_process_image.hpp"

#include <array>
#include <cmath>

namespace core {
namespace {

bool map_kind(StPointKind kind, PointKind* out)
{
    switch (kind) {
    case StPointKind::UI:  *out = PointKind::AI;  return true;
    case StPointKind::DI:  *out = PointKind::BI;  return true;
    case StPointKind::AO:  *out = PointKind::AO;  return true;
    case StPointKind::DO:  *out = PointKind::BO;  return true;
    case StPointKind::AV:  *out = PointKind::AV;  return true;
    case StPointKind::BV:  *out = PointKind::BV;  return true;
    case StPointKind::MSV: *out = PointKind::MSV; return true;
    case StPointKind::EXT: *out = PointKind::EXT; return true;
    }
    return false;
}

/* Artifact dùng index 1-based; PointTable dùng 0-based. */
bool to_point_id(const StIrIoBinding& binding, PointId* out)
{
    PointKind kind;
    if (!out || !map_kind(binding.point_kind, &kind) || binding.point_index == 0)
        return false;
    const PointId id{kind, static_cast<int>(binding.point_index) - 1};
    if (!PointTable::valid(id)) return false;
    *out = id;
    return true;
}

bool in_declared_range(const StIrIoBinding& binding, float value)
{
    const bool has_range = binding.scale_min != 0.0f || binding.scale_max != 0.0f;
    return !has_range || (std::isfinite(binding.scale_min) &&
                          std::isfinite(binding.scale_max) &&
                          value >= binding.scale_min && value <= binding.scale_max);
}

bool to_cell(const StIrIoBinding& binding, float value, StCell* out)
{
    if (!out || !std::isfinite(value)) return false;
    switch (binding.type) {
    case StType::BOOL:
        if (value != 0.0f && value != 1.0f) return false;
        out->b = value == 1.0f;
        return true;
    case StType::INT:
    case StType::DINT:
    case StType::UINT: {
        if (std::trunc(value) != value ||
            value < static_cast<float>(st_integer_min(binding.type)) ||
            value > static_cast<float>(st_integer_max(binding.type)))
            return false;
        out->i = static_cast<int32_t>(value);
        return true;
    }
    case StType::REAL:
        out->r = value;
        return true;
    case StType::TIME:
        if (value < 0.0f || static_cast<double>(value) * 1e9 > 9.2e18) return false;
        out->t = static_cast<int64_t>(static_cast<double>(value) * 1e9);
        return true;
    }
    return false;
}

bool from_cell(const StLoadedProgram& program, const StIrIoBinding& binding, float* out)
{
    if (!out || binding.slot >= program.slots.size()) return false;
    const StCell& cell = program.slots[binding.slot];
    switch (binding.type) {
    case StType::BOOL: *out = cell.b ? 1.0f : 0.0f; return true;
    case StType::DINT:
    case StType::INT:
    case StType::UINT: *out = static_cast<float>(cell.i); return true;
    case StType::REAL: *out = cell.r; return std::isfinite(cell.r);
    case StType::TIME:
        *out = static_cast<float>(static_cast<double>(cell.t) / 1e9);
        return std::isfinite(*out);
    }
    return false;
}

struct OutputProposal {
    PointId id{PointKind::AV, -1};
    float value = 0.0f;
};

bool same_point(PointId left, PointId right)
{
    return left.kind == right.kind && left.idx == right.idx;
}

bool stage_instance_outputs(const StProgramInstance& instance,
                            std::array<OutputProposal, st_ir::kMaxIoBindings>* proposals,
                            std::size_t* count, StIoBridgeStats* stats)
{
    const StLoadedProgram* program = instance.runtime.program();
    if (!program) return true;

    for (const StIrIoBinding& binding : program->io_bindings) {
        if (!binding.is_output) continue;
        if (*count >= proposals->size()) {
            if (stats) stats->outputs_rejected++;
            return false;
        }
        PointId id{};
        if (!to_point_id(binding, &id)) {
            if (stats) stats->bindings_unmapped++;
            return false;
        }
        float value = 0.0f;
        if (!from_cell(*program, binding, &value) || !in_declared_range(binding, value)) {
            if (stats) stats->outputs_rejected++;
            return false;
        }
        for (std::size_t i = 0; i < *count; ++i) {
            if (same_point((*proposals)[i].id, id)) {
                if (stats) stats->outputs_rejected++;
                return false;
            }
        }
        (*proposals)[(*count)++] = OutputProposal{id, value};
    }
    return true;
}

bool preflight_outputs(const std::array<OutputProposal, st_ir::kMaxIoBindings>& proposals,
                       std::size_t count, const PriorityResolver* resolver,
                       const PointWriter* writer, StIoBridgeStats* stats)
{
    for (std::size_t i = 0; i < count; ++i) {
        const OutputProposal& proposal = proposals[i];
        bool valid = false;
        switch (proposal.id.kind) {
        case PointKind::AO:
            valid = resolver &&
                    resolver->can_set_ao(PRIO_LOCAL_LOGIC, proposal.id.idx, proposal.value);
            break;
        case PointKind::BO:
            valid = resolver && resolver->can_set_do(PRIO_LOCAL_LOGIC, proposal.id.idx);
            break;
        default:
            valid = writer && writer->can_write(proposal.id, proposal.value);
            break;
        }
        if (!valid) {
            if (stats) stats->outputs_rejected++;
            return false;
        }
    }
    return true;
}

bool commit_outputs(const std::array<OutputProposal, st_ir::kMaxIoBindings>& proposals,
                    std::size_t count, PriorityResolver* resolver, PointWriter* writer,
                    StIoBridgeStats* stats)
{
    /* Sau preflight, các phép ghi dưới đây không còn nhánh lỗi phụ thuộc state:
     * ScanLoop là writer duy nhất. Vì vậy toàn batch hoặc không ghi gì, không
     * cần heap/mutex/copy toàn bộ SHM trong đường RT. */
    for (std::size_t i = 0; i < count; ++i) {
        const OutputProposal& proposal = proposals[i];
        bool ok = false;
        switch (proposal.id.kind) {
        case PointKind::AO:
            ok = resolver->set_ao(PRIO_LOCAL_LOGIC, proposal.id.idx, proposal.value);
            break;
        case PointKind::BO:
            ok = resolver->set_do(PRIO_LOCAL_LOGIC, proposal.id.idx, proposal.value != 0.0f);
            break;
        default:
            ok = writer->write(proposal.id, proposal.value, PointSource::PROGRAM);
            break;
        }
        if (!ok) {
            /* Chỉ có thể xảy ra nếu invariant single-writer/preflight bị phá.
             * Ghi nhận lỗi; test allocation/concurrency khóa đường bình thường. */
            if (stats) stats->outputs_rejected++;
            return false;
        }
        if (stats) stats->outputs_applied++;
    }
    return true;
}

} // namespace

bool st_load_inputs(StProgramInstance* instance, const PointTable& table, uint64_t generation,
                    StIoBridgeStats* stats)
{
    if (!instance) return false;
    StLoadedProgram* program = const_cast<StLoadedProgram*>(instance->runtime.program());
    if (!program) return false;

    instance->process_input_count = 0;
    instance->input_snapshot_generation = generation;
    instance->input_snapshot_valid = false;

    for (const StIrIoBinding& binding : program->io_bindings) {
        if (binding.is_output) continue;
        if (instance->process_input_count >= instance->process_inputs.size()) {
            if (stats) {
                stats->inputs_rejected++;
                stats->input_batches_rejected++;
            }
            return false;
        }

        StProcessInputSlot& captured =
            instance->process_inputs[instance->process_input_count++];
        captured.slot = binding.slot;
        captured.point_kind = binding.point_kind;
        captured.point_index = binding.point_index;

        PointId id{};
        if (!to_point_id(binding, &id)) {
            if (stats) {
                stats->bindings_unmapped++;
                stats->input_batches_rejected++;
            }
            return false;
        }
        const Point point = table.get(id);
        captured.quality = static_cast<uint8_t>(point.quality);
        captured.source = static_cast<uint8_t>(point.source);
        captured.observed_at_ns = point.ts_ns;

        /* Artifact schema 1 chưa mang policy tùy chọn; Rev A mặc định
         * REQUIRE_GOOD. UNCERTAIN/BAD/STALE/OFFLINE/CONFIG_ERROR không được
         * lặng lẽ biến thành zero hoặc tái sử dụng slot cũ. */
        if (point.quality != KX_Q_GOOD || !std::isfinite(point.value) ||
            !in_declared_range(binding, point.value) ||
            !to_cell(binding, point.value, &captured.cell)) {
            if (stats) {
                stats->inputs_rejected++;
                stats->input_batches_rejected++;
            }
            return false;
        }
    }

    /* Chỉ sau khi mọi binding đã hợp lệ mới sửa runtime slots. */
    for (uint16_t i = 0; i < instance->process_input_count; ++i) {
        const StProcessInputSlot& captured = instance->process_inputs[i];
        if (captured.slot >= program->slots.size()) {
            if (stats) {
                stats->bindings_unmapped++;
                stats->input_batches_rejected++;
            }
            return false;
        }
        program->slots[captured.slot] = captured.cell;
    }

    instance->input_snapshot_valid = true;
    if (stats) {
        stats->inputs_loaded += instance->process_input_count;
        stats->input_batches_committed++;
        stats->input_snapshot_generation = generation;
    }
    return true;
}

bool st_load_inputs(StProgramInstance* instance, const PointTable& table,
                    StIoBridgeStats* stats)
{
    return st_load_inputs(instance, table, 0, stats);
}

bool st_capture_due_inputs(StScheduler* scheduler, const PointTable& table, uint64_t now_ns,
                           StIoBridgeStats* stats)
{
    if (!scheduler) return false;
    const uint64_t generation = scheduler->base_step_count() + 1;
    bool all_valid = true;
    for (auto& task : scheduler->tasks()) {
        if (!task->enabled() || !task->due(now_ns)) continue;
        for (auto& program : task->programs()) {
            if (program->state != StProgramState::RUNNING || !program->runtime.loaded()) continue;
            if (!st_load_inputs(program.get(), table, generation, stats)) all_valid = false;
        }
    }
    return all_valid;
}

bool st_load_all_inputs(StScheduler* scheduler, const PointTable& table, StIoBridgeStats* stats)
{
    if (!scheduler) return false;
    const uint64_t generation = scheduler->base_step_count() + 1;
    bool all_valid = true;
    for (auto& task : scheduler->tasks()) {
        for (auto& program : task->programs()) {
            if (program->state != StProgramState::RUNNING || !program->runtime.loaded()) continue;
            if (!st_load_inputs(program.get(), table, generation, stats)) all_valid = false;
        }
    }
    return all_valid;
}

bool st_apply_outputs(const StProgramInstance& instance, PriorityResolver* resolver,
                      PointWriter* writer, uint64_t generation, StIoBridgeStats* stats)
{
    std::array<OutputProposal, st_ir::kMaxIoBindings> proposals{};
    std::size_t count = 0;
    if (!stage_instance_outputs(instance, &proposals, &count, stats) ||
        !preflight_outputs(proposals, count, resolver, writer, stats)) {
        if (stats) stats->output_batches_rejected++;
        return false;
    }
    if (!commit_outputs(proposals, count, resolver, writer, stats)) {
        if (stats) stats->output_batches_rejected++;
        return false;
    }
    StProgramInstance& mutable_instance = const_cast<StProgramInstance&>(instance);
    mutable_instance.output_commit_generation = generation;
    if (stats) {
        stats->output_batches_committed++;
        stats->output_commit_generation = generation;
    }
    return true;
}

bool st_apply_outputs(const StProgramInstance& instance, PriorityResolver* resolver,
                      PointTable* table, StIoBridgeStats* stats)
{
    if (!table) return false;
    PointWriter writer(*table, nullptr);
    return st_apply_outputs(instance, resolver, &writer,
                            instance.last_successful_base_step, stats);
}

bool st_apply_all_outputs(StScheduler* scheduler, PriorityResolver* resolver,
                          PointWriter* writer, StIoBridgeStats* stats)
{
    if (!scheduler) return false;
    const uint64_t generation = scheduler->base_step_count();
    std::array<OutputProposal, st_ir::kMaxIoBindings> proposals{};
    std::size_t count = 0;
    bool has_successful_program = false;

    for (auto& task : scheduler->tasks()) {
        for (auto& program : task->programs()) {
            if (program->state != StProgramState::RUNNING || !program->runtime.loaded() ||
                program->last_successful_base_step != generation)
                continue;
            has_successful_program = true;
            if (!stage_instance_outputs(*program, &proposals, &count, stats)) {
                if (stats) stats->output_batches_rejected++;
                return false;
            }
        }
    }

    /* Không Task nào chạy ở base-step này: không được trình bày lại output cũ
     * như một commit mới, đặc biệt với Task 5/30 s trên base step 1 s. */
    if (!has_successful_program) return true;

    if (!preflight_outputs(proposals, count, resolver, writer, stats)) {
        if (stats) stats->output_batches_rejected++;
        return false;
    }
    if (!commit_outputs(proposals, count, resolver, writer, stats)) {
        if (stats) stats->output_batches_rejected++;
        return false;
    }

    for (auto& task : scheduler->tasks()) {
        for (auto& program : task->programs()) {
            if (program->last_successful_base_step == generation) {
                program->output_commit_generation = generation;
                /* Vừa tái xác nhận claim mức PRIO_LOCAL_LOGIC — mở lại cơ hội
                 * rút khi instance này ngừng publish lần sau (TASK-PROG-401). */
                program->outputs_withdrawn = false;
            }
        }
    }
    if (stats) {
        stats->output_batches_committed++;
        stats->output_commit_generation = generation;
    }
    return true;
}

bool st_apply_all_outputs(StScheduler* scheduler, PriorityResolver* resolver, PointTable* table,
                          StIoBridgeStats* stats)
{
    if (!table) return false;
    PointWriter writer(*table, nullptr);
    return st_apply_all_outputs(scheduler, resolver, &writer, stats);
}

bool st_withdraw_instance_outputs(const StProgramInstance& instance, PriorityResolver* resolver)
{
    if (!resolver) return false;
    const StLoadedProgram* program = instance.runtime.program();
    if (!program) return true; /* chưa từng load: không có claim nào để rút */

    for (const StIrIoBinding& binding : program->io_bindings) {
        if (!binding.is_output) continue;
        PointId id{};
        if (!to_point_id(binding, &id)) continue; /* binding hỏng: không có claim */
        switch (id.kind) {
        case PointKind::AO: resolver->release_ao(PRIO_LOCAL_LOGIC, id.idx); break;
        case PointKind::BO: resolver->release_do(PRIO_LOCAL_LOGIC, id.idx); break;
        default: break; /* AV/BV/MSV/EXT không qua PriorityResolver (§6) */
        }
    }
    return true;
}

uint32_t st_withdraw_stale_outputs(StScheduler* scheduler, PriorityResolver* resolver,
                                   uint64_t hold_ttl_base_steps, StIoBridgeStats* stats)
{
    if (!scheduler || !resolver) return 0;
    const uint64_t generation = scheduler->base_step_count();
    uint32_t withdrawn = 0;

    for (auto& task : scheduler->tasks()) {
        for (auto& program : task->programs()) {
            StProgramInstance& p = *program;
            if (p.outputs_withdrawn) continue;

            bool should_withdraw = false;
            if (p.state == StProgramState::STOPPED || p.state == StProgramState::DISABLED) {
                /* Lệnh operator: rút NGAY tại safe boundary, không chờ TTL. */
                should_withdraw = true;
            } else if (p.state == StProgramState::FAULTED && hold_ttl_base_steps > 0 &&
                      generation >= p.output_commit_generation + hold_ttl_base_steps) {
                should_withdraw = true;
            }
            if (!should_withdraw) continue;

            if (st_withdraw_instance_outputs(p, resolver)) {
                p.outputs_withdrawn = true;
                withdrawn++;
            }
        }
    }
    if (stats) stats->outputs_withdrawn += withdrawn;
    return withdrawn;
}

} // namespace core
