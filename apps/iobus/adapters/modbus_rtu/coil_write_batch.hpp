/**
 * @file  coil_write_batch.hpp
 * @brief U-07 (REC-DDC-FIELD-USE-20260927) — gom các lệnh ghi coil LIỀN KỀ của
 *        một slave thành một giao dịch FC15.
 *
 * Triệu chứng đo trên bo Foxlinx (iobus đã có G7): Program đổi 16 DO trên hai
 * module CK-508 thì bus phát 16 giao dịch FC05, trải 0,43–0,46 s; relay của
 * module thứ hai đóng sau module thứ nhất gần nửa giây, và nhịp BLINK 1 s chiếm
 * ≈ 46 % băng thông 9600 bps. Gốc: `flush_pending` phát MỖI mục hàng đợi thành
 * một giao dịch riêng.
 *
 * Tầng này chỉ LẬP KẾ HOẠCH — hàm thuần, không đụng dây, không cần libmodbus —
 * để luật gom nhóm kiểm được bằng test thường. `BusWorker::flush_pending` thực
 * thi kế hoạch và giữ nguyên mọi bất biến bookkeeping theo TỪNG mục.
 *
 * Bật theo TỪNG thiết bị (`max_coils_per_write` trong profile), MẶC ĐỊNH TẮT:
 * không phải thiết bị Modbus nào cũng hỗ trợ FC15 (audit G7 hoãn gộp đúng vì
 * lý do đó). Tắt thì kế hoạch là "mỗi mục một giao dịch, đúng thứ tự hàng
 * đợi" — hành vi trước bản này, không lệch một khung.
 */
#ifndef IOBUS_COIL_WRITE_BATCH_HPP
#define IOBUS_COIL_WRITE_BATCH_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

namespace iobus::fieldbus {

/* Trần số coil mỗi FC15 mà dự án cho phép cấu hình. Giao thức cho tới 1968;
 * 16 đủ cho hai module 8 relay và giữ khung FC15 ngắn (11 byte dữ liệu) — một
 * khung dài là một khung dễ hỏng hơn trên dây nhiễu, và lỗi của nó kéo cả nhóm
 * phát lại. Giá trị trong profile lớn hơn bị kẹp về đây. */
inline constexpr uint16_t kMaxCoilsPerWrite = 16;

inline bool is_coil_write_fc(uint8_t fc) { return fc == 5 || fc == 15; }

/* Một mục hàng đợi, rút gọn tới đúng những gì luật gom cần biết. */
struct WritePlanItem {
    uint8_t  fc   = 0;
    uint16_t addr = 0;
    /* Nơi gọi quyết định: lệnh ghi coil, KHÔNG cần đọc lại xác nhận
     * (`readback`/`verify_after_write`), và CHƯA quá hạn TTL. Mục không gom
     * được là một RÀO: nó đi riêng, đúng vị trí của nó trong hàng đợi. */
    bool     groupable = false;
};

/* Một giao dịch trong kế hoạch.
 *
 * `items` là chỉ số vào mảng đầu vào. Một phần tử ⇒ giao dịch đơn, phát đúng
 * FC gốc của mục (FC05 vẫn là FC05). Nhiều phần tử ⇒ MỘT FC15 bắt đầu ở
 * `start_addr`; các mục đã sắp theo địa chỉ tăng dần nên bit thứ k trên dây là
 * giá trị của `items[k]`. */
struct WritePlanTx {
    std::vector<size_t> items;
    uint16_t start_addr = 0;
    bool multi_coil() const { return items.size() > 1; }
};

/**
 * Lập kế hoạch giao dịch cho các lệnh ghi đang chờ của MỘT slave.
 *
 * Luật (mỗi luật khoá một lớp lỗi):
 *  - `max_coils_per_write <= 1` ⇒ mỗi mục một giao dịch, đúng thứ tự đầu vào.
 *  - Địa chỉ coil xuất hiện hơn một lần trong đầu vào ⇒ các mục đó KHÔNG gom:
 *    hai lệnh cho cùng một coil phải lên dây theo đúng thứ tự cũ → mới
 *    (`MBA-FW-04`); gom chúng vào một khung thì chỉ một giá trị đi ra.
 *  - Mục không gom được là rào: chỉ gom trong một ĐOẠN liên tiếp các mục gom
 *    được, nên thứ tự tương đối với lệnh thanh ghi và lệnh cần readback giữ
 *    nguyên như hàng đợi.
 *  - Trong một đoạn: sắp theo địa chỉ, cắt thành dải LIỀN KỀ TUYỆT ĐỐI (không
 *    vượt khoảng trống — coil không khai báo có thể không tồn tại và làm slave
 *    từ chối cả khung, cùng lý do như `build_blocks`) và không quá
 *    `max_coils_per_write` coil. Các dải xếp theo mục CŨ NHẤT của chúng.
 *
 * Kết quả xếp theo chỉ số nhỏ nhất của mỗi giao dịch, nên lấy k giao dịch đầu
 * luôn phục vụ lệnh cũ nhất trước (G7(c)).
 */
std::vector<WritePlanTx> plan_write_transactions(const std::vector<WritePlanItem>& items,
                                                 uint16_t max_coils_per_write);

} // namespace iobus::fieldbus

#endif /* IOBUS_COIL_WRITE_BATCH_HPP */
