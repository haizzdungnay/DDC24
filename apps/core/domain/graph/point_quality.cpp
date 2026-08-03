#include "graph/point_quality.hpp"

#include "iop_protocol.h"

namespace core {

void PointQuality::evaluate(PointTable& table, const IoSnapshot& io)
{
    /* stale tracking: ts_ns không tăng qua các scan liên tiếp */
    if (io.ts_ns != 0 && io.ts_ns != last_ts_ns_) {
        last_ts_ns_ = io.ts_ns;
        stale_scans_ = 0;
    } else {
        stale_scans_++;
    }

    const bool fault_all = (io.iop_status == KX_IOP_FAULT || io.iop_status == KX_IOP_SAFE);
    const bool adc_fault = (io.fault_flags & (IOP_FAULT_ADC1 | IOP_FAULT_ADC2)) != 0;
    const bool stale_bad = stale_scans_ > STALE_BAD_SCANS;
    const bool stale_unc = stale_scans_ > STALE_UNCERTAIN_SCANS;

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
