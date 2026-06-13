/**
 * @file  graph_runtime.hpp
 * @brief Graph engine Rev A (GRAPH_SCHEMA IF-GRAPH-MK-DDC-24-VI):
 *        load graph.json → validate → topo sort → execute mỗi scan.
 *
 *        Component set Rev A (SW_COMPONENT_LIBRARY + 22_GRAPH_STATEFUL_COMPONENTS_PLAN):
 *        AI_Input, DI_Input, Setpoint, AND, OR, NOT, Compare_GT, Compare_LT,
 *        Scale, Limit, PID, AO_Output, DO_Output  (13 type cũ)
 *        ManualAuto, OnDelay, OffDelay, Interlock, RuntimeCounter, PulseCounter,
 *        SafeState, AlarmHigh, AlarmLow, AlarmDelay                (10 type mới COR-009)
 *
 *        Multi-output: node dùng named output map (GAP-04).
 *        Persist: RuntimeCounter/PulseCounter dirty flag + get/restore (COR-010).
 */
#ifndef CORE_GRAPH_RUNTIME_HPP
#define CORE_GRAPH_RUNTIME_HPP

#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "point_table.hpp"
#include "priority_resolver.hpp"

namespace core {

/* Entry persist state cho StateSnapshot (COR-010). */
struct PersistEntry {
    std::string id;
    std::string type;       /* "RuntimeCounter" hoặc "PulseCounter" */
    double      run_seconds = 0.0;   /* RuntimeCounter */
    uint64_t    count_raw   = 0;     /* PulseCounter */
};

class GraphRuntime {
public:
    bool load(const std::string& path);
    bool load_string(const std::string& src, const std::string& name = "<inline>");
    bool loaded() const { return loaded_; }

    /* Reload atomic: fail → giữ graph cũ; nội dung không đổi → giữ state node. */
    bool reload(const std::string& path);

    /* Execute 1 scan theo topo order; sink ghi resolver mức PRIO_LOCAL_LOGIC. */
    void execute(const PointTable& table, PriorityResolver& resolver);

    uint32_t declared_scan_ms() const { return declared_scan_ms_; }
    uint32_t effective_scan_ms() const { return scan_ms_; }
    void sync_actual_scan_ms(uint32_t actual_ms);

    const std::vector<int>& used_ai_channels() const { return used_ai_; }

    /* COR-010: persist state interface. */
    std::vector<PersistEntry> get_persist_state() const;
    void restore_persist_state(const std::vector<PersistEntry>& entries);
    bool dirty() const { return dirty_; }
    void clear_dirty() { dirty_ = false; }

private:
    enum class NodeType {
        /* 13 type cũ */
        AI_INPUT, DI_INPUT, SETPOINT,
        AND_, OR_, NOT_, CMP_GT, CMP_LT,
        SCALE, LIMIT, PID,
        AO_OUTPUT, DO_OUTPUT,
        /* 10 type mới COR-009 */
        MANUAL_AUTO, ON_DELAY, OFF_DELAY,
        INTERLOCK, RUNTIME_COUNTER, PULSE_COUNTER,
        SAFE_STATE, ALARM_HIGH, ALARM_LOW, ALARM_DELAY
    };

    struct InputPin {
        int         node_idx;
        std::string src_port;
    };

    struct Node {
        std::string id;
        NodeType    type;
        std::map<std::string, double> num_params;
        std::string str_param;

        std::map<std::string, InputPin> inputs;   /* dst_port → {src_idx, src_port} */
        std::map<std::string, float>    outputs;  /* named output ports */

        /* --- state fields --- */
        /* PID */
        float  pid_integral = 0.0f;
        float  pid_prev_pv  = 0.0f;
        bool   pid_first    = true;
        /* Compare / AlarmHigh / AlarmLow (hysteresis state) */
        bool   cmp_state    = false;
        /* OnDelay / OffDelay / AlarmDelay accumulator; AlarmDelay output state = cmp_state */
        float  acc_s        = 0.0f;
        /* Interlock latch state */
        bool   il_tripped   = false;
        /* RuntimeCounter [persist] */
        double rt_seconds   = 0.0;
        bool   rt_prev_reset = false;
        /* PulseCounter [persist] */
        uint64_t pc_count_raw   = 0;
        bool     pc_prev_pulse  = false;
        bool     pc_prev_reset  = false;
        uint32_t pc_last_di     = 0;
        bool     pc_di_init     = false;
    };

    void compute(Node& n, const PointTable& table, PriorityResolver& resolver);
    void reset_runtime_state();

    bool     loaded_          = false;
    bool     dirty_           = false;
    std::string src_cached_;
    uint32_t scan_ms_         = 1000;
    uint32_t declared_scan_ms_ = 1000;
    std::vector<Node> nodes_;
    std::vector<int>  order_;
    std::vector<int>  used_ai_;
};

} // namespace core

#endif /* CORE_GRAPH_RUNTIME_HPP */
