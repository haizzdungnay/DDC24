#ifndef HMI_API_CLIENT_HPP
#define HMI_API_CLIENT_HPP

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>

#include <nlohmann/json.hpp>

namespace hmi {

struct ApiReply {
    bool transport_ok = false;
    std::string request_id;
    std::string result;
    std::string reason_code;
    std::string message;
    nlohmann::json payload;

    bool accepted() const { return transport_ok && result == "accepted"; }
};

class HmiApiClient {
public:
    explicit HmiApiClient(std::string socket_path = "/run/mkddc/hmi-api.sock");

    void set_socket_path(std::string path);
    std::string socket_path() const;
    bool available() const;
    bool authenticated() const;
    std::string username() const;
    std::string role() const;
    bool can_control(const std::string& point_id,
                     const std::string& action = {}) const;

    ApiReply login(const std::string& username, const std::string& password);
    ApiReply logout();
    ApiReply request(const std::string& action, nlohmann::json fields = {},
                     bool authenticated = true);
    ApiReply command(const std::string& action, const std::string& point_id,
                     double value, const std::string& mode = {},
                     const std::string& reason = {}, uint32_t ttl_s = 0);

private:
    mutable std::mutex mutex_;
    std::string socket_path_;
    std::string token_;
    std::string username_;
    std::string role_;
    bool broker_available_ = false;
    uint32_t session_idle_s_ = 0;
    std::chrono::steady_clock::time_point session_expires_{};
    std::unordered_map<std::string, std::unordered_set<std::string>> point_actions_;
    std::atomic<uint64_t> sequence_{0};

    std::string next_request_id();
    void clear_session();
    void set_available(bool value);
};

} // namespace hmi

#endif
