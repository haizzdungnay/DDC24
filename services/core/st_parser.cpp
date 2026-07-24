#include "st_parser.hpp"

#include <cctype>
#include <cstdlib>

namespace core {
namespace {

struct Token {
    enum class Kind { Ident, Number, Colon, ColonEq, Semicolon, Gt, End } kind = Kind::End;
    std::string text;
    float       num = 0.0f;
};

bool tokenize(const std::string& src, std::vector<Token>* out, std::string* error)
{
    std::size_t i = 0;
    const std::size_t n = src.size();
    while (i < n) {
        const char c = src[i];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') { i++; continue; }
        if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
            std::size_t start = i;
            while (i < n && (std::isalnum(static_cast<unsigned char>(src[i])) || src[i] == '_')) i++;
            out->push_back({Token::Kind::Ident, src.substr(start, i - start), 0.0f});
            continue;
        }
        if (std::isdigit(static_cast<unsigned char>(c))) {
            std::size_t start = i;
            while (i < n && std::isdigit(static_cast<unsigned char>(src[i]))) i++;
            if (i < n && src[i] == '.') {
                i++;
                while (i < n && std::isdigit(static_cast<unsigned char>(src[i]))) i++;
            }
            const std::string text = src.substr(start, i - start);
            Token t{Token::Kind::Number, text, std::strtof(text.c_str(), nullptr)};
            out->push_back(t);
            continue;
        }
        if (c == ':') {
            if (i + 1 < n && src[i + 1] == '=') { out->push_back({Token::Kind::ColonEq, ":=", 0.0f}); i += 2; }
            else { out->push_back({Token::Kind::Colon, ":", 0.0f}); i++; }
            continue;
        }
        if (c == ';') { out->push_back({Token::Kind::Semicolon, ";", 0.0f}); i++; continue; }
        if (c == '>') { out->push_back({Token::Kind::Gt, ">", 0.0f}); i++; continue; }
        *error = std::string("lex_error: unexpected character '") + c + "'";
        return false;
    }
    out->push_back({Token::Kind::End, "", 0.0f});
    return true;
}

class Parser {
public:
    explicit Parser(std::vector<Token> tokens) : tok_(std::move(tokens)) {}

    bool parse_program(StProgram* out, std::string* error)
    {
        if (!expect_ident("PROGRAM", error)) return false;
        if (!at_ident()) return fail("expected program name", error);
        out->name = advance().text;

        if (!expect_ident("VAR_INPUT", error)) return false;
        if (!parse_var_decls("END_VAR", &out->inputs, error)) return false;
        if (!expect_ident("END_VAR", error)) return false;

        if (!expect_ident("VAR_OUTPUT", error)) return false;
        if (!parse_var_decls("END_VAR", &out->outputs, error)) return false;
        if (!expect_ident("END_VAR", error)) return false;

        if (!parse_stmt_list({"END_PROGRAM"}, &out->body, error)) return false;
        if (!expect_ident("END_PROGRAM", error)) return false;
        return true;
    }

private:
    std::vector<Token> tok_;
    std::size_t pos_ = 0;

    const Token& peek() const { return tok_[pos_]; }
    Token advance() { return tok_[pos_ < tok_.size() - 1 ? pos_++ : pos_]; }
    bool at_ident() const { return peek().kind == Token::Kind::Ident; }
    bool at_ident(const char* text) const { return at_ident() && peek().text == text; }
    bool at_end() const { return peek().kind == Token::Kind::End; }

    static bool fail(const std::string& msg, std::string* error)
    {
        *error = "syntax_error: " + msg;
        return false;
    }

    bool expect_ident(const char* keyword, std::string* error)
    {
        if (!at_ident(keyword))
            return fail(std::string("expected '") + keyword + "'", error);
        advance();
        return true;
    }

    bool expect_kind(Token::Kind k, const char* what, std::string* error)
    {
        if (peek().kind != k) return fail(std::string("expected ") + what, error);
        advance();
        return true;
    }

    bool parse_var_decls(const char* stop_keyword, std::vector<StVarDecl>* out, std::string* error)
    {
        while (!at_ident(stop_keyword)) {
            if (at_end()) return fail("unexpected end of source in VAR block", error);
            if (!at_ident()) return fail("expected variable name", error);
            StVarDecl decl;
            decl.name = advance().text;
            if (!expect_kind(Token::Kind::Colon, "':'", error)) return false;
            if (!at_ident()) return fail("expected type (REAL|BOOL)", error);
            const std::string type_name = advance().text;
            if (type_name == "REAL") decl.type = StType::REAL;
            else if (type_name == "BOOL") decl.type = StType::BOOL;
            else return fail("unknown type '" + type_name + "' (only REAL/BOOL supported)", error);
            if (!expect_kind(Token::Kind::Semicolon, "';'", error)) return false;
            out->push_back(std::move(decl));
        }
        return true;
    }

    bool parse_stmt_list(const std::vector<std::string>& stop_keywords, std::vector<StStmt>* out,
                         std::string* error)
    {
        while (!at_stop(stop_keywords)) {
            if (at_end()) return fail("unexpected end of source in statement list", error);
            StStmt stmt;
            if (!parse_stmt(&stmt, error)) return false;
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

    bool parse_stmt(StStmt* out, std::string* error)
    {
        if (at_ident("IF")) return parse_if_stmt(out, error);
        return parse_assign_stmt(out, error);
    }

    bool parse_if_stmt(StStmt* out, std::string* error)
    {
        advance();   /* IF */
        out->kind = StStmt::Kind::IF;
        if (!parse_expr(&out->if_cond, error)) return false;
        if (!expect_ident("THEN", error)) return false;
        if (!parse_stmt_list({"ELSE", "END_IF"}, &out->if_then, error)) return false;
        if (at_ident("ELSE")) {
            advance();
            if (!parse_stmt_list({"END_IF"}, &out->if_else, error)) return false;
        }
        if (!expect_ident("END_IF", error)) return false;
        if (!expect_kind(Token::Kind::Semicolon, "';' after END_IF", error)) return false;
        return true;
    }

    bool parse_assign_stmt(StStmt* out, std::string* error)
    {
        if (!at_ident()) return fail("expected identifier or IF at start of statement", error);
        out->kind = StStmt::Kind::ASSIGN;
        out->assign_target = advance().text;
        if (!expect_kind(Token::Kind::ColonEq, "':=' in assignment", error)) return false;
        if (!parse_expr(&out->assign_expr, error)) return false;
        if (!expect_kind(Token::Kind::Semicolon, "';' after assignment", error)) return false;
        return true;
    }

    /* Chỉ 1 mức so sánh '>' (không precedence chain — grammar tối thiểu FW-SOM-ST-001). */
    bool parse_expr(std::unique_ptr<StExpr>* out, std::string* error)
    {
        std::unique_ptr<StExpr> lhs;
        if (!parse_primary(&lhs, error)) return false;
        if (peek().kind == Token::Kind::Gt) {
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_primary(&rhs, error)) return false;
            auto node = std::make_unique<StExpr>();
            node->kind = StExpr::Kind::GT;
            node->lhs = std::move(lhs);
            node->rhs = std::move(rhs);
            *out = std::move(node);
            return true;
        }
        *out = std::move(lhs);
        return true;
    }

    bool parse_primary(std::unique_ptr<StExpr>* out, std::string* error)
    {
        const Token& t = peek();
        if (t.kind == Token::Kind::Number) {
            auto node = std::make_unique<StExpr>();
            node->kind = StExpr::Kind::LITERAL;
            node->literal = {StType::REAL, t.num, false};
            advance();
            *out = std::move(node);
            return true;
        }
        if (t.kind == Token::Kind::Ident) {
            auto node = std::make_unique<StExpr>();
            if (t.text == "TRUE") {
                node->kind = StExpr::Kind::LITERAL;
                node->literal = {StType::BOOL, 0.0f, true};
            } else if (t.text == "FALSE") {
                node->kind = StExpr::Kind::LITERAL;
                node->literal = {StType::BOOL, 0.0f, false};
            } else {
                node->kind = StExpr::Kind::VAR;
                node->var_name = t.text;
            }
            advance();
            *out = std::move(node);
            return true;
        }
        return fail("expected expression (identifier, number, TRUE or FALSE)", error);
    }
};

} // namespace

bool parse_st_program(const std::string& source, StProgram* out, std::string* error)
{
    std::vector<Token> tokens;
    std::string lex_error;
    if (!tokenize(source, &tokens, &lex_error)) {
        *error = lex_error;
        return false;
    }
    Parser parser(std::move(tokens));
    *out = StProgram{};
    return parser.parse_program(out, error);
}

} // namespace core
