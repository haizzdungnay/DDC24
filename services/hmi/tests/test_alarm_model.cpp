#include <gtest/gtest.h>

#include <cstring>
#include <string>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include "screens/screen_base.hpp"

namespace hmi {
namespace {

int index_for(const AlarmModel& model, const char* code)
{
    const auto entries = model.snapshot(nullptr);
    for (int i = 0; i < AlarmModel::RING; ++i)
        if (entries[i].used && std::strcmp(entries[i].code, code) == 0) return i;
    return -1;
}

TEST(AlarmModelTest, AckDoesNotClearAnActiveAlarm)
{
    AlarmModel model;
    model.update_condition("F001", true, AlarmSeverity::FAULT, "IOP", "lost");
    EXPECT_EQ(model.active_count(), 1);
    EXPECT_EQ(model.unacked_count(), 1);
    const int idx = index_for(model, "F001");
    ASSERT_GE(idx, 0);
    model.ack(idx);
    EXPECT_EQ(model.active_count(), 1);
    EXPECT_EQ(model.unacked_count(), 0);

    model.update_condition("F001", false, AlarmSeverity::FAULT, "IOP", "restored");
    const auto entries = model.snapshot(nullptr);
    EXPECT_EQ(entries[idx].state, AlarmState::CLEARED_ACK);
    EXPECT_EQ(model.active_count(), 0);
}

TEST(AlarmModelTest, ClearedUnacknowledgedAlarmCanBeAcknowledged)
{
    AlarmModel model;
    const char* json =
        R"({"code":"W001","active":false,"severity":"warn","source":"core"})";
    model.on_alarm_json(json, std::strlen(json));
    const int idx = index_for(model, "W001");
    ASSERT_GE(idx, 0);
    EXPECT_EQ(model.unacked_count(), 1);
    model.ack(idx);
    EXPECT_EQ(model.unacked_count(), 0);
}

TEST(AlarmModelTest, InfoEventsAreNotAcknowledgeable)
{
    AlarmModel model;
    model.update_condition("I001", true, AlarmSeverity::INFO, "core", "start");
    const int idx = index_for(model, "I001");
    ASSERT_GE(idx, 0);
    model.ack(idx);
    EXPECT_EQ(model.unacked_count(), 1);
}

TEST(AlarmModelTest, DrainsExistingAlarmDatagramBus)
{
    const std::string path = "/tmp/mkddc-hmi-alarm-" + std::to_string(getpid()) + ".sock";
    AlarmModel model;
    ASSERT_TRUE(model.open_socket(path));
    const int fd = socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    ASSERT_GE(fd, 0);
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    const char* json =
        R"({"code":"IOP_TIMEOUT","severity":"critical","source":"mkddc-iobus","message":"timeout"})";
    ASSERT_GT(sendto(fd, json, std::strlen(json), 0,
                     reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);
    close(fd);

    model.drain_socket();
    EXPECT_EQ(model.active_count(), 1);
    EXPECT_EQ(model.critical_count(), 1);
    EXPECT_GE(index_for(model, "IOP_TIMEOUT"), 0);
}

} // namespace
} // namespace hmi
