#include "safety/safe_state_config.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

#include "json_min.hpp"

namespace core {

namespace {

/* Trả: 0 = OK, ENOENT = thiếu file, khác = lỗi đọc thật (EACCES/EIO...) */
int read_file(const std::string& path, std::string* out)
{
    errno = 0;
    std::ifstream f(path);
    if (!f.is_open())
        return errno != 0 ? errno : ENOENT;
    std::stringstream ss;
    ss << f.rdbuf();
    *out = ss.str();
    return 0;
}

const char* mode_name(uint8_t m) { return m == 1 ? "4-20mA" : "0-10V"; }

} // namespace

void ao_mode_range(uint8_t mode, float* lo, float* hi)
{
    /* 1 chỗ duy nhất giữ dải eng theo mode — default safe = cận dưới (*lo) */
    if (mode == 1) { *lo = 4.0f;  *hi = 20.0f; }   /* 4-20mA */
    else           { *lo = 0.0f;  *hi = 10.0f; }   /* 0-10V */
}

bool load_ao_modes(const std::string& io_config_path, bool must_exist, AoModeConfig* out)
{
    std::string src;
    const int rerr = read_file(io_config_path, &src);
    if (rerr == ENOENT && !must_exist) {
        std::fprintf(stderr, "WARN  io_cfg.missing path=%s (AO mode default 0-10V)\n",
                     io_config_path.c_str());
        return true;
    }
    if (rerr != 0) {
        /* file tồn tại nhưng không đọc được (EACCES/EIO) hoặc CLI chỉ định mà thiếu
         * → KHÔNG âm thầm rơi về default sai mode — fail-fast */
        std::fprintf(stderr, "ERROR io_cfg.open_fail path=%s errno=%d (%s) — fail-fast\n",
                     io_config_path.c_str(), rerr, std::strerror(rerr));
        return false;
    }
    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root || !root->is_obj()) {
        std::fprintf(stderr, "ERROR io_cfg.bad_json path=%s (%s) — fail-fast\n",
                     io_config_path.c_str(), err.c_str());
        return false;
    }
    const json::Value* ao = root->get("ao");
    if (!ao) return true;   /* không khai ao → giữ default 0-10V */
    if (!ao->is_arr()) {
        std::fprintf(stderr, "ERROR io_cfg.bad_field ao (phải là array)\n");
        return false;
    }
    int positional = 0;
    for (const auto& e : ao->arr) {
        const json::Value* ch = e->get("ch");
        const json::Value* mode = e->get("mode");
        if (!mode || !mode->is_str()) {
            std::fprintf(stderr, "ERROR io_cfg.bad_entry ao (cần mode)\n");
            return false;
        }
        /* "ch" có → dùng; thiếu → positional (tolerance khớp iobus_config) */
        int c;
        if (ch && ch->is_num()) {
            c = static_cast<int>(ch->num);
        } else {
            c = ++positional;
        }
        if (c < 1 || c > KX_N_AO) {
            std::fprintf(stderr, "ERROR io_cfg.bad_channel ao ch=%d (1..%d)\n", c, KX_N_AO);
            return false;
        }
        if (mode->str == "0-10V")       out->mode[c - 1] = 0;
        else if (mode->str == "4-20mA") out->mode[c - 1] = 1;
        else {
            std::fprintf(stderr, "ERROR io_cfg.bad_mode ao ch=%d mode=%s (0-10V|4-20mA)\n",
                         c, mode->str.c_str());
            return false;
        }
    }
    return true;
}

void apply_mode_defaults(const AoModeConfig& modes, SafeStateConfig* out)
{
    for (int i = 0; i < KX_N_AO; i++) {
        float lo, hi;
        ao_mode_range(modes.mode[i], &lo, &hi);
        out->ao_default[i] = lo;   /* 0V / 4mA — cận dưới dải hợp lệ */
    }
}

bool load_safe_state_config(const std::string& path, bool must_exist,
                            const AoModeConfig& modes, SafeStateConfig* out)
{
    apply_mode_defaults(modes, out);   /* nền: 0V / 4mA theo mode */

    std::string src;
    const int rerr = read_file(path, &src);
    if (rerr == ENOENT && !must_exist) {
        std::fprintf(stderr, "WARN  safe_cfg.missing path=%s (default AO=0V/4mA, DO=open)\n",
                     path.c_str());
        return true;
    }
    if (rerr != 0) {
        std::fprintf(stderr, "ERROR safe_cfg.open_fail path=%s errno=%d (%s)\n",
                     path.c_str(), rerr, std::strerror(rerr));
        return false;
    }

    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root || !root->is_obj()) {
        std::fprintf(stderr, "ERROR safe_cfg.bad_json path=%s (%s) — fail-fast\n",
                     path.c_str(), err.c_str());
        return false;
    }

    if (const json::Value* ao = root->get("ao")) {
        if (!ao->is_arr()) {
            std::fprintf(stderr, "ERROR safe_cfg.bad_field ao (phải là array)\n");
            return false;
        }
        for (const auto& e : ao->arr) {
            const json::Value* ch = e->get("ch");
            const json::Value* safe = e->get("safe");
            if (!ch || !ch->is_num() || !safe || !safe->is_num()) {
                std::fprintf(stderr, "ERROR safe_cfg.bad_entry ao (cần ch + safe số)\n");
                return false;
            }
            const int c = static_cast<int>(ch->num);
            if (c < 1 || c > KX_N_AO) {
                std::fprintf(stderr, "ERROR safe_cfg.bad_channel ao ch=%d (1..%d)\n", c, KX_N_AO);
                return false;
            }
            const float v = static_cast<float>(safe->num);
            /* Validate theo MODE THẬT của kênh — không clamp âm thầm */
            const uint8_t m = modes.mode[c - 1];
            float lo, hi;
            ao_mode_range(m, &lo, &hi);
            if (v < lo || v > hi) {
                std::fprintf(stderr,
                             "ERROR safe_cfg.bad_value ao ch=%d safe=%.2f ngoài dải mode %s"
                             " [%.0f..%.0f] — fail-fast\n",
                             c, static_cast<double>(v), mode_name(m),
                             static_cast<double>(lo), static_cast<double>(hi));
                return false;
            }
            out->ao_default[c - 1] = v;
        }
    }

    if (const json::Value* dout = root->get("do")) {
        if (!dout->is_arr()) {
            std::fprintf(stderr, "ERROR safe_cfg.bad_field do (phải là array)\n");
            return false;
        }
        for (const auto& e : dout->arr) {
            const json::Value* ch = e->get("ch");
            const json::Value* safe = e->get("safe");
            if (!ch || !ch->is_num() || !safe || !safe->is_str()) {
                std::fprintf(stderr, "ERROR safe_cfg.bad_entry do (cần ch + safe chuỗi)\n");
                return false;
            }
            const int c = static_cast<int>(ch->num);
            if (c < 1 || c > KX_N_DO) {
                std::fprintf(stderr, "ERROR safe_cfg.bad_channel do ch=%d (1..%d)\n", c, KX_N_DO);
                return false;
            }
            if (safe->str == "open")        out->do_default[c - 1] = false;
            else if (safe->str == "closed") out->do_default[c - 1] = true;
            else {
                std::fprintf(stderr, "ERROR safe_cfg.bad_value do ch=%d safe=%s (open|closed)\n",
                             c, safe->str.c_str());
                return false;
            }
        }
    }

    std::fprintf(stderr,
                 "INFO  safe_cfg.loaded path=%s ao=[%.1f,%.1f,%.1f,%.1f] (mode=[%s,%s,%s,%s])"
                 " do=[%d,%d,%d,%d]\n",
                 path.c_str(),
                 static_cast<double>(out->ao_default[0]), static_cast<double>(out->ao_default[1]),
                 static_cast<double>(out->ao_default[2]), static_cast<double>(out->ao_default[3]),
                 mode_name(modes.mode[0]), mode_name(modes.mode[1]),
                 mode_name(modes.mode[2]), mode_name(modes.mode[3]),
                 out->do_default[0], out->do_default[1], out->do_default[2], out->do_default[3]);
    return true;
}

void apply_safe_state_config(const SafeStateConfig& cfg, PriorityResolver* resolver)
{
    for (int ch = 0; ch < KX_N_AO; ch++)
        resolver->set_default_ao(ch, cfg.ao_default[ch]);
    for (int ch = 0; ch < KX_N_DO; ch++)
        resolver->set_default_do(ch, cfg.do_default[ch]);
}

} // namespace core
