/**
 * @file  st_program.hpp
 * @brief FW-SOM-ST-001: typed IR tối thiểu cho một chương trình Structured Text
 *        (IEC 61131-3-aligned subset). KHÔNG phải full ST — chỉ REAL/BOOL,
 *        VAR_INPUT/VAR_OUTPUT, assignment, so sánh '>', IF..THEN..ELSE..END_IF.
 *        Không có LD/SFC/loop/CASE/toán tử số học — cố ý tối thiểu theo scope
 *        FW-SOM-ST-001, không phải giới hạn kỹ thuật của parser.
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
};

struct StExpr {
    enum class Kind { VAR, LITERAL, GT };
    Kind        kind = Kind::LITERAL;
    std::string var_name;                 /* Kind::VAR */
    StValue     literal;                  /* Kind::LITERAL */
    std::unique_ptr<StExpr> lhs;          /* Kind::GT */
    std::unique_ptr<StExpr> rhs;          /* Kind::GT */
    StType      result_type = StType::REAL;  /* điền bởi semantic check (st_semantic.cpp) */
};

struct StStmt {
    enum class Kind { ASSIGN, IF };
    Kind        kind = Kind::ASSIGN;
    std::string assign_target;            /* Kind::ASSIGN */
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
