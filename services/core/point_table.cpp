#include "point_table.hpp"

#include <ctime>

namespace core {

static uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

bool PointTable::valid(PointId id)
{
    switch (id.kind) {
    case PointKind::AI:  return id.idx >= 0 && id.idx < KX_N_UI;
    case PointKind::BI:  return id.idx >= 0 && id.idx < KX_N_DI;
    case PointKind::AO:  return id.idx >= 0 && id.idx < KX_N_AO;
    case PointKind::BO:  return id.idx >= 0 && id.idx < KX_N_DO;
    case PointKind::AV:  return id.idx >= 0 && id.idx < KX_N_AV;
    case PointKind::BV:  return id.idx >= 0 && id.idx < KX_N_BV;
    case PointKind::MSV: return id.idx >= 0 && id.idx < KX_N_MSV;
    }
    return false;
}

Point* PointTable::slot(PointId id)
{
    if (!valid(id)) return nullptr;
    switch (id.kind) {
    case PointKind::AI:  return &ai_[id.idx];
    case PointKind::BI:  return &bi_[id.idx];
    case PointKind::AO:  return &ao_[id.idx];
    case PointKind::BO:  return &bo_[id.idx];
    case PointKind::AV:  return &av_[id.idx];
    case PointKind::BV:  return &bv_[id.idx];
    case PointKind::MSV: return &msv_[id.idx];
    }
    return nullptr;
}

const Point* PointTable::slot(PointId id) const
{
    return const_cast<PointTable*>(this)->slot(id);
}

void PointTable::update_inputs(const IoSnapshot& io)
{
    const uint64_t t = now_ns();
    for (int i = 0; i < KX_N_UI; i++) {
        ai_[i].value   = io.ui_value[i];
        ai_[i].quality = static_cast<kx_quality_t>(io.ui_quality[i]);
        ai_[i].ts_ns   = t;
        ai_[i].source  = PointSource::IO;
    }
    for (int i = 0; i < KX_N_DI; i++) {
        bi_[i].value   = io.di_state[i] ? 1.0f : 0.0f;
        bi_[i].quality = KX_Q_GOOD;   /* point_quality ghi đè theo iop_status/stale */
        bi_[i].ts_ns   = t;
        bi_[i].source  = PointSource::IO;
    }
    for (int i = 0; i < KX_N_AO; i++) {
        ao_[i].value   = io.ao_setpoint[i];   /* feedback qua setpoint đã ghi (07 §3) */
        ao_[i].quality = KX_Q_GOOD;
        ao_[i].ts_ns   = t;
        ao_[i].source  = PointSource::IO;
    }
    for (int i = 0; i < KX_N_DO; i++) {
        bo_[i].value   = io.do_feedback[i] ? 1.0f : 0.0f;
        bo_[i].quality = KX_Q_GOOD;
        bo_[i].ts_ns   = t;
        bo_[i].source  = PointSource::IO;
    }
}

Point PointTable::get(PointId id) const
{
    const Point* p = slot(id);
    return p ? *p : Point{};
}

bool PointTable::set_virtual(PointId id, float v, PointSource src)
{
    if (id.kind != PointKind::AV && id.kind != PointKind::BV && id.kind != PointKind::MSV)
        return false;   /* AO/BO/AI/BI không có đường ghi trực tiếp */
    Point* p = slot(id);
    if (!p) return false;
    p->value   = v;
    p->quality = KX_Q_GOOD;
    p->ts_ns   = now_ns();
    p->source  = src;
    return true;
}

void PointTable::set_quality(PointId id, kx_quality_t q)
{
    Point* p = slot(id);
    if (p) p->quality = q;
}

} // namespace core
