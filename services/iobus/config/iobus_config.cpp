#include "config/iobus_config.hpp"

#include "io/io_scaling.hpp"

#include <cctype>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

namespace iobus {

/* ---- Parser JSON tối thiểu cho schema phẳng 06 §4 ----
 * Đủ cho: object lồng 1 cấp ("iop"), array object ("ui"/"ao"), string/number.
 * Sai cú pháp cơ bản (ngoặc lệch, không phải object) → fail-fast theo 06 §4. */

static bool braces_balanced(const std::string& s)
{
    int depth = 0;
    bool in_str = false;
    for (size_t i = 0; i < s.size(); i++) {
        const char c = s[i];
        if (in_str) {
            if (c == '\\') i++;
            else if (c == '"') in_str = false;
            continue;
        }
        if (c == '"') in_str = true;
        else if (c == '{' || c == '[') depth++;
        else if (c == '}' || c == ']') { depth--; if (depth < 0) return false; }
    }
    return depth == 0 && !in_str;
}

/* Tìm `"key"` kể từ from, trả vị trí sau dấu ':' (npos nếu không có). */
static size_t find_value(const std::string& s, const std::string& key, size_t from = 0)
{
    const std::string pat = "\"" + key + "\"";
    size_t p = s.find(pat, from);
    if (p == std::string::npos) return std::string::npos;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return std::string::npos;
    return p + 1;
}

static bool get_string(const std::string& s, const std::string& key, std::string* out, size_t from = 0)
{
    size_t p = find_value(s, key, from);
    if (p == std::string::npos) return false;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    if (p >= s.size() || s[p] != '"') return false;
    const size_t e = s.find('"', p + 1);
    if (e == std::string::npos) return false;
    *out = s.substr(p + 1, e - p - 1);
    return true;
}

static bool get_uint(const std::string& s, const std::string& key, uint32_t* out, size_t from = 0)
{
    size_t p = find_value(s, key, from);
    if (p == std::string::npos) return false;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    if (p >= s.size() || !std::isdigit(static_cast<unsigned char>(s[p]))) return false;
    *out = static_cast<uint32_t>(std::strtoul(s.c_str() + p, nullptr, 10));
    return true;
}

/* Cắt array JSON `"key": [ ... ]` (trả chuỗi giữa [ ]) */
static bool get_array(const std::string& s, const std::string& key, std::string* out)
{
    size_t p = find_value(s, key);
    if (p == std::string::npos) return false;
    p = s.find('[', p);
    if (p == std::string::npos) return false;
    int depth = 0;
    for (size_t i = p; i < s.size(); i++) {
        if (s[i] == '[') depth++;
        else if (s[i] == ']') {
            depth--;
            if (depth == 0) { *out = s.substr(p + 1, i - p - 1); return true; }
        }
    }
    return false;
}

bool load_config(const std::string& path, bool must_exist, IobusConfig* out)
{
    std::ifstream f(path);
    if (!f.is_open()) {
        if (must_exist) {
            std::fprintf(stderr, "ERROR config.open_fail path=%s\n", path.c_str());
            return false;
        }
        std::fprintf(stderr, "WARN  config.missing path=%s (dùng default built-in)\n", path.c_str());
        return true;
    }
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string s = ss.str();

    if (!braces_balanced(s) || s.find('{') == std::string::npos) {
        std::fprintf(stderr, "ERROR config.bad_json path=%s (fail-fast)\n", path.c_str());
        return false;   /* JSON sai cú pháp → service fail-fast (06 §4) */
    }

    uint32_t u;
    std::string str;

    if (get_string(s, "uart_device", &str)) out->uart_device = str;
    else std::fprintf(stderr, "WARN  config.default field=uart_device\n");

    if (get_uint(s, "baud", &u)) {
        out->baud = static_cast<int>(u);
        if (out->baud != static_cast<int>(IOP_BAUD))
            std::fprintf(stderr, "WARN  config.baud=%d != %u (board thật chỉ 921600)\n",
                         out->baud, IOP_BAUD);
    }
    if (get_uint(s, "poll_period_ms", &u))        out->poll_period_ms = u;
    if (get_uint(s, "response_timeout_ms", &u))   out->response_timeout_ms = u;
    if (get_uint(s, "max_retry", &u))             out->max_retry = u;
    if (get_uint(s, "reconnect_interval_ms", &u)) out->reconnect_interval_ms = u;
    if (get_uint(s, "handshake_timeout_ms", &u))  out->handshake_timeout_ms = u;
    if (get_string(s, "log_level", &str))         out->log_level = str;
    if (get_uint(s, "rt_priority", &u))           out->rt_priority = static_cast<int>(u);

    /* Lấy index kênh từ "id":"UI<n>"/"AO<n>" trong entry (schema 06 §4); entry
     * thiếu id → positional. KHÔNG positional mù khi config sparse (kẻo lệch kênh
     * với core/io_safe_state — analysis review PR#12). */
    auto entry_index = [](const std::string& arr, size_t entry_from, size_t value_pos,
                          const char* prefix, int positional) -> int {
        const size_t idp = find_value(arr, "id", entry_from);
        std::string id;
        if (idp != std::string::npos && idp < value_pos &&
            get_string(arr, "id", &id, entry_from) &&
            id.size() > std::strlen(prefix) &&
            id.compare(0, std::strlen(prefix), prefix) == 0) {
            return std::atoi(id.c_str() + std::strlen(prefix)) - 1;
        }
        return positional;
    };

    /* ui[]: sensor_type theo id "UI<n>" (fallback thứ tự xuất hiện) */
    std::string arr;
    if (get_array(s, "ui", &arr)) {
        size_t from = 0;
        int positional = 0;
        for (;;) {
            const size_t p = find_value(arr, "sensor_type", from);
            if (p == std::string::npos) break;
            std::string t;
            if (!get_string(arr, "sensor_type", &t, from)) break;
            const int i = entry_index(arr, from, p, "UI", positional);
            positional = i + 1;
            if (i >= 0 && i < KX_N_UI) {
                out->ui_sensor[i] = sensor_type_from_string(t.c_str());
                if (out->ui_sensor[i] == SensorType::UNKNOWN)
                    std::fprintf(stderr, "ERROR config.bad_sensor_type ui=%d type=%s (quality=BAD)\n",
                                 i + 1, t.c_str());
            }
            from = p;
        }
    }
    /* ao[]: mode theo id "AO<n>" (fallback thứ tự) */
    if (get_array(s, "ao", &arr)) {
        size_t from = 0;
        int positional = 0;
        for (;;) {
            const size_t p = find_value(arr, "mode", from);
            if (p == std::string::npos) break;
            std::string m;
            if (!get_string(arr, "mode", &m, from)) break;
            const int i = entry_index(arr, from, p, "AO", positional);
            positional = i + 1;
            if (i >= 0 && i < KX_N_AO) {
                if (m == "4-20mA")     out->ao_mode[i] = AoMode::MA4_20;
                else if (m == "0-10V") out->ao_mode[i] = AoMode::V0_10;
                else
                    std::fprintf(stderr, "WARN  config.bad_ao_mode ao=%d mode=%s (giữ 0-10V)\n",
                                 i + 1, m.c_str());
            }
            from = p;
        }
    }

    std::fprintf(stderr, "INFO  config.loaded path=%s uart=%s baud=%d\n",
                 path.c_str(), out->uart_device.c_str(), out->baud);
    return true;
}

} // namespace iobus
