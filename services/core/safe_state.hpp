/**
 * @file  safe_state.hpp
 * @brief Ghi đè output an toàn khi IO không tin cậy (07 §5).
 *        Trigger: iop_status FAULT/SAFE · shm stale >3 scan · (graph BAD — Rev A.1).
 *        Hành vi: AO → safe (0V/4mA theo ao_mode), DO → 0 (open).
 */
#ifndef CORE_SAFE_STATE_HPP
#define CORE_SAFE_STATE_HPP

#include "iobus_reader.hpp"
#include "point_quality.hpp"
#include "point_table.hpp"
#include "priority_resolver.hpp"

namespace core {

class SafeState {
public:
    explicit SafeState(const PointQuality& quality) : quality_(quality) {}

    /* Có thể ghi đè *inout — gọi SAU priority_resolver.resolve() (scan step 7). */
    void apply(const IoSnapshot& io, const PointTable& table, OutputCmd* inout);

    bool active() const { return active_; }

private:
    const PointQuality& quality_;
    bool active_ = false;
};

} // namespace core

#endif /* CORE_SAFE_STATE_HPP */
