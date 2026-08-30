#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <limits>
#include <new>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <vector>

#include <nlohmann/json.hpp>

#include "adapters/ipc/iobus_reader.hpp"
#include "graph/runtime_point_snapshot.hpp"
#include "ipc/web_ipc.hpp"

#include "tests/allocation_probe.hpp"
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

TEST(RuntimePointSnapshot, KeepsProgramProposalSeparateFromWinningOverride)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    ASSERT_TRUE(resolver.set_ao(PRIO_LOCAL_LOGIC, 0, 4.0f));
    ASSERT_TRUE(resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 7.0f));
    const OutputCmd resolved = resolver.resolve();

    RuntimePointSnapshotPublisher publisher;
    auto snapshot = publisher.build(1, 1000, 2000, table, io, resolved,
                                    resolver, false);
    snapshot.task.present = true;
    std::memcpy(snapshot.task.id.data(), "main", 5);
    std::memcpy(snapshot.task.state.data(), "RUNNING", 8);
    snapshot.task.period_ms = 1000;
    snapshot.task.budget_ms = 200;
    snapshot.task.overrun_count = 3;

    const auto& ao = snapshot.rows[KX_N_UI];
    EXPECT_FLOAT_EQ(ao.value, 7.0f);
    EXPECT_TRUE(ao.program_value_present);
    EXPECT_FLOAT_EQ(ao.program_value, 4.0f);
    EXPECT_EQ(ao.effective_priority, PRIO_LOCAL_MANUAL);
    EXPECT_EQ(ao.source, SnapshotSource::MANUAL);

    const auto json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    EXPECT_EQ(json.at("safeState"), false);
    EXPECT_EQ(json.at("task").at("taskId"), "main");
    EXPECT_EQ(json.at("task").at("state"), "RUNNING");
    EXPECT_EQ(json.at("task").at("overrunCount"), 3);
    EXPECT_EQ(json.at("points").at(KX_N_UI).at("value"), 7.0);
    EXPECT_EQ(json.at("points").at(KX_N_UI).at("programValue"), 4.0);
    EXPECT_EQ(json.at("points").at(KX_N_UI).at("effectivePriority"), 2);
}

TEST(RuntimePointSnapshot, SafeStateNoControllerOnlyOnlyTrueWhenRequestedAndSafeActive)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    const OutputCmd resolved = resolver.resolve();
    RuntimePointSnapshotPublisher publisher;

    /* Không yêu cầu cờ (default) — luôn false dù safe_state đang active,
     * giữ tương thích ngược cho mọi call site cũ (test_web_ipc.cpp và các
     * TEST khác trong file này không truyền tham số thứ 9). */
    const auto default_arg = publisher.build(1, 10, 100, table, io, resolved, resolver, true);
    EXPECT_TRUE(default_arg.safe_state);
    EXPECT_FALSE(default_arg.safe_state_no_controller_only);

    /* Yêu cầu cờ nhưng safe_state không active — vẫn phải false (T7 không
     * có ý nghĩa khi không ở safe-state). */
    const auto not_safe = publisher.build(2, 20, 200, table, io, resolved, resolver, false, true);
    EXPECT_FALSE(not_safe.safe_state);
    EXPECT_FALSE(not_safe.safe_state_no_controller_only);

    /* safe_state active VÀ caller xác nhận đây là "chỉ do no_controller" —
     * đúng trường hợp scan_loop.cpp tính khi SafeState::Triggers chỉ có
     * no_controller (Commission một Program có output sẽ tự giải quyết). */
    const auto no_controller_only = publisher.build(3, 30, 300, table, io, resolved, resolver, true, true);
    EXPECT_TRUE(no_controller_only.safe_state);
    EXPECT_TRUE(no_controller_only.safe_state_no_controller_only);

    const auto json = nlohmann::json::parse(serialize_runtime_point_snapshot(no_controller_only));
    EXPECT_EQ(json.at("safeState"), true);
    EXPECT_EQ(json.at("safeStateNoControllerOnly"), true);
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

/* ===================================================================
 * T60-004 — bảng `programs[]` trong point_snapshot (Plan 60 §6 P0-A).
 *
 * Bộ test dưới đây khoá phần SERIALIZE ở lớp domain: khoá `programs` luôn có
 * mặt, giá trị đi/về không đổi qua JSON, và tràn buffer đi đúng nhánh
 * fail-closed thay vì phát ra một chuỗi JSON cụt.
 * =================================================================== */

namespace {

/* Dựng một dòng `programs[]` đủ trường. Giữ đúng khuôn bounded của struct
 * thật (không chuỗi động) vì đây là bản sao của thứ nằm trên đường realtime. */
RuntimeProgramSnapshot make_program_row(const char* instance_id, const char* state,
                                        bool enabled, uint32_t period_ms,
                                        uint64_t last_exec_ns, uint64_t max_exec_ns,
                                        uint32_t missed_release_count,
                                        uint32_t consecutive_missed_release,
                                        uint64_t last_run_mono_ns, uint8_t lane)
{
    RuntimeProgramSnapshot row;
    std::memcpy(row.instance_id.data(), instance_id,
                std::min(std::strlen(instance_id), row.instance_id.size() - 1));
    std::memcpy(row.state.data(), state,
                std::min(std::strlen(state), row.state.size() - 1));
    row.enabled = enabled;
    row.period_ms = period_ms;
    row.last_exec_ns = last_exec_ns;
    row.max_exec_ns = max_exec_ns;
    row.missed_release_count = missed_release_count;
    row.consecutive_missed_release = consecutive_missed_release;
    row.last_run_mono_ns = last_run_mono_ns;
    row.lane = lane;
    return row;
}

RuntimePointSnapshot make_base_snapshot(uint64_t snapshot_id)
{
    IoSnapshot io = make_io();
    PointTable table;
    table.update_inputs(io);
    PriorityResolver resolver;
    RuntimePointSnapshotPublisher publisher;
    return publisher.build(snapshot_id, 0, 100, table, io, resolver.resolve(), resolver,
                           false);
}

/* Trường hợp XẤU NHẤT của một dòng: instance_id chạm trần 64 ký tự, tên trạng
 * thái dài nhất, mọi số chạm trần kiểu. Ngân sách payload phải đứng vững ở đây
 * chứ không ở cấu hình phòng lab. */
RuntimeProgramSnapshot make_worst_case_row(std::size_t index)
{
    std::string id(64, 'P');
    const std::string suffix = std::to_string(index);
    id.replace(id.size() - suffix.size(), suffix.size(), suffix);
    return make_program_row(id.c_str(), "ROLLED_BACK", true, 4294967295u,
                            std::numeric_limits<uint64_t>::max(),
                            std::numeric_limits<uint64_t>::max(), 4294967295u,
                            4294967295u, std::numeric_limits<uint64_t>::max(), 255u);
}

} // namespace

/* Rỗng và THIẾU KHOÁ là hai câu trả lời khác nhau: rỗng = "Core sống, hệ không
 * có Program nào"; thiếu khoá = "Core đời cũ chưa biết trường này" ⇒ phía đọc
 * phải ra UNAVAILABLE (Plan 60 §4.2 điều 1, `T60-011`). Test khẳng định KHOÁ CÓ
 * MẶT, không phải khẳng định "đọc ra rỗng" — hai điều đó `.value()` của một
 * parser JSON không phân biệt được. */
TEST(RuntimePointSnapshot, EmptyProgramTableStillEmitsTheProgramsKey)
{
    const RuntimePointSnapshot snapshot = make_base_snapshot(3);
    ASSERT_EQ(snapshot.program_count, 0u);

    const std::string wire = serialize_runtime_point_snapshot(snapshot);
    ASSERT_FALSE(wire.empty());
    EXPECT_NE(wire.find("\"programs\":[]"), std::string::npos)
        << "khoá phải nằm trong chuỗi thô, không phải chỉ 'parse ra rỗng'";

    const auto json = nlohmann::json::parse(wire);
    ASSERT_TRUE(json.contains("programs"))
        << "vắng khoá = Core đời cũ; mảng rỗng = Core sống không có Program";
    EXPECT_TRUE(json.at("programs").is_array());
    EXPECT_TRUE(json.at("programs").empty());
    ASSERT_TRUE(json.contains("programsTruncated"));
    EXPECT_FALSE(json.at("programsTruncated").get<bool>());
}

/* Round-trip: serialize → parse → dựng lại struct → serialize lại phải cho ĐÚNG
 * cùng một chuỗi. Chỉ so từng trường thì một lỗi thứ tự khoá hoặc một trường bị
 * bỏ quên vẫn lọt. */
TEST(RuntimePointSnapshot, SerializesProgramRowsAndSurvivesJsonRoundTrip)
{
    RuntimePointSnapshot snapshot = make_base_snapshot(11);
    snapshot.programs[0] = make_program_row("P_ahu_supply_fan", "RUNNING", true, 1000,
                                            5600000u, 9100000u, 3u, 0u,
                                            123456789012345678ull, 0u);
    snapshot.programs[1] = make_program_row("P_boiler_stage", "FAULTED", false, 30000,
                                            0u, 42u, 4294967295u, 7u,
                                            std::numeric_limits<uint64_t>::max(), 3u);
    snapshot.program_count = 2;

    const std::string wire = serialize_runtime_point_snapshot(snapshot);
    ASSERT_FALSE(wire.empty());
    const auto json = nlohmann::json::parse(wire);
    ASSERT_EQ(json.at("programs").size(), 2u);
    EXPECT_FALSE(json.at("programsTruncated").get<bool>());

    const auto& first = json.at("programs").at(0);
    EXPECT_EQ(first.at("instanceId"), "P_ahu_supply_fan");
    EXPECT_EQ(first.at("state"), "RUNNING");
    EXPECT_TRUE(first.at("enabled").get<bool>());
    EXPECT_EQ(first.at("periodMs").get<uint32_t>(), 1000u);
    EXPECT_EQ(first.at("lastExecNs").get<uint64_t>(), 5600000u);
    EXPECT_EQ(first.at("maxExecNs").get<uint64_t>(), 9100000u);
    EXPECT_EQ(first.at("missedReleaseCount").get<uint32_t>(), 3u);
    EXPECT_EQ(first.at("consecutiveMissedRelease").get<uint32_t>(), 0u);
    EXPECT_EQ(first.at("lastRunMonoNs").get<uint64_t>(), 123456789012345678ull);
    EXPECT_EQ(first.at("lane").get<uint32_t>(), 0u);

    const auto& second = json.at("programs").at(1);
    EXPECT_EQ(second.at("instanceId"), "P_boiler_stage");
    EXPECT_EQ(second.at("state"), "FAULTED");
    EXPECT_FALSE(second.at("enabled").get<bool>());
    EXPECT_EQ(second.at("periodMs").get<uint32_t>(), 30000u);
    EXPECT_EQ(second.at("missedReleaseCount").get<uint32_t>(), 4294967295u);
    EXPECT_EQ(second.at("consecutiveMissedRelease").get<uint32_t>(), 7u);
    EXPECT_EQ(second.at("lastRunMonoNs").get<uint64_t>(),
              std::numeric_limits<uint64_t>::max())
        << "uint64 lớn không được mất chính xác khi qua JSON";
    EXPECT_EQ(second.at("lane").get<uint32_t>(), 3u);

    /* Dựng lại từ JSON rồi serialize lần hai — chuỗi phải trùng khít. */
    RuntimePointSnapshot rebuilt = make_base_snapshot(11);
    for (std::size_t index = 0; index < json.at("programs").size(); ++index) {
        const auto& row = json.at("programs").at(index);
        rebuilt.programs[index] = make_program_row(
            row.at("instanceId").get<std::string>().c_str(),
            row.at("state").get<std::string>().c_str(), row.at("enabled").get<bool>(),
            row.at("periodMs").get<uint32_t>(), row.at("lastExecNs").get<uint64_t>(),
            row.at("maxExecNs").get<uint64_t>(),
            row.at("missedReleaseCount").get<uint32_t>(),
            row.at("consecutiveMissedRelease").get<uint32_t>(),
            row.at("lastRunMonoNs").get<uint64_t>(),
            static_cast<uint8_t>(row.at("lane").get<uint32_t>()));
    }
    rebuilt.program_count = json.at("programs").size();
    rebuilt.programs_truncated = json.at("programsTruncated").get<bool>();
    EXPECT_EQ(serialize_runtime_point_snapshot(rebuilt), wire);
}

/* `program_count` sai không được đọc ra ngoài biên mảng, và việc bị cắt phải
 * NÓI RA. Bỏ bớt trong im lặng làm người vận hành đọc một danh sách thiếu mà
 * tin là đủ. */
TEST(RuntimePointSnapshot, ClampsProgramCountToArrayBoundAndReportsTruncation)
{
    RuntimePointSnapshot snapshot = make_base_snapshot(13);
    for (std::size_t index = 0; index < snapshot.programs.size(); ++index)
        snapshot.programs[index] = make_program_row(
            ("P_" + std::to_string(index)).c_str(), "RUNNING", true, 1000, 10, 20, 0, 0,
            1000 + index, 0);
    snapshot.program_count = snapshot.programs.size() + 7; /* con số hỏng */
    snapshot.programs_truncated = true;

    const auto json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    EXPECT_EQ(json.at("programs").size(), KX_POINT_SNAPSHOT_MAX_PROGRAMS)
        << "phải kẹp theo kích thước mảng, không tin `program_count`";
    EXPECT_TRUE(json.at("programsTruncated").get<bool>());
}

/* Ngân sách payload của Plan 60 §6 `T60-003`: 32 Program TRƯỜNG HỢP XẤU NHẤT
 * vẫn phải nằm trong trần 64 KiB, còn dư chỗ. Đây là con số bảo vệ quyết định
 * "dùng point_snapshot làm kênh xuất" — hết ngân sách thì quyết định đó sai. */
TEST(RuntimePointSnapshot, WorstCaseThirtyTwoProgramPayloadFitsTheSnapshotBudget)
{
    RuntimePointSnapshot snapshot = make_base_snapshot(17);
    for (std::size_t index = 0; index < snapshot.programs.size(); ++index)
        snapshot.programs[index] = make_worst_case_row(index);
    snapshot.program_count = snapshot.programs.size();

    const std::string wire = serialize_runtime_point_snapshot(snapshot);
    ASSERT_FALSE(wire.empty());
    EXPECT_LT(wire.size(), KX_POINT_SNAPSHOT_MAX_PAYLOAD)
        << "payload 32 Program xấu nhất = " << wire.size() << " B";
    const auto json = nlohmann::json::parse(wire);
    EXPECT_EQ(json.at("programs").size(), 32u);
    EXPECT_EQ(json.at("programs").at(0).at("instanceId").get<std::string>().size(), 64u);
    /* In ra số đo thật: ngân sách ở §6 là một con số phải KIỂM ĐƯỢC, không phải
     * một ước lượng chép lại trong tài liệu. */
    std::printf("T60-004 worst-case payload: 32 program = %zu B / tran %zu B\n",
                wire.size(), static_cast<std::size_t>(KX_POINT_SNAPSHOT_MAX_PAYLOAD));
    std::fflush(stdout);
}

/* Nhánh tràn phải FAIL-CLOSED: `serialize` trả false, `*length` = 0 (KHÔNG phát
 * ra chuỗi cụt), và cache của WebIpc bị XOÁ chứ không giữ lại snapshot cũ như
 * thể nó còn đúng. */
TEST(RuntimePointSnapshot, OversizedProgramTableFailsClosedWithoutTruncatedJson)
{
    RuntimePointSnapshot snapshot = make_base_snapshot(19);
    for (std::size_t index = 0; index < snapshot.programs.size(); ++index)
        snapshot.programs[index] = make_worst_case_row(index);
    snapshot.program_count = snapshot.programs.size();

    std::array<char, KX_POINT_SNAPSHOT_MAX_PAYLOAD> buffer{};
    std::size_t full_length = 0;
    ASSERT_TRUE(serialize_runtime_point_snapshot(snapshot, buffer.data(), buffer.size(),
                                                 &full_length));
    ASSERT_GT(full_length, 0u);

    /* Với MỌI sức chứa thiếu, kết quả phải là "không có gì", không phải "một
     * phần". Một chuỗi cụt vẫn có thể parse được ở phía đọc nếu nó vô tình đứt
     * ở chỗ hợp lệ — đó mới là thứ nguy hiểm. */
    for (const std::size_t capacity : {std::size_t{1}, std::size_t{64},
                                       full_length / 2, full_length - 1}) {
        std::vector<char> tight(capacity, '\xff');
        std::size_t length = 12345;
        EXPECT_FALSE(serialize_runtime_point_snapshot(snapshot, tight.data(), capacity,
                                                      &length))
            << "capacity=" << capacity;
        EXPECT_EQ(length, 0u) << "capacity=" << capacity << " — không được phát chuỗi cụt";
    }

    WebIpc web;
    web.publish_point_snapshot(snapshot);
    ASSERT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::READY);
    ASSERT_EQ(web.snapshot_for_test().snapshot_id, 19u);
    ASSERT_EQ(web.snapshot_for_test().program_count, 32u);

    web.set_snapshot_payload_limit_for_test(full_length - 1);
    web.publish_point_snapshot(snapshot);

    EXPECT_EQ(web.snapshot_cache_state_for_test(), SnapshotCacheState::TOO_LARGE);
    EXPECT_TRUE(web.snapshot_payload_for_test().empty())
        << "tràn phải xoá cache, không phục vụ JSON cụt";
    EXPECT_EQ(web.snapshot_for_test().snapshot_id, 0u);
    EXPECT_EQ(web.snapshot_for_test().program_count, 0u);
}

/* Lý do fault phải ĐI RA cùng trạng thái.
 *
 * `StScheduler` vốn đã ghi `last_fault_code`/`last_fault_line` vào Program,
 * nhưng chúng từng CHẾT Ở ĐÓ: không vào snapshot, không ra IPC, không tới API.
 * Hệ quả đo được trên bo Foxlinx: một Program nằm `FAULTED` suốt hai ngày mà
 * không nơi nào nói vì sao — người vận hành chỉ thấy `coreState=FAULTED,
 * lastExecNs=0` và không có gì để lần theo.
 *
 * Báo một trạng thái hỏng mà không kèm lý do là buộc người đọc đoán, và ở một
 * thiết bị điều khiển thì đoán sai có giá.
 */
TEST(RuntimePointSnapshotSerialize, ProgramCarriesFaultReasonToWire)
{
    RuntimePointSnapshot snapshot{};
    snapshot.programs[0] = make_program_row("P_ahu", "FAULTED", true, 1000,
                                            0u, 0u, 0u, 0u, 0ull, 0u);
    const char kFaultCode[] = "ST-RT-BINDING";
    std::memcpy(snapshot.programs[0].last_fault_code.data(), kFaultCode, sizeof(kFaultCode));
    snapshot.programs[0].last_fault_line = 145;
    snapshot.programs[0].fault_count = 3;
    snapshot.program_count = 1;

    const auto json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    const auto& row = json.at("programs").at(0);
    EXPECT_EQ(row.at("lastFaultCode"), "ST-RT-BINDING");
    EXPECT_EQ(row.at("lastFaultLine").get<uint32_t>(), 145u);
    EXPECT_EQ(row.at("faultCount").get<uint32_t>(), 3u);
}

/* Chưa từng fault ⇒ mã RỖNG, không phải một mã bịa.
 *
 * Khoá vẫn phải có mặt: thiếu khoá nghĩa là "Core đời cũ chưa biết trường này",
 * một câu khác hẳn "Program này chưa từng hỏng". */
TEST(RuntimePointSnapshotSerialize, HealthyProgramReportsEmptyFaultCode)
{
    RuntimePointSnapshot snapshot{};
    snapshot.programs[0] = make_program_row("P_ahu", "RUNNING", true, 1000,
                                            5600000u, 9100000u, 0u, 0u, 42ull, 0u);
    snapshot.program_count = 1;

    const auto json = nlohmann::json::parse(serialize_runtime_point_snapshot(snapshot));
    const auto& row = json.at("programs").at(0);
    ASSERT_TRUE(row.contains("lastFaultCode"));
    EXPECT_EQ(row.at("lastFaultCode"), "");
    EXPECT_EQ(row.at("lastFaultLine").get<uint32_t>(), 0u);
    EXPECT_EQ(row.at("faultCount").get<uint32_t>(), 0u);
}
