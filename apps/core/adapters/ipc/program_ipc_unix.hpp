#ifndef CORE_ADAPTERS_IPC_PROGRAM_IPC_UNIX_HPP
#define CORE_ADAPTERS_IPC_PROGRAM_IPC_UNIX_HPP

#include <atomic>
#include <string>

#include "programming/program_ipc_server.hpp"

namespace core::programming {

class ProgramIpcUnixEndpoint {
public:
    ~ProgramIpcUnixEndpoint();
    bool open(const std::string& path, std::string* error);
    void run(ProgramIpcServer* server, const std::atomic<bool>* shutdown) noexcept;
    void close() noexcept;

private:
    int listener_ = -1;
    std::string path_;
};

} // namespace core::programming

#endif
