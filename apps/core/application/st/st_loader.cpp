#include "st/st_loader.hpp"

#include <cmath>
#include <cstring>
#include <string>
#include <new>
#include <utility>

#include <sodium.h>

#include "st/st_limits.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_public_key.hpp"

namespace core {

/* T59-607 — dịch chuỗi contract sang enum của loader.
 *
 * Không có nhánh mặc định "cho qua": một giá trị lạ trong profile là lỗi cấu
 * hình nghiêm trọng, và đoán bừa `HASH_ONLY` chính là hạ mức bảo vệ mà không ai
 * thấy. `SIGNATURE_REQUIRED` là lựa chọn an toàn duy nhất khi không đọc được. */
StIntegrityMode st_profile_integrity_mode()
{
    const std::string mode = st_profile_generated::kIntegrityMode;
    if (mode == "HASH_ONLY") return StIntegrityMode::HASH_ONLY;
    return StIntegrityMode::SIGNATURE_REQUIRED;
}
namespace {

uint16_t rd_u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t rd_u32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
uint64_t rd_u64(const uint8_t* p)
{
    uint64_t v = 0;
    for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
    return v;
}
float rd_f32(const uint8_t* p)
{
    const uint32_t bits = rd_u32(p);
    float f;
    std::memcpy(&f, &bits, sizeof(f));
    return f;
}
std::string rd_fixed_string(const uint8_t* p, std::size_t width)
{
    std::size_t n = 0;
    while (n < width && p[n] != 0) n++;
    return std::string(reinterpret_cast<const char*>(p), n);
}

bool valid_type_raw(uint8_t t)
{
    return t == st_profile_generated::kBoolWireCode ||
           t == st_profile_generated::kIntWireCode ||
           t == st_profile_generated::kDintWireCode ||
           t == st_profile_generated::kUintWireCode ||
           t == st_profile_generated::kRealWireCode ||
           t == st_profile_generated::kTimeWireCode;
}

std::size_t type_size(StType type)
{
    switch (type) {
    case StType::BOOL: return 1;
    case StType::INT:
    case StType::UINT: return 2;
    case StType::DINT:
    case StType::REAL: return 4;
    case StType::TIME: return 8;
    }
    return 0;
}

StValue rd_value(uint8_t type_raw, const uint8_t* p)
{
    switch (static_cast<StType>(type_raw)) {
    case StType::BOOL: return StValue::make_bool(p[0] != 0);
    case StType::INT:
        return StValue::make_int(static_cast<int16_t>(rd_u16(p)));
    case StType::DINT:
        return StValue::make_dint(static_cast<int32_t>(rd_u32(p)));
    case StType::UINT:
        return StValue::make_uint(rd_u16(p));
    case StType::REAL: return StValue::make_real(rd_f32(p));
    case StType::TIME: return StValue::make_time(static_cast<int64_t>(rd_u64(p)));
    }
    return StValue::make_bool(false);
}

bool valid_encoded_value(uint8_t type_raw, const uint8_t* p)
{
    const StType type = static_cast<StType>(type_raw);
    const std::size_t used = type_size(type);
    if (used == 0) return false;
    if (type == StType::BOOL && p[0] > 1) return false;
    if (type == StType::REAL && !std::isfinite(rd_f32(p))) return false;
    if (type == StType::TIME && rd_u64(p) > static_cast<uint64_t>(INT64_MAX)) return false;
    for (std::size_t i = used; i < 8; ++i)
        if (p[i] != 0) return false;
    return true;
}

struct SectionRef {
    uint16_t type = 0;
    uint32_t offset = 0;
    uint32_t size = 0;
    uint32_t item_count = 0;
    bool     present = false;
};

class Loader {
public:
    Loader(const uint8_t* d, std::size_t n, const StLoaderOptions& o, StLoadedProgram* out,
           StLoadError* err)
        : d_(d), n_(n), opts_(o), out_(out), err_(err) {}

    bool run()
    {
        if (!step_header()) return false;
        if (!step_integrity()) return false;
        if (!step_sections()) return false;
        if (!step_metadata()) return false;
        if (!step_constants()) return false;
        if (!step_variables()) return false;
        if (!step_fb_instances()) return false;
        if (!step_io_binding()) return false;
        if (!step_retain()) return false;
        if (!step_source_map()) return false;
        if (!step_signal_refs()) return false;
        if (!step_code()) return false;
        if (!step_profile()) return false;
        if (!step_allocate()) return false;
        return true;
    }

private:
    const uint8_t*   d_;
    std::size_t      n_;
    StLoaderOptions  opts_;
    StLoadedProgram* out_;
    StLoadError*     err_;

    uint16_t flags_ = 0;
    uint16_t section_count_ = 0;
    uint32_t total_size_ = 0;
    uint32_t slot_count_ = 0;
    uint32_t var_slot_count_ = 0;
    SectionRef sec_[10];   /* chỉ số theo SectionType 1..9 */

    bool fail(const char* code, const std::string& msg)
    {
        if (err_) { err_->code = code; err_->message = msg; }
        return false;
    }

    /* Bước 1-6 */
    bool step_header()
    {
        if (opts_.integrity_mode == StIntegrityMode::SIGNATURE_OPTIONAL)
            return fail(st_ir_error::kBadProfile,
                        "SIGNATURE_OPTIONAL is forbidden by the Rev A release profile");
        if (n_ < st_ir::kHeaderSize) return fail(st_ir_error::kBadHeader, "artifact smaller than header");
        if (n_ > st_ir::kMaxArtifactSize) return fail(st_ir_error::kBadHeader, "artifact exceeds 1 MiB");
        if (std::memcmp(d_, st_ir::kMagic, 8) != 0)
            return fail(st_ir_error::kBadMagic, "magic mismatch: not a MK-DDC IR artifact");
        if (rd_u16(d_ + 8) != st_ir::kSchemaVersion)
            return fail(st_ir_error::kBadSchema,
                        "unsupported schema version " + std::to_string(rd_u16(d_ + 8)));
        if (rd_u16(d_ + 10) != st_ir::kCompilerProfile)
            return fail(st_ir_error::kBadProfile,
                        "unsupported compiler profile " + std::to_string(rd_u16(d_ + 10)));
        if (rd_u32(d_ + 12) != st_ir::kTargetAbi)
            return fail(st_ir_error::kBadAbi, "target ABI mismatch");
        if (rd_u32(d_ + 16) != st_ir::kHeaderSize)
            return fail(st_ir_error::kBadHeader, "header_size field is wrong");
        total_size_ = rd_u32(d_ + 20);
        if (total_size_ != n_)
            return fail(st_ir_error::kBadHeader, "total_size does not match actual size");
        section_count_ = rd_u16(d_ + 24);
        flags_ = rd_u16(d_ + 26);
        constexpr uint16_t known_flags = st_ir::kFlagHasSourceMap |
                                         st_ir::kFlagHasRetain |
                                         st_ir::kFlagSigned;
        if ((flags_ & ~known_flags) != 0)
            return fail(st_ir_error::kBadHeader, "unknown artifact flag is set");
        if (rd_u32(d_ + 28) != 0) return fail(st_ir_error::kBadHeader, "reserved0 must be zero");
        if (section_count_ == 0 || section_count_ > st_ir::kMaxSections)
            return fail(st_ir_error::kBadSectionTable, "invalid section_count");
        return true;
    }

    /* Bước 7-8 */
    bool step_integrity()
    {
        uint8_t digest[32];
        if (!compute_artifact_sha256(d_, n_, digest))
            return fail(st_ir_error::kBadHash, "cannot compute artifact hash");
        /* sodium_memcmp: so sánh thời gian hằng. Không cần thiết về bảo mật ở
         * đây (attacker không đo được), nhưng dùng đúng công cụ vẫn tốt hơn. */
        if (sodium_memcmp(digest, d_ + 32, 32) != 0)
            return fail(st_ir_error::kBadHash, "SHA-256 mismatch: artifact is corrupt or modified");
        std::memcpy(out_->sha256, digest, 32);

        const bool signed_flag = (flags_ & st_ir::kFlagSigned) != 0;
        bool signature_nonzero = false;
        for (std::size_t i = 64; i < 128; ++i) signature_nonzero |= d_[i] != 0;
        if (!signed_flag) {
            if (signature_nonzero)
                return fail(st_ir_error::kBadSignature,
                            "signature field must be zero when signed flag is clear");
            if (opts_.integrity_mode == StIntegrityMode::SIGNATURE_REQUIRED)
                return fail(st_ir_error::kMissingSignature, "artifact is not signed");
            return true;
        }
        if (!signature_nonzero)
            return fail(st_ir_error::kBadSignature,
                        "signed flag is set but signature field is zero");
        /* Tập khoá tin cậy (T59-602): thử lần lượt, khớp một khoá là đủ. Khoá
         * cũ còn trong tập chính là thứ giữ cho đường rollback về LKG không bị
         * chặn bởi chính cơ chế bảo vệ nó. */
        if (opts_.trusted_key_count > 0) {
            const std::size_t count = opts_.trusted_key_count < kMaxTrustedKeys
                                          ? opts_.trusted_key_count
                                          : kMaxTrustedKeys;
            for (std::size_t index = 0; index < count; ++index) {
                const uint8_t* candidate = opts_.trusted_keys[index];
                if (candidate == nullptr) continue;
                if (crypto_sign_verify_detached(d_ + 64, digest, 32, candidate) == 0) {
                    std::memcpy(out_->verified_public_key, candidate, 32);
                    return true;
                }
            }
            return fail(st_ir_error::kBadSignature,
                        "Ed25519 signature does not match any trusted key");
        }
        const uint8_t* pk = opts_.public_key ? opts_.public_key : st_builtin_public_key();
        if (crypto_sign_verify_detached(d_ + 64, digest, 32, pk) != 0)
            return fail(st_ir_error::kBadSignature, "Ed25519 signature verification failed");
        std::memcpy(out_->verified_public_key, pk, 32);
        return true;
    }

    /* Bước 9-11 */
    bool step_sections()
    {
        const uint32_t table_end = st_ir::kHeaderSize + section_count_ * 16u;
        if (table_end > n_) return fail(st_ir_error::kBadSectionTable, "section table out of bounds");

        uint16_t prev_type = 0;
        uint32_t prev_end = 0;
        for (uint16_t i = 0; i < section_count_; i++) {
            const uint8_t* p = d_ + st_ir::kHeaderSize + i * 16u;
            const uint16_t type = rd_u16(p);
            if (rd_u16(p + 2) != 0)
                return fail(st_ir_error::kBadSectionTable, "section_flags must be zero");
            const uint32_t off = rd_u32(p + 4);
            const uint32_t size = rd_u32(p + 8);
            const uint32_t items = rd_u32(p + 12);

            if (i > 0 && type <= prev_type)
                return fail(st_ir_error::kBadSectionTable,
                            "sections must be sorted by type and unique");
            prev_type = type;

            if (off < table_end) return fail(st_ir_error::kBadSectionTable, "section overlaps table");
            if (off % 8 != 0) return fail(st_ir_error::kBadSectionTable, "section not 8-byte aligned");
            /* Cộng trên uint64 để phép cộng không tràn trước khi so sánh. */
            if (static_cast<uint64_t>(off) + size > n_)
                return fail(st_ir_error::kBadSectionTable, "section extends past end of file");
            if (off < prev_end) return fail(st_ir_error::kBadSectionTable, "sections overlap");
            prev_end = off + size;

            if (type >= 1 && type <= 9) {
                sec_[type] = SectionRef{type, off, size, items, true};
            } else if (type < 0x8000) {
                return fail(st_ir_error::kBadSectionTable,
                            "unknown mandatory section type " + std::to_string(type));
            }
            /* type >= 0x8000: mở rộng, runtime cũ được phép bỏ qua (SPEC §9) */
        }

        const uint16_t required[] = {
            st_ir::SEC_METADATA, st_ir::SEC_CONSTANTS, st_ir::SEC_VARIABLES,
            st_ir::SEC_CODE, st_ir::SEC_IO_BINDING, st_ir::SEC_FB_INSTANCES,
        };
        for (uint16_t t : required)
            if (!sec_[t].present)
                return fail(st_ir_error::kMissingSection,
                            "missing mandatory section " + std::to_string(t));
        if ((flags_ & st_ir::kFlagHasRetain) && !sec_[st_ir::SEC_RETAIN_LAYOUT].present)
            return fail(st_ir_error::kMissingSection, "RETAIN flag set but no RETAIN_LAYOUT section");
        if ((flags_ & st_ir::kFlagHasSourceMap) && !sec_[st_ir::SEC_DEBUG_SOURCEMAP].present)
            return fail(st_ir_error::kMissingSection, "source map flag set but no section");
        if (!(flags_ & st_ir::kFlagHasSourceMap) && sec_[st_ir::SEC_DEBUG_SOURCEMAP].present)
            return fail(st_ir_error::kBadHeader,
                        "source map section present while source map flag is clear");
        if (!(flags_ & st_ir::kFlagHasRetain) && sec_[st_ir::SEC_RETAIN_LAYOUT].present)
            return fail(st_ir_error::kBadHeader,
                        "RETAIN section present while RETAIN flag is clear");
        return true;
    }

    bool check_stride(const SectionRef& s, uint32_t stride, const char* what)
    {
        if (stride == 0) return true;
        if (static_cast<uint64_t>(s.item_count) * stride != s.size)
            return fail(st_ir_error::kBadSectionTable,
                        std::string(what) + " size does not match item_count");
        return true;
    }

    bool step_metadata()
    {
        const SectionRef& s = sec_[st_ir::SEC_METADATA];
        if (s.size < 128) return fail(st_ir_error::kBadTable, "METADATA too small");
        const uint8_t* p = d_ + s.offset;
        const uint32_t name_len = rd_u32(p);
        if (name_len > 64) return fail(st_ir_error::kBadTable, "program name length invalid");
        out_->program_name = rd_fixed_string(p + 4, 64);
        out_->source_hash = rd_u64(p + 68);
        slot_count_ = rd_u32(p + 116);
        var_slot_count_ = rd_u32(p + 120);
        if (rd_u32(p + 124) != 0) return fail(st_ir_error::kBadTable, "METADATA reserved must be zero");

        if (slot_count_ > st_ir::kMaxSlots || var_slot_count_ > st_ir::kMaxVarSlots)
            return fail(st_ir_error::kResourceLimit, "slot count exceeds limit");
        if (var_slot_count_ > slot_count_)
            return fail(st_ir_error::kBadTable, "var_slot_count exceeds slot_count");
        out_->var_slot_count = var_slot_count_;
        return true;
    }

    bool step_constants()
    {
        const SectionRef& s = sec_[st_ir::SEC_CONSTANTS];
        if (!check_stride(s, 16, "CONSTANTS")) return false;
        if (s.item_count > st_ir::kMaxConstants)
            return fail(st_ir_error::kResourceLimit, "constant count exceeds limit");
        /* Số hằng phải khớp đúng phần đuôi của không gian slot. */
        if (var_slot_count_ + s.item_count != slot_count_)
            return fail(st_ir_error::kBadTable,
                        "constant count does not fill the constant slot range");
        for (uint32_t i = 0; i < s.item_count; i++) {
            const uint8_t* p = d_ + s.offset + i * 16u;
            if (!valid_type_raw(p[0])) return fail(st_ir_error::kBadTable, "invalid constant type");
            for (int k = 1; k < 8; k++)
                if (p[k] != 0) return fail(st_ir_error::kBadTable, "constant padding must be zero");
            if (!valid_encoded_value(p[0], p + 8))
                return fail(st_ir_error::kBadTable, "constant value encoding is invalid");
            const_values_.push_back(rd_value(p[0], p + 8));
        }
        return true;
    }

    bool step_variables()
    {
        const SectionRef& s = sec_[st_ir::SEC_VARIABLES];
        if (!check_stride(s, 80, "VARIABLES")) return false;
        std::vector<bool> slot_used(slot_count_, false);
        for (uint32_t i = 0; i < s.item_count; i++) {
            const uint8_t* p = d_ + s.offset + i * 80u;
            StIrVariable v;
            v.name = rd_fixed_string(p, 64);
            if (!valid_type_raw(p[64])) return fail(st_ir_error::kBadTable, "invalid variable type");
            v.type = static_cast<StType>(p[64]);
            if (p[65] > 3) return fail(st_ir_error::kBadTable, "invalid storage class");
            v.storage = static_cast<StStorage>(p[65]);
            v.slot = rd_u16(p + 66);
            if (rd_u32(p + 68) != 0) return fail(st_ir_error::kBadTable, "variable reserved must be zero");
            if (!valid_encoded_value(p[64], p + 72))
                return fail(st_ir_error::kBadTable, "variable initial value encoding is invalid");
            v.init = rd_value(p[64], p + 72);
            if (v.slot >= var_slot_count_)
                return fail(st_ir_error::kBadTable, "variable slot out of writable range");
            if (slot_used[v.slot]) return fail(st_ir_error::kBadTable, "duplicate variable slot");
            slot_used[v.slot] = true;
            for (const StIrVariable& o : out_->variables)
                if (o.name == v.name) return fail(st_ir_error::kBadTable, "duplicate variable name");
            out_->variables.push_back(std::move(v));
        }
        return true;
    }

    bool step_fb_instances()
    {
        const SectionRef& s = sec_[st_ir::SEC_FB_INSTANCES];
        if (!check_stride(s, 80, "FB_INSTANCES")) return false;
        if (s.item_count > st_ir::kMaxFbInstances)
            return fail(st_ir_error::kResourceLimit, "FB instance count exceeds limit");
        for (uint32_t i = 0; i < s.item_count; i++) {
            const uint8_t* p = d_ + s.offset + i * 80u;
            StIrFbInstance f;
            f.name = rd_fixed_string(p, 64);
            const uint16_t ft = rd_u16(p + 64);
            if (ft < 1 || ft > 5) return fail(st_ir_error::kBadTable, "invalid FB type");
            f.fb_type = static_cast<StFbType>(ft);
            f.input_slot_base = rd_u16(p + 66);
            f.output_slot_base = rd_u16(p + 68);
            f.state_index = rd_u16(p + 70);
            f.retained = p[72] != 0;
            for (int k = 73; k < 80; k++)
                if (p[k] != 0) return fail(st_ir_error::kBadTable, "FB reserved must be zero");
            const uint32_t in_end = f.input_slot_base + st_fb_input_count(f.fb_type);
            const uint32_t out_end = f.output_slot_base + st_fb_output_count(f.fb_type);
            if (in_end > var_slot_count_ || out_end > var_slot_count_)
                return fail(st_ir_error::kBadTable, "FB port slots out of writable range");
            if (f.state_index != i)
                return fail(st_ir_error::kBadTable, "FB state_index must be sequential");
            out_->fb_instances.push_back(std::move(f));
        }
        return true;
    }

    bool step_io_binding()
    {
        const SectionRef& s = sec_[st_ir::SEC_IO_BINDING];
        if (!check_stride(s, 16, "IO_BINDING")) return false;
        if (s.item_count > st_ir::kMaxIoBindings)
            return fail(st_ir_error::kResourceLimit, "IO binding count exceeds limit");
        for (uint32_t i = 0; i < s.item_count; i++) {
            const uint8_t* p = d_ + s.offset + i * 16u;
            StIrIoBinding b;
            b.slot = rd_u16(p);
            if (p[2] > 1) return fail(st_ir_error::kBadIoBinding, "invalid direction");
            b.is_output = p[2] != 0;
            if (p[3] > static_cast<uint8_t>(StPointKind::EXT))
                return fail(st_ir_error::kBadIoBinding, "invalid point kind");
            b.point_kind = static_cast<StPointKind>(p[3]);
            b.point_index = rd_u16(p + 4);
            if (!valid_type_raw(p[6])) return fail(st_ir_error::kBadIoBinding, "invalid binding type");
            b.type = static_cast<StType>(p[6]);
            if (p[7] != 0) return fail(st_ir_error::kBadIoBinding, "binding reserved must be zero");
            b.scale_min = rd_f32(p + 8);
            b.scale_max = rd_f32(p + 12);

            if (b.slot >= var_slot_count_)
                return fail(st_ir_error::kBadIoBinding, "binding slot out of writable range");
            if (b.point_index == 0 || b.point_index > st_point_kind_limit(b.point_kind))
                return fail(st_ir_error::kBadIoBinding,
                            "binding point index out of target point range");
            if (b.is_output && !st_point_kind_allows_output(b.point_kind))
                return fail(st_ir_error::kBadIoBinding,
                            "binding output direction not allowed for point kind");
            if (!st_point_kind_allows_type(b.point_kind, b.type))
                return fail(st_ir_error::kBadIoBinding,
                            "binding type not allowed for point kind");
            if (!std::isfinite(b.scale_min) || !std::isfinite(b.scale_max))
                return fail(st_ir_error::kBadIoBinding, "binding range must be finite");
            const bool has_range = b.scale_min != 0.0f || b.scale_max != 0.0f;
            if (has_range && !(b.scale_min < b.scale_max))
                return fail(st_ir_error::kBadIoBinding,
                            "binding range_min must be lower than range_max");
            const StIrVariable* bound_variable = nullptr;
            for (const StIrVariable& v : out_->variables) {
                if (v.slot == b.slot) {
                    bound_variable = &v;
                    break;
                }
            }
            if (!bound_variable || bound_variable->type != b.type)
                return fail(st_ir_error::kBadIoBinding,
                            "binding type does not match variable");
            const StStorage expected_storage = b.is_output ? StStorage::VAR_OUTPUT
                                                           : StStorage::VAR_INPUT;
            if (bound_variable->storage != expected_storage)
                return fail(st_ir_error::kBadIoBinding,
                            "binding direction does not match variable storage");
            for (const StIrIoBinding& o : out_->io_bindings) {
                if (o.slot == b.slot)
                    return fail(st_ir_error::kBadIoBinding, "duplicate binding for slot");
                /* Một đầu ra vật lý chỉ được có MỘT người ghi
                 * (PROGRAM_SOM_FW_DRAFT_DESIGN §8). */
                if (o.is_output && b.is_output && o.point_kind == b.point_kind &&
                    o.point_index == b.point_index)
                    return fail(st_ir_error::kBadIoBinding,
                                "two variables bound to the same physical output");
            }
            out_->io_bindings.push_back(b);
        }
        return true;
    }

    bool step_retain()
    {
        const SectionRef& s = sec_[st_ir::SEC_RETAIN_LAYOUT];
        std::size_t retained_fb_count = 0;
        for (const StIrFbInstance& fb : out_->fb_instances)
            if (fb.retained) ++retained_fb_count;
        std::size_t retained_var_count = 0;
        for (const StIrVariable& variable : out_->variables)
            if (variable.storage == StStorage::VAR_RETAIN) ++retained_var_count;

        if (!s.present) {
            if (retained_var_count != 0 || retained_fb_count != 0)
                return fail(st_ir_error::kBadTable,
                            "RETAIN declaration exists without RETAIN_LAYOUT");
            return true;
        }
        if (retained_var_count == 0 && retained_fb_count == 0)
            return fail(st_ir_error::kBadTable, "empty RETAIN_LAYOUT is not canonical");
        if (s.size < 16) return fail(st_ir_error::kBadTable, "RETAIN_LAYOUT too small");
        const uint8_t* p = d_ + s.offset;
        out_->retain_layout_hash = rd_u32(p);
        out_->retain_record_size = rd_u32(p + 4);
        const uint32_t count = rd_u32(p + 8);
        if (rd_u32(p + 12) != 0) return fail(st_ir_error::kBadTable, "RETAIN reserved must be zero");
        if (count > st_ir::kMaxRetainVars)
            return fail(st_ir_error::kResourceLimit, "RETAIN variable count exceeds limit");
        if (count != s.item_count || count != retained_var_count)
            return fail(st_ir_error::kBadTable,
                        "RETAIN entry_count does not match retained variables");
        if (out_->retain_record_size > st_ir::kMaxRetainRecord)
            return fail(st_ir_error::kResourceLimit, "RETAIN record size exceeds limit");
        if (static_cast<uint64_t>(16) + static_cast<uint64_t>(count) * 8 != s.size)
            return fail(st_ir_error::kBadTable, "RETAIN section size is not canonical");

        uint32_t expected_offset = 0;
        std::size_t variable_cursor = 0;
        for (uint32_t i = 0; i < count; i++) {
            while (variable_cursor < out_->variables.size() &&
                   out_->variables[variable_cursor].storage != StStorage::VAR_RETAIN)
                ++variable_cursor;
            if (variable_cursor >= out_->variables.size())
                return fail(st_ir_error::kBadTable, "RETAIN variable table is incomplete");
            const StIrVariable& expected = out_->variables[variable_cursor++];
            const uint8_t* e = p + 16 + i * 8u;
            StIrRetainEntry r;
            r.slot = rd_u16(e);
            if (!valid_type_raw(e[2])) return fail(st_ir_error::kBadTable, "invalid RETAIN type");
            r.type = static_cast<StType>(e[2]);
            if (e[3] != 0) return fail(st_ir_error::kBadTable, "RETAIN reserved must be zero");
            r.offset = rd_u32(e + 4);
            if (r.slot >= var_slot_count_)
                return fail(st_ir_error::kBadTable, "RETAIN slot out of writable range");
            if (static_cast<uint64_t>(r.offset) + type_size(r.type) >
                out_->retain_record_size)
                return fail(st_ir_error::kBadTable, "RETAIN offset outside record");
            if (r.slot != expected.slot || r.type != expected.type ||
                r.offset != expected_offset)
                return fail(st_ir_error::kBadTable,
                            "RETAIN identity/type/offset is not canonical");
            expected_offset += static_cast<uint32_t>(type_size(r.type));
            out_->retain_entries.push_back(r);
        }

        for (const StIrFbInstance& fb : out_->fb_instances)
            if (fb.retained)
                expected_offset += static_cast<uint32_t>(st_fb_retain_state_size(fb.fb_type));
        if (expected_offset != out_->retain_record_size)
            return fail(st_ir_error::kBadTable,
                        "RETAIN record_size does not match variable and FB state layout");
        return true;
    }

    bool step_source_map()
    {
        const SectionRef& s = sec_[st_ir::SEC_DEBUG_SOURCEMAP];
        if (!s.present) return true;
        if (!check_stride(s, 8, "DEBUG_SOURCEMAP")) return false;
        const uint32_t code_count = sec_[st_ir::SEC_CODE].item_count;
        if (s.item_count > code_count)
            return fail(st_ir_error::kBadTable,
                        "source map has more entries than code instructions");
        uint32_t previous_pc = 0;
        for (uint32_t i = 0; i < s.item_count; i++) {
            const uint8_t* p = d_ + s.offset + i * 8u;
            StIrSourceMap m;
            m.pc = rd_u32(p);
            m.line = rd_u16(p + 4);
            m.column = rd_u16(p + 6);
            if (m.pc >= code_count)
                return fail(st_ir_error::kBadTable, "source map pc is outside code");
            if (m.line == 0 || m.column == 0)
                return fail(st_ir_error::kBadTable,
                            "source map line and column must be one-based");
            if (i > 0 && m.pc <= previous_pc)
                return fail(st_ir_error::kBadTable,
                            "source map pc entries must be strictly increasing");
            previous_pc = m.pc;
            out_->source_map.push_back(m);
        }
        return true;
    }

    bool step_signal_refs()
    {
        const SectionRef& s = sec_[st_ir::SEC_SIGNAL_REFS];
        if (!s.present) return true;
        if (!check_stride(s, 72, "SIGNAL_REFS")) return false;
        if (s.item_count > st_profile_generated::kMaxSignals)
            return fail(st_ir_error::kResourceLimit,
                        "Published Signal reference count exceeds limit");
        for (uint32_t index = 0; index < s.item_count; ++index) {
            const uint8_t* p = d_ + s.offset + index * 72u;
            StIrSignalRef ref;
            ref.name = rd_fixed_string(p, 64);
            if (ref.name.empty() || !valid_type_raw(p[64]) ||
                p[65] == 0 || (p[65] & ~3u) != 0)
                return fail(st_ir_error::kBadTable,
                            "Published Signal reference is invalid");
            ref.type = static_cast<StType>(p[64]);
            ref.read = (p[65] & 1u) != 0;
            ref.publish = (p[65] & 2u) != 0;
            for (int pad = 66; pad < 72; ++pad)
                if (p[pad] != 0)
                    return fail(st_ir_error::kBadTable,
                                "Published Signal reference padding must be zero");
            for (const StIrSignalRef& previous : out_->signal_refs)
                if (previous.name == ref.name)
                    return fail(st_ir_error::kBadTable,
                                "duplicate Published Signal reference");
            out_->signal_refs.push_back(std::move(ref));
        }
        return true;
    }

    /* Bước 17-20: kiểm TOÀN BỘ luồng lệnh. Sau bước này executor không kiểm
     * biên nữa, nên ở đây không được bỏ sót trường hợp nào. */
    bool step_code()
    {
        const SectionRef& s = sec_[st_ir::SEC_CODE];
        if (!check_stride(s, st_ir::kInstructionSize, "CODE")) return false;
        if (s.item_count > st_ir::kMaxInstructions)
            return fail(st_ir_error::kResourceLimit, "instruction count exceeds limit");
        if (s.item_count == 0) return fail(st_ir_error::kBadCode, "empty code section");

        const uint32_t n_instr = s.item_count;
        for (uint32_t pc = 0; pc < n_instr; pc++) {
            const uint8_t* p = d_ + s.offset + pc * st_ir::kInstructionSize;
            StInstr in;
            in.op = static_cast<StOp>(p[0]);
            in.type_raw = p[1];
            in.dst = rd_u16(p + 2);
            in.a = rd_u16(p + 4);
            in.b = rd_u16(p + 6);
            in.c = rd_u16(p + 8);
            in.aux = rd_u16(p + 10);
            in.imm = rd_u32(p + 12);
            in.type = in.type_raw ? static_cast<StType>(in.type_raw) : StType::BOOL;

            if (!check_instr(in, pc, n_instr)) return false;
            out_->code.push_back(in);
        }
        return true;
    }

    struct OpShape {
        bool uses_dst, uses_a, uses_b, uses_c, uses_aux, uses_imm;
        uint8_t type_mask;   /* bit 0 = VOID, bit n = wire code kiểu n (1..6) */
    };

    static bool shape_of(StOp op, OpShape* s)
    {
        auto mk = [](bool d, bool a, bool b, bool c, bool aux, bool imm, uint8_t tm) {
            OpShape o{d, a, b, c, aux, imm, tm}; return o;
        };
        constexpr uint8_t VOID = 1u << 0;
        constexpr uint8_t B = 1u << 1, D = 1u << 2, R = 1u << 3, T = 1u << 4;
        constexpr uint8_t I = 1u << 5, U = 1u << 6;
        constexpr uint8_t INTEGER = I | D | U;
        constexpr uint8_t SIGNED_NUM = I | D | R;
        constexpr uint8_t NUM = INTEGER | R;
        constexpr uint8_t NUMT = NUM | T;
        constexpr uint8_t ALL = B | NUMT;
        switch (op) {
        case StOp::NOP:          *s = mk(0,0,0,0,0,0, VOID); return true;
        case StOp::HALT:         *s = mk(0,0,0,0,0,0, VOID); return true;
        case StOp::JMP:          *s = mk(0,0,0,0,0,1, VOID); return true;
        case StOp::JMP_IF_FALSE: *s = mk(0,1,0,0,0,1, B);    return true;
        case StOp::MOV:          *s = mk(1,1,0,0,0,0, ALL);  return true;
        case StOp::ADD: case StOp::SUB:
                                 *s = mk(1,1,1,0,0,0, NUMT); return true;
        case StOp::MUL: case StOp::DIV:
                                 *s = mk(1,1,1,0,0,0, NUM);  return true;
        case StOp::MOD:          *s = mk(1,1,1,0,0,0, INTEGER); return true;
        case StOp::NEG:          *s = mk(1,1,0,0,0,0, SIGNED_NUM); return true;
        case StOp::LT: case StOp::LE: case StOp::GT: case StOp::GE:
                                 *s = mk(1,1,1,0,0,0, NUMT); return true;
        case StOp::EQ: case StOp::NE:
                                 *s = mk(1,1,1,0,0,0, ALL);  return true;
        case StOp::AND: case StOp::OR: case StOp::XOR:
                                 *s = mk(1,1,1,0,0,0, B);    return true;
        case StOp::NOT:          *s = mk(1,1,0,0,0,0, B);    return true;
        case StOp::ABS:          *s = mk(1,1,0,0,0,0, NUM);  return true;
        case StOp::MIN: case StOp::MAX:
                                 *s = mk(1,1,1,0,0,0, NUMT); return true;
        case StOp::LIMIT:        *s = mk(1,1,1,1,0,0, NUMT); return true;
        case StOp::SEL:          *s = mk(1,1,1,1,0,0, ALL);  return true;
        case StOp::SQRT:         *s = mk(1,1,0,0,0,0, R);    return true;
        case StOp::CVT_I2R: case StOp::CVT_R2I:
        case StOp::CVT_T2R: case StOp::CVT_R2T:
        case StOp::CVT_I2D: case StOp::CVT_I2U:
        case StOp::CVT_D2I: case StOp::CVT_D2U:
        case StOp::CVT_U2I: case StOp::CVT_U2D:
        case StOp::CVT_D2R: case StOp::CVT_U2R:
        case StOp::CVT_R2D: case StOp::CVT_R2U:
                                 *s = mk(1,1,0,0,0,0, VOID); return true;
        case StOp::FB_CALL:      *s = mk(0,0,0,0,1,0, VOID); return true;
        case StOp::SIGNAL_READ:  *s = mk(1,0,0,0,1,0, ALL); return true;
        case StOp::SIGNAL_PUBLISH:*s = mk(0,1,0,0,1,0, ALL); return true;
        }
        return false;
    }

    bool check_instr(const StInstr& in, uint32_t pc, uint32_t n_instr)
    {
        OpShape sh;
        if (!shape_of(in.op, &sh))
            return fail(st_ir_error::kBadCode,
                        "unknown opcode 0x" + std::to_string(static_cast<int>(in.op)) +
                            " at pc " + std::to_string(pc));

        if (in.type_raw != 0 && !valid_type_raw(in.type_raw))
            return fail(st_ir_error::kBadCode, "invalid type tag");
        const uint8_t tm = in.type_raw == 0 ? 1u : static_cast<uint8_t>(1u << in.type_raw);
        if ((sh.type_mask & tm) == 0)
            return fail(st_ir_error::kBadCode,
                        "type tag not valid for opcode at pc " + std::to_string(pc));

        /* Trường không dùng PHẢI bằng 0 — chặn kênh dữ liệu ẩn và bắt lỗi
         * sinh mã sớm (SPEC §5.1). */
        if (!sh.uses_dst && in.dst != 0) return fail(st_ir_error::kBadCode, "unused dst must be zero");
        if (!sh.uses_a && in.a != 0) return fail(st_ir_error::kBadCode, "unused a must be zero");
        if (!sh.uses_b && in.b != 0) return fail(st_ir_error::kBadCode, "unused b must be zero");
        if (!sh.uses_c && in.c != 0) return fail(st_ir_error::kBadCode, "unused c must be zero");
        if (!sh.uses_aux && in.aux != 0) return fail(st_ir_error::kBadCode, "unused aux must be zero");
        if (!sh.uses_imm && in.imm != 0) return fail(st_ir_error::kBadCode, "unused imm must be zero");

        if (sh.uses_dst && in.dst >= var_slot_count_)
            return fail(st_ir_error::kBadCode,
                        "destination slot " + std::to_string(in.dst) +
                            " is not writable (pc " + std::to_string(pc) + ")");
        if (sh.uses_a && in.a >= slot_count_) return fail(st_ir_error::kBadCode, "operand a out of range");
        if (sh.uses_b && in.b >= slot_count_) return fail(st_ir_error::kBadCode, "operand b out of range");
        if (sh.uses_c && in.c >= slot_count_) return fail(st_ir_error::kBadCode, "operand c out of range");

        if (sh.uses_imm) {
            /* CHỈ NHẢY TIẾN (SPEC §5.3) — điều này một mình bảo đảm mọi
             * chương trình chấm dứt trong <= n_instr bước. */
            if (in.imm <= pc || in.imm > n_instr)
                return fail(st_ir_error::kBadCode,
                            "jump target must be forward and within code (pc " +
                                std::to_string(pc) + " -> " + std::to_string(in.imm) + ")");
        }
        if (in.op == StOp::FB_CALL && in.aux >= out_->fb_instances.size())
            return fail(st_ir_error::kBadCode, "FB instance index out of range");
        if ((in.op == StOp::SIGNAL_READ || in.op == StOp::SIGNAL_PUBLISH) &&
            in.aux >= out_->signal_refs.size())
            return fail(st_ir_error::kBadCode,
                        "Published Signal reference index out of range");
        if (in.op == StOp::SIGNAL_READ &&
            (!out_->signal_refs[in.aux].read || out_->signal_refs[in.aux].type != in.type))
            return fail(st_ir_error::kBadCode,
                        "SIGNAL_READ permission/type mismatch");
        if (in.op == StOp::SIGNAL_PUBLISH &&
            (!out_->signal_refs[in.aux].publish || out_->signal_refs[in.aux].type != in.type))
            return fail(st_ir_error::kBadCode,
                        "SIGNAL_PUBLISH permission/type mismatch");
        return true;
    }

    bool step_profile()
    {
        st_limits::RevAProfileUsage usage;
        usage.profile_code = rd_u16(d_ + 10);
        usage.target_abi = rd_u32(d_ + 12);
        usage.variables = sec_[st_ir::SEC_VARIABLES].item_count;
        usage.artifact_bytes = total_size_;
        usage.instructions = sec_[st_ir::SEC_CODE].item_count;
        usage.slots = slot_count_;
        usage.writable_slots = var_slot_count_;
        usage.constants = sec_[st_ir::SEC_CONSTANTS].item_count;
        usage.function_blocks = sec_[st_ir::SEC_FB_INSTANCES].item_count;
        usage.bindings = sec_[st_ir::SEC_IO_BINDING].item_count;
        std::size_t retained_fb_count = 0;
        for (const StIrFbInstance& fb : out_->fb_instances)
            if (fb.retained) ++retained_fb_count;
        usage.retain_variables = out_->retain_entries.size() + retained_fb_count;
        usage.retain_bytes = out_->retain_record_size;
        usage.sections = section_count_;
        st_limits::RevAProfileError profile_error;
        if (!st_limits::ValidateRevAProfile(usage, &profile_error))
            return fail(st_ir_error::kResourceLimit,
                        "Rev A profile violation at " + profile_error.field + " (" +
                            std::to_string(profile_error.actual) + ", " +
                            profile_error.constraint + ")");
        return true;
    }

    /* Bước 22: điểm cấp phát CUỐI CÙNG. Sau đây không cấp phát thêm gì. */
    bool step_allocate()
    {
        out_->slots.assign(slot_count_, StCell{});
        out_->fb_states.assign(out_->fb_instances.size(), StFbState{});
        out_->pending_signal_values.assign(out_->signal_refs.size(), StCell{});
        out_->pending_signal_writes.assign(out_->signal_refs.size(), 0);
        out_->pending_signal_pc.assign(out_->signal_refs.size(), 0);
        /* Nạp hằng vào vùng chỉ đọc của không gian slot. */
        for (std::size_t i = 0; i < const_values_.size(); i++) {
            const std::size_t slot = var_slot_count_ + i;
            store(&out_->slots[slot], const_values_[i]);
        }
        out_->reset_to_initial();
        return true;
    }

    static void store(StCell* c, const StValue& v)
    {
        switch (v.type) {
        case StType::BOOL: c->b = v.b; break;
        case StType::DINT:
        case StType::INT:  c->i = v.i; break;
        case StType::UINT: c->i = v.i; break;
        case StType::REAL: c->r = v.r; break;
        case StType::TIME: c->t = v.t; break;
        }
    }

    std::vector<StValue> const_values_;
};

} // namespace

/* Đặt ở phía RUNTIME (không phải st_ir.cpp) có chủ ý: loader phải tính được
 * hash mà không cần liên kết tới bất kỳ phần nào của compiler. Nhờ vậy
 * st_compiler_lib phụ thuộc core_lib, không có chiều ngược lại — và bất biến
 * "không có parser trong mkddc-core" trở thành ràng buộc CẤU TRÚC. */
bool compute_artifact_sha256(const uint8_t* data, std::size_t size, uint8_t out[32])
{
    if (size < st_ir::kHeaderSize) return false;
    /* SPEC §3.1: hash toàn file với vùng sha256[32] (offset 32) và
     * signature[64] (offset 64) coi như 0. Cách này bao phủ cả header nên
     * không sửa được target_abi/total_size mà không bị phát hiện. */
    crypto_hash_sha256_state st;
    crypto_hash_sha256_init(&st);
    crypto_hash_sha256_update(&st, data, 32);
    static const uint8_t zeros[96] = {0};
    crypto_hash_sha256_update(&st, zeros, 96);
    crypto_hash_sha256_update(&st, data + 128, size - 128);
    crypto_hash_sha256_final(&st, out);
    return true;
}

void StLoadedProgram::reset_to_initial()
{
    for (const StIrVariable& v : variables) {
        StCell& c = slots[v.slot];
        switch (v.type) {
        case StType::BOOL: c.b = v.init.b; break;
        case StType::DINT:
        case StType::INT:  c.i = v.init.i; break;
        case StType::UINT: c.i = v.init.i; break;
        case StType::REAL: c.r = v.init.r; break;
        case StType::TIME: c.t = v.init.t; break;
        }
    }
    for (StFbState& s : fb_states) s = StFbState{};
}

void StLoadedProgram::reset_retained_state()
{
    for (const StIrRetainEntry& entry : retain_entries) {
        for (const StIrVariable& v : variables) {
            if (v.slot != entry.slot) continue;
            StCell& c = slots[entry.slot];
            switch (v.type) {
            case StType::BOOL: c.b = v.init.b; break;
            case StType::DINT:
            case StType::INT:  c.i = v.init.i; break;
            case StType::UINT: c.i = v.init.i; break;
            case StType::REAL: c.r = v.init.r; break;
            case StType::TIME: c.t = v.init.t; break;
            }
            break;
        }
    }
    for (const StIrFbInstance& fb : fb_instances) {
        if (fb.retained) fb_states[fb.state_index] = StFbState{};
    }
}

void StLoadedProgram::source_position(uint32_t pc, int* line, int* column) const
{
    if (line) *line = 0;
    if (column) *column = 0;
    for (const StIrSourceMap& m : source_map) {
        if (m.pc == pc) {
            if (line) *line = m.line;
            if (column) *column = m.column;
            return;
        }
    }
}

bool LoadArtifact(const uint8_t* data, std::size_t size, const StLoaderOptions& opts,
                  StLoadedProgram* out, StLoadError* err)
{
    if (!data || !out) {
        if (err) { err->code = st_ir_error::kBadHeader; err->message = "null artifact"; }
        return false;
    }
    try {
        StLoadedProgram candidate;
        Loader l(data, size, opts, &candidate, err);
        if (!l.run()) return false;
        *out = std::move(candidate);
        return true;
    } catch (const std::bad_alloc&) {
        if (err) {
            err->code = st_ir_error::kOutOfMemory;
            err->message = "bounded loader allocation failed";
        }
        return false;
    }
}

bool VerifyArtifact(const uint8_t* data, std::size_t size, const StLoaderOptions& opts,
                    StArtifactSummary* summary, StLoadError* err)
{
    if (!summary) {
        if (err) { err->code = st_ir_error::kBadHeader; err->message = "null summary"; }
        return false;
    }
    StLoadedProgram candidate;
    if (!LoadArtifact(data, size, opts, &candidate, err)) return false;
    StArtifactSummary verified;
    verified.schema_version = rd_u16(data + 8);
    verified.compiler_profile = rd_u16(data + 10);
    verified.target_abi = rd_u32(data + 12);
    verified.artifact_bytes = rd_u32(data + 20);
    verified.section_count = rd_u16(data + 24);
    verified.integrity_mode = opts.integrity_mode;
    verified.signature_present = (rd_u16(data + 26) & st_ir::kFlagSigned) != 0;
    std::memcpy(verified.sha256, candidate.sha256, sizeof(verified.sha256));
    *summary = verified;
    return true;
}

} // namespace core
