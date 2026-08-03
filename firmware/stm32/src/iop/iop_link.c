#include "iop_link.h"

#include <string.h>

void iop_rx_reset(iop_rx_t *rx)
{
    if (rx == NULL) return;
    memset(rx, 0, sizeof(*rx));
}

uint16_t iop_rx_on_line_idle(iop_rx_t *rx)
{
    if (rx == NULL || rx->have == 0u) return 0u;
    const uint16_t abandoned = rx->have;
    rx->dropped_bytes += abandoned;
    rx->have = 0u;
    rx->need = 0u;
    return abandoned;
}

int32_t iop_expected_payload_len(uint8_t cmd)
{
    switch ((iop_cmd_t)cmd) {
    case CMD_GET_IO:         return (int32_t)IOP_GET_IO_LEN;
    case CMD_IO_RESP:        return (int32_t)IOP_IO_RESP_LEN;
    case CMD_SET_AO:         return (int32_t)IOP_SET_AO_LEN;
    case CMD_SET_DO:         return (int32_t)IOP_SET_DO_LEN;
    case CMD_ACK:            return (int32_t)IOP_ACK_LEN;
    case CMD_SET_AO_CFG:     return (int32_t)IOP_SET_AO_CFG_LEN;
    case CMD_GET_DIAG:       return (int32_t)IOP_GET_DIAG_LEN;
    case CMD_DIAG_RESP:      return (int32_t)IOP_DIAG_RESP_LEN;
    case CMD_HANDSHAKE:      return (int32_t)IOP_HANDSHAKE_LEN;
    case CMD_HANDSHAKE_RESP: return (int32_t)IOP_HANDSHAKE_RESP_LEN;
    case CMD_RESET_IO:       return (int32_t)IOP_RESET_IO_LEN;
    case CMD_NACK:           return (int32_t)IOP_NACK_LEN;
    default:                 return -1;
    }
}

iop_rx_status_t iop_rx_push(iop_rx_t *rx, uint8_t byte, iop_frame_t *out)
{
    if (rx == NULL || out == NULL) return IOP_RX_IDLE;

    /* Đồng bộ khung: chỉ chấp nhận bắt đầu bằng SOF. Byte rác trước SOF được
       đếm rồi bỏ — im lặng nuốt chúng sẽ che mất một đường truyền đang hỏng. */
    if (rx->have == 0u) {
        if (byte != IOP_SOF) {
            rx->dropped_bytes++;
            return IOP_RX_IDLE;
        }
        rx->buf[rx->have++] = byte;
        rx->need = 0u;
        return IOP_RX_IDLE;
    }

    rx->buf[rx->have++] = byte;

    /* Đã có SOF|LEN|CMD|SEQ → biết tổng độ dài. */
    if (rx->have == IOP_HDR_LEN) {
        const uint8_t len = rx->buf[1];
        const uint8_t cmd = rx->buf[2];
        const int32_t expect = iop_expected_payload_len(cmd);

        out->cmd = cmd;
        out->seq = rx->buf[3];
        out->len = len;
        out->payload = &rx->buf[IOP_HDR_LEN];

        /* Từ chối NGAY khi header đã đủ để biết là sai, thay vì đọc tiếp theo
           một LEN không đáng tin. Một LEN hỏng có thể trỏ tới 252 byte và làm
           bộ nhận nuốt luôn frame kế tiếp. */
        if (expect < 0 || (int32_t)len != expect || len > IOP_MAX_PAYLOAD) {
            rx->len_errors++;
            rx->have = 0u;
            rx->need = 0u;
            return IOP_RX_ERR_LEN;
        }
        rx->need = (uint16_t)(IOP_HDR_LEN + len + IOP_CRC_LEN);
        if (rx->need > IOP_MAX_FRAME) {
            rx->len_errors++;
            rx->have = 0u;
            rx->need = 0u;
            return IOP_RX_ERR_LEN;
        }
    }

    if (rx->need == 0u || rx->have < rx->need) return IOP_RX_IDLE;

    /* CRC-16/Modbus trên SOF..payload, truyền HI trước LO. */
    const uint16_t body = (uint16_t)(rx->need - IOP_CRC_LEN);
    const uint16_t want = iop_crc16(rx->buf, body);
    const uint16_t got  = (uint16_t)((rx->buf[body] << 8) | rx->buf[body + 1u]);

    out->cmd = rx->buf[2];
    out->seq = rx->buf[3];
    out->len = rx->buf[1];
    out->payload = &rx->buf[IOP_HDR_LEN];

    const bool crc_ok = (want == got);
    rx->have = 0u;
    rx->need = 0u;
    if (!crc_ok) {
        rx->crc_errors++;
        return IOP_RX_ERR_CRC;
    }
    return IOP_RX_FRAME;
}

uint16_t iop_build_frame(uint8_t *dst, uint8_t cmd, uint8_t seq,
                         const uint8_t *payload, uint16_t len)
{
    if (dst == NULL || len > IOP_MAX_PAYLOAD) return 0u;
    if (len > 0u && payload == NULL) return 0u;

    dst[0] = IOP_SOF;
    dst[1] = (uint8_t)len;
    dst[2] = cmd;
    dst[3] = seq;
    if (len > 0u) memcpy(&dst[IOP_HDR_LEN], payload, len);

    const uint16_t body = (uint16_t)(IOP_HDR_LEN + len);
    const uint16_t crc = iop_crc16(dst, body);
    dst[body]      = (uint8_t)(crc >> 8);   /* HI trước */
    dst[body + 1u] = (uint8_t)(crc & 0xFFu);
    return (uint16_t)(body + IOP_CRC_LEN);
}

uint16_t iop_build_nack(uint8_t *dst, uint8_t seq, uint8_t offending_cmd, uint8_t err)
{
    const uint8_t payload[IOP_NACK_LEN] = { offending_cmd, err };
    return iop_build_frame(dst, (uint8_t)CMD_NACK, seq, payload, IOP_NACK_LEN);
}

uint16_t iop_build_ack(uint8_t *dst, uint8_t seq, uint8_t acked_cmd)
{
    const uint8_t payload[IOP_ACK_LEN] = { acked_cmd };
    return iop_build_frame(dst, (uint8_t)CMD_ACK, seq, payload, IOP_ACK_LEN);
}

void iop_session_reset(iop_session_t *s)
{
    if (s == NULL) return;
    memset(s, 0, sizeof(*s));
}

bool iop_session_accept(iop_session_t *s, const iop_frame_t *frame, uint32_t now_ms)
{
    if (s == NULL || frame == NULL) return false;

    s->last_rx_ms = now_ms;
    if (frame->cmd == (uint8_t)CMD_HANDSHAKE) s->handshaked = true;

    /* Lệnh lặp lại SEQ ngay trước đó là một lần retry của SOM, không phải một
       lệnh mới. Phải trả lời lại nhưng KHÔNG thực thi lại: `SET_DO` chạy hai
       lần là hai lần đóng/mở contactor thật.
       Chỉ so với SEQ liền trước chứ không giữ cả lịch sử — SEQ là uint8 và wrap
       255→0 (IOP-Q-005 còn treo), nên một bộ nhớ dài sẽ tự sinh dương tính giả
       sau mỗi 256 lệnh. */
    if (s->have_last_seq && s->last_seq == frame->seq) {
        s->duplicates++;
        return false;
    }
    s->last_seq = frame->seq;
    s->have_last_seq = true;
    return true;
}

bool iop_session_should_safe_state(const iop_session_t *s, uint32_t now_ms)
{
    if (s == NULL) return true;
    /* Trước lần bắt tay đầu tiên thì chưa có ai điều khiển, nên chưa có gì để
       bảo vệ; ép safe-state lúc đó chỉ tạo một lần chuyển trạng thái vô nghĩa
       ngay khi cấp nguồn. */
    if (!s->handshaked) return false;
    return (uint32_t)(now_ms - s->last_rx_ms) >= (uint32_t)IOP_SAFE_TIMEOUT_MS;
}
