/**
 * @file  st_semantic.hpp
 * @brief Phân tích ngữ nghĩa cho AST ST, theo ST_SUBSET_SPEC §3 (hệ kiểu),
 *        §4.2 (bảng kiểu toán tử), §5 (câu lệnh), §6 (thư viện chuẩn).
 *
 *        Nhiệm vụ:
 *        - dựng bảng ký hiệu (biến + instance FB), bắt trùng tên;
 *        - giải quyết literal nguyên ĐA HÌNH theo ngữ cảnh (SPEC §3.4);
 *        - kiểm kiểu chặt, không ép ngầm giữa biến (SPEC §3.3);
 *        - điền `result_type` cho MỌI StExpr — compiler dựa vào đây để chọn
 *          opcode, nên thiếu một node là sinh mã sai;
 *        - kiểm luật riêng của FB: gọi tối đa 1 lần/chu kỳ, tham số đặt tên
 *          hợp lệ, chỉ đọc đầu ra qua truy cập thành viên.
 *
 *        Phục hồi ở ranh giới CÂU LỆNH và KHAI BÁO (`ISS-STED-01`): overload
 *        nhận `StDiagnosticBag*` thu mọi lỗi độc lập trong một lượt; overload
 *        không nhận túi giữ nguyên fail-fast cũ.
 */
#ifndef CORE_ST_SEMANTIC_HPP
#define CORE_ST_SEMANTIC_HPP

#include "st/st_diagnostic.hpp"
#include "st/st_pou_registry.hpp"
#include "st/st_program.hpp"

namespace core {

/* true  = hợp lệ; mọi StExpr::result_type đã điền, mọi literal đa hình đã
 *         được chốt kiểu thật trong StExpr::literal.
 * false = *diag mô tả lỗi đầu tiên. */
bool typecheck_st_program(StProgram* prog, StDiagnostic* diag);

/* ISS-STED-01: thu MỌI lỗi ngữ nghĩa phục hồi được vào `*bag` thay vì dừng ở
 * lỗi đầu. `*diag` vẫn mang lỗi đầu tiên — hợp đồng cũ không đổi. */
bool typecheck_st_program(StProgram* prog, StDiagnostic* diag, StDiagnosticBag* bag);

/* Registry-aware typecheck cho một tập POU đã phân giải. Khác entry legacy ở
 * trên, đường này hiểu USER_CALL và instance FUNCTION_BLOCK người dùng; mọi
 * producer ST/FBD cùng đi qua đúng một bảng chữ ký. */
bool typecheck_st_pou_set(const std::vector<StPouSource>& sources,
                          const StPouRegistryResult& registry,
                          StDiagnostic* diag,
                          const std::vector<StPublishedSignalContract>& signals = {},
                          const std::string& program_identity = {});

bool typecheck_st_pou_set(const std::vector<StPouSource>& sources,
                          const StPouRegistryResult& registry,
                          StDiagnostic* diag,
                          const std::vector<StPublishedSignalContract>& signals,
                          const std::string& program_identity,
                          StDiagnosticBag* bag);

} // namespace core

#endif /* CORE_ST_SEMANTIC_HPP */
