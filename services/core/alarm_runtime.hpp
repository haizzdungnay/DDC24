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
    std::string alarm_setting_id;
    std::string time;
    std::string status;
    std::string source_point_id;
    double value = 0.0;
    std::string trigger_level;
    double threshold = 0.0;
    std::string priority;
    std::string label;
    int alarm_type = 0;
    uint64_t occurrence = 0;
    bool active = false;
};

class AlarmRuntime {
public:
    bool load(const std::string& path, bool must_exist = false);
    bool reload(const std::string& path, bool must_exist = false);
    void configure(std::vector<AlarmEntityConfig> entities);

    void evaluate(const PointTable& table, uint32_t scan_ms);
    bool ack(const std::string& id);
    bool return_to_active(const std::string& id);

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
        bool acked = false;
        bool latched_clear = false;
        uint64_t occurrence = 0;
        std::string first_active_at;
        std::string active_source;
        double trigger_value = 0.0;
        std::string trigger_level;
        double trigger_threshold = 0.0;
        std::string last_status;
    };

    static bool visible(const Entity& entity);
    static std::string status_for(const Entity& entity);
    static void copy_lifecycle(const Entity& old_entity, Entity* entity);

    std::vector<Entity> entities_;
};

bool load_alarm_config(const std::string& path, bool must_exist,
                       std::vector<AlarmEntityConfig>* out);

} // namespace core

#endif /* CORE_ALARM_RUNTIME_HPP */
