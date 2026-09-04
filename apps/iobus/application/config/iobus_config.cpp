#include "config/iobus_config.hpp"

#include "io/io_conditioning.hpp"
#include "io/io_scaling.hpp"

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
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

static bool get_int(const std::string& s, const std::string& key, int* out, size_t from = 0)
{
    size_t p = find_value(s, key, from);
    if (p == std::string::npos) return false;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    if (p >= s.size() || (!std::isdigit(static_cast<unsigned char>(s[p])) && s[p] != '-')) return false;
    char* end = nullptr;
    const long v = std::strtol(s.c_str() + p, &end, 10);
    if (end == s.c_str() + p) return false;
    *out = static_cast<int>(v);
    return true;
}

static bool get_float(const std::string& s, const std::string& key, float* out, size_t from = 0)
{
    size_t p = find_value(s, key, from);
    if (p == std::string::npos) return false;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    if (p >= s.size()) return false;
    char* end = nullptr;
    const double v = std::strtod(s.c_str() + p, &end);
    if (end == s.c_str() + p) return false;
    *out = static_cast<float>(v);
    return true;
}

static bool get_bool(const std::string& s, const std::string& key, bool* out, size_t from = 0)
{
    size_t p = find_value(s, key, from);
    if (p == std::string::npos) return false;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    if (s.compare(p, 4, "true") == 0) { *out = true; return true; }
    if (s.compare(p, 5, "false") == 0) { *out = false; return true; }
    return false;
}

static bool next_object(const std::string& arr, size_t* from, std::string* out)
{
    size_t p = arr.find('{', *from);
    if (p == std::string::npos) return false;
    int depth = 0;
    bool in_str = false;
    for (size_t i = p; i < arr.size(); i++) {
        const char c = arr[i];
        if (in_str) {
            if (c == '\\') i++;
            else if (c == '"') in_str = false;
            continue;
        }
        if (c == '"') in_str = true;
        else if (c == '{') depth++;
        else if (c == '}') {
            depth--;
            if (depth == 0) {
                *out = arr.substr(p, i - p + 1);
                *from = i + 1;
                return true;
            }
        }
    }
    return false;
}

static int entry_index(const std::string& entry, const char* prefix, int positional)
{
    int ch = 0;
    if (get_int(entry, "ch", &ch)) return ch - 1;

    std::string id;
    if (get_string(entry, "id", &id) &&
        id.size() > std::strlen(prefix) &&
        id.compare(0, std::strlen(prefix), prefix) == 0) {
        return std::atoi(id.c_str() + std::strlen(prefix)) - 1;
    }
    return positional;
}

static uint8_t clamp_u8(int v, int lo, int hi)
{
    if (v < lo) return static_cast<uint8_t>(lo);
    if (v > hi) return static_cast<uint8_t>(hi);
    return static_cast<uint8_t>(v);
}

static bool valid_ao_units(const std::string& units)
{
    return units == "percent" || units == "volt" || units == "milliampere" ||
           units == "degC" || units == "Pa" || units == "RPM" ||
           units == "ppm" || units == "no_units";
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

    /* ui[]: web schema ch/type/u1-u7; legacy id/sensor_type still accepted. */
    std::string arr;
    if (get_array(s, "ui", &arr)) {
        size_t from = 0;
        int positional = 0;
        std::string entry;
        while (next_object(arr, &from, &entry)) {
            const int i = entry_index(entry, "UI", positional);
            positional = i + 1;
            if (i < 0 || i >= KX_N_UI) continue;

            std::string t;
            if (get_string(entry, "type", &t) || get_string(entry, "sensor_type", &t)) {
                out->ui[i].sensor = sensor_type_from_string(t.c_str());
                if (out->ui[i].sensor == SensorType::UNKNOWN)
                    std::fprintf(stderr, "ERROR config.bad_sensor_type ui=%d type=%s (quality=BAD)\n", i + 1, t.c_str());
            }

            bool b = false;
            if (get_bool(entry, "enabled", &b)) out->ui[i].enabled = b;
            if (get_bool(entry, "invert", &b)) out->ui[i].invert = b;

            float f = 0.0f;
            if (get_float(entry, "scale_lo", &f)) out->ui[i].scale_lo = f;
            if (get_float(entry, "scale_hi", &f)) out->ui[i].scale_hi = f;
            if (get_float(entry, "sensor_cal", &f)) out->ui[i].sensor_cal = f;
            if (get_float(entry, "cal_gain", &f)) out->ui[i].cal_gain = f;
            if (get_float(entry, "cal_offset", &f)) out->ui[i].cal_offset = f;

            int n = 0;
            if (get_int(entry, "range_mult", &n)) out->ui[i].range_mult = clamp_u8(n, 0, 5);
            if (get_int(entry, "filter_samples", &n)) out->ui[i].filter_samples = clamp_u8(n, 0, 100);
            if (get_int(entry, "math_func", &n)) out->ui[i].math_func = clamp_u8(n, 0, 3);

            /* ISS-PIO-24 §7 — deadband / clamp / bật-tắt phát hiện lỗi /
             * chính sách giá trị khi lỗi. Thiếu key ⇒ giữ mặc định trong
             * `UiScaleConfig`, tức giữ nguyên hành vi trước issue này. */
            if (get_float(entry, "deadband", &f)) out->ui[i].deadband = (f > 0.0f) ? f : 0.0f;
            if (get_bool(entry, "clamp_enabled", &b)) out->ui[i].clamp_enabled = b;
            if (get_float(entry, "clamp_min", &f)) out->ui[i].clamp_min = f;
            if (get_float(entry, "clamp_max", &f)) out->ui[i].clamp_max = f;
            if (get_bool(entry, "range_fault_enabled", &b)) out->ui[i].range_fault_enabled = b;
            if (get_bool(entry, "loop_fault_enabled", &b)) out->ui[i].loop_fault_enabled = b;
            if (get_float(entry, "failure_value", &f)) out->ui[i].failure_value = f;

            std::string mode;
            if (get_string(entry, "failure_mode", &mode))
                out->ui[i].failure_mode = ui_failure_mode_from_string(mode.c_str());

            std::string unit;
            if (get_string(entry, "unit", &unit)) out->ui[i].unit = unit;
        }
    }
    /* Defaults cho ao_channels trước khi parse: tên/units tự động từ mode */
    for (int i = 0; i < KX_N_AO; i++) {
        out->ao_channels[i].name     = "AO" + std::to_string(i + 1);
        out->ao_channels[i].mode     = AoMode::V0_10;
        out->ao_channels[i].units_str = "volt";   /* default 0-10V */
        out->ao_channels[i].min_pv   = 0.0f;
        out->ao_channels[i].max_pv   = 10.0f;
    }

    /* ao[]: mode + ADR-012 fields (name/units/min_pv/max_pv) */
    if (get_array(s, "ao", &arr)) {
        size_t from = 0;
        int positional = 0;
        std::string entry;
        while (next_object(arr, &from, &entry)) {
            const int i = entry_index(entry, "AO", positional);
            positional = i + 1;
            if (i < 0 || i >= KX_N_AO) continue;

            std::string m;
            if (get_string(entry, "mode", &m)) {
                if (m == "4-20mA") {
                    out->ao_mode[i] = AoMode::MA4_20;
                    out->ao_channels[i].mode = AoMode::MA4_20;
                    out->ao_channels[i].units_str = "milliampere";
                    out->ao_channels[i].min_pv    = 4.0f;
                    out->ao_channels[i].max_pv    = 20.0f;
                } else if (m == "0-10V") {
                    out->ao_mode[i] = AoMode::V0_10;
                    out->ao_channels[i].mode = AoMode::V0_10;
                } else {
                    std::fprintf(stderr, "WARN  config.bad_ao_mode ao=%d mode=%s (giữ 0-10V)\n",
                                 i + 1, m.c_str());
                }
            }

            std::string nm;
            if (get_string(entry, "name", &nm) && !nm.empty())
                out->ao_channels[i].name = nm;

            std::string units;
            if (get_string(entry, "units", &units) && !units.empty())
                out->ao_channels[i].units_str = units;

            float f = 0.0f;
            if (get_float(entry, "min_pv", &f)) out->ao_channels[i].min_pv = f;
            if (get_float(entry, "max_pv", &f)) out->ao_channels[i].max_pv = f;

            if (out->ao_channels[i].name.size() > 64) {
                std::fprintf(stderr, "ERROR config.bad_ao_name ao=%d max_bytes=64\n", i + 1);
                return false;
            }
            if (!valid_ao_units(out->ao_channels[i].units_str)) {
                std::fprintf(stderr, "ERROR config.bad_ao_units ao=%d units=%s\n",
                             i + 1, out->ao_channels[i].units_str.c_str());
                return false;
            }
            if (!std::isfinite(out->ao_channels[i].min_pv) ||
                !std::isfinite(out->ao_channels[i].max_pv) ||
                out->ao_channels[i].max_pv <= out->ao_channels[i].min_pv) {
                std::fprintf(stderr, "ERROR config.bad_ao_range ao=%d min=%g max=%g\n",
                             i + 1, static_cast<double>(out->ao_channels[i].min_pv),
                             static_cast<double>(out->ao_channels[i].max_pv));
                return false;
            }
        }
    }

    std::fprintf(stderr, "INFO  config.loaded path=%s uart=%s baud=%d\n",
                 path.c_str(), out->uart_device.c_str(), out->baud);
    return true;
}

bool reload_config_safe(const std::string& path, bool must_exist, IobusConfig& current_cfg, const std::string& uart_override, const std::string& log_level_override)
{
    IobusConfig new_cfg = current_cfg;
    if (!load_config(path, must_exist, &new_cfg)) {
        return false;
    }

    if (!uart_override.empty()) {
        new_cfg.uart_device = uart_override;
    }
    if (!log_level_override.empty()) {
        new_cfg.log_level = log_level_override;
    }

    if (new_cfg.uart_device != current_cfg.uart_device) {
        std::fprintf(stderr, "WARN  reload.requires_restart field=uart_device\n");
        new_cfg.uart_device = current_cfg.uart_device;
    }
    if (new_cfg.baud != current_cfg.baud) {
        std::fprintf(stderr, "WARN  reload.requires_restart field=baud\n");
        new_cfg.baud = current_cfg.baud;
    }
    for (int i = 0; i < KX_N_AO; i++) {
        if (new_cfg.ao_mode[i] != current_cfg.ao_mode[i]) {
            std::fprintf(stderr,
                         "WARN  reload.requires_restart field=ao_mode ch=%d old=%d new=%d\n",
                         i + 1, static_cast<int>(current_cfg.ao_mode[i]),
                         static_cast<int>(new_cfg.ao_mode[i]));
            new_cfg.ao_mode[i] = current_cfg.ao_mode[i];
            new_cfg.ao_channels[i] = current_cfg.ao_channels[i];
        }
    }

    current_cfg = new_cfg;
    return true;
}

} // namespace iobus
