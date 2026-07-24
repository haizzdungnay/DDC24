#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <limits>
#include <new>
#include <string_view>
#include <tuple>
#include <type_traits>

#include <nlohmann/json.hpp>

#include "graph/runtime_point_snapshot.hpp"
#include "ipc/web_ipc.hpp"

namespace allocation_probe {
thread_local bool enabled = false;
thread_local std::size_t count = 0;

void record() noexcept
{
    if (enabled) ++count;
}

void* allocate(std::size_t size)
{
    record();
    if (void* memory = std::malloc(size == 0 ? 1 : size)) return memory;
    throw std::bad_alloc{};
}

void* allocate_aligned(std::size_t size, std::size_t alignment)
{
    record();
    void* memory = nullptr;
    if (posix_memalign(&memory, alignment, size == 0 ? alignment : size) == 0)
        return memory;
    throw std::bad_alloc{};
}

class ScopedCounter {
public:
    ScopedCounter()
    {
        count = 0;
        enabled = true;
    }
    ~ScopedCounter() { enabled = false; }
    std::size_t allocations() const noexcept { return count; }

    ScopedCounter(const ScopedCounter&) = delete;
    ScopedCounter& operator=(const ScopedCounter&) = delete;
};
} // namespace allocation_probe

void* operator new(std::size_t size) { return allocation_probe::allocate(size); }
void* operator new[](std::size_t size) { return allocation_probe::allocate(size); }
void* operator new(std::size_t size, const std::nothrow_t&) noexcept
{
    try { return allocation_probe::allocate(size); } catch (...) { return nullptr; }
}
void* operator new[](std::size_t size, const std::nothrow_t&) noexcept
{
    try { return allocation_probe::allocate(size); } catch (...) { return nullptr; }
}
void* operator new(std::size_t size, std::align_val_t alignment)
{
    return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
}
void* operator new[](std::size_t size, std::align_val_t alignment)
{
    return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
}
void* operator new(std::size_t size, std::align_val_t alignment,
                   const std::nothrow_t&) noexcept
{
    try {
        return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t size, std::align_val_t alignment,
                     const std::nothrow_t&) noexcept
{
    try {
        return allocation_probe::allocate_aligned(size, static_cast<std::size_t>(alignment));
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete(void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete[](void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete(void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t, std::align_val_t) noexcept
{
    std::free(memory);
}
void operator delete[](void* memory, std::size_t, std::align_val_t) noexcept
{
    std::free(memory);
}
void operator delete(void* memory, std::align_val_t, const std::nothrow_t&) noexcept
{
    std::free(memory);
}
void operator delete[](void* memory, std::align_val_t, const std::nothrow_t&) noexcept
{
    std::free(memory);
}

using namespace core;

namespace {

IoSnapshot make_io()
{
    IoSnapshot io;
    io.ts_ns = 1234;
    for (int i = 0; i < KX_N_UI; ++i) {
        io.ui_value[i] = static_cast<float>(i) + 0.5f;
        io.ui_quality[i] = static_cast<uint8_t>(i % 3);
    }
    std::memcpy(io.ui_unit[0], "degC", 5);
    std::memcpy(io.ui_unit[1], "12345678", 8);
    io.ao_mode[1] = 1;
    io.do_feedback[0] = 1;
    io.do_feedback[1] = 0;
    return io;
}

template <typename T>
std::string_view text(const T& value)
{
    const auto end = std::find(value.begin(), value.end(), '\0');
    return {value.data(), static_cast<std::size_t>(end - value.begin())};
}

} // namespace

TEST(RuntimePointSnapshot, BuildsFixedOrderedPhysicalRows)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    table.set_quality({PointKind::BO, 0}, KX_Q_UNCERTAIN);

    PriorityResolver resolver;
    resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 4.25f);
    resolver.set_ao(PRIO_BACNET, 1, 8.5f);
    const OutputCmd resolved = resolver.resolve();

    RuntimePointSnapshotPublisher publisher;
    const auto snapshot = publisher.build(77, 123456789, 9000, table, io, resolved,
                                          resolver, false);

    static_assert(KX_HIST_PHYSICAL_COUNT == 24);
    static_assert(std::tuple_size_v<decltype(snapshot.rows)> == KX_HIST_PHYSICAL_COUNT);
    EXPECT_EQ(snapshot.snapshot_id, 77u);
    EXPECT_EQ(snapshot.observed_utc_ms, 123456789u);
    EXPECT_EQ(snapshot.captured_monotonic_ns, 9000u);
    EXPECT_EQ(snapshot.rows.size(), 24u);

    for (int channel = 0; channel < KX_N_UI; ++channel) {
        char expected[6];
        std::snprintf(expected, sizeof(expected), "UI-%02d", channel + 1);
        EXPECT_EQ(text(snapshot.rows[channel].id), expected);
        EXPECT_EQ(snapshot.rows[channel].kind, SnapshotPointKind::UI);
    }
    for (int channel = 0; channel < KX_N_AO; ++channel) {
        char expected[6];
        std::snprintf(expected, sizeof(expected), "AO-%02d", channel + 1);
        const std::size_t index = KX_N_UI + static_cast<std::size_t>(channel);
        EXPECT_EQ(text(snapshot.rows[index].id), expected);
        EXPECT_EQ(snapshot.rows[index].kind, SnapshotPointKind::AO);
    }
    for (int channel = 0; channel < KX_N_DO; ++channel) {
        char expected[6];
        std::snprintf(expected, sizeof(expected), "DO-%02d", channel + 1);
        const std::size_t index = KX_N_UI + KX_N_AO + static_cast<std::size_t>(channel);
        EXPECT_EQ(text(snapshot.rows[index].id), expected);
        EXPECT_EQ(snapshot.rows[index].kind, SnapshotPointKind::DO);
    }

    EXPECT_EQ(text(snapshot.rows[0].id), "UI-01");
    EXPECT_EQ(snapshot.rows[0].kind, SnapshotPointKind::UI);
    EXPECT_FLOAT_EQ(snapshot.rows[0].value, 0.5f);
    EXPECT_EQ(snapshot.rows[0].quality, KX_Q_GOOD);
    EXPECT_EQ(snapshot.rows[0].source, SnapshotSource::IO);
    EXPECT_EQ(snapshot.rows[0].role, SnapshotRole::ENGINEERING_VALUE);
    EXPECT_EQ(text(snapshot.rows[0].unit), "degC");
    EXPECT_EQ(snapshot.rows[0].updated_at_monotonic_ns, 1234u);
    EXPECT_EQ(snapshot.rows[0].generation, 1u);
    EXPECT_EQ(text(snapshot.rows[1].unit), "12345678");
    EXPECT_EQ(snapshot.rows[1].quality, KX_Q_UNCERTAIN);
    EXPECT_EQ(text(snapshot.rows[15].id), "UI-16");

    EXPECT_EQ(text(snapshot.rows[16].id), "AO-01");
    EXPECT_EQ(snapshot.rows[16].kind, SnapshotPointKind::AO);
    EXPECT_FLOAT_EQ(snapshot.rows[16].value, 4.25f);
    EXPECT_EQ(snapshot.rows[16].quality, KX_Q_GOOD);
    EXPECT_EQ(snapshot.rows[16].source, SnapshotSource::MANUAL);
    EXPECT_EQ(snapshot.rows[16].role, SnapshotRole::RESOLVED_SETPOINT);
    EXPECT_EQ(text(snapshot.rows[16].unit), "V");
    EXPECT_EQ(snapshot.rows[16].updated_at_monotonic_ns, 9000u);
    EXPECT_EQ(snapshot.rows[16].generation, 1u);
    EXPECT_EQ(text(snapshot.rows[17].id), "AO-02");
    EXPECT_EQ(snapshot.rows[17].source, SnapshotSource::BACNET);
    EXPECT_EQ(text(snapshot.rows[17].unit), "mA");
    EXPECT_EQ(text(snapshot.rows[19].id), "AO-04");

    EXPECT_EQ(text(snapshot.rows[20].id), "DO-01");
    EXPECT_EQ(snapshot.rows[20].kind, SnapshotPointKind::DO);
    EXPECT_FLOAT_EQ(snapshot.rows[20].value, 1.0f);
    EXPECT_EQ(snapshot.rows[20].quality, KX_Q_UNCERTAIN);
    EXPECT_EQ(snapshot.rows[20].source, SnapshotSource::IO);
    EXPECT_EQ(snapshot.rows[20].role, SnapshotRole::HARDWARE_FEEDBACK);
    EXPECT_TRUE(text(snapshot.rows[20].unit).empty());
    EXPECT_EQ(snapshot.rows[20].updated_at_monotonic_ns, 1234u);
    EXPECT_EQ(snapshot.rows[20].generation, 1u);
    EXPECT_EQ(text(snapshot.rows[23].id), "DO-04");
}

TEST(RuntimePointSnapshot, PreservesBoundedSevenAndEightByteUnits)
{
    IoSnapshot io = make_io();
    std::memcpy(io.ui_unit[0], "1234567", 8);
    std::memcpy(io.ui_unit[1], "12345678", 8);
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    RuntimePointSnapshotPublisher publisher;
    const auto snapshot = publisher.build(1, 0, 1, table, io, resolver.resolve(),
                                          resolver, false);

    EXPECT_EQ(text(snapshot.rows[0].unit), "1234567");
    EXPECT_EQ(text(snapshot.rows[1].unit), "12345678");
    const auto json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    EXPECT_EQ(json.at("points").at(0).at("unit"), "1234567");
    EXPECT_EQ(json.at("points").at(1).at("unit"), "12345678");
}

TEST(RuntimePointSnapshot, FormatsUtcWithMillisecondsAndSecondRollover)
{
    RuntimePointSnapshot snapshot;
    snapshot.observed_utc_ms = 1;
    auto json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    EXPECT_EQ(json.at("snapshotObservedAtUtc"), "1970-01-01T00:00:00.001Z");

    snapshot.observed_utc_ms = 999;
    json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    EXPECT_EQ(json.at("snapshotObservedAtUtc"), "1970-01-01T00:00:00.999Z");

    snapshot.observed_utc_ms = 1000;
    json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    EXPECT_EQ(json.at("snapshotObservedAtUtc"), "1970-01-01T00:00:01.000Z");
}

TEST(RuntimePointSnapshot, RejectsTimestampOutsideRfc3339Range)
{
    RuntimePointSnapshot snapshot;
    snapshot.observed_utc_ms = std::numeric_limits<uint64_t>::max();
    std::array<char, KX_POINT_SNAPSHOT_MAX_PAYLOAD> output{};
    std::size_t length = 99;

    EXPECT_FALSE(serialize_runtime_point_snapshot(
        snapshot, output.data(), output.size(), &length));
    EXPECT_EQ(length, 0u);
}

TEST(RuntimePointSnapshot, BuilderUsesFixedStorageAcrossRepeatedBuilds)
{
    static_assert(std::is_trivially_destructible_v<RuntimePointSnapshot>);
    static_assert(std::is_trivially_destructible_v<RuntimePointSnapshotPublisher>);
    static_assert(std::tuple_size_v<decltype(RuntimePointSnapshot{}.rows)> == 24);

    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    const OutputCmd output = resolver.resolve();
    RuntimePointSnapshotPublisher publisher;
    RuntimePointSnapshot snapshot = publisher.build(0, 0, 0, table, io, output,
                                                    resolver, false);
    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (uint64_t id = 1; id <= 1000; ++id)
            snapshot = publisher.build(id, id, id, table, io, output, resolver, false);
        allocations = counter.allocations();
    }

    EXPECT_EQ(allocations, 0u);
    EXPECT_EQ(snapshot.snapshot_id, 1000u);
    EXPECT_EQ(snapshot.rows.size(), 24u);
}

TEST(RuntimePointSnapshot, PublicationAllocatesNothingWithoutClients)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    const OutputCmd output = resolver.resolve();
    RuntimePointSnapshotPublisher publisher;
    WebIpc web;
    RuntimePointSnapshot snapshot = publisher.build(0, 0, 0, table, io, output,
                                                    resolver, false);
    web.publish_point_snapshot(snapshot);

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (uint64_t id = 1; id <= 1000; ++id) {
            snapshot = publisher.build(id, id, id, table, io, output, resolver, false);
            web.publish_point_snapshot(snapshot);
        }
        allocations = counter.allocations();
    }

    EXPECT_EQ(allocations, 0u);
    EXPECT_EQ(web.snapshot_publish_count_for_test(), 1001u);
}

TEST(RuntimePointSnapshot, UsesPostSafeAoAndTracksValueAndSourceChanges)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 8.0f);
    OutputCmd resolved = resolver.resolve();

    RuntimePointSnapshotPublisher publisher;
    const auto first = publisher.build(1, 10, 100, table, io, resolved, resolver, false);
    const auto unchanged = publisher.build(2, 20, 200, table, io, resolved, resolver, false);
    EXPECT_EQ(first.rows[16].updated_at_monotonic_ns, 100u);
    EXPECT_EQ(unchanged.rows[16].updated_at_monotonic_ns, 100u);
    EXPECT_EQ(unchanged.rows[16].role, SnapshotRole::RESOLVED_SETPOINT);
    EXPECT_EQ(text(unchanged.rows[16].unit), "V");

    resolved.ao[0] = 3.0f;
    const auto safe = publisher.build(3, 30, 300, table, io, resolved, resolver, true);
    EXPECT_FLOAT_EQ(safe.rows[16].value, 3.0f);
    EXPECT_EQ(safe.rows[16].source, SnapshotSource::SAFETY);
    EXPECT_EQ(safe.rows[16].role, SnapshotRole::RESOLVED_SETPOINT);
    EXPECT_EQ(text(safe.rows[16].unit), "V");
    EXPECT_EQ(safe.rows[16].updated_at_monotonic_ns, 300u);

    const auto same_safe = publisher.build(4, 40, 400, table, io, resolved, resolver, true);
    EXPECT_EQ(same_safe.rows[16].updated_at_monotonic_ns, 300u);

    resolver.release_ao(PRIO_LOCAL_MANUAL, 0);
    resolver.set_ao(PRIO_SCHEDULE, 0, 3.0f);
    const auto source_changed = publisher.build(5, 50, 500, table, io, resolved,
                                                resolver, false);
    EXPECT_EQ(source_changed.rows[16].source, SnapshotSource::SCHEDULE);
    EXPECT_EQ(source_changed.rows[16].role, SnapshotRole::RESOLVED_SETPOINT);
    EXPECT_EQ(text(source_changed.rows[16].unit), "V");
    EXPECT_EQ(source_changed.rows[16].updated_at_monotonic_ns, 500u);
}

TEST(RuntimePointSnapshot, MapsDefaultAndPrioritySafetySources)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;

    RuntimePointSnapshotPublisher publisher;
    const OutputCmd defaults = resolver.resolve();
    const auto default_snapshot = publisher.build(1, 10, 100, table, io, defaults,
                                                  resolver, false);
    EXPECT_EQ(default_snapshot.rows[16].source, SnapshotSource::DEFAULT);

    resolver.set_ao(PRIO_FIRE_SAFETY, 0, 2.0f);
    const OutputCmd safety_output = resolver.resolve();
    const auto priority_safety = publisher.build(2, 20, 200, table, io, safety_output,
                                                 resolver, false);
    EXPECT_EQ(priority_safety.rows[16].source, SnapshotSource::SAFETY);

    resolver.release_ao(PRIO_FIRE_SAFETY, 0);
    const auto active_safe_state = publisher.build(3, 30, 300, table, io, defaults,
                                                   resolver, true);
    EXPECT_EQ(active_safe_state.rows[16].source, SnapshotSource::SAFETY);
}

TEST(RuntimePointSnapshot, TracksAoQualityTransitions)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    OutputCmd output;
    output.ao[0] = 7.0f;
    output.ao_valid[0] = true;

    RuntimePointSnapshotPublisher publisher;
    const auto valid = publisher.build(1, 10, 100, table, io, output, resolver, false);
    output.ao_valid[0] = false;
    const auto invalid = publisher.build(2, 20, 200, table, io, output, resolver, false);
    const auto stable_invalid = publisher.build(3, 30, 300, table, io, output, resolver, false);

    EXPECT_EQ(valid.rows[16].quality, KX_Q_GOOD);
    EXPECT_EQ(valid.rows[16].updated_at_monotonic_ns, 100u);
    EXPECT_FLOAT_EQ(invalid.rows[16].value, 7.0f);
    EXPECT_EQ(invalid.rows[16].quality, KX_Q_BAD);
    EXPECT_EQ(invalid.rows[16].source, SnapshotSource::DEFAULT);
    EXPECT_EQ(invalid.rows[16].role, SnapshotRole::RESOLVED_SETPOINT);
    EXPECT_EQ(text(invalid.rows[16].unit), "V");
    EXPECT_EQ(invalid.rows[16].updated_at_monotonic_ns, 200u);
    EXPECT_EQ(stable_invalid.rows[16].quality, KX_Q_BAD);
    EXPECT_EQ(stable_invalid.rows[16].updated_at_monotonic_ns, 200u);
}

TEST(RuntimePointSnapshot, RejectsNonFiniteAoValuesBeforeSnapshotPublication)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    resolver.set_ao(PRIO_LOCAL_LOGIC, 0, std::numeric_limits<float>::quiet_NaN());
    OutputCmd resolved = resolver.resolve();

    RuntimePointSnapshotPublisher publisher;
    const auto first_nan = publisher.build(1, 10, 600, table, io, resolved, resolver, false);
    resolved.ao[0] = std::numeric_limits<float>::quiet_NaN();
    const auto second_nan = publisher.build(2, 20, 700, table, io, resolved, resolver, false);
    resolved.ao[0] = std::numeric_limits<float>::infinity();
    const auto first_inf = publisher.build(3, 30, 800, table, io, resolved, resolver, false);
    const auto second_inf = publisher.build(4, 40, 900, table, io, resolved, resolver, false);
    resolved.ao[0] = -std::numeric_limits<float>::infinity();
    const auto negative_inf = publisher.build(5, 50, 1000, table, io, resolved, resolver, false);
    const auto stable_negative_inf = publisher.build(6, 60, 1100, table, io, resolved,
                                                     resolver, false);

    EXPECT_FLOAT_EQ(first_nan.rows[16].value, 0.0f);
    EXPECT_TRUE(std::isnan(second_nan.rows[16].value));
    EXPECT_EQ(first_nan.rows[16].quality, KX_Q_GOOD);
    EXPECT_EQ(second_nan.rows[16].quality, KX_Q_BAD);
    EXPECT_EQ(first_nan.rows[16].source, SnapshotSource::DEFAULT);
    EXPECT_EQ(second_nan.rows[16].source, SnapshotSource::DEFAULT);
    EXPECT_EQ(first_nan.rows[16].updated_at_monotonic_ns, 600u);
    EXPECT_EQ(second_nan.rows[16].updated_at_monotonic_ns, 700u);
    EXPECT_EQ(first_inf.rows[16].value, std::numeric_limits<float>::infinity());
    EXPECT_EQ(first_inf.rows[16].quality, KX_Q_BAD);
    EXPECT_EQ(first_inf.rows[16].updated_at_monotonic_ns, 800u);
    EXPECT_EQ(second_inf.rows[16].updated_at_monotonic_ns, 800u);
    EXPECT_EQ(negative_inf.rows[16].value, -std::numeric_limits<float>::infinity());
    EXPECT_EQ(negative_inf.rows[16].quality, KX_Q_BAD);
    EXPECT_EQ(negative_inf.rows[16].updated_at_monotonic_ns, 1000u);
    EXPECT_EQ(stable_negative_inf.rows[16].updated_at_monotonic_ns, 1000u);

    const auto positive_wire = nlohmann::json::parse(
        serialize_runtime_point_snapshot(first_inf));
    const auto negative_wire = nlohmann::json::parse(
        serialize_runtime_point_snapshot(negative_inf));
    EXPECT_TRUE(positive_wire.at("points").at(16).at("value").is_null());
    EXPECT_EQ(positive_wire.at("points").at(16).at("quality"), "BAD");
    EXPECT_TRUE(negative_wire.at("points").at(16).at("value").is_null());
    EXPECT_EQ(negative_wire.at("points").at(16).at("quality"), "BAD");
}

TEST(RuntimePointSnapshot, TracksAoUnitTransitions)
{
    IoSnapshot io = make_io();
    io.ao_mode[0] = 0;
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    const OutputCmd output = resolver.resolve();

    RuntimePointSnapshotPublisher publisher;
    const auto volts = publisher.build(1, 10, 100, table, io, output, resolver, false);
    const auto stable_volts = publisher.build(2, 20, 200, table, io, output, resolver, false);
    io.ao_mode[0] = 1;
    const auto milliamps = publisher.build(3, 30, 300, table, io, output, resolver, false);
    const auto stable_milliamps = publisher.build(4, 40, 400, table, io, output,
                                                  resolver, false);

    EXPECT_EQ(text(volts.rows[16].unit), "V");
    EXPECT_EQ(volts.rows[16].updated_at_monotonic_ns, 100u);
    EXPECT_EQ(stable_volts.rows[16].updated_at_monotonic_ns, 100u);
    EXPECT_EQ(text(milliamps.rows[16].unit), "mA");
    EXPECT_EQ(milliamps.rows[16].updated_at_monotonic_ns, 300u);
    EXPECT_EQ(stable_milliamps.rows[16].updated_at_monotonic_ns, 300u);
}

TEST(RuntimePointSnapshot, CachesBoundedReusableWirePayload)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    resolver.set_ao(PRIO_LOCAL_LOGIC, 0, std::numeric_limits<float>::quiet_NaN());
    const OutputCmd output = resolver.resolve();
    RuntimePointSnapshotPublisher publisher;
    RuntimePointSnapshot snapshot = publisher.build(
        42, 0, 987654321, table, io, output, resolver, false);
    snapshot.rows[16].value = std::numeric_limits<float>::quiet_NaN();
    snapshot.rows[16].quality = KX_Q_BAD;
    snapshot.rows[16].source = SnapshotSource::LOGIC;

    WebIpc web;
    EXPECT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::UNAVAILABLE);
    web.publish_point_snapshot(snapshot);

    ASSERT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::READY);
    const std::string_view first_payload = web.snapshot_payload_for_test();
    const char* const cached_data = first_payload.data();
    ASSERT_FALSE(first_payload.empty());
    EXPECT_LE(first_payload.size(), KX_POINT_SNAPSHOT_MAX_PAYLOAD);
    EXPECT_EQ(web.snapshot_payload_for_test(), first_payload);
    EXPECT_EQ(web.snapshot_payload_for_test().data(), cached_data);

    const auto json = nlohmann::json::parse(first_payload);
    EXPECT_EQ(json.at("snapshotId"), 42u);
    EXPECT_EQ(json.at("snapshotObservedAtUtc"), "1970-01-01T00:00:00.000Z");
    EXPECT_EQ(json.at("capturedMonotonicNs"), 987654321u);
    ASSERT_EQ(json.at("points").size(), 24u);
    const auto& ui = json.at("points").at(0);
    EXPECT_EQ(ui.at("id"), "UI-01");
    EXPECT_EQ(ui.at("kind"), "UI");
    EXPECT_EQ(ui.at("quality"), "GOOD");
    EXPECT_EQ(ui.at("source"), "io");
    EXPECT_EQ(ui.at("role"), "engineering_value");
    const auto& ao = json.at("points").at(16);
    EXPECT_TRUE(ao.at("value").is_null());
    EXPECT_EQ(ao.at("quality"), "BAD");
    EXPECT_EQ(ao.at("source"), "logic");
    EXPECT_EQ(ao.at("role"), "resolved_setpoint");
    const auto& output_feedback = json.at("points").at(20);
    EXPECT_EQ(output_feedback.at("kind"), "DO");
    EXPECT_EQ(output_feedback.at("role"), "hardware_feedback");
}

TEST(RuntimePointSnapshot, RejectsOversizedCachedPayload)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    RuntimePointSnapshotPublisher publisher;
    const RuntimePointSnapshot snapshot = publisher.build(
        1, 0, 100, table, io, resolver.resolve(), resolver, false);

    WebIpc web;
    web.set_snapshot_payload_limit_for_test(1);
    web.publish_point_snapshot(snapshot);

    EXPECT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::TOO_LARGE);
    EXPECT_TRUE(web.snapshot_payload_for_test().empty());
}

TEST(RuntimePointSnapshot, ReplacesInvalidUtf8AndEscapesUnitBytes)
{
    IoSnapshot io = make_io();
    const char invalid_unit[8] = {'x', static_cast<char>(0xE2), '"', '\\', '\n',
                                  static_cast<char>(0x01), 'z', '\0'};
    std::memcpy(io.ui_unit[0], invalid_unit, sizeof(invalid_unit));
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    RuntimePointSnapshotPublisher publisher;
    const RuntimePointSnapshot snapshot = publisher.build(
        7, 0, 700, table, io, resolver.resolve(), resolver, false);

    WebIpc web;
    EXPECT_NO_THROW(web.publish_point_snapshot(snapshot));
    ASSERT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::READY);
    ASSERT_LE(web.snapshot_payload_for_test().size(), KX_POINT_SNAPSHOT_MAX_PAYLOAD);

    const auto json = nlohmann::json::parse(web.snapshot_payload_for_test());
    ASSERT_EQ(json.at("points").size(), 24u);
    EXPECT_EQ(json.at("points").at(0).at("unit").get<std::string>(),
              std::string("x\xEF\xBF\xBD\"\\\n\x01z", 9));
}

TEST(RuntimePointSnapshot, OversizedPublishClearsPreviousSnapshot)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    RuntimePointSnapshotPublisher publisher;
    const RuntimePointSnapshot snapshot = publisher.build(
        9, 0, 900, table, io, resolver.resolve(), resolver, false);

    WebIpc web;
    web.publish_point_snapshot(snapshot);
    ASSERT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::READY);
    ASSERT_EQ(web.snapshot_for_test().snapshot_id, 9u);

    web.set_snapshot_payload_limit_for_test(1);
    web.publish_point_snapshot(snapshot);

    EXPECT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::TOO_LARGE);
    EXPECT_TRUE(web.snapshot_payload_for_test().empty());
    EXPECT_EQ(web.snapshot_for_test().snapshot_id, 0u);
}

TEST(RuntimePointSnapshot, IobusReaderCopiesUiUnit)
{
    kx_io_shm_t shm{};
    shm.magic = KX_SHM_MAGIC;
    std::memcpy(shm.ui_unit[0], "12345678", 8);

    IoSnapshot io;
    ASSERT_TRUE(IobusReader::read_from(&shm, &io));
    EXPECT_EQ(std::string_view(io.ui_unit[0], 8), "12345678");
}
