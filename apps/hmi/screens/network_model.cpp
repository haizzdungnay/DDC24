#include "screens/network_model.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <utility>

namespace hmi {

namespace {
std::function<int64_t()> steady_clock_ms()
{
    return [] {
        using namespace std::chrono;
        return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
    };
}

std::string netmask_from_prefix(int prefix)
{
    if (prefix < 1 || prefix > 32) return {};
    const uint32_t mask = prefix == 32 ? UINT32_MAX : UINT32_MAX << (32 - prefix);
    char value[16];
    std::snprintf(value, sizeof(value), "%u.%u.%u.%u",
                  (mask >> 24) & 0xffu, (mask >> 16) & 0xffu,
                  (mask >> 8) & 0xffu, mask & 0xffu);
    return value;
}
} // namespace

NetworkStageGuard::NetworkStageGuard()
    : steady_now_ms_(steady_clock_ms())
{}

bool NetworkStageGuard::confirm(const std::string& candidate)
{
    const int64_t now_ms = steady_now_ms_();
    if (candidate_.empty() || candidate_ != candidate || now_ms >= deadline_ms_) {
        candidate_ = candidate;
        deadline_ms_ = now_ms + 5000;
        return false;
    }
    clear();
    return true;
}

bool NetworkStageGuard::armed() const
{
    return !candidate_.empty() && steady_now_ms_() < deadline_ms_;
}

void NetworkStageGuard::clear()
{
    candidate_.clear();
    deadline_ms_ = 0;
}

void NetworkStageGuard::set_steady_now_for_test(std::function<int64_t()> fn)
{
    steady_now_ms_ = std::move(fn);
}

NetworkModel::NetworkModel()
    : steady_now_ms_(steady_clock_ms())
{}

void NetworkModel::set_steady_now_for_test(std::function<int64_t()> fn)
{
    steady_now_ms_ = std::move(fn);
}

bool NetworkModel::update(const ApiReply& reply)
{
    authoritative_ = false;
    if (!reply.transport_ok || reply.result != "accepted" ||
        !reply.payload.contains("network") ||
        !reply.payload["network"].is_object()) return false;
    try {
        const auto& network = reply.payload["network"];
        if (!network.contains("active") || !network["active"].is_object()) return false;
        const auto& active = network["active"];
        const std::string next_state = network.value("state", "idle");
        const std::string next_transaction_id = network.value("transactionId", "");
        const uint32_t next_rollback_remaining_s = network.value("rollbackRemainingS", 0u);
        const std::string next_interface = active.value("interface", "");
        const std::string next_mode = active.value("mode", "unknown");
        const std::string next_ipv4 = active.value("ipv4", "");
        const std::string next_link = active.value("link", "unknown");
        const int next_prefix_length = active.value("prefixLength", 0);
        const std::string next_gateway = active.value("gateway", "");

        std::string next_pending_ipv4;
        std::string next_pending_mode;
        const nlohmann::json* draft = nullptr;
        const bool transaction_active = next_state == "staged" || next_state == "applying" ||
            next_state == "awaiting_confirmation";
        if (transaction_active && (next_transaction_id.empty() ||
            !network.contains("pending") || !network["pending"].is_object())) return false;
        if (network.contains("pending") && network["pending"].is_object()) {
            draft = &network["pending"];
            next_pending_ipv4 = draft->value("ipv4", "");
            next_pending_mode = draft->value("mode", "");
            if (next_pending_mode == "dhcp") next_pending_ipv4 = "DHCP";
        } else if (network.contains("configured") && network["configured"].is_object()) {
            draft = &network["configured"];
        }

        std::string next_draft_interface = next_interface;
        std::string next_draft_mode = next_mode;
        std::string next_draft_ipv4 = next_mode == "static" ? next_ipv4 : "";
        std::string next_draft_netmask = next_mode == "static"
            ? netmask_from_prefix(next_prefix_length) : "";
        std::string next_draft_gateway = next_mode == "static" ? next_gateway : "";
        if (draft) {
            next_draft_interface = draft->value("interface", next_interface);
            next_draft_mode = draft->value("mode", "unknown");
            next_draft_ipv4 = next_draft_mode == "static" ? draft->value("ipv4", "") : "";
            next_draft_netmask = next_draft_mode == "static" ? draft->value("netmask", "") : "";
            next_draft_gateway = next_draft_mode == "static" ? draft->value("gateway", "") : "";
        }
        if (transaction_active && (next_draft_interface.empty() ||
            (next_draft_mode != "static" && next_draft_mode != "dhcp") ||
            (next_draft_mode == "static" &&
             (next_draft_ipv4.empty() || next_draft_netmask.empty())))) return false;

        state_ = next_state;
        transaction_id_ = next_transaction_id;
        rollback_remaining_s_ = next_rollback_remaining_s;
        rollback_observed_steady_ms_ = steady_now_ms_();
        interface_ = next_interface;
        mode_ = next_mode;
        ipv4_ = next_ipv4;
        link_ = next_link;
        pending_ipv4_ = next_pending_ipv4;
        pending_mode_ = next_pending_mode;
        draft_interface_ = next_draft_interface;
        draft_mode_ = next_draft_mode;
        draft_ipv4_ = next_draft_ipv4;
        draft_netmask_ = next_draft_netmask;
        draft_gateway_ = next_draft_gateway;
        authoritative_ = true;
        return true;
    } catch (...) {
        return false;
    }
}

uint32_t NetworkModel::rollback_remaining_s() const
{
    if (state_ != "applying" && state_ != "awaiting_confirmation") return 0;
    const int64_t elapsed_ms = std::max<int64_t>(0, steady_now_ms_() - rollback_observed_steady_ms_);
    const uint32_t elapsed_s = static_cast<uint32_t>(elapsed_ms / 1000);
    return elapsed_s >= rollback_remaining_s_ ? 0 : rollback_remaining_s_ - elapsed_s;
}

std::string NetworkModel::summary() const
{
    char buf[320];
    if (!authoritative_) {
        std::snprintf(buf, sizeof(buf), "Authority unavailable; Refresh required\nLast-known: %s %s",
                      state_.c_str(), ipv4_.empty() ? "no-address" : ipv4_.c_str());
    } else if ((state_ == "staged" || state_ == "applying" ||
                state_ == "awaiting_confirmation") && !pending_mode_.empty()) {
        const char* pending = pending_ipv4_.empty() ? "pending" : pending_ipv4_.c_str();
        const std::string transaction = transaction_id_.size() > 12
            ? transaction_id_.substr(0, 12) + "..." : transaction_id_;
        if (state_ == "awaiting_confirmation") {
            std::snprintf(buf, sizeof(buf), "%s -> %s\n%s confirm:%us\n%s tx:%s",
                          ipv4_.empty() ? "no-address" : ipv4_.c_str(), pending,
                          state_.c_str(), rollback_remaining_s(),
                          interface_.empty() ? "-" : interface_.c_str(), transaction.c_str());
        } else {
            std::snprintf(buf, sizeof(buf), "%s -> %s\n%s %s tx:%s",
                          ipv4_.empty() ? "no-address" : ipv4_.c_str(), pending,
                          state_.c_str(), interface_.empty() ? "-" : interface_.c_str(),
                          transaction.c_str());
        }
    } else if (state_ == "awaiting_confirmation") {
        std::snprintf(buf, sizeof(buf), "%s %s (pending unavailable)\nState:%s confirm:%us",
                      interface_.empty() ? "-" : interface_.c_str(),
                      ipv4_.empty() ? "no-address" : ipv4_.c_str(),
                      state_.c_str(), rollback_remaining_s());
    } else {
        std::snprintf(buf, sizeof(buf), "%s %s %s (%s)\nState:%s",
                      interface_.empty() ? "-" : interface_.c_str(),
                      ipv4_.empty() ? "no-address" : ipv4_.c_str(), mode_.c_str(), link_.c_str(),
                      state_.c_str());
    }
    return buf;
}

std::string NetworkModel::impact_summary(const std::string& mode, const std::string& ipv4) const
{
    const std::string active = ipv4_.empty() ? "no-address" : ipv4_;
    const std::string candidate = mode == "dhcp" ? "DHCP" :
        (ipv4.empty() ? "no-address" : ipv4);
    return "Impact (" + mode + ")\n" + active + " -> " + candidate + "\n" +
        "Web/BACnet reconnect; Stage again <=5s";
}

} // namespace hmi
