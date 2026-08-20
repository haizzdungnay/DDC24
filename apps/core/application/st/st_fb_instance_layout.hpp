/**
 * @file  st_fb_instance_layout.hpp
 * @brief T59-104 — layout state cho instance FUNCTION_BLOCK, quyền sở hữu RETAIN
 *        và identity ổn định (DDD-SW-PROG-UNIFIED-001 §4.3, §4.4).
 *
 *        Hai bất biến quyết định mọi thứ còn lại:
 *
 *        1. IDENTITY và OFFSET của một instance KHÔNG được đổi khi người dùng sắp
 *           xếp lại khai báo trong nguồn. Nếu đổi, mỗi lần chỉnh sửa vô hại sẽ
 *           làm RETAIN mismatch và cold-init toàn bộ state đang chạy.
 *        2. Mọi state đều thuộc ĐÚNG MỘT Program owner. Không có state dùng chung
 *           giữa Program, vì đó là shared writable memory mà DDD §0 cấm.
 *
 *        Cách bảo đảm (1): layout đi theo THỨ TỰ TÊN canonical, không theo thứ tự
 *        xuất hiện trong nguồn.
 */
#ifndef CORE_ST_FB_INSTANCE_LAYOUT_HPP
#define CORE_ST_FB_INSTANCE_LAYOUT_HPP

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_pou_registry.hpp"
#include "st/st_program.hpp"

namespace core {

namespace st_fb_layout {
constexpr std::size_t kDigestBytes = 32;
/* Chiều sâu lồng nhau tối đa của instance. Vòng chứa đã bị chặn riêng; trần này
 * chặn cây hợp lệ nhưng sâu tới mức tốn bộ nhớ không lường trước được. */
constexpr std::size_t kMaxNestingDepth = 8;
} // namespace st_fb_layout

struct StFbInstanceNode {
    /* Đường dẫn canonical `Program.instance.sub` — đây LÀ identity người đọc
     * được; hash bên dưới chỉ là dạng cố định độ dài của nó. */
    std::string path;
    std::string owner_program;
    std::string type_name;
    bool        is_user_type = false;
    bool        is_library_type = false;
    bool        retained = false;
    std::size_t depth = 0;
    uint32_t    state_offset = 0;
    uint32_t    state_size = 0;
    std::array<uint8_t, st_fb_layout::kDigestBytes> identity{};
};

struct StFbLayoutResult {
    /* Sắp xếp theo `path`; hai lần chạy trên cùng nguồn cho cùng thứ tự. */
    std::vector<StFbInstanceNode> instances;
    uint32_t total_state_bytes = 0;
    uint32_t retain_state_bytes = 0;
    /* Đổi bất kỳ instance/kiểu/offset nào là đổi giá trị này, nên runtime phát
     * hiện được layout mismatch và cold-init thay vì đọc nhầm state cũ. */
    std::array<uint8_t, st_fb_layout::kDigestBytes> layout_identity{};
};

/* Hoạch định layout cho toàn bộ instance FB của các PROGRAM trong `sources`.
 *
 * false = vi phạm, `*diag` mang mã ổn định:
 *   ST-POU-001  kiểu instance phân giải ra FUNCTION hoặc PROGRAM
 *   ST-POU-003  vòng chứa instance (A chứa B chứa A) hoặc quá sâu
 *   ST-POU-004  vượt trần instance của package, hoặc state vượt trần RETAIN
 *   ST-LIB-001  kiểu instance không có ở POU Project lẫn library đã pin
 */
bool st_plan_fb_instance_layout(const std::vector<StPouSource>& sources,
                                const std::vector<StLibraryEntry>& library,
                                StFbLayoutResult* out,
                                StDiagnostic* diag);

} // namespace core

#endif /* CORE_ST_FB_INSTANCE_LAYOUT_HPP */
