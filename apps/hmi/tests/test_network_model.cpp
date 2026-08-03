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
                         {"ipv4", "192.168.10.21"}, {"netmask", "255.255.255.0"}}},
            {"active", {{"interface", "eth0"}, {"mode", "static"},
                        {"ipv4", "192.168.10.20"}, {"link", "up"}}}
        }}
    };
    NetworkModel model;
    int64_t now_ms = 1000;
    model.set_steady_now_for_test([&] { return now_ms; });
    ASSERT_TRUE(model.update(reply));
    EXPECT_TRUE(model.can_confirm());
    EXPECT_TRUE(model.can_rollback());
    EXPECT_FALSE(model.can_apply());
    EXPECT_EQ(model.transaction_id(), "tx-1");
    EXPECT_NE(model.summary().find("confirm:118s"), std::string::npos);
    EXPECT_NE(model.summary().find("192.168.10.20 -> 192.168.10.21"), std::string::npos);

    now_ms += 117000;
    EXPECT_EQ(model.rollback_remaining_s(), 1u);
    EXPECT_TRUE(model.can_confirm());
    now_ms += 1000;
    EXPECT_EQ(model.rollback_remaining_s(), 0u);
    EXPECT_FALSE(model.can_confirm());
    EXPECT_TRUE(model.can_rollback());
}

TEST(NetworkModelTest, RejectsRepliesWithoutAuthoritativeNetworkPayload)
{
    NetworkModel model;
    ApiReply staged;
    staged.transport_ok = true;
    staged.result = "accepted";
    staged.payload = {{"network", {
        {"state", "staged"}, {"transactionId", "tx-stale"},
        {"pending", {{"interface", "eth0"}, {"mode", "static"},
                     {"ipv4", "192.168.10.21"}, {"netmask", "255.255.255.0"}}},
        {"active", {{"interface", "eth0"}, {"mode", "static"},
                    {"ipv4", "192.168.10.20"}, {"link", "up"}}}
    }}};
    ASSERT_TRUE(model.update(staged));
    ASSERT_TRUE(model.can_apply());

    ApiReply reply;
    reply.transport_ok = true;
    reply.result = "accepted";
    reply.payload = {{"state", "staged"}};
    EXPECT_FALSE(model.update(reply));
    EXPECT_FALSE(model.authoritative());
    EXPECT_FALSE(model.can_apply());
    EXPECT_FALSE(model.can_confirm());
    EXPECT_FALSE(model.can_rollback());
    EXPECT_NE(model.summary().find("Authority unavailable"), std::string::npos);
}

TEST(NetworkModelTest, RejectsErrorReplyEvenWhenItCarriesStaleNetwork)
{
    ApiReply reply;
    reply.transport_ok = true;
    reply.result = "rejected";
    reply.payload = {{"network", {
        {"state", "staged"}, {"transactionId", "tx-stale"},
        {"pending", {{"interface", "eth0"}, {"mode", "static"},
                     {"ipv4", "192.168.10.21"}}},
        {"active", {{"interface", "eth0"}, {"mode", "static"},
                    {"ipv4", "192.168.10.20"}, {"link", "up"}}}
    }}};

    NetworkModel model;
    EXPECT_FALSE(model.update(reply));
    EXPECT_FALSE(model.authoritative());
    EXPECT_FALSE(model.can_apply());
}

TEST(NetworkModelTest, AllowsExplicitRollbackFromStagedState)
{
    ApiReply reply;
    reply.transport_ok = true;
    reply.result = "accepted";
    reply.payload = {{"network", {
        {"state", "staged"}, {"transactionId", "tx-staged"},
        {"pending", {{"interface", "eth0"}, {"mode", "static"},
                     {"ipv4", "192.168.10.21"}, {"netmask", "255.255.255.0"}}},
        {"active", {{"interface", "eth0"}, {"mode", "static"},
                    {"ipv4", "192.168.10.20"}, {"link", "up"}}}
    }}};
    NetworkModel model;
    ASSERT_TRUE(model.update(reply));
    EXPECT_TRUE(model.can_apply());
    EXPECT_FALSE(model.can_confirm());
    EXPECT_TRUE(model.can_rollback());
    EXPECT_FALSE(model.can_edit());
}

TEST(NetworkModelTest, LocksAndDisplaysRemotePendingCandidate)
{
    ApiReply reply;
    reply.transport_ok = true;
    reply.result = "accepted";
    reply.payload = {{"network", {
        {"state", "staged"}, {"transactionId", "tx-remote"},
        {"pending", {{"interface", "end1"}, {"mode", "static"},
                     {"ipv4", "10.20.30.40"}, {"netmask", "255.255.255.0"},
                     {"gateway", "10.20.30.1"}}},
        {"active", {{"interface", "end1"}, {"mode", "static"},
                    {"ipv4", "10.10.10.5"}, {"link", "up"}}}
    }}};

    NetworkModel model;
    ASSERT_TRUE(model.update(reply));
    EXPECT_FALSE(model.can_edit());
    EXPECT_EQ(model.draft_interface(), "end1");
    EXPECT_EQ(model.draft_mode(), "static");
    EXPECT_EQ(model.draft_ipv4(), "10.20.30.40");
    EXPECT_EQ(model.draft_netmask(), "255.255.255.0");
    EXPECT_EQ(model.draft_gateway(), "10.20.30.1");
    EXPECT_NE(model.summary().find("10.10.10.5 -> 10.20.30.40"), std::string::npos);
    EXPECT_NE(model.summary().find("tx:tx-remote"), std::string::npos);
}

TEST(NetworkModelTest, BuildsSpecificCandidateImpact)
{
    ApiReply reply;
    reply.transport_ok = true;
    reply.result = "accepted";
    reply.payload = {{"network", {
        {"state", "idle"},
        {"active", {{"interface", "eth0"}, {"mode", "static"},
                    {"ipv4", "192.168.1.18"}, {"link", "up"}}}
    }}};

    NetworkModel model;
    ASSERT_TRUE(model.update(reply));
    const std::string impact = model.impact_summary("static", "192.168.1.25");
    EXPECT_NE(impact.find("192.168.1.18 -> 192.168.1.25"), std::string::npos);
    EXPECT_NE(impact.find("static"), std::string::npos);
    EXPECT_NE(impact.find("Web/BACnet reconnect"), std::string::npos);
}

TEST(NetworkStageGuardTest, RequiresSameCandidateBeforeDeadline)
{
    NetworkStageGuard guard;
    int64_t now_ms = 1000;
    guard.set_steady_now_for_test([&] { return now_ms; });

    EXPECT_FALSE(guard.confirm("candidate-a"));
    EXPECT_TRUE(guard.armed());
    now_ms += 4999;
    EXPECT_TRUE(guard.confirm("candidate-a"));
    EXPECT_FALSE(guard.armed());
}

TEST(NetworkStageGuardTest, RearmsAfterExpiryOrCandidateChange)
{
    NetworkStageGuard guard;
    int64_t now_ms = 1000;
    guard.set_steady_now_for_test([&] { return now_ms; });

    EXPECT_FALSE(guard.confirm("candidate-a"));
    now_ms += 1000;
    EXPECT_FALSE(guard.confirm("candidate-b"));
    now_ms += 5000;
    EXPECT_FALSE(guard.confirm("candidate-b"));
    EXPECT_TRUE(guard.armed());
}

} // namespace hmi
