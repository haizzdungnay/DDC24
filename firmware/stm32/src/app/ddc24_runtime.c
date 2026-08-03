#include "ddc24_runtime.h"

#include <string.h>

#define FW_VERSION_MAJOR 1u
#define FW_VERSION_MINOR 0u

static void put_be16(uint8_t *dst, uint16_t value)
{
    dst[0] = (uint8_t)(value >> 8);
    dst[1] = (uint8_t)value;
}

static void put_be32(uint8_t *dst, int32_t value)
{
    const uint32_t u = (uint32_t)value;
    dst[0] = (uint8_t)(u >> 24); dst[1] = (uint8_t)(u >> 16);
    dst[2] = (uint8_t)(u >> 8); dst[3] = (uint8_t)u;
}

static void transmit(ddc24_runtime_t *runtime, uint8_t cmd, uint8_t seq,
                     const uint8_t *payload, uint16_t len)
{
    runtime->last_tx_len = iop_build_frame(runtime->last_tx, cmd, seq, payload, len);
    if (runtime->hal.uart_tx != NULL && runtime->last_tx_len > 0u)
        runtime->hal.uart_tx(runtime->last_tx, runtime->last_tx_len);
}

void ddc24_runtime_enter_safe_state(ddc24_runtime_t *runtime)
{
    if (runtime == NULL) return;
    memset(runtime->ao_raw, 0, sizeof(runtime->ao_raw));
    runtime->do_command = 0u;
    if (runtime->hal.apply_ao != NULL && !runtime->hal.apply_ao(runtime->ao_raw, runtime->ao_mode_mask))
        runtime->fault_flags |= IOP_FAULT_DAC;
    if (runtime->hal.apply_do != NULL && !runtime->hal.apply_do(0u))
        runtime->fault_flags |= IOP_FAULT_RELAY_STUCK;
    if (!runtime->safe_active) runtime->safe_entries++;
    runtime->safe_active = true;
}

void ddc24_runtime_init(ddc24_runtime_t *runtime, const ddc24_hal_t *hal, uint32_t now_ms)
{
    if (runtime == NULL) return;
    memset(runtime, 0, sizeof(*runtime));
    if (hal != NULL) runtime->hal = *hal;
    runtime->boot_ms = now_ms;
    iop_rx_reset(&runtime->rx);
    iop_session_reset(&runtime->session);
    /* Power-on luôn áp safe-state trước khi nhận bất kỳ byte UART nào. */
    ddc24_runtime_enter_safe_state(runtime);
}

void ddc24_runtime_line_idle(ddc24_runtime_t *runtime)
{
    if (runtime != NULL) (void)iop_rx_on_line_idle(&runtime->rx);
}

static void handle_frame(ddc24_runtime_t *runtime, const iop_frame_t *frame, uint32_t now_ms)
{
    const bool fresh = iop_session_accept(&runtime->session, frame, now_ms);
    runtime->rx_count++;
    if (!fresh && runtime->last_tx_len > 0u) {
        runtime->seq_errors++;
        if (runtime->hal.uart_tx != NULL) runtime->hal.uart_tx(runtime->last_tx, runtime->last_tx_len);
        return;
    }

    uint8_t payload[IOP_MAX_PAYLOAD] = {0};
    switch ((iop_cmd_t)frame->cmd) {
    case CMD_HANDSHAKE: {
        const uint16_t requested = iop_be16(frame->payload);
        const uint16_t supported = (uint16_t)((IOP_VER_MAJOR << 8) | IOP_VER_MINOR);
        put_be16(payload, supported);
        put_be16(payload + 2, (uint16_t)((FW_VERSION_MAJOR << 8) | FW_VERSION_MINOR));
        payload[4] = (requested >> 8) == IOP_VER_MAJOR ? IOP_HS_STATUS_OK : IOP_HS_STATUS_INCOMPAT;
        put_be16(payload + 6, IOP_BOARD_CAP_REV_A);
        transmit(runtime, CMD_HANDSHAKE_RESP, frame->seq, payload, IOP_HANDSHAKE_RESP_LEN);
        break;
    }
    case CMD_GET_IO: {
        int32_t ui[16] = {0}; uint8_t adc1 = 0u, adc2 = 0u, do_fb = 0u;
        int16_t temp = 0; uint16_t faults = runtime->fault_flags;
        const bool sampled = runtime->hal.sample_inputs != NULL &&
            runtime->hal.sample_inputs(ui, &adc1, &adc2, &temp, &faults, &do_fb);
        if (!sampled) faults |= (IOP_FAULT_ADC1 | IOP_FAULT_ADC2);
        for (uint8_t i = 0u; i < 16u; i++) put_be32(payload + 4u * i, ui[i]);
        payload[64] = adc1; payload[65] = adc2;
        put_be16(payload + 66, (uint16_t)temp); put_be16(payload + 68, faults);
        put_be16(payload + 70, ++runtime->sample_count); payload[72] = do_fb;
        runtime->fault_flags = faults; runtime->safe_active = false;
        transmit(runtime, CMD_IO_RESP, frame->seq, payload, IOP_IO_RESP_LEN);
        break;
    }
    case CMD_SET_AO:
        for (uint8_t i = 0u; i < 4u; i++) runtime->ao_raw[i] = iop_be16(frame->payload + 2u * i);
        if (runtime->hal.apply_ao == NULL || !runtime->hal.apply_ao(runtime->ao_raw, runtime->ao_mode_mask))
            runtime->fault_flags |= IOP_FAULT_DAC;
        else runtime->fault_flags &= (uint16_t)~IOP_FAULT_DAC;
        transmit(runtime, CMD_ACK, frame->seq, (uint8_t[]){CMD_SET_AO}, IOP_ACK_LEN);
        break;
    case CMD_SET_DO:
        runtime->do_command = (uint8_t)((runtime->do_command & (uint8_t)~frame->payload[0]) |
                                        (frame->payload[1] & frame->payload[0]));
        if (runtime->hal.apply_do == NULL || !runtime->hal.apply_do(runtime->do_command))
            runtime->fault_flags |= IOP_FAULT_RELAY_STUCK;
        else runtime->fault_flags &= (uint16_t)~IOP_FAULT_RELAY_STUCK;
        transmit(runtime, CMD_ACK, frame->seq, (uint8_t[]){CMD_SET_DO}, IOP_ACK_LEN);
        break;
    case CMD_SET_AO_CFG:
        runtime->ao_mode_mask = (uint8_t)(frame->payload[0] & 0x0Fu);
        transmit(runtime, CMD_ACK, frame->seq, (uint8_t[]){CMD_SET_AO_CFG}, IOP_ACK_LEN);
        break;
    case CMD_RESET_IO:
        ddc24_runtime_enter_safe_state(runtime);
        transmit(runtime, CMD_ACK, frame->seq, (uint8_t[]){CMD_RESET_IO}, IOP_ACK_LEN);
        break;
    case CMD_GET_DIAG:
        put_be16(payload, (uint16_t)((FW_VERSION_MAJOR << 8) | FW_VERSION_MINOR));
        put_be16(payload + 2, (uint16_t)((now_ms - runtime->boot_ms) / 1000u));
        put_be16(payload + 4, (uint16_t)runtime->rx_count);
        put_be16(payload + 6, (uint16_t)runtime->crc_errors);
        put_be16(payload + 8, (uint16_t)runtime->seq_errors);
        put_be16(payload + 10, (uint16_t)runtime->safe_entries);
        put_be16(payload + 12, 500u); /* ADS131 sample rate baseline */
        transmit(runtime, CMD_DIAG_RESP, frame->seq, payload, IOP_DIAG_RESP_LEN);
        break;
    default:
        runtime->last_tx_len = iop_build_nack(runtime->last_tx, frame->seq, frame->cmd, ERR_UNKNOWN_CMD);
        if (runtime->hal.uart_tx != NULL) runtime->hal.uart_tx(runtime->last_tx, runtime->last_tx_len);
        break;
    }
}

void ddc24_runtime_rx_byte(ddc24_runtime_t *runtime, uint8_t byte, uint32_t now_ms)
{
    if (runtime == NULL) return;
    iop_frame_t frame = {0};
    const iop_rx_status_t status = iop_rx_push(&runtime->rx, byte, &frame);
    if (status == IOP_RX_FRAME) handle_frame(runtime, &frame, now_ms);
    else if (status == IOP_RX_ERR_CRC || status == IOP_RX_ERR_LEN) {
        if (status == IOP_RX_ERR_CRC) runtime->crc_errors++;
        runtime->last_tx_len = iop_build_nack(runtime->last_tx, frame.seq, frame.cmd,
            status == IOP_RX_ERR_CRC ? ERR_CRC_FAIL : ERR_BAD_LEN);
        if (runtime->hal.uart_tx != NULL) runtime->hal.uart_tx(runtime->last_tx, runtime->last_tx_len);
    }
}

void ddc24_runtime_tick(ddc24_runtime_t *runtime, uint32_t now_ms)
{
    if (runtime != NULL && iop_session_should_safe_state(&runtime->session, now_ms))
        ddc24_runtime_enter_safe_state(runtime);
}
