#include "st/st_process_image.hpp"

#include <cmath>

namespace core {
namespace {

/* Ánh xạ point kind của artifact sang PointKind của process image.
 * UI/DI là đầu vào vật lý, AO/DO là đầu ra vật lý, AV/BV/MSV là điểm ảo. */
bool map_kind(StPointKind k, PointKind* out)
{
    switch (k) {
    case StPointKind::UI:  *out = PointKind::AI;  return true;
    case StPointKind::DI:  *out = PointKind::BI;  return true;
    case StPointKind::AO:  *out = PointKind::AO;  return true;
    case StPointKind::DO:  *out = PointKind::BO;  return true;
    case StPointKind::AV:  *out = PointKind::AV;  return true;
    case StPointKind::BV:  *out = PointKind::BV;  return true;
    case StPointKind::MSV: *out = PointKind::MSV; return true;
    }
    return false;
}

/* point_index trong artifact là 1-based (khớp `UI-01` trong io_map); PointId
 * dùng chỉ số 0-based. Lệch một đơn vị ở đây là lỗi âm thầm điều khiển nhầm
 * kênh, nên quy đổi tập trung một chỗ. */
bool to_point_id(const StIrIoBinding& b, PointId* out)
{
    PointKind k;
    if (!map_kind(b.point_kind, &k)) return false;
    if (b.point_index == 0) return false;
    out->kind = k;
    out->idx = static_cast<int>(b.point_index) - 1;
    return true;
}

bool write_slot(StLoadedProgram* prog, const StIrIoBinding& b, float value)
{
    StCell& c = prog->slots[b.slot];
    switch (b.type) {
    case StType::BOOL: c.b = (value != 0.0f); return true;
    case StType::INT:
    case StType::DINT:
    case StType::UINT: {
        const float rounded = std::round(value);
        if (rounded < static_cast<float>(st_integer_min(b.type)) ||
            rounded > static_cast<float>(st_integer_max(b.type)))
            return false;
        c.i = static_cast<int32_t>(rounded);
        return true;
    }
    case StType::REAL: c.r = value; return true;
    case StType::TIME:
        if (value < 0.0f || static_cast<double>(value) * 1e9 > 9.2e18) return false;
        c.t = static_cast<int64_t>(static_cast<double>(value) * 1e9);
        return true;
    }
    return false;
}

bool read_slot(const StLoadedProgram& prog, const StIrIoBinding& b, float* out)
{
    const StCell& c = prog.slots[b.slot];
    switch (b.type) {
    case StType::BOOL: *out = c.b ? 1.0f : 0.0f; return true;
    case StType::DINT:
    case StType::INT:  *out = static_cast<float>(c.i); return true;
    case StType::UINT: *out = static_cast<float>(c.i); return true;
    case StType::REAL: *out = c.r; return std::isfinite(c.r);
    case StType::TIME: *out = static_cast<float>(static_cast<double>(c.t) / 1e9); return true;
    }
    return false;
}

} // namespace

void st_load_inputs(StProgramInstance* inst, const PointTable& table, StIoBridgeStats* stats)
{
    StLoadedProgram* prog = const_cast<StLoadedProgram*>(inst->runtime.program());
    if (!prog) return;

    for (const StIrIoBinding& b : prog->io_bindings) {
        if (b.is_output) continue;
        PointId id{};
        if (!to_point_id(b, &id)) { if (stats) stats->bindings_unmapped++; continue; }
        const Point p = table.get(id);
        /* Đầu vào không hữu hạn bị chặn TẠI BIÊN: để nó lọt vào chương trình
         * thì NaN sẽ lan tới đầu ra analog và biến thành lệnh vật lý vô nghĩa.
         * Giữ giá trị slot cũ và đếm — chu kỳ vẫn chạy với giá trị cuối biết
         * là hợp lệ, đúng tinh thần ST_SUBSET_SPEC §6.3. */
        if (!std::isfinite(p.value)) { if (stats) stats->outputs_rejected++; continue; }
        if (!write_slot(prog, b, p.value)) {
            if (stats) stats->outputs_rejected++;
            continue;
        }
        if (stats) stats->inputs_loaded++;
    }
}

void st_apply_outputs(const StProgramInstance& inst, PriorityResolver* resolver, PointTable* table,
                      StIoBridgeStats* stats)
{
    const StLoadedProgram* prog = inst.runtime.program();
    if (!prog || !resolver) return;

    for (const StIrIoBinding& b : prog->io_bindings) {
        if (!b.is_output) continue;
        PointId id{};
        if (!to_point_id(b, &id)) { if (stats) stats->bindings_unmapped++; continue; }

        float v = 0.0f;
        if (!read_slot(*prog, b, &v) || !std::isfinite(v)) {
            if (stats) stats->outputs_rejected++;
            continue;
        }

        bool ok = false;
        switch (id.kind) {
        case PointKind::AO:
            /* Đi qua PriorityResolver ở mức PRIO_LOCAL_LOGIC — KHÔNG ghi thẳng
             * ra OutputCmd. Đây là điều làm cho "chương trình ST không thể vượt
             * mặt manual/BACnet/safety" thành bất biến cấu trúc. */
            ok = resolver->set_ao(PRIO_LOCAL_LOGIC, id.idx, v);
            break;
        case PointKind::BO:
            ok = resolver->set_do(PRIO_LOCAL_LOGIC, id.idx, v != 0.0f);
            break;
        default:
            /* Điểm ảo (AV/BV/MSV) không có tranh chấp vật lý — ghi thẳng bảng
             * điểm với nguồn GRAPH. */
            ok = table && table->set_virtual(id, v, PointSource::GRAPH);
            break;
        }
        if (ok) { if (stats) stats->outputs_applied++; }
        else    { if (stats) stats->outputs_rejected++; }
    }
}

void st_load_all_inputs(StScheduler* sched, const PointTable& table, StIoBridgeStats* stats)
{
    if (!sched) return;
    for (auto& t : sched->tasks())
        for (auto& p : t->programs())
            if (p->state == StProgramState::RUNNING && p->runtime.loaded())
                st_load_inputs(p.get(), table, stats);
}

void st_apply_all_outputs(StScheduler* sched, PriorityResolver* resolver, PointTable* table,
                          StIoBridgeStats* stats)
{
    if (!sched) return;
    for (auto& t : sched->tasks())
        for (auto& p : t->programs())
            /* Chỉ instance còn RUNNING mới đẩy đầu ra: instance vừa FAULTED
             * trong tick này đã bị StProgramRuntime khôi phục trạng thái, và
             * đẩy giá trị của nó ra trọng tài là đẩy dữ liệu của chu kỳ TRƯỚC
             * như thể vừa tính xong — sai lệch âm thầm. */
            if (p->state == StProgramState::RUNNING && p->runtime.loaded())
                st_apply_outputs(*p, resolver, table, stats);
}

} // namespace core
