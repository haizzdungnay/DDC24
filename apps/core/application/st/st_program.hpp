/**
 * @file  st_program.hpp
 * @brief AST của một chương trình Structured Text, theo đúng
 *        docs/02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md (MS-02/C0.4).
 *
 *        ĐÂY LÀ AST, KHÔNG PHẢI IR. Cấu trúc này là kết quả trung gian của
 *        compiler (con trỏ, cây, không serialize được). Typed IR — thứ mà
 *        runtime thực sự thực thi — nằm ở st_ir.hpp và có định dạng nhị phân
 *        riêng theo TYPED_IR_ARTIFACT_SPEC (MS-01/C0.6).
 *
 *        Ranh giới này là bắt buộc: PROGRAM_SOM_FW_DRAFT_DESIGN §4 quy định
 *        runtime không được thực thi trực tiếp source ST. AST chỉ tồn tại
 *        trong tiến trình compile, không bao giờ đi vào mkddc-core.
 */
#ifndef CORE_ST_PROGRAM_HPP
#define CORE_ST_PROGRAM_HPP

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace core {

/* ---- Hệ kiểu (SPEC §3.1) ---- */

enum class StType : uint8_t {
    BOOL = 1,
    DINT = 2,
    REAL = 3,
    TIME = 4,
    INT  = 5,
    UINT = 6,
};

const char* st_type_name(StType t);
bool st_type_is_integer(StType t);
bool st_type_is_signed_integer(StType t);
int64_t st_integer_min(StType t);
int64_t st_integer_max(StType t);

/* Giá trị vô hướng. TIME lưu bằng nanosecond (int64, không âm — SPEC §3.1). */
struct StValue {
    StType  type = StType::REAL;
    bool    b = false;
    int32_t i = 0;
    float   r = 0.0f;
    int64_t t = 0;

    static StValue make_bool(bool v) { StValue s; s.type = StType::BOOL; s.b = v; return s; }
    static StValue make_int(int32_t v) { StValue s; s.type = StType::INT; s.i = v; return s; }
    static StValue make_dint(int32_t v) { StValue s; s.type = StType::DINT; s.i = v; return s; }
    static StValue make_uint(uint16_t v) { StValue s; s.type = StType::UINT; s.i = v; return s; }
    static StValue make_integer(StType type, int32_t v)
    {
        StValue s;
        s.type = type;
        s.i = v;
        return s;
    }
    static StValue make_real(float v) { StValue s; s.type = StType::REAL; s.r = v; return s; }
    static StValue make_time(int64_t v) { StValue s; s.type = StType::TIME; s.t = v; return s; }
};

bool st_value_equal(const StValue& a, const StValue& b);

/* ---- Lớp lưu trữ biến (SPEC §2) ---- */

enum class StStorage : uint8_t {
    VAR_INPUT  = 0,
    VAR_OUTPUT = 1,
    VAR_LOCAL  = 2,
    VAR_RETAIN = 3,
};

/* ---- Function Block chuẩn (SPEC §6.2) ---- */

enum class StFbType : uint16_t {
    NONE   = 0,
    TON    = 1,
    TOF    = 2,
    R_TRIG = 3,
    F_TRIG = 4,
    /* TASK-PROG-303: PID vòng đơn, back-calculation anti-windup theo
     * DDD-CTRL-PROG-001 §7. Giá trị wire mới 5, artifact cũ (1..4) vẫn
     * byte-compatible. */
    PID    = 5,
    /* `T59-804`/`DDD-CTRL-PROG-001` §7A. Ba block chuẩn IEC thêm sau PID; giá
     * trị 1..5 giữ nguyên nên artifact cũ vẫn byte-compatible. */
    TP     = 6,
    CTU    = 7,
    CTD    = 8,
};

StFbType st_fb_type_from_name(const std::string& name);
const char* st_fb_type_name(StFbType t);

/* Số slot vào/ra của mỗi loại FB — dùng chung bởi compiler và loader nên
 * không ai được tự đoán bố trí. Xem TYPED_IR_ARTIFACT_SPEC §4.5. */
int st_fb_input_count(StFbType t);
int st_fb_output_count(StFbType t);
/* Số byte canonical dùng để lưu trạng thái nội bộ của một FB RETAIN.
 * Đây là kích thước wire, không phải sizeof(StFbState): tuyệt đối không ghi
 * padding/ABI của compiler ra đĩa. */
std::size_t st_fb_retain_state_size(StFbType t);
/* Tên tham số vào thứ `idx` (vd TON: 0="IN", 1="PT"), nullptr nếu ngoài biên. */
const char* st_fb_input_name(StFbType t, int idx);
StType st_fb_input_type(StFbType t, int idx);
/* Tên đầu ra thứ `idx` (vd TON: 0="Q", 1="ET"). */
const char* st_fb_output_name(StFbType t, int idx);
StType st_fb_output_type(StFbType t, int idx);

/* ---- Khai báo ---- */

struct StVarDecl {
    std::string name;
    StType      type = StType::REAL;
    StStorage   storage = StStorage::VAR_LOCAL;
    int         line = 0;
    int         column = 0;
    int         length = 1;
};

struct StFbDecl {
    std::string name;
    StFbType    fb_type = StFbType::NONE;
    /* T59-104: instance của FUNCTION_BLOCK do người dùng hoặc Control Library
     * định nghĩa. Cùng lý do với `USER_CALL`: parser không biết tập POU nên nó
     * chỉ GHI LẠI tên kiểu; registry mới phân giải. `fb_type` giữ `NONE` cho
     * trường hợp này để không có đường nào nhầm nó với FB dựng sẵn. */
    bool        is_user_type = false;
    std::string user_type_name;
    bool        retained = false;
    int         line = 0;
    int         column = 0;
    int         length = 1;
};

/* ---- Toán tử ---- */

enum class StBinOp : uint8_t {
    ADD, SUB, MUL, DIV, MOD,
    LT, LE, GT, GE, EQ, NE,
    AND, OR, XOR,
};

enum class StUnOp : uint8_t { NEG, NOT };

/* Hàm chuẩn (SPEC §6.1). Giữ enum thay vì so tên chuỗi lúc compile để
 * semantic và codegen không lệch nhau khi đổi tên hiển thị. */
enum class StFunc : uint8_t {
    ABS, MIN, MAX, LIMIT, SEL, SQRT,
    INT_TO_REAL, REAL_TO_INT, TIME_TO_REAL, REAL_TO_TIME,
    INT_TO_DINT, INT_TO_UINT, DINT_TO_INT, DINT_TO_UINT,
    UINT_TO_INT, UINT_TO_DINT, DINT_TO_REAL, UINT_TO_REAL,
    REAL_TO_DINT, REAL_TO_UINT,
};

bool st_func_from_name(const std::string& name, StFunc* out);
const char* st_func_name(StFunc f);
int st_func_arity(StFunc f);

/* ---- Biểu thức ---- */

struct StExpr {
    enum class Kind : uint8_t {
        LITERAL,      /* literal đã biết kiểu, hoặc literal nguyên đa hình */
        VAR,          /* tham chiếu biến */
        MEMBER,       /* inst.Q — truy cập đầu ra FB */
        BINOP,
        UNOP,
        CALL,         /* hàm chuẩn */
        /* T59-102: gọi FUNCTION do người dùng hoặc Control Library định nghĩa.
         * Parser KHÔNG tự phán tên nào hợp lệ — nó chỉ ghi lại tên; việc phân
         * giải là của `st_pou_registry`, nơi biết cả tập POU của Project lẫn
         * library đã pin. Tách hai việc này là điều kiện để có được thông điệp
         * "thiếu entry" khác với "sai version" khác với "đệ quy". */
        USER_CALL,
        /* T59-404/F-P59-SIGNAL-001: đọc Published Signal bằng contract đã
         * pin ở Check. Tên được giữ trong artifact để coordinator resolve một
         * lần; executor chỉ dùng index, không tra chuỗi trong scan. */
        SIGNAL_READ,
    };

    Kind kind = Kind::LITERAL;

    StValue     literal;
    /* Literal nguyên không có dấu chấm là ĐA HÌNH (SPEC §3.4): kiểu thật do
     * ngữ cảnh quyết định ở semantic phase. Cờ này cho semantic biết nó được
     * phép ép sang INT hoặc REAL. */
    bool        literal_polymorphic = false;
    int64_t     literal_int_value = 0;   /* giá trị nguyên gốc trước khi chọn kiểu */

    std::string var_name;                /* VAR */
    std::string member_object;           /* MEMBER: tên instance */
    std::string member_field;            /* MEMBER: tên đầu ra */

    StBinOp     bin_op = StBinOp::ADD;
    StUnOp      un_op = StUnOp::NEG;
    std::unique_ptr<StExpr> lhs;
    std::unique_ptr<StExpr> rhs;
    std::unique_ptr<StExpr> operand;

    StFunc      func = StFunc::ABS;
    std::string user_call_name;          /* USER_CALL: tên POU/entry được gọi */
    std::string signal_name;             /* SIGNAL_READ */
    std::vector<std::unique_ptr<StExpr>> args;

    StType      result_type = StType::REAL;   /* điền bởi st_semantic */
    int         line = 0;
    int         column = 0;
    int         length = 1;
};

/* ---- Câu lệnh ---- */

struct StFbArg {
    std::string name;                    /* tên tham số, vd "IN", "PT" */
    std::unique_ptr<StExpr> value;
    int line = 0;
    int column = 0;
    int length = 1;
};

/* Một nhánh của IF/ELSIF. */
struct StStmt;
struct StIfBranch {
    std::unique_ptr<StExpr> cond;        /* nullptr = nhánh ELSE */
    std::vector<StStmt>     body;
};

struct StStmt {
    enum class Kind : uint8_t { ASSIGN, IF, FB_CALL, SIGNAL_PUBLISH };

    Kind kind = Kind::ASSIGN;

    /* ASSIGN */
    std::string assign_target;
    int         assign_target_line = 0;
    int         assign_target_column = 0;
    int         assign_target_length = 1;
    std::unique_ptr<StExpr> assign_expr;

    /* IF: branches[0] là IF, các phần tử giữa là ELSIF, phần tử cuối có
     * cond == nullptr là ELSE (nếu có). */
    std::vector<StIfBranch> branches;

    /* FB_CALL */
    std::string           fb_instance;
    std::vector<StFbArg>  fb_args;
    int                   fb_line = 0;
    int                   fb_column = 0;
    int                   fb_length = 1;

    /* SIGNAL_PUBLISH(name, value); — side effect duy nhất được phép ở source.
     * Runtime chỉ flush bản ghi sau khi toàn bộ cycle thành công. */
    std::string             signal_name;
    std::unique_ptr<StExpr> signal_value;
    int                     signal_line = 0;
    int                     signal_column = 0;
    int                     signal_length = 1;
};

/* Contract compiler nhận từ Revision/package manifest. `producer_program`
 * là runtime Program ID, không phải objectId/sourceId. */
struct StPublishedSignalContract {
    std::string name;
    StType type = StType::REAL;
    std::string producer_program;
};

/* ---- Chương trình ---- */

/* ---- T59-101: ba loại POU (DDD-SW-PROG-UNIFIED-001 §0, §4.2) ----
 *
 * Ba loại dùng CHUNG một AST vì thân chúng là cùng một ngôn ngữ; khác biệt nằm ở
 * chữ ký và ở quyền hạn. Tách thành ba struct riêng sẽ nhân bản toàn bộ parser,
 * semantic và lowering — đúng thứ đã sinh ra drift ở registry library. */
enum class StPouKind : uint8_t {
    PROGRAM        = 0,
    FUNCTION       = 1,
    FUNCTION_BLOCK = 2,
};

const char* st_pou_kind_name(StPouKind kind);
bool st_pou_kind_from_keyword(const std::string& upper, StPouKind* out);

/* Độ dài tên POU theo DDD §4.2 (IEC identifier 1..64). */
constexpr std::size_t kMaxPouNameLength = 64;

struct StProgram {
    /* Mặc định PROGRAM để mọi call site cũ giữ nguyên nghĩa. */
    StPouKind   kind = StPouKind::PROGRAM;
    std::string name;

    /* Chỉ FUNCTION có kiểu trả về; hai loại còn lại phải để `has_return_type`
     * bằng false. Bất biến này do parser ép, không phải quy ước ngầm. */
    bool        has_return_type = false;
    StType      return_type = StType::REAL;

    int line = 0;      /* vị trí của tên POU, cho source map */
    int column = 0;
    int length = 1;

    std::vector<StVarDecl> vars;      /* mọi khối VAR_*, phân biệt bằng storage */
    std::vector<StFbDecl>  fbs;
    std::vector<StStmt>    body;

    /* Tiện ích: lọc theo storage — dùng bởi validate gateway và io_map. */
    std::vector<const StVarDecl*> by_storage(StStorage s) const;
};

} // namespace core

#endif /* CORE_ST_PROGRAM_HPP */
