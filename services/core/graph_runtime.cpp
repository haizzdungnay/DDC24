#include "graph_runtime.hpp"

#include <algorithm>
#include <cinttypes>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <set>
#include <sstream>

#include "alarm_primitives.hpp"
#include "json_min.hpp"

namespace core {

void GraphRuntime::set_ao_modes(const uint8_t modes[KX_N_AO])
{
    if (!modes) return;
    for (int ch = 0; ch < KX_N_AO; ch++)
        ao_modes_[ch] = modes[ch] == 1 ? 1 : 0;
}

namespace {

/* Integer constants matching NodeType enum order — used in standalone helpers
 * that cannot access the private NodeType enum. */
static const int
    NT_AI=0, NT_DI=1, NT_SP=2,
    NT_AND=3, NT_OR=4, NT_NOT=5, NT_CGT=6, NT_CLT=7,
    NT_SCALE=8, NT_LIMIT=9, NT_PID=10,
    NT_AO=11, NT_DO=12,
    NT_MA=13, NT_ON=14, NT_OFF=15,
    NT_IL=16, NT_RC=17, NT_PC=18,
    NT_SS=19, NT_AH=20, NT_AL=21, NT_AD=22,
    /* COR-011 Protocol nodes */
    NT_MRTU_R=23, NT_MRTU_W=24, NT_MTCP_R=25,
    NT_BAV=26,    NT_BBV=27;

bool type_from_string(const std::string& s, int* out)
{
    static const std::map<std::string, int> kTypes = {
        {"AI_Input",       NT_AI},  {"DI_Input",     NT_DI},  {"Setpoint",     NT_SP},
        {"AND",            NT_AND}, {"OR",           NT_OR},  {"NOT",          NT_NOT},
        {"Compare_GT",     NT_CGT}, {"Compare_LT",   NT_CLT},
        {"Scale",          NT_SCALE},{"Limit",       NT_LIMIT},{"PID",         NT_PID},
        {"AO_Output",      NT_AO},  {"DO_Output",    NT_DO},
        {"ManualAuto",     NT_MA},
        {"OnDelay",        NT_ON},  {"OffDelay",     NT_OFF},
        {"Interlock",      NT_IL},
        {"RuntimeCounter", NT_RC},  {"PulseCounter", NT_PC},
        {"SafeState",      NT_SS},
        {"AlarmHigh",       NT_AH},    {"AlarmLow",      NT_AL},  {"AlarmDelay",    NT_AD},
        /* COR-011 Protocol nodes */
        {"Modbus_RTU_Read", NT_MRTU_R}, {"Modbus_RTU_Write", NT_MRTU_W},
        {"Modbus_TCP_Read", NT_MTCP_R},
        {"BACnet_AV",       NT_BAV},    {"BACnet_BV",        NT_BBV},
    };
    const auto it = kTypes.find(s);
    if (it == kTypes.end()) return false;
    *out = it->second;
    return true;
}

static const char* type_name(int t)
{
    static const char* kNames[] = {
        "AI_Input","DI_Input","Setpoint",
        "AND","OR","NOT","Compare_GT","Compare_LT",
        "Scale","Limit","PID","AO_Output","DO_Output",
        "ManualAuto","OnDelay","OffDelay",
        "Interlock","RuntimeCounter","PulseCounter",
        "SafeState","AlarmHigh","AlarmLow","AlarmDelay",
        "Modbus_RTU_Read","Modbus_RTU_Write","Modbus_TCP_Read",
        "BACnet_AV","BACnet_BV",
    };
    if (t < 0 || t > NT_BBV) return "?";
    return kNames[static_cast<size_t>(t)];
}

bool valid_input_port(int type, const std::string& port)
{
    switch (type) {
    case NT_AND: case NT_OR:     return port == "a" || port == "b";
    case NT_NOT:                 return port == "in";
    case NT_CGT: case NT_CLT:   return port == "a" || port == "b";
    case NT_SCALE: case NT_LIMIT: return port == "in";
    case NT_PID:                 return port == "pv" || port == "sp";
    case NT_AO: case NT_DO:      return port == "in";
    case NT_MA:                  return port == "sel" || port == "manual" || port == "auto";
    case NT_ON: case NT_OFF:     return port == "in";
    case NT_IL:                  return port == "permit" || port == "request";
    case NT_RC:                  return port == "run" || port == "reset";
    case NT_PC:                  return port == "pulse" || port == "reset";
    case NT_SS:                  return port == "in" || port == "good";
    case NT_AH: case NT_AL:      return port == "pv";
    case NT_AD:                  return port == "in";
    /* COR-011 Protocol nodes */
    case NT_MRTU_W:              return port == "in";
    case NT_BAV:                 return port == "in";  /* optional — write AV from graph */
    case NT_BBV:                 return port == "in";  /* optional — write BV from graph */
    default:                     return false;
    }
}

bool valid_from_port(int type, const std::string& port)
{
    switch (type) {
    case NT_RC:     return port == "hours" || port == "alarm";
    case NT_IL:     return port == "out"   || port == "tripped";
    /* Protocol write nodes (sink) — không có output port */
    case NT_MRTU_W: return false;
    default:        return port == "out";
    }
}

static bool read_file_content(const std::string& path, std::string* out)
{
    std::ifstream f(path);
    if (!f.is_open()) return false;
    std::stringstream ss;
    ss << f.rdbuf();
    *out = ss.str();
    return true;
}

} // namespace

/* ---- load / reload ---- */

bool GraphRuntime::load(const std::string& path)
{
    std::string src;
    if (!read_file_content(path, &src)) {
        std::fprintf(stderr, "INFO  graph.none path=%s (nguon logic inactive)\n", path.c_str());
        loaded_ = false;
        return false;
    }
    return load_string(src, path);
}

bool GraphRuntime::load_string(const std::string& src, const std::string& name)
{
    loaded_ = false;
    dirty_  = false;
    nodes_.clear();
    order_.clear();
    used_ai_.clear();

    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root || !root->is_obj()) {
        std::fprintf(stderr, "ERROR graph.bad_json %s (%s)\n", name.c_str(), err.c_str());
        return false;
    }

    const json::Value* ver = root->get("schema_version");
    if (!ver || ver->str_or("") != "1.0") {
        std::fprintf(stderr, "ERROR graph.schema_version %s\n", name.c_str());
        return false;
    }

    uint32_t parsed_scan_ms = 1000;
    if (const json::Value* dev = root->get("device")) {
        const double ms = dev->get("scan_ms") ? dev->get("scan_ms")->num_or(1000) : 1000;
        if (ms < 500 || ms > 2000) {
            std::fprintf(stderr, "ERROR graph.scan_ms=%g (hop le 500..2000)\n", ms);
            return false;
        }
        parsed_scan_ms = static_cast<uint32_t>(ms);
    }

    /* ---- nodes ---- */
    const json::Value* jnodes = root->get("nodes");
    if (!jnodes || !jnodes->is_arr() || jnodes->arr.empty()) {
        std::fprintf(stderr, "ERROR graph.no_nodes %s\n", name.c_str());
        return false;
    }
    std::map<std::string, int> id_to_idx;
    for (const auto& jn : jnodes->arr) {
        Node n;
        n.id = jn->get("id") ? jn->get("id")->str_or("") : "";
        const std::string type_s = jn->get("type") ? jn->get("type")->str_or("") : "";
        int ti;
        if (n.id.empty() || !type_from_string(type_s, &ti)) {
            std::fprintf(stderr, "ERROR graph.bad_node id=%s type=%s\n",
                         n.id.c_str(), type_s.c_str());
            return false;
        }
        n.type = static_cast<NodeType>(ti);
        if (id_to_idx.count(n.id)) {
            std::fprintf(stderr, "ERROR graph.dup_id %s\n", n.id.c_str());
            return false;
        }
        if (const json::Value* params = jn->get("params")) {
            for (const auto& kv : params->obj) {
                if (kv.second->is_num()) n.num_params[kv.first] = kv.second->num;
                else if (kv.second->is_str()) {
                    n.str_params[kv.first] = kv.second->str;
                    n.str_param = kv.second->str;   /* backward compat: last string value */
                }
            }
        }

        /* COR-011: validate Protocol node required params */
        if (ti == NT_MRTU_R || ti == NT_MRTU_W) {
            if (!n.num_params.count("bus") || !n.num_params.count("slave") ||
                !n.num_params.count("fc")  || !n.num_params.count("addr") ||
                !n.str_params.count("type")) {
                std::fprintf(stderr, "ERROR graph.protocol_missing_param node=%s"
                             " (Modbus_RTU_* requires bus/slave/fc/addr/type)\n", n.id.c_str());
                return false;
            }
            if (ti == NT_MRTU_R && !n.num_params.count("fallback")) {
                std::fprintf(stderr, "ERROR graph.protocol_missing_param node=%s"
                             " (Modbus_RTU_Read requires fallback)\n", n.id.c_str());
                return false;
            }
        }
        if (ti == NT_MTCP_R) {
            if (!n.str_params.count("host") || !n.num_params.count("unit") ||
                !n.num_params.count("fc")   || !n.num_params.count("addr") ||
                !n.str_params.count("type") || !n.num_params.count("fallback")) {
                std::fprintf(stderr, "ERROR graph.protocol_missing_param node=%s"
                             " (Modbus_TCP_Read requires host/unit/fc/addr/type/fallback)\n",
                             n.id.c_str());
                return false;
            }
        }
        if (ti == NT_BAV || ti == NT_BBV) {
            const auto cit = n.num_params.find("instance");
            if (cit == n.num_params.end() || cit->second < 1) {
                std::fprintf(stderr, "ERROR graph.protocol_missing_param node=%s"
                             " (BACnet_AV/BV requires instance >= 1)\n", n.id.c_str());
                return false;
            }
        }

        /* IO channel validation */
        if (ti == NT_AI || ti == NT_DI || ti == NT_AO || ti == NT_DO) {
            const int max_ch = (ti == NT_AI) ? KX_N_UI
                             : (ti == NT_DI) ? KX_N_DI
                             : (ti == NT_AO) ? KX_N_AO : KX_N_DO;
            const auto cit = n.num_params.find("channel");
            if (cit == n.num_params.end() || cit->second < 0 || cit->second >= max_ch) {
                std::fprintf(stderr, "ERROR graph.bad_channel node=%s\n", n.id.c_str());
                return false;
            }
        }
        /* PulseCounter channel mode: validate DI channel (optional param) */
        if (ti == NT_PC) {
            const auto cit = n.num_params.find("channel");
            if (cit != n.num_params.end() &&
                (cit->second < 0 || cit->second >= KX_N_DI)) {
                std::fprintf(stderr, "ERROR graph.bad_channel node=%s (PulseCounter ch)\n",
                             n.id.c_str());
                return false;
            }
        }
        /* delay_s range validation for timer types (§3.1) */
        if (ti == NT_ON || ti == NT_OFF || ti == NT_AD) {
            const char* fields[] = {"delay_s", "on_delay_s", "off_delay_s", nullptr};
            for (int fi = 0; fields[fi]; ++fi) {
                const auto dit = n.num_params.find(fields[fi]);
                if (dit != n.num_params.end() &&
                    (dit->second < 0.0 || dit->second > 86400.0)) {
                    std::fprintf(stderr, "ERROR graph.bad_param node=%s %s=%g (0..86400)\n",
                                 n.id.c_str(), fields[fi], dit->second);
                    return false;
                }
            }
        }

        id_to_idx[n.id] = static_cast<int>(nodes_.size());
        nodes_.push_back(n);
    }

    /* ---- links ---- */
    const json::Value* jlinks = root->get("links");
    if (!jlinks || !jlinks->is_arr()) {
        std::fprintf(stderr, "ERROR graph.no_links %s\n", name.c_str());
        return false;
    }
    auto split_port = [](const std::string& s, std::string* node_id, std::string* port) -> bool {
        const size_t dot = s.find('.');
        if (dot == std::string::npos || dot == 0 || dot + 1 >= s.size()) return false;
        *node_id = s.substr(0, dot);
        *port    = s.substr(dot + 1);
        return true;
    };
    for (const auto& jl : jlinks->arr) {
        const std::string from_s = jl->get("from") ? jl->get("from")->str_or("") : "";
        const std::string to_s   = jl->get("to")   ? jl->get("to")->str_or("")   : "";
        std::string fn, fp, tn, tp;
        if (!split_port(from_s, &fn, &fp) || !split_port(to_s, &tn, &tp)) {
            std::fprintf(stderr, "ERROR graph.bad_link %s -> %s\n",
                         from_s.c_str(), to_s.c_str());
            return false;
        }
        if (!id_to_idx.count(fn) || !id_to_idx.count(tn)) {
            std::fprintf(stderr, "ERROR graph.link_unknown_node %s -> %s\n",
                         fn.c_str(), tn.c_str());
            return false;
        }
        const int src_ti = static_cast<int>(nodes_[static_cast<size_t>(id_to_idx[fn])].type);
        if (!valid_from_port(src_ti, fp)) {
            std::fprintf(stderr, "ERROR graph.bad_from_port %s (type %s no port '%s')\n",
                         from_s.c_str(), type_name(src_ti), fp.c_str());
            return false;
        }
        Node& to_node = nodes_[static_cast<size_t>(id_to_idx[tn])];
        const int dst_ti = static_cast<int>(to_node.type);
        if (!valid_input_port(dst_ti, tp)) {
            std::fprintf(stderr, "ERROR graph.bad_to_port %s (type %s no port '%s')\n",
                         to_s.c_str(), type_name(dst_ti), tp.c_str());
            return false;
        }
        if (to_node.inputs.count(tp)) {
            std::fprintf(stderr, "ERROR graph.multi_wire %s\n", to_s.c_str());
            return false;
        }
        to_node.inputs[tp] = {id_to_idx[fn], fp};
    }

    /* ---- topo sort (Kahn) ---- */
    const size_t n_nodes = nodes_.size();
    std::vector<int> indegree(n_nodes, 0);
    std::vector<std::vector<int>> adj(n_nodes);
    for (size_t i = 0; i < n_nodes; i++) {
        for (const auto& inp : nodes_[i].inputs) {
            adj[static_cast<size_t>(inp.second.node_idx)].push_back(static_cast<int>(i));
            indegree[i]++;
        }
    }
    std::vector<int> queue;
    for (size_t i = 0; i < n_nodes; i++)
        if (indegree[i] == 0) queue.push_back(static_cast<int>(i));
    while (!queue.empty()) {
        const int u = queue.back();
        queue.pop_back();
        order_.push_back(u);
        for (const int v : adj[static_cast<size_t>(u)])
            if (--indegree[static_cast<size_t>(v)] == 0) queue.push_back(v);
    }
    if (order_.size() != n_nodes) {
        std::fprintf(stderr, "ERROR graph.cycle %s\n", name.c_str());
        order_.clear();
        nodes_.clear();
        return false;
    }

    std::set<int> ai_set;
    for (const Node& nd : nodes_)
        if (nd.type == NodeType::AI_INPUT)
            ai_set.insert(static_cast<int>(nd.num_params.at("channel")));
    used_ai_.assign(ai_set.begin(), ai_set.end());

    /* COR-011: parse modbus section → gán proto_ext_idx cho Protocol nodes.
     * Thứ tự: rtu[0].points, rtu[1].points, …, tcp[0].points, tcp[1].points, …
     * Phải khớp với thứ tự ext_cache iobus cấp phát (RTU slaves rồi TCP slaves). */
    if (const json::Value* jmod = root->get("modbus")) {
        int ext_idx = 0;
        for (const char* section : {"rtu", "tcp"}) {
            const json::Value* jbus_arr = jmod->get(section);
            if (!jbus_arr || !jbus_arr->is_arr()) continue;
            for (const auto& jbus : jbus_arr->arr) {
                const json::Value* jpts = jbus->get("points");
                if (!jpts || !jpts->is_arr()) continue;
                for (const auto& jpt : jpts->arr) {
                    const std::string nid = jpt->get("node")
                        ? jpt->get("node")->str_or("") : "";
                    if (!nid.empty()) {
                        const auto it = id_to_idx.find(nid);
                        if (it != id_to_idx.end()) {
                            Node& nd = nodes_[static_cast<size_t>(it->second)];
                            if (nd.proto_ext_idx >= 0) {
                                std::fprintf(stderr, "WARN  graph.proto_ext_idx_duplicate"
                                             " node=%s prev=%d new=%d"
                                             " — check modbus section in graph.json\n",
                                             nid.c_str(), nd.proto_ext_idx, ext_idx);
                            }
                            nd.proto_ext_idx = ext_idx;
                        }
                    }
                    ext_idx++;
                }
            }
        }
    }

    src_cached_        = src;
    declared_scan_ms_  = parsed_scan_ms;
    scan_ms_           = parsed_scan_ms;
    reset_runtime_state();
    loaded_ = true;
    std::fprintf(stderr, "INFO  graph.loaded %s nodes=%zu scan_ms=%u ai=%zu\n",
                 name.c_str(), n_nodes, scan_ms_, used_ai_.size());
    return true;
}

bool GraphRuntime::reload(const std::string& path)
{
    std::string src;
    if (!read_file_content(path, &src)) {
        if (loaded_)
            std::fprintf(stderr, "WARN  graph.reload_keep_old %s\n", path.c_str());
        else
            std::fprintf(stderr, "INFO  graph.none %s\n", path.c_str());
        return loaded_ ? false : true;
    }
    if (loaded_ && src == src_cached_) {
        std::fprintf(stderr, "INFO  graph.reload_unchanged %s\n", path.c_str());
        return true;
    }
    GraphRuntime fresh;
    if (!fresh.load_string(src, path)) {
        std::fprintf(stderr, "WARN  graph.reload_keep_old %s (validate fail)\n", path.c_str());
        return false;
    }
    *this = std::move(fresh);
    return true;
}

void GraphRuntime::sync_actual_scan_ms(uint32_t actual_ms)
{
    if (actual_ms == 0) return;
    if (loaded_ && actual_ms != declared_scan_ms_)
        std::fprintf(stderr,
                     "WARN  graph.scan_ms_mismatch declared=%u actual=%u -> dt=actual\n",
                     declared_scan_ms_, actual_ms);
    scan_ms_ = actual_ms;
}

void GraphRuntime::reset_runtime_state()
{
    for (Node& n : nodes_) {
        n.outputs.clear();
        n.pid_integral  = 0.0f;
        n.pid_prev_pv   = 0.0f;
        n.pid_first     = true;
        n.cmp_state     = false;
        n.acc_s         = 0.0f;
        n.il_tripped    = false;
        n.rt_seconds    = 0.0;
        n.rt_prev_reset = false;
        n.pc_count_raw  = 0;
        n.pc_prev_pulse = false;
        n.pc_prev_reset = false;
        n.pc_last_di    = 0;
        n.pc_di_init    = false;
    }
    dirty_ = false;
}

/* ---- COR-011: ext snapshot ---- */

void GraphRuntime::feed_ext_snapshot(const kx_ext_point_t* pts, uint16_t count)
{
    const uint16_t n = (count < KX_N_EXT) ? count : static_cast<uint16_t>(KX_N_EXT);
    for (uint16_t i = 0; i < n; i++) ext_snapshot_[i] = pts[i];
    ext_snap_count_ = n;
}

void GraphRuntime::apply_ext_writes(kx_plc_shm_t* shm) const
{
    if (!shm || !loaded_) return;
    KX_WRITE_BEGIN(shm);
    for (const Node& n : nodes_) {
        if (n.type != NodeType::MODBUS_RTU_WRITE) continue;
        if (n.proto_ext_idx < 0 || n.proto_ext_idx >= shm->ext_count) continue;
        const auto it = n.outputs.find("_setpoint");
        if (it == n.outputs.end()) continue;
        shm->ext[n.proto_ext_idx].setpoint = it->second;
        shm->ext[n.proto_ext_idx].dirty    = 1;
    }
    KX_WRITE_END(shm);
}

/* ---- execute ---- */

void GraphRuntime::execute(PointTable& table, PriorityResolver& resolver)
{
    if (!loaded_) return;
    for (const int idx : order_) {
        Node& n = nodes_[static_cast<size_t>(idx)];
        compute(n, table, resolver);
    }
}

/* ---- compute: writes to n.outputs ---- */

void GraphRuntime::compute(Node& n, PointTable& table, PriorityResolver& resolver)
{
    auto in = [&](const char* port) -> float {
        const auto it = n.inputs.find(port);
        if (it == n.inputs.end()) return 0.0f;
        const Node& src = nodes_[static_cast<size_t>(it->second.node_idx)];
        const auto oit = src.outputs.find(it->second.src_port);
        return (oit == src.outputs.end()) ? 0.0f : oit->second;
    };
    auto p = [&](const char* key, double dflt) -> double {
        const auto it = n.num_params.find(key);
        return (it == n.num_params.end()) ? dflt : it->second;
    };

    const float dt = static_cast<float>(scan_ms_) / 1000.0f;

    switch (n.type) {

    case NodeType::AI_INPUT:
        n.outputs["out"] = table.get({PointKind::AI, static_cast<int>(p("channel",0))}).value;
        return;

    case NodeType::DI_INPUT: {
        const float v = table.get({PointKind::BI, static_cast<int>(p("channel",0))}).value;
        const bool  b = (v != 0.0f) != (p("invert",0) != 0.0);
        n.outputs["out"] = b ? 1.0f : 0.0f;
        return;
    }

    case NodeType::SETPOINT:
        n.outputs["out"] = static_cast<float>(p("default", 0.0));
        return;

    case NodeType::AND_:
        n.outputs["out"] = (in("a") != 0.0f && in("b") != 0.0f) ? 1.0f : 0.0f;
        return;

    case NodeType::OR_:
        n.outputs["out"] = (in("a") != 0.0f || in("b") != 0.0f) ? 1.0f : 0.0f;
        return;

    case NodeType::NOT_:
        n.outputs["out"] = (in("in") != 0.0f) ? 0.0f : 1.0f;
        return;

    case NodeType::CMP_GT: {
        const float a = in("a"), b = in("b");
        const float h = static_cast<float>(p("hysteresis", 0.0));
        n.cmp_state = n.cmp_state ? (a > b - h) : (a > b);
        n.outputs["out"] = n.cmp_state ? 1.0f : 0.0f;
        return;
    }

    case NodeType::CMP_LT: {
        const float a = in("a"), b = in("b");
        const float h = static_cast<float>(p("hysteresis", 0.0));
        n.cmp_state = n.cmp_state ? (a < b + h) : (a < b);
        n.outputs["out"] = n.cmp_state ? 1.0f : 0.0f;
        return;
    }

    case NodeType::SCALE: {
        const float in_lo  = static_cast<float>(p("in_lo", 0));
        const float in_hi  = static_cast<float>(p("in_hi", 100));
        const float out_lo = static_cast<float>(p("out_lo", 0));
        const float out_hi = static_cast<float>(p("out_hi", 100));
        if (in_hi == in_lo) { n.outputs["out"] = out_lo; return; }
        const float t = (in("in") - in_lo) / (in_hi - in_lo);
        n.outputs["out"] = out_lo + t * (out_hi - out_lo);
        return;
    }

    case NodeType::LIMIT: {
        const float lo = static_cast<float>(p("lo", 0));
        const float hi = static_cast<float>(p("hi", 100));
        n.outputs["out"] = std::min(std::max(in("in"), lo), hi);
        return;
    }

    case NodeType::PID: {
        const float kp = static_cast<float>(p("kp", 1.0));
        const float ki = static_cast<float>(p("ki", 0.0));
        const float kd = static_cast<float>(p("kd", 0.0));
        const float lo = static_cast<float>(p("out_lo", 0.0));
        const float hi = static_cast<float>(p("out_hi", 100.0));
        const bool reverse = (n.str_param == "reverse");
        const float pv = in("pv"), sp = in("sp");
        const float e  = reverse ? (pv - sp) : (sp - pv);
        const float d  = (n.pid_first || dt <= 0.0f) ? 0.0f
                       : -kd * (pv - n.pid_prev_pv) / dt;
        n.pid_prev_pv = pv;
        n.pid_first   = false;
        float u = kp * e + n.pid_integral + d;
        const bool sat_hi = u > hi, sat_lo = u < lo;
        if (!(sat_hi && e > 0.0f) && !(sat_lo && e < 0.0f))
            n.pid_integral += ki * e * dt;
        u = kp * e + n.pid_integral + d;
        n.outputs["out"] = std::min(std::max(u, lo), hi);
        return;
    }

    case NodeType::AO_OUTPUT: {
        const int ch = static_cast<int>(p("channel", 0));
        const float lo  = static_cast<float>(p("limit_lo", 0.0));
        const float hi  = static_cast<float>(p("limit_hi", 100.0));
        const float pct = std::min(std::max(in("in"), lo), hi);
        const bool current_mode = ch >= 0 && ch < KX_N_AO && ao_modes_[ch] == 1;
        const float eng = current_mode ? 4.0f + pct / 100.0f * 16.0f
                                       : pct / 100.0f * 10.0f;
        resolver.set_ao(PRIO_LOCAL_LOGIC, ch, eng);
        n.outputs["out"] = pct;
        return;
    }

    case NodeType::DO_OUTPUT:
        resolver.set_do(PRIO_LOCAL_LOGIC, static_cast<int>(p("channel",0)), in("in") != 0.0f);
        n.outputs["out"] = in("in");
        return;

    /* ---- 10 new types (COR-009) ---- */

    case NodeType::MANUAL_AUTO:
        n.outputs["out"] = (in("sel") != 0.0f) ? in("manual") : in("auto");
        return;

    case NodeType::ON_DELAY: {
        const float delay = static_cast<float>(p("delay_s", 0.0));
        if (in("in") != 0.0f) {
            n.acc_s += dt;
            n.outputs["out"] = (n.acc_s >= delay) ? 1.0f : 0.0f;
        } else {
            n.acc_s = 0.0f;
            n.outputs["out"] = 0.0f;
        }
        return;
    }

    case NodeType::OFF_DELAY: {
        const float delay = static_cast<float>(p("delay_s", 0.0));
        if (in("in") != 0.0f) {
            n.acc_s = 0.0f;
            n.outputs["out"] = 1.0f;
        } else {
            n.acc_s += dt;
            n.outputs["out"] = (n.acc_s < delay) ? 1.0f : 0.0f;
        }
        return;
    }

    case NodeType::INTERLOCK: {
        const bool permit  = in("permit")  != 0.0f;
        const bool request = in("request") != 0.0f;
        const bool latch_p = p("latch", 0) != 0.0;
        if (!permit) {
            n.il_tripped = true;
        } else if (n.il_tripped && latch_p) {
            if (!request) n.il_tripped = false;   /* manual reset: rút request -> clear */
        } else {
            n.il_tripped = false;
        }
        n.outputs["out"]     = (permit && !n.il_tripped && request) ? 1.0f : 0.0f;
        n.outputs["tripped"] = n.il_tripped ? 1.0f : 0.0f;
        return;
    }

    case NodeType::RUNTIME_COUNTER: {
        const bool run_in   = in("run")   != 0.0f;
        const bool reset_in = in("reset") != 0.0f;
        const double maint = p("maint_hours", 0.0);
        const RuntimeCounterStep rc =
            runtime_counter_step(run_in, reset_in, dt, maint, &n.rt_seconds, &n.rt_prev_reset);
        if (rc.dirty) dirty_ = true;
        n.outputs["hours"] = static_cast<float>(rc.hours);
        n.outputs["alarm"] = rc.alarm ? 1.0f : 0.0f;
        return;
    }

    case NodeType::PULSE_COUNTER: {
        const bool has_ch   = n.num_params.count("channel") > 0;
        const bool reset_in = in("reset") != 0.0f;
        if (reset_in && !n.pc_prev_reset) {
            if (n.pc_count_raw != 0) dirty_ = true;
            n.pc_count_raw = 0;
            n.pc_di_init   = false;
        }
        n.pc_prev_reset = reset_in;

        if (!reset_in) {
            if (has_ch) {
                const int ch = static_cast<int>(p("channel", 0));
                const uint32_t cur = table.di_counter(ch);
                if (!n.pc_di_init) {
                    n.pc_last_di = cur;
                    n.pc_di_init = true;
                } else {
                    if (cur >= n.pc_last_di) {
                        const uint32_t delta = cur - n.pc_last_di;
                        if (delta > 0) { n.pc_count_raw += delta; dirty_ = true; }
                    } else {
                        std::fprintf(stderr, "WARN  graph.pulse_counter.wrap node=%s ch=%d\n",
                                     n.id.c_str(), ch);
                    }
                    n.pc_last_di = cur;
                }
            } else {
                const bool pulse = in("pulse") != 0.0f;
                if (pulse && !n.pc_prev_pulse) { n.pc_count_raw++; dirty_ = true; }
                n.pc_prev_pulse = pulse;
            }
        }

        const double scale    = p("scale", 1.0);
        const double rollover = p("rollover", 0.0);
        double count = static_cast<double>(n.pc_count_raw) * scale;
        if (rollover > 0.0 && count >= rollover) {
            n.pc_count_raw = 0;
            count = 0.0;
            dirty_ = true;
        }
        n.outputs["out"] = static_cast<float>(count);
        return;
    }

    case NodeType::SAFE_STATE: {
        const float safe_v = static_cast<float>(p("safe_value", 0.0));
        n.outputs["out"] = (in("good") != 0.0f) ? in("in") : safe_v;
        return;
    }

    case NodeType::ALARM_HIGH: {
        const float pv    = in("pv");
        const float limit = static_cast<float>(p("limit", 100.0));
        const float hyst  = static_cast<float>(p("hysteresis", 0.0));
        n.cmp_state = alarm_high_step(pv, limit, hyst, n.cmp_state);
        n.outputs["out"] = n.cmp_state ? 1.0f : 0.0f;
        return;
    }

    case NodeType::ALARM_LOW: {
        const float pv    = in("pv");
        const float limit = static_cast<float>(p("limit", 0.0));
        const float hyst  = static_cast<float>(p("hysteresis", 0.0));
        n.cmp_state = alarm_low_step(pv, limit, hyst, n.cmp_state);
        n.outputs["out"] = n.cmp_state ? 1.0f : 0.0f;
        return;
    }

    case NodeType::ALARM_DELAY: {
        /* cmp_state = current output; acc_s shared cho ca on/off accumulator */
        const float on_d  = static_cast<float>(p("on_delay_s",  0.0));
        const float off_d = static_cast<float>(p("off_delay_s", 0.0));
        n.cmp_state = alarm_delay_step(in("in") != 0.0f, dt, on_d, off_d,
                                       &n.cmp_state, &n.acc_s);
        n.outputs["out"] = n.cmp_state ? 1.0f : 0.0f;
        return;
    }

    /* ---- COR-011 Protocol nodes ---- */

    case NodeType::MODBUS_RTU_READ:
    case NodeType::MODBUS_TCP_READ: {
        const float scale    = static_cast<float>(p("scale",    1.0));
        const float fallback = static_cast<float>(p("fallback", 0.0));
        const int   eidx     = n.proto_ext_idx;
        if (eidx < 0 || eidx >= ext_snap_count_) {
            n.outputs["out"] = fallback;
            return;
        }
        const kx_ext_point_t& pt = ext_snapshot_[eidx];
        if (pt.quality == KX_Q_BAD || !pt.online) {
            n.outputs["out"] = fallback;
        } else {
            n.outputs["out"] = pt.value * scale;
        }
        return;
    }

    case NodeType::MODBUS_RTU_WRITE: {
        /* Sink: stash input value for apply_ext_writes() */
        n.outputs["_setpoint"] = in("in");
        return;
    }

    case NodeType::BACNET_AV: {
        const int inst = static_cast<int>(p("instance", 0)) - 1;  /* 0-based */
        if (inst < 0 || inst >= KX_N_AV) return;
        /* If "in" wired: write AV from graph at PointSource::GRAPH */
        if (n.inputs.count("in"))
            table.set_virtual({PointKind::AV, inst}, in("in"), PointSource::GRAPH);
        /* Output: current AV value (after any write from web/bacnet/graph) */
        n.outputs["out"] = table.get({PointKind::AV, inst}).value;
        return;
    }

    case NodeType::BACNET_BV: {
        const int inst = static_cast<int>(p("instance", 0)) - 1;
        if (inst < 0 || inst >= KX_N_BV) return;
        if (n.inputs.count("in"))
            table.set_virtual({PointKind::BV, inst}, in("in"), PointSource::GRAPH);
        n.outputs["out"] = table.get({PointKind::BV, inst}).value;
        return;
    }

    } /* switch */
}

/* ---- persist state (COR-010) ---- */

std::vector<PersistEntry> GraphRuntime::get_persist_state() const
{
    std::vector<PersistEntry> result;
    for (const Node& n : nodes_) {
        if (n.type == NodeType::RUNTIME_COUNTER)
            result.push_back({n.id, "RuntimeCounter", n.rt_seconds, 0});
        else if (n.type == NodeType::PULSE_COUNTER)
            result.push_back({n.id, "PulseCounter", 0.0, n.pc_count_raw});
    }
    return result;
}

void GraphRuntime::restore_persist_state(const std::vector<PersistEntry>& entries)
{
    for (const PersistEntry& e : entries) {
        for (Node& n : nodes_) {
            if (n.id != e.id) continue;
            if (n.type == NodeType::RUNTIME_COUNTER && e.type == "RuntimeCounter") {
                n.rt_seconds = e.run_seconds;
                std::fprintf(stderr, "INFO  graph.restore node=%s hours=%.2f\n",
                             n.id.c_str(), e.run_seconds / 3600.0);
            } else if (n.type == NodeType::PULSE_COUNTER && e.type == "PulseCounter") {
                n.pc_count_raw = e.count_raw;
                std::fprintf(stderr, "INFO  graph.restore node=%s count_raw=%" PRIu64 "\n",
                             n.id.c_str(), e.count_raw);
            } else {
                std::fprintf(stderr,
                             "WARN  graph.restore_skip node=%s: snap=%s node=%s (id+type mismatch)\n",
                             n.id.c_str(), e.type.c_str(),
                             type_name(static_cast<int>(n.type)));
            }
            break;
        }
    }
}

} // namespace core
