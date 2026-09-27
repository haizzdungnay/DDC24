/**
 * @file  test_web_ipc.cpp
 * @brief Contract 07 §8 qua socket thật + bug #1/#8 analysis report:
 *        release AV không được ghi đè value; applied_value đúng nghĩa;
 *        validate unknown_point/readonly/bad_request.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <deque>
#include <functional>
#include <limits>
#include <memory>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "runtime/scan_loop.hpp"
#include "tests/allocation_probe.hpp"

using namespace core;

namespace {

class Client {
public:
    bool connect(const std::string& path)
    {
        fd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
        if (fd_ < 0) return false;
        struct sockaddr_un addr {};
        addr.sun_family = AF_UNIX;
        std::strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path) - 1);
        return ::connect(fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) == 0;
    }
    ~Client() { if (fd_ >= 0) ::close(fd_); }

    void send_line(const std::string& s)
    {
        const std::string line = s + "\n";
        ASSERT_EQ(::send(fd_, line.c_str(), line.size(), 0),
                  static_cast<ssize_t>(line.size()));
    }
    void send_all(const std::string& s)
    {
        std::size_t sent = 0;
        while (sent < s.size()) {
            const ssize_t n = ::send(fd_, s.data() + sent, s.size() - sent, 0);
            ASSERT_GT(n, 0);
            sent += static_cast<std::size_t>(n);
        }
    }
    int fd() const { return fd_; }
    void shutdown_write() { ASSERT_EQ(::shutdown(fd_, SHUT_WR), 0); }
    /* đọc 1 dòng response (blocking, timeout qua SO_RCVTIMEO) */
    std::string recv_line()
    {
        struct timeval tv {2, 0};
        setsockopt(fd_, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        std::string buf;
        char c;
        while (::recv(fd_, &c, 1, 0) == 1) {
            if (c == '\n') break;
            buf += c;
        }
        return buf;
    }

private:
    int fd_ = -1;
};

struct Fixture {
    std::string sock_path;
    kx_io_shm_t shm;
    IobusReader reader;
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe{quality};
    OutputWriter writer{reader};
    BacnetObjTable bacnet;
    CoreMetrics metrics;
    AlarmRuntime alarms;
    ScanLoop loop;

    Fixture() : loop({&reader, &table, &quality, &web, &graph, &resolver,
                      &safe, &writer, &bacnet, &metrics, -1, &alarms})
    {
        char path[64];
        std::snprintf(path, sizeof(path), "/tmp/mkddc-test-core-%d.sock", getpid());
        sock_path = path;
        std::memset(&shm, 0, sizeof(shm));
        shm.magic = KX_SHM_MAGIC;
        shm.iop_status = KX_IOP_NORMAL;
        shm.ts_ns = 1;
        reader.attach_external(&shm);
    }
    ~Fixture() { web.close(); ::unlink(sock_path.c_str()); }

    void scan() { shm.ts_ns += 1000000; loop.step(); }
};

AlarmEntityConfig high_alarm()
{
    AlarmEntityConfig cfg;
    cfg.id = "ALM-1";
    cfg.label = "Supply alarm";
    cfg.enabled = true;
    cfg.alarm_type = 1;
    cfg.sources.push_back({{PointKind::AI, 0}, "UI-01"});
    cfg.priority = "high";
    cfg.delay_s = 0.0;
    cfg.params.hh = 32.0;
    cfg.params.h = 28.0;
    cfg.params.l = 16.0;
    cfg.params.ll = 12.0;
    return cfg;
}

RuntimePointSnapshot test_snapshot(uint64_t id = 42)
{
    IoSnapshot io;
    io.ts_ns = 123;
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    RuntimePointSnapshotPublisher publisher;
    return publisher.build(id, 0, 456, table, io, resolver.resolve(), resolver, false);
}

struct SendScript {
    std::deque<int> results;
    std::string bytes;
};

/* Chờ một điều kiện do luồng khác tạo ra (luồng `web-ipc`), tối đa 2 s. */
bool wait_until(const std::function<bool()>& ready)
{
    for (int attempt = 0; attempt < 2000; ++attempt) {
        if (ready()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return ready();
}

WebCommand point_write(uint64_t id, PointKind kind, int idx, float value)
{
    WebCommand cmd;
    cmd.id = id;
    cmd.kind = WebCommandKind::Point;
    cmd.is_write = true;
    cmd.point = {kind, idx};
    cmd.point_name = "DO1";
    cmd.value = value;
    cmd.user = "t";
    cmd.prio = PRIO_LOCAL_MANUAL;
    return cmd;
}

ssize_t scripted_send(int, const void* data, size_t size, int, void* context)
{
    auto& script = *static_cast<SendScript*>(context);
    const int result = script.results.empty() ? static_cast<int>(size) : script.results.front();
    if (!script.results.empty()) script.results.pop_front();
    if (result < 0) {
        errno = -result;
        return -1;
    }
    const size_t sent = std::min(size, static_cast<size_t>(result));
    script.bytes.append(static_cast<const char*>(data), sent);
    return static_cast<ssize_t>(sent);
}

} // namespace

TEST(WebIpc, ParsePointName)
{
    PointId id;
    EXPECT_TRUE(parse_point_name("DO1", &id));
    EXPECT_EQ(id.kind, PointKind::BO);
    EXPECT_EQ(id.idx, 0);
    EXPECT_TRUE(parse_point_name("AO4", &id));
    EXPECT_EQ(id.idx, 3);
    EXPECT_TRUE(parse_point_name("AV32", &id));
    EXPECT_FALSE(parse_point_name("AV33", &id));   /* ngoài dải */
    EXPECT_FALSE(parse_point_name("DO5", &id));
    EXPECT_FALSE(parse_point_name("XX1", &id));
    EXPECT_FALSE(parse_point_name("DO", &id));
    for (const char* invalid : {"DO1junk", "DO1.5", "DO1-evil", "DO+1",
                                "DO 1", "DO999999999999999999999999999999"})
        EXPECT_FALSE(parse_point_name(invalid, &id)) << invalid;
}

TEST(WebIpc, PointSnapshotReturnsCachedPayloadWithoutQueueing)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    const uint64_t publish_count = f.web.snapshot_publish_count_for_test();
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":21,"op":"point_snapshot","user":"web","value":99})");
    usleep(20000);

    const auto commands = f.web.drain();
    EXPECT_TRUE(commands.empty());
    const std::string response = c.recv_line();
    ASSERT_LE(response.size() + 1, KX_POINT_SNAPSHOT_MAX_PAYLOAD);
    const auto json = nlohmann::json::parse(response);
    EXPECT_EQ(json.at("id"), 21u);
    EXPECT_EQ(json.at("result"), "accepted");
    EXPECT_EQ(json.at("snapshotId"), 42u);
    EXPECT_EQ(json.at("capturedMonotonicNs"), 456u);
    ASSERT_EQ(json.at("points").size(), 24u);
    EXPECT_EQ(json.at("points").at(0).at("id"), "UI-01");
    EXPECT_EQ(json.at("points").at(23).at("id"), "DO-04");
    EXPECT_EQ(f.web.snapshot_publish_count_for_test(), publish_count);
    EXPECT_FLOAT_EQ(f.resolver.resolve().ao[0], 0.0f);
}

TEST(WebIpc, SyntheticWorstWidthSnapshotResponseIsBounded)
{
    RuntimePointSnapshot snapshot = test_snapshot(std::numeric_limits<uint64_t>::max());
    snapshot.observed_utc_ms = 253402300799999ull;
    snapshot.captured_monotonic_ns = std::numeric_limits<uint64_t>::max();
    snapshot.task.present = true;
    snapshot.task.id.fill(static_cast<char>(0x01));
    snapshot.task.period_ms = std::numeric_limits<uint32_t>::max();
    snapshot.task.budget_ms = std::numeric_limits<uint32_t>::max();
    snapshot.task.state.fill(static_cast<char>(0x01));
    snapshot.task.run_count = std::numeric_limits<uint32_t>::max();
    snapshot.task.missed_release_count = std::numeric_limits<uint32_t>::max();
    snapshot.task.last_exec_ns = std::numeric_limits<uint64_t>::max();
    snapshot.task.max_exec_ns = std::numeric_limits<uint64_t>::max();
    snapshot.task.overrun_count = std::numeric_limits<uint32_t>::max();
    snapshot.task.consecutive_overruns = std::numeric_limits<uint32_t>::max();
    for (RuntimePointSnapshotRow& row : snapshot.rows) {
        row.value = -std::numeric_limits<float>::max();
        row.quality = KX_Q_UNCERTAIN;
        row.source = SnapshotSource::SCHEDULE;
        row.unit.fill(static_cast<char>(0x01));
        row.updated_at_monotonic_ns = std::numeric_limits<uint64_t>::max();
        row.generation = std::numeric_limits<uint32_t>::max();
        row.program_value_present = true;
        row.program_value = -std::numeric_limits<float>::max();
        row.effective_priority = std::numeric_limits<uint8_t>::max();
    }
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(snapshot);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":18446744073709551615,"op":"point_snapshot","user":"web"})");
    usleep(20000);

    EXPECT_TRUE(f.web.drain().empty());
    const std::string response = c.recv_line();
    ASSERT_NO_THROW(nlohmann::json::parse(response));
    EXPECT_GT(response.size() + 1, 7513u);
    EXPECT_LE(response.size() + 1, KX_POINT_SNAPSHOT_MAX_PAYLOAD);
}

TEST(WebIpc, PointSnapshotTextOutsideTopLevelOpUsesLegacyParser)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":22,"op":"write","point":"DO1","value":1,"source":"manual","user":"point_snapshot"})");
    usleep(20000);

    const auto commands = f.web.drain();
    ASSERT_EQ(commands.size(), 1u);
    EXPECT_EQ(commands[0].kind, WebCommandKind::Point);
    EXPECT_TRUE(commands[0].is_write);
    EXPECT_EQ(commands[0].user, "point_snapshot");
}

TEST(WebIpc, PointSnapshotMapsCacheStates)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":1,"op":"point_snapshot","user":"web"})");
    usleep(20000);
    f.web.drain();
    EXPECT_NE(c.recv_line().find("snapshot_unavailable"), std::string::npos);

    f.web.set_snapshot_payload_limit_for_test(1);
    f.web.publish_point_snapshot(test_snapshot());
    c.send_line(R"({"id":2,"op":"point_snapshot","user":"web"})");
    usleep(20000);
    f.web.drain();
    EXPECT_NE(c.recv_line().find("snapshot_too_large"), std::string::npos);

    f.web.set_snapshot_cache_state_for_test(SnapshotCacheState::ERROR);
    c.send_line(R"({"id":3,"op":"point_snapshot","user":"web"})");
    usleep(20000);
    f.web.drain();
    EXPECT_NE(c.recv_line().find("snapshot_error"), std::string::npos);
}

TEST(WebIpc, PointSnapshotStrictlyRejectsInvalidRequests)
{
    const std::vector<std::string> invalid = {
        R"({"id":-1,"op":"point_snapshot","user":"web"})",
        R"({"id":1.5,"op":"point_snapshot","user":"web"})",
        R"({"id":18446744073709551616,"op":"point_snapshot","user":"web"})",
        R"({"id":"1","op":"point_snapshot","user":"web"})",
        R"({"id":1,"op":"point_snapshot","user":""})",
        R"({"id":1,"op":"point_snapshot"})",
        R"({"id":1,"id":2,"op":"point_snapshot","user":"web"})",
        R"({"id":1,"op":"point_snapshot","op":"point_snapshot","user":"web"})",
        R"({"id":1,"op":"point_snapshot","user":"web")",
    };
    for (const std::string& request : invalid) {
        Fixture f;
        ASSERT_TRUE(f.web.open(f.sock_path));
        f.web.publish_point_snapshot(test_snapshot());
        Client c;
        ASSERT_TRUE(c.connect(f.sock_path));
        c.send_line(request);
        usleep(20000);
        f.web.drain();
        EXPECT_NE(c.recv_line().find("bad_request"), std::string::npos) << request;
    }
}

TEST(WebIpc, PointSnapshotRetainsPartialWritesAcrossDrains)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    SendScript script{{-EINTR, 7, -EAGAIN}, {}};
    f.web.set_send_adapter_for_test(scripted_send, &script);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":21,"op":"point_snapshot","user":"web"})");
    usleep(20000);

    f.web.drain();
    EXPECT_FALSE(script.bytes.empty());
    EXPECT_EQ(script.bytes.find('\n'), std::string::npos);
    f.web.drain();

    ASSERT_EQ(std::count(script.bytes.begin(), script.bytes.end(), '\n'), 1);
    const auto json = nlohmann::json::parse(script.bytes.substr(0, script.bytes.size() - 1));
    EXPECT_EQ(json.at("id"), 21u);
    EXPECT_EQ(json.at("points").size(), 24u);
}

TEST(WebIpc, PointSnapshotHalfCloseFlushesQueuedResponseBeforeEof)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    SendScript script{{7, -EAGAIN}, {}};
    f.web.set_send_adapter_for_test(scripted_send, &script);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":23,"op":"point_snapshot","user":"web"})");
    c.shutdown_write();
    usleep(20000);

    f.web.drain();
    EXPECT_EQ(script.bytes.find('\n'), std::string::npos);
    EXPECT_EQ(f.web.client_count_for_test(), 1u);
    f.web.drain();

    ASSERT_EQ(std::count(script.bytes.begin(), script.bytes.end(), '\n'), 1);
    const auto json = nlohmann::json::parse(script.bytes.substr(0, script.bytes.size() - 1));
    EXPECT_EQ(json.at("id"), 23u);
    EXPECT_EQ(f.web.client_count_for_test(), 0u);
}

TEST(WebIpc, LegacyHalfCloseWaitsForScanLoopResponse)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":24,"op":"write","point":"DO1","value":1,"source":"manual","user":"web"})");
    c.shutdown_write();
    usleep(20000);

    const auto commands = f.web.drain();
    ASSERT_EQ(commands.size(), 1u);
    EXPECT_EQ(f.web.client_count_for_test(), 1u);
    f.web.respond_accepted(commands.front(), 1.0f);

    EXPECT_NE(c.recv_line().find("\"id\":24"), std::string::npos);
    f.web.drain();
    EXPECT_EQ(f.web.client_count_for_test(), 0u);
}

TEST(WebIpc, FatalSendErrorsRemoveClientPromptly)
{
    for (const int error : {EPIPE, ECONNRESET}) {
        Fixture f;
        ASSERT_TRUE(f.web.open(f.sock_path));
        f.web.publish_point_snapshot(test_snapshot());
        SendScript script{{-error}, {}};
        f.web.set_send_adapter_for_test(scripted_send, &script);
        Client c;
        ASSERT_TRUE(c.connect(f.sock_path));
        c.send_line(R"({"id":25,"op":"point_snapshot","user":"web"})");
        usleep(20000);

        f.web.drain();
        EXPECT_EQ(f.web.client_count_for_test(), 0u) << error;
    }
}

TEST(WebIpc, InputCapStopsParsingAndClosesDespiteRepeatedEagain)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    SendScript script{{-EAGAIN, -EAGAIN, -EAGAIN}, {}};
    f.web.set_send_adapter_for_test(scripted_send, &script);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_all(std::string(KX_POINT_SNAPSHOT_MAX_PAYLOAD, 'x'));
    usleep(20000);
    for (int i = 0; i < 4; ++i) f.web.drain();
    c.send_all("\n{\"id\":26,\"op\":\"write\",\"point\":\"DO1\",\"value\":1,\"source\":\"manual\",\"user\":\"web\"}\n");
    usleep(20000);

    const auto commands = f.web.drain();
    EXPECT_TRUE(commands.empty());
    EXPECT_EQ(f.web.client_count_for_test(), 0u);
}

TEST(WebIpc, LegacyParserRejectsMalformedNestedDuplicateAndWrongTypes)
{
    const std::vector<std::string> invalid = {
        R"({"id":27,"op":"write","point":"DO1","value":1,"source":"manual","user":"web")",
        R"({"nested":{"id":27,"op":"write","point":"DO1","value":1,"source":"manual"},"user":"web"})",
        R"({"id":27,"id":28,"op":"write","point":"DO1","value":1,"source":"manual","user":"web"})",
        R"({"id":27,"op":{"name":"write"},"point":"DO1","value":1,"source":"manual","user":"web"})",
        R"({"note":"hidden \"op\":\"write\",\"point\":\"DO1\"","id":27,"user":"web"})",
        R"({"id":27,"op":"write","point":"DO1","value":1,"source":"manual","user":"web"} trailing)",
    };
    for (const std::string& request : invalid) {
        Fixture f;
        ASSERT_TRUE(f.web.open(f.sock_path));
        Client c;
        ASSERT_TRUE(c.connect(f.sock_path));
        c.send_line(request);
        usleep(20000);

        EXPECT_TRUE(f.web.drain().empty()) << request;
        EXPECT_NE(c.recv_line().find("bad_request"), std::string::npos) << request;
    }
}

TEST(WebIpc, LegacyParserRejectsInvalidIdsAndFloatValues)
{
    const std::vector<std::string> invalid = {
        R"({"id":-1,"op":"write","point":"DO1","value":1,"source":"manual","user":"web"})",
        R"({"id":1.5,"op":"write","point":"DO1","value":1,"source":"manual","user":"web"})",
        R"({"id":18446744073709551616,"op":"write","point":"DO1","value":1,"source":"manual","user":"web"})",
        R"({"id":"1","op":"write","point":"DO1","value":1,"source":"manual","user":"web"})",
        R"({"id":29,"op":"write","point":"DO1","value":1e999,"source":"manual","user":"web"})",
        R"({"id":29,"op":"write","point":"DO1","value":3.5e38,"source":"manual","user":"web"})",
        R"({"id":29,"op":"write","point":"DO1","value":"1","source":"manual","user":"web"})",
    };
    for (const std::string& request : invalid) {
        Fixture f;
        ASSERT_TRUE(f.web.open(f.sock_path));
        Client c;
        ASSERT_TRUE(c.connect(f.sock_path));
        c.send_line(request);
        usleep(20000);

        EXPECT_TRUE(f.web.drain().empty()) << request;
        const std::string response = c.recv_line();
        const char* expected = request.find("\"id\":29") == std::string::npos
                                   ? "bad_request"
                                   : "bad_value";
        EXPECT_NE(response.find(expected), std::string::npos) << request << response;
    }
}

TEST(WebIpc, OverflowingDurationReturnsExactDomainError)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":30,"op":"alarm_ack","alarmId":"ALM-1","durationS":1e999,"user":"web"})");
    usleep(20000);

    EXPECT_TRUE(f.web.drain().empty());
    const auto response = nlohmann::json::parse(c.recv_line());
    EXPECT_EQ(response.at("error"), "bad_duration");
}

TEST(WebIpc, LegacyOperationsRequireAuditableUser)
{
    const std::vector<std::string> invalid = {
        R"({"id":31,"op":"write","point":"DO1","value":1,"source":"manual"})",
        R"({"id":31,"op":"write","point":"DO1","value":1,"source":"manual","user":""})",
        R"({"id":31,"op":"alarm_list"})",
        R"({"id":31,"op":"alarm_list","user":""})",
        R"({"id":31,"op":"alarm_list","user":"!!!"})",
    };
    for (const std::string& request : invalid) {
        Fixture f;
        ASSERT_TRUE(f.web.open(f.sock_path));
        Client c;
        ASSERT_TRUE(c.connect(f.sock_path));
        c.send_line(request);
        usleep(20000);

        EXPECT_TRUE(f.web.drain().empty()) << request;
        EXPECT_NE(c.recv_line().find("bad_request"), std::string::npos) << request;
    }
}

TEST(WebIpc, PerClientLineQuantumPreventsMonopoly)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client noisy;
    Client quiet;
    ASSERT_TRUE(noisy.connect(f.sock_path));
    ASSERT_TRUE(quiet.connect(f.sock_path));
    std::string requests;
    for (int i = 0; i < 40; ++i)
        requests += "{\"id\":" + std::to_string(100 + i) +
                    ",\"op\":\"release\",\"point\":\"DO1\",\"source\":\"manual\",\"user\":\"web\"}\n";
    noisy.send_all(requests);
    quiet.send_line(R"({"id":999,"op":"release","point":"DO1","source":"manual","user":"web"})");
    usleep(20000);

    const auto commands = f.web.drain();
    EXPECT_LE(commands.size(), 32u);
    EXPECT_NE(std::find_if(commands.begin(), commands.end(),
                           [](const WebCommand& command) { return command.id == 999; }),
              commands.end());
    EXPECT_EQ(f.web.budget_counters_for_test().lines, 17u);
}

TEST(WebIpc, PointSnapshotBudgetsClientsLinesAndAcceptedResponses)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    std::vector<std::unique_ptr<Client>> clients;
    for (int i = 0; i < 4; ++i) {
        auto client = std::make_unique<Client>();
        ASSERT_TRUE(client->connect(f.sock_path));
        clients.push_back(std::move(client));
    }
    std::string requests;
    for (int i = 0; i < 64; ++i)
        requests += "{\"id\":" + std::to_string(i + 1) +
                    ",\"op\":\"point_snapshot\",\"user\":\"web\"}\n";
    ASSERT_EQ(::send(clients[0]->fd(), requests.data(), requests.size(), 0),
              static_cast<ssize_t>(requests.size()));
    usleep(20000);

    f.web.drain();
    const WebIpcBudgetCounters counters = f.web.budget_counters_for_test();
    EXPECT_LE(counters.accept_attempts, 4u);
    EXPECT_LE(counters.read_bytes, 64u * 1024u);
    EXPECT_LE(counters.lines, 64u);
    EXPECT_LE(counters.snapshot_accepted, 1u);
    EXPECT_LE(counters.write_bytes, 64u * 1024u);
    EXPECT_LE(f.web.client_count_for_test(), 4u);
    EXPECT_EQ(f.web.snapshot_serialization_count_for_test(), 1u);
}

TEST(WebIpc, ClosedClientsFreeSlotsBeforeNewAdmission)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    std::vector<std::unique_ptr<Client>> clients;
    for (int i = 0; i < 4; ++i) {
        auto client = std::make_unique<Client>();
        ASSERT_TRUE(client->connect(f.sock_path));
        client->send_line("{\"id\":" + std::to_string(i + 1) +
                          ",\"op\":\"point_snapshot\",\"user\":\"web\"}");
        clients.push_back(std::move(client));
    }
    usleep(20000);
    f.web.drain();
    for (auto& client : clients) {
        EXPECT_FALSE(client->recv_line().empty());
        client->shutdown_write();
    }

    Client replacement;
    ASSERT_TRUE(replacement.connect(f.sock_path));
    replacement.send_line(R"({"id":99,"op":"point_snapshot","user":"web"})");
    usleep(20000);

    f.web.drain();
    const std::string response = replacement.recv_line();
    EXPECT_NE(response.find("\"id\":99"), std::string::npos) << response;
    EXPECT_NE(response.find("\"result\":\"accepted\""), std::string::npos) << response;
    EXPECT_LE(f.web.client_count_for_test(), 4u);
}

TEST(WebIpc, PointSnapshotLeavesRequestBufferedUntilOutputHasRoom)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    SendScript script{{-EAGAIN, -EAGAIN}, {}};
    f.web.set_send_adapter_for_test(scripted_send, &script);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    f.web.drain();
    f.web.set_first_client_output_for_test(
        std::string(KX_POINT_SNAPSHOT_MAX_PAYLOAD - 64u, 'x'));
    c.send_line(R"({"id":31,"op":"point_snapshot","user":"web"})");
    usleep(20000);

    f.web.drain();
    EXPECT_GT(f.web.first_client_input_size_for_test(), 0u);
    EXPECT_EQ(f.web.budget_counters_for_test().lines, 0u);

    f.web.set_first_client_output_for_test({});
    f.web.drain();
    EXPECT_EQ(f.web.first_client_input_size_for_test(), 0u);
    EXPECT_EQ(f.web.budget_counters_for_test().snapshot_accepted, 1u);
}

TEST(WebIpc, ImpossibleSnapshotWrapperWaitsThenQueuesBoundedError)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    f.web.set_snapshot_payload_for_test(
        "{" + std::string(KX_POINT_SNAPSHOT_MAX_PAYLOAD - 2u, 'x') + "}");
    SendScript script{{-EAGAIN}, {}};
    f.web.set_send_adapter_for_test(scripted_send, &script);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    f.web.drain();
    f.web.set_first_client_output_for_test("pending");
    c.send_line(R"({"id":33,"op":"point_snapshot","user":"web"})");
    usleep(20000);

    f.web.drain();
    EXPECT_GT(f.web.first_client_input_size_for_test(), 0u);
    EXPECT_EQ(f.web.budget_counters_for_test().lines, 0u);

    f.web.set_first_client_output_for_test({});
    f.web.drain();
    EXPECT_EQ(f.web.first_client_input_size_for_test(), 0u);
    ASSERT_EQ(std::count(script.bytes.begin(), script.bytes.end(), '\n'), 1);
    EXPECT_NE(script.bytes.find("response_too_large"), std::string::npos);
}

TEST(WebIpc, DrainAndLaterLegacyResponsesShareOneWriteBudget)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot());
    SendScript script;
    f.web.set_send_adapter_for_test(scripted_send, &script);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":34,"op":"point_snapshot","user":"web"})");
    usleep(20000);
    f.web.drain();
    const std::size_t snapshot_bytes = f.web.budget_counters_for_test().write_bytes;
    ASSERT_GT(snapshot_bytes, 0u);

    WebCommand command;
    command.id = 35;
    command.client_fd = f.web.first_client_fd_for_test();
    for (int i = 0; i < 2000; ++i)
        f.web.respond_accepted(command, 1.0f);

    EXPECT_LE(f.web.budget_counters_for_test().write_bytes, 64u * 1024u);
    EXPECT_EQ(f.web.outbound_budget_remaining_for_test() +
                  f.web.budget_counters_for_test().write_bytes,
              64u * 1024u);
}

TEST(WebIpc, PointSnapshotServesSanitizedCachedUtf8)
{
    RuntimePointSnapshot snapshot = test_snapshot();
    snapshot.rows[0].unit = {'x', static_cast<char>(0xE2), '"', '\\', '\n',
                             static_cast<char>(0x01), 'z', '\0', '\0'};
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(snapshot);
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    c.send_line(R"({"id":32,"op":"point_snapshot","user":"web"})");
    usleep(20000);

    f.web.drain();
    const auto json = nlohmann::json::parse(c.recv_line());
    EXPECT_EQ(json.at("points").size(), 24u);
    EXPECT_EQ(json.at("points").at(0).at("unit").get<std::string>(),
              std::string("x\xEF\xBF\xBD\"\\\n\x01z", 9));
}

TEST(WebIpc, ClientDisconnectDoesNotMutateSnapshotCache)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    f.web.publish_point_snapshot(test_snapshot(55));
    {
        Client c;
        ASSERT_TRUE(c.connect(f.sock_path));
        f.web.drain();
    }
    f.web.drain();

    EXPECT_EQ(f.web.snapshot_cache_state_for_test(), SnapshotCacheState::READY);
    EXPECT_EQ(f.web.snapshot_for_test().snapshot_id, 55u);
    EXPECT_FALSE(f.web.snapshot_payload_for_test().empty());
}

TEST(WebIpc, WriteDoFlowsToShm)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    const std::string accepted = c.recv_line();
    EXPECT_NE(accepted.find("\"result\":\"accepted\""), std::string::npos) << accepted;
    EXPECT_EQ(f.shm.do_cmd[0], 1);
}

TEST(WebIpc, ReleaseVirtualKeepsValue)
{
    /* Bug #1 analysis report: release AV trước đây ghi đè value=0.0 */
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":1,"op":"write","point":"AV1","value":42.5,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    c.recv_line();
    EXPECT_FLOAT_EQ(f.table.get({PointKind::AV, 0}).value, 42.5f);
    EXPECT_EQ(f.table.get({PointKind::AV, 0}).source, PointSource::WEB);

    c.send_line(R"({"id":2,"op":"release","point":"AV1","source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos);
    /* #8: applied_value phải là giá trị THỰC còn giữ, không phải 0 */
    EXPECT_NE(resp.find("42.5"), std::string::npos) << resp;

    EXPECT_FLOAT_EQ(f.table.get({PointKind::AV, 0}).value, 42.5f)
        << "release KHÔNG được ghi đè value";
    EXPECT_EQ(f.table.get({PointKind::AV, 0}).source, PointSource::DEFAULT)
        << "release phải nhả source về DEFAULT";
}

TEST(WebIpc, ReleaseDoFallsToDefault)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    c.recv_line();
    EXPECT_EQ(f.shm.do_cmd[0], 1);

    c.send_line(R"({"id":2,"op":"release","point":"DO1","source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    c.recv_line();
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "release manual → rơi về default (open)";
}

TEST(WebIpc, QueryReadOnlyPointDoesNotMutateState)
{
    Fixture f;
    f.shm.ui_value[0] = 23.5f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":31,"op":"query","point":"AI1","source":"manual","user":"hmi"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("23.5"), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"active_source\":\"input\""), std::string::npos) << resp;
}

TEST(WebIpc, ManualOverrideExpiresAtCoreBoundary)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":32,"op":"write","point":"DO1","value":1,"ttlS":1,"source":"manual","user":"hmi"})");
    usleep(50000);
    f.scan();
    const std::string accepted = c.recv_line();
    EXPECT_NE(accepted.find("\"result\":\"accepted\""), std::string::npos) << accepted;
    EXPECT_NE(accepted.find("\"remaining_ttl_s\":1"), std::string::npos) << accepted;
    EXPECT_EQ(f.shm.do_cmd[0], 1);

    usleep(1050000);
    f.scan();
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "TTL phải release mức manual trong Core";
    EXPECT_EQ(f.resolver.winning_do_level(0), PRIO_DEFAULT);
}

TEST(WebIpc, DuplicateIDReturnsCachedResponseWithoutApplyingAgain)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    const std::string command =
        R"({"id":33,"op":"write","point":"DO1","value":1,"source":"manual","user":"hmi"})";

    c.send_line(command);
    usleep(50000);
    f.scan();
    const std::string first = c.recv_line();
    ASSERT_NE(first.find("\"result\":\"accepted\""), std::string::npos) << first;

    c.send_line(command);
    usleep(50000);
    f.scan();
    EXPECT_EQ(c.recv_line(), first);

    c.send_line(R"({"id":33,"op":"write","point":"DO1","value":0,"source":"manual","user":"hmi"})");
    usleep(50000);
    f.scan();
    const std::string conflict = c.recv_line();
    EXPECT_NE(conflict.find("id_conflict"), std::string::npos) << conflict;
    EXPECT_EQ(f.shm.do_cmd[0], 1);
}

TEST(WebIpc, OverriddenWhenFireSafetyWins)
{
    /* COR-007: hệ đang cháy — mức 1 ép DO1=0, web bấm DO1=1 → KHÔNG được trả
     * accepted (relay thực tế vẫn tắt). Contract 07 §8: overridden + applied_value
     * thật + active_source của nguồn thắng. */
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    f.resolver.set_do(PRIO_FIRE_SAFETY, 0, false);   /* mức 1 ép DO1=0 */

    c.send_line(R"({"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"overridden\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"applied_value\":0"), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"active_source\":\"safety\""), std::string::npos) << resp;
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "mức 1 thắng — relay phải tắt";

    /* mức 1 nhả → manual (vẫn giữ trong priority array) thắng lại */
    f.resolver.release_do(PRIO_FIRE_SAFETY, 0);
    c.send_line(R"({"id":2,"op":"write","point":"DO1","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    const std::string resp2 = c.recv_line();
    EXPECT_NE(resp2.find("\"result\":\"accepted\""), std::string::npos) << resp2;
    EXPECT_NE(resp2.find("\"active_source\":\"manual\""), std::string::npos) << resp2;
    EXPECT_EQ(f.shm.do_cmd[0], 1);
}

TEST(WebIpc, OverriddenWhenSafeStateActive)
{
    /* safe-state (T1 iop FAULT) đè mọi nguồn → write trả overridden/safety,
     * applied_value = giá trị safe (DO open = 0) */
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    f.shm.iop_status = KX_IOP_FAULT;
    c.send_line(R"({"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"overridden\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"active_source\":\"safety\""), std::string::npos) << resp;
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "safe-state: DO phải open";
}

TEST(WebIpc, ReleaseReportsWinningSource)
{
    /* release accepted + active_source = nguồn thắng SAU release (default mức 6) */
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    c.recv_line();

    c.send_line(R"({"id":2,"op":"release","point":"DO1","source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"active_source\":\"default\""), std::string::npos) << resp;
}

TEST(WebIpc, AuditLinePerCommand)
{
    /* COR-007: field user không bị vứt — mỗi lệnh 1 dòng AUDIT chuẩn */
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":7,"op":"write","point":"DO2","value":1,"source":"manual","user":"admin"})");
    usleep(50000);
    testing::internal::CaptureStderr();
    f.scan();
    const std::string log = testing::internal::GetCapturedStderr();
    c.recv_line();
    EXPECT_NE(log.find("AUDIT web_cmd id=7 user=admin point=DO2 op=write"),
              std::string::npos) << log;
    EXPECT_NE(log.find("result=accepted"), std::string::npos) << log;
}

TEST(WebIpc, AlarmListReturnsRuntimeSnapshot)
{
    Fixture f;
    f.alarms.configure({high_alarm()});
    f.shm.ui_value[0] = 30.0f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":9,"op":"alarm_list","user":"web"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"alarms\":["), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"id\":\"ALM-1\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"status\":\"active\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"sourcePointId\":\"UI-01\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"triggerLevel\":\"H\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"threshold\":28"), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"priority\":\"high\""), std::string::npos) << resp;
}

TEST(WebIpc, AlarmAckRunsAfterEvaluateAndDoesNotUsePointResolver)
{
    Fixture f;
    f.alarms.configure({high_alarm()});
    f.shm.ui_value[0] = 30.0f;
    f.scan();
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":10,"op":"alarm_ack","alarmId":"ALM-1","user":"web"})");
    usleep(50000);
    f.scan();
    std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"alarmId\":\"ALM-1\""), std::string::npos) << resp;

    c.send_line(R"({"id":11,"op":"alarm_list","user":"web"})");
    usleep(50000);
    f.scan();
    resp = c.recv_line();
    EXPECT_NE(resp.find("\"status\":\"acked\""), std::string::npos) << resp;

    c.send_line(R"({"id":12,"op":"alarm_return","alarmId":"ALM-1","user":"web"})");
    usleep(50000);
    f.scan();
    resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos) << resp;

    c.send_line(R"({"id":13,"op":"alarm_list","user":"web"})");
    usleep(50000);
    f.scan();
    resp = c.recv_line();
    EXPECT_NE(resp.find("\"status\":\"active\""), std::string::npos) << resp;
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "alarm ack must not touch output resolver";
}

TEST(WebIpc, AlarmAckAcceptsDuration)
{
    Fixture f;
    f.alarms.configure({high_alarm()});
    f.shm.ui_value[0] = 30.0f;
    f.scan();
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":14,"op":"alarm_ack","alarmId":"ALM-1","durationS":100,"user":"web"})");
    usleep(50000);
    f.scan();
    std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos) << resp;

    c.send_line(R"({"id":15,"op":"alarm_list","user":"web"})");
    usleep(50000);
    f.scan();
    resp = c.recv_line();
    EXPECT_NE(resp.find("\"status\":\"acked\""), std::string::npos) << resp;
}

TEST(WebIpc, AlarmSuppressHidesAlarmFromList)
{
    Fixture f;
    f.alarms.configure({high_alarm()});
    f.shm.ui_value[0] = 30.0f;
    f.scan();
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":16,"op":"alarm_suppress","alarmId":"ALM-1","permanent":true,"user":"web"})");
    usleep(50000);
    f.scan();
    std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"accepted\""), std::string::npos) << resp;

    c.send_line(R"({"id":17,"op":"alarm_list","user":"web"})");
    usleep(50000);
    f.scan();
    resp = c.recv_line();
    EXPECT_EQ(resp.find("\"id\":\"ALM-1\""), std::string::npos) << resp;
}

TEST(WebIpc, AlarmAckUnknownRejected)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":12,"op":"alarm_ack","alarmId":"missing","user":"web"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("\"result\":\"rejected\""), std::string::npos) << resp;
    EXPECT_NE(resp.find("\"error\":\"unknown_alarm\""), std::string::npos) << resp;
}

TEST(WebIpc, RejectsInvalidRequests)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":1,"op":"write","point":"DO9","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    EXPECT_NE(c.recv_line().find("unknown_point"), std::string::npos);

    c.send_line(R"({"id":2,"op":"write","point":"AI1","value":1,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    EXPECT_NE(c.recv_line().find("readonly_point"), std::string::npos);

    /* BAC-CONFLICT-001 CLOSED 2026-06-17: source=bacnet accepted at prio 3 */
    c.send_line(R"({"id":3,"op":"write","point":"DO1","value":1,"source":"bacnet","user":"t"})");
    usleep(50000);
    f.scan();
    EXPECT_NE(c.recv_line().find("accepted"), std::string::npos)
        << "source=bacnet must be accepted (prio 3);";

    c.send_line(R"({"id":4,"op":"write","point":"DO1","source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    EXPECT_NE(c.recv_line().find("bad_value"), std::string::npos);
}

TEST(ScanLoop, PendingCommandBuffersDoNotReallocateAcrossSteadyLoad)
{
    /* FW SOM group 7 (no-alloc scan hot path). Bản trước khoá "capacity của
     * vector pending_ không tăng lại"; từ X19 (ADR-061 4.10 bước 2) lệnh trong
     * scan nằm trong mảng CỐ ĐỊNH trỏ vào slot của WebIpc, nên test khoá thẳng
     * thuộc tính gốc: step() áp lệnh web (kể cả override có TTL mang user dài
     * hơn SSO) và công bố snapshot với 0 lần cấp phát trên luồng quét. Luồng
     * `web-ipc` có bộ đếm thread_local riêng, nên cấp phát của parse/JSON ở đó
     * không lẫn vào số đo. */
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    ASSERT_TRUE(f.web.start_service_thread("web-ipc-test"));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    EXPECT_EQ(f.loop.pending_capacity_for_test(), kWebCommandSlots);

    const std::string user = "operator.with.a.long.account@site-01:5000";
    auto command = [&](int id, int value) {
        return "{\"id\":" + std::to_string(id) + ",\"op\":\"write\",\"point\":\"DO1\",\"value\":" +
               std::to_string(value) + ",\"ttlS\":60,\"source\":\"manual\",\"user\":\"" + user +
               "\"}";
    };
    c.send_line(command(100, 1));
    ASSERT_TRUE(wait_until([&] { return f.web.queued_commands_for_test() == 1; }));
    f.scan();
    EXPECT_NE(c.recv_line().find("\"result\":\"accepted\""), std::string::npos);

    for (int i = 0; i < 20; i++) {
        c.send_line(command(101 + i, i % 2));
        ASSERT_TRUE(wait_until([&] { return f.web.queued_commands_for_test() == 1; })) << i;
        std::size_t allocations = 0;
        {
            allocation_probe::ScopedCounter counter;
            f.scan();
            allocations = counter.allocations();
        }
        EXPECT_EQ(allocations, 0u) << "step() cấp phát khi áp lệnh web ở lần lặp " << i;
        const std::string response = c.recv_line();
        EXPECT_NE(response.find("\"result\":\"accepted\""), std::string::npos) << response;
        EXPECT_EQ(f.shm.do_cmd[0], i % 2);
        EXPECT_EQ(f.loop.pending_capacity_for_test(), kWebCommandSlots);
    }
}

/* X19 — tràn kênh trao đổi: 64 slot đang chờ luồng quét thì lệnh thứ 65 nhận
 * `rejected busy` NGAY (có AUDIT), không xếp hàng vô hạn và không rơi âm thầm;
 * 64 lệnh kia được áp và trả lời đúng thứ tự nộp; gửi lại id bị "busy" sau đó
 * được xử lý bình thường (busy không bị cache chống lặp). */
TEST(WebIpcOffload, FullExchangeRejectsBusyExplicitlyAndKeepsOrder)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));
    std::string burst;
    for (int id = 1; id <= 65; ++id)
        burst += "{\"id\":" + std::to_string(id) +
                 ",\"op\":\"write\",\"point\":\"AV1\",\"value\":" + std::to_string(id) +
                 ",\"source\":\"manual\",\"user\":\"t\"}\n";
    c.send_all(burst);
    usleep(50000);

    testing::internal::CaptureStderr();
    /* 16 dòng/client mỗi lượt drain: 5 lượt đọc hết 65 dòng. Không có scan nào
     * chạy nên không slot nào được trả. */
    for (int round = 0; round < 5; ++round) f.web.service_intake();
    const std::string log = testing::internal::GetCapturedStderr();
    EXPECT_EQ(f.web.free_slots_for_test(), 0u);
    EXPECT_EQ(f.web.queued_commands_for_test(), kWebCommandSlots);
    const std::string busy = c.recv_line();
    EXPECT_NE(busy.find("\"id\":65"), std::string::npos) << busy;
    EXPECT_NE(busy.find("\"error\":\"busy\""), std::string::npos) << busy;
    EXPECT_NE(log.find("AUDIT web_cmd id=65 user=t point=AV1 op=write"), std::string::npos) << log;
    EXPECT_NE(log.find("result=rejected"), std::string::npos) << log;

    /* Luồng quét lấy đúng thứ tự nộp. */
    std::vector<WebCommandSlot*> taken;
    while (WebCommandSlot* slot = f.web.rt_next_command()) taken.push_back(slot);
    ASSERT_EQ(taken.size(), kWebCommandSlots);
    for (std::size_t i = 0; i < taken.size(); ++i) {
        EXPECT_EQ(taken[i]->cmd.id, i + 1) << "thứ tự FIFO bị đảo ở " << i;
        taken[i]->result = WebCommandResult{WebResultKind::Accepted, "manual",
                                            static_cast<float>(i + 1), 0};
        f.web.rt_complete(taken[i]);
    }
    f.web.service_output(false);
    for (std::size_t i = 0; i < taken.size(); ++i) {
        const std::string response = c.recv_line();
        EXPECT_NE(response.find("\"id\":" + std::to_string(i + 1) + ","), std::string::npos)
            << "trả lời lệch thứ tự: " << response;
        EXPECT_NE(response.find("\"result\":\"accepted\""), std::string::npos) << response;
    }
    EXPECT_EQ(f.web.free_slots_for_test(), kWebCommandSlots);

    c.send_line(R"({"id":65,"op":"write","point":"AV1","value":65,"source":"manual","user":"t"})");
    usleep(50000);
    f.scan();
    const std::string retried = c.recv_line();
    EXPECT_NE(retried.find("\"result\":\"accepted\""), std::string::npos) << retried;
    EXPECT_FLOAT_EQ(f.table.get({PointKind::AV, 0}).value, 65.0f);
}

/* X19 — ngữ nghĩa ranh giới scan: lệnh tới giữa step N (ở đây: đúng bước
 * PUBLISH, sau khi output của N đã ghi) KHÔNG được áp nửa chừng trong N; nó được
 * áp ở đầu step N+1 và trả lời theo output THẬT của N+1. */
TEST(WebIpcOffload, CommandArrivingMidScanAppliesAtNextBoundary)
{
    Fixture f;
    struct Hook {
        WebIpc* web;
        bool armed = true;
    } hook{&f.web};
    f.web.set_rt_publish_observer_for_test(
        [](void* context) {
            auto* h = static_cast<Hook*>(context);
            if (!h->armed) return;
            h->armed = false;
            ASSERT_TRUE(h->web->submit_for_test(point_write(7, PointKind::BO, 0, 1.0f)));
        },
        &hook);

    f.scan();   /* step N: lệnh được nộp ở PUBLISH */
    EXPECT_FALSE(hook.armed);
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "lệnh đến giữa scan không được áp trong chính scan đó";
    EXPECT_EQ(f.resolver.winning_do_level(0), PRIO_DEFAULT);
    EXPECT_EQ(f.web.queued_commands_for_test(), 1u);

    f.scan();   /* step N+1: áp tại ranh giới, output của chính step này */
    EXPECT_EQ(f.shm.do_cmd[0], 1);
    EXPECT_EQ(f.resolver.winning_do_level(0), PRIO_LOCAL_MANUAL);
    EXPECT_EQ(f.web.queued_commands_for_test(), 0u);
    EXPECT_EQ(f.web.free_slots_for_test(), kWebCommandSlots) << "slot phải được trả sau khi trả lời";
}

/* X19 — đường thật với luồng `web-ipc`: step() không chạm socket; lệnh vẫn áp
 * đúng scan, trả lời mang output thật, AUDIT giữ nguyên nội dung; point_snapshot
 * phục vụ bản của scan gần nhất. */
TEST(WebIpcOffload, ServiceThreadAnswersWithTheScanOutputAndAuditIsUnchanged)
{
    Fixture f;
    ASSERT_TRUE(f.web.open(f.sock_path));
    ASSERT_TRUE(f.web.start_service_thread("web-ipc-test"));
    EXPECT_TRUE(f.web.offloaded());
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    testing::internal::CaptureStderr();
    c.send_line(R"({"id":7,"op":"write","point":"DO2","value":1,"source":"manual","user":"admin"})");
    ASSERT_TRUE(wait_until([&] { return f.web.queued_commands_for_test() == 1; }));
    EXPECT_EQ(f.shm.do_cmd[1], 0) << "chưa có scan thì chưa được áp";
    f.scan();
    EXPECT_EQ(f.shm.do_cmd[1], 1);
    const std::string response = c.recv_line();
    const std::string log = testing::internal::GetCapturedStderr();
    EXPECT_NE(response.find("\"result\":\"accepted\""), std::string::npos) << response;
    EXPECT_NE(response.find("\"applied_value\":1"), std::string::npos) << response;
    EXPECT_NE(response.find("\"active_source\":\"manual\""), std::string::npos) << response;
    EXPECT_NE(log.find("AUDIT web_cmd id=7 user=admin point=DO2 op=write value=1 result=accepted"
                       " active_source=manual"),
              std::string::npos)
        << log;

    Client snapshot_client;
    ASSERT_TRUE(snapshot_client.connect(f.sock_path));
    snapshot_client.send_line(R"({"id":8,"op":"point_snapshot","user":"web"})");
    const std::string snapshot = snapshot_client.recv_line();
    ASSERT_FALSE(snapshot.empty());
    const auto json = nlohmann::json::parse(snapshot);
    EXPECT_EQ(json.at("result"), "accepted");
    EXPECT_EQ(json.at("snapshotId"), 1u) << "snapshot phải là bản của scan vừa chạy";
    EXPECT_EQ(json.at("points").at(21).at("id"), "DO-02");

    f.web.stop_service_thread();
    EXPECT_FALSE(f.web.offloaded());
}

TEST(WebIpc, ExtPointWriteCommandAccepted)
{
    Fixture f;
    f.bacnet.attach();
    /* PointWriter chỉ chấp nhận EXT nằm trong ext_count và writable=1 — mô
     * phỏng Point Catalog đã đăng ký point này qua iobus trước khi test ghi. */
    ASSERT_NE(f.bacnet.shm(), nullptr);
    f.bacnet.shm()->ext_count = 1;
    f.bacnet.shm()->ext[0].writable = 1;
    ASSERT_TRUE(f.web.open(f.sock_path));
    Client c;
    ASSERT_TRUE(c.connect(f.sock_path));

    c.send_line(R"({"id":200,"op":"write","point":"EXT1","value":100.5,"source":"manual","user":"admin"})");
    usleep(50000);
    f.scan();
    const std::string resp = c.recv_line();
    EXPECT_NE(resp.find("accepted"), std::string::npos) << "EXT1 write command must be accepted: " << resp;
    if (f.bacnet.shm()) {
        EXPECT_FLOAT_EQ(f.bacnet.shm()->ext[0].setpoint, 100.5f);
        EXPECT_EQ(f.bacnet.shm()->ext[0].dirty, 1u);
        EXPECT_EQ(f.bacnet.shm()->ext_cmd_seq[0], 1u);
    }

    /* Cùng giá trị nhưng request Web MỚI phải có danh tính mới: sau một lệnh
     * Modbus hết TTL, người vận hành vẫn có thể chủ động gửi lại. */
    c.send_line(R"({"id":201,"op":"write","point":"EXT1","value":100.5,"source":"manual","user":"admin"})");
    usleep(50000);
    f.scan();
    const std::string second = c.recv_line();
    EXPECT_NE(second.find("accepted"), std::string::npos) << second;
    EXPECT_EQ(f.bacnet.shm()->ext_cmd_seq[0], 2u);
}
