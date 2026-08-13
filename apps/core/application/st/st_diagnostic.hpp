/**
 * @file  st_diagnostic.hpp
 * @brief FW SOM IEC programming foundation: diagnostic 1 lỗi (fail-fast, giữ
 *        nguyên kiến trúc "return false ở lỗi đầu tiên" của st_parser/st_semantic)
 *        nhưng có đủ vị trí/severity/code để FE bôi đúng chỗ và BE forward JSON
 *        ổn định, không phải string tự do.
 */
#ifndef CORE_ST_DIAGNOSTIC_HPP
#define CORE_ST_DIAGNOSTIC_HPP

#include <string>

namespace core {

enum class StSeverity { ERROR, WARNING };

/* Stable error code — KHÔNG đổi text nếu message thay đổi (FE/BE map theo code,
 * không parse message tiếng Anh). Thêm code mới: nối vào cuối, không đổi số cũ. */
namespace st_diag_code {
constexpr const char* kLexUnexpectedChar = "ST-LEX-001";
constexpr const char* kBadTimeLiteral    = "ST-LEX-002";
constexpr const char* kUnterminatedComment = "ST-LEX-003";
constexpr const char* kSyntaxUnexpected  = "ST-SYN-001";
/* Lồng quá sâu — biểu thức HOẶC statement. Tách khỏi ST-SYN-001 vì đây không
 * phải "viết sai cú pháp" mà là "vượt giới hạn tài nguyên": BE nên báo user
 * đơn giản hoá chương trình, không phải đi tìm lỗi gõ. Xem st_limits.hpp. */
constexpr const char* kNestingTooDeep    = "ST-SYN-002";
constexpr const char* kUnboundVariable   = "ST-SEM-001";
constexpr const char* kTypeMismatch      = "ST-SEM-002";
constexpr const char* kReadonlyInput     = "ST-SEM-003";
constexpr const char* kDuplicateVar      = "ST-SEM-004";
constexpr const char* kUnknownType       = "ST-SEM-005";
constexpr const char* kUnknownFunction   = "ST-SEM-006";
constexpr const char* kArgCountMismatch  = "ST-SEM-007";
constexpr const char* kIntLiteralOutOfRange = "ST-SEM-008";
constexpr const char* kAssignToFbInstance   = "ST-SEM-009";
constexpr const char* kFbCalledTwice        = "ST-SEM-010";
constexpr const char* kWriteToFbOutput      = "ST-SEM-011";
constexpr const char* kFbFunctionConfusion  = "ST-SEM-012";
constexpr const char* kBadFbParam           = "ST-SEM-013";
constexpr const char* kBadRetainType        = "ST-SEM-014";

/* Runtime fault (ST_SUBSET_SPEC §12.4) — không crash process; kết thúc chu kỳ,
 * không commit output, chuyển cho chính sách fault của scheduler. */
constexpr const char* kRtIntOverflow     = "ST-RT-001";
constexpr const char* kRtDivByZero       = "ST-RT-002";
constexpr const char* kRtConvOutOfRange  = "ST-RT-003";
constexpr const char* kRtNonFiniteReal   = "ST-RT-004";
constexpr const char* kRtNegativeTime    = "ST-RT-005";
constexpr const char* kRtLimitMinMax     = "ST-RT-006";
constexpr const char* kRtSqrtNegative    = "ST-RT-007";
constexpr const char* kRtNonFiniteInput  = "ST-RT-008";
/* PID (TASK-PROG-303): now_ns không tăng giữa hai lần gọi liên tiếp cùng
 * instance — dt sẽ <=0, không thể tính derivative/integral an toàn. */
constexpr const char* kRtPidInvalidDt    = "ST-RT-009";

/* Vượt giới hạn tài nguyên (st_limits.hpp). Tách riêng khỏi ST-SYN-* để BE
 * phân biệt được "chương trình sai" với "chương trình quá lớn" — hai hành
 * động sửa hoàn toàn khác nhau về phía người dùng. */
constexpr const char* kSourceTooLarge     = "ST-LIM-001";
constexpr const char* kTooManyTokens      = "ST-LIM-002";
constexpr const char* kTooManyVariables   = "ST-LIM-003";
constexpr const char* kTooManyStatements  = "ST-LIM-004";
constexpr const char* kIdentifierTooLong  = "ST-LIM-005";
/* Danh sách diagnostic bị cắt vì chạm trần — luôn là phần tử CUỐI của mảng.
 * BE thấy code này thì biết còn lỗi chưa hiển thị, không được kết luận "hết lỗi". */
constexpr const char* kDiagnosticsTruncated = "ST-LIM-006";
constexpr const char* kTooManyFbInstances   = "ST-LIM-007";
constexpr const char* kTooManyRetainVars    = "ST-LIM-008";

/* IO map validation (st_io_map.hpp) */
constexpr const char* kIoMapUnknownVar      = "ST-IOMAP-001";
constexpr const char* kIoMapBadDirection    = "ST-IOMAP-002";
constexpr const char* kIoMapTypeMismatch    = "ST-IOMAP-003";
constexpr const char* kIoMapBadPointId      = "ST-IOMAP-004";
constexpr const char* kIoMapBadRange        = "ST-IOMAP-005";
constexpr const char* kIoMapMissingBinding  = "ST-IOMAP-006";
constexpr const char* kIoMapDuplicateBinding = "ST-IOMAP-007";
} // namespace st_diag_code

struct StDiagnostic {
    StSeverity  severity = StSeverity::ERROR;
    std::string code;               /* xem st_diag_code::* — luôn set khi ok=false */
    std::string message;            /* tiếng Anh kỹ thuật, ngắn gọn */
    std::string source_id;          /* rỗng nếu single-source (chưa có multi-file) */
    int         line = 0;           /* 1-based; 0 = không xác định được vị trí */
    int         column = 0;         /* 1-based */
    int         length = 1;         /* số ký tự bị đánh dấu, tối thiểu 1 */

    bool has_position() const { return line > 0 && column > 0; }
};

} // namespace core

#endif /* CORE_ST_DIAGNOSTIC_HPP */
