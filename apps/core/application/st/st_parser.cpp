/**
 * @file  st_parser.cpp
 * @brief Lexer + parser cho tập con ST, theo đúng grammar EBNF ở
 *        docs/02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md §10.
 *
 *        Mọi giới hạn tài nguyên lấy từ st_limits.hpp và được kiểm ngay tại
 *        đây — parser không giả định caller đã kiểm hộ. Xem M-01.
 */
#include "st/st_parser.hpp"

#include <algorithm>
#include <cerrno>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <string>

#include "st/st_limits.hpp"

namespace core {
namespace {

/* ============================ Lexer ============================ */

struct Token {
    enum class Kind : uint8_t {
        Ident, IntLit, RealLit, TimeLit,
        Colon, ColonEq, Semicolon, Comma, Dot, LParen, RParen,
        Plus, Minus, Star, Slash,
        Gt, Ge, Lt, Le, Eq, Ne,
        End,
    } kind = Kind::End;
    std::string text;        /* Ident: tên gốc (giữ hoa thường) */
    std::string upper;       /* Ident: bản in hoa — so từ khoá không phân biệt hoa thường */
    int64_t     int_val = 0;
    float       real_val = 0.0f;
    int64_t     time_ns = 0;
    int         line = 1;
    int         column = 1;
    int         length = 1;
};

void set_diag(StDiagnostic* diag, const char* code, const std::string& msg, int line, int col,
              int length = 1)
{
    diag->severity = StSeverity::ERROR;
    diag->code = code;
    diag->message = msg;
    diag->line = line;
    diag->column = col;
    diag->length = length > 0 ? length : 1;
}

/* Source cho phép UTF-8 trong comment/copy, nhưng grammar và identifier Rev A
 * vẫn là ASCII. Kiểm encoding trước lexer để byte lỗi không bị hiểu thành một
 * ký tự ngẫu nhiên hoặc làm lệch line/column. */
bool validate_utf8(const std::string& source, std::size_t* bad_offset)
{
    const auto* bytes = reinterpret_cast<const unsigned char*>(source.data());
    std::size_t i = 0;
    while (i < source.size()) {
        const unsigned char c = bytes[i];
        if (c == 0) {
            if (bad_offset) *bad_offset = i;
            return false;
        }
        if (c < 0x80) {
            ++i;
            continue;
        }

        std::size_t width = 0;
        uint32_t codepoint = 0;
        if (c >= 0xC2 && c <= 0xDF) {
            width = 2;
            codepoint = c & 0x1Fu;
        } else if (c >= 0xE0 && c <= 0xEF) {
            width = 3;
            codepoint = c & 0x0Fu;
        } else if (c >= 0xF0 && c <= 0xF4) {
            width = 4;
            codepoint = c & 0x07u;
        } else {
            if (bad_offset) *bad_offset = i;
            return false;
        }
        if (i + width > source.size()) {
            if (bad_offset) *bad_offset = i;
            return false;
        }
        for (std::size_t j = 1; j < width; ++j) {
            if ((bytes[i + j] & 0xC0u) != 0x80u) {
                if (bad_offset) *bad_offset = i + j;
                return false;
            }
            codepoint = (codepoint << 6u) | (bytes[i + j] & 0x3Fu);
        }
        if ((width == 3 && codepoint < 0x800u) ||
            (width == 4 && codepoint < 0x10000u) ||
            (width == 3 && codepoint >= 0xD800u && codepoint <= 0xDFFFu) ||
            codepoint > 0x10FFFFu) {
            if (bad_offset) *bad_offset = i;
            return false;
        }
        i += width;
    }
    return true;
}

void line_column_at(const std::string& source, std::size_t offset, int* line, int* column)
{
    *line = 1;
    *column = 1;
    const std::size_t end = std::min(offset, source.size());
    for (std::size_t i = 0; i < end; ++i) {
        const unsigned char byte = static_cast<unsigned char>(source[i]);
        if (source[i] == '\n') {
            ++(*line);
            *column = 1;
        } else if ((byte & 0xC0u) != 0x80u) {
            ++(*column);
        }
    }
}

std::string to_upper(const std::string& s)
{
    std::string u = s;
    for (char& c : u) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return u;
}

/* Phân tích literal TIME: T#<số><đơn vị>{...}, đơn vị giảm dần, không lặp
 * (SPEC §3.2). Trả false + diag khi sai định dạng. */
bool parse_time_literal(const std::string& body, int line, int col, int64_t* out,
                        StDiagnostic* diag)
{
    const int literal_length = static_cast<int>(body.size() + 2u);
    if (body.empty()) {
        set_diag(diag, st_diag_code::kBadTimeLiteral, "empty TIME literal after 'T#'", line, col,
                 literal_length);
        return false;
    }
    /* Thứ tự bắt buộc: d > h > m > s > ms. Chỉ số càng lớn càng nhỏ đơn vị. */
    struct Unit { const char* name; int64_t ns; };
    static const Unit kUnits[] = {
        {"d",  86400000000000ll},
        {"h",   3600000000000ll},
        {"m",     60000000000ll},
        {"s",      1000000000ll},
        {"ms",       1000000ll},
    };
    int last_unit = -1;
    int64_t total = 0;
    std::size_t i = 0;
    while (i < body.size()) {
        if (!std::isdigit(static_cast<unsigned char>(body[i]))) {
            set_diag(diag, st_diag_code::kBadTimeLiteral,
                     "expected digits in TIME literal", line, col, literal_length);
            return false;
        }
        int64_t value = 0;
        while (i < body.size() && std::isdigit(static_cast<unsigned char>(body[i]))) {
            value = value * 10 + (body[i] - '0');
            if (value > 1000000000ll) {   /* chặn tràn sớm */
                set_diag(diag, st_diag_code::kBadTimeLiteral,
                         "TIME literal component too large", line, col, literal_length);
                return false;
            }
            i++;
        }
        /* "ms" phải thử TRƯỚC "m", nếu không "ms" sẽ khớp "m" rồi để lại 's'. */
        int unit_idx = -1;
        if (i + 1 < body.size() && body[i] == 'm' && body[i + 1] == 's') {
            unit_idx = 4; i += 2;
        } else if (i < body.size()) {
            for (int u = 0; u < 4; u++) {
                if (body[i] == kUnits[u].name[0]) { unit_idx = u; i++; break; }
            }
        }
        if (unit_idx < 0) {
            set_diag(diag, st_diag_code::kBadTimeLiteral,
                     "unknown or missing TIME unit (expected d, h, m, s or ms)", line, col,
                     literal_length);
            return false;
        }
        if (unit_idx <= last_unit) {
            set_diag(diag, st_diag_code::kBadTimeLiteral,
                     "TIME units must be in decreasing order and not repeat", line, col,
                     literal_length);
            return false;
        }
        last_unit = unit_idx;
        if (value > (st_limits::kMaxTimeLiteralNs - total) / kUnits[unit_idx].ns) {
            set_diag(diag, st_diag_code::kBadTimeLiteral,
                     "TIME literal exceeds the Rev A limit of 24 hours", line, col,
                     literal_length);
            return false;
        }
        total += value * kUnits[unit_idx].ns;
    }
    *out = total;
    return true;
}

bool tokenize(const std::string& src, std::vector<Token>* out, StDiagnostic* diag)
{
    if (src.size() > st_limits::kMaxSourceBytes) {
        set_diag(diag, st_diag_code::kSourceTooLarge,
                 "source is " + std::to_string(src.size()) + " bytes, limit is " +
                     std::to_string(st_limits::kMaxSourceBytes),
                 1, 1);
        return false;
    }

    std::size_t bad_offset = 0;
    if (!validate_utf8(src, &bad_offset)) {
        int bad_line = 1;
        int bad_column = 1;
        line_column_at(src, bad_offset, &bad_line, &bad_column);
        set_diag(diag, st_diag_code::kLexUnexpectedChar,
                 "source is not valid UTF-8 or contains NUL", bad_line, bad_column);
        return false;
    }

    std::size_t i = 0;
    const std::size_t n = src.size();
    int line = 1, col = 1;

    auto push = [&](Token t) -> bool {
        if (out->size() >= st_limits::kMaxTokens) {
            set_diag(diag, st_diag_code::kTooManyTokens,
                     "token count exceeds limit of " + std::to_string(st_limits::kMaxTokens),
                     t.line, t.column, t.length);
            return false;
        }
        out->push_back(std::move(t));
        return true;
    };
    auto step = [&](char c) {
        const unsigned char byte = static_cast<unsigned char>(c);
        if (c == '\n') {
            line++;
            col = 1;
        } else if ((byte & 0xC0u) != 0x80u) {
            col++;
        }
    };
    auto simple = [&](Token::Kind k, const char* text, int l, int c, int length = 1) {
        Token t;
        t.kind = k;
        t.text = text;
        t.line = l;
        t.column = c;
        t.length = length;
        return t;
    };

    while (i < n) {
        const char c = src[i];

        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') { step(c); i++; continue; }

        const int sl = line, sc = col;

        /* Chú thích khối (* ... *) — KHÔNG lồng nhau (SPEC §10). */
        if (c == '(' && i + 1 < n && src[i + 1] == '*') {
            step(src[i]); i++; step(src[i]); i++;
            bool closed = false;
            while (i < n) {
                if (src[i] == '*' && i + 1 < n && src[i + 1] == ')') {
                    step(src[i]); i++; step(src[i]); i++;
                    closed = true;
                    break;
                }
                step(src[i]); i++;
            }
            if (!closed) {
                set_diag(diag, st_diag_code::kUnterminatedComment,
                         "block comment '(*' is never closed", sl, sc, 2);
                return false;
            }
            continue;
        }

        /* Chú thích dòng // ... */
        if (c == '/' && i + 1 < n && src[i + 1] == '/') {
            while (i < n && src[i] != '\n') { step(src[i]); i++; }
            continue;
        }

        /* Định danh / từ khoá / literal TIME (T#...) */
        if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
            const std::size_t start = i;
            while (i < n && (std::isalnum(static_cast<unsigned char>(src[i])) || src[i] == '_')) {
                step(src[i]); i++;
            }
            const std::string word = src.substr(start, i - start);

            /* T# hoặc t# mở đầu literal TIME */
            if ((word == "T" || word == "t") && i < n && src[i] == '#') {
                step(src[i]); i++;
                const std::size_t bstart = i;
                while (i < n && (std::isalnum(static_cast<unsigned char>(src[i])))) {
                    step(src[i]); i++;
                }
                Token t;
                t.kind = Token::Kind::TimeLit;
                t.line = sl; t.column = sc;
                t.length = static_cast<int>(i - start);
                if (!parse_time_literal(src.substr(bstart, i - bstart), sl, sc, &t.time_ns, diag))
                    return false;
                if (!push(std::move(t))) return false;
                continue;
            }

            if (word.size() > st_limits::kMaxIdentifierLength) {
                set_diag(diag, st_diag_code::kIdentifierTooLong,
                         "identifier is " + std::to_string(word.size()) +
                             " characters, limit is " +
                             std::to_string(st_limits::kMaxIdentifierLength),
                         sl, sc, static_cast<int>(word.size()));
                return false;
            }
            Token t;
            t.kind = Token::Kind::Ident;
            t.text = word;
            t.upper = to_upper(word);
            t.line = sl; t.column = sc;
            t.length = static_cast<int>(word.size());
            if (!push(std::move(t))) return false;
            continue;
        }

        /* Số: nguyên hoặc thực (bắt buộc chữ số hai bên dấu chấm — SPEC §3.2) */
        if (std::isdigit(static_cast<unsigned char>(c))) {
            const std::size_t start = i;
            while (i < n && std::isdigit(static_cast<unsigned char>(src[i]))) { step(src[i]); i++; }
            bool is_real = false;
            if (i + 1 < n && src[i] == '.' && std::isdigit(static_cast<unsigned char>(src[i + 1]))) {
                is_real = true;
                step(src[i]); i++;
                while (i < n && std::isdigit(static_cast<unsigned char>(src[i]))) { step(src[i]); i++; }
            }
            const std::string text = src.substr(start, i - start);
            Token t;
            t.line = sl;
            t.column = sc;
            t.length = static_cast<int>(text.size());
            t.text = text;
            if (is_real) {
                t.kind = Token::Kind::RealLit;
                t.real_val = std::strtof(text.c_str(), nullptr);
                if (!std::isfinite(t.real_val)) {
                    set_diag(diag, st_diag_code::kLexUnexpectedChar,
                             "REAL literal is not finite", sl, sc, t.length);
                    return false;
                }
            } else {
                t.kind = Token::Kind::IntLit;
                errno = 0;
                t.int_val = std::strtoll(text.c_str(), nullptr, 10);
                if (errno == ERANGE) {
                    set_diag(diag, st_diag_code::kIntLiteralOutOfRange,
                             "integer literal out of range", sl, sc, t.length);
                    return false;
                }
            }
            if (!push(std::move(t))) return false;
            continue;
        }

        /* Toán tử và dấu */
        switch (c) {
        case ':':
            if (i + 1 < n && src[i + 1] == '=') {
                if (!push(simple(Token::Kind::ColonEq, ":=", sl, sc, 2))) return false;
                step(src[i]); i++; step(src[i]); i++;
            } else {
                if (!push(simple(Token::Kind::Colon, ":", sl, sc))) return false;
                step(src[i]); i++;
            }
            continue;
        case '<':
            if (i + 1 < n && src[i + 1] == '=') {
                if (!push(simple(Token::Kind::Le, "<=", sl, sc, 2))) return false;
                step(src[i]); i++; step(src[i]); i++;
            } else if (i + 1 < n && src[i + 1] == '>') {
                if (!push(simple(Token::Kind::Ne, "<>", sl, sc, 2))) return false;
                step(src[i]); i++; step(src[i]); i++;
            } else {
                if (!push(simple(Token::Kind::Lt, "<", sl, sc))) return false;
                step(src[i]); i++;
            }
            continue;
        case '>':
            if (i + 1 < n && src[i + 1] == '=') {
                if (!push(simple(Token::Kind::Ge, ">=", sl, sc, 2))) return false;
                step(src[i]); i++; step(src[i]); i++;
            } else {
                if (!push(simple(Token::Kind::Gt, ">", sl, sc))) return false;
                step(src[i]); i++;
            }
            continue;
        default: break;
        }

        Token::Kind k = Token::Kind::End;
        const char* txt = "";
        switch (c) {
        case ';': k = Token::Kind::Semicolon; txt = ";"; break;
        case ',': k = Token::Kind::Comma;     txt = ","; break;
        case '.': k = Token::Kind::Dot;       txt = "."; break;
        case '(': k = Token::Kind::LParen;    txt = "("; break;
        case ')': k = Token::Kind::RParen;    txt = ")"; break;
        case '+': k = Token::Kind::Plus;      txt = "+"; break;
        case '-': k = Token::Kind::Minus;     txt = "-"; break;
        case '*': k = Token::Kind::Star;      txt = "*"; break;
        case '/': k = Token::Kind::Slash;     txt = "/"; break;
        case '=': k = Token::Kind::Eq;        txt = "="; break;
        default:
            set_diag(diag, st_diag_code::kLexUnexpectedChar,
                     std::string("unexpected character '") + c + "'", sl, sc);
            return false;
        }
        if (!push(simple(k, txt, sl, sc))) return false;
        step(c); i++;
    }

    Token end;
    end.kind = Token::Kind::End;
    end.line = line; end.column = col;
    if (!push(std::move(end))) return false;
    return true;
}

/* ============================ Parser ============================ */

/* Trần tên POU (DDD §4.2) phải được lexer bao trọn — xem `parse_pou`. */
static_assert(st_limits::kMaxIdentifierLength <= kMaxPouNameLength,
              "trần identifier của lexer vượt trần tên POU: tên quá dài sẽ lọt");

class Parser {
public:
    explicit Parser(std::vector<Token> tokens, bool allow_user_calls = false)
        : tok_(std::move(tokens)) { allow_user_calls_ = allow_user_calls; }

    /* ISS-STED-01: bật thu nhiều diagnostic. Không set thì parser giữ nguyên
     * hành vi fail-fast cũ — mọi call site chưa quan tâm nhiều lỗi không phải
     * đổi một dòng nào. */
    void set_bag(StDiagnosticBag* bag) { bag_ = bag; }

    /* T59-101: một entry cho cả ba loại POU. Thân của chúng là cùng một ngôn
     * ngữ; chỉ chữ ký và quyền hạn khác nhau, nên tách ba parser sẽ nhân bản
     * toàn bộ statement/expression grammar. */
    /* Entry công khai: chạy parser rồi HOÀ GIẢI kết quả với túi diagnostic.
     *
     * Hai bất biến phải giữ cùng lúc: (a) call site cũ đọc `*diag` vẫn thấy
     * lỗi ĐẦU TIÊN theo thứ tự nguồn, (b) parse "chạy tới cuối" sau khi đã
     * phục hồi vẫn phải trả false — nếu không, AST thiếu câu lệnh sẽ đi tiếp
     * xuống typecheck và sinh lỗi giả. */
    bool parse_pou(StProgram* out, StDiagnostic* diag)
    {
        const std::size_t before = records_;
        const bool ok = parse_pou_impl(out, diag);
        if (!ok && records_ == before) record(diag);
        if (has_recorded_) { *diag = first_diag_; return false; }
        return ok;
    }

private:
    bool parse_pou_impl(StProgram* out, StDiagnostic* diag)
    {
        StPouKind kind = StPouKind::PROGRAM;
        if (!at_ident() || !st_pou_kind_from_keyword(peek().upper, &kind))
            return fail("expected PROGRAM, FUNCTION or FUNCTION_BLOCK", diag);
        advance();
        out->kind = kind;

        if (!at_ident()) return pou_signature_fail("expected POU name", diag);
        if (is_keyword(peek().upper))
            return pou_signature_fail("POU name cannot be a keyword", diag);
        /* Không kiểm lại độ dài ở đây: lexer đã chặn mọi identifier dài hơn
         * `kMaxIdentifierLength` bằng `ST-LIM-005`, và giới hạn đó bằng đúng
         * trần tên POU của DDD §4.2. Thêm một nhánh nữa sẽ là code chết — thứ
         * không test nào chạm tới được và sẽ mục dần. `static_assert` dưới đây
         * giữ hai con số dính nhau: nếu ai nâng trần lexer lên trên trần tên POU
         * thì build đỏ ngay, chứ không âm thầm cho qua tên quá dài. */
        const Token name_tok = peek();
        out->name = advance().text;
        out->line = name_tok.line;
        out->column = name_tok.column;
        out->length = name_tok.length;

        /* Chữ ký: đúng FUNCTION mới có kiểu trả về, và nó BẮT BUỘC có. Hai loại
         * còn lại mang `: TYPE` là sai kind chứ không phải sai cú pháp chung. */
        if (at(Token::Kind::Colon)) {
            if (kind != StPouKind::FUNCTION)
                return pou_signature_fail(
                    std::string(st_pou_kind_name(kind)) + " must not declare a return type", diag);
            advance();
            if (!at_ident()) return pou_signature_fail("expected return type name", diag);
            const Token type_tok = advance();
            StType return_type = StType::REAL;
            if (!scalar_type_from_name(type_tok.upper, &return_type)) {
                set_diag(diag, st_diag_code::kUnknownType,
                         "unknown return type '" + type_tok.text + "'",
                         type_tok.line, type_tok.column, type_tok.length);
                return false;
            }
            out->has_return_type = true;
            out->return_type = return_type;
        } else if (kind == StPouKind::FUNCTION) {
            return pou_signature_fail("FUNCTION must declare a return type", diag);
        }

        while (at_var_block_start()) {
            if (!parse_var_block(out, diag)) return false;
        }

        /* Ràng buộc kind trên khối VAR — kiểm SAU khi đọc hết để thông điệp nói
         * đúng khối vi phạm chứ không phải khối đầu tiên gặp phải. */
        if (!check_var_blocks_for_kind(*out, diag)) return false;

        const std::string terminator = std::string("END_") +
            (kind == StPouKind::FUNCTION_BLOCK ? "FUNCTION_BLOCK"
                                               : st_pou_kind_name(kind));
        if (!parse_stmt_list({terminator.c_str()}, &out->body, diag)) return false;
        if (!expect_kw(terminator.c_str(), diag)) return false;
        if (!at_end()) return fail("unexpected token after " + terminator, diag);
        return true;
    }

    std::vector<Token> tok_;
    std::size_t pos_ = 0;

    /* Túi diagnostic (tuỳ chọn) và bản sao lỗi ĐẦU TIÊN.
     *
     * `*diag` bị mọi nhánh lỗi ghi đè tự do, nên sau khi phục hồi nó mang lỗi
     * CUỐI chứ không phải lỗi đầu. Call site cũ lại chỉ đọc `*diag` và mong
     * đó là lỗi đầu tiên, nên phải giữ riêng một bản và khôi phục lúc thoát. */
    StDiagnosticBag* bag_ = nullptr;
    StDiagnostic     first_diag_;
    bool             has_recorded_ = false;
    /* Số lần đã ghi. `parse_stmt_list` lồng nhau (thân IF/CASE) dùng nó để
     * không ghi lại một lỗi mà vòng bên trong đã ghi. */
    std::size_t      records_ = 0;

    /* Mặc định TẮT: `parse_st_program()` giữ đúng hành vi cũ là từ chối hàm lạ
     * ngay tại parser. Chỉ đường POU mới bật, nên không có cửa nửa vời. */
    bool        allow_user_calls_ = false;
    int         expr_depth_ = 0;
    int         stmt_depth_ = 0;
    std::size_t stmt_count_ = 0;

    /* Cờ đánh dấu khối VAR_* nào đã gặp — mỗi loại tối đa 1 lần (SPEC §2). */
    bool seen_input_ = false, seen_output_ = false, seen_local_ = false, seen_retain_ = false;

    class DepthGuard {
    public:
        explicit DepthGuard(int* d) : d_(d) { ++(*d_); }
        ~DepthGuard() { --(*d_); }
        DepthGuard(const DepthGuard&) = delete;
        DepthGuard& operator=(const DepthGuard&) = delete;
    private:
        int* d_;
    };

    static bool is_keyword(const std::string& up)
    {
        static const char* kKeywords[] = {
            "PROGRAM", "END_PROGRAM", "VAR", "VAR_INPUT", "VAR_OUTPUT", "END_VAR",
            "FUNCTION", "END_FUNCTION", "FUNCTION_BLOCK", "END_FUNCTION_BLOCK",
            "RETAIN", "IF", "THEN", "ELSIF", "ELSE", "END_IF",
            "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE",
            "BOOL", "INT", "DINT", "UINT", "REAL", "TIME",
            "TON", "TOF", "R_TRIG", "F_TRIG", "PID", "TP", "CTU", "CTD",
            "HYSTERESIS",
            "CASE", "OF", "END_CASE", "FOR", "END_FOR", "WHILE", "END_WHILE",
            "REPEAT", "UNTIL", "END_REPEAT", "EXIT", "CONTINUE", "RETURN", "GOTO",
            "VAR_GLOBAL", "VAR_EXTERNAL", "NATIVE", "POINTER", "REFERENCE", "AT",
            "ARRAY", "STRUCT", "STRING", "WSTRING",
        };
        for (const char* k : kKeywords)
            if (up == k) return true;
        return false;
    }

    const Token& peek() const { return tok_[pos_]; }
    const Token& peek_at(std::size_t off) const
    {
        const std::size_t p = pos_ + off;
        return tok_[p < tok_.size() ? p : tok_.size() - 1];
    }
    Token advance() { return tok_[pos_ + 1 < tok_.size() ? pos_++ : pos_]; }
    bool at_ident() const { return peek().kind == Token::Kind::Ident; }
    bool at(Token::Kind kind) const { return peek().kind == kind; }
    bool at_kw(const char* up) const { return at_ident() && peek().upper == up; }
    bool at_end() const { return peek().kind == Token::Kind::End; }

    bool fail(const std::string& msg, StDiagnostic* diag)
    {
        set_diag(diag, st_diag_code::kSyntaxUnexpected, msg, peek().line, peek().column,
                 peek().length);
        return false;
    }

    /* ---- ISS-STED-01: thu lỗi + phục hồi -------------------------------- */

    /* Ghi `*diag` vào túi và nhớ lỗi đầu tiên. Trả false để call site giữ
     * nguyên kiểu `return record(diag);` ở nhánh không phục hồi được. */
    bool record(const StDiagnostic* diag)
    {
        if (!has_recorded_) { first_diag_ = *diag; has_recorded_ = true; }
        if (bag_ != nullptr) bag_->add(*diag);
        ++records_;
        return false;
    }

    /* Còn ngân sách phục hồi không.
     *
     * Dừng ở `kMaxDiagnostics + 1` chứ không phải `kMaxDiagnostics`: đúng một
     * mục vượt trần là tín hiệu để `finalize()` gắn `ST-LIM-006`. Dừng ở đúng
     * trần thì nguồn có 200 lỗi lại báo "vừa đủ 64, hết lỗi" — sai sự thật. */
    bool can_recover() const
    {
        if (bag_ == nullptr) return false;
        return bag_->size() <= StDiagnosticBag::kMaxDiagnostics;
    }

    static bool is_recovery_anchor(const std::string& up)
    {
        return up == "IF" || up == "CASE" || up == "ELSIF" || up == "ELSE" ||
               up == "END_IF" || up == "END_CASE" || up == "END_VAR" ||
               up == "END_PROGRAM" || up == "END_FUNCTION" || up == "END_FUNCTION_BLOCK" ||
               up == "VAR" || up == "VAR_INPUT" || up == "VAR_OUTPUT";
    }

    /* Đồng bộ về ranh giới CÂU LỆNH: nuốt tới hết `;` gần nhất, hoặc dừng
     * trước một từ khoá mở/đóng khối.
     *
     * Không nhảy qua từ khoá khối là điểm mấu chốt: nếu nuốt luôn `END_IF` thì
     * `parse_if` bên ngoài mất token đóng và sinh ra một chuỗi lỗi giả — đúng
     * thứ mà tiêu chí "phục hồi không sinh diagnostic giả" cấm. */
    /* Mở đầu một câu lệnh mới: `ident :=` (gán) hoặc `ident (` (lời gọi FB).
     * Đây là hai — và chỉ hai — hình dạng mở đầu câu lệnh không-từ-khoá của
     * subset, nên nhận diện chúng là không nhập nhằng.
     *
     * Không có luật này thì một câu lệnh thiếu `;` sẽ nuốt luôn mọi câu lệnh
     * sau nó tới tận `END_PROGRAM` (vì chúng cũng không có `;` nào ở giữa) —
     * nguồn 3 lỗi chỉ báo về 1. */
    bool at_statement_start() const
    {
        if (!at_ident() || is_keyword(peek().upper)) return false;
        const Token::Kind next = peek_at(1).kind;
        return next == Token::Kind::ColonEq || next == Token::Kind::LParen;
    }

    bool synchronize_statement()
    {
        const std::size_t start = pos_;
        while (!at_end()) {
            if (peek().kind == Token::Kind::Semicolon) { advance(); return true; }
            if (at_ident() && is_recovery_anchor(peek().upper))
                return pos_ > start;   /* tiến được mới coi là phục hồi */
            /* `pos_ > start` bắt buộc: lỗi phát ra NGAY tại đầu một câu lệnh
             * thì không được dừng ở chính nó, nếu không vòng ngoài lặp vô hạn. */
            if (pos_ > start && at_statement_start()) return true;
            advance();
        }
        return false;
    }

    /* Đồng bộ về ranh giới KHAI BÁO trong khối VAR: tới hết `;`, hoặc dừng
     * trước `END_VAR` / một khối VAR khác. */
    bool synchronize_declaration()
    {
        const std::size_t start = pos_;
        while (!at_end()) {
            if (peek().kind == Token::Kind::Semicolon) { advance(); return true; }
            if (at_ident() && (peek().upper == "END_VAR" || peek().upper == "VAR" ||
                               peek().upper == "VAR_INPUT" || peek().upper == "VAR_OUTPUT"))
                return pos_ > start;
            advance();
        }
        return false;
    }

    /* Vi phạm kind/chữ ký POU có mã riêng `ST-POU-001` (DDD §5.2 ->
     * PRG-ERR-POU-KIND-001), tách khỏi `ST-SYN-001` để BE và FE phân biệt được
     * "viết sai cú pháp" với "khai sai loại khối". */
    bool pou_signature_fail(const std::string& msg, StDiagnostic* diag)
    {
        set_diag(diag, st_diag_code::kPouSignatureInvalid, msg, peek().line, peek().column,
                 peek().length);
        return false;
    }

    static bool scalar_type_name(const std::string& up)
    {
        StType ignored = StType::REAL;
        return scalar_type_from_name(up, &ignored);
    }

    static bool scalar_type_from_name(const std::string& up, StType* out)
    {
        if (up == "BOOL")      { *out = StType::BOOL; return true; }
        if (up == "INT")       { *out = StType::INT;  return true; }
        if (up == "DINT")      { *out = StType::DINT; return true; }
        if (up == "UINT")      { *out = StType::UINT; return true; }
        if (up == "REAL")      { *out = StType::REAL; return true; }
        if (up == "TIME")      { *out = StType::TIME; return true; }
        return false;
    }

    bool check_var_blocks_for_kind(const StProgram& pou, StDiagnostic* diag)
    {
        if (pou.kind != StPouKind::FUNCTION) return true;
        /* FUNCTION thuần: một giá trị trả về, không state. VAR_OUTPUT và
         * VAR RETAIN đều là state hoặc kênh ra thứ hai (DDD §0). Kiểm tại parser
         * để lỗi có vị trí chính xác của khai báo vi phạm. */
        for (const StVarDecl& decl : pou.vars) {
            if (decl.storage == StStorage::VAR_OUTPUT) {
                set_diag(diag, st_diag_code::kPouSignatureInvalid,
                         "FUNCTION must not declare VAR_OUTPUT; it returns exactly one value",
                         decl.line, decl.column, decl.length);
                return false;
            }
            if (decl.storage == StStorage::VAR_RETAIN) {
                set_diag(diag, st_diag_code::kPouSignatureInvalid,
                         "FUNCTION must not declare VAR RETAIN; a pure function keeps no state",
                         decl.line, decl.column, decl.length);
                return false;
            }
        }
        if (!pou.fbs.empty()) {
            const StFbDecl& first = pou.fbs.front();
            set_diag(diag, st_diag_code::kPouSignatureInvalid,
                     "FUNCTION must not declare function block instances; they carry state",
                     first.line, first.column, first.length);
            return false;
        }
        return true;
    }

    bool fail_depth(const char* what, int limit, StDiagnostic* diag)
    {
        set_diag(diag, st_diag_code::kNestingTooDeep,
                 std::string(what) + " nesting exceeds limit of " + std::to_string(limit),
                 peek().line, peek().column, peek().length);
        return false;
    }

    bool expect_kw(const char* up, StDiagnostic* diag)
    {
        if (!at_kw(up)) return fail(std::string("expected '") + up + "'", diag);
        advance();
        return true;
    }

    bool expect(Token::Kind k, const char* what, StDiagnostic* diag)
    {
        if (peek().kind != k) return fail(std::string("expected ") + what, diag);
        advance();
        return true;
    }

    /* ---- Khối VAR ---- */

    bool at_var_block_start() const
    {
        return at_kw("VAR") || at_kw("VAR_INPUT") || at_kw("VAR_OUTPUT");
    }

    bool parse_var_block(StProgram* out, StDiagnostic* diag)
    {
        StStorage storage;
        bool* seen;
        const char* label;
        if (at_kw("VAR_INPUT"))       { storage = StStorage::VAR_INPUT;  seen = &seen_input_;  label = "VAR_INPUT"; }
        else if (at_kw("VAR_OUTPUT")) { storage = StStorage::VAR_OUTPUT; seen = &seen_output_; label = "VAR_OUTPUT"; }
        else                          { storage = StStorage::VAR_LOCAL;  seen = &seen_local_;  label = "VAR"; }
        advance();

        if (storage == StStorage::VAR_LOCAL && at_kw("RETAIN")) {
            advance();
            storage = StStorage::VAR_RETAIN;
            seen = &seen_retain_;
            label = "VAR RETAIN";
        }

        if (*seen)
            return fail(std::string("duplicate ") + label + " block (each may appear at most once)",
                        diag);
        *seen = true;

        while (!at_kw("END_VAR")) {
            if (at_end()) return fail("unexpected end of source inside VAR block", diag);
            if (!parse_var_decl(out, storage, diag)) {
                record(diag);
                if (!can_recover() || !synchronize_declaration()) return false;
                continue;
            }
        }
        return expect_kw("END_VAR", diag);
    }

    /* Một khai báo trong khối VAR. Tách khỏi `parse_var_block` để vòng lặp có
     * đúng MỘT điểm thoát lỗi — nếu không, mười nhánh `return false` rải rác
     * đều phải tự nhớ gọi `record` + `synchronize`, và chỗ quên sẽ là chỗ
     * parser âm thầm nuốt lỗi. */
    bool parse_var_decl(StProgram* out, StStorage storage, StDiagnostic* diag)
    {
            if (!at_ident()) return fail("expected variable name", diag);
            if (is_keyword(peek().upper))
                return fail("'" + peek().text + "' is a keyword and cannot be a variable name", diag);

            const Token name_tok = advance();
            if (!expect(Token::Kind::Colon, "':' after variable name", diag)) return false;
            if (!at_ident()) return fail("expected type name", diag);
            const Token type_tok = advance();

            const StFbType fb = st_fb_type_from_name(type_tok.upper);
            if (fb != StFbType::NONE) {
                if (storage == StStorage::VAR_INPUT || storage == StStorage::VAR_OUTPUT)
                    return fail("function block instances may only be declared in VAR or VAR RETAIN",
                                diag);
                StFbDecl d;
                d.name = name_tok.text;
                d.fb_type = fb;
                d.retained = (storage == StStorage::VAR_RETAIN);
                d.line = name_tok.line;
                d.column = name_tok.column;
                d.length = name_tok.length;
                if (out->fbs.size() >= st_limits::kMaxFbInstances) {
                    set_diag(diag, st_diag_code::kTooManyFbInstances,
                             "function block instance count exceeds limit of " +
                                 std::to_string(st_limits::kMaxFbInstances),
                             d.line, d.column, d.length);
                    return false;
                }
                out->fbs.push_back(std::move(d));
            } else if (allow_user_calls_ && !scalar_type_name(type_tok.upper) &&
                       (storage == StStorage::VAR_LOCAL || storage == StStorage::VAR_RETAIN)) {
                /* Kiểu lạ trong VAR/VAR RETAIN ở chế độ POU = instance của một
                 * FUNCTION_BLOCK người dùng. Parser chỉ ghi tên kiểu; registry
                 * phân giải và mới biết được "chưa có type" khác "type là
                 * FUNCTION" khác "vòng chứa" — ba mã, ba cách sửa. */
                StFbDecl d;
                d.name = name_tok.text;
                d.fb_type = StFbType::NONE;
                d.is_user_type = true;
                d.user_type_name = type_tok.text;
                d.retained = (storage == StStorage::VAR_RETAIN);
                d.line = name_tok.line;
                d.column = name_tok.column;
                d.length = name_tok.length;
                if (out->fbs.size() >= st_limits::kMaxFbInstances) {
                    set_diag(diag, st_diag_code::kTooManyFbInstances,
                             "function block instance count exceeds limit of " +
                                 std::to_string(st_limits::kMaxFbInstances),
                             d.line, d.column, d.length);
                    return false;
                }
                out->fbs.push_back(std::move(d));
            } else {
                StVarDecl d;
                d.name = name_tok.text;
                d.storage = storage;
                d.line = name_tok.line;
                d.column = name_tok.column;
                d.length = name_tok.length;
                if (type_tok.upper == "BOOL")       d.type = StType::BOOL;
                else if (type_tok.upper == "INT")   d.type = StType::INT;
                else if (type_tok.upper == "DINT")  d.type = StType::DINT;
                else if (type_tok.upper == "UINT")  d.type = StType::UINT;
                else if (type_tok.upper == "REAL")  d.type = StType::REAL;
                else if (type_tok.upper == "TIME")  d.type = StType::TIME;
                else {
                    set_diag(diag, st_diag_code::kUnknownType,
                             "unknown type '" + type_tok.text + "'",
                             type_tok.line, type_tok.column, type_tok.length);
                    return false;
                }
                if (out->vars.size() >= st_limits::kMaxVariables) {
                    set_diag(diag, st_diag_code::kTooManyVariables,
                             "variable count exceeds limit of " +
                                 std::to_string(st_limits::kMaxVariables),
                             d.line, d.column, d.length);
                    return false;
                }
                out->vars.push_back(std::move(d));
            }
            return expect(Token::Kind::Semicolon, "';' after variable declaration", diag);
    }

    /* ---- Câu lệnh ---- */

    bool at_stop(const std::vector<std::string>& kws) const
    {
        if (!at_ident()) return false;
        for (const std::string& k : kws)
            if (peek().upper == k) return true;
        return false;
    }

    /* Nhãn CASE đứng ở vị trí câu lệnh nhưng KHÔNG phải câu lệnh: một literal
     * nguyên (có thể mang dấu âm) không bao giờ mở đầu được một câu lệnh hợp lệ
     * trong subset này, nên nhận diện nó là không nhập nhằng. */
    bool at_case_label() const
    {
        if (peek().kind == Token::Kind::IntLit) return true;
        return peek().kind == Token::Kind::Minus && peek_at(1).kind == Token::Kind::IntLit;
    }

    bool parse_stmt_list(const std::vector<std::string>& stop, std::vector<StStmt>* out,
                         StDiagnostic* diag, bool stop_at_case_label = false)
    {
        if (stmt_depth_ >= st_limits::kMaxStmtDepth)
            return fail_depth("statement", st_limits::kMaxStmtDepth, diag);
        DepthGuard guard(&stmt_depth_);

        while (!at_stop(stop) && !(stop_at_case_label && at_case_label())) {
            if (at_end()) return fail("unexpected end of source in statement list", diag);
            if (++stmt_count_ > st_limits::kMaxStatements) {
                set_diag(diag, st_diag_code::kTooManyStatements,
                         "statement count exceeds limit of " +
                             std::to_string(st_limits::kMaxStatements),
                         peek().line, peek().column, peek().length);
                return false;
            }
            StStmt s;
            const std::size_t before = records_;
            if (!parse_stmt(&s, diag)) {
                if (records_ == before) record(diag);
                /* Câu lệnh hỏng bị VỨT, không đẩy vào AST: một node nửa vời
                 * sẽ làm tầng semantic báo lỗi thứ hai cho cùng một nguyên
                 * nhân. Chỉ vị trí đọc được đưa về ranh giới an toàn. */
                if (!can_recover() || !synchronize_statement()) return false;
                continue;
            }
            out->push_back(std::move(s));
        }
        return true;
    }

    bool parse_stmt(StStmt* out, StDiagnostic* diag)
    {
        if (at_kw("IF")) return parse_if(out, diag);
        if (at_kw("CASE")) return parse_case(out, diag);

        if (!at_ident()) return fail("expected identifier or IF at start of statement", diag);
        if (is_keyword(peek().upper))
            return fail("'" + peek().text + "' is a keyword and cannot start a statement", diag);

        /* Phân biệt lời gọi FB với phép gán bằng token kế tiếp:
         *   ident '('  -> lời gọi FB (câu lệnh)
         *   ident ':=' -> phép gán
         * Lời gọi HÀM chuẩn không bao giờ đứng ở vị trí câu lệnh vì hàm không
         * có tác dụng phụ; nếu người dùng viết vậy, semantic báo ST-SEM-012. */
        if (peek().upper == "SIGNAL_PUBLISH" &&
            peek_at(1).kind == Token::Kind::LParen)
            return parse_signal_publish(out, diag);
        if (peek_at(1).kind == Token::Kind::LParen) return parse_fb_call(out, diag);
        return parse_assign(out, diag);
    }

    bool parse_signal_publish(StStmt* out, StDiagnostic* diag)
    {
        const Token call = advance();
        out->kind = StStmt::Kind::SIGNAL_PUBLISH;
        out->signal_line = call.line;
        out->signal_column = call.column;
        out->signal_length = call.length;
        if (!expect(Token::Kind::LParen, "'(' in SIGNAL_PUBLISH", diag)) return false;
        if (!at_ident() || is_keyword(peek().upper))
            return fail("expected Published Signal identifier", diag);
        out->signal_name = advance().text;
        if (!expect(Token::Kind::Comma, "',' after Published Signal name", diag)) return false;
        if (!parse_expr(&out->signal_value, diag)) return false;
        if (!expect(Token::Kind::RParen, "')' to close SIGNAL_PUBLISH", diag)) return false;
        return expect(Token::Kind::Semicolon, "';' after SIGNAL_PUBLISH", diag);
    }

    bool parse_if(StStmt* out, StDiagnostic* diag)
    {
        advance();   /* IF */
        out->kind = StStmt::Kind::IF;

        for (;;) {
            StIfBranch branch;
            if (!parse_expr(&branch.cond, diag)) return false;
            if (!expect_kw("THEN", diag)) return false;
            if (!parse_stmt_list({"ELSIF", "ELSE", "END_IF"}, &branch.body, diag)) return false;
            out->branches.push_back(std::move(branch));
            if (at_kw("ELSIF")) { advance(); continue; }
            break;
        }

        if (at_kw("ELSE")) {
            advance();
            StIfBranch els;   /* cond == nullptr đánh dấu nhánh ELSE */
            if (!parse_stmt_list({"END_IF"}, &els.body, diag)) return false;
            out->branches.push_back(std::move(els));
        }

        if (!expect_kw("END_IF", diag)) return false;
        return expect(Token::Kind::Semicolon, "';' after END_IF", diag);
    }

    /* ---- CASE (IEC 61131-3 §7.3.3.2) ----------------------------------
     *
     * `CASE` được KHỬ ĐƯỜNG về đúng cây `IF/ELSIF/ELSE` sẵn có thay vì thêm một
     * `StStmt::Kind` mới.
     *
     * Lý do là an toàn vận hành, không phải tiện tay: `Kind::IF` đang được đọc
     * ở năm nơi (semantic, codegen, hai lượt duyệt của POU registry, và bộ đếm
     * giới hạn). Thêm một Kind mới nghĩa là năm chỗ đó phải cùng được cập nhật,
     * và chỗ nào quên sẽ IM LẶNG bỏ qua thân CASE — một máy trạng thái không
     * chạy nhưng vẫn Check PASS, trên thiết bị đang điều khiển thiết bị thật.
     * Khử đường thì mọi tầng phía sau dùng lại đúng đường đã được kiểm chứng.
     *
     * Phép biến đổi giữ nguyên ngữ nghĩa vì biểu thức trong subset này KHÔNG có
     * tác dụng phụ: `SIGNAL_PUBLISH` là câu lệnh chứ không phải biểu thức, và
     * hàm chuẩn/hàm người dùng đều thuần. Vì vậy nhân bản biểu thức chọn cho
     * từng nhánh cho ra đúng kết quả như đánh giá một lần.
     *
     *   CASE sel OF
     *     1, 3:   A;
     *     10..20: B;
     *   ELSE      C;
     *   END_CASE;
     *
     *   ⇒ IF (sel=1) OR (sel=3) THEN A;
     *     ELSIF (sel>=10) AND (sel<=20) THEN B;
     *     ELSE C; END_IF;
     */
    static std::unique_ptr<StExpr> clone_expr(const StExpr& src)
    {
        auto copy = std::make_unique<StExpr>();
        copy->kind = src.kind;
        copy->literal = src.literal;
        copy->literal_polymorphic = src.literal_polymorphic;
        copy->literal_int_value = src.literal_int_value;
        copy->var_name = src.var_name;
        copy->member_object = src.member_object;
        copy->member_field = src.member_field;
        copy->bin_op = src.bin_op;
        copy->un_op = src.un_op;
        copy->func = src.func;
        copy->user_call_name = src.user_call_name;
        copy->signal_name = src.signal_name;
        copy->result_type = src.result_type;
        copy->line = src.line;
        copy->column = src.column;
        copy->length = src.length;
        if (src.lhs) copy->lhs = clone_expr(*src.lhs);
        if (src.rhs) copy->rhs = clone_expr(*src.rhs);
        if (src.operand) copy->operand = clone_expr(*src.operand);
        copy->args.reserve(src.args.size());
        for (const auto& arg : src.args)
            copy->args.push_back(arg ? clone_expr(*arg) : nullptr);
        return copy;
    }

    static std::unique_ptr<StExpr> make_int_literal(int64_t value, const Token& at)
    {
        auto node = std::make_unique<StExpr>();
        node->kind = StExpr::Kind::LITERAL;
        /* Đa hình đúng như literal nguyên viết tay: kiểu thật do semantic chọn
         * theo ngữ cảnh, nên nhãn CASE so được với INT lẫn DINT/UINT. */
        node->literal_polymorphic = true;
        node->literal_int_value = value;
        node->literal = StValue::make_dint(static_cast<int32_t>(value));
        node->line = at.line;
        node->column = at.column;
        node->length = at.length;
        return node;
    }

    static std::unique_ptr<StExpr> make_binop(StBinOp op, std::unique_ptr<StExpr> lhs,
                                              std::unique_ptr<StExpr> rhs)
    {
        auto node = std::make_unique<StExpr>();
        node->kind = StExpr::Kind::BINOP;
        node->bin_op = op;
        node->line = lhs->line;
        node->column = lhs->column;
        node->length = lhs->length;
        node->lhs = std::move(lhs);
        node->rhs = std::move(rhs);
        return node;
    }

    /* Một nhãn CASE phải là HẰNG nguyên. IEC cho phép dấu âm; biểu thức chạy
     * lúc thực thi thì không, vì nhãn phải xác định được lúc dịch. */
    bool parse_case_label_value(int64_t* out, StDiagnostic* diag)
    {
        bool negative = false;
        if (peek().kind == Token::Kind::Minus) { advance(); negative = true; }
        if (peek().kind != Token::Kind::IntLit)
            return fail("CASE label must be an integer constant", diag);
        const Token literal = advance();
        *out = negative ? -literal.int_val : literal.int_val;
        return true;
    }

    bool parse_case(StStmt* out, StDiagnostic* diag)
    {
        advance();   /* CASE */
        out->kind = StStmt::Kind::IF;

        std::unique_ptr<StExpr> selector;
        if (!parse_expr(&selector, diag)) return false;
        if (!expect_kw("OF", diag)) return false;

        /* IEC đòi nhãn KHÔNG trùng nhau. Trùng nhãn nghĩa là một nhánh không
         * bao giờ chạy được — im lặng bỏ qua nó là giấu một lỗi logic. */
        std::vector<int64_t> seen;
        bool has_branch = false;

        while (!at_kw("ELSE") && !at_kw("END_CASE")) {
            if (at_end()) return fail("unexpected end of source in CASE", diag);

            std::unique_ptr<StExpr> cond;
            for (;;) {
                const Token label_at = peek();
                int64_t lo = 0;
                if (!parse_case_label_value(&lo, diag)) return false;

                int64_t hi = lo;
                if (peek().kind == Token::Kind::Dot && peek_at(1).kind == Token::Kind::Dot) {
                    advance();
                    advance();
                    if (!parse_case_label_value(&hi, diag)) return false;
                    if (hi < lo) {
                        set_diag(diag, st_diag_code::kSyntaxUnexpected,
                                 "CASE range is empty: upper bound is below the lower bound",
                                 label_at.line, label_at.column, label_at.length);
                        return false;
                    }
                }

                /* Dải quá rộng bị chặn ở đây: nó nở ra thành so sánh biên nên
                 * không tốn bộ nhớ, nhưng một dải khổng lồ gần như luôn là lỗi
                 * gõ nhầm, và bắt sớm rẻ hơn nhiều so với debug trên bo. */
                for (int64_t value = lo; value <= hi; ++value) {
                    if (std::find(seen.begin(), seen.end(), value) != seen.end()) {
                        set_diag(diag, st_diag_code::kSyntaxUnexpected,
                                 "duplicate CASE label " + std::to_string(value),
                                 label_at.line, label_at.column, label_at.length);
                        return false;
                    }
                    seen.push_back(value);
                    if (seen.size() > st_limits::kMaxStatements)
                        return fail("CASE label set is too large", diag);
                }

                std::unique_ptr<StExpr> term;
                if (hi == lo) {
                    term = make_binop(StBinOp::EQ, clone_expr(*selector),
                                      make_int_literal(lo, label_at));
                } else {
                    term = make_binop(
                        StBinOp::AND,
                        make_binop(StBinOp::GE, clone_expr(*selector),
                                   make_int_literal(lo, label_at)),
                        make_binop(StBinOp::LE, clone_expr(*selector),
                                   make_int_literal(hi, label_at)));
                }
                cond = cond ? make_binop(StBinOp::OR, std::move(cond), std::move(term))
                            : std::move(term);

                if (peek().kind == Token::Kind::Comma) { advance(); continue; }
                break;
            }

            if (!expect(Token::Kind::Colon, "':' after CASE label", diag)) return false;

            StIfBranch branch;
            branch.cond = std::move(cond);
            if (!parse_stmt_list({"ELSE", "END_CASE"}, &branch.body, diag, true)) return false;
            out->branches.push_back(std::move(branch));
            has_branch = true;
        }

        if (at_kw("ELSE")) {
            advance();
            StIfBranch els;   /* cond == nullptr đánh dấu nhánh ELSE */
            if (!parse_stmt_list({"END_CASE"}, &els.body, diag)) return false;
            out->branches.push_back(std::move(els));
        }

        if (!has_branch && out->branches.empty())
            return fail("CASE has no branch", diag);

        if (!expect_kw("END_CASE", diag)) return false;
        return expect(Token::Kind::Semicolon, "';' after END_CASE", diag);
    }

    bool parse_assign(StStmt* out, StDiagnostic* diag)
    {
        const Token target = advance();
        out->kind = StStmt::Kind::ASSIGN;
        out->assign_target = target.text;
        out->assign_target_line = target.line;
        out->assign_target_column = target.column;
        out->assign_target_length = target.length;

        /* `inst.Q := ...` là ghi vào đầu ra FB — bắt ở đây để báo đúng lỗi
         * thay vì để nó rơi vào "expected ':='". */
        if (peek().kind == Token::Kind::Dot) {
            set_diag(diag, st_diag_code::kWriteToFbOutput,
                     "cannot assign to a function block output", target.line, target.column,
                     target.length);
            return false;
        }
        if (!expect(Token::Kind::ColonEq, "':=' in assignment", diag)) return false;
        if (!parse_expr(&out->assign_expr, diag)) return false;
        return expect(Token::Kind::Semicolon, "';' after assignment", diag);
    }

    bool parse_fb_call(StStmt* out, StDiagnostic* diag)
    {
        const Token inst = advance();

        /* Tên hàm chuẩn ở vị trí câu lệnh: bắt NGAY tại đây thay vì để nó rơi
         * vào luật tham số FB. Nếu không, `ABS(r);` sẽ báo "tham số phải đặt
         * tên" — đúng về mặt luật nhưng chỉ sai nguyên nhân, khiến người viết
         * đi sửa nhầm chỗ. Parser biết tĩnh tập tên hàm chuẩn nên không cần
         * chờ tới semantic. */
        StFunc fn;
        if (st_func_from_name(inst.upper, &fn)) {
            set_diag(diag, st_diag_code::kFbFunctionConfusion,
                     "'" + inst.text +
                         "' is a standard function; use it inside an expression, "
                         "not as a statement",
                     inst.line, inst.column, inst.length);
            return false;
        }

        out->kind = StStmt::Kind::FB_CALL;
        out->fb_instance = inst.text;
        out->fb_line = inst.line;
        out->fb_column = inst.column;
        out->fb_length = inst.length;

        if (!expect(Token::Kind::LParen, "'(' in function block call", diag)) return false;
        if (peek().kind != Token::Kind::RParen) {
            for (;;) {
                if (!at_ident()) return fail("expected parameter name in function block call", diag);
                StFbArg arg;
                const Token pname = advance();
                arg.name = pname.upper;   /* tên tham số chuẩn hoá in hoa */
                arg.line = pname.line;
                arg.column = pname.column;
                arg.length = pname.length;
                /* Chỉ chấp nhận tham số ĐẶT TÊN (SPEC §5.3) — tham số theo vị
                 * trí bị từ chối tường minh, không im lặng hiểu sai. */
                if (peek().kind != Token::Kind::ColonEq) {
                    set_diag(diag, st_diag_code::kBadFbParam,
                             "function block arguments must use named form 'NAME := value'",
                             arg.line, arg.column, arg.length);
                    return false;
                }
                advance();
                if (!parse_expr(&arg.value, diag)) return false;
                out->fb_args.push_back(std::move(arg));
                if (peek().kind == Token::Kind::Comma) { advance(); continue; }
                break;
            }
        }
        if (!expect(Token::Kind::RParen, "')' to close function block call", diag)) return false;
        return expect(Token::Kind::Semicolon, "';' after function block call", diag);
    }

    /* ---- Biểu thức (thứ tự ưu tiên SPEC §4.1) ---- */

    bool parse_expr(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (expr_depth_ >= st_limits::kMaxExprDepth)
            return fail_depth("expression", st_limits::kMaxExprDepth, diag);
        DepthGuard guard(&expr_depth_);
        return parse_or(out, diag);
    }

    /* Sinh node nhị phân — dùng chung cho mọi mức ưu tiên. */
    static std::unique_ptr<StExpr> make_bin(StBinOp op, std::unique_ptr<StExpr> l,
                                            std::unique_ptr<StExpr> r, int line, int col,
                                            int length)
    {
        auto n = std::make_unique<StExpr>();
        n->kind = StExpr::Kind::BINOP;
        n->bin_op = op;
        n->lhs = std::move(l);
        n->rhs = std::move(r);
        n->line = line;
        n->column = col;
        n->length = length;
        return n;
    }

    bool parse_or(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_xor(out, diag)) return false;
        while (at_kw("OR")) {
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_xor(&rhs, diag)) return false;
            *out = make_bin(StBinOp::OR, std::move(*out), std::move(rhs), l, c, length);
        }
        return true;
    }

    bool parse_xor(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_and(out, diag)) return false;
        while (at_kw("XOR")) {
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_and(&rhs, diag)) return false;
            *out = make_bin(StBinOp::XOR, std::move(*out), std::move(rhs), l, c, length);
        }
        return true;
    }

    bool parse_and(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_equality(out, diag)) return false;
        while (at_kw("AND")) {
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_equality(&rhs, diag)) return false;
            *out = make_bin(StBinOp::AND, std::move(*out), std::move(rhs), l, c, length);
        }
        return true;
    }

    bool parse_equality(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_relational(out, diag)) return false;
        for (;;) {
            StBinOp op;
            if (peek().kind == Token::Kind::Eq)      op = StBinOp::EQ;
            else if (peek().kind == Token::Kind::Ne) op = StBinOp::NE;
            else break;
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_relational(&rhs, diag)) return false;
            *out = make_bin(op, std::move(*out), std::move(rhs), l, c, length);
        }
        return true;
    }

    bool parse_relational(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_additive(out, diag)) return false;
        for (;;) {
            StBinOp op;
            switch (peek().kind) {
            case Token::Kind::Lt: op = StBinOp::LT; break;
            case Token::Kind::Le: op = StBinOp::LE; break;
            case Token::Kind::Gt: op = StBinOp::GT; break;
            case Token::Kind::Ge: op = StBinOp::GE; break;
            default: return true;
            }
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_additive(&rhs, diag)) return false;
            *out = make_bin(op, std::move(*out), std::move(rhs), l, c, length);
        }
    }

    bool parse_additive(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_multiplicative(out, diag)) return false;
        for (;;) {
            StBinOp op;
            if (peek().kind == Token::Kind::Plus)       op = StBinOp::ADD;
            else if (peek().kind == Token::Kind::Minus) op = StBinOp::SUB;
            else return true;
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_multiplicative(&rhs, diag)) return false;
            *out = make_bin(op, std::move(*out), std::move(rhs), l, c, length);
        }
    }

    bool parse_multiplicative(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        if (!parse_unary(out, diag)) return false;
        for (;;) {
            StBinOp op;
            if (peek().kind == Token::Kind::Star)        op = StBinOp::MUL;
            else if (peek().kind == Token::Kind::Slash)  op = StBinOp::DIV;
            else if (at_kw("MOD"))                       op = StBinOp::MOD;
            else return true;
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> rhs;
            if (!parse_unary(&rhs, diag)) return false;
            *out = make_bin(op, std::move(*out), std::move(rhs), l, c, length);
        }
    }

    bool parse_unary(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        const bool is_neg = (peek().kind == Token::Kind::Minus);
        const bool is_plus = (peek().kind == Token::Kind::Plus);
        const bool is_not = at_kw("NOT");
        if (is_neg || is_plus || is_not) {
            /* `NOT NOT x` đệ quy qua chính hàm này mà không đi qua parse_expr,
             * nên phải có guard riêng — nếu không vẫn tràn stack được. */
            if (expr_depth_ >= st_limits::kMaxExprDepth)
                return fail_depth("expression", st_limits::kMaxExprDepth, diag);
            DepthGuard guard(&expr_depth_);
            const int l = peek().line, c = peek().column, length = peek().length;
            advance();
            std::unique_ptr<StExpr> operand;
            if (!parse_unary(&operand, diag)) return false;
            if (is_plus) {
                *out = std::move(operand);
                return true;
            }
            auto n = std::make_unique<StExpr>();
            n->kind = StExpr::Kind::UNOP;
            n->un_op = is_neg ? StUnOp::NEG : StUnOp::NOT;
            n->operand = std::move(operand);
            n->line = l; n->column = c;
            n->length = length;
            *out = std::move(n);
            return true;
        }
        return parse_primary(out, diag);
    }

    bool parse_primary(std::unique_ptr<StExpr>* out, StDiagnostic* diag)
    {
        const Token t = peek();

        if (t.kind == Token::Kind::LParen) {
            advance();
            if (!parse_expr(out, diag)) return false;
            return expect(Token::Kind::RParen, "')'", diag);
        }

        if (t.kind == Token::Kind::IntLit) {
            advance();
            auto n = std::make_unique<StExpr>();
            n->kind = StExpr::Kind::LITERAL;
            /* Literal nguyên là ĐA HÌNH (SPEC §3.4) — semantic chọn INT hay
             * REAL theo ngữ cảnh. Ở đây chỉ giữ giá trị gốc. */
            n->literal_polymorphic = true;
            n->literal_int_value = t.int_val;
            n->literal = StValue::make_int(0);
            n->line = t.line; n->column = t.column;
            n->length = t.length;
            *out = std::move(n);
            return true;
        }

        if (t.kind == Token::Kind::RealLit) {
            advance();
            auto n = std::make_unique<StExpr>();
            n->kind = StExpr::Kind::LITERAL;
            n->literal = StValue::make_real(t.real_val);
            n->line = t.line; n->column = t.column;
            n->length = t.length;
            *out = std::move(n);
            return true;
        }

        if (t.kind == Token::Kind::TimeLit) {
            advance();
            auto n = std::make_unique<StExpr>();
            n->kind = StExpr::Kind::LITERAL;
            n->literal = StValue::make_time(t.time_ns);
            n->line = t.line; n->column = t.column;
            n->length = t.length;
            *out = std::move(n);
            return true;
        }

        if (t.kind == Token::Kind::Ident) {
            if (t.upper == "TRUE" || t.upper == "FALSE") {
                advance();
                auto n = std::make_unique<StExpr>();
                n->kind = StExpr::Kind::LITERAL;
                n->literal = StValue::make_bool(t.upper == "TRUE");
                n->line = t.line; n->column = t.column;
                n->length = t.length;
                *out = std::move(n);
                return true;
            }
            if (is_keyword(t.upper))
                return fail("unexpected keyword '" + t.text + "' in expression", diag);

            advance();

            /* Truy cập thành viên: inst.Q */
            if (peek().kind == Token::Kind::Dot) {
                advance();
                if (!at_ident()) return fail("expected member name after '.'", diag);
                const Token field = advance();
                auto n = std::make_unique<StExpr>();
                n->kind = StExpr::Kind::MEMBER;
                n->member_object = t.text;
                n->member_field = field.upper;
                n->line = t.line; n->column = t.column;
                n->length = t.length;
                *out = std::move(n);
                return true;
            }

            /* Gọi hàm chuẩn */
            if (peek().kind == Token::Kind::LParen) {
                advance();
                if (t.upper == "SIGNAL_READ") {
                    if (!at_ident() || is_keyword(peek().upper))
                        return fail("expected Published Signal identifier", diag);
                    const Token signal = advance();
                    if (!expect(Token::Kind::RParen,
                                "')' to close SIGNAL_READ", diag)) return false;
                    auto n = std::make_unique<StExpr>();
                    n->kind = StExpr::Kind::SIGNAL_READ;
                    n->signal_name = signal.text;
                    n->line = t.line; n->column = t.column;
                    n->length = t.length;
                    *out = std::move(n);
                    return true;
                }
                StFunc f;
                auto n = std::make_unique<StExpr>();
                if (st_func_from_name(t.upper, &f)) {
                    n->kind = StExpr::Kind::CALL;
                    n->func = f;
                } else if (allow_user_calls_) {
                    /* Chỉ GHI LẠI tên. Parser không biết tập POU của Project hay
                     * library đã pin, nên nó không thể phân biệt "chưa tồn tại"
                     * với "sai version" với "đệ quy" — ba thứ có ba mã lỗi và ba
                     * cách sửa khác nhau. Việc phân giải thuộc st_pou_registry. */
                    n->kind = StExpr::Kind::USER_CALL;
                    n->user_call_name = t.text;
                } else {
                    set_diag(diag, st_diag_code::kUnknownFunction,
                             "unknown function '" + t.text + "'", t.line, t.column, t.length);
                    return false;
                }
                n->line = t.line; n->column = t.column;
                n->length = t.length;
                if (peek().kind != Token::Kind::RParen) {
                    for (;;) {
                        std::unique_ptr<StExpr> arg;
                        if (!parse_expr(&arg, diag)) return false;
                        n->args.push_back(std::move(arg));
                        if (peek().kind == Token::Kind::Comma) { advance(); continue; }
                        break;
                    }
                }
                if (!expect(Token::Kind::RParen, "')' to close function call", diag)) return false;
                *out = std::move(n);
                return true;
            }

            auto n = std::make_unique<StExpr>();
            n->kind = StExpr::Kind::VAR;
            n->var_name = t.text;
            n->line = t.line; n->column = t.column;
            n->length = t.length;
            *out = std::move(n);
            return true;
        }

        return fail("expected expression (identifier, literal, NOT, '-' or '(')", diag);
    }
};

} // namespace

bool parse_st_pou(const std::string& source, StProgram* out, StDiagnostic* diag)
{
    return parse_st_pou(source, out, diag, nullptr);
}

bool parse_st_pou(const std::string& source, StProgram* out, StDiagnostic* diag,
                  StDiagnosticBag* bag)
{
    std::vector<Token> tokens;
    /* Lỗi LEX không phục hồi được: một ký tự lạ hay comment không đóng làm
     * mọi token sau đó vô nghĩa, nên đoán tiếp chỉ sinh rác. Đưa đúng một mục
     * vào túi rồi dừng. */
    if (!tokenize(source, &tokens, diag)) {
        if (bag != nullptr) bag->add(*diag);
        return false;
    }
    Parser parser(std::move(tokens), /*allow_user_calls=*/true);
    parser.set_bag(bag);
    *out = StProgram{};
    return parser.parse_pou(out, diag);
}

bool parse_st_program(const std::string& source, StProgram* out, StDiagnostic* diag)
{
    return parse_st_program(source, out, diag, nullptr);
}

bool parse_st_program(const std::string& source, StProgram* out, StDiagnostic* diag,
                      StDiagnosticBag* bag)
{
    /* Giữ nguyên hợp đồng cũ cho mọi call site hiện có: entry này CHỈ nhận
     * PROGRAM. Nếu nguồn là FUNCTION/FUNCTION_BLOCK thì nó parse được nhưng bị
     * từ chối ở đây bằng mã kind — thông tin hữu ích hơn "expected PROGRAM". */
    std::vector<Token> tokens;
    if (!tokenize(source, &tokens, diag)) {
        if (bag != nullptr) bag->add(*diag);
        return false;
    }
    Parser parser(std::move(tokens), /*allow_user_calls=*/false);
    parser.set_bag(bag);
    *out = StProgram{};
    if (!parser.parse_pou(out, diag)) return false;
    if (out->kind != StPouKind::PROGRAM) {
        set_diag(diag, st_diag_code::kPouSignatureInvalid,
                 std::string("expected PROGRAM but source declares ") +
                     st_pou_kind_name(out->kind),
                 out->line, out->column, out->length);
        if (bag != nullptr) bag->add(*diag);
        *out = StProgram{};
        return false;
    }
    return true;
}

} // namespace core
