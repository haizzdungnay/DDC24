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
#include <cstdint>
#include <string>

#include "st/st_profile_generated.hpp"

namespace core {
namespace st_limits {

/* Kích thước source tối đa (byte). CLI đọc file bounded theo hằng số này;
 * parser cũng tự kiểm để không phụ thuộc caller đã kiểm hay chưa. */
constexpr std::size_t kMaxSourceBytes = st_profile_generated::kMaxSourceBytes;

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

/* Literal TIME của một Task/FB Rev A không được lớn hơn 24 giờ. Giới hạn này
 * thuộc ngôn ngữ, độc lập với int64 là kiểu lưu trữ nội bộ. */
constexpr int64_t kMaxTimeLiteralNs = 86400000000000ll;

/* Tổng số biến khai báo (VAR_INPUT + VAR_OUTPUT + VAR). */
constexpr std::size_t kMaxVariables = st_profile_generated::kMaxVariables;

/* Tổng số statement trong toàn chương trình, đếm cả statement lồng bên
 * trong nhánh IF/ELSE. */
constexpr std::size_t kMaxStatements = st_profile_generated::kMaxStatements;

/* Độ dài định danh tối đa (ký tự). */
constexpr std::size_t kMaxIdentifierLength = 64u;

/* Số instance Function Block tối đa (ST_SUBSET_SPEC §8). */
constexpr std::size_t kMaxFbInstances = st_profile_generated::kMaxFunctionBlocks;

/* Số biến RETAIN tối đa. */
constexpr std::size_t kMaxRetainVars = st_profile_generated::kMaxRetainVariables;

/* Số diagnostic tối đa trả về trong một lần gọi. Parser/semantic fail-fast
 * nên luôn ≤1; giới hạn này áp cho validator trả nhiều lỗi (io_map) để một
 * file io_map hỏng nặng không sinh response JSON khổng lồ. */
constexpr std::size_t kMaxDiagnostics = 64u;

/* Số đo một candidate tại biên compiler/loader. Cùng một hàm validator được
 * gọi ở cả hai phía; field chưa tồn tại trong artifact schema 1 để bằng 0 và
 * được kiểm ở lớp sở hữu (parser/FBD validator) trước khi serialize. */
struct RevAProfileUsage {
    uint16_t profile_code = st_profile_generated::kProfileCode;
    uint32_t target_abi = st_profile_generated::kTargetAbi;
    std::size_t task_count = 1;
    uint32_t task_period_ms = 1000;
    std::size_t programs_per_task = 1;
    std::size_t programs_total = 1;
    std::size_t source_bytes = 0;
    std::size_t variables = 0;
    std::size_t statements = 0;
    std::size_t fbd_blocks = 0;
    std::size_t fbd_connections = 0;
    std::size_t artifact_bytes = 0;
    std::size_t instructions = 0;
    std::size_t slots = 0;
    std::size_t writable_slots = 0;
    std::size_t constants = 0;
    std::size_t function_blocks = 0;
    std::size_t bindings = 0;
    std::size_t retain_variables = 0;
    std::size_t retain_bytes = 0;
    std::size_t sections = 0;
};

struct RevAProfileError {
    std::string field;
    std::size_t actual = 0;
    std::string constraint;
};

/* ADR-061 4.5 — dải freshness của Published Signal, ms. Dải cũ 1000..90000 ms
 * không chứa được publisher 10..500 ms (freshness hợp lý của nó dưới 1 s) lẫn
 * publisher 50 000 ms (freshness hợp lý của nó trên 90 s). Một nguồn duy nhất
 * cho runtime bus, writer và loader package. Ràng buộc "freshness >= chu kỳ
 * publisher" là luật Check phía API. */
constexpr uint32_t kMinSignalFreshnessMs = 10u;
constexpr uint32_t kMaxSignalFreshnessMs = 150000u;

/* ADR-061 C1 — chu kỳ được phép TẠO MỚI: đúng tập `allowedPeriodMs` của profile
 * đang build. Mọi đường cấu hình Task/Program mới (add_task, writer package,
 * CLI đóng gói) chỉ được hỏi hàm này. */
bool RevAAllowsPeriod(uint32_t period_ms);

/* Tập chu kỳ của profile Rev A v2.1 (`{1000, 5000, 30000}` ms) — bản ghi LỊCH
 * SỬ, không sinh từ contract vì contract hiện hành đã bỏ nó. Chỉ tồn tại để
 * gói đã Commission trước ADR-061 (Active/LKG trên bo) vẫn nạp được sau khi
 * nâng cấp Core: từ chối nạp nghĩa là bộ điều khiển đang chạy mất chương trình
 * ngay lúc deploy, và mất điều khiển kiểu đó là lỗi an toàn. */
constexpr uint32_t kRevAV21PeriodsMs[] = {1000u, 5000u, 30000u};

/* true khi `period_ms` thuộc tập cũ nhưng KHÔNG thuộc tập mới (Rev A v2.2 còn
 * đúng 30000 ms). Loader dùng hàm này để nạp tương thích VÀ để nói ra: một chu
 * kỳ cũ chạy im lặng thì người vận hành không biết gói của mình cần Commission
 * lại. */
bool RevAIsLegacyPeriod(uint32_t period_ms);

/* Đường NẠP (loader PROGRAM_TABLE, prepare_program_set khi stage/khôi phục):
 * tập mới ∪ legacy. Core không phân biệt được "gói cũ" với "gói mới" ở tầng
 * loader, nên việc chặn chu kỳ cũ cho Revision mới thuộc về Check/API. */
bool RevALoaderAllowsPeriod(uint32_t period_ms);

bool ValidateRevAProfile(const RevAProfileUsage& usage, RevAProfileError* error);

} // namespace st_limits
} // namespace core

#endif /* CORE_ST_LIMITS_HPP */
