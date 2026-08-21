/**
 * @file  test_st_signal_bus.cpp
 * @brief T59-404 — Published Signal: double-buffer, freshness, ba chính sách.
 *
 *        Điều được khoá ở đây không phải "hàm chạy đúng" mà là: consumer KHÔNG
 *        BAO GIỜ thấy một giá trị chưa từng được publish, và khi dữ liệu quá hạn
 *        thì hành vi là thứ ĐÃ KHAI BÁO chứ không phải một mặc định nào đó.
 */
#include <gtest/gtest.h>

#include <atomic>
#include <string>
#include <thread>
#include <vector>

#include "st/st_signal_bus.hpp"
#include "tests/allocation_probe.hpp"

namespace core {
namespace {

constexpr uint64_t kMs = 1000000ull;

StSignalDefinition make_signal(const std::string& name, StStalePolicy policy,
                               uint32_t freshness_ms = 5000)
{
    StSignalDefinition definition;
    definition.name = name;
    definition.publisher_program = "P_pub";
    definition.type = StType::REAL;
    definition.freshness_ms = freshness_ms;
    definition.stale_policy = policy;
    if (policy == StStalePolicy::USE_FALLBACK) {
        definition.fallback.r = -1.0f;
        definition.has_fallback = true;
    }
    return definition;
}

StCell real_cell(float value)
{
    StCell cell{};
    cell.r = value;
    return cell;
}

} // namespace

/* Giá trị vừa publish CHƯA đọc được cho tới boundary. Cho consumer thấy ngay sẽ
 * làm kết quả phụ thuộc vào lane nào chạy trước. */
TEST(StSignalBus, PublishIsInvisibleUntilBoundaryCommit)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SUPPLY", StStalePolicy::HOLD_LAST), &error)) << error;
    const int index = bus.index_of("SUPPLY");
    ASSERT_GE(index, 0);

    ASSERT_TRUE(bus.publish(index, real_cell(21.5f), 1000 * kMs, "P_pub"));
    EXPECT_EQ(bus.read(index, 1000 * kMs).state, StSignalReadState::UNAVAILABLE)
        << "chưa commit mà đã đọc được là đọc bản nháp";

    bus.commit_at_boundary();
    const StSignalRead after = bus.read(index, 1000 * kMs);
    EXPECT_EQ(after.state, StSignalReadState::FRESH);
    EXPECT_FLOAT_EQ(after.value.r, 21.5f);
}

/* Giá trị giữ nguyên qua các chu kỳ publisher không ghi: một signal 30 s không
 * được "biến mất" ở chu kỳ kế tiếp. */
TEST(StSignalBus, ValueSurvivesCyclesWithoutPublish)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SLOW", StStalePolicy::HOLD_LAST, 30000), &error)) << error;
    const int index = bus.index_of("SLOW");
    ASSERT_TRUE(bus.publish(index, real_cell(7.0f), 0, "P_pub"));
    bus.commit_at_boundary();

    for (uint64_t tick = 1; tick <= 10; ++tick) {
        bus.commit_at_boundary();
        const StSignalRead read = bus.read(index, tick * 1000 * kMs);
        EXPECT_EQ(read.state, StSignalReadState::FRESH) << "chu kỳ " << tick;
        EXPECT_FLOAT_EQ(read.value.r, 7.0f) << "chu kỳ " << tick;
    }
}

/* Ba chính sách cho ba hành vi KHÁC nhau khi quá hạn — đó là lý do có ba. */
TEST(StSignalBus, ThreeStalePoliciesBehaveDifferently)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("HELD", StStalePolicy::HOLD_LAST), &error)) << error;
    ASSERT_TRUE(bus.declare(make_signal("FALLEN", StStalePolicy::USE_FALLBACK), &error)) << error;
    ASSERT_TRUE(bus.declare(make_signal("WAITED", StStalePolicy::WAIT), &error)) << error;
    for (const char* name : {"HELD", "FALLEN", "WAITED"})
        ASSERT_TRUE(bus.publish(bus.index_of(name), real_cell(12.0f), 0, "P_pub"));
    bus.commit_at_boundary();

    /* Trong hạn 5 s: cả ba đều FRESH và đều là giá trị thật. */
    for (const char* name : {"HELD", "FALLEN", "WAITED"}) {
        const StSignalRead read = bus.read(bus.index_of(name), 5000 * kMs);
        EXPECT_EQ(read.state, StSignalReadState::FRESH) << name;
        EXPECT_FLOAT_EQ(read.value.r, 12.0f) << name;
    }

    /* Quá hạn: ba đường khác nhau. */
    const StSignalRead held = bus.read(bus.index_of("HELD"), 5001 * kMs);
    EXPECT_EQ(held.state, StSignalReadState::STALE_HELD);
    EXPECT_FLOAT_EQ(held.value.r, 12.0f);

    const StSignalRead fallen = bus.read(bus.index_of("FALLEN"), 5001 * kMs);
    EXPECT_EQ(fallen.state, StSignalReadState::STALE_FALLBACK);
    EXPECT_FLOAT_EQ(fallen.value.r, -1.0f) << "phải là giá trị KHAI BÁO, không phải 0";

    const StSignalRead waited = bus.read(bus.index_of("WAITED"), 5001 * kMs);
    EXPECT_EQ(waited.state, StSignalReadState::UNAVAILABLE);
    EXPECT_EQ(bus.unavailable_read_count(), 1u);
}

/* Chưa ai publish khác với "quá hạn": chỉ `USE_FALLBACK` có câu trả lời khai
 * báo, hai chính sách kia phải nói thẳng là không có dữ liệu. */
TEST(StSignalBus, NeverPublishedIsNotSilentlyZero)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("HELD", StStalePolicy::HOLD_LAST), &error)) << error;
    ASSERT_TRUE(bus.declare(make_signal("FALLEN", StStalePolicy::USE_FALLBACK), &error)) << error;
    bus.commit_at_boundary();

    EXPECT_EQ(bus.read(bus.index_of("HELD"), 0).state, StSignalReadState::UNAVAILABLE);
    const StSignalRead fallen = bus.read(bus.index_of("FALLEN"), 0);
    EXPECT_EQ(fallen.state, StSignalReadState::STALE_FALLBACK);
    EXPECT_FLOAT_EQ(fallen.value.r, -1.0f);
}

/* Producer dừng: giá trị quá hạn theo ĐÚNG freshness, không biến mất tức thì.
 * Rồi hồi phục thì trở lại FRESH ngay ở boundary kế tiếp. */
TEST(StSignalBus, ProducerStopAgesOutThenRecovers)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SUPPLY", StStalePolicy::HOLD_LAST), &error)) << error;
    const int index = bus.index_of("SUPPLY");
    ASSERT_TRUE(bus.publish(index, real_cell(30.0f), 0, "P_pub"));
    bus.commit_at_boundary();

    bus.note_publisher_stopped("P_pub");
    /* Ngay sau khi dừng vẫn còn trong hạn — sự cố có THỜI HẠN, không tức thì. */
    bus.commit_at_boundary();
    EXPECT_EQ(bus.read(index, 3000 * kMs).state, StSignalReadState::FRESH);
    EXPECT_FLOAT_EQ(bus.read(index, 3000 * kMs).value.r, 30.0f);

    bus.commit_at_boundary();
    EXPECT_EQ(bus.read(index, 6000 * kMs).state, StSignalReadState::STALE_HELD);

    /* Hồi phục. */
    ASSERT_TRUE(bus.publish(index, real_cell(31.0f), 7000 * kMs, "P_pub"));
    bus.commit_at_boundary();
    const StSignalRead recovered = bus.read(index, 7000 * kMs);
    EXPECT_EQ(recovered.state, StSignalReadState::FRESH);
    EXPECT_FLOAT_EQ(recovered.value.r, 31.0f);
}

/* Chỉ publisher đã khai mới ghi được. Program khác ghi nghĩa là một tên có hai
 * nguồn sự thật và không ai đọc cấu hình ra được nguồn nào đang thắng. */
TEST(StSignalBus, OnlyDeclaredPublisherMayWrite)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SUPPLY", StStalePolicy::HOLD_LAST), &error)) << error;
    const int index = bus.index_of("SUPPLY");
    EXPECT_FALSE(bus.publish(index, real_cell(1.0f), 0, "P_other"));
    bus.commit_at_boundary();
    EXPECT_EQ(bus.read(index, 0).state, StSignalReadState::UNAVAILABLE);
}

/* Cấu hình mâu thuẫn bị chặn ở lớp khai báo, không đẩy xuống runtime. */
TEST(StSignalBus, RejectsContradictoryDeclarations)
{
    StSignalBus bus;
    std::string error;
    StSignalDefinition no_fallback = make_signal("A", StStalePolicy::HOLD_LAST);
    no_fallback.stale_policy = StStalePolicy::USE_FALLBACK;
    EXPECT_FALSE(bus.declare(no_fallback, &error));
    EXPECT_NE(error.find("đi liền nhau"), std::string::npos) << error;

    StSignalDefinition stray_fallback = make_signal("B", StStalePolicy::HOLD_LAST);
    stray_fallback.has_fallback = true;
    EXPECT_FALSE(bus.declare(stray_fallback, &error));

    ASSERT_TRUE(bus.declare(make_signal("C", StStalePolicy::HOLD_LAST), &error)) << error;
    EXPECT_FALSE(bus.declare(make_signal("C", StStalePolicy::HOLD_LAST), &error))
        << "hai khai báo cùng tên phải bị chặn";
}

/* Enum chính sách là enum ĐÓNG. Một chuỗi lạ phải bị từ chối, không im lặng
 * quay về mặc định. */
TEST(StSignalBus, StalePolicyNameIsAClosedSet)
{
    StStalePolicy policy = StStalePolicy::WAIT;
    EXPECT_TRUE(st_stale_policy_from_name("HOLD_LAST", &policy));
    EXPECT_EQ(policy, StStalePolicy::HOLD_LAST);
    EXPECT_TRUE(st_stale_policy_from_name("USE_FALLBACK", &policy));
    EXPECT_EQ(policy, StStalePolicy::USE_FALLBACK);
    EXPECT_TRUE(st_stale_policy_from_name("WAIT", &policy));
    EXPECT_EQ(policy, StStalePolicy::WAIT);
    for (const char* bad : {"", "hold_last", "USE_LAST", "FALLBACK", "MAGIC"})
        EXPECT_FALSE(st_stale_policy_from_name(bad, &policy)) << bad;
    EXPECT_FALSE(st_stale_policy_from_name(nullptr, &policy));
}

/* KHÔNG đọc rách: consumer chạy song song với publisher phải luôn thấy một giá
 * trị ĐÃ TỪNG được publish trọn vẹn, không bao giờ thấy nửa cũ nửa mới. */
TEST(StSignalBus, ConcurrentReadNeverSeesTornValue)
{
    StSignalBus bus;
    std::string error;
    /* TIME 8 byte: kiểu rộng nhất trong `StCell`, nơi đọc rách dễ lộ nhất trên
     * bus hẹp hơn 64 bit. */
    StSignalDefinition definition;
    definition.name = "WIDE";
    definition.publisher_program = "P_pub";
    definition.type = StType::TIME;
    definition.freshness_ms = 90000;
    definition.stale_policy = StStalePolicy::HOLD_LAST;
    ASSERT_TRUE(bus.declare(definition, &error)) << error;
    const int index = bus.index_of("WIDE");

    std::atomic<bool> stop{false};
    std::atomic<uint64_t> torn{0};
    std::atomic<uint64_t> observed{0};

    std::thread consumer([&]() {
        while (!stop.load(std::memory_order_acquire)) {
            const StSignalRead read = bus.read(index, 0);
            if (read.state == StSignalReadState::UNAVAILABLE) continue;
            observed.fetch_add(1, std::memory_order_relaxed);
            /* Mọi giá trị publish đều có dạng `v * 0x0001000100010001`, nên một
             * giá trị ghép từ hai bản khác nhau sẽ lộ ra ngay. */
            const int64_t value = read.value.t;
            const int64_t unit = static_cast<int64_t>(0x0001000100010001ll);
            if (value % unit != 0) torn.fetch_add(1, std::memory_order_relaxed);
        }
    });

    for (int64_t round = 1; round <= 20000; ++round) {
        StCell cell{};
        cell.t = round * static_cast<int64_t>(0x0001000100010001ll);
        ASSERT_TRUE(bus.publish(index, cell, 0, "P_pub"));
        bus.commit_at_boundary();
    }
    stop.store(true, std::memory_order_release);
    consumer.join();

    EXPECT_EQ(torn.load(), 0u) << "đọc rách: consumer thấy giá trị chưa từng được publish";
    EXPECT_GT(observed.load(), 0u) << "consumer không đọc được lần nào — test không chứng minh gì";
}

/* Hai lần đọc trong CÙNG một chu kỳ phải cho cùng một giá trị: consumer chạy ở
 * hai thời điểm khác nhau trong chu kỳ vẫn thấy cùng một ảnh signal. */
TEST(StSignalBus, ReadsWithinOneCycleAreStable)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SUPPLY", StStalePolicy::HOLD_LAST), &error)) << error;
    const int index = bus.index_of("SUPPLY");
    ASSERT_TRUE(bus.publish(index, real_cell(1.0f), 0, "P_pub"));
    bus.commit_at_boundary();

    const StSignalRead first = bus.read(index, 0);
    /* Publisher ghi giữa chu kỳ — không được ảnh hưởng lần đọc thứ hai. */
    ASSERT_TRUE(bus.publish(index, real_cell(2.0f), 0, "P_pub"));
    const StSignalRead second = bus.read(index, 0);
    EXPECT_EQ(first.generation, second.generation);
    EXPECT_FLOAT_EQ(first.value.r, second.value.r);
    EXPECT_FLOAT_EQ(second.value.r, 1.0f);
}

/* Publish/commit/read không cấp phát: đây là đường quét. */
TEST(StSignalBus, HotPathDoesNotAllocate)
{
    StSignalBus bus;
    std::string error;
    for (int index = 0; index < 32; ++index)
        ASSERT_TRUE(bus.declare(make_signal("S_" + std::to_string(index),
                                            StStalePolicy::HOLD_LAST), &error)) << error;
    std::vector<int> handles;
    for (int index = 0; index < 32; ++index) handles.push_back(bus.index_of("S_" + std::to_string(index)));

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (int handle : handles) bus.publish(handle, real_cell(1.0f), 1000 * kMs, "P_pub");
        bus.commit_at_boundary();
        for (int handle : handles) (void)bus.read(handle, 1000 * kMs);
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
}

} // namespace core
