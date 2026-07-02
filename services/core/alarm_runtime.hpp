#ifndef CORE_ALARM_RUNTIME_HPP
#define CORE_ALARM_RUNTIME_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "point_table.hpp"

namespace core {

struct AlarmSourceConfig {
    PointId point{PointKind::AI, -1};
    std::string point_id;
};

struct AlarmParamsConfig {
    double hh = 0.0;
    double h = 0.0;
    double l = 0.0;
    double ll = 0.0;
    double hysteresis = 0.0;
    double runtime_hours = 0.0;
};

struct AlarmEntityConfig {
    std::string id;
    std::string label;
    bool enabled = false;
    int alarm_type = 0;
    std::vector<AlarmSourceConfig> sources;
    std::string priority;
    double delay_s = 0.0;
    bool publish_bacnet = false;
    int notification_class = 0;
    AlarmParamsConfig params;
};

struct AlarmState {
    std::string id;
    std::string source_point_id;
    std::string priority;
    bool active = false;
};

class AlarmRuntime {
public:
    bool load(const std::string& path, bool must_exist = false);
    bool reload(const std::string& path, bool must_exist = false);
    void configure(std::vector<AlarmEntityConfig> entities);

    void evaluate(const PointTable& table, uint32_t scan_ms);

    std::vector<AlarmState> active_states() const;
    bool entity_active(const std::string& id) const;
    std::string entity_source(const std::string& id) const;
    std::size_t entity_count() const { return entities_.size(); }
    std::size_t branch_count() const;

private:
    struct Branch {
        AlarmSourceConfig source;
        bool high_state = false;
        bool low_state = false;
        bool delay_state = false;
        float delay_acc_s = 0.0f;
        double runtime_seconds = 0.0;
        bool runtime_prev_reset = false;
        bool active = false;
    };

    struct Entity {
        AlarmEntityConfig cfg;
        std::vector<Branch> branches;
        bool active = false;
        std::string active_source;
    };

    std::vector<Entity> entities_;
};

bool load_alarm_config(const std::string& path, bool must_exist,
                       std::vector<AlarmEntityConfig>* out);

} // namespace core

#endif /* CORE_ALARM_RUNTIME_HPP */
