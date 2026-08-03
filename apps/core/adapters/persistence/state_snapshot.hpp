/**
 * @file  state_snapshot.hpp
 * @brief Persist state.snap cho RuntimeCounter/PulseCounter (COR-010).
 *        Format JSON version=1 tại /data/mkddc/state.snap.
 *        Ghi atomic qua tmp + rename(). Parse fail / version lạ → trả {} + WARN.
 */
#ifndef CORE_STATE_SNAPSHOT_HPP
#define CORE_STATE_SNAPSHOT_HPP

#include <string>
#include <vector>

#include "graph/graph_runtime.hpp"

namespace core {

class StateSnapshot {
public:
    explicit StateSnapshot(const std::string& path = "/data/mkddc/state.snap");

    /* Đọc từ đĩa. Parse fail / missing → trả {} + WARN. Không fail-fast. */
    std::vector<PersistEntry> load() const;

    /* Ghi atomic (tmp + rename). Trả false nếu lỗi write. */
    bool save(const std::vector<PersistEntry>& entries) const;

private:
    std::string path_;
    std::string tmp_path_;
};

} // namespace core

#endif /* CORE_STATE_SNAPSHOT_HPP */
