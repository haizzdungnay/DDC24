#include <gtest/gtest.h>

#include <cstring>
#include <string>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include "data/shm_reader.hpp"
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

TEST(AlarmModelTest, AckWithoutAuthoritativeBrokerDoesNotChangeState)
{
    AlarmModel model;
    model.update_condition("F001", true, AlarmSeverity::FAULT, "IOP", "lost");
    EXPECT_EQ(model.active_count(), 1);
    EXPECT_EQ(model.unacked_count(), 1);
    const int idx = index_for(model, "F001");
    ASSERT_GE(idx, 0);
    model.ack(idx);
    EXPECT_EQ(model.active_count(), 1);
    EXPECT_EQ(model.unacked_count(), 1);

    model.update_condition("F001", false, AlarmSeverity::FAULT, "IOP", "restored");
    const auto entries = model.snapshot(nullptr);
    EXPECT_EQ(entries[idx].state, AlarmState::CLEARED_UNACK);
    EXPECT_EQ(model.active_count(), 0);
}

TEST(AlarmModelTest, ClearedUnacknowledgedAlarmRemainsUntilCoreAck)
{
    AlarmModel model;
    const char* json =
        R"({"code":"W001","active":false,"severity":"warn","source":"core"})";
    model.on_alarm_json(json, std::strlen(json));
    const int idx = index_for(model, "W001");
    ASSERT_GE(idx, 0);
    EXPECT_EQ(model.unacked_count(), 1);
    model.ack(idx);
    EXPECT_EQ(model.unacked_count(), 1);
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

/* F-03 end-to-end: chạy đúng chuỗi của main.cpp (read_all → io_fault_active →
 * update_condition) qua hai chu kỳ dùng LẠI một DataCache. Chu kỳ 1 bình
 * thường, chu kỳ 2 mất io_shm → E001 phải kích. */
TEST(AlarmModelTest, LostIoShmRaisesE001OnReusedDataCache)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 2;
    io.iop_status = KX_IOP_NORMAL;

    ShmReader reader;
    reader.attach_external_io(&io);
    DataCache data;          /* khai báo NGOÀI vòng lặp, như main.cpp:164 */
    AlarmModel model;
    bool io_fault_was_active = false;

    auto cycle = [&] {
        const ReadStatus st = reader.read_all(&data);
        const bool io_fault = io_fault_active(st, data);
        if (io_fault || io_fault_was_active)
            model.update_condition("E001", io_fault, AlarmSeverity::FAULT,
                                   "IOP", "I/O communication fault");
        io_fault_was_active = io_fault;
        return io_fault;
    };

    EXPECT_FALSE(cycle());
    EXPECT_EQ(model.active_count(), 0);
    EXPECT_LT(index_for(model, "E001"), 0);

    /* mkddc-iobus crash và đang tạo lại SHM: magic chưa set xong */
    io.magic = 0u;
    EXPECT_TRUE(cycle());
    EXPECT_EQ(model.active_count(), 1);
    EXPECT_EQ(model.critical_count(), 1);
    EXPECT_GE(index_for(model, "E001"), 0);

    /* iobus sống lại → E001 phải clear */
    io.magic = KX_SHM_MAGIC;
    EXPECT_FALSE(cycle());
    EXPECT_EQ(model.active_count(), 0);
}

/* E002 không được kích bằng fault_flags của chu kỳ trước khi io_shm đã mất. */
TEST(AlarmModelTest, LostIoShmDoesNotFabricateE002)
{
    kx_io_shm_t io{};
    io.magic = KX_SHM_MAGIC;
    io.seq = 2;
    io.iop_status = KX_IOP_NORMAL;
    io.fault_flags = 0x0004u;

    ShmReader reader;
    reader.attach_external_io(&io);
    DataCache data;
    ASSERT_TRUE(mcu_fault_active(reader.read_all(&data), data));

    io.magic = 0u;
    const ReadStatus st = reader.read_all(&data);
    EXPECT_TRUE(io_fault_active(st, data));    /* E001 kích */
    EXPECT_FALSE(mcu_fault_active(st, data));  /* E002 không bịa */
}

} // namespace
} // namespace hmi
