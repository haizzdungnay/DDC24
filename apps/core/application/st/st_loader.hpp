/**
 * @file  st_loader.hpp
 * @brief Nạp và VERIFY artifact Typed IR, theo quy trình 22 bước ở
 *        TYPED_IR_ARTIFACT_SPEC §6.
 *
 *        Đây là ranh giới tin cậy duy nhất giữa "cái BE gửi xuống" và "cái
 *        runtime chạy". Sau khi load thành công, executor KHÔNG kiểm biên
 *        nữa (§6.1) — mọi slot, mọi đích nhảy, mọi chỉ số FB đã được chứng
 *        minh nằm trong biên ở đây.
 *
 *        Hệ quả bắt buộc: một lỗi trong file này là lỗi AN TOÀN BỘ NHỚ, nên
 *        loader nằm trong phạm vi fuzzing bắt buộc.
 */
#ifndef CORE_ST_LOADER_HPP
#define CORE_ST_LOADER_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "st/st_ir.hpp"

namespace core {

/* Mã lỗi trả cho BE (SPEC §8). Mọi lỗi đều GIỮ NGUYÊN package đang chạy. */
namespace st_ir_error {
constexpr const char* kBadHeader        = "IR-E-001";
constexpr const char* kBadMagic         = "IR-E-002";
constexpr const char* kBadSchema        = "IR-E-003";
constexpr const char* kBadAbi           = "IR-E-004";
constexpr const char* kBadHash          = "IR-E-005";
constexpr const char* kBadSignature     = "IR-E-006";
constexpr const char* kMissingSignature = "IR-E-007";
constexpr const char* kBadSectionTable  = "IR-E-008";
constexpr const char* kMissingSection   = "IR-E-009";
constexpr const char* kResourceLimit    = "IR-E-010";
constexpr const char* kBadTable         = "IR-E-011";
constexpr const char* kBadIoBinding     = "IR-E-012";
constexpr const char* kBadProfile       = "IR-E-013";
constexpr const char* kBadCode          = "IR-E-014";
constexpr const char* kOutOfMemory      = "IR-E-015";
} // namespace st_ir_error

struct StLoadError {
    std::string code;
    std::string message;
};

/* Một ô trong không gian slot. Kiểu KHÔNG lưu ở đây — nó đến từ trường `type`
 * của lệnh, đã được loader kiểm hợp lệ. Đổi lại: ô đúng 8 byte, truy cập O(1),
 * không cấp phát. */
union StCell {
    bool    b;
    int32_t i;
    float   r;
    int64_t t;
};

/* Trạng thái bền của một instance Function Block. */
struct StFbState {
    bool    prev_clk = false;    /* R_TRIG / F_TRIG */
    bool    timing = false;      /* TON / TOF đang đếm */
    int64_t start_ns = 0;
    bool    q = false;

    /* PID (TASK-PROG-303, DDD-CTRL-PROG-001 §7). TASK-PROG-402 lưu state
     * bằng codec wire canonical; pid_prev_call_ns được rebase khi restore vì
     * timestamp monotonic không có nghĩa qua process restart. */
    float   pid_integral = 0.0f;
    float   pid_prev_pv = 0.0f;
    float   pid_prev_output = 0.0f;
    int64_t pid_prev_call_ns = 0;
    bool    pid_first = true;
};

/* Chương trình đã nạp và đã cấp phát xong toàn bộ bộ nhớ thực thi.
 * Sau khi có đối tượng này, mỗi chu kỳ chạy KHÔNG cấp phát thêm gì. */
struct StLoadedProgram {
    std::string program_name;
    uint64_t    source_hash = 0;
    uint8_t     sha256[32] = {0};

    std::vector<StCell>          slots;
    uint32_t                     var_slot_count = 0;
    std::vector<StInstr>         code;
    std::vector<StIrVariable>    variables;
    std::vector<StIrFbInstance>  fb_instances;
    std::vector<StFbState>       fb_states;
    std::vector<StIrIoBinding>   io_bindings;
    std::vector<StIrRetainEntry> retain_entries;
    uint32_t                     retain_layout_hash = 0;
    uint32_t                     retain_record_size = 0;
    /* SHA-256 canonical của stable variable/FB identity + type + offset.
     * Artifact schema 1 chỉ mang layout_hash u32; digest mạnh này được
     * runtime dựng lại một lần khi prepare để record RETAIN v2 chống va chạm
     * CRC32 và không phải hash tên trong đường scan. */
    uint8_t                      retain_layout_sha256[32] = {0};
    std::vector<StIrSourceMap>   source_map;

    bool has_retain() const
    {
        if (!retain_entries.empty()) return true;
        for (const StIrFbInstance& fb : fb_instances)
            if (fb.retained) return true;
        return false;
    }

    /* Đặt mọi slot biến về giá trị khởi tạo và nạp hằng vào vùng hằng. */
    void reset_to_initial();
    /* Tra dòng/cột ST của một pc, 0 nếu không có source map. */
    void source_position(uint32_t pc, int* line, int* column) const;
};

enum class StIntegrityMode : uint8_t {
    HASH_ONLY = 0,
    SIGNATURE_REQUIRED = 1,
    /* Có tên để parser cấu hình phát hiện và từ chối tường minh. Không có
     * đường thực thi nào được phép dùng chế độ này. */
    SIGNATURE_OPTIONAL = 2,
};

struct StLoaderOptions {
    /* Rev A khóa ở HASH_ONLY: SHA-256 luôn bắt buộc. SIGNATURE_OPTIONAL bị
     * từ chối fail-closed, không phải một cách viết khác của HASH_ONLY. */
    StIntegrityMode integrity_mode = StIntegrityMode::HASH_ONLY;
    /* Khoá công khai Ed25519 32 byte. nullptr = dùng khoá nhúng trong build. */
    const uint8_t* public_key = nullptr;
};

struct StArtifactSummary {
    uint16_t schema_version = 0;
    uint16_t compiler_profile = 0;
    uint32_t target_abi = 0;
    uint32_t artifact_bytes = 0;
    uint16_t section_count = 0;
    StIntegrityMode integrity_mode = StIntegrityMode::HASH_ONLY;
    bool signature_present = false;
    uint8_t sha256[32] = {0};
};

/* API contract Rev A. Cả Verify và Load đều không sửa output khi thất bại. */
bool VerifyArtifact(const uint8_t* data, std::size_t size, const StLoaderOptions& opts,
                    StArtifactSummary* summary, StLoadError* err);
bool LoadArtifact(const uint8_t* data, std::size_t size, const StLoaderOptions& opts,
                  StLoadedProgram* out, StLoadError* err);

/* Tên cũ giữ tương thích source trong một release. */
inline bool load_st_artifact(const uint8_t* data, std::size_t size,
                             const StLoaderOptions& opts, StLoadedProgram* out,
                             StLoadError* err)
{
    return LoadArtifact(data, size, opts, out, err);
}

/* Khoá công khai đang được build nhúng — dùng cho test và cho lệnh chẩn đoán. */
const uint8_t* st_builtin_public_key();

} // namespace core

#endif /* CORE_ST_LOADER_HPP */
