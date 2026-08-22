/**
 * @file  st_compile.hpp
 * @brief Sinh Typed IR từ AST đã typecheck. Đây là bước cuối của compiler —
 *        sau nó AST bị vứt bỏ và chỉ artifact đi tiếp tới runtime.
 *
 *        Điểm mấu chốt: mọi biến, hằng và cổng FB được cấp SLOT CỐ ĐỊNH ngay
 *        tại đây. Nhờ vậy runtime truy cập biến bằng chỉ số O(1), không tra
 *        tên bằng chuỗi, và toàn bộ bộ nhớ thực thi cấp phát được một lần
 *        lúc load (PROGRAM_SOM_FW_DRAFT_DESIGN §7.2).
 */
#ifndef CORE_ST_COMPILE_HPP
#define CORE_ST_COMPILE_HPP

#include <string>

#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_program.hpp"

namespace core {

/* AST (đã qua typecheck_st_program) -> IR. `source` chỉ dùng để tính
 * source_hash truy vết. Trả false + *diag khi vượt giới hạn tài nguyên. */
bool compile_st_to_ir(const StProgram& prog, const std::string& source, StIrModule* out,
                      StDiagnostic* diag);

/* Chính sách compile ở biên Check. Mặc định BẬT review gate, nên mọi call site
 * production (CLI Check, worker) được gate mà không phải nhớ bật.
 * `enforce_review_gate=false` CHỈ dành cho bộ test conformance của chính feature
 * đang bị gate — nó là nơi dựng evidence Controls/Safety. Không có cờ CLI, header
 * HTTP hay trường payload nào đặt được giá trị này. */
struct StCompileOptions {
    bool enforce_review_gate = true;
};

/* Tiện ích một bước cho CLI và test: source -> parse -> typecheck -> review gate
 * -> IR. */
bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag);
bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag,
                       const StCompileOptions& options);

} // namespace core

#endif /* CORE_ST_COMPILE_HPP */
