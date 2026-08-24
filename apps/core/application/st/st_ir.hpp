/**
 * @file  st_ir.hpp
 * @brief Typed IR — thứ mà runtime THỰC SỰ thực thi, theo đúng
 *        docs/02_design/software/TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md.
 *
 *        Đây là ranh giới bắt buộc của PROGRAM_SOM_FW_DRAFT_DESIGN §4:
 *        runtime không bao giờ thực thi source ST. Compiler sinh IR, ký, rồi
 *        runtime chỉ nhận artifact đã verify.
 *
 *        Máy IR là MÁY THANH GHI trên một mảng ô phẳng (slot). Bố trí:
 *            [0 .. var_slot_count)          biến, ghi được
 *            [var_slot_count .. slot_count) hằng, chỉ đọc
 *        Loader kiểm mọi `dst` < var_slot_count, nên "hằng không ghi đè được"
 *        là bất biến KIỂM ĐƯỢC chứ không phải quy ước.
 */
#ifndef CORE_ST_IR_HPP
#define CORE_ST_IR_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "mkddc_shm.h"
#include "st/st_program.hpp"
#include "st/st_profile_generated.hpp"

namespace core {

/* ---- Hằng số định dạng file (SPEC §2) ---- */

namespace st_ir {

constexpr char        kMagic[8]        = {'M','K','D','D','C','I','R','1'};
constexpr uint16_t    kSchemaVersion   = 1;
constexpr uint16_t    kCompilerProfile = st_profile_generated::kProfileCode;
constexpr uint32_t    kTargetAbi       = st_profile_generated::kTargetAbi;
constexpr uint32_t    kHeaderSize      = 128;
constexpr uint32_t    kMaxArtifactSize = st_profile_generated::kMaxArtifactBytes;
constexpr uint32_t    kInstructionSize = 16;
constexpr const char* kCompilerVersion = "fwsom-st-1.2.0";

/* flags (SPEC §2.4) */
constexpr uint16_t kFlagHasSourceMap = 1u << 0;
constexpr uint16_t kFlagHasRetain    = 1u << 1;
constexpr uint16_t kFlagSigned       = 1u << 2;

/* section_type (SPEC §2.6) */
enum SectionType : uint16_t {
    SEC_METADATA        = 0x0001,
    SEC_CONSTANTS       = 0x0002,
    SEC_VARIABLES       = 0x0003,
    SEC_CODE            = 0x0004,
    SEC_IO_BINDING      = 0x0005,
    SEC_FB_INSTANCES    = 0x0006,
    SEC_RETAIN_LAYOUT   = 0x0007,
    SEC_DEBUG_SOURCEMAP = 0x0008,
    SEC_SIGNAL_REFS     = 0x0009,
};

/* Giới hạn tài nguyên artifact (SPEC §7) */
constexpr uint32_t kMaxInstructions = st_profile_generated::kMaxInstructions;
constexpr uint32_t kMaxSlots        = st_profile_generated::kMaxSlots;
constexpr uint32_t kMaxVarSlots     = st_profile_generated::kMaxWritableSlots;
constexpr uint32_t kMaxConstants    = st_profile_generated::kMaxConstants;
constexpr uint32_t kMaxFbInstances  = st_profile_generated::kMaxFunctionBlocks;
constexpr uint32_t kMaxIoBindings   = st_profile_generated::kMaxBindings;
constexpr uint32_t kMaxRetainVars   = st_profile_generated::kMaxRetainVariables;
constexpr uint32_t kMaxRetainRecord = st_profile_generated::kMaxRetainBytes;
constexpr uint16_t kMaxSections     = st_profile_generated::kMaxSections;

} // namespace st_ir

/* ---- Opcode (SPEC §5.3) ---- */

enum class StOp : uint8_t {
    NOP          = 0x00,
    HALT         = 0x01,
    JMP          = 0x02,
    JMP_IF_FALSE = 0x03,
    MOV          = 0x10,
    ADD          = 0x20,
    SUB          = 0x21,
    MUL          = 0x22,
    DIV          = 0x23,
    MOD          = 0x24,
    NEG          = 0x25,
    LT           = 0x30,
    LE           = 0x31,
    GT           = 0x32,
    GE           = 0x33,
    EQ           = 0x34,
    NE           = 0x35,
    AND          = 0x40,
    OR           = 0x41,
    XOR          = 0x42,
    NOT          = 0x43,
    ABS          = 0x50,
    MIN          = 0x51,
    MAX          = 0x52,
    LIMIT        = 0x53,
    SEL          = 0x54,
    SQRT         = 0x55,
    CVT_I2R      = 0x60,
    CVT_R2I      = 0x61,
    CVT_T2R      = 0x62,
    CVT_R2T      = 0x63,
    CVT_I2D      = 0x64,
    CVT_I2U      = 0x65,
    CVT_D2I      = 0x66,
    CVT_D2U      = 0x67,
    CVT_U2I      = 0x68,
    CVT_U2D      = 0x69,
    CVT_D2R      = 0x6A,
    CVT_U2R      = 0x6B,
    CVT_R2D      = 0x6C,
    CVT_R2U      = 0x6D,
    FB_CALL      = 0x70,
    SIGNAL_READ  = 0x71,
    SIGNAL_PUBLISH = 0x72,
};

/* Lệnh, cố định 16 byte. Trường không dùng bởi opcode PHẢI bằng 0 — loader
 * kiểm và reject nếu khác, để chặn kênh dữ liệu ẩn và bắt lỗi sinh mã sớm. */
struct StInstr {
    StOp     op = StOp::NOP;
    StType   type = StType::BOOL;   /* 0 = VOID được mã hoá bằng type_raw = 0 */
    uint8_t  type_raw = 0;          /* giá trị thô ghi ra file: 0 hoặc wire code 1..6 */
    uint16_t dst = 0;
    uint16_t a = 0;
    uint16_t b = 0;
    uint16_t c = 0;
    uint16_t aux = 0;
    uint32_t imm = 0;
};

/* ---- Bảng dữ liệu ---- */

struct StIrVariable {
    std::string name;
    StType      type = StType::REAL;
    StStorage   storage = StStorage::VAR_LOCAL;
    uint16_t    slot = 0;
    StValue     init;
};

struct StIrFbInstance {
    std::string name;
    StFbType    fb_type = StFbType::NONE;
    uint16_t    input_slot_base = 0;
    uint16_t    output_slot_base = 0;
    uint16_t    state_index = 0;
    bool        retained = false;
};

/* Runtime kind chi tiết nằm dưới ba category Product đã duyệt:
 * LOCAL={UI,DI,AO,DO}, VP={AV,BV,MSV}, MB_RTU={EXT}. Giá trị wire 0..6 giữ
 * nguyên; EXT dùng giá trị mới 7 nên artifact cũ vẫn byte-compatible. */
enum class StPointKind : uint8_t {
    UI = 0,
    DI = 1,
    AO = 2,
    DO = 3,
    AV = 4,
    BV = 5,
    MSV = 6,
    EXT = 7,
};

enum class StPointCategory : uint8_t { LOCAL = 0, VP = 1, MB_RTU = 2 };

inline StPointCategory st_point_category(StPointKind kind)
{
    switch (kind) {
    case StPointKind::UI:
    case StPointKind::DI:
    case StPointKind::AO:
    case StPointKind::DO: return StPointCategory::LOCAL;
    case StPointKind::AV:
    case StPointKind::BV:
    case StPointKind::MSV: return StPointCategory::VP;
    case StPointKind::EXT: return StPointCategory::MB_RTU;
    }
    return StPointCategory::LOCAL;
}

inline const char* st_point_category_name(StPointCategory category)
{
    switch (category) {
    case StPointCategory::LOCAL: return "LOCAL";
    case StPointCategory::VP: return "VP";
    case StPointCategory::MB_RTU: return "MB_RTU";
    }
    return "LOCAL";
}

/* Ma trận type/direction Rev A. Point Catalog còn phải xác minh identity,
 * unit, writable và generation tại Check/Commission; loader vẫn khóa những
 * tổ hợp chắc chắn sai để artifact không tới được scan path. */
inline bool st_point_kind_allows_output(StPointKind kind)
{
    return kind != StPointKind::UI && kind != StPointKind::DI;
}

inline bool st_point_kind_allows_type(StPointKind kind, StType type)
{
    switch (kind) {
    case StPointKind::UI:
    case StPointKind::AO:
    case StPointKind::AV: return type == StType::REAL;
    case StPointKind::DI:
    case StPointKind::DO:
    case StPointKind::BV: return type == StType::BOOL;
    case StPointKind::MSV: return type == StType::UINT;
    case StPointKind::EXT: return type != StType::TIME;
    }
    return false;
}

inline uint16_t st_point_kind_limit(StPointKind kind)
{
    switch (kind) {
    case StPointKind::UI: return KX_N_UI;
    case StPointKind::DI: return KX_N_DI;
    case StPointKind::AO: return KX_N_AO;
    case StPointKind::DO: return KX_N_DO;
    case StPointKind::AV: return KX_N_AV;
    case StPointKind::BV: return KX_N_BV;
    case StPointKind::MSV: return KX_N_MSV;
    case StPointKind::EXT: return KX_N_EXT;
    }
    return 0;
}

struct StIrIoBinding {
    uint16_t    slot = 0;
    bool        is_output = false;
    StPointKind point_kind = StPointKind::UI;
    uint16_t    point_index = 0;   /* 1-based */
    StType      type = StType::REAL;
    float       scale_min = 0.0f;
    float       scale_max = 0.0f;
};

struct StIrRetainEntry {
    uint16_t slot = 0;
    StType   type = StType::REAL;
    uint32_t offset = 0;
};

struct StIrSourceMap {
    uint32_t pc = 0;
    uint16_t line = 0;
    uint16_t column = 0;
};

/* Tham chiếu signal nằm trong artifact theo TÊN/type/quyền. Coordinator đối
 * chiếu với SIGNAL_DEFS của package rồi điền `runtime_index` một lần trước
 * PREPARED; executor không tra chuỗi. */
struct StIrSignalRef {
    std::string name;
    StType type = StType::REAL;
    bool read = false;
    bool publish = false;
    int16_t runtime_index = -1;
};

/* IR đầy đủ trong bộ nhớ. Đây là dạng compiler sinh ra và loader dựng lại. */
struct StIrModule {
    std::string program_name;
    uint64_t    source_hash = 0;
    std::string compiler_version = st_ir::kCompilerVersion;
    uint64_t    build_timestamp = 0;

    uint32_t slot_count = 0;
    uint32_t var_slot_count = 0;

    std::vector<StValue>         constants;   /* nạp vào slot [var_slot_count..) */
    std::vector<StIrVariable>    variables;
    std::vector<StInstr>         code;
    std::vector<StIrIoBinding>   io_bindings;
    std::vector<StIrFbInstance>  fb_instances;
    std::vector<StIrRetainEntry> retain_entries;
    uint32_t                     retain_layout_hash = 0;
    uint32_t                     retain_record_size = 0;
    std::vector<StIrSourceMap>   source_map;
    std::vector<StIrSignalRef>   signal_refs;

    std::size_t retained_fb_count() const
    {
        std::size_t count = 0;
        for (const StIrFbInstance& fb : fb_instances)
            if (fb.retained) ++count;
        return count;
    }
    bool has_retain() const { return !retain_entries.empty() || retained_fb_count() != 0; }
};

/* ---- Serialize ---- */

/* Sinh byte artifact CHƯA ký: điền magic/header/section, tính SHA-256, để
 * vùng chữ ký bằng 0 và cờ kSigned = 0.
 * Trả false nếu module vượt giới hạn §7 (`*error` mô tả). */
bool serialize_st_ir(const StIrModule& mod, std::vector<uint8_t>* out, std::string* error);

/* Ký artifact đã serialize bằng khoá riêng Ed25519 64 byte: ghi chữ ký vào
 * offset 64 và bật cờ kSigned. Trả false nếu buffer không hợp lệ. */
bool sign_st_artifact(std::vector<uint8_t>* artifact, const uint8_t secret_key[64]);

/* ADR-052 — sinh cặp khoá ký cho MỘT thiết bị.
 *
 * Khoá thiết bị là thứ duy nhất cho phép bật `SIGNATURE_REQUIRED` mà vẫn giữ
 * được cam kết "biên dịch ngay trên bo": artifact do bo tự sinh phải được ký
 * bởi một khoá mà bo có, và khoá hãng thì theo định nghĩa không bao giờ nằm
 * trên bo. Khoá này sinh MỘT LẦN lúc provisioning; sinh lại đồng nghĩa vô hiệu
 * hoá mọi artifact đang chạy, kể cả LKG — tức phá đúng đường lùi.
 *
 * Trả false nếu libsodium chưa khởi tạo được. */
bool generate_signing_keypair(uint8_t public_key[32], uint8_t secret_key[64]);

/* SHA-256 của artifact theo quy tắc §3.1 (vùng hash và chữ ký coi như 0). */
bool compute_artifact_sha256(const uint8_t* data, std::size_t size, uint8_t out[32]);

} // namespace core

#endif /* CORE_ST_IR_HPP */
