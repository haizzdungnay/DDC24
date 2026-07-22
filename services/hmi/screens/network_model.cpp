#include "screens/network_model.hpp"

#include <cstdio>

namespace hmi {

bool NetworkModel::update(const ApiReply& reply)
{
    if (!reply.transport_ok || !reply.payload.contains("network") ||
        !reply.payload["network"].is_object()) return false;
    const auto& network = reply.payload["network"];
    state_ = network.value("state", "idle");
    transaction_id_ = network.value("transactionId", "");
    rollback_remaining_s_ = network.value("rollbackRemainingS", 0u);
    if (network.contains("active") && network["active"].is_object()) {
        const auto& active = network["active"];
        interface_ = active.value("interface", "");
        mode_ = active.value("mode", "unknown");
        ipv4_ = active.value("ipv4", "");
        link_ = active.value("link", "unknown");
    }
    pending_ipv4_.clear();
    pending_mode_.clear();
    if (network.contains("pending") && network["pending"].is_object()) {
        pending_ipv4_ = network["pending"].value("ipv4", "");
        pending_mode_ = network["pending"].value("mode", "");
        if (pending_mode_ == "dhcp") pending_ipv4_ = "DHCP";
    }
    return true;
}

std::string NetworkModel::summary() const
{
    char buf[192];
    if (state_ == "awaiting_confirmation") {
        std::snprintf(buf, sizeof(buf), "%s %s -> %s (%s)\nState:%s  confirm:%us",
                      interface_.empty() ? "-" : interface_.c_str(),
                      ipv4_.empty() ? "no-address" : ipv4_.c_str(),
                      pending_ipv4_.empty() ? "pending" : pending_ipv4_.c_str(), link_.c_str(),
                      state_.c_str(), rollback_remaining_s_);
    } else {
        std::snprintf(buf, sizeof(buf), "%s %s %s (%s)\nState:%s",
                      interface_.empty() ? "-" : interface_.c_str(),
                      ipv4_.empty() ? "no-address" : ipv4_.c_str(), mode_.c_str(), link_.c_str(),
                      state_.c_str());
    }
    return buf;
}

} // namespace hmi
