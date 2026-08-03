/**
 * @file  st_limits.hpp
 * @brief FW SOM IEC programming: giới hạn tài nguyên cho toàn bộ đường
 *        source -> token -> AST. MỘT nguồn sự thật duy nhất — parser, CLI
 *        validate gateway và (sau này) artifact loader đều đọc từ đây, không
 *        được hard-code lại số ở chỗ khác.
 *
 *        Lý do tồn tại file này (M-01): parser là recursive descent. Không có
 *        giới hạn độ sâu thì một biểu thức lồng sâu làm tràn stack và process
 *        chết bằng SIGSEGV — không có diagnostic, không có JSON, không có gì
 *        cho BE xử lý. Giới hạn phải nằm ở tầng ngôn ngữ (trả diagnostic),
 *        không phải ở tầng OS (signal).
 *
 *        Nguyên tắc chọn số: đủ rộng để không chặn chương trình điều khiển
 *        thật, đủ hẹp để mọi input đối kháng bị từ chối có kiểm soát trước
 *        khi chạm giới hạn vật lý (stack, RAM). Con số chính thức được chốt
 *        ở SPEC MS-02 (C0.4) — xem docs/02_design/software/ST_SUBSET_SPEC.
 */
#ifndef CORE_ST_LIMITS_HPP
#define CORE_ST_LIMITS_HPP

#include <cstddef>

namespace core {
namespace st_limits {

/* Kích thước source tối đa (byte). CLI đọc file bounded theo hằng số này;
 * parser cũng tự kiểm để không phụ thuộc caller đã kiểm hay chưa. */
constexpr std::size_t kMaxSourceBytes = 64u * 1024u;

/* Số token tối đa sau lexer — đây là backstop BỘ NHỚ, không phải giới hạn
 * ngữ nghĩa. Cố ý đặt CAO hơn mức mà giới hạn cấu trúc (kMaxExprDepth,
 * kMaxStmtDepth) sẽ chặn, để input lồng sâu nhận đúng diagnostic ST-SYN-002
 * ("lồng quá sâu" — user biết phải tách biểu thức) thay vì ST-LIM-002
 * ("quá nhiều token" — không nói lên điều gì hữu ích).
 *
 * Định cỡ: source 64 KiB với token thực tế trung bình ~5 byte cho ~13000
 * token; 32768 nằm trên mọi chương trình thật và dưới mức bệnh lý. Chi phí
 * bộ nhớ tối đa ≈ 32768 × sizeof(Token) ≈ 1.8 MB, chấp nhận được. */
constexpr std::size_t kMaxTokens = 32768u;

/* Độ sâu lồng biểu thức. Mỗi cấp tiêu tốn ~6 stack frame trong recursive
 * descent (parse_expr -> or -> and -> not -> comparison -> primary), nên 32
 * cấp ≈ 200 frame — an toàn tuyệt đối so với stack 8 MB mặc định. Biểu thức
 * điều khiển thật hiếm khi vượt 10 cấp. */
constexpr int kMaxExprDepth = 32;

/* Độ sâu lồng statement (IF trong IF). Logic HVAC thật hiếm khi vượt 5. */
constexpr int kMaxStmtDepth = 16;

/* Tổng số biến khai báo (VAR_INPUT + VAR_OUTPUT + VAR). */
constexpr std::size_t kMaxVariables = 512u;

/* Tổng số statement trong toàn chương trình, đếm cả statement lồng bên
 * trong nhánh IF/ELSE. */
constexpr std::size_t kMaxStatements = 4096u;

/* Độ dài định danh tối đa (ký tự). */
constexpr std::size_t kMaxIdentifierLength = 64u;

/* Số instance Function Block tối đa (ST_SUBSET_SPEC §8). */
constexpr std::size_t kMaxFbInstances = 64u;

/* Số biến RETAIN tối đa. */
constexpr std::size_t kMaxRetainVars = 128u;

/* Số diagnostic tối đa trả về trong một lần gọi. Parser/semantic fail-fast
 * nên luôn ≤1; giới hạn này áp cho validator trả nhiều lỗi (io_map) để một
 * file io_map hỏng nặng không sinh response JSON khổng lồ. */
constexpr std::size_t kMaxDiagnostics = 64u;

} // namespace st_limits
} // namespace core

#endif /* CORE_ST_LIMITS_HPP */
