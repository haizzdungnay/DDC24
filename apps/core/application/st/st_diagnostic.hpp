/**
 * @file  st_diagnostic.hpp
 * @brief Hợp đồng diagnostic của compiler ST: `StDiagnostic` (một mục, có
 *        vị trí/severity/code để FE bôi đúng chỗ và BE forward JSON ổn định,
 *        không phải string tự do) và `StDiagnosticBag` (danh sách nhiều mục
 *        theo `DDD-LANG-PROG-001` §7 — trần 64, sort tất định, chạm trần thì
 *        gắn đúng một `ST-LIM-006`).
 *
 *        `ISS-STED-01` đổi kiến trúc từ fail-fast một lỗi sang thu nhiều lỗi:
 *        parser và semantic vẫn *bỏ dở* câu lệnh đang hỏng, nhưng PHỤC HỒI ở
 *        ranh giới câu lệnh/khai báo rồi đi tiếp, nên một vòng Kiểm tra trả
 *        về mọi lỗi độc lập thay vì bắt người dùng sửa từng lỗi một.
 */
#ifndef CORE_ST_DIAGNOSTIC_HPP
#define CORE_ST_DIAGNOSTIC_HPP

#include <algorithm>
#include <cstddef>
#include <string>
#include <vector>

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
/* TASK-PROG-304: Task overrun ngân sách 3 lần liên tiếp (OD-PROG-012).
 * Chuyển đúng TASK đó FAULT, không phải lỗi của riêng một Program. */
constexpr const char* kRtTaskOverrun     = "ST-RT-010";
/* Published Signal WAIT/unavailable là trạng thái có thể phục hồi, không làm
 * Program FAULTED. Publish bị từ chối sau khi package đã bind là lỗi runtime
 * contract và phải fail-closed cả chu kỳ. */
constexpr const char* kRtSignalWait      = "ST-RT-011";
constexpr const char* kRtSignalPublish   = "ST-RT-012";
/* Ref đã bind nhưng runtime bank không còn khai báo tương ứng là contract drift,
 * không phải tình trạng dữ liệu tạm thời. Chờ sẽ tạo vòng WAIT vô hạn nên phải
 * fault fail-closed để operator thấy lỗi package/runtime. */
constexpr const char* kRtSignalContract  = "ST-RT-013";

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
/* T59-006: số Program trong package vượt trần profile (32). Tách khỏi
 * ST-LIM-003/004 vì đây là trần cấp PACKAGE, không phải cấp Program. */
constexpr const char* kTooManyPrograms      = "ST-LIM-009";

/* IO map validation (st_io_map.hpp) */
constexpr const char* kIoMapUnknownVar      = "ST-IOMAP-001";
constexpr const char* kIoMapBadDirection    = "ST-IOMAP-002";
constexpr const char* kIoMapTypeMismatch    = "ST-IOMAP-003";
constexpr const char* kIoMapBadPointId      = "ST-IOMAP-004";
constexpr const char* kIoMapBadRange        = "ST-IOMAP-005";
constexpr const char* kIoMapMissingBinding  = "ST-IOMAP-006";
constexpr const char* kIoMapDuplicateBinding = "ST-IOMAP-007";
/* F-PROG-ASBUILT-013/D-07: category hợp lệ về mặt định danh (LOCAL/VP/
 * MB_RTU) nhưng chưa có đường dẫn runtime thật qua resolve_io_bindings() —
 * hiện chỉ LOCAL được hỗ trợ. Tách khỏi ST-IOMAP-004 (identity sai format)
 * vì đây là "đúng nhưng chưa hỗ trợ", không phải "sai cú pháp". */
constexpr const char* kIoMapUnsupportedCategory = "ST-IOMAP-008";

/* ---- T59-004: họ mã cho POU, Control Library, Published Signal, output owner
 * và PID review.
 *
 * Contract đi trước consumer (Plan 59 §1.2 quy tắc 1): các hằng này là bảng liệt
 * kê dùng chung, được ghim vào catalog ngay ở W0 để mọi emitter thêm sau ở
 * W1..W4 không thể xuất hiện mà thiếu ánh xạ public code. Generator kiểm HAI
 * CHIỀU: mã có trong source mà thiếu trong catalog -> build fail; mã có trong
 * catalog mà không emitter nào khai -> build fail. */

/* POU: quy tắc kind/purity/recursion/state (DDD §0, §6). */
constexpr const char* kPouSignatureInvalid   = "ST-POU-001";
constexpr const char* kPouFunctionNotPure    = "ST-POU-002";
constexpr const char* kPouRecursion          = "ST-POU-003";
constexpr const char* kPouInstanceLayout     = "ST-POU-004";
/* PROGRAM POU tồn tại trong Revision nhưng chưa có programConfig/chu kỳ chạy.
 * Draft được phép giữ trạng thái này; Check/packager phải fail-closed, không tự
 * gán chu kỳ 1000 ms hay âm thầm loại POU khỏi package. */
constexpr const char* kPouScheduleMissing    = "ST-POU-005";

/* Control Library: resolve/version/dependency (DDD §0, §6). */
constexpr const char* kLibraryEntryMissing   = "ST-LIB-001";
constexpr const char* kLibraryVersionDrift   = "ST-LIB-002";
constexpr const char* kLibraryDependencyCycle = "ST-LIB-003";

/* Published Signal: publisher/type/freshness (DDD §4.5, §7.3). */
constexpr const char* kSignalDuplicatePublisher = "ST-SIG-001";
constexpr const char* kSignalTypeMismatch       = "ST-SIG-002";
constexpr const char* kSignalFreshnessRange     = "ST-SIG-003";
constexpr const char* kSignalConsumerMissing    = "ST-SIG-004";
constexpr const char* kSignalReadContext        = "ST-SIG-005";

/* Output ownership: một binding output chỉ có một Program owner (DDD §4.6). */
constexpr const char* kOutputOwnerConflict   = "ST-OWN-001";

/* PID chỉ dùng được khi có approval token Controls/Safety (DDD §9). */
constexpr const char* kPidApprovalMissing    = "ST-PID-001";

/* ---- ISS-STED-02: cảnh báo (ST_SUBSET_SPEC §12.6) --------------------------
 *
 * Cảnh báo KHÔNG chặn sinh artifact và KHÔNG làm Check FAILED. Chính sách nâng
 * cảnh báo thành lỗi là thuộc tính của compiler profile (SPEC §C0.6), không
 * phải của ngôn ngữ — nên emitter ở đây luôn phát severity WARNING, việc nâng
 * cấp do tầng trên quyết.
 *
 * `ST-WARN-001` (PT timer nhỏ hơn chu kỳ Task) CHƯA hiện thực: compiler không
 * nhận chu kỳ Task làm đầu vào, mọi phán quyết về nó sẽ là đoán mò. Hằng vẫn
 * khai để catalog và tài liệu có một nguồn duy nhất. */
constexpr const char* kWarnTimerPtBelowCycle = "ST-WARN-001";
constexpr const char* kWarnUnusedVariable    = "ST-WARN-002";
constexpr const char* kWarnOutputNeverWritten = "ST-WARN-003";
/* DDD-LANG-PROG-001 §4.3: đọc output của một FB instance TRƯỚC lời gọi của nó
 * trong cùng chu kỳ đọc ra giá trị của chu kỳ trước. Hợp lệ (nhiều thuật toán
 * điều khiển cố ý dùng), nhưng gần như luôn là nhầm lẫn nên DDD bắt buộc phải
 * cảnh báo. Tách khỏi ST-WARN-002/003 vì nguyên nhân và cách sửa khác hẳn. */
constexpr const char* kWarnFbOutputReadBeforeCall = "ST-WARN-004";
} // namespace st_diag_code

struct StDiagnostic {
    StSeverity  severity = StSeverity::ERROR;
    std::string code;               /* xem st_diag_code::* — luôn set khi ok=false */
    std::string message;            /* tiếng Anh kỹ thuật, ngắn gọn */
    std::string source_id;          /* rỗng nếu single-source (chưa có multi-file) */
    int         line = 0;           /* 1-based; 0 = không xác định được vị trí */
    int         column = 0;         /* 1-based */
    int         length = 1;         /* số ký tự bị đánh dấu, tối thiểu 1 */
    /* ISS-STED-01: thứ hạng của Program/POU trong package. Khoá sắp xếp cấp
     * cao nhất sau `source_id`, để diagnostic của cùng một POU không bị trộn
     * lẫn khi nhiều POU cùng lỗi. Producer nào không biết thứ hạng thì để 0 —
     * mọi diagnostic khi đó cùng hạng và luật sắp xếp lùi về location/code. */
    int         order = 0;

    bool has_position() const { return line > 0 && column > 0; }
};

/* ---- ISS-STED-01: túi diagnostic nhiều phần tử ----------------------------
 *
 * `DDD-LANG-PROG-001` §7: tối đa 64 diagnostic, sort theo
 * `program/order/location/code`; chạm trần thì thêm ĐÚNG MỘT `ST-LIM-006` ở
 * cuối mảng.
 *
 * Vì sao là một lớp chứ không phải `std::vector` trần: ba bất biến phải đi
 * cùng dữ liệu, nếu để call site tự lo thì sớm muộn có nơi quên một cái —
 * (1) trần 64 áp SAU khi sort (cắt trước khi sort thì bỏ mất lỗi đứng đầu
 * nguồn chỉ vì nó được phát hiện muộn), (2) `ST-LIM-006` luôn là phần tử
 * CUỐI và chỉ có một, (3) thứ tự phải TẤT ĐỊNH giữa hai lần chạy — nên
 * `stable_sort` cộng khoá phụ là chỉ số chèn, không phụ thuộc thứ tự duyệt
 * container/hash ở tầng trên.
 *
 * Túi vẫn thu diagnostic sau khi chạm trần (tới `kHardCap`) rồi mới cắt, vì
 * một lỗi phát hiện muộn có thể đứng TRƯỚC theo location. Chỉ dừng ghi ở
 * `kHardCap` để nguồn bệnh hoạn không thổi bộ nhớ. */
class StDiagnosticBag {
public:
    /* Trần công bố ở DDD §7. Đổi số này là đổi hợp đồng với BE/FE. */
    static constexpr std::size_t kMaxDiagnostics = 64;
    /* Trần cứng nội bộ, KHÔNG phải hợp đồng: chỉ chặn cấp phát vô hạn. */
    static constexpr std::size_t kHardCap = 4096;

    void add(const StDiagnostic& diagnostic)
    {
        if (items_.size() >= kHardCap) { ++dropped_; return; }
        items_.push_back(diagnostic);
    }

    void add(StDiagnostic&& diagnostic)
    {
        if (items_.size() >= kHardCap) { ++dropped_; return; }
        items_.push_back(std::move(diagnostic));
    }

    bool empty() const { return items_.empty(); }
    std::size_t size() const { return items_.size(); }
    const std::vector<StDiagnostic>& items() const { return items_; }

    bool has_error() const
    {
        for (const StDiagnostic& d : items_)
            if (d.severity == StSeverity::ERROR) return true;
        return false;
    }

    /* Diagnostic ERROR đầu tiên theo thứ tự đã sort — nguồn cho các API một
     * diagnostic còn lại (không phải "phần tử [0]", vì [0] có thể là WARNING). */
    const StDiagnostic* first_error() const
    {
        for (const StDiagnostic& d : items_)
            if (d.severity == StSeverity::ERROR) return &d;
        return nullptr;
    }

    void clear() { items_.clear(); dropped_ = 0; truncated_ = false; }

    bool truncated() const { return truncated_; }

    /* Sort ổn định + áp trần + gắn `ST-LIM-006`. Gọi được nhiều lần: lần thứ
     * hai không thêm `ST-LIM-006` thứ hai vì mảng đã ở trạng thái cuối. */
    void finalize()
    {
        if (truncated_) return;
        std::stable_sort(items_.begin(), items_.end(), less);
        if (items_.size() > kMaxDiagnostics || dropped_ > 0) {
            const StDiagnostic anchor =
                items_.empty() ? StDiagnostic{} : items_.front();
            if (items_.size() > kMaxDiagnostics)
                items_.resize(kMaxDiagnostics);
            StDiagnostic limit;
            limit.severity = StSeverity::ERROR;
            limit.code = st_diag_code::kDiagnosticsTruncated;
            limit.message = "diagnostic list truncated at " +
                            std::to_string(kMaxDiagnostics) + " entries";
            limit.source_id = anchor.source_id;
            limit.order = anchor.order;
            limit.line = 0;
            limit.column = 0;
            limit.length = 1;
            items_.push_back(limit);
            truncated_ = true;
        }
    }

private:
    /* Khoá sắp xếp theo đúng thứ tự công bố: program (`source_id`), `order`,
     * location (`line`, `column`), rồi `code`. `stable_sort` giữ chỉ số chèn
     * làm khoá cuối, nên hai diagnostic trùng toàn bộ khoá vẫn ra cùng thứ tự
     * ở mọi lần chạy. */
    static bool less(const StDiagnostic& a, const StDiagnostic& b)
    {
        if (a.source_id != b.source_id) return a.source_id < b.source_id;
        if (a.order != b.order) return a.order < b.order;
        if (a.line != b.line) return a.line < b.line;
        if (a.column != b.column) return a.column < b.column;
        return a.code < b.code;
    }

    std::vector<StDiagnostic> items_;
    std::size_t dropped_ = 0;
    bool truncated_ = false;
};

} // namespace core

#endif /* CORE_ST_DIAGNOSTIC_HPP */
