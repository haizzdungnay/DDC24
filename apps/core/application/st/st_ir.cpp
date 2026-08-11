#include "st/st_ir.hpp"

#include <cstring>

#include <sodium.h>

#include "st/st_limits.hpp"

namespace core {
namespace {

/* Ghi little-endian tường minh — không dựa vào endianness của máy build,
 * vì artifact phải đọc được y hệt trên host x86_64 và target aarch64. */
void put_u16(std::vector<uint8_t>* v, uint16_t x)
{
    v->push_back(static_cast<uint8_t>(x & 0xFF));
    v->push_back(static_cast<uint8_t>((x >> 8) & 0xFF));
}
void put_u32(std::vector<uint8_t>* v, uint32_t x)
{
    for (int i = 0; i < 4; i++) v->push_back(static_cast<uint8_t>((x >> (8 * i)) & 0xFF));
}
void put_u64(std::vector<uint8_t>* v, uint64_t x)
{
    for (int i = 0; i < 8; i++) v->push_back(static_cast<uint8_t>((x >> (8 * i)) & 0xFF));
}
void put_f32(std::vector<uint8_t>* v, float f)
{
    uint32_t bits;
    std::memcpy(&bits, &f, sizeof(bits));
    put_u32(v, bits);
}
void put_bytes(std::vector<uint8_t>* v, const void* p, std::size_t n)
{
    const uint8_t* b = static_cast<const uint8_t*>(p);
    v->insert(v->end(), b, b + n);
}
void put_fixed_string(std::vector<uint8_t>* v, const std::string& s, std::size_t width)
{
    const std::size_t n = s.size() < width ? s.size() : width;
    put_bytes(v, s.data(), n);
    for (std::size_t i = n; i < width; i++) v->push_back(0);
}
void pad_to(std::vector<uint8_t>* v, std::size_t align)
{
    while (v->size() % align != 0) v->push_back(0);
}

/* Mã hoá StValue thành 8 byte union theo SPEC §4.2. */
void put_value(std::vector<uint8_t>* v, const StValue& val)
{
    switch (val.type) {
    case StType::BOOL:
        v->push_back(val.b ? 1 : 0);
        for (int i = 0; i < 7; i++) v->push_back(0);
        break;
    case StType::INT:
        put_u32(v, static_cast<uint32_t>(val.i));
        put_u32(v, 0);
        break;
    case StType::REAL:
        put_f32(v, val.r);
        put_u32(v, 0);
        break;
    case StType::TIME:
        put_u64(v, static_cast<uint64_t>(val.t));
        break;
    }
}

struct SectionOut {
    uint16_t              type;
    uint32_t              item_count;
    std::vector<uint8_t>  data;
};

} // namespace

bool serialize_st_ir(const StIrModule& mod, std::vector<uint8_t>* out, std::string* error)
{
    auto fail = [&](const std::string& m) { if (error) *error = m; return false; };

    st_limits::RevAProfileUsage usage;
    usage.variables = mod.variables.size();
    usage.instructions = mod.code.size();
    usage.slots = mod.slot_count;
    usage.writable_slots = mod.var_slot_count;
    usage.constants = mod.constants.size();
    usage.function_blocks = mod.fb_instances.size();
    usage.bindings = mod.io_bindings.size();
    usage.retain_variables = mod.retain_entries.size();
    usage.retain_bytes = mod.retain_record_size;
    usage.sections = 6u + (mod.has_retain() ? 1u : 0u) + (!mod.source_map.empty() ? 1u : 0u);
    st_limits::RevAProfileError profile_error;
    if (!st_limits::ValidateRevAProfile(usage, &profile_error))
        return fail("Rev A profile violation at " + profile_error.field + " (" +
                    std::to_string(profile_error.actual) + ", " +
                    profile_error.constraint + ")");

    if (mod.code.size() > st_ir::kMaxInstructions)
        return fail("instruction count exceeds limit");
    if (mod.slot_count > st_ir::kMaxSlots) return fail("slot count exceeds limit");
    if (mod.var_slot_count > st_ir::kMaxVarSlots) return fail("variable slot count exceeds limit");
    if (mod.constants.size() > st_ir::kMaxConstants) return fail("constant count exceeds limit");
    if (mod.fb_instances.size() > st_ir::kMaxFbInstances)
        return fail("function block instance count exceeds limit");
    if (mod.io_bindings.size() > st_ir::kMaxIoBindings) return fail("IO binding count exceeds limit");
    if (mod.retain_entries.size() > st_ir::kMaxRetainVars)
        return fail("RETAIN variable count exceeds limit");
    if (mod.retain_record_size > st_ir::kMaxRetainRecord)
        return fail("RETAIN record size exceeds limit");

    std::vector<SectionOut> secs;

    /* METADATA (SPEC §4.1) */
    {
        SectionOut s{st_ir::SEC_METADATA, 0, {}};
        put_u32(&s.data, static_cast<uint32_t>(mod.program_name.size()));
        put_fixed_string(&s.data, mod.program_name, 64);
        put_u64(&s.data, mod.source_hash);
        put_fixed_string(&s.data, mod.compiler_version, 32);
        put_u64(&s.data, mod.build_timestamp);
        put_u32(&s.data, mod.slot_count);
        put_u32(&s.data, mod.var_slot_count);
        put_u32(&s.data, 0);
        secs.push_back(std::move(s));
    }

    /* CONSTANTS */
    {
        SectionOut s{st_ir::SEC_CONSTANTS, static_cast<uint32_t>(mod.constants.size()), {}};
        for (const StValue& c : mod.constants) {
            s.data.push_back(static_cast<uint8_t>(c.type));
            for (int i = 0; i < 7; i++) s.data.push_back(0);
            put_value(&s.data, c);
        }
        secs.push_back(std::move(s));
    }

    /* VARIABLES */
    {
        SectionOut s{st_ir::SEC_VARIABLES, static_cast<uint32_t>(mod.variables.size()), {}};
        for (const StIrVariable& v : mod.variables) {
            put_fixed_string(&s.data, v.name, 64);
            s.data.push_back(static_cast<uint8_t>(v.type));
            s.data.push_back(static_cast<uint8_t>(v.storage));
            put_u16(&s.data, v.slot);
            put_u32(&s.data, 0);
            put_value(&s.data, v.init);
        }
        secs.push_back(std::move(s));
    }

    /* CODE */
    {
        SectionOut s{st_ir::SEC_CODE, static_cast<uint32_t>(mod.code.size()), {}};
        for (const StInstr& in : mod.code) {
            s.data.push_back(static_cast<uint8_t>(in.op));
            s.data.push_back(in.type_raw);
            put_u16(&s.data, in.dst);
            put_u16(&s.data, in.a);
            put_u16(&s.data, in.b);
            put_u16(&s.data, in.c);
            put_u16(&s.data, in.aux);
            put_u32(&s.data, in.imm);
        }
        secs.push_back(std::move(s));
    }

    /* IO_BINDING */
    {
        SectionOut s{st_ir::SEC_IO_BINDING, static_cast<uint32_t>(mod.io_bindings.size()), {}};
        for (const StIrIoBinding& b : mod.io_bindings) {
            put_u16(&s.data, b.slot);
            s.data.push_back(b.is_output ? 1 : 0);
            s.data.push_back(static_cast<uint8_t>(b.point_kind));
            put_u16(&s.data, b.point_index);
            s.data.push_back(static_cast<uint8_t>(b.type));
            s.data.push_back(0);
            put_f32(&s.data, b.scale_min);
            put_f32(&s.data, b.scale_max);
        }
        secs.push_back(std::move(s));
    }

    /* FB_INSTANCES */
    {
        SectionOut s{st_ir::SEC_FB_INSTANCES, static_cast<uint32_t>(mod.fb_instances.size()), {}};
        for (const StIrFbInstance& f : mod.fb_instances) {
            put_fixed_string(&s.data, f.name, 64);
            put_u16(&s.data, static_cast<uint16_t>(f.fb_type));
            put_u16(&s.data, f.input_slot_base);
            put_u16(&s.data, f.output_slot_base);
            put_u16(&s.data, f.state_index);
            s.data.push_back(f.retained ? 1 : 0);
            for (int i = 0; i < 7; i++) s.data.push_back(0);
        }
        secs.push_back(std::move(s));
    }

    /* RETAIN_LAYOUT (chỉ khi có) */
    if (mod.has_retain()) {
        SectionOut s{st_ir::SEC_RETAIN_LAYOUT,
                     static_cast<uint32_t>(mod.retain_entries.size()), {}};
        put_u32(&s.data, mod.retain_layout_hash);
        put_u32(&s.data, mod.retain_record_size);
        put_u32(&s.data, static_cast<uint32_t>(mod.retain_entries.size()));
        put_u32(&s.data, 0);
        for (const StIrRetainEntry& e : mod.retain_entries) {
            put_u16(&s.data, e.slot);
            s.data.push_back(static_cast<uint8_t>(e.type));
            s.data.push_back(0);
            put_u32(&s.data, e.offset);
        }
        secs.push_back(std::move(s));
    }

    /* DEBUG_SOURCEMAP (chỉ khi có) */
    if (!mod.source_map.empty()) {
        SectionOut s{st_ir::SEC_DEBUG_SOURCEMAP,
                     static_cast<uint32_t>(mod.source_map.size()), {}};
        for (const StIrSourceMap& m : mod.source_map) {
            put_u32(&s.data, m.pc);
            put_u16(&s.data, m.line);
            put_u16(&s.data, m.column);
        }
        secs.push_back(std::move(s));
    }

    if (secs.size() > st_ir::kMaxSections) return fail("section count exceeds limit");

    /* Bố trí file: header 128 + bảng section + payload căn 8 byte. */
    const uint32_t table_size = static_cast<uint32_t>(secs.size()) * 16u;
    uint32_t cursor = st_ir::kHeaderSize + table_size;
    while (cursor % 8 != 0) cursor++;

    struct Placed { uint32_t offset, size; };
    std::vector<Placed> placed(secs.size());
    for (std::size_t i = 0; i < secs.size(); i++) {
        placed[i].offset = cursor;
        placed[i].size = static_cast<uint32_t>(secs[i].data.size());
        cursor += placed[i].size;
        while (cursor % 8 != 0) cursor++;
    }
    const uint32_t total_size = cursor;
    if (total_size > st_ir::kMaxArtifactSize) return fail("artifact exceeds 1 MiB");
    usage.artifact_bytes = total_size;
    if (!st_limits::ValidateRevAProfile(usage, &profile_error))
        return fail("Rev A profile violation at " + profile_error.field + " (" +
                    std::to_string(profile_error.actual) + ", " +
                    profile_error.constraint + ")");

    uint16_t flags = 0;
    if (!mod.source_map.empty()) flags |= st_ir::kFlagHasSourceMap;
    if (mod.has_retain()) flags |= st_ir::kFlagHasRetain;

    out->clear();
    out->reserve(total_size);

    put_bytes(out, st_ir::kMagic, 8);
    put_u16(out, st_ir::kSchemaVersion);
    put_u16(out, st_ir::kCompilerProfile);
    put_u32(out, st_ir::kTargetAbi);
    put_u32(out, st_ir::kHeaderSize);
    put_u32(out, total_size);
    put_u16(out, static_cast<uint16_t>(secs.size()));
    put_u16(out, flags);
    put_u32(out, 0);                       /* reserved0 */
    for (int i = 0; i < 32; i++) out->push_back(0);   /* sha256, điền sau */
    for (int i = 0; i < 64; i++) out->push_back(0);   /* signature */

    for (std::size_t i = 0; i < secs.size(); i++) {
        put_u16(out, secs[i].type);
        put_u16(out, 0);
        put_u32(out, placed[i].offset);
        put_u32(out, placed[i].size);
        put_u32(out, secs[i].item_count);
    }
    pad_to(out, 8);
    for (std::size_t i = 0; i < secs.size(); i++) {
        put_bytes(out, secs[i].data.data(), secs[i].data.size());
        pad_to(out, 8);
    }

    if (out->size() != total_size) return fail("internal layout mismatch");

    uint8_t digest[32];
    if (!compute_artifact_sha256(out->data(), out->size(), digest))
        return fail("failed to compute artifact hash");
    std::memcpy(out->data() + 32, digest, 32);
    return true;
}

bool sign_st_artifact(std::vector<uint8_t>* artifact, const uint8_t secret_key[64])
{
    if (!artifact || artifact->size() < st_ir::kHeaderSize) return false;

    /* THỨ TỰ QUAN TRỌNG: cờ kSigned nằm ở offset 26-27, tức là TRONG vùng
     * được SHA-256 bao phủ (§3.1 hash byte 0..31). Phải bật cờ TRƯỚC khi
     * tính digest — bật sau sẽ làm chính digest vừa ghi không còn khớp file. */
    uint16_t flags = static_cast<uint16_t>((*artifact)[26] | ((*artifact)[27] << 8));
    flags |= st_ir::kFlagSigned;
    (*artifact)[26] = static_cast<uint8_t>(flags & 0xFF);
    (*artifact)[27] = static_cast<uint8_t>((flags >> 8) & 0xFF);

    /* Ký trên 32 byte DIGEST, không phải trên toàn file (SPEC §3.2). Digest
     * đã bao phủ toàn bộ nội dung nên ký digest là đủ và rẻ hơn nhiều. */
    uint8_t digest[32];
    if (!compute_artifact_sha256(artifact->data(), artifact->size(), digest)) return false;
    std::memcpy(artifact->data() + 32, digest, 32);

    uint8_t sig[crypto_sign_BYTES];
    if (crypto_sign_detached(sig, nullptr, digest, sizeof(digest), secret_key) != 0) return false;
    std::memcpy(artifact->data() + 64, sig, crypto_sign_BYTES);
    return true;
}

bool EncodeArtifactDeterministic(const StIrModule& module, std::vector<uint8_t>* artifact,
                                 std::string* error)
{
    return serialize_st_ir(module, artifact, error);
}

} // namespace core
