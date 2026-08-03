#ifndef CORE_JSON_MIN_HPP
#define CORE_JSON_MIN_HPP

#include <nlohmann/json.hpp>
#include <memory>
#include <string>
#include <vector>
#include <map>

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
        try {
            nlohmann::json j = nlohmann::json::parse(src);
            return convert(j);
        } catch (const std::exception& e) {
            if (err) *err = e.what();
            return nullptr;
        }
    }

private:
    static ValuePtr convert(const nlohmann::json& j)
    {
        auto v = std::make_shared<Value>();
        if (j.is_null()) {
            v->type = Value::NUL;
        } else if (j.is_boolean()) {
            v->type = Value::BOOL;
            v->b = j.get<bool>();
        } else if (j.is_number()) {
            v->type = Value::NUM;
            v->num = j.get<double>();
        } else if (j.is_string()) {
            v->type = Value::STR;
            v->str = j.get<std::string>();
        } else if (j.is_array()) {
            v->type = Value::ARR;
            for (const auto& elem : j) {
                v->arr.push_back(convert(elem));
            }
        } else if (j.is_object()) {
            v->type = Value::OBJ;
            for (auto it = j.begin(); it != j.end(); ++it) {
                v->obj[it.key()] = convert(it.value());
            }
        }
        return v;
    }
};

} // namespace json
} // namespace core

#endif /* CORE_JSON_MIN_HPP */
