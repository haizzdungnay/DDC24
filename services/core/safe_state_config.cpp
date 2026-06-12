#include "safe_state_config.hpp"

#include <cstdio>
#include <fstream>
#include <sstream>

#include "json_min.hpp"

namespace core {

bool load_safe_state_config(const std::string& path, bool must_exist, SafeStateConfig* out)
{
    std::ifstream f(path);
    if (!f.is_open()) {
        if (must_exist) {
            std::fprintf(stderr, "ERROR safe_cfg.open_fail path=%s\n", path.c_str());
            return false;
        }
        std::fprintf(stderr, "WARN  safe_cfg.missing path=%s (default AO=0V/4mA, DO=open)\n",
                     path.c_str());
        return true;
    }
    std::stringstream ss;
    ss << f.rdbuf();

    std::string err;
    const json::ValuePtr root = json::Parser::parse(ss.str(), &err);
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
            if (v < 0.0f || v > 20.0f) {   /* eng V (0..10) hoặc mA (4..20) */
                std::fprintf(stderr, "ERROR safe_cfg.bad_value ao ch=%d safe=%.2f (0..20)\n",
                             c, static_cast<double>(v));
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
                 "INFO  safe_cfg.loaded path=%s ao=[%.1f,%.1f,%.1f,%.1f] do=[%d,%d,%d,%d]\n",
                 path.c_str(),
                 static_cast<double>(out->ao_default[0]), static_cast<double>(out->ao_default[1]),
                 static_cast<double>(out->ao_default[2]), static_cast<double>(out->ao_default[3]),
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
