/**
 * @file  st_program.hpp
 * @brief FW SOM IEC programming foundation: typed IR cho một chương trình
 *        Structured Text (IEC 61131-3-aligned subset). KHÔNG phải full ST —
 *        REAL/BOOL, VAR_INPUT/VAR_OUTPUT, assignment, so sánh đầy đủ
 *        (>,>=,<,<=,=,<>), boolean AND/OR/NOT, ngoặc đơn, gọi hàm chuẩn tối
 *        thiểu (hiện: LIMIT), IF..THEN..ELSE..END_IF.
 *        KHÔNG có: FUNCTION_BLOCK instance/state, TIME type, LD/SFC, loop,
 *        CASE — cố ý tối thiểu theo scope hiện tại, không phải giới hạn kỹ
 *        thuật của parser. Xem docs/04_design/INTERFACES.md "FW SOM IEC
 *        programming contract" cho danh sách function chuẩn ĐÃ implement
 *        (không được suy diễn thêm từ file này).
 */
#ifndef CORE_ST_PROGRAM_HPP
#define CORE_ST_PROGRAM_HPP

#include <map>
#include <memory>
#include <string>
#include <vector>

namespace core {

enum class StType { REAL, BOOL };

struct StValue {
    StType type = StType::REAL;
    float  real_value = 0.0f;
    bool   bool_value = false;
};

/* Input/output image: tên biến (đã khai báo trong VAR_INPUT/VAR_OUTPUT) → giá trị.
 * Đây là "input snapshot"/"output staging" phía ST program, tách biệt với
 * IoSnapshot/OutputCmd của SOM I/O image (group 3/4) — ST program là 1 layer
 * chạy TRÊN runtime substrate đó, không thay thế nó. */
using StIoImage = std::map<std::string, StValue>;

struct StVarDecl {
    std::string name;
    StType      type = StType::REAL;
    int         line = 0;
    int         column = 0;
};

enum class StCompareOp { GT, GE, LT, LE, EQ, NE };

struct StExpr {
    enum class Kind { VAR, LITERAL, CMP, AND_, OR_, NOT_, CALL };
    Kind        kind = Kind::LITERAL;
    std::string var_name;                 /* Kind::VAR */
    StValue     literal;                  /* Kind::LITERAL */
    std::unique_ptr<StExpr> lhs;          /* Kind::CMP, AND_, OR_ */
    std::unique_ptr<StExpr> rhs;          /* Kind::CMP, AND_, OR_ */
    std::unique_ptr<StExpr> operand;      /* Kind::NOT_ */
    StCompareOp cmp_op = StCompareOp::GT; /* Kind::CMP */
    std::string call_name;                /* Kind::CALL — vd "LIMIT" */
    std::vector<std::unique_ptr<StExpr>> call_args;   /* Kind::CALL */
    StType      result_type = StType::REAL;  /* điền bởi semantic check (st_semantic.cpp) */
    int         line = 0;                 /* vị trí token đầu của expr — cho diagnostic */
    int         column = 0;
};

struct StStmt {
    enum class Kind { ASSIGN, IF };
    Kind        kind = Kind::ASSIGN;
    std::string assign_target;            /* Kind::ASSIGN */
    int         assign_target_line = 0;
    int         assign_target_column = 0;
    std::unique_ptr<StExpr> assign_expr;  /* Kind::ASSIGN */
    std::unique_ptr<StExpr> if_cond;      /* Kind::IF */
    std::vector<StStmt>     if_then;      /* Kind::IF */
    std::vector<StStmt>     if_else;      /* Kind::IF (có thể rỗng nếu không có ELSE) */
};

struct StProgram {
    std::string name;
    std::vector<StVarDecl> inputs;
    std::vector<StVarDecl> outputs;
    std::vector<StStmt>    body;
};

} // namespace core

#endif /* CORE_ST_PROGRAM_HPP */
