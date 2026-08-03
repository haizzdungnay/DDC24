#ifndef CORE_PORTS_OUTPUT_COMMAND_HPP
#define CORE_PORTS_OUTPUT_COMMAND_HPP

#include "priority/priority_resolver.hpp"

namespace core {

/** Port xuất command đã qua priority/safe-state; adapter chịu trách nhiệm IPC. */
class OutputCommandPort {
public:
    virtual ~OutputCommandPort() = default;
    virtual void write(const OutputCmd& out) = 0;
};

} // namespace core

#endif /* CORE_PORTS_OUTPUT_COMMAND_HPP */
