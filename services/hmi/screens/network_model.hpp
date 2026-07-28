#ifndef HMI_NETWORK_MODEL_HPP
#define HMI_NETWORK_MODEL_HPP

#include "api/hmi_api_client.hpp"

#include <cstdint>
#include <functional>
#include <string>

namespace hmi {

class NetworkStageGuard {
public:
    NetworkStageGuard();
    bool confirm(const std::string& candidate);
    bool armed() const;
    void clear();
    void set_steady_now_for_test(std::function<int64_t()> fn);

private:
    std::function<int64_t()> steady_now_ms_;
    std::string candidate_;
    int64_t deadline_ms_ = 0;
};

class NetworkModel {
public:
    NetworkModel();
    bool update(const ApiReply& reply);
    std::string summary() const;
    void set_steady_now_for_test(std::function<int64_t()> fn);

    bool authoritative() const { return authoritative_; }
    const std::string& state() const { return state_; }
    const std::string& transaction_id() const { return transaction_id_; }
    const std::string& interface() const { return interface_; }
    const std::string& draft_interface() const { return draft_interface_; }
    const std::string& draft_mode() const { return draft_mode_; }
    const std::string& draft_ipv4() const { return draft_ipv4_; }
    const std::string& draft_netmask() const { return draft_netmask_; }
    const std::string& draft_gateway() const { return draft_gateway_; }
    uint32_t rollback_remaining_s() const;
    bool can_edit() const {
        return authoritative_ && !transaction_locked() && !draft_interface_.empty() &&
            (draft_mode_ == "static" || draft_mode_ == "dhcp");
    }
    bool can_apply() const {
        return authoritative_ && state_ == "staged" && !transaction_id_.empty();
    }
    bool can_confirm() const {
        return authoritative_ && state_ == "awaiting_confirmation" && !transaction_id_.empty() &&
            rollback_remaining_s() > 0;
    }
    bool can_rollback() const {
        return authoritative_ && (state_ == "staged" || state_ == "applying" ||
                state_ == "awaiting_confirmation") && !transaction_id_.empty();
    }
    bool transaction_locked() const {
        return state_ == "staged" || state_ == "applying" ||
            state_ == "awaiting_confirmation" || state_ == "rolling_back";
    }
    std::string impact_summary(const std::string& mode, const std::string& ipv4) const;

private:
    bool authoritative_ = false;
    std::string state_ = "idle";
    std::string transaction_id_;
    std::string interface_;
    std::string mode_ = "unknown";
    std::string ipv4_;
    std::string pending_ipv4_;
    std::string pending_mode_;
    std::string link_ = "unknown";
    std::string draft_interface_;
    std::string draft_mode_ = "unknown";
    std::string draft_ipv4_;
    std::string draft_netmask_;
    std::string draft_gateway_;
    uint32_t rollback_remaining_s_ = 0;
    int64_t rollback_observed_steady_ms_ = 0;
    std::function<int64_t()> steady_now_ms_;
};

} // namespace hmi

#endif
