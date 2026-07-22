/**
 * @file  output_command.hpp
 * @brief Phát hiện output đổi → build & gửi SET_DO/SET_AO; xử lý ACK/NACK (06 §3.9).
 *        Chỉ gửi khi CHANGED (so last_sent_*). NACK ERR_SAFE_STATE → giữ + báo.
 */
#ifndef IOBUS_OUTPUT_COMMAND_HPP
#define IOBUS_OUTPUT_COMMAND_HPP

#include "io/io_types.hpp"

namespace iobus {

/* Sink trừu tượng để unit test không cần UART thật (impl thật = IopClient). */
class CommandSink {
public:
    virtual ~CommandSink() = default;
    virtual IopResult send_set_do(uint8_t mask, uint8_t value) = 0;
    virtual IopResult send_set_ao(const uint16_t ao_raw[KX_N_AO]) = 0;
};

class OutputCommand {
public:
    explicit OutputCommand(CommandSink& sink) : sink_(sink) {}

    /* Cấu hình mode AO đã áp dụng (để convert eng→raw). */
    void set_ao_modes(const AoMode modes[KX_N_AO]);

    /* So với last_sent — gửi SET_DO/SET_AO nếu đổi. Trả false nếu có lệnh fail. */
    bool process(const float ao_setpoint[KX_N_AO], const uint8_t do_cmd[KX_N_DO]);

    /* Đối chiếu DO_FB từ IO_RESP với last_sent (tinh thần RELAY_STUCK 05 §6.8):
     * mismatch ≥ FB_MISMATCH_POLLS poll liên tiếp (MCU tự reset/safe mất state)
     * → ép resend SET_DO ở process() kế. Gọi mỗi poll sau khi có IO_RESP. */
    void verify_feedback(const uint8_t do_fb[KX_N_DO]);

    static constexpr int FB_MISMATCH_POLLS = 5;   /* ~50ms @ poll 10ms (relay budget 20ms) */

    /* MCU vào/ra safe-state → reset trạng thái đã gửi (gửi lại khi recover). */
    void reset_last_sent();

    bool safe_state_blocked() const { return safe_blocked_; }
    void clear_safe_blocked() { safe_blocked_ = false; }

private:
    CommandSink& sink_;
    AoMode          ao_mode_[KX_N_AO]     = {AoMode::V0_10, AoMode::V0_10, AoMode::V0_10, AoMode::V0_10};
    uint16_t last_sent_ao_[KX_N_AO] = {};
    uint8_t  last_sent_do_[KX_N_DO] = {};
    bool     has_sent_ao_ = false;
    bool     has_sent_do_ = false;
    bool     safe_blocked_ = false;
    int      fb_mismatch_polls_ = 0;
};

} // namespace iobus

#endif /* IOBUS_OUTPUT_COMMAND_HPP */
