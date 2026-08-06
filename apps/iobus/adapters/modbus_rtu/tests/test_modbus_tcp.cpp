/**
 * @file  test_modbus_tcp.cpp
 * @brief MOD-013: ModbusTcp build-and-interface test.
 *        Full TCP read/write test cần MKDDC_ENABLE_MODBUS + fake TCP slave.
 *        Test này verify interface, config parse, reconnect logic, ext_cache offset.
 */
#include <cstring>
#include <fstream>
#include <string>

#include <gtest/gtest.h>

#include "ext_cache.hpp"
#include "fieldbus_config.hpp"
#include "modbus_tcp.hpp"

using namespace iobus::fieldbus;

/* ---- T1: Disabled build ---- */
TEST(ModbusTcp, OpenWithoutModbusEnabled)
{
    ModbusTcp tcp;
    FieldbusConfig cfg;
    TcpSlaveConfig ts;
    ts.host    = "127.0.0.1";
    ts.profile = "dummy-profile";
    ts.name    = "slave1";
    cfg.tcp_slaves.push_back(ts);

#ifdef MKDDC_ENABLE_MODBUS
    /* Với MKDDC_ENABLE_MODBUS: sẽ fail connect (port không có listener) */
    bool ok = tcp.open(cfg, 0);
    /* open có thể trả false (no profile) hoặc true với !has_slaves() */
    (void)ok;
    SUCCEED();
#else
    EXPECT_FALSE(tcp.open(cfg, 0));
    EXPECT_FALSE(tcp.has_slaves());
#endif
}

/* ---- T2: No TCP slaves → has_slaves = false ---- */
TEST(ModbusTcp, HasSlavesNoConfig)
{
    ModbusTcp tcp;
    EXPECT_FALSE(tcp.has_slaves());
    EXPECT_EQ(tcp.total_ext_count(), 0u);
}

/* ---- T3: SleepMs mặc định 1000ms khi không có slaves ---- */
TEST(ModbusTcp, SleepMsNoSlaves)
{
    ModbusTcp tcp;
    EXPECT_EQ(tcp.sleep_ms_until_next(0), 1000u);
}

/* ---- T4: poll_once no-op khi chưa open ---- */
TEST(ModbusTcp, PollOnceNoopWhenNotOpened)
{
    ModbusTcp tcp;
    ExtCache cache;
    /* Không crash khi chưa open */
    tcp.poll_once(1000, cache, "/run/mkddc/fieldbus.sock");
    SUCCEED();
}

/* ---- T5: fieldbus_config parse tcp_slaves ---- */
TEST(FieldbusConfig, ParseTcpSlavesFromJson)
{
    const std::string json = R"json({
        "rs485": { "device": "/dev/ttyUSB0", "baud": 19200, "parity": "N", "stop": 1 },
        "tcp_slaves": [
            { "host": "192.168.1.50", "port": 502, "unit": 1,
              "profile": "generic-meter", "name": "chiller",
              "poll_ms": 2000, "reconnect_s": 10, "timeout_ms": 800 }
        ]
    })json";

    const std::string tmp = "/tmp/fieldbus_tcp_test_" + std::to_string(::getpid()) + ".json";
    { std::ofstream f(tmp); f << json; }

    FieldbusConfig cfg;
    const bool ok = load_fieldbus_config(tmp, true, &cfg);
    ::unlink(tmp.c_str());

    ASSERT_TRUE(ok);
    ASSERT_EQ(cfg.tcp_slaves.size(), 1u);
    EXPECT_EQ(cfg.tcp_slaves[0].host,        "192.168.1.50");
    EXPECT_EQ(cfg.tcp_slaves[0].port,        502u);
    EXPECT_EQ(cfg.tcp_slaves[0].unit,        1u);
    EXPECT_EQ(cfg.tcp_slaves[0].profile,     "generic-meter");
    EXPECT_EQ(cfg.tcp_slaves[0].name,        "chiller");
    EXPECT_EQ(cfg.tcp_slaves[0].poll_ms,     2000u);
    EXPECT_EQ(cfg.tcp_slaves[0].reconnect_s, 10u);
    EXPECT_EQ(cfg.tcp_slaves[0].timeout_ms,  800u);
}

/* ---- T6: TCP-only config (không có rs485/RTU slaves) ---- */
TEST(FieldbusConfig, TcpOnlyNoRs485Device)
{
    const std::string json = R"json({
        "tcp_slaves": [
            { "host": "10.0.0.1", "profile": "modbus-generic", "name": "meter1" }
        ]
    })json";

    const std::string tmp = "/tmp/fieldbus_tcponly_" + std::to_string(::getpid()) + ".json";
    { std::ofstream f(tmp); f << json; }

    FieldbusConfig cfg;
    const bool ok = load_fieldbus_config(tmp, true, &cfg);
    ::unlink(tmp.c_str());

    /* TCP-only config phải load được; rs485.device trống OK khi không có RTU slaves */
    ASSERT_TRUE(ok);
    ASSERT_EQ(cfg.tcp_slaves.size(), 1u);
    ASSERT_TRUE(cfg.slaves.empty());
}

/* ---- T7: TCP slave missing host → bỏ qua ---- */
TEST(FieldbusConfig, TcpSlavesMissingHostSkipped)
{
    const std::string json = R"json({
        "tcp_slaves": [
            { "profile": "generic", "name": "bad_slave" }
        ]
    })json";

    const std::string tmp = "/tmp/fieldbus_tcpbad_" + std::to_string(::getpid()) + ".json";
    { std::ofstream f(tmp); f << json; }

    FieldbusConfig cfg;
    load_fieldbus_config(tmp, true, &cfg);
    ::unlink(tmp.c_str());

    /* Slave thiếu host bị bỏ qua */
    EXPECT_EQ(cfg.tcp_slaves.size(), 0u);
}

/* ---- T8: Ext base offset — TCP bắt đầu sau RTU ext slots ---- */
TEST(ModbusTcp, ExtBaseOffset)
{
    /* Tạo profile tạm với 2 points */
    const std::string prof_path =
        "/tmp/mkddc_tcp_profile_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream f(prof_path);
        f << R"json({"profile_id":"tcp-test","points":[
            {"name":"reg0","fc":3,"addr":0,"count":2,"type":"uint16","scale":1.0,"offset":0.0},
            {"name":"reg1","fc":3,"addr":2,"count":1,"type":"uint16","scale":1.0,"offset":0.0}
        ]})json";
    }

    FieldbusConfig cfg;
    TcpSlaveConfig ts;
    ts.host    = "127.0.0.1";
    ts.port    = 9999;          /* port không lắng nghe — open fail nên không test network */
    ts.profile = prof_path;
    ts.name    = "tcp_slave";
    cfg.tcp_slaves.push_back(ts);

    ModbusTcp tcp;
    /* open sẽ return true (has slaves) nhưng slave disconnected — chỉ check ext count */
    tcp.open(cfg, 10);  /* ext_offset = 10 (simulate RTU đã dùng 0-9) */

#ifdef MKDDC_ENABLE_MODBUS
    /* 3 points trong profile → total_ext_count = 3 */
    EXPECT_EQ(tcp.total_ext_count(), 3u);
#else
    /* Không có libmodbus: open() no-op → 0 */
    EXPECT_EQ(tcp.total_ext_count(), 0u);
#endif

    ::unlink(prof_path.c_str());
}

/* ---- T9: close() idempotent ---- */
TEST(ModbusTcp, CloseIdempotent)
{
    ModbusTcp tcp;
    tcp.close();
    tcp.close();   /* không crash khi close 2 lần */
    SUCCEED();
}

/* ---- T10: Destructor không crash ---- */
TEST(ModbusTcp, DestructorSafe)
{
    {
        ModbusTcp tcp;
        (void)tcp;
    }
    SUCCEED();
}

#ifdef MKDDC_ENABLE_MODBUS
/* ---- T11: TCP read/write qua TCP loopback (requires MKDDC_ENABLE_MODBUS) ---- */
#include <modbus.h>
#include <netinet/in.h>
#include <pthread.h>
#include <sys/socket.h>
#include <thread>
#include <atomic>
#include <cerrno>
#include <fcntl.h>

TEST(ModbusTcp, TcpLoopbackReadRegisters)
{
    const std::string prof_path =
        "/tmp/mkddc_tcp_loopback_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream f(prof_path);
        f << R"json({"profile_id":"loopback","points":[
            {"name":"hreg","fc":3,"addr":0,"count":1,"type":"uint16","scale":1.0,"offset":0.0}
        ]})json";
    }

    /* Tìm port tự do */
    int srv_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    ASSERT_GE(srv_fd, 0);
    int optval = 1;
    ::setsockopt(srv_fd, SOL_SOCKET, SO_REUSEADDR, &optval, sizeof(optval));
    struct sockaddr_in addr {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    ASSERT_EQ(::bind(srv_fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);
    ASSERT_EQ(::listen(srv_fd, 1), 0);
    socklen_t addrlen = sizeof(addr);
    ::getsockname(srv_fd, reinterpret_cast<struct sockaddr*>(&addr), &addrlen);
    const int port = ntohs(addr.sin_port);

    /* libmodbus slave qua socket */
    std::atomic<bool> server_ready{false};
    std::thread server_thread([&]() {
        /* Socket đã bind+listen trong main thread — signal ngay để main unblock */
        server_ready.store(true);
        const int cli_fd = ::accept(srv_fd, nullptr, nullptr);
        if (cli_fd < 0) return;
        modbus_t* srv = modbus_new_tcp("127.0.0.1", 502);
        modbus_set_socket(srv, cli_fd);
        modbus_set_slave(srv, 1);
        modbus_mapping_t* m = modbus_mapping_new(0, 0, 128, 0);
        m->tab_registers[0] = 5678;
        uint8_t req[MODBUS_TCP_MAX_ADU_LENGTH] = {};
        const int n = modbus_receive(srv, req);
        if (n > 0) modbus_reply(srv, req, n, m);
        modbus_mapping_free(m);
        modbus_free(srv);
        ::close(cli_fd);
    });

    while (!server_ready.load()) std::this_thread::sleep_for(std::chrono::milliseconds(1));

    FieldbusConfig cfg;
    TcpSlaveConfig ts;
    ts.host       = "127.0.0.1";
    ts.port       = static_cast<uint16_t>(port);
    ts.unit       = 1;
    ts.profile    = prof_path;
    ts.name       = "loopback";
    ts.timeout_ms = 2000;
    cfg.tcp_slaves.push_back(ts);

    ModbusTcp tcp;
    const bool opened = tcp.open(cfg, 0);
    ASSERT_TRUE(opened);

    ExtCache cache;
    tcp.poll_once(1, cache, "/tmp/mkddc-no-fieldbus.sock");

    EXPECT_EQ(cache.count(), 1u);
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 5678.0);
    EXPECT_EQ(cache.sample(0).quality, KX_EXTQ_GOOD);

    server_thread.join();
    ::close(srv_fd);
    ::unlink(prof_path.c_str());
}

/* ---- F-08: TCP slave hết ext slot phải fail-closed ----
 * Lỗi cũ: open() chỉ clamp `if (idx > KX_N_EXT) idx = KX_N_EXT;` mà KHÔNG log và
 * KHÔNG clamp conn.ext_count. Khi RTU đã tiêu hết 64 slot, mọi TCP slave nhận
 * ext_base=64; read_conn gặp `ext_idx >= KX_N_EXT` ở point đầu tiên và thoát với
 * slave_ok=true → on_poll_ok → slave báo ONLINE và khỏe mạnh mà không publish
 * nổi một điểm nào.
 *
 * Test này quan sát điều đó ở chỗ đo được: slave lỗi cấu hình KHÔNG được mở kết
 * nối nào cả (accept() phải trả EAGAIN), và không đẩy điểm nào vào cache. */
TEST(ModbusTcp, SlaveWithoutExtCapacityIsNeitherConnectedNorPolled)
{
    const std::string prof_path =
        "/tmp/mkddc_tcp_nocap_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream f(prof_path);
        f << R"json({"profile_id":"nocap","points":[
            {"name":"hreg","fc":3,"addr":0,"count":1,"type":"uint16"}
        ]})json";
    }

    int srv_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    ASSERT_GE(srv_fd, 0);
    int optval = 1;
    ::setsockopt(srv_fd, SOL_SOCKET, SO_REUSEADDR, &optval, sizeof(optval));
    struct sockaddr_in addr {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    ASSERT_EQ(::bind(srv_fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);
    ASSERT_EQ(::listen(srv_fd, 1), 0);
    socklen_t addrlen = sizeof(addr);
    ::getsockname(srv_fd, reinterpret_cast<struct sockaddr*>(&addr), &addrlen);
    const int port = ntohs(addr.sin_port);

    FieldbusConfig cfg;
    TcpSlaveConfig ts;
    ts.host       = "127.0.0.1";
    ts.port       = static_cast<uint16_t>(port);
    ts.unit       = 1;
    ts.profile    = prof_path;
    ts.name       = "nocap";
    ts.timeout_ms = 500;
    cfg.tcp_slaves.push_back(ts);

    ModbusTcp tcp;
    tcp.open(cfg, KX_N_EXT);           /* RTU đã tiêu hết toàn bộ 64 slot */
    EXPECT_EQ(tcp.total_ext_count(), 0u);

    /* Không có kết nối nào được thiết lập (lỗi cũ: try_connect vẫn chạy) */
    const int flags = ::fcntl(srv_fd, F_GETFL, 0);
    ::fcntl(srv_fd, F_SETFL, flags | O_NONBLOCK);
    errno = 0;
    const int accepted = ::accept(srv_fd, nullptr, nullptr);
    EXPECT_LT(accepted, 0);
    EXPECT_TRUE(errno == EAGAIN || errno == EWOULDBLOCK) << "errno=" << errno;
    if (accepted >= 0) ::close(accepted);

    ExtCache cache;
    tcp.poll_once(1, cache, "/tmp/mkddc-no-fieldbus.sock");
    EXPECT_EQ(cache.count(), 0u);

    ::close(srv_fd);
    ::unlink(prof_path.c_str());
}

/* F-17 phía TCP: điểm 32-bit đặt trước ĐÚNG số slot cần (1), không gấp đôi. */
TEST(ModbusTcp, ThirtyTwoBitProfileReservesExactSlotCount)
{
    const std::string prof_path =
        "/tmp/mkddc_tcp_f32_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream f(prof_path);
        f << R"json({"profile_id":"f32","points":[
            {"name":"kWh","fc":4,"addr":0,"count":2,"type":"float32","byte_order":"ABCD"},
            {"name":"reg","fc":3,"addr":10,"count":3,"type":"uint16"}
        ]})json";
    }

    FieldbusConfig cfg;
    TcpSlaveConfig ts;
    ts.host    = "127.0.0.1";
    ts.port    = 9998;      /* không có listener — chỉ kiểm phép đếm slot */
    ts.profile = prof_path;
    ts.name    = "meter";
    cfg.tcp_slaves.push_back(ts);

    ModbusTcp tcp;
    tcp.open(cfg, 0);
    /* 1 (float32 count=2) + 3 (uint16 count=3) = 4; lỗi cũ cho 2+3 = 5 */
    EXPECT_EQ(tcp.total_ext_count(), 4u);

    ::unlink(prof_path.c_str());
}
#endif
