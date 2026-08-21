#include "st/st_package_v2.hpp"

#include <algorithm>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

#include <sodium.h>

#include "st/st_profile_generated.hpp"

namespace core {
namespace {

/* Offset cố định trong header 128 byte. Ghi rõ ở một chỗ để writer và loader
 * không thể lệch nhau khi header đổi. */
constexpr std::size_t kOffMagic          = 0;
constexpr std::size_t kOffSchemaVersion  = 8;
constexpr std::size_t kOffCompilerProfile = 10;
constexpr std::size_t kOffTargetAbi      = 12;
constexpr std::size_t kOffLayoutVersion  = 16;
constexpr std::size_t kOffSectionCount   = 18;
constexpr std::size_t kOffFlags          = 20;
constexpr std::size_t kOffArtifactBytes  = 24;
constexpr std::size_t kOffSha256         = 32;   /* 32 byte */
constexpr std::size_t kOffSignature      = 64;   /* 64 byte, reserved-zero */

void put_u16(std::vector<uint8_t>* buffer, std::size_t offset, uint16_t value)
{
    (*buffer)[offset] = static_cast<uint8_t>(value & 0xFFu);
    (*buffer)[offset + 1] = static_cast<uint8_t>((value >> 8) & 0xFFu);
}

void put_u32(std::vector<uint8_t>* buffer, std::size_t offset, uint32_t value)
{
    for (std::size_t index = 0; index < 4; ++index)
        (*buffer)[offset + index] = static_cast<uint8_t>((value >> (8 * index)) & 0xFFu);
}

uint16_t read_u16(const uint8_t* data, std::size_t offset)
{
    return static_cast<uint16_t>(data[offset] | (data[offset + 1] << 8));
}

uint32_t read_u32(const uint8_t* data, std::size_t offset)
{
    return static_cast<uint32_t>(data[offset]) |
           (static_cast<uint32_t>(data[offset + 1]) << 8) |
           (static_cast<uint32_t>(data[offset + 2]) << 16) |
           (static_cast<uint32_t>(data[offset + 3]) << 24);
}

void append_u32(std::vector<uint8_t>* buffer, uint32_t value)
{
    for (std::size_t index = 0; index < 4; ++index)
        buffer->push_back(static_cast<uint8_t>((value >> (8 * index)) & 0xFFu));
}

/* Chuỗi trong section: `u16 length + bytes`, không NUL-terminate. Trần 255 vì mọi
 * định danh của Product đều <= 64 ký tự; cho phép dài hơn chỉ mở đường cho
 * artifact phình ra mà không ai kiểm. */
constexpr std::size_t kMaxStringBytes = 255;

bool append_string(std::vector<uint8_t>* buffer, const std::string& value,
                   std::string* error)
{
    if (value.size() > kMaxStringBytes) {
        if (error) *error = "chuỗi vượt " + std::to_string(kMaxStringBytes) + " byte: " + value;
        return false;
    }
    buffer->push_back(static_cast<uint8_t>(value.size() & 0xFFu));
    buffer->push_back(0);
    buffer->insert(buffer->end(), value.begin(), value.end());
    return true;
}

bool read_string(const uint8_t* data, std::size_t size, std::size_t* cursor,
                 std::string* out)
{
    if (*cursor + 2 > size) return false;
    const std::size_t length = read_u16(data, *cursor);
    *cursor += 2;
    if (length > kMaxStringBytes || *cursor + length > size) return false;
    out->assign(reinterpret_cast<const char*>(data + *cursor), length);
    *cursor += length;
    return true;
}

struct SectionPlan {
    uint16_t type = 0;
    uint32_t item_count = 0;
    std::vector<uint8_t> payload;
};

bool fail(std::string* error, const std::string& message)
{
    if (error) *error = message;
    return false;
}

bool reject(const char** error_code, const char* code)
{
    if (error_code) *error_code = code;
    return false;
}

} // namespace

bool WritePackageV2(const StPackageInput& input, std::vector<uint8_t>* out,
                    std::string* error)
{
    if (out == nullptr) return false;
    out->clear();

    if (input.programs.empty())
        return fail(error, "package phải có ít nhất một Program");
    if (input.programs.size() > st_profile_generated::kMaxProgramsTotal)
        return fail(error, "số Program vượt trần " +
                               std::to_string(st_profile_generated::kMaxProgramsTotal));
    if (input.pou_signatures.size() > st_profile_generated::kMaxObjects)
        return fail(error, "số POU vượt trần " +
                               std::to_string(st_profile_generated::kMaxObjects));
    if (input.fb_instances.size() > st_profile_generated::kMaxFunctionBlockInstances)
        return fail(error, "số FB instance vượt trần " +
                               std::to_string(st_profile_generated::kMaxFunctionBlockInstances));
    if (input.signals.size() > st_profile_generated::kMaxSignals)
        return fail(error, "số signal vượt trần " +
                               std::to_string(st_profile_generated::kMaxSignals));
    if (input.bindings.size() > st_profile_generated::kMaxPackageBindings)
        return fail(error, "số binding vượt trần " +
                               std::to_string(st_profile_generated::kMaxPackageBindings));

    std::vector<SectionPlan> sections;

    /* POU_TABLE: tên + kind + số input + có kiểu trả về hay không. */
    {
        SectionPlan plan;
        plan.type = st_pkg::SEC_POU_TABLE;
        plan.item_count = static_cast<uint32_t>(input.pou_signatures.size());
        for (const StPouSignature& signature : input.pou_signatures) {
            if (!append_string(&plan.payload, signature.name, error)) return false;
            plan.payload.push_back(static_cast<uint8_t>(signature.kind));
            plan.payload.push_back(signature.has_return_type ? 1u : 0u);
            plan.payload.push_back(static_cast<uint8_t>(signature.input_types.size()));
            for (StType type : signature.input_types)
                plan.payload.push_back(static_cast<uint8_t>(type));
        }
        sections.push_back(std::move(plan));
    }

    /* PROGRAM_TABLE: tên Program theo đúng thứ tự trong CODE_IR. */
    {
        SectionPlan plan;
        plan.type = st_pkg::SEC_PROGRAM_TABLE;
        plan.item_count = static_cast<uint32_t>(input.programs.size());
        for (const StPackageProgram& program : input.programs)
            if (!append_string(&plan.payload, program.program_name, error)) return false;
        sections.push_back(std::move(plan));
    }

    /* CODE_IR: các blob v1 nguyên vẹn, mỗi blob có tiền tố độ dài. */
    {
        SectionPlan plan;
        plan.type = st_pkg::SEC_CODE_IR;
        plan.item_count = static_cast<uint32_t>(input.programs.size());
        for (const StPackageProgram& program : input.programs) {
            if (program.ir_blob.empty())
                return fail(error, "Program '" + program.program_name + "' không có IR");
            append_u32(&plan.payload, static_cast<uint32_t>(program.ir_blob.size()));
            plan.payload.insert(plan.payload.end(), program.ir_blob.begin(),
                                program.ir_blob.end());
        }
        sections.push_back(std::move(plan));
    }

    /* FB_LAYOUT: đường dẫn canonical + offset/size + cờ RETAIN. */
    if (!input.fb_instances.empty()) {
        SectionPlan plan;
        plan.type = st_pkg::SEC_FB_LAYOUT;
        plan.item_count = static_cast<uint32_t>(input.fb_instances.size());
        for (const StFbInstanceNode& node : input.fb_instances) {
            if (!append_string(&plan.payload, node.path, error)) return false;
            if (!append_string(&plan.payload, node.type_name, error)) return false;
            append_u32(&plan.payload, node.state_offset);
            append_u32(&plan.payload, node.state_size);
            plan.payload.push_back(node.retained ? 1u : 0u);
        }
        sections.push_back(std::move(plan));
    }

    if (!input.signals.empty()) {
        SectionPlan plan;
        plan.type = st_pkg::SEC_SIGNAL_DEFS;
        plan.item_count = static_cast<uint32_t>(input.signals.size());
        for (const StPackageSignal& signal : input.signals) {
            if (!append_string(&plan.payload, signal.name, error)) return false;
            if (!append_string(&plan.payload, signal.producer_program, error)) return false;
            plan.payload.push_back(signal.data_type);
            append_u32(&plan.payload, signal.freshness_ms);
        }
        sections.push_back(std::move(plan));
    }

    if (!input.bindings.empty()) {
        SectionPlan plan;
        plan.type = st_pkg::SEC_BINDING_MANIFEST;
        plan.item_count = static_cast<uint32_t>(input.bindings.size());
        for (const StPackageBinding& binding : input.bindings) {
            if (!append_string(&plan.payload, binding.owner_program, error)) return false;
            if (!append_string(&plan.payload, binding.point_id, error)) return false;
            plan.payload.push_back(binding.point_category);
            plan.payload.push_back(binding.is_output ? 1u : 0u);
        }
        sections.push_back(std::move(plan));
    }

    if (!input.library_lock.system_version.empty()) {
        SectionPlan plan;
        plan.type = st_pkg::SEC_LIBRARY_LOCK;
        plan.item_count = 1;
        if (!append_string(&plan.payload, input.library_lock.system_version, error)) return false;
        plan.payload.insert(plan.payload.end(), input.library_lock.system_sha256.begin(),
                            input.library_lock.system_sha256.end());
        if (!append_string(&plan.payload, input.library_lock.project_revision_id, error))
            return false;
        sections.push_back(std::move(plan));
    }

    /* RESOURCE_BUDGET: số đo thật của package, để loader đối chiếu với trần
     * profile mà không phải tự đếm lại toàn bộ nội dung. */
    {
        SectionPlan plan;
        plan.type = st_pkg::SEC_RESOURCE_BUDGET;
        plan.item_count = 1;
        append_u32(&plan.payload, static_cast<uint32_t>(input.programs.size()));
        append_u32(&plan.payload, static_cast<uint32_t>(input.pou_signatures.size()));
        append_u32(&plan.payload, static_cast<uint32_t>(input.fb_instances.size()));
        append_u32(&plan.payload, static_cast<uint32_t>(input.signals.size()));
        append_u32(&plan.payload, static_cast<uint32_t>(input.bindings.size()));
        append_u32(&plan.payload, input.retain_bytes);
        sections.push_back(std::move(plan));
    }

    if (sections.size() > st_pkg::kMaxSections)
        return fail(error, "số section vượt trần");

    /* Bảng section phải TĂNG DẦN theo type: bảng lộn xộn là dấu hiệu artifact bị
     * ghép tay, và loader dựa vào tính đơn điệu để phát hiện điều đó rẻ tiền. */
    std::sort(sections.begin(), sections.end(),
              [](const SectionPlan& a, const SectionPlan& b) { return a.type < b.type; });

    const uint32_t table_bytes =
        static_cast<uint32_t>(sections.size()) * st_pkg::kSectionEntrySize;
    uint32_t cursor = st_pkg::kHeaderSize + table_bytes;
    uint64_t total = cursor;
    for (const SectionPlan& plan : sections) total += plan.payload.size();
    if (total > st_pkg::kMaxArtifactBytes)
        return fail(error, "package vượt trần " + std::to_string(st_pkg::kMaxArtifactBytes) +
                               " byte");

    out->assign(static_cast<std::size_t>(total), 0u);
    std::memcpy(out->data() + kOffMagic, st_pkg::kMagic, sizeof(st_pkg::kMagic));
    put_u16(out, kOffSchemaVersion, st_pkg::kSchemaVersion);
    put_u16(out, kOffCompilerProfile, input.compiler_profile);
    put_u32(out, kOffTargetAbi, input.target_abi);
    put_u16(out, kOffLayoutVersion, st_pkg::kLayoutVersion);
    put_u16(out, kOffSectionCount, static_cast<uint16_t>(sections.size()));

    uint16_t flags = 0;
    if (!input.signals.empty()) flags |= st_pkg::kFlagHasSignals;
    if (!input.library_lock.system_version.empty()) flags |= st_pkg::kFlagHasLibraryLock;
    if (input.programs.size() > 1) flags |= st_pkg::kFlagHasMultiProgram;
    if (input.retain_bytes > 0) flags |= st_pkg::kFlagHasRetain;
    put_u16(out, kOffFlags, flags);
    put_u32(out, kOffArtifactBytes, static_cast<uint32_t>(total));

    std::size_t entry = st_pkg::kHeaderSize;
    for (const SectionPlan& plan : sections) {
        put_u16(out, entry, plan.type);
        put_u16(out, entry + 2, 0);
        put_u32(out, entry + 4, cursor);
        put_u32(out, entry + 8, static_cast<uint32_t>(plan.payload.size()));
        put_u32(out, entry + 12, plan.item_count);
        if (!plan.payload.empty())
            std::memcpy(out->data() + cursor, plan.payload.data(), plan.payload.size());
        cursor += static_cast<uint32_t>(plan.payload.size());
        entry += st_pkg::kSectionEntrySize;
    }

    /* Hash tính trên toàn artifact với chính trường hash và vùng chữ ký bằng 0,
     * để thêm chữ ký sau này không làm đổi hash nội dung. */
    std::vector<uint8_t> digest(32, 0u);
    crypto_hash_sha256(digest.data(), out->data(), out->size());
    std::memcpy(out->data() + kOffSha256, digest.data(), digest.size());
    return true;
}

namespace {

/* Một parser duy nhất cho cả `LoadPackageV2` và `UnpackPackageV2`. `ir_out` khác
 * nullptr thì blob CODE_IR được giữ lại; nếu không, chúng vẫn được KIỂM y hệt
 * rồi bỏ đi. Tách thành hai parser sẽ tạo hai bộ ngữ nghĩa cho một định dạng. */
bool parse_package_v2(const uint8_t* data, std::size_t size, uint16_t expected_profile,
                      uint32_t expected_abi, StPackageView* out,
                      std::vector<std::vector<uint8_t>>* ir_out, const char** error_code);

} // namespace

bool LoadPackageV2(const uint8_t* data, std::size_t size, uint16_t expected_profile,
                   uint32_t expected_abi, StPackageView* out, const char** error_code)
{
    return parse_package_v2(data, size, expected_profile, expected_abi, out, nullptr, error_code);
}

bool UnpackPackageV2(const uint8_t* data, std::size_t size, uint16_t expected_profile,
                     uint32_t expected_abi, StPackageContents* out, const char** error_code)
{
    if (out == nullptr) return false;
    *out = StPackageContents{};
    return parse_package_v2(data, size, expected_profile, expected_abi, &out->view,
                            &out->program_ir, error_code);
}

namespace {

bool parse_package_v2(const uint8_t* data, std::size_t size, uint16_t expected_profile,
                      uint32_t expected_abi, StPackageView* out,
                      std::vector<std::vector<uint8_t>>* ir_out, const char** error_code)
{
    if (out == nullptr) return false;
    *out = StPackageView{};
    if (ir_out != nullptr) ir_out->clear();
    if (data == nullptr || size < st_pkg::kHeaderSize)
        return reject(error_code, st_pkg_error::kBadHeader);
    if (size > st_pkg::kMaxArtifactBytes)
        return reject(error_code, st_pkg_error::kResourceLimit);
    if (std::memcmp(data, st_pkg::kMagic, sizeof(st_pkg::kMagic)) != 0)
        return reject(error_code, st_pkg_error::kBadMagic);

    StPackageHeaderView header;
    header.schema_version = read_u16(data, kOffSchemaVersion);
    header.compiler_profile = read_u16(data, kOffCompilerProfile);
    header.target_abi = read_u32(data, kOffTargetAbi);
    header.layout_version = read_u16(data, kOffLayoutVersion);
    header.section_count = read_u16(data, kOffSectionCount);
    header.flags = read_u16(data, kOffFlags);
    header.artifact_bytes = read_u32(data, kOffArtifactBytes);

    if (header.schema_version != st_pkg::kSchemaVersion ||
        header.layout_version != st_pkg::kLayoutVersion)
        return reject(error_code, st_pkg_error::kBadSchema);
    /* Profile phải khớp CHÍNH XÁC. "Gần đúng profile" nghĩa là chạy mã được biên
     * dịch cho một trần tài nguyên khác — đúng loại sai lệch không báo lỗi. */
    if (header.compiler_profile != expected_profile || header.target_abi != expected_abi)
        return reject(error_code, st_pkg_error::kBadProfile);
    if (header.artifact_bytes != size)
        return reject(error_code, st_pkg_error::kBadHeader);
    if (header.section_count == 0 || header.section_count > st_pkg::kMaxSections)
        return reject(error_code, st_pkg_error::kBadSectionTable);

    /* Vùng chữ ký phải bằng 0 khi chưa ký; khác 0 nghĩa là artifact đã bị chạm. */
    for (std::size_t index = kOffSignature; index < st_pkg::kHeaderSize; ++index)
        if (data[index] != 0) return reject(error_code, st_pkg_error::kBadHeader);

    std::vector<uint8_t> normalized(data, data + size);
    std::memset(normalized.data() + kOffSha256, 0, 32);
    std::vector<uint8_t> digest(32, 0u);
    crypto_hash_sha256(digest.data(), normalized.data(), normalized.size());
    if (std::memcmp(digest.data(), data + kOffSha256, 32) != 0)
        return reject(error_code, st_pkg_error::kBadHash);

    const std::size_t table_bytes =
        static_cast<std::size_t>(header.section_count) * st_pkg::kSectionEntrySize;
    if (st_pkg::kHeaderSize + table_bytes > size)
        return reject(error_code, st_pkg_error::kBadSectionTable);

    struct Entry { uint16_t type; uint32_t offset; uint32_t bytes; uint32_t items; };
    std::vector<Entry> entries;
    uint32_t previous_end = static_cast<uint32_t>(st_pkg::kHeaderSize + table_bytes);
    uint16_t previous_type = 0;
    for (uint16_t index = 0; index < header.section_count; ++index) {
        const std::size_t base = st_pkg::kHeaderSize + index * st_pkg::kSectionEntrySize;
        Entry entry;
        entry.type = read_u16(data, base);
        const uint16_t flags = read_u16(data, base + 2);
        entry.offset = read_u32(data, base + 4);
        entry.bytes = read_u32(data, base + 8);
        entry.items = read_u32(data, base + 12);
        if (flags != 0) return reject(error_code, st_pkg_error::kBadSectionTable);
        if (entry.type <= previous_type) return reject(error_code, st_pkg_error::kBadSectionTable);
        previous_type = entry.type;
        /* Cộng trên 64 bit rồi mới so: cộng trên 32 bit là chỗ tràn số kinh điển
         * cho phép một section "vượt biên mà vẫn nằm trong". */
        const uint64_t end = static_cast<uint64_t>(entry.offset) + entry.bytes;
        if (entry.offset < previous_end || end > size)
            return reject(error_code, st_pkg_error::kBadSectionTable);
        previous_end = static_cast<uint32_t>(end);
        entries.push_back(entry);
    }

    for (const Entry& entry : entries) {
        const uint8_t* payload = data + entry.offset;
        std::size_t cursor = 0;
        switch (entry.type) {
        case st_pkg::SEC_POU_TABLE: {
            if (entry.items > st_profile_generated::kMaxObjects)
                return reject(error_code, st_pkg_error::kResourceLimit);
            for (uint32_t index = 0; index < entry.items; ++index) {
                std::string name;
                if (!read_string(payload, entry.bytes, &cursor, &name) ||
                    cursor + 3 > entry.bytes)
                    return reject(error_code, st_pkg_error::kBadRecord);
                cursor += 2;
                const uint8_t inputs = payload[cursor++];
                if (cursor + inputs > entry.bytes)
                    return reject(error_code, st_pkg_error::kBadRecord);
                cursor += inputs;
                out->pou_names.push_back(std::move(name));
            }
            break;
        }
        case st_pkg::SEC_PROGRAM_TABLE: {
            if (entry.items == 0 || entry.items > st_profile_generated::kMaxProgramsTotal)
                return reject(error_code, st_pkg_error::kResourceLimit);
            for (uint32_t index = 0; index < entry.items; ++index) {
                std::string name;
                if (!read_string(payload, entry.bytes, &cursor, &name))
                    return reject(error_code, st_pkg_error::kBadRecord);
                out->program_names.push_back(std::move(name));
            }
            break;
        }
        case st_pkg::SEC_CODE_IR: {
            for (uint32_t index = 0; index < entry.items; ++index) {
                if (cursor + 4 > entry.bytes) return reject(error_code, st_pkg_error::kBadRecord);
                const uint32_t blob = read_u32(payload, cursor);
                cursor += 4;
                if (blob == 0 || static_cast<uint64_t>(cursor) + blob > entry.bytes)
                    return reject(error_code, st_pkg_error::kBadRecord);
                if (ir_out != nullptr)
                    ir_out->emplace_back(payload + cursor, payload + cursor + blob);
                cursor += blob;
            }
            break;
        }
        case st_pkg::SEC_FB_LAYOUT: {
            if (entry.items > st_profile_generated::kMaxFunctionBlockInstances)
                return reject(error_code, st_pkg_error::kResourceLimit);
            for (uint32_t index = 0; index < entry.items; ++index) {
                std::string path, type_name;
                if (!read_string(payload, entry.bytes, &cursor, &path) ||
                    !read_string(payload, entry.bytes, &cursor, &type_name) ||
                    cursor + 9 > entry.bytes)
                    return reject(error_code, st_pkg_error::kBadRecord);
                cursor += 9;
            }
            out->fb_instance_count = entry.items;
            break;
        }
        case st_pkg::SEC_SIGNAL_DEFS: {
            if (entry.items > st_profile_generated::kMaxSignals)
                return reject(error_code, st_pkg_error::kResourceLimit);
            std::set<std::string> published;
            for (uint32_t index = 0; index < entry.items; ++index) {
                std::string name, producer;
                if (!read_string(payload, entry.bytes, &cursor, &name) ||
                    !read_string(payload, entry.bytes, &cursor, &producer) ||
                    cursor + 5 > entry.bytes)
                    return reject(error_code, st_pkg_error::kBadRecord);
                cursor += 5;
                /* Đúng MỘT publisher cho mỗi signal (DDD §4.5). Kiểm ở loader vì
                 * artifact có thể tới từ nơi khác chứ không chỉ từ writer này. */
                if (!published.insert(name).second)
                    return reject(error_code, st_pkg_error::kSignalPublisher);
                out->signal_names.push_back(std::move(name));
            }
            break;
        }
        case st_pkg::SEC_BINDING_MANIFEST: {
            if (entry.items > st_profile_generated::kMaxPackageBindings)
                return reject(error_code, st_pkg_error::kResourceLimit);
            std::map<std::string, std::string> output_owner;
            for (uint32_t index = 0; index < entry.items; ++index) {
                std::string owner, point_id;
                if (!read_string(payload, entry.bytes, &cursor, &owner) ||
                    !read_string(payload, entry.bytes, &cursor, &point_id) ||
                    cursor + 2 > entry.bytes)
                    return reject(error_code, st_pkg_error::kBadRecord);
                const uint8_t category = payload[cursor];
                const bool is_output = payload[cursor + 1] != 0;
                cursor += 2;
                if (!is_output) continue;
                const std::string key = std::to_string(category) + ":" + point_id;
                /* Một output binding có ĐÚNG MỘT Program owner (DDD §4.6). Hai
                 * Program cùng ghi một điểm là tranh chấp quyền điều khiển. */
                const auto existing = output_owner.find(key);
                if (existing != output_owner.end() && existing->second != owner)
                    return reject(error_code, st_pkg_error::kOutputOwner);
                if (existing != output_owner.end())
                    return reject(error_code, st_pkg_error::kOutputOwner);
                output_owner.emplace(key, owner);
                out->output_point_ids.push_back(point_id);
            }
            break;
        }
        case st_pkg::SEC_LIBRARY_LOCK: {
            std::string version, revision;
            if (!read_string(payload, entry.bytes, &cursor, &version) ||
                cursor + 32 > entry.bytes)
                return reject(error_code, st_pkg_error::kBadRecord);
            cursor += 32;
            if (!read_string(payload, entry.bytes, &cursor, &revision))
                return reject(error_code, st_pkg_error::kBadRecord);
            out->library_system_version = std::move(version);
            break;
        }
        case st_pkg::SEC_RESOURCE_BUDGET: {
            if (entry.bytes < 24) return reject(error_code, st_pkg_error::kBadRecord);
            const uint32_t programs = read_u32(payload, 0);
            const uint32_t pous = read_u32(payload, 4);
            const uint32_t fbs = read_u32(payload, 8);
            const uint32_t signals = read_u32(payload, 12);
            const uint32_t bindings = read_u32(payload, 16);
            out->retain_bytes = read_u32(payload, 20);
            if (programs > st_profile_generated::kMaxProgramsTotal ||
                pous > st_profile_generated::kMaxObjects ||
                fbs > st_profile_generated::kMaxFunctionBlockInstances ||
                signals > st_profile_generated::kMaxSignals ||
                bindings > st_profile_generated::kMaxPackageBindings ||
                out->retain_bytes > st_profile_generated::kMaxRetainBytes *
                                        st_profile_generated::kMaxProgramsTotal)
                return reject(error_code, st_pkg_error::kResourceLimit);
            break;
        }
        default:
            /* Section lạ không được bỏ qua im lặng: nó có thể mang ngữ nghĩa mà
             * runtime này không biết, và bỏ qua nghĩa là chạy thiếu một phần gói. */
            return reject(error_code, st_pkg_error::kBadSectionTable);
        }
        if (cursor != entry.bytes && entry.type != st_pkg::SEC_RESOURCE_BUDGET)
            return reject(error_code, st_pkg_error::kBadRecord);
    }

    if (out->program_names.empty()) return reject(error_code, st_pkg_error::kBadSectionTable);
    /* Mỗi Program phải có đúng một blob IR. Lệch số nghĩa là gói thiếu thân
     * chương trình cho một Program nào đó — nạp nó sẽ cho một instance không
     * chạy được mà không ai báo. */
    if (ir_out != nullptr && ir_out->size() != out->program_names.size())
        return reject(error_code, st_pkg_error::kBadSectionTable);
    out->header = header;
    return true;
}

} // namespace

bool ProbePackageFormat(const uint8_t* data, std::size_t size, bool* is_v2,
                        const char** error_code)
{
    if (is_v2 == nullptr) return false;
    if (data == nullptr || size < 8) return reject(error_code, st_pkg_error::kBadHeader);
    static constexpr char kV1Magic[8] = {'M', 'K', 'D', 'D', 'C', 'I', 'R', '1'};
    if (std::memcmp(data, st_pkg::kMagic, sizeof(st_pkg::kMagic)) == 0) {
        *is_v2 = true;
        return true;
    }
    if (std::memcmp(data, kV1Magic, sizeof(kV1Magic)) == 0) {
        /* Dual-reader theo DDD §12.1: LKG v1 hiện hữu KHÔNG được mất hiệu lực khi
         * nâng cấp. Nội dung v1 do loader v1 chịu trách nhiệm. */
        *is_v2 = false;
        return true;
    }
    return reject(error_code, st_pkg_error::kBadMagic);
}

} // namespace core
