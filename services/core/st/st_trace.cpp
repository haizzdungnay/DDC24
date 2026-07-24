#include "st/st_trace.hpp"

#include <utility>

namespace core {

void StTraceLog::push(StTraceEvent event)
{
    if (events_.size() >= capacity_) {
        events_.pop_front();
        dropped_++;
    }
    events_.push_back(std::move(event));
}

} // namespace core
