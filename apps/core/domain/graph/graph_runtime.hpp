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

#include "mkddc_shm.h"
#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"

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

    /* Reload atomic: fail → giữ graph cũ; nội dung không đổi → giữ state node.
     * Đây là activation boundary contract hiện tại của FW SOM (load → validate →
     * atomic swap tại ranh giới scan → rollback-to-last-known-good khi fail, không
     * online mutation giữa scan — xem config_reload.cpp/scan_loop.cpp reload_flag_).
     * Theo ADR-020 §3/§4/§8: mkddc-program-core (typed IR interpreter cho ST/FBD,
     * chưa triển khai, C1+, gate G3 RED — VERIFICATION.md) sẽ cần đúng contract này
     * (validate → immutable artifact → atomic activation → rollback) khi được xây,
     * nhưng KHÔNG được thực thi source ST/FBD hay artifact ở đây — GraphRuntime chỉ
     * là legacy importer 28-node, không phải Program Runtime. */
    bool reload(const std::string& path);

    /* Execute 1 scan theo topo order; sink ghi resolver mức PRIO_LOCAL_LOGIC.
     * PointTable non-const: BACnet_AV/BV Protocol nodes ghi virtual points. */
    void execute(PointTable& table, PriorityResolver& resolver);

    /* COR-011: cập nhật ext snapshot từ plc_shm.ext[] trước khi execute().
     * Protocol nodes đọc giá trị từ snapshot này trong compute(). */
    void feed_ext_snapshot(const kx_ext_point_t* pts, uint16_t count);

    /* COR-011: ghi setpoint/dirty cho Modbus write nodes vào plc_shm.ext[].
     * Gọi SAU execute() trong scan_loop. */
    void apply_ext_writes(kx_plc_shm_t* shm) const;

    uint32_t declared_scan_ms() const { return declared_scan_ms_; }
    uint32_t effective_scan_ms() const { return scan_ms_; }
    void sync_actual_scan_ms(uint32_t actual_ms);

    /* Mode điện thực tế MCU đã áp dụng, lấy từ iobus SHM mỗi scan. */
    void set_ao_modes(const uint8_t modes[KX_N_AO]);

    const std::vector<int>& used_ai_channels() const { return used_ai_; }

    /* COR-010: persist state interface. */
    std::vector<PersistEntry> get_persist_state() const;
    /* T63-203: điền persist state vào `out` TẠI CHỖ, dùng lại sức chứa sẵn có
     * của vector và của từng chuỗi `id`/`type`. Khi `out` đã từng được điền cho
     * cùng graph (hoặc graph có số node persist và độ dài id không lớn hơn) thì
     * không cấp phát — đường bàn giao snapshot trên luồng quét dựa vào điều này. */
    void fill_persist_state(std::vector<PersistEntry>* out) const;
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
        SAFE_STATE, ALARM_HIGH, ALARM_LOW, ALARM_DELAY,
        /* 5 Protocol nodes COR-011 */
        MODBUS_RTU_READ, MODBUS_RTU_WRITE, MODBUS_TCP_READ,
        BACNET_AV, BACNET_BV
    };

    struct InputPin {
        int         node_idx;
        std::string src_port;
    };

    struct Node {
        std::string id;
        NodeType    type;
        std::map<std::string, double>      num_params;
        std::string                        str_param;    /* backward compat: last string value */
        std::map<std::string, std::string> str_params;   /* COR-011: all string params by key */
        int                                proto_ext_idx = -1;  /* COR-011: ext_cache slot */

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

    void compute(Node& n, PointTable& table, PriorityResolver& resolver);
    void reset_runtime_state();

    bool     loaded_          = false;
    bool     dirty_           = false;
    std::string src_cached_;
    uint32_t scan_ms_         = 1000;
    uint32_t declared_scan_ms_ = 1000;
    std::vector<Node> nodes_;
    std::vector<int>  order_;
    std::vector<int>  used_ai_;
    uint8_t           ao_modes_[KX_N_AO] = {};
    /* COR-011: ext snapshot (copy từ plc_shm.ext[] sau read_ext()) */
    kx_ext_point_t ext_snapshot_[KX_N_EXT] = {};
    uint16_t       ext_snap_count_          = 0;
};

} // namespace core

#endif /* CORE_GRAPH_RUNTIME_HPP */
