/**
 * @file  st_pou_registry.hpp
 * @brief T59-102 — bảng ký hiệu, call graph và phân giải Control Library cho
 *        tập POU của một Project (DDD-SW-PROG-UNIFIED-001 §0, §6).
 *
 *        Parser cố ý KHÔNG phán tên nào hợp lệ: nó chỉ ghi `USER_CALL` kèm tên.
 *        Registry là nơi duy nhất biết cả tập POU của Project lẫn library đã pin,
 *        nên nó là nơi duy nhất phân biệt được ba tình huống có ba cách sửa khác
 *        nhau: entry chưa tồn tại, entry sai version, và gọi vòng.
 *
 *        Mọi đầu ra đều SẮP XẾP ỔN ĐỊNH theo tên: thứ tự nạp POU không được làm
 *        đổi kết quả Check, nếu không thì hai lần Check cùng nguồn cho hai
 *        diagnostic khác nhau.
 */
#ifndef CORE_ST_POU_REGISTRY_HPP
#define CORE_ST_POU_REGISTRY_HPP

#include <string>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_program.hpp"

namespace core {

/* Một entry Control Library đã pin. `version` là chuỗi khớp đúng — resolver
 * không tự nâng cấp hay hạ cấp, vì "gần đúng version" là cách âm thầm đổi hành
 * vi điều khiển. */
struct StLibraryEntry {
    std::string name;
    StPouKind   kind = StPouKind::FUNCTION;
    std::string version;
};

/* Yêu cầu library mà một POU khai. Thiếu entry hoặc lệch version đều fail-closed. */
struct StLibraryRequirement {
    std::string name;
    std::string version;
};

struct StPouSource {
    const StProgram* pou = nullptr;
    std::vector<StLibraryRequirement> requires_library;
};

/* Cạnh call graph đã phân giải, sắp xếp ổn định theo (caller, callee). */
struct StCallEdge {
    std::string caller;
    std::string callee;
    bool        callee_is_library = false;
    int         line = 0;
    int         column = 0;
};

/* Chữ ký đã phân giải của một POU gọi được. Registry công bố bảng này để lớp
 * lowering (T59-105/T59-106) type-check lời gọi mà KHÔNG phải tự dựng lại bảng ký
 * hiệu — hai bảng song song là cách drift bắt đầu. */
struct StPouSignature {
    std::string name;
    StPouKind   kind = StPouKind::FUNCTION;
    bool        from_library = false;
    std::vector<StType> input_types;
    bool        has_return_type = false;
    StType      return_type = StType::REAL;
};

struct StPouRegistryResult {
    /* Tên POU của Project, sắp xếp case-folded tăng dần. */
    std::vector<std::string> pou_order;
    std::vector<StCallEdge>  edges;
    /* Thứ tự topo của POU Project: callee đứng trước caller. Chỉ điền khi ok. */
    std::vector<std::string> topological_order;
    /* Chữ ký mọi POU Project, sắp xếp ổn định theo tên case-folded. */
    std::vector<StPouSignature> signatures;
};

/* Dựng bảng ký hiệu + call graph, phân giải library và kiểm DAG.
 *
 * false = có vi phạm, `*diag` mang mã ổn định:
 *   ST-POU-001  tên/kind/chữ ký sai: trùng tên, trùng entry SYSTEM library (mơ hồ),
 *               gọi PROGRAM, gọi FUNCTION_BLOCK như hàm, hoặc sai số đối số
 *   ST-POU-002  FUNCTION không thuần: giữ state, có kênh ra thứ hai, hoặc gọi
 *               một POU có state
 *   ST-POU-003  đệ quy trực tiếp hoặc gián tiếp (kể cả vòng qua library)
 *   ST-LIB-001  gọi tên không có ở POU Project lẫn library đã pin
 *   ST-LIB-002  entry library tồn tại nhưng lệch version đã pin
 *
 * Vì sao kiểm purity Ở ĐÂY dù parser đã kiểm: parser chỉ thấy nguồn ST. AST còn
 * đến từ lowering FBD (T59-105), và một producer mới không được phép bỏ qua quy
 * tắc chỉ vì nó không đi qua parser. Registry là điểm hội tụ của MỌI producer. */
bool st_build_pou_registry(const std::vector<StPouSource>& sources,
                           const std::vector<StLibraryEntry>& library,
                           StPouRegistryResult* out,
                           StDiagnostic* diag);

} // namespace core

#endif /* CORE_ST_POU_REGISTRY_HPP */
