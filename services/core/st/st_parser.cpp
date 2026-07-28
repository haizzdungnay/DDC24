#include "st/st_parser.hpp"

#include <cctype>
#include <cstdlib>
#include <string>

#include "st/st_limits.hpp"

namespace core {
namespace {

struct Token {
    enum class Kind {
        Ident, Number, Colon, ColonEq, Semicolon, Comma, LParen, RParen,
        Gt, Ge, Lt, Le, Eq, Ne, End
    } kind = Kind::End;
    std::string text;
    float       num = 0.0f;
    int         line = 1;
    int         column = 1;
};

void set_diag(StDiagnostic* diag, const char* code, const std::string& msg, int line, int col)
{
    diag->severity = StSeverity::ERROR;
    diag->code = code;
    diag->message = msg;
    diag->line = line;
    diag->column = col;
    diag->length = 1;
}

bool tokenize(const std::string& src, std::vector<Token>* out, StDiagnostic* diag)
{
    /* Giới hạn source PHẢI kiểm trước khi chạm ký tự đầu tiên: parser không
     * được giả định caller (CLI/BE/loader) đã kiểm hộ. */
    if (src.size() > st_limits::kMaxSourceBytes) {
        set_diag(diag, st_diag_code::kSourceTooLarge,
                 "source is " + std::to_string(src.size()) + " bytes, limit is " +
                     std::to_string(st_limits::kMaxSourceBytes),
                 1, 1);
        return false;
    }
    std::size_t i = 0;
    const std::size_t n = src.size();
    int line = 1, col = 1;
    /* Mỗi lần push_back token đều phải đi qua đây — không có đường vòng. */
    auto push_token = [&](Token t) -> bool {
        if (out->size() >= st_limits::kMaxTokens) {
            set_diag(diag, st_diag_code::kTooManyTokens,
                     "token count exceeds limit of " + std::to_string(st_limits::kMaxTokens),
                     t.line, t.column);
            return false;
        }
        out->push_back(std::move(t));
        return true;
    };
    auto advance_pos = [&](char c) {
        if (c == '\n') { line++; col = 1; }
        else { col++; }
    };
    while (i < n) {
        const char c = src[i];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') { advance_pos(c); i++; continue; }
        const int start_line = line, start_col = col;
        if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
            std::size_t start = i;
            while (i < n && (std::isalnum(static_cast<unsigned char>(src[i])) || src[i] == '_')) {
                advance_pos(src[i]); i++;
            }
            const std::size_t len = i - start;
            if (len > st_limits::kMaxIdentifierLength) {
                set_diag(diag, st_diag_code::kIdentifierTooLong,
                         "identifier is " + std::to_string(len) + " characters, limit is " +
                             std::to_string(st_limits::kMaxIdentifierLength),
                         start_line, start_col);
                return false;
            }
            if (!push_token({Token::Kind::Ident, src.substr(start, len), 0.0f, start_line, start_col}))
                return false;
            continue;
        }
        if (std::isdigit(static_cast<unsigned char>(c))) {
            std::size_t start = i;
            while (i < n && std::isdigit(static_cast<unsigned char>(src[i]))) { advance_pos(src[i]); i++; }
            if (i < n && src[i] == '.') {
                advance_pos(src[i]); i++;
                while (i < n && std::isdigit(static_cast<unsigned char>(src[i]))) { advance_pos(src[i]); i++; }
            }
            const std::string text = src.substr(start, i - start);
            if (!push_token({Token::Kind::Number, text, std::strtof(text.c_str(), nullptr),
                             start_line, start_col}))
                return false;
            continue;
        }
        if (c == ':') {
            if (i + 1 < n && src[i + 1] == '=') {
                if (!push_token({Token::Kind::ColonEq, ":=", 0.0f, start_line, start_col})) return false;
                advance_pos(src[i]); i++; advance_pos(src[i]); i++;
            } else {
                if (!push_token({Token::Kind::Colon, ":", 0.0f, start_line, start_col})) return false;
                advance_pos(src[i]); i++;
            }
            continue;
        }
        if (c == ';') { if (!push_token({Token::Kind::Semicolon, ";", 0.0f, start_line, start_col})) return false; advance_pos(c); i++; continue; }
        if (c == ',') { if (!push_token({Token::Kind::Comma, ",", 0.0f, start_line, start_col})) return false; advance_pos(c); i++; continue; }
        if (c == '(') { if (!push_token({Token::Kind::LParen, "(", 0.0f, start_line, start_col})) return false; advance_pos(c); i++; continue; }
        if (c == ')') { if (!push_token({Token::Kind::RParen, ")", 0.0f, start_line, start_col})) return false; advance_pos(c); i++; continue; }
        if (c == '=') { if (!push_token({Token::Kind::Eq, "=", 0.0f, start_line, start_col})) return false; advance_pos(c); i++; continue; }
        if (c == '>') {
            if (i + 1 < n && src[i + 1] == '=') {
                if (!push_token({Token::Kind::Ge, ">=", 0.0f, start_line, start_col})) return false;
                advance_pos(src[i]); i++; advance_pos(src[i]); i++;
            } else {
                if (!push_token({Token::Kind::Gt, ">", 0.0f, start_line, start_col})) return false;
                advance_pos(src[i]); i++;
            }
            continue;
        }
        if (c == '<') {
            if (i + 1 < n && src[i + 1] == '=') {
                if (!push_token({Token::Kind::Le, "<=", 0.0f, start_line, start_col})) return false;
                advance_pos(src[i]); i++; advance_pos(src[i]); i++;
            } else if (i + 1 < n && src[i + 1] == '>') {
                if (!push_token({Token::Kind::Ne, "<>", 0.0f, start_line, start_col})) return false;
                advance_pos(src[i]); i++; advance_pos(src[i]); i++;
            } else {
                if (!push_token({Token::Kind::Lt, "<", 0.0f, start_line, start_col})) return false;
                advance_pos(src[i]); i++;
            }
            continue;
        }
        set_diag(diag, st_diag_code::kLexUnexpectedChar,
                 std::string("unexpected character '") + c + "'", start_line, start_col);
        return false;
    }
    /* Token End luôn phải vào được — nếu vừa chạm trần thì báo tràn thay vì
     * trả vector không có sentinel (Parser::peek() sẽ đọc ngoài mảng). */
    if (!push_token({Token::Kind::End, "", 0.0f, line, col})) return false;
    return true;
}

class Parser {
public:
    explicit Parser(std::vector<Token> tokens) : tok_(std::move(tokens)) {}

    bool parse_program(StProgram* out, StDiagnostic* diag)
    {
        if (!expect_ident("PROGRAM", diag)) return false;
        if (!at_ident()) return fail("expected program name", diag);
        out->name = advance().text;

        if (!expect_ident("VAR_INPUT", diag)) return false;
        if (!parse_var_decls("END_VAR", &out->inputs, diag)) return false;
        if (!expect_ident("END_VAR", diag)) return false;

        if (!expect_ident("VAR_OUTPUT", diag)) return false;
        if (!parse_var_decls("END_VAR", &out->outputs, diag)) return false;
        if (!expect_ident("END_VAR", diag)) return false;

        if (!parse_stmt_list({"END_PROGRAM"}, &out->body, diag)) return false;
        if (!expect_ident("END_PROGRAM", diag)) return false;
        return true;
    }

private:
    static constexpr const char* kReservedWords[] = {
        "PROGRAM", "VAR_INPUT", "VAR_OUTPUT", "END_VAR", "END_PROGRAM",
        "IF", "THEN", "ELSE", "END_IF", "REAL", "BOOL", "TRUE", "FALSE",
        "AND", "OR", "NOT"
    };

    std::vector<Token> tok_;
    std::size_t pos_ = 0;

    /* Bộ đếm giới hạn — xem st_limits.hpp. expr_depth_/stmt_depth_ là độ sâu
     * ĐANG lồng (tăng khi vào, giảm khi ra); var_count_/stmt_count_ là tổng
     * tích luỹ cho cả chương trình. */
    int         expr_depth_ = 0;
    int         stmt_depth_ = 0;
    std::size_t var_count_ = 0;
    std::size_t stmt_count_ = 0;

    /* RAII guard: bảo đảm depth luôn giảm đúng kể cả khi thoát bằng return
     * false ở giữa hàm. Đếm tay bằng ++/-- thủ công là nguồn lỗi kinh điển
     * ở parser có nhiều nhánh fail. */
    class DepthGuard {
    public:
        DepthGuard(int* d) : d_(d) { ++(*d_); }
        ~DepthGuard() { --(*d_); }
        DepthGuard(const DepthGuard&) = delete;
        DepthGuard& operator=(const DepthGuard&) = delete;
    private:
        int* d_;
    };

    bool fail_depth(const char* what, int limit, StDiagnostic* diag)
    {
        set_diag(diag, st_diag_code::kNestingTooDeep,
                 std::string(what) + " nesting exceeds limit of " + std::to_string(limit),
                 peek().line, peek().column);
        return false;
    }

    const Token& peek() const { return tok_[pos_]; }
    Token advance() { return tok_[pos_ < tok_.size() - 1 ? pos_++ : pos_]; }
    bool at_ident() const { return peek().kind == Token::Kind::Ident; }
    bool at_ident(const char* text) const { return at_ident() && peek().text == text; }
    bool at_end() const { return peek().kind == Token::Kind::End; }

    static bool is_reserved(const std::string& text)
    {
        for (const char* w : kReservedWords)
            if (text == w) return true;
        return false;
    }

    bool fail(const std::string& msg, StDiagnostic* diag)
    {
        set_diag(diag, st_diag_code::kSyntaxUnexpected, msg, peek().line, peek().column);
        return false;
    }

    bool expect_ident(const char* keyword, StDiagnostic* diag)
    {
        if (!at_ident(keyword))
            return fail(std::string("expected '") + keyword + "'", diag);
        advance();
        return true;
    }

    bool expect_kind(Token::Kind k, const char* what, StDiagnostic* diag)
    {
        if (peek().kind != k) return fail(std::string("expected ") + what, diag);
        advance();
        return true;
    }

    bool parse_var_decls(const char* stop_keyword, std::vector<StVarDecl>* out, StDiagnostic* diag)
    {
        while (!at_ident(stop_keyword)) {
            if (at_end()) return fail("unexpected end of source in VAR block", diag);
            if (!at_ident()) return fail("expected variable name", diag);
            if (is_reserved(peek().text))
                return fail("'" + peek().text + "' is a reserved word, cannot be used as variable name", diag);
            StVarDecl decl;
            decl.line = peek().line;
            decl.column = peek().column;
            decl.name = advance().text;
            if (!expect_kind(Token::Kind::Colon, "':'", diag)) return false;
            if (!at_ident()) return fail("expected type (REAL|BOOL)", diag);
            const std::string type_name = advance().text;
            if (type_name == "REAL") decl.type = StType::REAL;
            else if (type_name == "BOOL") decl.type = StType::BOOL;
            else return fail("unknown type '" + type_name + "' (only REAL/BOOL supported)", diag);
            if (!expect_kind(Token::Kind::Semicolon, "';'", diag)) return false;
            if (++var_count_ > st_limits::kMaxVariables) {
                set_diag(diag, st_diag_code::kTooManyVariables,
                         "variable count exceeds limit of " +
                             std::to_string(st_limits::kMaxVariables),
                         decl.line, decl.column);
                return false;
            }
            out->push_back(std::move(decl));
        }
        return true;
    }

    bool parse_stmt_list(const std::vector<std::string>& stop_keywords, std::vector<StStmt>* out,
                         StDiagnostic* diag)
    {
        /* Độ sâu statement đo ở đây (mỗi IF mở một stmt_list lồng thêm 1 cấp),
         * chặn TRƯỚC khi đệ quy xuống parse_stmt -> parse_if_stmt. */
        if (stmt_depth_ >= st_limits::kMaxStmtDepth)
            return fail_depth("statement", st_limits::kMaxStmtDepth, diag);
        DepthGuard guard(&stmt_depth_);
        while (!at_stop(stop_keywords)) {
            if (at_end()) return fail("unexpected end of source in statement list", diag);
            if (++stmt_count_ > st_limits::kMaxStatements) {
                set_diag(diag, st_diag_code::kTooManyStatements,
                         "statement count exceeds limit of " +
                             std::to_string(st_limits::kMaxStatements),
                         peek().line, peek().column);
                return false;
            }
            StStmt stmt;
            if (!parse_stmt(&stmt, diag)) return false;
            out->push_back(std::move(stmt));
        }
        return true;
    }

    bool at_stop(const std::vector<std::string>& keywords) const
    {
        if (!at_ident()) return false;
        for (const std::string& kw : keywords)
            if (peek().text == kw) return true;
        return false;
    }

    bool parse_stmt(StStmt* out, StDiagnostic* diag)
    {
        if (at_ident("IF")) return parse_if_stmt(out, diag);
        return parse_assign_stmt(out, diag);
    }

    bool parse_if_stmt(StStmt* out, StDiagnostic* diag)
    {
        advance();   /* IF */
        out->kind = StStmt::Kind::IF;
        if (!parse_expr(&out->if_cond, diag)) return false;
        if (!expect_ident("THEN", diag)) return false;
        if (!parse_stmt_list({"ELSE", "END_IF"}, &out->if_then, diag)) return false;
        if (at_ident("ELSE")) {
            advance();
            if (!parse_stmt_list({"END_IF"}, &out->if_else, diag)) return false;
        }
        if (!expect_ident("END_IF", diag)) return false;
        if (!expect_kind(Token::Kind::Semicolon, "';' after END_IF", diag)) return false;
        return true;
    }

    bool parse_assign_stmt(StStmt* out, StDiagnostic* diag)
    {
        if (!at_ident()) return fail("expected identifier or IF at start of statement", diag);
        if (is_reserved(peek().text))
            return fail("'" + peek().text + "' is a reserved word, cannot be an assignment target", diag);
        out->kind = StStmt::Kind::ASSIGN;
        out->assign_target_line = peek().line;
        out->assign_target_column = peek().column;
        out->assign_target = advance().text;
        if (!expect_kind(Token::Kind::ColonEq, "':=' in assignment", diag)) return false;
        if (!parse_expr(&out->assign_expr, diag)) return false;
        if (!expect_kind(Token::Kind::Semicolon, "';' after assignment", diag)) return false;
        return true;
    }

    /* Precedence (thấp -> cao): OR > AND > NOT > so sánh > primary.
     * Không chain nhiều so sánh liên tiếp (A > B > C không hợp lệ — đúng ngữ
     * nghĩa ST, mỗi so sánh trả BOOL, muốn nối cần AND tường minh). */
    /* Chốt chặn đệ quy #1: mọi lần xuống một cấp ngoặc hoặc một argument của
     * lời gọi hàm đều quay lại đây (parse_primary -> parse_expr). */
    bool parse_expr(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (expr_depth_ >= st_limits::kMaxExprDepth)
            return fail_depth("expression", st_limits::kMaxExprDepth, diag);
        DepthGuard guard(&expr_depth_);
        return parse_or(out, diag);
    }

    bool parse_or(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_and(out, diag)) return false;
        while (at_ident("OR")) {
            const int line = peek().line, col = peek().column;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_and(&rhs, diag)) return false;
            auto node = std::make_unique<StExpr>();
            node->kind = StExpr::Kind::OR_;
            node->lhs = std::move(*out);
            node->rhs = std::move(rhs);
            node->line = line; node->column = col;
            *out = std::move(node);
        }
        return true;
    }

    bool parse_and(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_not(out, diag)) return false;
        while (at_ident("AND")) {
            const int line = peek().line, col = peek().column;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_not(&rhs, diag)) return false;
            auto node = std::make_unique<StExpr>();
            node->kind = StExpr::Kind::AND_;
            node->lhs = std::move(*out);
            node->rhs = std::move(rhs);
            node->line = line; node->column = col;
            *out = std::move(node);
        }
        return true;
    }

    bool parse_not(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (at_ident("NOT")) {
            /* Chốt chặn đệ quy #2: `NOT NOT NOT ...` tự gọi lại parse_not mà
             * KHÔNG đi qua parse_expr, nên guard ở parse_expr không bắt được. */
            if (expr_depth_ >= st_limits::kMaxExprDepth)
                return fail_depth("expression", st_limits::kMaxExprDepth, diag);
            DepthGuard guard(&expr_depth_);
            const int line = peek().line, col = peek().column;
            advance();
            std::unique_ptr<StExpr> operand;
            if (!parse_not(&operand, diag)) return false;
            auto node = std::make_unique<StExpr>();
            node->kind = StExpr::Kind::NOT_;
            node->operand = std::move(operand);
            node->line = line; node->column = col;
            *out = std::move(node);
            return true;
        }
        return parse_comparison(out, diag);
    }

    bool parse_comparison(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        std::unique_ptr<StExpr> lhs;
        if (!parse_primary(&lhs, diag)) return false;
        StCompareOp op;
        bool has_op = true;
        switch (peek().kind) {
        case Token::Kind::Gt: op = StCompareOp::GT; break;
        case Token::Kind::Ge: op = StCompareOp::GE; break;
        case Token::Kind::Lt: op = StCompareOp::LT; break;
        case Token::Kind::Le: op = StCompareOp::LE; break;
        case Token::Kind::Eq: op = StCompareOp::EQ; break;
        case Token::Kind::Ne: op = StCompareOp::NE; break;
        default: has_op = false; op = StCompareOp::GT; break;
        }
        if (!has_op) { *out = std::move(lhs); return true; }
        const int line = peek().line, col = peek().column;
        advance();
        std::unique_ptr<StExpr> rhs;
        if (!parse_primary(&rhs, diag)) return false;
        auto node = std::make_unique<StExpr>();
        node->kind = StExpr::Kind::CMP;
        node->cmp_op = op;
        node->lhs = std::move(lhs);
        node->rhs = std::move(rhs);
        node->line = line; node->column = col;
        *out = std::move(node);
        return true;
    }

    bool parse_primary(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        const Token t = peek();
        if (t.kind == Token::Kind::LParen) {
            advance();
            if (!parse_expr(out, diag)) return false;
            if (!expect_kind(Token::Kind::RParen, "')'", diag)) return false;
            return true;
        }
        if (t.kind == Token::Kind::Number) {
            auto node = std::make_unique<StExpr>();
            node->kind = StExpr::Kind::LITERAL;
            node->literal = {StType::REAL, t.num, false};
            node->line = t.line; node->column = t.column;
            advance();
            *out = std::move(node);
            return true;
        }
        if (t.kind == Token::Kind::Ident) {
            if (t.text == "TRUE" || t.text == "FALSE") {
                auto node = std::make_unique<StExpr>();
                node->kind = StExpr::Kind::LITERAL;
                node->literal = {StType::BOOL, 0.0f, t.text == "TRUE"};
                node->line = t.line; node->column = t.column;
                advance();
                *out = std::move(node);
                return true;
            }
            if (is_reserved(t.text))
                return fail("unexpected reserved word '" + t.text + "' in expression", diag);
            advance();
            if (peek().kind == Token::Kind::LParen) {
                advance();   /* '(' */
                auto node = std::make_unique<StExpr>();
                node->kind = StExpr::Kind::CALL;
                node->call_name = t.text;
                node->line = t.line; node->column = t.column;
                if (peek().kind != Token::Kind::RParen) {
                    for (;;) {
                        std::unique_ptr<StExpr> arg;
                        if (!parse_expr(&arg, diag)) return false;
                        node->call_args.push_back(std::move(arg));
                        if (peek().kind == Token::Kind::Comma) { advance(); continue; }
                        break;
                    }
                }
                if (!expect_kind(Token::Kind::RParen, "')' to close function call", diag)) return false;
                *out = std::move(node);
                return true;
            }
            auto node = std::make_unique<StExpr>();
            node->kind = StExpr::Kind::VAR;
            node->var_name = t.text;
            node->line = t.line; node->column = t.column;
            *out = std::move(node);
            return true;
        }
        return fail("expected expression (identifier, number, TRUE, FALSE, NOT or '(')", diag);
    }
};

} // namespace

bool parse_st_program(const std::string& source, StProgram* out, StDiagnostic* diag)
{
    std::vector<Token> tokens;
    if (!tokenize(source, &tokens, diag)) return false;
    Parser parser(std::move(tokens));
    *out = StProgram{};
    return parser.parse_program(out, diag);
}

} // namespace core
