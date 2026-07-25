#include "netcfg.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <memory>
#include <set>

namespace {

class FakePlatform final : public netcfg::Platform {
public:
    netcfg::ActiveState active{"eth0", "up", "static", "192.168.1.50", 24, "192.168.1.1"};
    bool preflight_ok = true;
    bool apply_ok = true;
    bool confirm_ok = true;
    bool rollback_ok = true;
    int apply_calls = 0;
    int confirm_calls = 0;
    int rollback_calls = 0;

    netcfg::ActiveState status(const std::string& interface, std::string* reason) override {
        auto result = active;
        if (!interface.empty()) result.interface = interface;
        if (reason) *reason = "OK";
        return result;
    }
    bool preflight(const netcfg::Candidate&, std::string* reason) override {
        if (reason) *reason = preflight_ok ? "OK" : "DUPLICATE_ADDRESS";
        return preflight_ok;
    }
    bool apply(const netcfg::Candidate& candidate, const netcfg::ActiveState&, std::string* reason) override {
        ++apply_calls;
        if (apply_ok && candidate.mode == "static") active.ipv4 = candidate.ipv4;
        if (reason) *reason = apply_ok ? "OK" : "APPLY_FAILED";
        return apply_ok;
    }
    bool confirm(const netcfg::Candidate&, const netcfg::ActiveState&, std::string* reason) override {
        ++confirm_calls;
        if (reason) *reason = confirm_ok ? "OK" : "CONFIRM_FAILED";
        return confirm_ok;
    }
    bool rollback(const netcfg::Candidate&, const netcfg::ActiveState& previous, std::string* reason) override {
        ++rollback_calls;
        if (rollback_ok) active = previous;
        if (reason) *reason = rollback_ok ? "OK" : "ROLLBACK_FAILED";
        return rollback_ok;
    }
};

class FakeLinuxPlatform final : public netcfg::LinuxPlatform {
public:
    netcfg::ActiveState current;
    netcfg::ActiveState restored_after_reapply;
    netcfg::Candidate persisted;
    bool persist_ok = true;
    bool reapply_ok = true;
    bool address_remove_ok = true;
    std::set<std::string> addresses;
    std::vector<std::vector<std::string>> commands;

    netcfg::ActiveState status(const std::string& interface, std::string* reason) override {
        auto result = current;
        if (!interface.empty()) result.interface = interface;
        if (reason) *reason = "OK";
        return result;
    }

protected:
    bool run(const std::vector<std::string>& args, std::string*) override {
        commands.push_back(args);
        if (args.size() >= 4 && args[1] == "device" && args[2] == "reapply") {
            if (reapply_ok) current = restored_after_reapply;
            return reapply_ok;
        }
        if (args.size() >= 5 && args[1] == "address" && args[2] == "del") {
            if (!address_remove_ok) return false;
            addresses.erase(args[3].substr(0, args[3].find('/')));
            return true;
        }
        return true;
    }

    std::string binary(const std::vector<std::string>& choices) override {
        return choices.empty() ? std::string{} : choices.front();
    }

    bool persist(const netcfg::Candidate& candidate, std::string* reason) override {
        persisted = candidate;
        if (reason) *reason = persist_ok ? "OK" : "PERSIST_FAILED";
        return persist_ok;
    }

    bool interface_has_address(const std::string&, const std::string& ipv4,
                               bool* present) const override {
        if (!present) return false;
        *present = addresses.count(ipv4) != 0;
        return true;
    }

    void rollback_retry_delay() const override {}
};

std::string journal_path()
{
    const auto base = std::filesystem::temp_directory_path() /
        ("mkddc-netcfg-test-" + std::to_string(::getpid()) + "-" +
         std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(base);
    return (base / "journal.json").string();
}

nlohmann::json request(const std::string& id, const std::string& action)
{
    return {{"version", 1}, {"requestId", id}, {"action", action}};
}

nlohmann::json candidate()
{
    return {{"interface", "eth0"}, {"mode", "static"}, {"ipv4", "192.168.1.80"},
            {"netmask", "255.255.255.0"}, {"gateway", "192.168.1.1"}};
}

TEST(NetcfgValidation, RejectsUnsafeAndInconsistentAddresses)
{
    std::string reason;
    EXPECT_TRUE(netcfg::validate_candidate(candidate().get<netcfg::Candidate>(), &reason));
    auto bad = candidate();
    bad["ipv4"] = "127.0.0.1";
    EXPECT_FALSE(netcfg::validate_candidate(bad.get<netcfg::Candidate>(), &reason));
    EXPECT_EQ(reason, "UNUSABLE_ADDRESS");
    bad = candidate();
    bad["gateway"] = "192.168.2.1";
    EXPECT_FALSE(netcfg::validate_candidate(bad.get<netcfg::Candidate>(), &reason));
    EXPECT_EQ(reason, "INVALID_GATEWAY");
    bad = {{"interface", "eth0"}, {"mode", "dhcp"}, {"ipv4", "192.168.1.2"}};
    EXPECT_FALSE(netcfg::validate_candidate(bad.get<netcfg::Candidate>(), &reason));
    EXPECT_EQ(reason, "DHCP_STATIC_FIELDS_PRESENT");
}

TEST(NetcfgEngine, StaticStageApplyConfirmIsDurableAndIdempotent)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    int64_t now = 100000;
    engine.set_epoch_now_for_test([&] { return now; });

    auto stage = request("stage-1", "stage");
    stage["candidate"] = candidate();
    const auto staged = engine.handle(stage);
    ASSERT_EQ(staged.at("result"), "accepted");
    ASSERT_EQ(staged.at("state"), "staged");
    const std::string transaction = staged.at("transactionId");

    auto apply = request("apply-1", "apply");
    apply["transactionId"] = transaction;
    const auto applied = engine.handle(apply);
    EXPECT_EQ(applied.at("state"), "awaiting_confirmation");
    EXPECT_EQ(applied.at("rollbackRemainingS"), 120);
    EXPECT_EQ(platform->apply_calls, 1);
    EXPECT_EQ(engine.handle(apply), applied);
    EXPECT_EQ(platform->apply_calls, 1);

    auto confirm = request("confirm-1", "confirm");
    confirm["transactionId"] = transaction;
    EXPECT_EQ(engine.handle(confirm).at("state"), "confirmed");
    EXPECT_EQ(platform->confirm_calls, 1);
}

TEST(NetcfgEngine, RequestIdConflictCannotRepeatMutation)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto first = request("same", "stage");
    first["candidate"] = candidate();
    ASSERT_EQ(engine.handle(first).at("result"), "accepted");
    auto conflict = first;
    conflict["candidate"]["ipv4"] = "192.168.1.81";
    EXPECT_EQ(engine.handle(conflict).at("reasonCode"), "REQUEST_ID_CONFLICT");
}

TEST(NetcfgEngine, DeadlineAutomaticallyRollsBack)
{
    auto platform = std::make_shared<FakePlatform>();
    const std::string path = journal_path();
    netcfg::Engine engine(platform, path, "eth0");
    int64_t now = 5000;
    engine.set_epoch_now_for_test([&] { return now; });
    auto stage = request("stage-timeout", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-timeout", "apply");
    apply["transactionId"] = transaction;
    ASSERT_EQ(engine.handle(apply).at("state"), "awaiting_confirmation");
    now += 120000;
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "rolled_back");
    EXPECT_EQ(engine.transaction().last_reason, "CONFIRM_TIMEOUT");
    EXPECT_EQ(platform->rollback_calls, 1);
    EXPECT_EQ(platform->active.ipv4, "192.168.1.50");

    netcfg::Engine recovered(platform, path, "eth0");
    EXPECT_EQ(recovered.transaction().state, "rolled_back");
}

TEST(NetcfgEngine, FailedApplyRollsBackAndReportsFailureCause)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->apply_ok = false;
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-fail", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-fail", "apply");
    apply["transactionId"] = transaction;
    const auto response = engine.handle(apply);
    EXPECT_EQ(response.at("result"), "rejected");
    EXPECT_EQ(response.at("state"), "rolled_back");
    EXPECT_EQ(platform->rollback_calls, 1);
}

TEST(NetcfgEngine, FailedRollbackNeverReportsRolledBack)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->apply_ok = false;
    platform->rollback_ok = false;
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-rollback-fail", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-rollback-fail", "apply");
    apply["transactionId"] = transaction;

    const auto response = engine.handle(apply);

    EXPECT_EQ(response.at("result"), "rejected");
    EXPECT_EQ(response.at("state"), "failed");
    EXPECT_EQ(engine.transaction().last_reason, "ROLLBACK_FAILED");
}

TEST(NetcfgEngine, StageRejectsAnUnrestorablePreviousState)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->active.mode = "unknown";
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-no-rollback", "stage");
    stage["candidate"] = candidate();

    const auto response = engine.handle(stage);

    EXPECT_EQ(response.at("result"), "rejected");
    EXPECT_EQ(response.at("reasonCode"), "PREVIOUS_STATE_NOT_RESTORABLE");
    EXPECT_EQ(engine.transaction().state, "idle");
}

TEST(NetcfgEngine, DhcpWaitsForARealLeaseBeforeConfirmation)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    int64_t now = 1000;
    engine.set_epoch_now_for_test([&] { return now; });
    auto stage = request("stage-dhcp", "stage");
    stage["candidate"] = {{"interface", "eth0"}, {"mode", "dhcp"}};
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-dhcp", "apply");
    apply["transactionId"] = transaction;
    EXPECT_EQ(engine.handle(apply).at("state"), "applying");
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "applying");
    platform->active.ipv4 = "192.168.1.99";
    platform->active.mode = "dhcp";
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "awaiting_confirmation");
}

TEST(NetcfgEngine, RefusesToReplaceAnUnfinishedTransaction)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto first = request("stage-first", "stage");
    first["candidate"] = candidate();
    ASSERT_EQ(engine.handle(first).at("result"), "accepted");
    auto second = request("stage-second", "stage");
    second["candidate"] = candidate();
    second["candidate"]["ipv4"] = "192.168.1.81";
    const auto rejected = engine.handle(second);
    EXPECT_EQ(rejected.at("reasonCode"), "TRANSACTION_IN_PROGRESS");
    EXPECT_EQ(engine.transaction().candidate.ipv4, "192.168.1.80");
}

TEST(NetcfgEngine, ConfirmedStateDoesNotReportCandidateAsPending)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-confirmed", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-confirmed", "apply");
    apply["transactionId"] = transaction;
    ASSERT_EQ(engine.handle(apply).at("result"), "accepted");
    auto confirm = request("confirm-confirmed", "confirm");
    confirm["transactionId"] = transaction;
    const auto confirmed = engine.handle(confirm);
    ASSERT_EQ(confirmed.at("result"), "accepted");
    EXPECT_FALSE(confirmed.contains("pending"));
}

TEST(NetcfgEngine, ConfiguredInterfaceIsAnEnforcedAllowlist)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-wifi", "stage");
    stage["candidate"] = candidate();
    stage["candidate"]["interface"] = "wlan0";
    EXPECT_EQ(engine.handle(stage).at("reasonCode"), "INTERFACE_NOT_ALLOWED");
}

TEST(NetcfgEngine, MonotonicDeadlineRollsBackEvenIfWallClockMovesBackward)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    int64_t epoch = 100000;
    int64_t steady = 5000;
    engine.set_epoch_now_for_test([&] { return epoch; });
    engine.set_steady_now_for_test([&] { return steady; });
    auto stage = request("stage-clock", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-clock", "apply");
    apply["transactionId"] = transaction;
    ASSERT_EQ(engine.handle(apply).at("state"), "awaiting_confirmation");
    epoch -= 60000;
    steady += 120000;
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "rolled_back");
    EXPECT_EQ(engine.transaction().last_reason, "CONFIRM_TIMEOUT");
}

TEST(NetcfgLinuxPlatform, DhcpRollbackReappliesStaticProfileAndRemovesNewLease)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = {"eth0", "up", "dhcp", "192.168.1.99", 24, "192.168.1.1"};
    platform.restored_after_reapply = previous;
    platform.addresses = {previous.ipv4, platform.current.ipv4};
    const netcfg::Candidate dhcp{"eth0", "dhcp", {}, {}, {}};
    std::string reason;

    EXPECT_TRUE(platform.rollback(dhcp, previous, &reason));
    EXPECT_EQ(platform.persisted.interface, previous.interface);
    EXPECT_EQ(platform.persisted.mode, "static");
    EXPECT_EQ(platform.persisted.ipv4, previous.ipv4);
    EXPECT_EQ(platform.persisted.netmask, "255.255.255.0");
    EXPECT_EQ(platform.persisted.gateway, previous.gateway);
    EXPECT_EQ(platform.addresses.count("192.168.1.99"), 0u);
    ASSERT_EQ(platform.commands.size(), 2u);
    EXPECT_EQ(platform.commands[0], (std::vector<std::string>{
        "/usr/bin/nmcli", "device", "reapply", "eth0"}));
    EXPECT_EQ(platform.commands[1], (std::vector<std::string>{
        "/usr/sbin/ip", "address", "del", "192.168.1.99/24", "dev", "eth0"}));
}

TEST(NetcfgLinuxPlatform, RollbackFailsClosedWhenReapplyFails)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = {"eth0", "up", "dhcp", "192.168.1.99", 24, "192.168.1.1"};
    platform.restored_after_reapply = previous;
    platform.reapply_ok = false;
    const netcfg::Candidate dhcp{"eth0", "dhcp", {}, {}, {}};
    std::string reason;

    EXPECT_FALSE(platform.rollback(dhcp, previous, &reason));
    EXPECT_EQ(reason, "ROLLBACK_REAPPLY_FAILED");
}

TEST(NetcfgLinuxPlatform, RollbackFailsClosedWhenAddressRemovalFails)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = {"eth0", "up", "dhcp", "192.168.1.99", 24, "192.168.1.1"};
    platform.restored_after_reapply = previous;
    platform.addresses = {previous.ipv4, platform.current.ipv4};
    platform.address_remove_ok = false;
    const netcfg::Candidate dhcp{"eth0", "dhcp", {}, {}, {}};
    std::string reason;

    EXPECT_FALSE(platform.rollback(dhcp, previous, &reason));
    EXPECT_EQ(reason, "ROLLBACK_ADDRESS_REMOVE_FAILED");
}

TEST(NetcfgLinuxPlatform, RollbackFailsClosedWhenKernelStateDoesNotMatch)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = previous;
    platform.restored_after_reapply = previous;
    platform.restored_after_reapply.gateway = "192.168.1.254";
    const netcfg::Candidate candidate_value{"eth0", "static", "192.168.1.80",
                                             "255.255.255.0", "192.168.1.1"};
    std::string reason;

    EXPECT_FALSE(platform.rollback(candidate_value, previous, &reason));
    EXPECT_EQ(reason, "ROLLBACK_VERIFY_FAILED");
}

TEST(NetcfgServer, RejectsOverlongSocketPathBeforeCreatingEndpoint)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    const auto socket_path = std::filesystem::temp_directory_path() /
        std::string(128, 's');
    netcfg::Server server(engine, socket_path.string(), "root");

    EXPECT_FALSE(server.run());
    EXPECT_FALSE(std::filesystem::exists(socket_path));
}

} // namespace
