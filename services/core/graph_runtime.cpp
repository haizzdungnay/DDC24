#include "graph_runtime.hpp"

#include <cstdio>

namespace core {

bool GraphRuntime::load(const std::string& path)
{
    /* STUB Rev A: chưa nạp graph — nguồn logic (mức 5) luôn inactive */
    std::fprintf(stderr, "INFO  graph.stub no graph loaded (path=%s)\n", path.c_str());
    loaded_ = false;
    return false;
}

void GraphRuntime::execute(const PointTable& table, PriorityResolver& resolver)
{
    (void)table;
    (void)resolver;
    /* STUB: no-op — graph engine Rev A.1 */
}

} // namespace core
