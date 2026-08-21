/**
 * @file  st_package_v2.hpp
 * @brief T59-106 — container artifact package v2 (`MKDDCIR2`): writer, loader và
 *        dual-reader v1/v2 (DDD-SW-PROG-UNIFIED-001 §5.3, §12.1).
 *
 *        Vì sao có container riêng thay vì mở rộng v1: artifact v1 mô tả MỘT
 *        Program. Package v2 phải mang nhiều Program cùng bảng POU, khóa thư
 *        viện, định nghĩa signal, manifest binding và ngân sách tài nguyên. Nhồi
 *        chúng vào v1 sẽ làm mọi loader v1 hiện có đọc sai một cách im lặng.
 *
 *        Mã IR của từng Program KHÔNG được viết lại: section `CODE_IR` chứa đúng
 *        các blob v1 do `serialize_st_ir` sinh ra. Viết lại codegen chỉ để đổi vỏ
 *        chứa là cách chắc chắn nhất để hai bộ ngữ nghĩa trôi khỏi nhau.
 */
#ifndef CORE_ST_PACKAGE_V2_HPP
#define CORE_ST_PACKAGE_V2_HPP

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "st/st_fb_instance_layout.hpp"
#include "st/st_pou_registry.hpp"

namespace core {

namespace st_pkg {

constexpr char     kMagic[8]       = {'M', 'K', 'D', 'D', 'C', 'I', 'R', '2'};
constexpr uint16_t kSchemaVersion  = 2;
constexpr uint16_t kLayoutVersion  = 2;
constexpr uint32_t kHeaderSize     = 128;
constexpr uint32_t kSectionEntrySize = 16;
constexpr uint32_t kMaxArtifactBytes = 16u * 1024u * 1024u;
constexpr uint16_t kMaxSections    = 32;

/* Thứ tự canonical đúng theo `artifact_v2.schema.json`. Section KHÔNG bắt buộc
 * phải có mặt hết, nhưng nếu có thì bảng section phải tăng dần theo giá trị này —
 * bảng lộn xộn là dấu hiệu artifact bị ghép tay. */
enum SectionType : uint16_t {
    SEC_POU_TABLE            = 0x0001,
    SEC_PROGRAM_TABLE        = 0x0002,
    SEC_TYPE_SIGNATURE_TABLE = 0x0003,
    SEC_CODE_IR              = 0x0004,
    SEC_CONSTANTS            = 0x0005,
    SEC_FB_LAYOUT            = 0x0006,
    SEC_SIGNAL_DEFS          = 0x0007,
    SEC_BINDING_MANIFEST     = 0x0008,
    SEC_SOURCE_MAP           = 0x0009,
    SEC_LIBRARY_LOCK         = 0x000A,
    SEC_RETAIN_LAYOUT        = 0x000B,
    SEC_RESOURCE_BUDGET      = 0x000C,
};

constexpr uint16_t kFlagHasSignals      = 1u << 0;
constexpr uint16_t kFlagHasLibraryLock  = 1u << 1;
constexpr uint16_t kFlagHasMultiProgram = 1u << 2;
constexpr uint16_t kFlagHasRetain       = 1u << 3;

} // namespace st_pkg

/* Mã lỗi loader package. Tách khỏi họ `IR-E-*` của v1 vì hai định dạng có hai
 * cách sửa khác nhau: `IR-E-*` là "artifact một Program hỏng", còn `PKG-E-*` là
 * "gói nhiều Program hỏng". */
namespace st_pkg_error {
constexpr const char* kBadHeader       = "PKG-E-001";
constexpr const char* kBadMagic        = "PKG-E-002";
constexpr const char* kBadSchema       = "PKG-E-003";
constexpr const char* kBadProfile      = "PKG-E-004";
constexpr const char* kBadHash         = "PKG-E-005";
constexpr const char* kBadSectionTable = "PKG-E-006";
constexpr const char* kBadRecord       = "PKG-E-007";
constexpr const char* kResourceLimit   = "PKG-E-008";
constexpr const char* kOutputOwner     = "PKG-E-009";
constexpr const char* kSignalPublisher = "PKG-E-010";
} // namespace st_pkg_error

struct StPackageProgram {
    std::string program_name;
    /* Blob v1 do `serialize_st_ir` sinh; container KHÔNG diễn giải lại nội dung. */
    std::vector<uint8_t> ir_blob;
    /* Chu kỳ release riêng của Program (DDD §7.1). 0 = theo chu kỳ Task, giữ cho
     * package một Program không phải khai gì thêm. Chu kỳ phải nằm trong ba lớp
     * của profile: một lớp lập lịch không tồn tại chỉ biểu hiện thành deadline
     * miss ở runtime chứ không thành một câu trả lời hiểu được. */
    uint32_t period_ms = 0;
    /* Ngân sách WCET của Program trong một lần release, đơn vị µs. 0 = chưa đo.
     * Đi trong package chứ không suy ở runtime: đây là số Check đã tính trên
     * toàn bộ Revision, còn runtime chỉ thấy từng lần chạy. */
    uint32_t budget_us = 0;
};

struct StPackageSignal {
    std::string name;
    std::string producer_program;
    uint8_t     data_type = 0;
    uint32_t    freshness_ms = 1000;
};

struct StPackageBinding {
    std::string owner_program;
    uint8_t     point_category = 0;
    std::string point_id;
    bool        is_output = false;
};

struct StPackageLibraryLock {
    std::string system_version;
    std::array<uint8_t, 32> system_sha256{};
    std::string project_revision_id;
};

struct StPackageInput {
    uint16_t compiler_profile = 0;
    uint32_t target_abi = 0;
    std::vector<StPackageProgram> programs;
    std::vector<StPouSignature>   pou_signatures;
    std::vector<StFbInstanceNode> fb_instances;
    std::vector<StPackageSignal>  signals;
    std::vector<StPackageBinding> bindings;
    StPackageLibraryLock          library_lock;
    uint32_t retain_bytes = 0;
};

struct StPackageHeaderView {
    uint16_t schema_version = 0;
    uint16_t compiler_profile = 0;
    uint32_t target_abi = 0;
    uint16_t layout_version = 0;
    uint16_t section_count = 0;
    uint16_t flags = 0;
    uint32_t artifact_bytes = 0;
};

struct StPackageView {
    StPackageHeaderView header;
    std::vector<std::string> program_names;
    /* Song song 1-1 với `program_names`. Giữ hai vector thay vì một struct để
     * caller chỉ cần tên (đa số) không phải kéo theo phần còn lại. */
    std::vector<uint32_t> program_periods_ms;
    std::vector<uint32_t> program_budget_us;
    std::vector<std::string> pou_names;
    std::vector<std::string> signal_names;
    std::vector<std::string> output_point_ids;
    uint32_t fb_instance_count = 0;
    uint32_t retain_bytes = 0;
    std::string library_system_version;
};

/* Ghi package v2. Trả false kèm `*error` khi input vượt trần profile hoặc thiếu
 * dữ liệu bắt buộc; không bao giờ ghi ra artifact dở dang. */
bool WritePackageV2(const StPackageInput& input, std::vector<uint8_t>* out,
                    std::string* error);

/* Nội dung đã giải nén của package: cùng dữ liệu `StPackageView` kiểm, cộng các
 * blob IR v1 theo đúng thứ tự Program trong bảng PROGRAM_TABLE. Coordinator cần
 * blob để nạp từng Program; `StPackageView` cố ý không mang chúng vì phần lớn
 * caller chỉ cần khung. */
struct StPackageContents {
    StPackageView view;
    std::vector<std::vector<uint8_t>> program_ir;
};

/* Nạp package v2 VÀ giữ lại blob IR. Dùng đúng một parser với `LoadPackageV2` —
 * hai bộ parser cho một định dạng là hai bộ ngữ nghĩa để trôi khỏi nhau. */
bool UnpackPackageV2(const uint8_t* data, std::size_t size, uint16_t expected_profile,
                     uint32_t expected_abi, StPackageContents* out, const char** error_code);

/* Nạp package v2. Kiểm toàn bộ offset/count/overflow, exact profile, hash, và hai
 * bất biến cấp package: một output binding chỉ có một Program owner, một signal
 * chỉ có một publisher. */
bool LoadPackageV2(const uint8_t* data, std::size_t size, uint16_t expected_profile,
                   uint32_t expected_abi, StPackageView* out, const char** error_code);

/* Dual-reader theo DDD §12.1: nhận cả artifact v1 (một Program) lẫn package v2.
 * `*is_v2` cho biết đường nào đã dùng. Artifact v1 chỉ được kiểm ở mức khung —
 * nội dung của nó do loader v1 hiện hữu chịu trách nhiệm. */
bool ProbePackageFormat(const uint8_t* data, std::size_t size, bool* is_v2,
                        const char** error_code);

} // namespace core

#endif /* CORE_ST_PACKAGE_V2_HPP */
