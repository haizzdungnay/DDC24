/**
 * @file    iop_link.h
 * @brief   Lớp khung IOP phía MCU — C thuần, KHÔNG chạm HAL/thanh ghi.
 *
 * ## Vì sao tách riêng khỏi phần chạm phần cứng
 *
 * Bo mạch MK-DDC-24 chưa fab, nên chưa có STM32 nào để nạp. Nhưng phần dễ sai
 * nhất của firmware lại không phụ thuộc phần cứng chút nào: endian, độ dài
 * payload, CRC, quy tắc SEQ, khi nào phải NACK. Sai một byte ở đây thì SOM và
 * MCU không nói chuyện được, và trên bàn debug nó biểu hiện thành "đường truyền
 * nhiễu" chứ không thành một lỗi rõ ràng.
 *
 * File này vì vậy là C thuần, không include HAL, không đụng thanh ghi, không
 * gọi RTOS. Nó biên dịch được cho cả `arm-none-eabi-gcc` (firmware thật) lẫn
 * host x86 (test). Nhờ đó lớp giao thức được kiểm bằng ctest ngay hôm nay,
 * đối chiếu byte-for-byte với `tools/fake_mcu` và với parser phía SOM.
 *
 * Phần chạm phần cứng — UART DMA, SPI, DRDY, timer — nằm ở tầng trên và chỉ đưa
 * byte vào/ra qua các hàm ở đây.
 *
 * ## Nguồn chuẩn
 *
 * `contracts/iop/iop_protocol.h` (ADR-010). File đó THẮNG mọi tài liệu khi mâu thuẫn.
 * Ở đây không định nghĩa lại một hằng số nào của giao thức — chỉ include.
 */
#ifndef MKDDC_FW_IOP_LINK_H
#define MKDDC_FW_IOP_LINK_H

#include <stdbool.h>
#include <stdint.h>
#include "iop_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Kết quả một bước nạp byte vào bộ nhận. */
typedef enum {
    IOP_RX_IDLE = 0,      /**< chưa đủ dữ liệu, chưa có gì để làm            */
    IOP_RX_FRAME,         /**< đã nhận trọn một frame HỢP LỆ (CRC đúng)      */
    IOP_RX_ERR_CRC,       /**< đủ độ dài nhưng CRC sai → phải NACK CRC_FAIL  */
    IOP_RX_ERR_LEN        /**< LEN không hợp lệ với CMD → phải NACK BAD_LEN  */
} iop_rx_status_t;

/** Một frame đã tách xong. `payload` trỏ vào bộ đệm nội bộ của rx. */
typedef struct {
    uint8_t        cmd;
    uint8_t        seq;
    uint16_t       len;
    const uint8_t *payload;
} iop_frame_t;

/**
 * Bộ nhận theo byte.
 *
 * Cố ý là máy trạng thái nạp từng byte chứ không phải hàm "parse một buffer":
 * UART trên MCU trả về dữ liệu theo từng mẩu tuỳ ý, và một frame hoàn toàn có
 * thể bị cắt làm đôi giữa hai lần ngắt DMA. Hàm parse-một-buffer sẽ đánh rơi
 * frame ở đúng ranh giới đó — loại lỗi chỉ xuất hiện khi tải cao.
 */
typedef struct {
    uint8_t  buf[IOP_MAX_FRAME];
    uint16_t have;          /**< số byte đã nhận trong frame hiện tại        */
    uint16_t need;          /**< tổng độ dài frame mong đợi, 0 = chưa biết   */
    uint32_t dropped_bytes; /**< byte rác bị bỏ khi đang tìm SOF             */
    uint32_t crc_errors;
    uint32_t len_errors;
} iop_rx_t;

void iop_rx_reset(iop_rx_t *rx);

/**
 * Báo cho bộ nhận rằng đường truyền vừa im lặng — gọi từ ngắt IDLE của USART.
 *
 * Vì sao bắt buộc phải có: một máy trạng thái nạp theo byte KHÔNG thể tự biết
 * một frame đã bị cắt giữa chừng. Nếu frame trước bị mất mấy byte cuối, bộ nhận
 * vẫn đang chờ cho đủ `need`, và nó sẽ nuốt luôn các byte đầu của frame KẾ TIẾP
 * để lấp chỗ trống — mất frame theo chuỗi cho tới khi tình cờ có một frame khớp
 * CRC. Trên đường 921600 baud với poll 2 ms, đó là mất điều khiển kéo dài.
 *
 * Thông tin "đã hết khung" chỉ đến từ thời gian, và trên STM32 nó có sẵn dưới
 * dạng ngắt IDLE line của USART. Tầng driver gọi hàm này ở đó; tầng giao thức
 * không tự đoán thời gian.
 *
 * Trả về số byte dở dang bị bỏ (0 nếu đang rảnh) để tầng trên đếm được chất
 * lượng đường truyền.
 */
uint16_t iop_rx_on_line_idle(iop_rx_t *rx);

/**
 * Nạp một byte. Trả `IOP_RX_FRAME` khi vừa hoàn tất một frame hợp lệ; khi đó
 * `out` được điền. Với `IOP_RX_ERR_*`, `out->cmd`/`out->seq` vẫn được điền để
 * tầng trên dựng NACK đúng SEQ.
 */
iop_rx_status_t iop_rx_push(iop_rx_t *rx, uint8_t byte, iop_frame_t *out);

/**
 * Độ dài payload BẮT BUỘC cho một CMD, hoặc -1 nếu CMD không xác định.
 *
 * Giao thức cố định độ dài theo lệnh (`IOP_*_LEN`), nên LEN sai là dấu hiệu
 * hoặc phía kia sai phiên bản, hoặc luồng byte lệch khung. Cả hai đều phải bị
 * từ chối chứ không được đoán.
 */
int32_t iop_expected_payload_len(uint8_t cmd);

/**
 * Dựng một frame vào `dst` (tối thiểu `IOP_MAX_FRAME` byte).
 * Trả tổng số byte, hoặc 0 nếu tham số không hợp lệ.
 */
uint16_t iop_build_frame(uint8_t *dst, uint8_t cmd, uint8_t seq,
                         const uint8_t *payload, uint16_t len);

/** Dựng NACK(err) cho một frame đến. */
uint16_t iop_build_nack(uint8_t *dst, uint8_t seq, uint8_t offending_cmd, uint8_t err);

/** Dựng ACK cho một lệnh đã thực thi. */
uint16_t iop_build_ack(uint8_t *dst, uint8_t seq, uint8_t acked_cmd);

/* ── Trạng thái phiên phía MCU ─────────────────────────────────────────────
 *
 * Tách khỏi bộ nhận vì nó có luật riêng và phải test được độc lập: an toàn của
 * thiết bị phụ thuộc vào việc MCU tự vào safe-state khi SOM im lặng, chứ không
 * phụ thuộc SOM nhớ gửi lệnh dừng.
 */
typedef struct {
    bool     handshaked;      /**< đã bắt tay xong chưa                      */
    uint8_t  last_seq;        /**< SEQ của frame hợp lệ gần nhất             */
    bool     have_last_seq;
    uint32_t last_rx_ms;      /**< mốc thời gian frame hợp lệ gần nhất       */
    uint32_t duplicates;      /**< số frame lặp lại SEQ đã bỏ qua            */
} iop_session_t;

void iop_session_reset(iop_session_t *s);

/**
 * Ghi nhận một frame hợp lệ. Trả `true` nếu đây là frame MỚI, `false` nếu nó
 * lặp lại SEQ ngay trước đó.
 *
 * Vì sao cần: SOM retry tối đa `IOP_MAX_RETRY` lần khi không thấy phản hồi
 * (`contracts/iop/iop_protocol.h`). Một lệnh `SET_DO` bị retry mà MCU thực thi hai lần
 * là hai lần đóng/mở contactor thật. Lệnh lặp phải được trả lời lại nhưng
 * KHÔNG được thực thi lại.
 */
bool iop_session_accept(iop_session_t *s, const iop_frame_t *frame, uint32_t now_ms);

/**
 * MCU đã phải vào safe-state chưa.
 *
 * `IOP_SAFE_TIMEOUT_MS` kể từ frame hợp lệ cuối. Trước khi bắt tay lần đầu thì
 * chưa tính — lúc đó chưa có ai điều khiển nên chưa có gì để bảo vệ.
 */
bool iop_session_should_safe_state(const iop_session_t *s, uint32_t now_ms);

#ifdef __cplusplus
}
#endif

#endif /* MKDDC_FW_IOP_LINK_H */
