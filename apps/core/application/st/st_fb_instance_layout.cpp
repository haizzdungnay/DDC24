#include "st/st_fb_instance_layout.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <vector>

#include <sodium.h>

#include "st/st_limits.hpp"
#include "st/st_profile_generated.hpp"

namespace core {
namespace {

std::string fold(const std::string& value)
{
    std::string out;
    out.reserve(value.size());
    for (char ch : value)
        out.push_back(static_cast<char>((ch >= 'a' && ch <= 'z') ? ch - ('a' - 'A') : ch));
    return out;
}

std::size_t scalar_size(StType type)
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

bool fail(StDiagnostic* diag, const char* code, const std::string& message,
          int line, int column)
{
    if (diag != nullptr) {
        diag->severity = StSeverity::ERROR;
        diag->code = code;
        diag->message = message;
        diag->line = line;
        diag->column = column;
        diag->length = 1;
    }
    return false;
}

void hash_text(crypto_hash_sha256_state* state, const std::string& value)
{
    const uint32_t length = static_cast<uint32_t>(value.size());
    crypto_hash_sha256_update(state, reinterpret_cast<const unsigned char*>(&length),
                              sizeof(length));
    crypto_hash_sha256_update(state, reinterpret_cast<const unsigned char*>(value.data()),
                              value.size());
}

void hash_u32(crypto_hash_sha256_state* state, uint32_t value)
{
    crypto_hash_sha256_update(state, reinterpret_cast<const unsigned char*>(&value),
                              sizeof(value));
}

/* State cục bộ của MỘT FUNCTION_BLOCK người dùng: tổng kích thước biến local và
 * RETAIN của chính nó. Instance lồng bên trong được cấp phát riêng ở lớp trên,
 * nên không cộng vào đây — cộng hai lần là nhân đôi bộ nhớ một cách âm thầm. */
uint32_t own_state_size(const StProgram& pou)
{
    uint32_t total = 0;
    for (const StVarDecl& decl : pou.vars) {
        if (decl.storage == StStorage::VAR_LOCAL || decl.storage == StStorage::VAR_RETAIN ||
            decl.storage == StStorage::VAR_OUTPUT)
            total += static_cast<uint32_t>(scalar_size(decl.type));
    }
    return total;
}

struct Planner {
    const std::map<std::string, const StProgram*>& pou_by_name;
    const std::map<std::string, const StLibraryEntry*>& library_by_name;
    StFbLayoutResult* out;
    StDiagnostic* diag;
    uint32_t next_offset = 0;

    /* `chain` là các kiểu FB đang mở trên đường đi hiện tại — dùng để bắt vòng
     * CHỨA (containment), khác với vòng GỌI mà st_pou_registry đã bắt. Một FB
     * chứa chính nó sẽ cần bộ nhớ vô hạn, nên nó phải chết ở đây. */
    bool expand(const StProgram& type_pou, const std::string& owner_program,
                const std::string& path_prefix, std::size_t depth,
                std::set<std::string>* chain)
    {
        if (depth > st_fb_layout::kMaxNestingDepth)
            return fail(diag, st_diag_code::kPouRecursion,
                        "function block nesting exceeds depth " +
                            std::to_string(st_fb_layout::kMaxNestingDepth) + " at '" +
                            path_prefix + "'",
                        type_pou.line, type_pou.column);

        /* Duyệt theo THỨ TỰ TÊN, không theo thứ tự khai báo: đây chính là điều
         * làm layout ổn định khi người dùng sắp xếp lại nguồn. */
        std::vector<const StFbDecl*> ordered;
        ordered.reserve(type_pou.fbs.size());
        for (const StFbDecl& decl : type_pou.fbs) ordered.push_back(&decl);
        std::sort(ordered.begin(), ordered.end(),
                  [](const StFbDecl* a, const StFbDecl* b) {
                      return fold(a->name) < fold(b->name);
                  });

        for (const StFbDecl* decl : ordered) {
            StFbInstanceNode node;
            node.path = path_prefix + "." + decl->name;
            node.owner_program = owner_program;
            node.retained = decl->retained;
            node.depth = depth;
            node.is_user_type = decl->is_user_type;

            const StProgram* nested = nullptr;
            if (!decl->is_user_type) {
                node.type_name = st_fb_type_name(decl->fb_type);
                node.state_size = static_cast<uint32_t>(st_fb_retain_state_size(decl->fb_type));
                if (node.state_size == 0)
                    return fail(diag, st_diag_code::kPouInstanceLayout,
                                "built-in function block '" + node.type_name +
                                    "' has no state size",
                                decl->line, decl->column);
            } else {
                const std::string key = fold(decl->user_type_name);
                const auto in_project = pou_by_name.find(key);
                const auto in_library = library_by_name.find(key);
                if (in_project == pou_by_name.end() && in_library == library_by_name.end())
                    return fail(diag, st_diag_code::kLibraryEntryMissing,
                                "function block type '" + decl->user_type_name +
                                    "' used by '" + node.path +
                                    "' is neither a Project POU nor a pinned library entry",
                                decl->line, decl->column);

                const StPouKind kind = (in_project != pou_by_name.end())
                                           ? in_project->second->kind
                                           : in_library->second->kind;
                if (kind != StPouKind::FUNCTION_BLOCK)
                    return fail(diag, st_diag_code::kPouSignatureInvalid,
                                "'" + decl->user_type_name + "' is a " +
                                    st_pou_kind_name(kind) +
                                    " and cannot be instantiated as a function block",
                                decl->line, decl->column);

                node.is_library_type = (in_project == pou_by_name.end());
                node.type_name = node.is_library_type ? in_library->second->name
                                                      : in_project->second->name;
                if (!node.is_library_type) {
                    if (chain->count(key) != 0)
                        return fail(diag, st_diag_code::kPouRecursion,
                                    "containment cycle: function block '" + node.type_name +
                                        "' contains itself through '" + node.path + "'",
                                    decl->line, decl->column);
                    nested = in_project->second;
                    node.state_size = own_state_size(*nested);
                } else {
                    /* Entry library chỉ có chữ ký ở tầng này; kích thước state
                     * thật đến cùng artifact library (T59-204). Ghi 0 và KHÔNG
                     * đoán một con số, vì đoán sai làm lệch mọi offset phía sau. */
                    node.state_size = 0;
                }
            }

            node.state_offset = next_offset;
            next_offset += node.state_size;
            if (next_offset > st_profile_generated::kMaxRetainBytes * 16u)
                return fail(diag, st_diag_code::kPouInstanceLayout,
                            "function block state exceeds the profile budget at '" +
                                node.path + "'",
                            decl->line, decl->column);

            crypto_hash_sha256_state state;
            crypto_hash_sha256_init(&state);
            static constexpr char prefix[] = "MKDDC-FB-INSTANCE-IDENTITY-V1";
            crypto_hash_sha256_update(&state,
                                      reinterpret_cast<const unsigned char*>(prefix),
                                      sizeof(prefix) - 1);
            hash_text(&state, node.path);
            hash_text(&state, node.type_name);
            crypto_hash_sha256_final(&state, node.identity.data());

            if (node.retained) out->retain_state_bytes += node.state_size;
            out->instances.push_back(node);
            if (out->instances.size() > st_profile_generated::kMaxFunctionBlockInstances)
                return fail(diag, st_diag_code::kPouInstanceLayout,
                            "package declares more than " +
                                std::to_string(
                                    st_profile_generated::kMaxFunctionBlockInstances) +
                                " function block instances",
                            decl->line, decl->column);

            if (nested != nullptr) {
                chain->insert(fold(node.type_name));
                if (!expand(*nested, owner_program, node.path, depth + 1, chain)) return false;
                chain->erase(fold(node.type_name));
            }
        }
        return true;
    }
};

} // namespace

bool st_plan_fb_instance_layout(const std::vector<StPouSource>& sources,
                                const std::vector<StLibraryEntry>& library,
                                StFbLayoutResult* out,
                                StDiagnostic* diag)
{
    if (out == nullptr) return false;
    *out = StFbLayoutResult{};

    std::map<std::string, const StProgram*> pou_by_name;
    for (const StPouSource& source : sources) {
        if (source.pou == nullptr)
            return fail(diag, st_diag_code::kPouSignatureInvalid, "POU rỗng trong tập nguồn", 0, 0);
        pou_by_name[fold(source.pou->name)] = source.pou;
    }
    std::map<std::string, const StLibraryEntry*> library_by_name;
    for (const StLibraryEntry& entry : library) library_by_name[fold(entry.name)] = &entry;

    Planner planner{pou_by_name, library_by_name, out, diag, 0};

    /* Chỉ PROGRAM là gốc: mọi state phải thuộc đúng một Program owner (DDD §4.4).
     * Một FUNCTION_BLOCK không được instantiate ở đâu thì không tồn tại state cho
     * nó, và đó là đúng — nó chưa được ai dùng. */
    for (const auto& item : pou_by_name) {
        const StProgram& pou = *item.second;
        if (pou.kind != StPouKind::PROGRAM) continue;
        if (pou.fbs.size() > st_profile_generated::kMaxFunctionBlocks)
            return fail(diag, st_diag_code::kPouInstanceLayout,
                        "PROGRAM '" + pou.name + "' declares more than " +
                            std::to_string(st_profile_generated::kMaxFunctionBlocks) +
                            " function block instances",
                        pou.line, pou.column);
        std::set<std::string> chain;
        if (!planner.expand(pou, pou.name, pou.name, 1, &chain)) return false;
    }

    std::sort(out->instances.begin(), out->instances.end(),
              [](const StFbInstanceNode& a, const StFbInstanceNode& b) {
                  return a.path < b.path;
              });
    out->total_state_bytes = planner.next_offset;

    crypto_hash_sha256_state state;
    crypto_hash_sha256_init(&state);
    static constexpr char prefix[] = "MKDDC-FB-LAYOUT-IDENTITY-V1";
    crypto_hash_sha256_update(&state, reinterpret_cast<const unsigned char*>(prefix),
                              sizeof(prefix) - 1);
    for (const StFbInstanceNode& node : out->instances) {
        hash_text(&state, node.path);
        hash_text(&state, node.type_name);
        hash_u32(&state, node.state_offset);
        hash_u32(&state, node.state_size);
        hash_u32(&state, node.retained ? 1u : 0u);
    }
    hash_u32(&state, out->total_state_bytes);
    crypto_hash_sha256_final(&state, out->layout_identity.data());
    return true;
}

} // namespace core
