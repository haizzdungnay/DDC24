/**
 * @file  fieldbus_config.cpp
 * @brief MOD-002: load fieldbus.conf (JSON minimal parser).
 */
#include "fieldbus_config.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>

namespace iobus::fieldbus {

/* ---- minimal JSON helpers (flat key-value, no nesting recursion needed) ---- */

static bool jget_str(const std::string& s, const char* key, std::string* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n' || s[p] == '\r')) ++p;
    if (p >= s.size() || s[p] != '"') return false;
    const size_t e = s.find('"', p + 1);
    if (e == std::string::npos) return false;
    *out = s.substr(p + 1, e - p - 1);
    return true;
}

static bool jget_int(const std::string& s, const char* key, long* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t')) ++p;
    char* ep = nullptr;
    const long v = std::strtol(s.c_str() + p, &ep, 10);
    if (ep == s.c_str() + p) return false;
    *out = v;
    return true;
}

/* Trích nội dung object/array theo key bằng cách đếm braces */
static bool jget_obj(const std::string& s, const char* key, std::string* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n')) ++p;
    if (p >= s.size()) return false;
    const char open  = s[p];
    const char close = (open == '{') ? '}' : ((open == '[') ? ']' : '\0');
    if (!close) return false;
    int depth = 0;
    const size_t start = p;
    for (; p < s.size(); ++p) {
        if (s[p] == open) ++depth;
        else if (s[p] == close) { if (--depth == 0) { *out = s.substr(start, p - start + 1); return true; } }
        else if (s[p] == '"') { while (++p < s.size() && s[p] != '"') { if (s[p] == '\\') ++p; } }
    }
    return false;
}

/* Parse slave JSON object từ một phần tử mảng slaves[] */
static bool parse_slave(const std::string& obj, uint32_t default_poll_ms, SlaveConfig* sl)
{
    long v;
    if (jget_int(obj, "addr", &v) && v >= 1 && v <= 247)
        sl->addr = static_cast<uint8_t>(v);
    else
        return false;   /* addr bắt buộc */
    if (!jget_str(obj, "profile", &sl->profile) || sl->profile.empty())
        return false;   /* profile bắt buộc */
    if (!jget_str(obj, "name", &sl->name) || sl->name.empty())
        return false;   /* name bắt buộc */
    sl->poll_ms = default_poll_ms;
    if (jget_int(obj, "poll_ms", &v) && v > 0)
        sl->poll_ms = static_cast<uint32_t>(v);
    return true;
}

bool load_fieldbus_config(const std::string& path, bool path_from_cli,
                           FieldbusConfig* out)
{
    std::ifstream f(path);
    if (!f) {
        if (path_from_cli) {
            std::fprintf(stderr, "ERROR fieldbus_config.file_not_found path=%s\n", path.c_str());
            return false;
        }
        std::fprintf(stderr, "WARN  fieldbus_config.file_missing path=%s (defaults)\n",
                     path.c_str());
        out->loaded = false;
        return true;   /* bình thường khi chưa provision */
    }
    std::ostringstream ss;
    ss << f.rdbuf();
    const std::string json = ss.str();

    /* Kiểm tra JSON hợp lệ tối thiểu: phải có {} */
    if (json.find('{') == std::string::npos) {
        std::fprintf(stderr, "ERROR fieldbus_config.json_syntax path=%s\n", path.c_str());
        return false;
    }

    /* rs485 object */
    std::string rs485_obj;
    if (jget_obj(json, "rs485", &rs485_obj)) {
        jget_str(rs485_obj, "device", &out->rs485.device);
        long v;
        if (jget_int(rs485_obj, "baud", &v) && v > 0)
            out->rs485.baud = static_cast<uint32_t>(v);
        std::string parity;
        if (jget_str(rs485_obj, "parity", &parity) && !parity.empty())
            out->rs485.parity = static_cast<char>(parity[0]);
        if (jget_int(rs485_obj, "stop", &v) && (v == 1 || v == 2))
            out->rs485.stop = static_cast<uint8_t>(v);
    }

    /* rs485.device bắt buộc (CONFIG_SCHEMA §5b, plan 25 §4 gap closed) */
    if (out->rs485.device.empty()) {
        std::fprintf(stderr, "ERROR fieldbus_config.rs485_device_missing — bắt buộc đặt"
                     " rs485.device trong fieldbus.conf (plan 25 §4)\n");
        return false;
    }

    long v;
    if (jget_int(json, "poll_default_ms", &v) && v > 0)
        out->poll_default_ms = static_cast<uint32_t>(v);

    /* slaves array */
    std::string slaves_arr;
    if (jget_obj(json, "slaves", &slaves_arr)) {
        /* iterate over { } objects trong array */
        size_t p = 0;
        while (p < slaves_arr.size()) {
            const size_t ob = slaves_arr.find('{', p);
            if (ob == std::string::npos) break;
            int depth = 0;
            size_t end = ob;
            for (size_t k = ob; k < slaves_arr.size(); ++k) {
                if (slaves_arr[k] == '{') ++depth;
                else if (slaves_arr[k] == '}') { if (--depth == 0) { end = k; break; } }
                else if (slaves_arr[k] == '"') { while (++k < slaves_arr.size() && slaves_arr[k] != '"') { if (slaves_arr[k] == '\\') ++k; } }
            }
            const std::string obj = slaves_arr.substr(ob, end - ob + 1);
            SlaveConfig sl;
            if (parse_slave(obj, out->poll_default_ms, &sl)) {
                out->slaves.push_back(sl);
            } else {
                std::fprintf(stderr, "WARN  fieldbus_config.slave_parse_error — thiếu addr/profile/name"
                             " trong phần tử slaves; bỏ qua\n");
            }
            p = end + 1;
        }
    }

    out->loaded = true;
    std::fprintf(stderr, "INFO  fieldbus_config.loaded path=%s device=%s baud=%u slaves=%zu\n",
                 path.c_str(), out->rs485.device.c_str(), out->rs485.baud,
                 out->slaves.size());
    return true;
}

} // namespace iobus::fieldbus
