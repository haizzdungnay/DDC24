/**
 * @file  point_quality.hpp
 * @brief Quality propagation (07 §6): fault/stale → GOOD/UNCERTAIN/BAD.
 *        Stale: ts_ns không tăng >3 scan → UNCERTAIN (3-5), >5 scan → BAD.
 */
#ifndef CORE_POINT_QUALITY_HPP
#define CORE_POINT_QUALITY_HPP

#include "iobus_reader.hpp"
#include "point_table.hpp"

namespace core {

class PointQuality {
public:
    /* Gọi mỗi scan SAU update_inputs. Tự theo dõi stale qua ts_ns lặp lại. */
    void evaluate(PointTable& table, const IoSnapshot& io);

    bool is_stale() const { return stale_scans_ > STALE_UNCERTAIN_SCANS; }
    bool is_stale_bad() const { return stale_scans_ > STALE_BAD_SCANS; }
    uint32_t stale_scans() const { return stale_scans_; }

    static constexpr uint32_t STALE_UNCERTAIN_SCANS = 3;
    static constexpr uint32_t STALE_BAD_SCANS = 5;

private:
    uint64_t last_ts_ns_ = 0;
    uint32_t stale_scans_ = 0;
};

} // namespace core

#endif /* CORE_POINT_QUALITY_HPP */
