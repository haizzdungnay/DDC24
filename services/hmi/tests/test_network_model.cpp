#include <gtest/gtest.h>

#include "screens/network_model.hpp"

namespace hmi {

TEST(NetworkModelTest, TracksPendingConfirmationAndCountdown)
{
    ApiReply reply;
    reply.transport_ok = true;
    reply.result = "accepted";
    reply.payload = {
        {"network", {
            {"state", "awaiting_confirmation"}, {"transactionId", "tx-1"},
            {"rollbackRemainingS", 118},
            {"pending", {{"interface", "eth0"}, {"mode", "static"},
                         {"ipv4", "192.168.10.21"}}},
            {"active", {{"interface", "eth0"}, {"mode", "static"},
                        {"ipv4", "192.168.10.20"}, {"link", "up"}}}
        }}
    };
    NetworkModel model;
    ASSERT_TRUE(model.update(reply));
    EXPECT_TRUE(model.can_confirm_or_rollback());
    EXPECT_FALSE(model.can_apply());
    EXPECT_EQ(model.transaction_id(), "tx-1");
    EXPECT_NE(model.summary().find("confirm:118s"), std::string::npos);
    EXPECT_NE(model.summary().find("192.168.10.20 -> 192.168.10.21"), std::string::npos);
}

TEST(NetworkModelTest, RejectsRepliesWithoutAuthoritativeNetworkPayload)
{
    NetworkModel model;
    ApiReply reply;
    reply.transport_ok = true;
    reply.payload = {{"state", "staged"}};
    EXPECT_FALSE(model.update(reply));
    EXPECT_EQ(model.state(), "idle");
}

} // namespace hmi
