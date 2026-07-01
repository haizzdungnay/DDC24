#include <gtest/gtest.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include "data/point_db.hpp"
#include "platform/core_control.hpp"

namespace hmi {
namespace {

class SafeStateFixture : public ::testing::Test {
protected:
    void SetUp() override
    {
        char pattern[] = "/tmp/mkddc-hmi-safe-db-XXXXXX";
        const int fd = mkstemp(pattern);
        ASSERT_GE(fd, 0);
        close(fd);
        db_path_ = pattern;
        std::ofstream out(db_path_);
        out << R"({"points":[
          {"point_id":"AO1","io_type":"AO","channel":1,"safe_state":2.5},
          {"point_id":"DO1","io_type":"DO","channel":1,"safe_state":false}
        ]})";
        out.close();
        ASSERT_TRUE(db_.load(db_path_));
        socket_path_ = "/tmp/mkddc-hmi-core-" + std::to_string(getpid()) + ".sock";
    }

    void TearDown() override
    {
        unlink(db_path_.c_str());
        unlink(socket_path_.c_str());
    }

    PointDb db_;
    std::string db_path_;
    std::string socket_path_;
};

TEST_F(SafeStateFixture, WaitsForEveryChunkedCoreReply)
{
    const int server = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    ASSERT_GE(server, 0);
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", socket_path_.c_str());
    ASSERT_EQ(bind(server, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);
    ASSERT_EQ(listen(server, 1), 0);

    std::atomic<bool> server_ok{false};
    std::thread responder([&]() {
        const int client = accept4(server, nullptr, nullptr, SOCK_CLOEXEC);
        if (client < 0) return;
        std::string request;
        char buf[1024];
        while (std::count(request.begin(), request.end(), '\n') < 2) {
            const ssize_t n = recv(client, buf, sizeof(buf), 0);
            if (n <= 0) break;
            request.append(buf, static_cast<size_t>(n));
        }
        const char* first = "{\"id\":7000,\"result\":\"accepted\"}\n";
        const char* second = "{\"id\":7001,\"result\":\"accepted\"}\n";
        if (send(client, first, std::strlen(first), MSG_NOSIGNAL) > 0) {
            usleep(20000);
            server_ok.store(send(client, second, std::strlen(second), MSG_NOSIGNAL) > 0);
        }
        close(client);
    });

    CoreControl control(socket_path_);
    EXPECT_TRUE(control.apply_safe_states(db_));
    responder.join();
    close(server);
    EXPECT_TRUE(server_ok.load());
}

TEST(CoreControlTest, RejectsDatabaseWithMissingOutputSafeState)
{
    char pattern[] = "/tmp/mkddc-hmi-unsafe-db-XXXXXX";
    const int fd = mkstemp(pattern);
    ASSERT_GE(fd, 0);
    close(fd);
    {
        std::ofstream out(pattern);
        out << R"({"points":[{"point_id":"DO1","io_type":"DO","channel":1}]})";
    }
    PointDb db;
    ASSERT_TRUE(db.load(pattern));
    unlink(pattern);
    EXPECT_FALSE(CoreControl("/tmp/does-not-matter.sock").apply_safe_states(db));
}

} // namespace
} // namespace hmi
