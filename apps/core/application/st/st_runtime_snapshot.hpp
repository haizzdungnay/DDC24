#ifndef CORE_ST_RUNTIME_SNAPSHOT_HPP
#define CORE_ST_RUNTIME_SNAPSHOT_HPP

#include "graph/runtime_point_snapshot.hpp"

namespace core {

class StScheduler;

/* Điền task/program read-back từ scheduler vào point_snapshot dùng chung cho
 * bootstrap production và simulator E2E. Tách helper để simulator không dựng
 * một contract trạng thái thứ hai rồi trôi khỏi đường chạy trên board. */
void st_populate_runtime_snapshot(const StScheduler* scheduler, bool program_owner,
                                  RuntimePointSnapshot* snapshot) noexcept;

} // namespace core

#endif /* CORE_ST_RUNTIME_SNAPSHOT_HPP */
