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
#include <limits>
#include <string>
#include <thread>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_runtime.hpp"
#include "st/st_signal_bus.hpp"
#include "st/st_test_key.hpp"
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

bool build_signal_runtime(const std::string& source, const std::string& instance_id,
                          const std::vector<StPublishedSignalContract>& contracts,
                          StSignalBus* bus, StProgramRuntime* runtime,
                          StDiagnostic* diagnostic, std::string* error)
{
    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = instance_id;
    options.published_signals = contracts;
    StIrModule module;
    if (!compile_st_source(source, &module, diagnostic, options)) return false;
    std::vector<uint8_t> artifact;
    if (!serialize_st_ir(module, &artifact, error) ||
        !sign_st_artifact(&artifact, st_test_secret_key()))
        return false;
    StPreparedProgramHandle prepared;
    StLoadError load_error;
    if (!runtime->prepare(artifact.data(), artifact.size(), &prepared, &load_error)) {
        if (error) *error = load_error.code + ": " + load_error.message;
        return false;
    }
    for (StIrSignalRef& ref : prepared->program.signal_refs) {
        const int index = bus->index_of(ref.name);
        if (index < 0) {
            if (error) *error = "signal không có trong runtime bus: " + ref.name;
            return false;
        }
        ref.runtime_index = static_cast<int16_t>(index);
    }
    prepared->program.signal_bus = bus;
    prepared->program.runtime_instance_id = instance_id;
    return runtime->activate_prepared(std::move(prepared));
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
    EXPECT_EQ(bus.read(index, 1000 * kMs).state, StSignalReadState::STALE_HELD)
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

/* Chưa ai publish cũng đi đúng policy: HOLD_PRIVATE giữ biến local, fallback
 * trả giá trị khai báo, còn WAIT mới chặn consumer. Bus không bịa số 0. */
TEST(StSignalBus, NeverPublishedIsNotSilentlyZero)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("HELD", StStalePolicy::HOLD_LAST), &error)) << error;
    ASSERT_TRUE(bus.declare(make_signal("FALLEN", StStalePolicy::USE_FALLBACK), &error)) << error;
    bus.commit_at_boundary();

    const StSignalRead held = bus.read(bus.index_of("HELD"), 0);
    EXPECT_EQ(held.state, StSignalReadState::STALE_HELD);
    EXPECT_FALSE(held.has_value) << "HOLD_PRIVATE chưa có lần publish đầu không được bịa zero";
    const StSignalRead fallen = bus.read(bus.index_of("FALLEN"), 0);
    EXPECT_EQ(fallen.state, StSignalReadState::STALE_FALLBACK);
    EXPECT_TRUE(fallen.has_value);
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
    EXPECT_EQ(bus.read(index, 0).state, StSignalReadState::STALE_HELD);
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
    EXPECT_FALSE(bus.declare(make_signal("c", StStalePolicy::HOLD_LAST), &error))
        << "hai khai báo cùng tên không phân biệt hoa thường phải bị chặn";

    StSignalDefinition invalid = make_signal("bad-name", StStalePolicy::HOLD_LAST);
    EXPECT_FALSE(bus.declare(invalid, &error));
    invalid = make_signal("NO_PUBLISHER", StStalePolicy::HOLD_LAST);
    invalid.publisher_program.clear();
    EXPECT_FALSE(bus.declare(invalid, &error));
    invalid = make_signal("TOO_FAST", StStalePolicy::HOLD_LAST, 999);
    EXPECT_FALSE(bus.declare(invalid, &error));
    invalid = make_signal("NOT_FINITE", StStalePolicy::USE_FALLBACK);
    invalid.fallback.r = std::numeric_limits<float>::infinity();
    EXPECT_FALSE(bus.declare(invalid, &error));
    invalid = make_signal("NEG_TIME", StStalePolicy::USE_FALLBACK);
    invalid.type = StType::TIME;
    invalid.fallback.t = -1;
    EXPECT_FALSE(bus.declare(invalid, &error));
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

/* F-P59-SIGNAL-READBACK-001 — reader NON-RT (STATUS/Runtime Monitor chạy trên
 * IPC worker thread) không được nhận `value` của chu kỳ này ghép với
 * `published_at_ns` của chu kỳ khác.
 *
 * Test trên chỉ kiểm HÌNH DẠNG của một số 64-bit nên không thấy được lỗi ghép
 * chéo trường: hai trường đều nguyên vẹn, chỉ không thuộc về nhau. Ở đây mốc
 * thời gian được publish CÙNG giá trị (`published_at_ns == round`,
 * `value == round * unit`), nên một cặp lệch chu kỳ lộ ra ngay.
 *
 * Vì sao lỗi này có thật: hai bản chỉ bảo đảm "trọn bản cũ hoặc trọn bản mới"
 * cho reader chạy trong cùng chu kỳ với publisher. Reader non-RT có thể còn
 * đang chép bản `live` khi scan commit — bản đó thành nháp và `publish()` chu
 * kỳ kế ghi đè lên chính nó. */
TEST(StSignalBus, ConcurrentInspectNeverPairsValueWithForeignTimestamp)
{
    StSignalBus bus;
    std::string error;
    StSignalDefinition definition;
    definition.name = "PAIRED";
    definition.publisher_program = "P_pub";
    definition.type = StType::TIME;
    definition.freshness_ms = 90000;
    definition.stale_policy = StStalePolicy::HOLD_LAST;
    ASSERT_TRUE(bus.declare(definition, &error)) << error;
    const int index = bus.index_of("PAIRED");

    std::atomic<bool> stop{false};
    std::atomic<uint64_t> mismatched{0};
    std::atomic<uint64_t> observed{0};
    constexpr int64_t kUnit = static_cast<int64_t>(0x0001000100010001ll);

    std::thread monitor([&]() {
        while (!stop.load(std::memory_order_acquire)) {
            /* `inspect` là đúng hàm mà `inspect_all()` của STATUS dùng, và
             * `now_ns = 0` giữ mọi lần đọc ở FRESH nên test đo đúng thứ cần đo. */
            const StSignalRead read = bus.inspect(index, 0);
            if (!read.has_value) continue;
            observed.fetch_add(1, std::memory_order_relaxed);
            if (read.value.t != static_cast<int64_t>(read.published_at_ns) * kUnit)
                mismatched.fetch_add(1, std::memory_order_relaxed);
        }
    });

    /* 20 000 vòng giữ test ở ~20 ms. Đo thật trên bản CHƯA sửa: bắt được lệch
     * chu kỳ ở 1/3 lần chạy, nên đây là guard XÁC SUẤT — bộ bắt lỗi TẤT ĐỊNH
     * cho chính đường này là chạy nó dưới `-DMKDDC_SANITIZE=thread`
     * (F-P59-SIGNAL-READBACK-001). Nâng số vòng KHÔNG phải cách siết: 400 000
     * vòng làm reader/writer giành nhau `bank_readers_` tới mức test chạy quá
     * 20 phút CPU mà vẫn không tất định. */
    for (uint64_t round = 1; round <= 20000; ++round) {
        StCell cell{};
        cell.t = static_cast<int64_t>(round) * kUnit;
        ASSERT_TRUE(bus.publish(index, cell, round, "P_pub"));
        bus.commit_at_boundary();
    }
    stop.store(true, std::memory_order_release);
    monitor.join();

    EXPECT_EQ(mismatched.load(), 0u)
        << "reader non-RT thấy value và published_at_ns của hai chu kỳ khác nhau";
    EXPECT_GT(observed.load(), 0u) << "monitor không đọc được lần nào — test không chứng minh gì";
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

/* Poll monitor không được tự biến thành một consumer lỗi. Nếu `inspect()` tăng
 * bộ đếm, chỉ cần mở trang Runtime là số unavailable nhảy liên tục dù không
 * Program nào từng đọc signal. */
TEST(StSignalBus, DiagnosticInspectDoesNotCountUnavailableConsumerRead)
{
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SUPPLY", StStalePolicy::WAIT), &error)) << error;
    const int index = bus.index_of("SUPPLY");

    EXPECT_EQ(bus.inspect(index, 0).state, StSignalReadState::UNAVAILABLE);
    EXPECT_EQ(bus.unavailable_read_count(), 0u);
    EXPECT_EQ(bus.read(index, 0).state, StSignalReadState::UNAVAILABLE);
    EXPECT_EQ(bus.unavailable_read_count(), 1u);
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

/* Acceptance F-P59-SIGNAL-001: không chỉ gọi bus trực tiếp. Hai nguồn ST thật
 * phải đi qua semantic, Typed IR, serialize/load, executor rồi mới trao đổi. */
TEST(StSignalSource, ProducerAndConsumerFlowThroughArtifactAndBoundary)
{
    const std::vector<StPublishedSignalContract> contracts = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SHARED_TEMP", StStalePolicy::WAIT), &error))
        << error;

    StProgramRuntime producer;
    StProgramRuntime consumer;
    StDiagnostic diagnostic;
    ASSERT_TRUE(build_signal_runtime(
        "PROGRAM Producer\nVAR value : REAL; END_VAR\n"
        "value := 21.5;\nSIGNAL_PUBLISH(SHARED_TEMP, value);\nEND_PROGRAM\n",
        "P_pub", contracts, &bus, &producer, &diagnostic, &error))
        << diagnostic.code << ": " << diagnostic.message << " " << error;
    ASSERT_TRUE(build_signal_runtime(
        "PROGRAM Consumer\nVAR_OUTPUT observed : REAL; END_VAR\n"
        "observed := SIGNAL_READ(SHARED_TEMP);\nEND_PROGRAM\n",
        "P_cons", contracts, &bus, &consumer, &diagnostic, &error))
        << diagnostic.code << ": " << diagnostic.message << " " << error;

    const StExecResult before = consumer.execute(1000 * kMs);
    EXPECT_FALSE(before.ok);
    EXPECT_TRUE(before.waiting);
    EXPECT_STREQ(before.fault_code, st_diag_code::kRtSignalWait);
    EXPECT_EQ(consumer.fault_count(), 0u) << "WAIT không được biến thành FAULT";

    ASSERT_TRUE(producer.execute(1000 * kMs).ok);
    EXPECT_TRUE(consumer.execute(1000 * kMs).waiting)
        << "publish nháp không được lộ trước boundary";
    bus.commit_at_boundary();
    const StExecResult after = consumer.execute(1000 * kMs);
    ASSERT_TRUE(after.ok) << (after.error != nullptr ? after.error : "");
    StValue observed;
    ASSERT_TRUE(consumer.get_variable("observed", &observed));
    EXPECT_EQ(observed.type, StType::REAL);
    EXPECT_FLOAT_EQ(observed.r, 21.5f);

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        EXPECT_TRUE(producer.execute(2000 * kMs).ok);
        bus.commit_at_boundary();
        EXPECT_TRUE(consumer.execute(2000 * kMs).ok);
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u) << "đường signal runtime không được cấp phát trong scan";
}

/* DDD §7.3: HOLD_PRIVATE giữ nguyên CHÍNH destination local, kể cả trước lần
 * publish đầu tiên và sau khi value hết freshness. Đây là regression test cho
 * lỗi lower SIG_READ qua temp rồi MOV đã ghi đè destination bằng zero/temp cũ. */
TEST(StSignalSource, HoldPrivatePreservesDirectDestination)
{
    const std::vector<StPublishedSignalContract> contracts = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SHARED_TEMP", StStalePolicy::HOLD_LAST), &error));
    StProgramRuntime consumer;
    StDiagnostic diagnostic;
    ASSERT_TRUE(build_signal_runtime(
        "PROGRAM Consumer\nVAR_OUTPUT observed : REAL; END_VAR\n"
        "observed := SIGNAL_READ(SHARED_TEMP);\nEND_PROGRAM\n",
        "P_cons", contracts, &bus, &consumer, &diagnostic, &error))
        << diagnostic.code << ": " << diagnostic.message << " " << error;

    ASSERT_TRUE(consumer.set_variable("observed", StValue::make_real(77.0f)));
    ASSERT_TRUE(consumer.execute(0).ok);
    StValue observed;
    ASSERT_TRUE(consumer.get_variable("observed", &observed));
    EXPECT_FLOAT_EQ(observed.r, 77.0f) << "never-published HOLD_PRIVATE bị ghi đè";

    ASSERT_TRUE(bus.publish(bus.index_of("SHARED_TEMP"), real_cell(12.0f), 0, "P_pub"));
    bus.commit_at_boundary();
    ASSERT_TRUE(consumer.execute(1000 * kMs).ok);
    ASSERT_TRUE(consumer.get_variable("observed", &observed));
    EXPECT_FLOAT_EQ(observed.r, 12.0f);

    ASSERT_TRUE(consumer.set_variable("observed", StValue::make_real(88.0f)));
    ASSERT_TRUE(consumer.execute(6000 * kMs).ok);
    ASSERT_TRUE(consumer.get_variable("observed", &observed));
    EXPECT_FLOAT_EQ(observed.r, 88.0f) << "stale HOLD_PRIVATE bị ghi đè";
}

TEST(StSignalSource, CompilerRejectsSignalReadInsideCompoundExpression)
{
    const std::vector<StPublishedSignalContract> contracts = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = "P_cons";
    options.published_signals = contracts;
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_FALSE(compile_st_source(
        "PROGRAM Consumer\nVAR observed : REAL; END_VAR\n"
        "observed := SIGNAL_READ(SHARED_TEMP) + 1.0;\nEND_PROGRAM\n",
        &module, &diagnostic, options));
    EXPECT_EQ(diagnostic.code, st_diag_code::kSignalReadContext);
}

TEST(StSignalSource, DeclaredReferenceMissingAtRuntimeFaultsContract)
{
    const std::vector<StPublishedSignalContract> contracts = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SHARED_TEMP", StStalePolicy::WAIT), &error));
    StProgramRuntime consumer;
    StDiagnostic diagnostic;
    ASSERT_TRUE(build_signal_runtime(
        "PROGRAM Consumer\nVAR_OUTPUT observed : REAL; END_VAR\n"
        "observed := SIGNAL_READ(SHARED_TEMP);\nEND_PROGRAM\n",
        "P_cons", contracts, &bus, &consumer, &diagnostic, &error));

    /* Mô phỏng package/runtime bank bị trôi sau khi artifact đã bind. Đây không
     * phải unavailable tạm thời nên không được biến thành WAIT vô hạn. */
    bus.clear();
    const StExecResult result = consumer.execute(1000 * kMs);
    EXPECT_FALSE(result.ok);
    EXPECT_FALSE(result.waiting);
    EXPECT_STREQ(result.fault_code, st_diag_code::kRtSignalContract);
    EXPECT_EQ(consumer.fault_count(), 1u);
}

/* SIGNAL_PUBLISH chỉ trở thành side effect sau khi TOÀN chương trình HALT sạch.
 * Publish rồi chia 0 phải rollback cả state lẫn draft signal. */
TEST(StSignalSource, FaultAfterPublishDoesNotLeakDraftValue)
{
    const std::vector<StPublishedSignalContract> contracts = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    StSignalBus bus;
    std::string error;
    ASSERT_TRUE(bus.declare(make_signal("SHARED_TEMP", StStalePolicy::WAIT), &error));
    StProgramRuntime producer;
    StDiagnostic diagnostic;
    ASSERT_TRUE(build_signal_runtime(
        "PROGRAM Producer\nVAR value : REAL; zero : REAL; quotient : REAL; END_VAR\n"
        "value := 42.0;\nzero := 0.0;\nSIGNAL_PUBLISH(SHARED_TEMP, value);\n"
        "quotient := value / zero;\nEND_PROGRAM\n",
        "P_pub", contracts, &bus, &producer, &diagnostic, &error))
        << diagnostic.code << ": " << diagnostic.message << " " << error;
    const StExecResult result = producer.execute(1000 * kMs);
    EXPECT_FALSE(result.ok);
    EXPECT_FALSE(result.waiting);
    EXPECT_STREQ(result.fault_code, st_diag_code::kRtDivByZero);
    bus.commit_at_boundary();
    EXPECT_EQ(bus.read(bus.index_of("SHARED_TEMP"), 1000 * kMs).state,
              StSignalReadState::UNAVAILABLE);
}

TEST(StSignalSource, CompilerRejectsUndeclaredPublisherAndTypeMismatch)
{
    const std::vector<StPublishedSignalContract> contracts = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = "P_other";
    options.published_signals = contracts;
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_FALSE(compile_st_source(
        "PROGRAM Wrong\nSIGNAL_PUBLISH(SHARED_TEMP, 1.0);\nEND_PROGRAM\n",
        &module, &diagnostic, options));
    EXPECT_EQ(diagnostic.code, st_diag_code::kSignalDuplicatePublisher);

    options.program_identity = "P_pub";
    EXPECT_FALSE(compile_st_source(
        "PROGRAM WrongType\nSIGNAL_PUBLISH(SHARED_TEMP, TRUE);\nEND_PROGRAM\n",
        &module, &diagnostic, options));
    EXPECT_EQ(diagnostic.code, st_diag_code::kSignalTypeMismatch);
}

} // namespace core
