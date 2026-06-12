/**
 * @file  json_min.hpp
 * @brief Parser JSON đệ quy tối thiểu, header-only, không dependency — dùng cho
 *        graph.json + io_safe_state.conf (cấu trúc lồng nhau, parse substring không đủ).
 *        Hỗ trợ: object/array/string/number/bool/null, escape cơ bản, bỏ qua whitespace.
 *        KHÔNG hỗ trợ: \uXXXX (giữ nguyên chuỗi), comment, trailing comma.
 */
#ifndef CORE_JSON_MIN_HPP
#define CORE_JSON_MIN_HPP

#include <cctype>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace core {
namespace json {

class Value;
using ValuePtr = std::shared_ptr<Value>;

class Value {
public:
    enum Type { NUL, BOOL, NUM, STR, ARR, OBJ };

    Type type = NUL;
    bool b = false;
    double num = 0.0;
    std::string str;
    std::vector<ValuePtr> arr;
    std::map<std::string, ValuePtr> obj;

    bool is_obj() const { return type == OBJ; }
    bool is_arr() const { return type == ARR; }
    bool is_num() const { return type == NUM; }
    bool is_str() const { return type == STR; }
    bool is_bool() const { return type == BOOL; }

    /* obj["key"] — nullptr nếu không có */
    const Value* get(const std::string& key) const
    {
        if (type != OBJ) return nullptr;
        auto it = obj.find(key);
        return it == obj.end() ? nullptr : it->second.get();
    }
    double num_or(double dflt) const { return type == NUM ? num : dflt; }
    std::string str_or(const std::string& dflt) const { return type == STR ? str : dflt; }
    bool bool_or(bool dflt) const { return type == BOOL ? b : dflt; }
};

class Parser {
public:
    /* Trả nullptr nếu JSON sai cú pháp; err mô tả vị trí lỗi. */
    static ValuePtr parse(const std::string& src, std::string* err = nullptr)
    {
        Parser p(src);
        ValuePtr v = p.parse_value();
        if (v) {
            p.skip_ws();
            if (p.pos_ != src.size()) v = nullptr;   /* rác sau JSON */
        }
        if (!v && err)
            *err = "json parse error at offset " + std::to_string(p.pos_);
        return v;
    }

private:
    explicit Parser(const std::string& s) : s_(s) {}

    const std::string& s_;
    size_t pos_ = 0;

    void skip_ws()
    {
        while (pos_ < s_.size() && std::isspace(static_cast<unsigned char>(s_[pos_]))) pos_++;
    }
    bool consume(char c)
    {
        skip_ws();
        if (pos_ < s_.size() && s_[pos_] == c) { pos_++; return true; }
        return false;
    }
    bool literal(const char* lit)
    {
        const size_t n = std::strlen(lit);
        if (s_.compare(pos_, n, lit) == 0) { pos_ += n; return true; }
        return false;
    }

    ValuePtr parse_value()
    {
        skip_ws();
        if (pos_ >= s_.size()) return nullptr;
        const char c = s_[pos_];
        if (c == '{') return parse_obj();
        if (c == '[') return parse_arr();
        if (c == '"') return parse_str();
        if (c == 't') { if (!literal("true")) return nullptr;  auto v = std::make_shared<Value>(); v->type = Value::BOOL; v->b = true;  return v; }
        if (c == 'f') { if (!literal("false")) return nullptr; auto v = std::make_shared<Value>(); v->type = Value::BOOL; v->b = false; return v; }
        if (c == 'n') { if (!literal("null")) return nullptr;  auto v = std::make_shared<Value>(); v->type = Value::NUL;  return v; }
        return parse_num();
    }

    ValuePtr parse_obj()
    {
        if (!consume('{')) return nullptr;
        auto v = std::make_shared<Value>();
        v->type = Value::OBJ;
        skip_ws();
        if (consume('}')) return v;
        for (;;) {
            skip_ws();
            ValuePtr key = parse_str();
            if (!key) return nullptr;
            if (!consume(':')) return nullptr;
            ValuePtr val = parse_value();
            if (!val) return nullptr;
            v->obj[key->str] = val;
            if (consume(',')) continue;
            if (consume('}')) return v;
            return nullptr;
        }
    }

    ValuePtr parse_arr()
    {
        if (!consume('[')) return nullptr;
        auto v = std::make_shared<Value>();
        v->type = Value::ARR;
        skip_ws();
        if (consume(']')) return v;
        for (;;) {
            ValuePtr e = parse_value();
            if (!e) return nullptr;
            v->arr.push_back(e);
            if (consume(',')) continue;
            if (consume(']')) return v;
            return nullptr;
        }
    }

    ValuePtr parse_str()
    {
        skip_ws();
        if (pos_ >= s_.size() || s_[pos_] != '"') return nullptr;
        pos_++;
        auto v = std::make_shared<Value>();
        v->type = Value::STR;
        while (pos_ < s_.size()) {
            const char c = s_[pos_++];
            if (c == '"') return v;
            if (c == '\\') {
                if (pos_ >= s_.size()) return nullptr;
                const char e = s_[pos_++];
                switch (e) {
                case '"':  v->str += '"';  break;
                case '\\': v->str += '\\'; break;
                case '/':  v->str += '/';  break;
                case 'n':  v->str += '\n'; break;
                case 't':  v->str += '\t'; break;
                case 'r':  v->str += '\r'; break;
                case 'b':  v->str += '\b'; break;
                case 'f':  v->str += '\f'; break;
                default:   v->str += e;    break;   /* \uXXXX: giữ thô */
                }
            } else {
                v->str += c;
            }
        }
        return nullptr;   /* thiếu dấu đóng */
    }

    ValuePtr parse_num()
    {
        skip_ws();
        const char* start = s_.c_str() + pos_;
        char* end = nullptr;
        const double d = std::strtod(start, &end);
        if (end == start) return nullptr;
        pos_ += static_cast<size_t>(end - start);
        auto v = std::make_shared<Value>();
        v->type = Value::NUM;
        v->num = d;
        return v;
    }
};

} // namespace json
} // namespace core

#endif /* CORE_JSON_MIN_HPP */
