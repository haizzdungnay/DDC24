/**
 * @file  st_compile.hpp
 * @brief Sinh Typed IR từ AST đã typecheck. Đây là bước cuối của compiler —
 *        sau nó AST bị vứt bỏ và chỉ artifact đi tiếp tới runtime.
 *
 *        Điểm mấu chốt: mọi biến, hằng và cổng FB được cấp SLOT CỐ ĐỊNH ngay
 *        tại đây. Nhờ vậy runtime truy cập biến bằng chỉ số O(1), không tra
 *        tên bằng chuỗi, và toàn bộ bộ nhớ thực thi cấp phát được một lần
 *        lúc load (PROGRAM_SOM_FW_DRAFT_DESIGN §7.2).
 */
#ifndef CORE_ST_COMPILE_HPP
#define CORE_ST_COMPILE_HPP

#include <array>
#include <string>
#include <utility>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_pou_registry.hpp"
#include "st/st_program.hpp"
#include "st/st_review_gate.hpp"

namespace core {

/* AST (đã qua typecheck_st_program) -> IR. `source` chỉ dùng để tính
 * source_hash truy vết. Trả false + *diag khi vượt giới hạn tài nguyên. */
bool compile_st_to_ir(const StProgram& prog, const std::string& source, StIrModule* out,
                      StDiagnostic* diag);

/* Chính sách compile ở biên Check. Mặc định BẬT review gate. */
struct StCompileOptions {
    bool enforce_review_gate = true;
    /* Bảng review gate. `nullptr` (mặc định, và là giá trị DUY NHẤT đường
     * production dùng) = bảng sinh từ profile. Chỉ test cơ chế cổng đặt bảng
     * giả để khẳng định pipeline compile ST/FBD thật sự hỏi cổng. */
    StReviewGateBlocks review_gate_blocks = nullptr;
    /* ISS-STED-02 — chính sách của TARGET PROFILE, không phải của compiler.
     *
     * Compiler luôn phát warning với severity thật; profile khắt khe mới quyết
     * định có nâng chúng thành lỗi hay không. Đặt quyết định này trong Checker
     * sẽ khoá cứng một chính sách vào ngôn ngữ và không profile nào đổi được. */
    bool warnings_as_errors = false;
    std::string program_identity;
    std::vector<StPublishedSignalContract> published_signals;
};

struct StLinkedPouInfo {
    std::string             name;
    StPouKind               kind = StPouKind::FUNCTION;
    bool                    from_library = false;
    std::string             library_entry_id;
    std::string             version;
    std::string             library_origin;
    std::array<uint8_t, 32> content_sha256{};
    std::array<uint8_t, 32> body_sha256{};
    uint32_t                instruction_count = 0;
    std::vector<std::string> input_names;
    std::vector<StType>      input_types;
    std::vector<std::string> output_names;
    std::vector<StType>      output_types;
    bool                     has_return_type = false;
    StType                   return_type = StType::REAL;
};

/* Lower một PROGRAM đã typecheck cùng bảng POU đã seal. FUNCTION và
 * FUNCTION_BLOCK được inline thành Typed IR thật; không còn USER_CALL ở biên
 * executor. */
bool compile_st_to_ir_linked(const StProgram& program, const std::string& bundle_source,
                             const std::vector<StPouSource>& sources,
                             const StPouRegistryResult& registry, StIrModule* out,
                             std::vector<StLinkedPouInfo>* linked_pous,
                             StDiagnostic* diag,
                             const StCompileOptions& options = StCompileOptions{});

struct StPouTextSource {
    enum class Language : uint8_t { ST = 1, FBD = 2 };
    std::string source_id;
    std::string pou_name;
    Language language = Language::ST;
    /* Bắt buộc với FBD vì schema graph không tự mang kind IEC của định nghĩa. */
    StPouKind declared_kind = StPouKind::PROGRAM;
    std::string source;
    std::vector<StLibraryRequirement> requires_library;
    bool from_library = false;
    std::string library_entry_id;
    std::string version;
    std::string library_origin;

    StPouTextSource() = default;
    StPouTextSource(std::string id, std::string name, Language source_language,
                    StPouKind source_kind, std::string source_text,
                    std::vector<StLibraryRequirement> requirements = {},
                    bool is_from_library = false, std::string entry_id = {},
                    std::string source_version = {}, std::string source_origin = {})
        : source_id(std::move(id)), pou_name(std::move(name)),
          language(source_language), declared_kind(source_kind),
          source(std::move(source_text)), requires_library(std::move(requirements)),
          from_library(is_from_library), library_entry_id(std::move(entry_id)),
          version(std::move(source_version)), library_origin(std::move(source_origin)) {}
};

/* Parse một định nghĩa ST/FBD thành AST POU chung. FBD FUNCTION phải có đúng
 * một OUTPUT; FBD FUNCTION_BLOCK giữ toàn bộ OUTPUT làm interface instance. */
bool parse_st_pou_text_source(const StPouTextSource& source, StProgram* out,
                              std::string* canonical_source,
                              StDiagnostic* diag);
bool parse_st_pou_text_source(const StPouTextSource& source, StProgram* out,
                              std::string* canonical_source,
                              StDiagnostic* diag, StDiagnosticBag* bag);

struct StLinkedProgram {
    std::string source_id;
    StIrModule module;
    std::vector<StLinkedPouInfo> linked_pous;
};

struct StPouBundleCompileResult {
    std::vector<StLinkedProgram> programs;
    StPouRegistryResult registry;
};

/* Parse -> registry/version/DAG -> typecheck registry-aware -> inline lowering
 * cho toàn bộ tập nguồn. Chỉ PROGRAM sinh artifact; helper POU nằm trong code
 * đã inline và bảng chữ ký của package v2. */
bool compile_st_pou_bundle(const std::vector<StPouTextSource>& sources,
                           const std::vector<StLibraryEntry>& library,
                           StPouBundleCompileResult* out, StDiagnostic* diag,
                           const StCompileOptions& options = StCompileOptions{});

/* ISS-STED-01: như trên nhưng thu MỌI diagnostic phục hồi được vào `*bag`
 * (parse của mọi POU, rồi typecheck của mọi POU). Túi CHƯA `finalize()` —
 * caller còn gộp thêm diagnostic của binding trước khi áp trần/sort. */
bool compile_st_pou_bundle(const std::vector<StPouTextSource>& sources,
                           const std::vector<StLibraryEntry>& library,
                           StPouBundleCompileResult* out, StDiagnostic* diag,
                           const StCompileOptions& options, StDiagnosticBag* bag);

/* Tiện ích một bước cho CLI và test: source -> parse -> typecheck -> review gate
 * -> IR. */
bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag);
bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag,
                       const StCompileOptions& options);
bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag,
                       const StCompileOptions& options, StDiagnosticBag* bag);

} // namespace core

#endif /* CORE_ST_COMPILE_HPP */
