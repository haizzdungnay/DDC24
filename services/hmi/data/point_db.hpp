#ifndef HMI_POINT_DB_HPP
#define HMI_POINT_DB_HPP

#include <string>
#include <vector>
#include <cstdint>

namespace hmi {

struct PointEntry {
    std::string point_id;      /* "UI1" */
    std::string io_type;       /* "UI" | "DI" | "AO" | "DO" */
    int         channel = 0;   /* 1-based */
    std::string display_name;  /* fallback = point_id */
    std::string unit;
    float       scale_min        = 0.0f;
    float       scale_max        = 100.0f;
    float       safe_state_ao    = 0.0f;
    bool        safe_state_do    = false;
    bool        has_safe_state   = false;
};

struct PointDbMeta {
    std::string project_id;
    std::string profile;
    int         revision           = 0;
    std::string checksum;
    int         stale_threshold_s  = 5;  /* AGE > this → STALE */
};

class PointDb {
public:
    /* Load from JSON file. Returns true on success. */
    bool load(const std::string& path);
    bool reload(const std::string& path);   /* SIGHUP; old DB survives on failure */

    const PointEntry* find(const std::string& point_id) const;
    const PointEntry* find_by_type_ch(const std::string& type, int ch) const;

    /* Returns display_name if found, else point_id. Never nullptr. */
    std::string display_name(const std::string& point_id) const;

    const PointDbMeta& meta() const { return meta_; }
    size_t count() const            { return entries_.size(); }
    size_t count_by_type(const std::string& type) const;
    const std::vector<PointEntry>& entries() const { return entries_; }

    bool loaded() const { return loaded_; }

private:
    std::vector<PointEntry> entries_;
    PointDbMeta             meta_;
    bool                    loaded_ = false;
    std::string             last_path_;
};

} // namespace hmi

#endif
