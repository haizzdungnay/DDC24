#include "graph_runtime.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <set>
#include <sstream>

#include "json_min.hpp"

namespace core {

namespace {

bool type_from_string(const std::string& s, int* out)
{
    static const std::map<std::string, int> kTypes = {
        {"AI_Input", 0}, {"DI_Input", 1}, {"Setpoint", 2},
        {"AND", 3}, {"OR", 4}, {"NOT", 5},
        {"Compare_GT", 6}, {"Compare_LT", 7},
        {"Scale", 8}, {"Limit", 9}, {"PID", 10},
        {"AO_Output", 11}, {"DO_Output", 12},
    };
    auto it = kTypes.find(s);
    if (it == kTypes.end()) return false;
    *out = it->second;
    return true;
}

/* port input hợp lệ theo type (validate wire `to`) */
bool valid_input_port(int type, const std::string& port)
{
    switch (type) {
    case 3: case 4:            return port == "a" || port == "b";          /* AND/OR */
    case 5:                    return port == "in";                        /* NOT */
    case 6: case 7:            return port == "a" || port == "b";          /* CMP */
    case 8: case 9:            return port == "in";                        /* Scale/Limit */
    case 10:                   return port == "pv" || port == "sp";        /* PID */
    case 11: case 12:          return port == "in";                        /* AO/DO_Output */
    default:                   return false;                               /* source node không có input */
    }
}

} // namespace

bool GraphRuntime::load(const std::string& path)
{
    std::ifstream f(path);
    if (!f.is_open()) {
        std::fprintf(stderr, "INFO  graph.none path=%s (nguồn logic inactive)\n", path.c_str());
        loaded_ = false;
        return false;
    }
    std::stringstream ss;
    ss << f.rdbuf();
    return load_string(ss.str(), path);
}

bool GraphRuntime::load_string(const std::string& src, const std::string& name)
{
    loaded_ = false;
    nodes_.clear();
    order_.clear();
    used_ai_.clear();

    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root || !root->is_obj()) {
        std::fprintf(stderr, "ERROR graph.bad_json %s (%s)\n", name.c_str(), err.c_str());
        return false;
    }

    /* schema_version phải khớp engine (GRAPH_SCHEMA §2) */
    const json::Value* ver = root->get("schema_version");
    if (!ver || ver->str_or("") != "1.0") {
        std::fprintf(stderr, "ERROR graph.schema_version %s (cần \"1.0\")\n", name.c_str());
        return false;
    }
    /* parse vào local — chỉ commit vào member khi TOÀN BỘ validate pass */
    uint32_t parsed_scan_ms = 1000;
    if (const json::Value* dev = root->get("device")) {
        const double ms = dev->get("scan_ms") ? dev->get("scan_ms")->num_or(1000) : 1000;
        /* Validate TRƯỚC khi cast (5e9 → cast uint32 là UB/wrap về 0 → busy-spin).
         * Max 2000ms: core là Type=notify WatchdogSec=3, kick 1 lần/scan (07 §9) —
         * scan dài hơn WatchdogSec → systemd kill-loop. */
        if (ms < 500 || ms > 2000) {
            std::fprintf(stderr, "ERROR graph.scan_ms=%g (hợp lệ 500..2000 —"
                                 " watchdog budget WatchdogSec=3)\n", ms);
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
            std::fprintf(stderr, "ERROR graph.bad_node id=%s type=%s\n", n.id.c_str(), type_s.c_str());
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
                else if (kv.second->is_str()) n.str_param = kv.second->str;
            }
        }
        /* IO node bắt buộc có channel hợp lệ */
        if (n.type == NodeType::AI_INPUT || n.type == NodeType::DI_INPUT ||
            n.type == NodeType::AO_OUTPUT || n.type == NodeType::DO_OUTPUT) {
            const auto it = n.num_params.find("channel");
            const int max_ch = (n.type == NodeType::AI_INPUT) ? KX_N_UI
                             : (n.type == NodeType::DI_INPUT) ? KX_N_DI
                             : (n.type == NodeType::AO_OUTPUT) ? KX_N_AO : KX_N_DO;
            if (it == n.num_params.end() || it->second < 0 || it->second >= max_ch) {
                std::fprintf(stderr, "ERROR graph.bad_channel node=%s\n", n.id.c_str());
                return false;
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
    auto split_port = [](const std::string& s, std::string* node, std::string* port) {
        const size_t dot = s.find('.');
        if (dot == std::string::npos || dot == 0 || dot + 1 >= s.size()) return false;
        *node = s.substr(0, dot);
        *port = s.substr(dot + 1);
        return true;
    };
    for (const auto& jl : jlinks->arr) {
        const std::string from_s = jl->get("from") ? jl->get("from")->str_or("") : "";
        const std::string to_s = jl->get("to") ? jl->get("to")->str_or("") : "";
        std::string fn, fp, tn, tp;
        if (!split_port(from_s, &fn, &fp) || !split_port(to_s, &tn, &tp)) {
            std::fprintf(stderr, "ERROR graph.bad_link %s -> %s\n", from_s.c_str(), to_s.c_str());
            return false;
        }
        if (!id_to_idx.count(fn) || !id_to_idx.count(tn)) {
            std::fprintf(stderr, "ERROR graph.link_unknown_node %s -> %s\n", fn.c_str(), tn.c_str());
            return false;
        }
        if (fp != "out") {   /* component set Rev A: mọi node nguồn có đúng 1 output "out" */
            std::fprintf(stderr, "ERROR graph.bad_from_port %s\n", from_s.c_str());
            return false;
        }
        Node& to_node = nodes_[static_cast<size_t>(id_to_idx[tn])];
        if (!valid_input_port(static_cast<int>(to_node.type), tp)) {
            std::fprintf(stderr, "ERROR graph.bad_to_port %s (type không có port này)\n", to_s.c_str());
            return false;
        }
        if (to_node.inputs.count(tp)) {   /* 1 input nhận đúng 1 wire (validator #1/#2) */
            std::fprintf(stderr, "ERROR graph.multi_wire %s\n", to_s.c_str());
            return false;
        }
        to_node.inputs[tp] = id_to_idx[fn];
    }

    /* ---- topo sort (Kahn) — cycle → fail ---- */
    const size_t n_nodes = nodes_.size();
    std::vector<int> indegree(n_nodes, 0);
    std::vector<std::vector<int>> adj(n_nodes);
    for (size_t i = 0; i < n_nodes; i++) {
        for (const auto& in : nodes_[i].inputs) {
            adj[static_cast<size_t>(in.second)].push_back(static_cast<int>(i));
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
        std::fprintf(stderr, "ERROR graph.cycle %s (topo sort fail)\n", name.c_str());
        order_.clear();
        nodes_.clear();
        return false;
    }

    /* kênh AI graph dùng — cho T6 */
    std::set<int> ai_set;
    for (const Node& n : nodes_)
        if (n.type == NodeType::AI_INPUT)
            ai_set.insert(static_cast<int>(n.num_params.at("channel")));
    used_ai_.assign(ai_set.begin(), ai_set.end());

    /* mọi validate pass → giờ mới commit */
    src_cached_ = src;
    declared_scan_ms_ = parsed_scan_ms;
    scan_ms_ = parsed_scan_ms;   /* tạm — ScanLoop sync_actual_scan_ms() chốt dt thật */
    reset_runtime_state();
    loaded_ = true;
    std::fprintf(stderr, "INFO  graph.loaded %s nodes=%zu links_ok scan_ms=%u ai_used=%zu\n",
                 name.c_str(), n_nodes, scan_ms_, used_ai_.size());
    return true;
}

bool GraphRuntime::reload(const std::string& path)
{
    std::ifstream f(path);
    if (!f.is_open()) {
        if (loaded_) {
            std::fprintf(stderr,
                         "WARN  graph.reload_keep_old path=%s (không mở được file)\n",
                         path.c_str());
            return false;
        }
        std::fprintf(stderr, "INFO  graph.none path=%s (nguồn logic inactive)\n", path.c_str());
        return true;   /* trước không có graph, giờ vẫn không — không đổi gì */
    }
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string src = ss.str();
    if (loaded_ && src == src_cached_) {
        std::fprintf(stderr, "INFO  graph.reload_unchanged %s (giữ state node)\n", path.c_str());
        return true;
    }
    GraphRuntime fresh;
    if (!fresh.load_string(src, path)) {
        std::fprintf(stderr, "WARN  graph.reload_keep_old %s (validate fail)\n", path.c_str());
        return false;
    }
    *this = std::move(fresh);   /* commit — state node reset (chấp nhận Rev A, 07 §8) */
    return true;
}

void GraphRuntime::sync_actual_scan_ms(uint32_t actual_ms)
{
    if (actual_ms == 0) return;
    if (loaded_ && actual_ms != declared_scan_ms_)
        std::fprintf(stderr,
                     "WARN  graph.scan_ms_mismatch declared=%u actual=%u -> dt dùng actual"
                     " (1 nguồn sự thật = chu kỳ scan thật của core)\n",
                     declared_scan_ms_, actual_ms);
    scan_ms_ = actual_ms;
}

void GraphRuntime::reset_runtime_state()
{
    for (Node& n : nodes_) {
        n.out = 0.0f;
        n.pid_integral = 0.0f;
        n.pid_prev_pv = 0.0f;
        n.pid_first = true;
        n.cmp_state = false;
    }
}

float GraphRuntime::compute(Node& n, const PointTable& table, PriorityResolver& resolver)
{
    auto in = [&](const char* port) -> float {
        const auto it = n.inputs.find(port);
        return it == n.inputs.end() ? 0.0f : nodes_[static_cast<size_t>(it->second)].out;
    };
    auto p = [&](const char* key, double dflt) -> double {
        const auto it = n.num_params.find(key);
        return it == n.num_params.end() ? dflt : it->second;
    };

    switch (n.type) {
    case NodeType::AI_INPUT:
        return table.get({PointKind::AI, static_cast<int>(p("channel", 0))}).value;
    case NodeType::DI_INPUT: {
        const float v = table.get({PointKind::BI, static_cast<int>(p("channel", 0))}).value;
        const bool b = (v != 0.0f) != (p("invert", 0) != 0);
        return b ? 1.0f : 0.0f;
    }
    case NodeType::SETPOINT:
        return static_cast<float>(p("default", 0.0));
    case NodeType::AND_:
        return (in("a") != 0.0f && in("b") != 0.0f) ? 1.0f : 0.0f;
    case NodeType::OR_:
        return (in("a") != 0.0f || in("b") != 0.0f) ? 1.0f : 0.0f;
    case NodeType::NOT_:
        return (in("in") != 0.0f) ? 0.0f : 1.0f;
    case NodeType::CMP_GT: {
        const float a = in("a"), b = in("b");
        const float h = static_cast<float>(p("hysteresis", 0.0));
        if (n.cmp_state) n.cmp_state = (a > b - h);
        else             n.cmp_state = (a > b);
        return n.cmp_state ? 1.0f : 0.0f;
    }
    case NodeType::CMP_LT: {
        const float a = in("a"), b = in("b");
        const float h = static_cast<float>(p("hysteresis", 0.0));
        if (n.cmp_state) n.cmp_state = (a < b + h);
        else             n.cmp_state = (a < b);
        return n.cmp_state ? 1.0f : 0.0f;
    }
    case NodeType::SCALE: {
        const float in_lo = static_cast<float>(p("in_lo", 0)), in_hi = static_cast<float>(p("in_hi", 100));
        const float out_lo = static_cast<float>(p("out_lo", 0)), out_hi = static_cast<float>(p("out_hi", 100));
        if (in_hi == in_lo) return out_lo;
        const float t = (in("in") - in_lo) / (in_hi - in_lo);
        return out_lo + t * (out_hi - out_lo);
    }
    case NodeType::LIMIT: {
        const float lo = static_cast<float>(p("lo", 0)), hi = static_cast<float>(p("hi", 100));
        return std::min(std::max(in("in"), lo), hi);
    }
    case NodeType::PID: {
        /* PI(D) rời rạc, anti-windup bằng conditional integration */
        const float kp = static_cast<float>(p("kp", 1.0));
        const float ki = static_cast<float>(p("ki", 0.0));
        const float kd = static_cast<float>(p("kd", 0.0));
        const float lo = static_cast<float>(p("out_lo", 0.0));
        const float hi = static_cast<float>(p("out_hi", 100.0));
        const bool reverse = (n.str_param == "reverse");
        const float dt = static_cast<float>(scan_ms_) / 1000.0f;
        const float pv = in("pv"), sp = in("sp");
        const float e = reverse ? (pv - sp) : (sp - pv);

        const float d = (n.pid_first || dt <= 0.0f) ? 0.0f : -kd * (pv - n.pid_prev_pv) / dt;
        n.pid_prev_pv = pv;
        n.pid_first = false;

        float u = kp * e + n.pid_integral + d;
        const bool sat_hi = u > hi, sat_lo = u < lo;
        if (!(sat_hi && e > 0.0f) && !(sat_lo && e < 0.0f))
            n.pid_integral += ki * e * dt;
        u = kp * e + n.pid_integral + d;
        return std::min(std::max(u, lo), hi);
    }
    case NodeType::AO_OUTPUT: {
        /* in = % (PID out_lo/out_hi 0..100); clamp limit rồi convert % → eng theo mode */
        const float lo = static_cast<float>(p("limit_lo", 0.0));
        const float hi = static_cast<float>(p("limit_hi", 100.0));
        const float pct = std::min(std::max(in("in"), lo), hi);
        const float eng = (n.str_param == "4-20mA") ? 4.0f + pct / 100.0f * 16.0f
                                                    : pct / 100.0f * 10.0f;
        resolver.set_ao(PRIO_LOCAL_LOGIC, static_cast<int>(p("channel", 0)), eng);
        return pct;
    }
    case NodeType::DO_OUTPUT:
        resolver.set_do(PRIO_LOCAL_LOGIC, static_cast<int>(p("channel", 0)), in("in") != 0.0f);
        return in("in");
    }
    return 0.0f;
}

void GraphRuntime::execute(const PointTable& table, PriorityResolver& resolver)
{
    if (!loaded_) return;   /* không có graph → nguồn logic inactive */
    for (const int idx : order_) {
        Node& n = nodes_[static_cast<size_t>(idx)];
        n.out = compute(n, table, resolver);
    }
}

} // namespace core
