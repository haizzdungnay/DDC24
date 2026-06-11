#include "bridge/output_command.hpp"

#include <cstdio>

#include "io/io_scaling.hpp"

namespace iobus {

void OutputCommand::set_ao_modes(const AoMode modes[KX_N_AO])
{
    for (int i = 0; i < KX_N_AO; i++)
        ao_mode_[i] = modes[i];
}

void OutputCommand::reset_last_sent()
{
    has_sent_ao_ = false;
    has_sent_do_ = false;
    safe_blocked_ = false;
}

bool OutputCommand::process(const float ao_setpoint[KX_N_AO], const uint8_t do_cmd[KX_N_DO])
{
    bool all_ok = true;

    /* MCU đang safe-state → ngừng SET_* (không spam retry); main loop sẽ
     * clear_safe_blocked() theo chu kỳ chậm để thử lại. */
    if (safe_blocked_)
        return false;

    /* ---- DO: chỉ gửi mask các kênh đổi ---- */
    uint8_t mask = 0, value = 0;
    for (int i = 0; i < KX_N_DO; i++) {
        const uint8_t want = do_cmd[i] ? 1 : 0;
        if (!has_sent_do_ || want != last_sent_do_[i])
            mask |= static_cast<uint8_t>(1u << i);
        if (want)
            value |= static_cast<uint8_t>(1u << i);
    }
    if (mask != 0) {
        const IopResult r = sink_.send_set_do(mask, value);
        if (r.ok()) {
            std::fprintf(stderr, "INFO  output.set_do mask=0x%02X value=0x%02X ack=ok\n", mask, value);
            for (int i = 0; i < KX_N_DO; i++)
                last_sent_do_[i] = do_cmd[i] ? 1 : 0;
            has_sent_do_ = true;
            safe_blocked_ = false;
        } else if (r.code == IopResult::NACK && r.nack_err == ERR_SAFE_STATE) {
            if (!safe_blocked_)
                std::fprintf(stderr, "ERROR output.set_do_fail nack=ERR_SAFE_STATE (giữ, chờ hết safe)\n");
            safe_blocked_ = true;
            all_ok = false;
        } else {
            std::fprintf(stderr, "ERROR output.set_do_fail code=%d nack_err=0x%02X\n", r.code, r.nack_err);
            all_ok = false;
        }
    }

    /* ---- AO: convert eng→raw theo mode đã áp dụng, gửi cả 4 nếu có kênh đổi ---- */
    uint16_t raw[KX_N_AO];
    bool ao_changed = !has_sent_ao_;
    for (int i = 0; i < KX_N_AO; i++) {
        raw[i] = ao_eng_to_raw(ao_setpoint[i], ao_mode_[i]);
        if (has_sent_ao_ && raw[i] != last_sent_ao_[i])
            ao_changed = true;
    }
    if (ao_changed) {
        const IopResult r = sink_.send_set_ao(raw);
        if (r.ok()) {
            std::fprintf(stderr, "INFO  output.set_ao raw=[%u,%u,%u,%u] ack=ok\n",
                         raw[0], raw[1], raw[2], raw[3]);
            for (int i = 0; i < KX_N_AO; i++)
                last_sent_ao_[i] = raw[i];
            has_sent_ao_ = true;
            safe_blocked_ = false;
        } else if (r.code == IopResult::NACK && r.nack_err == ERR_SAFE_STATE) {
            if (!safe_blocked_)
                std::fprintf(stderr, "ERROR output.set_ao_fail nack=ERR_SAFE_STATE (giữ, chờ hết safe)\n");
            safe_blocked_ = true;
            all_ok = false;
        } else {
            std::fprintf(stderr, "ERROR output.set_ao_fail code=%d nack_err=0x%02X\n", r.code, r.nack_err);
            all_ok = false;
        }
    }
    return all_ok;
}

} // namespace iobus
