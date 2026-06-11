/**
 * @file  graph_runtime.hpp
 * @brief STUB Rev A đầu (07 §0 #10): không nạp graph, nguồn "logic" luôn inactive.
 *        Interface THẬT — thay implementation sau, KHÔNG đổi API (07 §10.6).
 */
#ifndef CORE_GRAPH_RUNTIME_HPP
#define CORE_GRAPH_RUNTIME_HPP

#include <string>

#include "point_table.hpp"
#include "priority_resolver.hpp"

namespace core {

class GraphRuntime {
public:
    /* Nạp graph.json — stub: luôn false (chưa có graph hợp lệ). */
    bool load(const std::string& path);
    bool loaded() const { return loaded_; }

    /* Chạy graph theo topo order, ghi output qua resolver mức 5 — stub: no-op. */
    void execute(const PointTable& table, PriorityResolver& resolver);

private:
    bool loaded_ = false;
};

} // namespace core

#endif /* CORE_GRAPH_RUNTIME_HPP */
