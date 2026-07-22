#ifndef MKDDC_NETCFG_HPP
#define MKDDC_NETCFG_HPP

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace netcfg {

constexpr int kProtocolVersion = 1;
constexpr size_t kMaxFrameBytes = 8192;
constexpr uint32_t kRollbackMaxSeconds = 120;

struct Candidate {
    std::string interface;
    std::string mode;
    std::string ipv4;
    std::string netmask;
    std::string gateway;
};

struct ActiveState {
    std::string interface;
    std::string link = "unknown";
    std::string mode = "unknown";
    std::string ipv4;
    int prefix_length = 0;
    std::string gateway;
};

struct Transaction {
    std::string id;
    std::string state = "idle";
    Candidate candidate;
    ActiveState previous;
    int64_t rollback_deadline_epoch_ms = 0;
    std::string last_reason = "OK";
};

void to_json(nlohmann::json& j, const Candidate& value);
void from_json(const nlohmann::json& j, Candidate& value);
void to_json(nlohmann::json& j, const ActiveState& value);
void from_json(const nlohmann::json& j, ActiveState& value);
void to_json(nlohmann::json& j, const Transaction& value);
void from_json(const nlohmann::json& j, Transaction& value);

bool validate_candidate(const Candidate& value, std::string* reason);
int netmask_to_prefix(const std::string& netmask);

class Platform {
public:
    virtual ~Platform() = default;
    virtual ActiveState status(const std::string& interface, std::string* reason) = 0;
    virtual bool preflight(const Candidate& candidate, std::string* reason) = 0;
    virtual bool apply(const Candidate& candidate, const ActiveState& previous,
                       std::string* reason) = 0;
    virtual bool confirm(const Candidate& candidate, const ActiveState& previous,
                         std::string* reason) = 0;
    virtual bool rollback(const Candidate& candidate, const ActiveState& previous,
                          std::string* reason) = 0;
};

class LinuxPlatform final : public Platform {
public:
    ActiveState status(const std::string& interface, std::string* reason) override;
    bool preflight(const Candidate& candidate, std::string* reason) override;
    bool apply(const Candidate& candidate, const ActiveState& previous,
               std::string* reason) override;
    bool confirm(const Candidate& candidate, const ActiveState& previous,
                 std::string* reason) override;
    bool rollback(const Candidate& candidate, const ActiveState& previous,
                  std::string* reason) override;

private:
    static bool run(const std::vector<std::string>& args, std::string* output);
    static std::string binary(const std::vector<std::string>& choices);
    static std::string connection_name(const std::string& interface);
    static bool persist(const Candidate& candidate, std::string* reason);
};

class Engine {
public:
    Engine(std::shared_ptr<Platform> platform, std::string journal_path,
           std::string default_interface = {});

    nlohmann::json handle(const nlohmann::json& request);
    void tick();
    Transaction transaction() const;

    void set_epoch_now_for_test(std::function<int64_t()> fn);
    void set_steady_now_for_test(std::function<int64_t()> fn);

private:
    std::shared_ptr<Platform> platform_;
    std::string journal_path_;
    std::string default_interface_;
    Transaction transaction_;
    std::function<int64_t()> epoch_now_ms_;
    std::function<int64_t()> steady_now_ms_;
    int64_t rollback_deadline_steady_ms_ = 0;
    mutable std::mutex mutex_;
    std::map<std::string, std::pair<std::string, nlohmann::json>> cache_;
    std::vector<std::string> cache_order_;

    bool load_journal();
    bool save_journal(std::string* reason) const;
    nlohmann::json response(const std::string& request_id, const std::string& result,
                            const std::string& reason_code, const std::string& message = {});
    bool transaction_matches(const nlohmann::json& request) const;
    static bool valid_request_id(const std::string& value);
    static std::string request_hash(const nlohmann::json& request);
    void remember(const std::string& request_id, const std::string& hash,
                  const nlohmann::json& response);
    void rollback_locked(const std::string& cause);
};

class Server {
public:
    Server(Engine& engine, std::string socket_path, std::string allowed_user);
    ~Server();
    bool run();
    void stop();

private:
    Engine& engine_;
    std::string socket_path_;
    std::string allowed_user_;
    int listen_fd_ = -1;
    std::atomic<bool> stopping_{false};

    bool allowed_peer(int fd, uint32_t* uid) const;
    void handle_client(int fd);
};

} // namespace netcfg

#endif
