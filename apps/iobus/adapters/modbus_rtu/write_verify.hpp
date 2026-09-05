/**
 * @file  write_verify.hpp
 * @brief `ISS-PIO-23`/`F-PIO-022` — xác nhận sau khi ghi (đề bài §26).
 *
 * Trước bản vá `readback` CÓ tồn tại (MBR-B107) nhưng chỉ ĐỌC LẠI rồi báo con
 * số; nó không bao giờ SO SÁNH con số đó với giá trị vừa ghi, và `status` vẫn
 * là `applied` kể cả khi thiết bị trả về một giá trị khác hẳn. Một VFD có tham
 * số bị khoá sẽ ACK lệnh, giữ nguyên giá trị cũ, đọc lại ra giá trị cũ — và sản
 * phẩm báo "applied". Đó đúng là "im lặng coi là thành công" mà issue cấm.
 *
 * Đọc lại thất bại cũng vậy: bản cũ đặt `reason = "readback_failed"` nhưng để
 * nguyên `status = "applied"`, nên không consumer nào phân biệt được.
 */
#ifndef IOBUS_WRITE_VERIFY_HPP
#define IOBUS_WRITE_VERIFY_HPP

#include <cmath>
#include <cstdint>

namespace iobus::fieldbus {

/* Dung sai mặc định cho phép so sánh giá trị đã scale.
 *
 * Nửa bước lượng tử của chính `scale`: một thanh ghi 16-bit với `scale=0.1` chỉ
 * biểu diễn được bội số của 0.1, nên sai khác dưới 0.05 là làm tròn chứ không
 * phải thiết bị từ chối. Dùng một hằng số tuyệt đối thay cho phép suy này sẽ
 * hoặc quá chặt với `scale` thô, hoặc quá lỏng với `scale` mịn. */
double default_readback_tolerance(double scale);

/* Giá trị đọc lại có khớp giá trị đã ghi không.
 *
 * `tolerance <= 0` ⇒ suy từ `scale`. Giá trị không hữu hạn ở BẤT KỲ vế nào là
 * không khớp: `NaN != NaN` nên một phép so ngây thơ sẽ luôn báo lệch, còn coi
 * nó là khớp thì lại nuốt mất một lỗi decode thật. */
bool readback_matches(double written, double read_back, double scale, double tolerance);

/* Kết luận của một lần xác nhận. Tách thành hàm THUẦN thay vì để nằm trong
 * `flush_pending`: đây là LUẬT ("khi nào được nói applied"), không phải I/O, và
 * một luật nằm lẫn trong vòng lặp ghi thì không có cách nào kiểm mà không dựng
 * cả một bus giả. */
struct VerifyOutcome {
    const char* status;   /* "applied" | "unverified" */
    const char* reason;   /* "" | "readback_failed" | "readback_mismatch" */
};

/* `read_ok=false` nghĩa là đọc lại KHÔNG được ⇒ chưa chứng minh được gì.
 * Đó KHÔNG phải `applied`: slave ACK lệnh ghi chỉ nói nó nhận khung, không nói
 * nó giữ giá trị. */
VerifyOutcome verify_write_outcome(bool read_ok, double written, double read_back,
                                   double scale, double tolerance);

} // namespace iobus::fieldbus

#endif /* IOBUS_WRITE_VERIFY_HPP */
