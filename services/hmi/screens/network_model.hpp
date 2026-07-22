#ifndef HMI_NETWORK_MODEL_HPP
#define HMI_NETWORK_MODEL_HPP

#include "api/hmi_api_client.hpp"

#include <cstdint>
#include <string>

namespace hmi {

class NetworkModel {
public:
    bool update(const ApiReply& reply);
    std::string summary() const;

    const std::string& state() const { return state_; }
    const std::string& transaction_id() const { return transaction_id_; }
    const std::string& interface() const { return interface_; }
    uint32_t rollback_remaining_s() const { return rollback_remaining_s_; }
    bool can_apply() const { return state_ == "staged" && !transaction_id_.empty(); }
    bool can_confirm_or_rollback() const {
        return state_ == "awaiting_confirmation" && !transaction_id_.empty();
    }

private:
    std::string state_ = "idle";
    std::string transaction_id_;
    std::string interface_;
    std::string mode_ = "unknown";
    std::string ipv4_;
    std::string pending_ipv4_;
    std::string pending_mode_;
    std::string link_ = "unknown";
    uint32_t rollback_remaining_s_ = 0;
};

} // namespace hmi

#endif
