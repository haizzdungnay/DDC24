#include "alarm_runtime.hpp"

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <set>
#include <sstream>
#include <utility>

#include "alarm_primitives.hpp"
#include "json_min.hpp"

namespace core {

namespace {

constexpr std::size_t kMaxAlarms = 64;
constexpr std::size_t kMaxSourcesPerAlarm = 16;
constexpr std::size_t kMaxBacnetPublishedAlarms = 8;
constexpr int kAlarmDisabled = 0;
constexpr int kAlarmHighLowInput = 1;
constexpr int kAlarmRuntimeHours = 3;

std::string iso_utc_now()
{
    const std::time_t now = std::time(nullptr);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &now);
#else
    gmtime_r(&now, &tm);
#endif
    char buf[32];
    if (std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm) == 0) {
        return "1970-01-01T00:00:00Z";
    }
    return buf;
}

int read_file(const std::string& path, std::string* out)
{
    if (path.empty()) return ENOENT;
    errno = 0;
    std::ifstream f(path);
    if (!f.is_open()) return errno != 0 ? errno : ENOENT;
    std::stringstream ss;
    ss << f.rdbuf();
    *out = ss.str();
    return 0;
}

bool is_alarm_type(int value)
{
    return value >= 0 && value <= 7;
}

bool deferred_alarm_type(int value)
{
    return value == 2 || value == 4 || value == 5 || value == 6 || value == 7;
}

bool valid_priority(const std::string& value)
{
    return value == "low" || value == "medium" || value == "high" || value == "critical";
}

bool same_source(const AlarmSourceConfig& a, const AlarmSourceConfig& b)
{
    return a.point.kind == b.point.kind && a.point.idx == b.point.idx &&
           a.point_id == b.point_id;
}

bool same_params(const AlarmParamsConfig& a, const AlarmParamsConfig& b)
{
    return a.hh == b.hh && a.h == b.h && a.l == b.l && a.ll == b.ll &&
           a.hysteresis == b.hysteresis && a.runtime_hours == b.runtime_hours;
}

bool same_fingerprint(const AlarmEntityConfig& a, const AlarmEntityConfig& b)
{
    if (a.id != b.id || a.alarm_type != b.alarm_type || a.delay_s != b.delay_s ||
        !same_params(a.params, b.params) || a.sources.size() != b.sources.size()) {
        return false;
    }
    for (std::size_t i = 0; i < a.sources.size(); i++) {
        if (!same_source(a.sources[i], b.sources[i])) return false;
    }
    return true;
}


bool valid_id(const std::string& value)
{
    if (value.empty()) return false;
    for (const char c : value) {
        if (c <= ' ' || c == '/' || c == '\\') return false;
    }
    return true;
}

bool as_int(const json::Value* value, int* out)
{
    if (!value || !value->is_num()) return false;
    const double raw = value->num;
    const int parsed = static_cast<int>(raw);
    if (!std::isfinite(raw) || raw != static_cast<double>(parsed)) return false;
    *out = parsed;
    return true;
}

bool as_number(const json::Value* value, double* out)
{
    if (!value || !value->is_num() || !std::isfinite(value->num)) return false;
    *out = value->num;
    return true;
}

bool as_string(const json::Value* value, std::string* out)
{
    if (!value || !value->is_str()) return false;
    *out = value->str;
    return true;
}

bool as_bool(const json::Value* value, bool* out)
{
    if (!value || !value->is_bool()) return false;
    *out = value->b;
    return true;
}

struct TriggerInfo {
    std::string level;
    double threshold = 0.0;
};

TriggerInfo high_low_trigger(double value, const AlarmParamsConfig& params,
                             bool high_state, bool low_state)
{
    if (!high_state && !low_state) return {};
    if (high_state && value >= params.hh) return {"HH", params.hh};
    if (low_state && value <= params.ll) return {"LL", params.ll};
    if (high_state) return {"H", params.h};
    if (low_state) return {"L", params.l};
    return {};
}

std::string point_id(const std::string& kind, int channel)
{
    return kind + "-" + (channel < 10 ? "0" : "") + std::to_string(channel);
}

bool parse_source(const json::Value& src, AlarmSourceConfig* out)
{
    std::string kind;
    int channel = 0;
    std::string pid;
    if (!as_string(src.get("kind"), &kind) ||
        !as_int(src.get("channel"), &channel) ||
        !as_string(src.get("pointId"), &pid)) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_source (need kind/channel/pointId)\n");
        return false;
    }

    int max_channel = 0;
    PointKind point_kind = PointKind::AI;
    if (kind == "UI") {
        max_channel = KX_N_UI;
        point_kind = PointKind::AI;
    } else if (kind == "AO") {
        max_channel = KX_N_AO;
        point_kind = PointKind::AO;
    } else if (kind == "DO") {
        max_channel = KX_N_DO;
        point_kind = PointKind::BO;
    } else {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_source_kind kind=%s\n", kind.c_str());
        return false;
    }

    if (channel < 1 || channel > max_channel) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_source_channel kind=%s ch=%d\n",
                     kind.c_str(), channel);
        return false;
    }
    const std::string expected = point_id(kind, channel);
    if (pid != expected) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_source_point pointId=%s expected=%s\n",
                     pid.c_str(), expected.c_str());
        return false;
    }

    out->point = {point_kind, channel - 1};
    out->point_id = pid;
    return true;
}

bool parse_params(const json::Value* params, int alarm_type, AlarmParamsConfig* out)
{
    if (!params || !params->is_obj()) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_params (need object)\n");
        return false;
    }
    if (const json::Value* hys = params->get("hysteresis")) {
        if (!as_number(hys, &out->hysteresis) || out->hysteresis < 0.0) {
            std::fprintf(stderr, "ERROR alarm_cfg.bad_hysteresis\n");
            return false;
        }
    }
    if (alarm_type == kAlarmHighLowInput) {
        if (!as_number(params->get("hh"), &out->hh) ||
            !as_number(params->get("h"), &out->h) ||
            !as_number(params->get("l"), &out->l) ||
            !as_number(params->get("ll"), &out->ll)) {
            std::fprintf(stderr, "ERROR alarm_cfg.bad_thresholds (need hh/h/l/ll)\n");
            return false;
        }
        if (out->hh < out->h || out->h < out->l || out->l < out->ll) {
            std::fprintf(stderr, "ERROR alarm_cfg.bad_threshold_order\n");
            return false;
        }
    } else if (alarm_type == kAlarmRuntimeHours) {
        if (!as_number(params->get("runtimeHours"), &out->runtime_hours) ||
            out->runtime_hours <= 0.0) {
            std::fprintf(stderr, "ERROR alarm_cfg.bad_runtime_hours\n");
            return false;
        }
    }
    return true;
}

bool parse_entity(const json::Value& row, AlarmEntityConfig* out, bool* skipped)
{
    *skipped = false;
    if (!row.is_obj()) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_row (need object)\n");
        return false;
    }
    if (!as_string(row.get("id"), &out->id) || !valid_id(out->id) ||
        !as_string(row.get("label"), &out->label) || out->label.empty() ||
        !as_bool(row.get("enabled"), &out->enabled) ||
        !as_int(row.get("alarmType"), &out->alarm_type) ||
        !as_string(row.get("priority"), &out->priority) ||
        !as_number(row.get("delayS"), &out->delay_s)) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_required id=%s\n", out->id.c_str());
        return false;
    }
    if (!valid_priority(out->priority) || out->delay_s < 0.0 ||
        !is_alarm_type(out->alarm_type)) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_scalar id=%s\n", out->id.c_str());
        return false;
    }
    if (const json::Value* pub = row.get("publishBacnet")) {
        if (!as_bool(pub, &out->publish_bacnet)) {
            std::fprintf(stderr, "ERROR alarm_cfg.bad_publish_bacnet id=%s\n", out->id.c_str());
            return false;
        }
    }
    if (const json::Value* nc = row.get("notificationClass")) {
        if (!as_int(nc, &out->notification_class) ||
            out->notification_class < 1 || out->notification_class > 4) {
            std::fprintf(stderr, "ERROR alarm_cfg.bad_notification_class id=%s\n", out->id.c_str());
            return false;
        }
    }

    if (!out->enabled || out->alarm_type == kAlarmDisabled) {
        *skipped = true;
        return true;
    }
    if (deferred_alarm_type(out->alarm_type)) {
        std::fprintf(stderr, "WARN  alarm_cfg.deferred_skip id=%s alarmType=%d\n",
                     out->id.c_str(), out->alarm_type);
        *skipped = true;
        return true;
    }
    if (out->alarm_type != kAlarmHighLowInput && out->alarm_type != kAlarmRuntimeHours) {
        std::fprintf(stderr, "ERROR alarm_cfg.unsupported_active id=%s alarmType=%d\n",
                     out->id.c_str(), out->alarm_type);
        return false;
    }

    const json::Value* sources = row.get("sources");
    if (!sources || !sources->is_arr() || sources->arr.empty() ||
        sources->arr.size() > kMaxSourcesPerAlarm) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_sources id=%s\n", out->id.c_str());
        return false;
    }
    for (const auto& source : sources->arr) {
        AlarmSourceConfig parsed;
        if (!parse_source(*source, &parsed)) return false;
        for (const AlarmSourceConfig& existing : out->sources) {
            if (existing.point.kind == parsed.point.kind && existing.point.idx == parsed.point.idx) {
                std::fprintf(stderr, "ERROR alarm_cfg.dup_source id=%s pointId=%s\n",
                             out->id.c_str(), parsed.point_id.c_str());
                return false;
            }
        }
        out->sources.push_back(parsed);
    }
    return parse_params(row.get("params"), out->alarm_type, &out->params);
}

} // namespace

bool AlarmRuntime::visible(const Entity& entity)
{
    return entity.active || entity.latched_clear;
}

std::string AlarmRuntime::status_for(const Entity& entity)
{
    if (entity.active) return entity.acked ? "acked" : "active";
    if (entity.latched_clear) return "unack";
    return {};
}

void AlarmRuntime::copy_lifecycle(const Entity& old_entity, Entity* entity)
{
    entity->branches = old_entity.branches;
    for (std::size_t i = 0; i < entity->branches.size(); i++) {
        entity->branches[i].source = entity->cfg.sources[i];
    }
    entity->active = old_entity.active;
    entity->acked = old_entity.acked;
    entity->latched_clear = old_entity.latched_clear;
    entity->occurrence = old_entity.occurrence;
    entity->first_active_at = old_entity.first_active_at;
    entity->active_source = old_entity.active_source;
    entity->trigger_value = old_entity.trigger_value;
    entity->trigger_level = old_entity.trigger_level;
    entity->trigger_threshold = old_entity.trigger_threshold;
    entity->last_status = old_entity.last_status;
}

bool load_alarm_config(const std::string& path, bool must_exist,
                       std::vector<AlarmEntityConfig>* out)
{
    out->clear();
    std::string src;
    const int rerr = read_file(path, &src);
    if (rerr == ENOENT && !must_exist) {
        std::fprintf(stderr, "WARN  alarm_cfg.missing path=%s (alarms disabled)\n",
                     path.c_str());
        return true;
    }
    if (rerr != 0) {
        std::fprintf(stderr, "ERROR alarm_cfg.open_fail path=%s errno=%d (%s)\n",
                     path.c_str(), rerr, std::strerror(rerr));
        return false;
    }

    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root || !root->is_arr()) {
        std::fprintf(stderr, "ERROR alarm_cfg.bad_json path=%s (%s)\n",
                     path.c_str(), err.c_str());
        return false;
    }
    if (root->arr.size() > kMaxAlarms) {
        std::fprintf(stderr, "ERROR alarm_cfg.too_many count=%zu max=%zu\n",
                     root->arr.size(), kMaxAlarms);
        return false;
    }

    std::size_t bacnet_published = 0;
    std::set<std::string> seen_ids;
    for (const auto& row : root->arr) {
        AlarmEntityConfig parsed;
        bool skipped = false;
        if (!parse_entity(*row, &parsed, &skipped)) return false;
        if (!seen_ids.insert(parsed.id).second) {
            std::fprintf(stderr, "ERROR alarm_cfg.dup_id id=%s\n", parsed.id.c_str());
            return false;
        }
        if (skipped) continue;
        if (parsed.publish_bacnet) bacnet_published++;
        out->push_back(std::move(parsed));
    }
    if (bacnet_published > kMaxBacnetPublishedAlarms) {
        std::fprintf(stderr, "ERROR alarm_cfg.too_many_bacnet count=%zu max=%zu\n",
                     bacnet_published, kMaxBacnetPublishedAlarms);
        return false;
    }
    std::fprintf(stderr, "INFO  alarm_cfg.loaded path=%s entities=%zu\n",
                 path.c_str(), out->size());
    return true;
}

bool AlarmRuntime::load(const std::string& path, bool must_exist)
{
    std::vector<AlarmEntityConfig> cfg;
    if (!load_alarm_config(path, must_exist, &cfg)) return false;
    configure(std::move(cfg));
    return true;
}

bool AlarmRuntime::reload(const std::string& path, bool must_exist)
{
    std::vector<AlarmEntityConfig> cfg;
    if (!load_alarm_config(path, must_exist, &cfg)) {
        std::fprintf(stderr, "WARN  alarm.reload_keep_old path=%s\n", path.c_str());
        return false;
    }
    configure(std::move(cfg));
    return true;
}

void AlarmRuntime::configure(std::vector<AlarmEntityConfig> entities)
{
    std::vector<Entity> next;
    next.reserve(entities.size());
    for (AlarmEntityConfig& cfg : entities) {
        const Entity* old_match = nullptr;
        for (const Entity& old_entity : entities_) {
            if (same_fingerprint(old_entity.cfg, cfg)) {
                old_match = &old_entity;
                break;
            }
        }
        Entity entity;
        entity.cfg = std::move(cfg);
        entity.branches.reserve(entity.cfg.sources.size());
        for (const AlarmSourceConfig& source : entity.cfg.sources) {
            Branch branch;
            branch.source = source;
            entity.branches.push_back(std::move(branch));
        }
        if (old_match != nullptr) copy_lifecycle(*old_match, &entity);
        next.push_back(std::move(entity));
    }
    entities_ = std::move(next);
}

void AlarmRuntime::evaluate(const PointTable& table, uint32_t scan_ms)
{
    const uint32_t effective_ms = scan_ms == 0 ? 1 : scan_ms;
    const float dt = static_cast<float>(effective_ms) / 1000.0f;
    for (Entity& entity : entities_) {
        const bool was_condition_active = entity.active;
        const bool was_visible = visible(entity);
        const std::string old_source = entity.active_source;
        bool condition_active = false;
        std::string condition_source;
        double condition_value = 0.0;
        std::string condition_level;
        double condition_threshold = 0.0;

        for (Branch& branch : entity.branches) {
            const float value = table.get(branch.source.point).value;
            bool raw_active = false;
            TriggerInfo trigger;
            if (entity.cfg.alarm_type == kAlarmHighLowInput) {
                branch.high_state = alarm_high_step(value, static_cast<float>(entity.cfg.params.h),
                                                    static_cast<float>(entity.cfg.params.hysteresis),
                                                    branch.high_state);
                branch.low_state = alarm_low_step(value, static_cast<float>(entity.cfg.params.l),
                                                  static_cast<float>(entity.cfg.params.hysteresis),
                                                  branch.low_state);
                raw_active = branch.high_state || branch.low_state;
                trigger = high_low_trigger(value, entity.cfg.params,
                                           branch.high_state, branch.low_state);
            } else if (entity.cfg.alarm_type == kAlarmRuntimeHours) {
                const RuntimeCounterStep rc =
                    runtime_counter_step(value != 0.0f, false, dt,
                                         entity.cfg.params.runtime_hours,
                                         &branch.runtime_seconds,
                                         &branch.runtime_prev_reset);
                raw_active = rc.alarm;
                if (raw_active) trigger = {"RUNTIME", entity.cfg.params.runtime_hours};
            }
            branch.active = alarm_delay_step(raw_active, dt,
                                             static_cast<float>(entity.cfg.delay_s),
                                             0.0f, &branch.delay_state,
                                             &branch.delay_acc_s);
            if (branch.active && !condition_active) {
                condition_active = true;
                condition_source = branch.source.point_id;
                condition_value = value;
                condition_level = trigger.level;
                condition_threshold = trigger.threshold;
            }
        }

        if (condition_active) {
            if (!was_visible) {
                entity.occurrence++;
                entity.first_active_at = iso_utc_now();
                entity.acked = false;
            } else if (entity.latched_clear) {
                entity.acked = false;
            }
            entity.active = true;
            entity.latched_clear = false;
            entity.active_source = condition_source;
            entity.trigger_value = condition_value;
            entity.trigger_level = condition_level;
            entity.trigger_threshold = condition_threshold;
        } else if (was_condition_active) {
            entity.active = false;
            if (entity.acked) {
                entity.acked = false;
                entity.latched_clear = false;
                entity.active_source.clear();
                entity.first_active_at.clear();
                entity.trigger_value = 0.0;
                entity.trigger_level.clear();
                entity.trigger_threshold = 0.0;
            } else {
                entity.latched_clear = true;
            }
        } else if (!entity.latched_clear) {
            entity.active = false;
            entity.acked = false;
            entity.active_source.clear();
            entity.first_active_at.clear();
            entity.trigger_value = 0.0;
            entity.trigger_level.clear();
            entity.trigger_threshold = 0.0;
        }
        entity.last_status = status_for(entity);

        if (entity.active != was_condition_active ||
            (entity.active && entity.active_source != old_source)) {
            std::fprintf(stderr, "INFO  alarm.%s id=%s source=%s level=%s priority=%s\n",
                         entity.active ? "active" : "clear",
                         entity.cfg.id.c_str(),
                         entity.active_source.empty() ? "-" : entity.active_source.c_str(),
                         entity.trigger_level.empty() ? "-" : entity.trigger_level.c_str(),
                         entity.cfg.priority.c_str());
        }
    }
}

std::vector<AlarmState> AlarmRuntime::active_states() const
{
    std::vector<AlarmState> out;
    for (const Entity& entity : entities_) {
        if (!visible(entity)) continue;
        out.push_back({
            entity.cfg.id,
            entity.cfg.id,
            entity.first_active_at,
            status_for(entity),
            entity.active_source,
            entity.trigger_value,
            entity.trigger_level,
            entity.trigger_threshold,
            entity.cfg.priority,
            entity.cfg.label,
            entity.cfg.alarm_type,
            entity.occurrence,
            entity.active
        });
    }
    return out;
}

bool AlarmRuntime::ack(const std::string& id)
{
    for (Entity& entity : entities_) {
        if (entity.cfg.id != id) continue;
        if (!visible(entity)) return false;
        if (entity.latched_clear) {
            entity.active = false;
            entity.acked = false;
            entity.latched_clear = false;
            entity.active_source.clear();
            entity.first_active_at.clear();
            entity.trigger_value = 0.0;
            entity.trigger_level.clear();
            entity.trigger_threshold = 0.0;
            entity.last_status.clear();
            return true;
        }
        entity.acked = true;
        entity.last_status = status_for(entity);
        return true;
    }
    return false;
}

bool AlarmRuntime::entity_active(const std::string& id) const
{
    for (const Entity& entity : entities_) {
        if (entity.cfg.id == id) return entity.active;
    }
    return false;
}

std::string AlarmRuntime::entity_source(const std::string& id) const
{
    for (const Entity& entity : entities_) {
        if (entity.cfg.id == id) return entity.active_source;
    }
    return {};
}

std::size_t AlarmRuntime::branch_count() const
{
    std::size_t count = 0;
    for (const Entity& entity : entities_) count += entity.branches.size();
    return count;
}

} // namespace core
