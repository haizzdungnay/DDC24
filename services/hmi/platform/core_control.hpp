#ifndef HMI_CORE_CONTROL_HPP
#define HMI_CORE_CONTROL_HPP

#include "data/point_db.hpp"

#include <string>

namespace hmi {

class CoreControl {
public:
    explicit CoreControl(std::string socket_path = "/run/mkddc/core.sock")
        : socket_path_(std::move(socket_path)) {}

    /* Apply every configured AO/DO safe_state through the existing core IPC. */
    bool apply_safe_states(const PointDb& db) const;
    bool safe_reboot(const PointDb& db, bool allow_reboot) const;

    static bool signal_process(const char* pidfile, const char* expected_name,
                               int signal_number);
    static bool reload_services();
    static bool restart_services();

private:
    std::string socket_path_;
};

} // namespace hmi
#endif
