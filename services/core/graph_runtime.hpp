/**
 * @file  graph_runtime.hpp
 * @brief Graph engine Rev A tối thiểu (GRAPH_SCHEMA IF-GRAPH-MK-DDC-24-VI):
 *        load graph.json → validate (id duy nhất, type hợp lệ, 1 wire/input,
 *        acyclic) → topo order → execute mỗi scan → ghi output qua
 *        PriorityResolver MỨC 5 (local logic). KHÔNG ghi thẳng IO.
 *
 *        Component set Rev A core (SW_COMPONENT_LIBRARY): AI_Input, DI_Input,
 *        Setpoint, AND, OR, NOT, Compare_GT, Compare_LT, Scale, Limit, PID,
 *        AO_Output, DO_Output. Type ngoài danh sách → load fail (giữ no-graph).
 */
#ifndef CORE_GRAPH_RUNTIME_HPP
#define CORE_GRAPH_RUNTIME_HPP

#include <map>
#include <string>
#include <vector>

#include "point_table.hpp"
#include "priority_resolver.hpp"

namespace core {

class GraphRuntime {
public:
    /* Nạp + validate graph.json. Fail → loaded()=false (nguồn logic inactive). */
    bool load(const std::string& path);
    /* Nạp từ chuỗi JSON (cho unit test). */
    bool load_string(const std::string& src, const std::string& name = "<inline>");
    bool loaded() const { return loaded_; }

    /* Reload atomic cho SIGHUP (COR-008) — KHÁC load(): load/load_string clear
     * member ngay đầu hàm (fail là mất graph cũ — chỉ dùng lúc boot).
     * reload() nạp vào instance tạm, CHỈ swap khi validate pass:
     *   - file thiếu / JSON hỏng → GIỮ graph cũ, return false
     *   - nội dung không đổi     → giữ nguyên state node (PID integral), return true */
    bool reload(const std::string& path);

    /* Chạy 1 scan theo topo order; sink ghi resolver mức PRIO_LOCAL_LOGIC. */
    void execute(const PointTable& table, PriorityResolver& resolver);

    /* Kênh AI (0-based) graph đang dùng — đầu vào cho safety trigger T6 (07 §5.2). */
    const std::vector<int>& used_ai_channels() const { return used_ai_; }

    /* scan_ms KHAI BÁO trong graph.json (device.scan_ms) — ý đồ của engineer. */
    uint32_t declared_scan_ms() const { return declared_scan_ms_; }

    /* NGUỒN SỰ THẬT DUY NHẤT cho dt: chu kỳ scan THỰC của core scan loop.
     * ScanLoop::run() gọi hàm này trước khi vào vòng lặp — PID/logic luôn tính
     * theo chu kỳ thật, không bao giờ theo giá trị khai báo lệch. Lệch → WARN. */
    void sync_actual_scan_ms(uint32_t actual_ms);

    /* scan_ms hiệu lực mà dt đang dùng (= actual sau khi sync). */
    uint32_t effective_scan_ms() const { return scan_ms_; }

private:
    enum class NodeType {
        AI_INPUT, DI_INPUT, SETPOINT,
        AND_, OR_, NOT_, CMP_GT, CMP_LT,
        SCALE, LIMIT, PID,
        AO_OUTPUT, DO_OUTPUT
    };

    struct Node {
        std::string id;
        NodeType type;
        std::map<std::string, double> num_params;
        std::string str_param;                    /* direction / mode */
        std::map<std::string, int> inputs;        /* port → index node nguồn */
        /* runtime state */
        float out = 0.0f;
        float pid_integral = 0.0f;
        float pid_prev_pv = 0.0f;
        bool  pid_first = true;
        bool  cmp_state = false;                  /* hysteresis */
    };

    float compute(Node& n, const PointTable& table, PriorityResolver& resolver);
    void  reset_runtime_state();

    bool loaded_ = false;
    size_t src_hash_ = 0;                /* hash source đã load — reload() so sánh */
    uint32_t scan_ms_ = 1000;            /* hiệu lực (dt) — sync theo core */
    uint32_t declared_scan_ms_ = 1000;   /* khai báo trong graph.json */
    std::vector<Node> nodes_;
    std::vector<int> order_;                      /* topo order (index vào nodes_) */
    std::vector<int> used_ai_;
};

} // namespace core

#endif /* CORE_GRAPH_RUNTIME_HPP */
