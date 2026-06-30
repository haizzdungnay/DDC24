#include "data/point_db.hpp"
#include "mkddc_shm.h"

#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <unordered_set>

#include <nlohmann/json.hpp>

namespace hmi {

using json = nlohmann::json;

bool PointDb::load(const std::string& path)
{
    last_path_ = path;
    std::ifstream f(path);
    if (!f.is_open()) {
        std::fprintf(stderr, "WARN  hmi.point_db not found: %s (using defaults)\n", path.c_str());
        return false;
    }
    try {
        json j = json::parse(f);
        PointDbMeta next_meta;
        next_meta.project_id        = j.value("project_id", "");
        next_meta.profile           = j.value("profile", "GENERIC_DDC");
        next_meta.revision          = j.value("revision", 0);
        next_meta.checksum          = j.value("checksum", "");
        next_meta.stale_threshold_s = j.value("stale_threshold_s", 5);
        if (next_meta.stale_threshold_s < 1 || next_meta.stale_threshold_s > 3600)
            throw std::runtime_error("stale_threshold_s outside 1..3600");

        std::vector<PointEntry> next_entries;
        std::unordered_set<std::string> ids;
        std::unordered_set<std::string> channels;
        for (const auto& p : j.value("points", json::array())) {
            PointEntry e;
            e.point_id    = p.value("point_id", "");
            e.io_type     = p.value("io_type", "");
            e.channel     = p.value("channel", 0);
            e.display_name = p.value("display_name", e.point_id);
            e.unit        = p.value("unit", "");
            e.scale_min   = p.value("scale_min", 0.0f);
            e.scale_max   = p.value("scale_max", 100.0f);
            if (e.point_id.empty()) continue;
            if (e.io_type != "UI" && e.io_type != "DI" &&
                e.io_type != "AO" && e.io_type != "DO")
                throw std::runtime_error("invalid io_type for " + e.point_id);
            if (e.channel < 1)
                throw std::runtime_error("invalid channel for " + e.point_id);
            const int channel_limit = e.io_type == "UI" ? KX_N_UI :
                                      e.io_type == "DI" ? KX_N_DI :
                                      e.io_type == "AO" ? KX_N_AO : KX_N_DO;
            if (e.channel > channel_limit)
                throw std::runtime_error("channel outside SHM contract for " + e.point_id);
            if (!ids.insert(e.point_id).second)
                throw std::runtime_error("duplicate point_id " + e.point_id);
            const std::string channel_key = e.io_type + ":" + std::to_string(e.channel);
            if (!channels.insert(channel_key).second)
                throw std::runtime_error("duplicate channel " + channel_key);
            if (p.contains("safe_state")) {
                if (e.io_type == "AO" && p["safe_state"].is_number()) {
                    e.has_safe_state = true;
                    e.safe_state_ao = p["safe_state"].get<float>();
                } else if (e.io_type == "DO" && p["safe_state"].is_boolean()) {
                    e.has_safe_state = true;
                    e.safe_state_do = p["safe_state"].get<bool>();
                } else {
                    throw std::runtime_error("safe_state type mismatch for " + e.point_id);
                }
            }
            next_entries.push_back(std::move(e));
        }
        entries_ = std::move(next_entries);
        meta_ = std::move(next_meta);
        loaded_ = true;
        std::fprintf(stderr, "INFO  hmi.point_db loaded %zu points from %s\n",
                     entries_.size(), path.c_str());
        return true;
    } catch (const std::exception& ex) {
        std::fprintf(stderr, "ERR   hmi.point_db parse error: %s\n", ex.what());
        return false;
    }
}

bool PointDb::reload(const std::string& path)
{
    return load(path.empty() ? last_path_ : path);
}

const PointEntry* PointDb::find(const std::string& id) const
{
    for (const auto& e : entries_)
        if (e.point_id == id) return &e;
    return nullptr;
}

const PointEntry* PointDb::find_by_type_ch(const std::string& type, int ch) const
{
    for (const auto& e : entries_)
        if (e.io_type == type && e.channel == ch) return &e;
    return nullptr;
}

std::string PointDb::display_name(const std::string& point_id) const
{
    const PointEntry* e = find(point_id);
    return e ? e->display_name : point_id;
}

size_t PointDb::count_by_type(const std::string& type) const
{
    size_t n = 0;
    for (const auto& e : entries_)
        if (e.io_type == type) ++n;
    return n;
}

} // namespace hmi
