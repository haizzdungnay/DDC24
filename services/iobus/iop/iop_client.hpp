/**
 * @file  iop_client.hpp
 * @brief State machine master IOP (05 §13) + API tối thiểu 05 §11.1.
 *        Mọi hàm gửi-lệnh tự lo SEQ++, timeout 10ms, retry ≤3. Caller xử lý IopResult.
 */
#ifndef IOBUS_IOP_CLIENT_HPP
#define IOBUS_IOP_CLIENT_HPP

#include <cstdint>
#include <string>

#include "io/io_types.hpp"
#include "iop/iop_frame.hpp"
#include "iop/iop_port.hpp"

namespace iobus {

class IobusMetrics;

struct IopClientConfig {
    int      baud                  = IOP_BAUD;
    uint32_t response_timeout_ms   = IOP_RESP_TIMEOUT_MS;
    uint32_t handshake_timeout_ms  = IOP_HANDSHAKE_TIMEOUT_MS;
    uint32_t max_retry             = IOP_MAX_RETRY;
};

class IopClient {
public:
    explicit IopClient(IobusMetrics* metrics = nullptr, IopClientConfig cfg = {});

    bool open(const std::string& dev);
    void close();
    bool is_open() const { return port_.is_open(); }

    IopResult handshake();                      /* 05 §9 bước 2-4 */
    IopResult get_io(IopIoResp* out);
    IopResult set_do(uint8_t mask, uint8_t value);
    IopResult set_ao(const uint16_t ao_raw[4]);
    IopResult set_ao_cfg(uint8_t ao_mode_mask); /* bit i: 0=0-10V, 1=4-20mA */
    IopResult get_diag(IopDiagResp* out);
    IopResult reset_io(uint8_t reason);         /* IOP_RESET_REASON_* */

    IopStatus status() const { return status_; }
    void      set_status(IopStatus s);

    /* CLOCK_MONOTONIC ns của IO_RESP hợp lệ gần nhất (0 = chưa có) — cho FAULT 100ms. */
    uint64_t last_io_resp_ns() const { return last_io_resp_ns_; }

    /* Version MCU từ handshake gần nhất. */
    uint16_t mcu_iop_version() const { return mcu_iop_version_; }
    uint16_t mcu_fw_version() const { return mcu_fw_version_; }

private:
    IopResult transact(uint8_t cmd, const uint8_t* payload, uint8_t len,
                       uint8_t expect_cmd, uint8_t expect_len,
                       ParsedFrame* resp, uint32_t timeout_ms);
    /* Chờ frame SEQ khớp trong timeout; xử lý CRC/SEQ err + NACK. */
    IopResult wait_response(uint8_t sent_seq, uint8_t sent_cmd,
                            uint8_t expect_cmd, uint8_t expect_len,
                            ParsedFrame* resp, uint32_t timeout_ms);

    IopPort          port_;
    FrameParser      parser_;
    IobusMetrics*    metrics_;
    IopClientConfig  cfg_;
    IopStatus        status_ = IopStatus::INIT;
    uint8_t          seq_ = 0;
    uint64_t         last_io_resp_ns_ = 0;
    uint16_t         mcu_iop_version_ = 0;
    uint16_t         mcu_fw_version_ = 0;
};

} // namespace iobus

#endif /* IOBUS_IOP_CLIENT_HPP */
