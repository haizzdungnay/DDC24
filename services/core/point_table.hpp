/**
 * @file  point_table.hpp
 * @brief 24 IO + virtual point (07 §3): {value, quality, ts, source}.
 *        KHÔNG có set() cho AO/BO — output chỉ đi qua priority_resolver.
 */
#ifndef CORE_POINT_TABLE_HPP
#define CORE_POINT_TABLE_HPP

#include <cstdint>

#include "iobus_reader.hpp"
#include "mkddc_shm.h"

namespace core {

enum class PointKind : uint8_t { AI, BI, AO, BO, AV, BV, MSV };

enum class PointSource : uint8_t { IO, GRAPH, WEB, BACNET, SCHEDULE, DEFAULT };

struct PointId {
    PointKind kind;
    int idx;   /* 0-based */
};

struct Point {
    float        value = 0.0f;
    kx_quality_t quality = KX_Q_BAD;
    uint64_t     ts_ns = 0;
    PointSource  source = PointSource::DEFAULT;
};

class PointTable {
public:
    /* AI/BI/DO_fb/AO_fb từ snapshot (07 §3) */
    void update_inputs(const IoSnapshot& io);

    Point get(PointId id) const;

    /* AV/BV/MSV (web/graph) — AO/BO bị từ chối (trả false). */
    bool set_virtual(PointId id, float v, PointSource src);

    /* point_quality ghi đè quality sau khi đánh giá fault/stale. */
    void set_quality(PointId id, kx_quality_t q);

    static bool valid(PointId id);

private:
    Point ai_[KX_N_UI];
    Point bi_[KX_N_DI];
    Point ao_[KX_N_AO];   /* feedback view (ao_setpoint đã ghi) */
    Point bo_[KX_N_DO];   /* feedback view (do_feedback) */
    Point av_[KX_N_AV];
    Point bv_[KX_N_BV];
    Point msv_[KX_N_MSV];

    Point*       slot(PointId id);
    const Point* slot(PointId id) const;
};

} // namespace core

#endif /* CORE_POINT_TABLE_HPP */
