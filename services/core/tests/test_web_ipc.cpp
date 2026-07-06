/**
 * @file  test_web_ipc.cpp
 * @brief Contract 07 §8 qua socket thật + bug #1/#8 analysis report:
 *        release AV không được ghi đè value; applied_value đúng nghĩa;
 *        validate unknown_point/readonly/bad_request.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <cstring>
#include <string>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include "scan_loop.hpp"

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
    EXPECT_NE(c.recv_line().find("\"result\":\"accepted\""), std::string::npos);
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
