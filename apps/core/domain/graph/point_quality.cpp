#include "graph/point_quality.hpp"

#include "iop_protocol.h"

namespace core {

void PointQuality::set_base_step_ns(uint64_t base_step_ns)
{
    base_step_ns_ = base_step_ns != 0 ? base_step_ns : DEFAULT_BASE_STEP_NS;
    uncertain_after_ns_ = uncertain_threshold_ns(base_step_ns_);
    bad_after_ns_ = bad_threshold_ns(base_step_ns_);
}

void PointQuality::evaluate(PointTable& table, const IoSnapshot& io, uint64_t now_ns)
{
    /* stale tracking theo THỜI GIAN (ADR-061 4.7): tuổi = now - mốc lần cuối
     * thấy ts_ns đổi. Số scan vẫn đếm cho chẩn đoán. */
    if (io.ts_ns != 0 && io.ts_ns != last_ts_ns_) {
        last_ts_ns_ = io.ts_ns;
        last_change_ns_ = now_ns;
        observed_ = true;
        stale_scans_ = 0;
    } else {
        if (!observed_) {
            /* Chưa từng thấy mẫu nào: neo mốc ở lần evaluate đầu tiên. */
            last_change_ns_ = now_ns;
            observed_ = true;
        }
        stale_scans_++;
    }
    stale_age_ns_ = now_ns > last_change_ns_ ? now_ns - last_change_ns_ : 0;
    /* `>` như luật "quá N scan" cũ: tuổi BẰNG đúng ngưỡng chưa phải stale. */
    stale_uncertain_ = stale_age_ns_ > uncertain_after_ns_;
    stale_bad_ = stale_age_ns_ > bad_after_ns_;

    const bool fault_all = (io.iop_status == KX_IOP_FAULT || io.iop_status == KX_IOP_SAFE);
    const bool adc_fault = (io.fault_flags & (IOP_FAULT_ADC1 | IOP_FAULT_ADC2)) != 0;
    const bool stale_bad = stale_bad_;
    const bool stale_unc = stale_uncertain_;

    for (int i = 0; i < KX_N_UI; i++) {
        kx_quality_t q = static_cast<kx_quality_t>(io.ui_quality[i]);   /* iobus đã set per-channel (UI_OV) */
        if (fault_all || adc_fault || stale_bad) q = KX_Q_BAD;
        else if (stale_unc && q == KX_Q_GOOD)    q = KX_Q_UNCERTAIN;
        table.set_quality({PointKind::AI, i}, q);
    }
    for (int i = 0; i < KX_N_DI; i++) {
        kx_quality_t q = KX_Q_GOOD;
        if (fault_all || stale_bad)  q = KX_Q_BAD;
        else if (stale_unc)          q = KX_Q_UNCERTAIN;
        table.set_quality({PointKind::BI, i}, q);
    }
    for (int i = 0; i < KX_N_DO; i++) {
        kx_quality_t q = KX_Q_GOOD;
        if (fault_all || stale_bad)  q = KX_Q_BAD;
        else if (stale_unc)          q = KX_Q_UNCERTAIN;
        table.set_quality({PointKind::BO, i}, q);
    }
    /* AO: feedback qua ao_setpoint cũng vô nghĩa khi IOP fault/stale —
     * degrade như BO (web/BACnet không được thấy GOOD khi rút UART) */
    for (int i = 0; i < KX_N_AO; i++) {
        kx_quality_t q = KX_Q_GOOD;
        if (fault_all || stale_bad)  q = KX_Q_BAD;
        else if (stale_unc)          q = KX_Q_UNCERTAIN;
        table.set_quality({PointKind::AO, i}, q);
    }
}

} // namespace core
