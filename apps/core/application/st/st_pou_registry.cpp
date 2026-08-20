#include "st/st_pou_registry.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace core {
namespace {

std::string fold(const std::string& value)
{
    std::string out;
    out.reserve(value.size());
    for (char ch : value)
        out.push_back(static_cast<char>(
            (ch >= 'a' && ch <= 'z') ? ch - ('a' - 'A') : ch));
    return out;
}

struct CallSite {
    std::string name;
    int line = 0;
    int column = 0;
};

/* Duyệt biểu thức thu mọi USER_CALL. Đệ quy theo cấu trúc cây biểu thức, độ sâu
 * đã bị parser chặn bằng `ST-SYN-002` nên không cần trần riêng ở đây. */
void collect_expr(const StExpr* expr, std::vector<CallSite>* out)
{
    if (expr == nullptr) return;
    if (expr->kind == StExpr::Kind::USER_CALL)
        out->push_back({expr->user_call_name, expr->line, expr->column});
    collect_expr(expr->lhs.get(), out);
    collect_expr(expr->rhs.get(), out);
    collect_expr(expr->operand.get(), out);
    for (const auto& arg : expr->args) collect_expr(arg.get(), out);
}

void collect_stmts(const std::vector<StStmt>& body, std::vector<CallSite>* out);

void collect_stmt(const StStmt& stmt, std::vector<CallSite>* out)
{
    switch (stmt.kind) {
    case StStmt::Kind::ASSIGN:
        collect_expr(stmt.assign_expr.get(), out);
        return;
    case StStmt::Kind::IF:
        for (const StIfBranch& branch : stmt.branches) {
            collect_expr(branch.cond.get(), out);
            collect_stmts(branch.body, out);
        }
        return;
    case StStmt::Kind::FB_CALL:
        for (const StFbArg& arg : stmt.fb_args) collect_expr(arg.value.get(), out);
        return;
    }
}

void collect_stmts(const std::vector<StStmt>& body, std::vector<CallSite>* out)
{
    for (const StStmt& stmt : body) collect_stmt(stmt, out);
}

/* `set_diag` là helper cục bộ của từng translation unit trong lớp này (parser và
 * semantic mỗi bên có bản riêng), nên registry điền thẳng thay vì kéo thêm phụ
 * thuộc chỉ để dùng một hàm bốn dòng. */
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

} // namespace

bool st_build_pou_registry(const std::vector<StPouSource>& sources,
                           const std::vector<StLibraryEntry>& library,
                           StPouRegistryResult* out,
                           StDiagnostic* diag)
{
    if (out == nullptr) return false;
    *out = StPouRegistryResult{};

    /* Bảng library tra theo tên case-folded. Trùng tên trong library là lỗi cấu
     * hình library chứ không phải lỗi của Project, nhưng vẫn phải fail-closed. */
    std::map<std::string, const StLibraryEntry*> library_by_name;
    for (const StLibraryEntry& entry : library) {
        const std::string key = fold(entry.name);
        if (!library_by_name.emplace(key, &entry).second)
            return fail(diag, st_diag_code::kLibraryVersionDrift,
                        "library declares '" + entry.name + "' more than once", 0, 0);
    }

    /* Bảng POU của Project. Tên unique case-folded (DDD §4.2), và không được
     * trùng entry library — nếu trùng thì mỗi lần gọi là mơ hồ, và "ưu tiên bên
     * nào" là loại quy ước ngầm gây sai lệch điều khiển im lặng. */
    std::map<std::string, const StProgram*> pou_by_name;
    for (const StPouSource& source : sources) {
        if (source.pou == nullptr)
            return fail(diag, st_diag_code::kPouSignatureInvalid, "POU rỗng trong tập nguồn", 0, 0);
        const StProgram& pou = *source.pou;
        const std::string key = fold(pou.name);
        if (!pou_by_name.emplace(key, &pou).second)
            return fail(diag, st_diag_code::kPouSignatureInvalid,
                        "duplicate POU name '" + pou.name + "' (names are case-insensitive)",
                        pou.line, pou.column);
        if (library_by_name.count(key) != 0)
            return fail(diag, st_diag_code::kPouSignatureInvalid,
                        "POU name '" + pou.name +
                            "' is ambiguous: a Control Library entry already uses it",
                        pou.line, pou.column);
    }

    for (const auto& item : pou_by_name) out->pou_order.push_back(item.second->name);

    /* Yêu cầu library: entry phải tồn tại VÀ đúng version đã pin. Hai lỗi này có
     * mã riêng vì cách sửa khác nhau — thêm entry, hay đổi pin. */
    for (const StPouSource& source : sources) {
        for (const StLibraryRequirement& need : source.requires_library) {
            const auto found = library_by_name.find(fold(need.name));
            if (found == library_by_name.end())
                return fail(diag, st_diag_code::kLibraryEntryMissing,
                            "library entry '" + need.name + "' required by '" +
                                source.pou->name + "' is not available",
                            source.pou->line, source.pou->column);
            if (found->second->version != need.version)
                return fail(diag, st_diag_code::kLibraryVersionDrift,
                            "library entry '" + need.name + "' is version '" +
                                found->second->version + "' but '" + source.pou->name +
                                "' pinned '" + need.version + "'",
                            source.pou->line, source.pou->column);
        }
    }

    /* Call graph. Cạnh được gom vào set có thứ tự để hai lần chạy trên cùng
     * nguồn cho ra cùng một danh sách, bất kể thứ tự nạp POU. */
    std::map<std::string, std::set<std::string>> adjacency;
    std::vector<StCallEdge> edges;
    for (const StPouSource& source : sources) {
        const StProgram& pou = *source.pou;
        std::vector<CallSite> calls;
        collect_stmts(pou.body, &calls);
        for (const CallSite& call : calls) {
            const std::string key = fold(call.name);
            const auto in_project = pou_by_name.find(key);
            const auto in_library = library_by_name.find(key);
            if (in_project == pou_by_name.end() && in_library == library_by_name.end())
                return fail(diag, st_diag_code::kLibraryEntryMissing,
                            "call to '" + call.name +
                                "' resolves to neither a Project POU nor a pinned library entry",
                            call.line, call.column);

            const bool is_library = (in_project == pou_by_name.end());
            const std::string callee =
                is_library ? in_library->second->name : in_project->second->name;
            edges.push_back({pou.name, callee, is_library, call.line, call.column});
            if (!is_library) adjacency[fold(pou.name)].insert(key);
            /* Gọi CHÍNH MÌNH là đệ quy trực tiếp — bắt ngay tại đây để thông điệp
             * chỉ đúng dòng gọi, thay vì báo một chu trình dài khó đọc. */
            if (fold(callee) == fold(pou.name))
                return fail(diag, st_diag_code::kPouRecursion,
                            "direct recursion: '" + pou.name + "' calls itself",
                            call.line, call.column);
        }
    }

    std::sort(edges.begin(), edges.end(), [](const StCallEdge& a, const StCallEdge& b) {
        if (a.caller != b.caller) return a.caller < b.caller;
        if (a.callee != b.callee) return a.callee < b.callee;
        if (a.line != b.line) return a.line < b.line;
        return a.column < b.column;
    });
    out->edges = std::move(edges);

    /* Kahn: đồ thị còn cạnh sau khi rút hết đỉnh bậc-vào 0 nghĩa là còn chu trình.
     * Duyệt theo thứ tự tên nên topo order xác định, không phụ thuộc thứ tự nạp. */
    std::map<std::string, int> indegree;
    for (const auto& item : pou_by_name) indegree[item.first] = 0;
    for (const auto& item : adjacency)
        for (const std::string& callee : item.second) indegree[callee] += 1;

    std::set<std::string> ready;
    for (const auto& item : indegree)
        if (item.second == 0) ready.insert(item.first);

    std::vector<std::string> ordered;
    while (!ready.empty()) {
        const std::string current = *ready.begin();
        ready.erase(ready.begin());
        ordered.push_back(pou_by_name.at(current)->name);
        const auto found = adjacency.find(current);
        if (found == adjacency.end()) continue;
        for (const std::string& callee : found->second) {
            if (--indegree[callee] == 0) ready.insert(callee);
        }
    }

    if (ordered.size() != pou_by_name.size()) {
        /* Đỉnh còn lại đều nằm trong hoặc phía sau một chu trình. Báo đỉnh nhỏ
         * nhất theo tên để thông điệp xác định giữa các lần chạy. */
        std::string offender;
        for (const auto& item : indegree)
            if (item.second > 0) { offender = pou_by_name.at(item.first)->name; break; }
        const StProgram* pou = pou_by_name.at(fold(offender));
        return fail(diag, st_diag_code::kPouRecursion,
                    "indirect recursion: call cycle involves '" + offender + "'",
                    pou->line, pou->column);
    }

    /* Kahn cho thứ tự caller-trước; lowering cần callee-trước. */
    std::reverse(ordered.begin(), ordered.end());
    out->topological_order = std::move(ordered);
    return true;
}

} // namespace core
