#include "persistence/state_snapshot.hpp"

#include <cinttypes>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <sstream>

#include "json_min.hpp"

namespace core {

StateSnapshot::StateSnapshot(const std::string& path)
    : path_(path), tmp_path_(path + ".tmp")
{}

/* ---- load ---- */

std::vector<PersistEntry> StateSnapshot::load() const
{
    std::ifstream f(path_);
    if (!f.is_open()) {
        std::fprintf(stderr, "INFO  state_snapshot.load: no file %s (init default)\n",
                     path_.c_str());
        return {};
    }
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string src = ss.str();

    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root || !root->is_obj()) {
        std::fprintf(stderr, "WARN  state_snapshot.load: parse fail %s (%s) -> init default\n",
                     path_.c_str(), err.c_str());
        return {};
    }

    const json::Value* ver = root->get("version");
    if (!ver || static_cast<int>(ver->num_or(0)) != 1) {
        std::fprintf(stderr, "WARN  state_snapshot.load: version la %s -> bỏ qua\n",
                     path_.c_str());
        return {};
    }

    const json::Value* nodes = root->get("nodes");
    if (!nodes || !nodes->is_obj()) {
        std::fprintf(stderr, "WARN  state_snapshot.load: no nodes obj %s\n", path_.c_str());
        return {};
    }

    std::vector<PersistEntry> result;
    for (const auto& kv : nodes->obj) {
        const std::string& id = kv.first;
        const json::Value* nd = kv.second.get();
        if (!nd || !nd->is_obj()) continue;

        PersistEntry e;
        e.id = id;
        const json::Value* jtype = nd->get("type");
        if (!jtype) continue;
        e.type = jtype->str_or("");

        if (e.type == "RuntimeCounter") {
            const json::Value* rs = nd->get("run_seconds");
            e.run_seconds = rs ? rs->num_or(0.0) : 0.0;
            e.count_raw   = 0;
        } else if (e.type == "PulseCounter") {
            const json::Value* cr = nd->get("count_raw");
            e.count_raw   = cr ? static_cast<uint64_t>(cr->num_or(0.0)) : 0;
            e.run_seconds = 0.0;
        } else {
            continue;   /* type không nhận ra — bỏ qua */
        }
        result.push_back(e);
    }
    std::fprintf(stderr, "INFO  state_snapshot.load: %zu entries from %s\n",
                 result.size(), path_.c_str());
    return result;
}

/* ---- save ---- */

bool StateSnapshot::save(const std::vector<PersistEntry>& entries) const
{
    /* lấy epoch ms (wall clock) cho saved_at_ms */
    struct timespec ts{};
    clock_gettime(CLOCK_REALTIME, &ts);
    const long long saved_ms = static_cast<long long>(ts.tv_sec) * 1000LL
                             + static_cast<long long>(ts.tv_nsec) / 1000000LL;

    /* build JSON thủ công — tránh dependency ngoài */
    std::string out;
    out.reserve(256 + entries.size() * 80);
    out += "{\n  \"version\": 1,\n  \"saved_at_ms\": ";
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%lld", saved_ms);
    out += buf;
    out += ",\n  \"nodes\": {";

    bool first = true;
    for (const PersistEntry& e : entries) {
        if (!first) out += ",";
        first = false;
        out += "\n    \"";
        out += e.id;
        out += "\": { \"type\": \"";
        out += e.type;
        out += "\"";
        if (e.type == "RuntimeCounter") {
            std::snprintf(buf, sizeof(buf), ", \"run_seconds\": %.6f", e.run_seconds);
            out += buf;
        } else if (e.type == "PulseCounter") {
            std::snprintf(buf, sizeof(buf), ", \"count_raw\": %" PRIu64, e.count_raw);
            out += buf;
        }
        out += " }";
    }
    out += "\n  }\n}\n";

    /* ghi vào .tmp trước */
    {
        std::ofstream f(tmp_path_, std::ios::trunc);
        if (!f.is_open()) {
            std::fprintf(stderr, "ERROR state_snapshot.save: cannot open %s\n",
                         tmp_path_.c_str());
            return false;
        }
        f << out;
        if (!f.good()) {
            std::fprintf(stderr, "ERROR state_snapshot.save: write error %s\n",
                         tmp_path_.c_str());
            return false;
        }
    }

    /* atomic rename */
    if (std::rename(tmp_path_.c_str(), path_.c_str()) != 0) {
        std::fprintf(stderr, "ERROR state_snapshot.save: rename %s -> %s failed: %s\n",
                     tmp_path_.c_str(), path_.c_str(), std::strerror(errno));
        return false;
    }
    std::fprintf(stderr, "INFO  state_snapshot.save: %zu entries -> %s\n",
                 entries.size(), path_.c_str());
    return true;
}

} // namespace core
