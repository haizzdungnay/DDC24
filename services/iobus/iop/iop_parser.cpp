#include "iop/iop_parser.hpp"

namespace iobus {

bool parse_io(const uint8_t* p, uint8_t len, IopIoResp* out)
{
    if (len != IOP_IO_RESP_LEN) return false;
    /* [0..63] UI_RAW[16] — 16 × int32 BE (ADR-010) */
    for (int i = 0; i < KX_N_UI; i++)
        out->ui_raw[i] = iop_be32s(p + 4 * i);
    out->adc1_stat    = p[64];
    out->adc2_stat    = p[65];
    out->mcu_temp_x10 = static_cast<int16_t>(iop_be16(p + 66));
    out->fault_flags  = iop_be16(p + 68);
    out->sample_cnt   = iop_be16(p + 70);
    out->do_fb_mask   = p[72];
    /* p[73] reserved */
    return true;
}

bool parse_diag(const uint8_t* p, uint8_t len, IopDiagResp* out)
{
    if (len != IOP_DIAG_RESP_LEN) return false;
    out->fw_version           = iop_be16(p + 0);
    out->uptime_s             = iop_be16(p + 2);
    out->rx_count             = iop_be16(p + 4);
    out->crc_error_count      = iop_be16(p + 6);
    out->seq_error_count      = iop_be16(p + 8);
    out->watchdog_reset_count = iop_be16(p + 10);
    out->adc_sample_rate      = iop_be16(p + 12);
    out->mcu_temp_max_x10     = static_cast<int16_t>(iop_be16(p + 14));
    out->vdd_mv               = iop_be16(p + 16);
    /* [18..19] reserved */
    return true;
}

} // namespace iobus
