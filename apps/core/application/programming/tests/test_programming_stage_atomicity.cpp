/**
 * @file  test_programming_stage_atomicity.cpp
 * @brief F-P59-ATOMIC-001 / T59-501 — bất biến zero-mutation trước `PREPARED`.
 *
 *        Điều được khoá ở đây chỉ có MỘT câu: mọi thất bại xảy ra TRƯỚC khi bản
 *        ghi journal `PREPARED` được fsync phải để live state y hệt lúc trước
 *        khi gọi. Không "gần như y hệt", không "chỉ đổi thứ vô hại".
 *
 *        Vì sao phải chụp cả sáu nhóm chứ không chỉ đếm instance: bản trước của
 *        `stage_impl` giữ đúng số instance nhưng vẫn kịp đổi CHU KỲ của Program
 *        đang chạy và XOÁ TRẮNG bus signal — hai thứ không lộ ra ở phép đếm.
 *        Một test chỉ đếm instance sẽ xanh trên đúng cái lỗi này.
 *
 *        Mỗi test đi theo cùng một khuôn: dựng một gói ĐANG CHẠY thật (đi hết
 *        stage → activate → boundary → output commit → COMMITTED), chụp ảnh live
 *        state, tiêm đúng một lỗi, rồi so lại từng trường.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

#include <sodium.h>
#include <sys/stat.h>
#include <unistd.h>

#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_process_image.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_signal_bus.hpp"
#include "st/st_test_key.hpp"
#include "tests/allocation_probe.hpp"

#include "enable_at_boundary.hpp"

using namespace core;
using namespace core::programming;

namespace {

struct TempTree {
    std::string path;
    TempTree()
    {
        char pattern[] = "/tmp/mkddc-atomic-XXXXXX";
        if (::mkdtemp(pattern) != nullptr) path = pattern;
    }
    ~TempTree()
    {
        if (path.empty()) return;
        std::error_code ignored;
        /* Test tiêm lỗi bằng cách bỏ quyền ghi; trả lại quyền để dọn được. */
        std::filesystem::permissions(path, std::filesystem::perms::owner_all,
                                     std::filesystem::perm_options::add, ignored);
        std::filesystem::remove_all(path, ignored);
    }
};

std::vector<uint8_t> program_ir(const std::string& name, int value)
{
    const std::string source = "PROGRAM " + name + "\nVAR x : DINT; END_VAR\nx := " +
                               std::to_string(value) + ";\nEND_PROGRAM\n";
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

StPackageSignal signal_of(const std::string& name, const std::string& producer,
                          uint32_t freshness_ms, uint8_t stale_policy)
{
    StPackageSignal signal;
    signal.name = name;
    signal.producer_program = producer;
    signal.data_type = static_cast<uint8_t>(StType::REAL);
    signal.freshness_ms = freshness_ms;
    signal.stale_policy = stale_policy;
    return signal;
}

/* Dựng package bằng ĐÚNG writer production. `corrupt_program_index >= 0` làm
 * hỏng IR của đúng một Program để tiêm lỗi "Program thứ N bị loader từ chối". */
std::vector<uint8_t> package_of(const std::vector<std::string>& names,
                                const std::vector<uint32_t>& periods_ms,
                                const std::vector<StPackageSignal>& signals = {},
                                int corrupt_program_index = -1)
{
    StPackageInput input;
    input.signals = signals;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    int value = 1;
    for (std::size_t index = 0; index < names.size(); ++index) {
        const uint32_t period = index < periods_ms.size() ? periods_ms[index] : 0u;
        std::vector<uint8_t> ir = program_ir(names[index], value++);
        if (static_cast<int>(index) == corrupt_program_index && ir.size() > 40) {
            /* Lật một byte GIỮA thân artifact: header còn hợp lệ nên gói vẫn đi
             * qua `split_package`, và lỗi rơi đúng vào `stage_activation` của
             * Program thứ N — chỗ cần tiêm. */
            ir[ir.size() / 2] = static_cast<uint8_t>(ir[ir.size() / 2] ^ 0xFFu);
        }
        input.programs.push_back({names[index], std::move(ir), period, 0u});
        StPouSignature signature;
        signature.name = names[index];
        signature.kind = StPouKind::PROGRAM;
        input.pou_signatures.push_back(signature);
    }
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    return bytes;
}

StageCommand write_candidate(const TempTree& tree, const std::string& operation,
                             const std::string& revision, const std::vector<uint8_t>& bytes,
                             const std::string& instance)
{
    const std::filesystem::path directory =
        std::filesystem::path(tree.path) / "staging" / operation;
    std::filesystem::create_directories(directory);
    const std::filesystem::path locator = directory / "candidate.mkddcir";
    std::ofstream output(locator, std::ios::binary);
    output.write(reinterpret_cast<const char*>(bytes.data()),
                 static_cast<std::streamsize>(bytes.size()));
    output.close();
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(), bytes.data(), bytes.size());
    StageCommand command;
    command.operation_id = operation;
    command.revision_id = revision;
    command.instance_id = instance;
    command.locator = locator.string();
    command.byte_size = bytes.size();
    command.sha256.assign(digest.begin(), digest.end());
    command.plan_hash = std::string(64, 'a');
    return command;
}

void configure_task(StScheduler* scheduler)
{
    StTaskConfig task;
    task.id = "main";
    task.priority = 0;
    task.period_ms = 1000;
    task.budget_ms = 199;
    task.overrun_threshold = 3;
    std::string error;
    ASSERT_TRUE(scheduler->add_task(task, &error)) << error;
}

/* ---- Ảnh chụp live state ----
 *
 * Sáu nhóm đúng theo `PLAN59-CONTRACT-LOCK` §3.1. Đây là hợp đồng của test:
 * thêm một thứ vào live state mà quên thêm vào đây nghĩa là bất biến không còn
 * được canh đầy đủ. */
struct ProgramLiveState {
    std::string instance_id;
    uint32_t period_ms = 0;
    StProgramState state = StProgramState::EMPTY;
    bool enabled = false;
    uint32_t run_count = 0;
    uint32_t fault_count = 0;
    std::vector<uint8_t> activated_artifact;
    std::size_t last_known_good_size = 0;
    bool has_pending = false;

    bool operator==(const ProgramLiveState& other) const
    {
        return instance_id == other.instance_id && period_ms == other.period_ms &&
               state == other.state && enabled == other.enabled && run_count == other.run_count &&
               fault_count == other.fault_count &&
               activated_artifact == other.activated_artifact &&
               last_known_good_size == other.last_known_good_size &&
               has_pending == other.has_pending;
    }
};

struct SignalLiveState {
    std::string name;
    std::string publisher;
    uint32_t freshness_ms = 0;
    StStalePolicy stale_policy = StStalePolicy::HOLD_LAST;
    StSignalReadState read_state = StSignalReadState::NOT_DECLARED;
    float value = 0.0f;
    uint64_t generation = 0;

    bool operator==(const SignalLiveState& other) const
    {
        return name == other.name && publisher == other.publisher &&
               freshness_ms == other.freshness_ms && stale_policy == other.stale_policy &&
               read_state == other.read_state && value == other.value &&
               generation == other.generation;
    }
};

struct LiveSnapshot {
    std::vector<ProgramLiveState> programs;      /* (1) instance + chu kỳ + bộ đếm */
    std::string active_revision_id;              /* (2) revision/artifact/operation */
    std::string lkg_revision_id;
    LifecycleState lifecycle = LifecycleState::IDLE;
    std::vector<std::string> coordinator_instances;
    std::vector<SignalLiveState> signals;        /* (3) khai báo + committed snapshot */
    std::size_t candidate_count = 0;             /* (4) sổ candidate */
    std::vector<std::string> candidate_owners;
};

LiveSnapshot capture(const StScheduler& scheduler,
                     const ProgrammingRuntimeCoordinator& coordinator, StSignalBus* bus,
                     const ProgramCandidateRegistry* candidates, uint64_t now_ns)
{
    LiveSnapshot snapshot;
    auto& mutable_scheduler = const_cast<StScheduler&>(scheduler);
    if (const StTask* task = mutable_scheduler.find_task("main")) {
        for (const auto& program : task->programs()) {
            ProgramLiveState state;
            state.instance_id = program->instance_id;
            state.period_ms = program->period_ms;
            state.state = program->state;
            state.enabled = program->enabled;
            state.run_count = program->run_count;
            state.fault_count = program->fault_count;
            state.activated_artifact = program->activated_artifact;
            state.last_known_good_size = program->last_known_good.size();
            state.has_pending = program->has_pending.load(std::memory_order_acquire);
            snapshot.programs.push_back(std::move(state));
        }
    }
    const RuntimeOperationSnapshot runtime = coordinator.snapshot();
    snapshot.active_revision_id = runtime.active_revision_id;
    snapshot.lkg_revision_id = runtime.lkg_revision_id;
    snapshot.lifecycle = runtime.state;
    snapshot.coordinator_instances = coordinator.instance_ids();
    if (bus != nullptr) {
        for (std::size_t index = 0; index < bus->size(); ++index) {
            const StSignalDefinition definition = bus->definition(static_cast<int>(index));
            const StSignalRead read = bus->inspect(static_cast<int>(index), now_ns);
            SignalLiveState state;
            state.name = definition.name;
            state.publisher = definition.publisher_program;
            state.freshness_ms = definition.freshness_ms;
            state.stale_policy = definition.stale_policy;
            state.read_state = read.state;
            state.value = read.value.r;
            state.generation = read.generation;
            snapshot.signals.push_back(std::move(state));
        }
    }
    if (candidates != nullptr) {
        snapshot.candidate_count = candidates->size();
        for (std::size_t index = 0; index < candidates->size(); ++index) {
            const CandidateClaim& claim = candidates->at(index);
            snapshot.candidate_owners.push_back(
                claim.instance_id + (claim.active ? ":active" : ":withdrawn"));
        }
    }
    return snapshot;
}

void expect_unchanged(const LiveSnapshot& before, const LiveSnapshot& after,
                      const char* injection)
{
    SCOPED_TRACE(injection);
    ASSERT_EQ(before.programs.size(), after.programs.size()) << "tập instance đã đổi";
    for (std::size_t index = 0; index < before.programs.size(); ++index) {
        EXPECT_TRUE(before.programs[index] == after.programs[index])
            << "Program '" << before.programs[index].instance_id << "' đã đổi: chu kỳ "
            << before.programs[index].period_ms << "->" << after.programs[index].period_ms
            << ", state " << st_program_state_name(before.programs[index].state) << "->"
            << st_program_state_name(after.programs[index].state) << ", run "
            << before.programs[index].run_count << "->" << after.programs[index].run_count
            << ", pending " << before.programs[index].has_pending << "->"
            << after.programs[index].has_pending;
    }
    EXPECT_EQ(before.active_revision_id, after.active_revision_id);
    EXPECT_EQ(before.lkg_revision_id, after.lkg_revision_id);
    EXPECT_EQ(before.coordinator_instances, after.coordinator_instances);
    ASSERT_EQ(before.signals.size(), after.signals.size())
        << "số signal đã đổi — bus sống bị chạm";
    for (std::size_t index = 0; index < before.signals.size(); ++index)
        EXPECT_TRUE(before.signals[index] == after.signals[index])
            << "signal '" << before.signals[index].name << "' đã đổi";
    EXPECT_EQ(before.candidate_count, after.candidate_count);
    EXPECT_EQ(before.candidate_owners, after.candidate_owners);
}

constexpr const char* kOperation1 = "11111111-1111-4111-8111-111111111111";
constexpr const char* kOperation2 = "33333333-3333-4333-8333-333333333333";
constexpr const char* kOperation3 = "55555555-5555-4555-8555-555555555555";
constexpr const char* kRevision1 = "22222222-2222-4222-8222-222222222222";
constexpr const char* kRevision2 = "44444444-4444-4444-8444-444444444444";
constexpr const char* kRevision3 = "77777777-7777-4777-8777-777777777777";

/* Một hệ ĐANG CHẠY thật. Không dùng một coordinator vừa `recover()` làm nền: khi
 * chưa có gì chạy thì "không mutation" là chuyện hiển nhiên, và test sẽ xanh mà
 * không chứng minh gì. */
struct RunningSystem {
    TempTree tree;
    StScheduler scheduler{StSchedulerProfile::REV_A};
    StSignalBus bus;
    ProgrammingCutover cutover{CutoverMode::GRAPH_ONLY};
    ProgramCandidateRegistry candidates;
    PointTable table;
    PriorityResolver resolver;
    std::unique_ptr<ProgrammingRuntimeCoordinator> coordinator;
    std::vector<std::string> names{"P_ahu", "P_boiler"};
    std::vector<uint32_t> periods{1000u, 5000u};
    uint64_t now_ns = 0;

    void build()
    {
        ASSERT_FALSE(tree.path.empty());
        std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
        configure_task(&scheduler);
        scheduler.set_signal_bus(&bus);
        coordinator = std::make_unique<ProgrammingRuntimeCoordinator>(
            &scheduler, &cutover, tree.path + "/journal.bin", tree.path + "/staging");
        coordinator->set_candidate_registry(&candidates);
        std::string error;
        ASSERT_TRUE(coordinator->recover(&error)) << error;

        const std::vector<StPackageSignal> signals = {
            signal_of("SUPPLY", "P_ahu", 5000u, 0),
            signal_of("RETURN_T", "P_boiler", 30000u, 0)};
        const StageCommand command =
            write_candidate(tree, kOperation1, kRevision1,
                            package_of(names, periods, signals), "P_ahu");
        std::string detail;
        ASSERT_TRUE(coordinator->stage(command, &detail, &error)) << detail << ": " << error;
        ActivateCommand activate;
        activate.operation_id = kOperation1;
        activate.staged_token = kOperation1;
        activate.cutover = CutoverMode::PROGRAM_ONLY;
        activate.plan_hash = command.plan_hash;
        ASSERT_TRUE(coordinator->activate(activate, &detail, &error)) << detail << ": " << error;
        coordinator->on_safe_boundary();

        /* Program mới fail-closed ở Disabled. Nền của nhóm test này cần một
         * package thực sự đang chạy, nên Enable bằng đúng command production
         * thay vì lách policy trong fixture. */
        for (const std::string& name : names) {
            ProgramEnableCommand enable;
            enable.operation_id = kOperation1;
            enable.instance_id = name;
            enable.enabled = true;
            ASSERT_EQ(test::enable_at_boundary(coordinator.get(), &scheduler, enable, &detail,
                                               &error),
                      ProgramEnableOutcome::APPLIED)
                << name << " — " << detail << ": " << error;
        }
        now_ns = scheduler.base_step_count() * 1000ULL * 1000000ULL + 1000ULL * 1000000ULL;
        scheduler.tick(now_ns);
        StIoBridgeStats stats;
        ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
        coordinator->on_output_commit(true);
        ASSERT_TRUE(coordinator->flush_progress(&error)) << error;
        ASSERT_EQ(coordinator->snapshot().state, LifecycleState::COMMITTED)
            << "nền test chưa chạy thật; mọi khẳng định sau đó vô nghĩa";
        ASSERT_EQ(bus.size(), 2u) << "nền test không có signal nào để bảo vệ";
    }

    LiveSnapshot snapshot() const
    {
        return capture(scheduler, *coordinator, const_cast<StSignalBus*>(&bus), &candidates,
                       now_ns);
    }
};

/* Khuôn chung: dựng hệ chạy thật, chụp, tiêm lỗi qua một gói thứ hai, so lại. */
void expect_stage_failure_leaves_live_state_intact(
    const std::vector<uint8_t>& poisoned_package, const char* injection,
    const char* expected_detail_prefix)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());
    const LiveSnapshot before = system.snapshot();

    const StageCommand command = write_candidate(system.tree, kOperation2, kRevision2,
                                                 poisoned_package, "P_ahu");
    std::string detail;
    std::string error;
    EXPECT_FALSE(system.coordinator->stage(command, &detail, &error))
        << injection << ": stage lẽ ra phải bị từ chối";
    if (expected_detail_prefix != nullptr) {
        EXPECT_EQ(detail, expected_detail_prefix) << injection << " — error: " << error;
    }

    const LiveSnapshot after = system.snapshot();
    expect_unchanged(before, after, injection);
}

} // namespace

/* Tiêm 1 — package/loader: container không phải v1 lẫn v2. */
TEST(ProgrammingStageAtomicity, CorruptPackageLeavesLiveStateIntact)
{
    std::vector<uint8_t> garbage(512, 0x5Au);
    expect_stage_failure_leaves_live_state_intact(garbage, "package/loader", nullptr);
}

/* Biên đúng là 32 Program TOÀN PACKAGE, không phải live + candidate. Program
 * mới không có `desiredEnabled` trên wire nên phải fail-closed ở Disabled;
 * chỉ hai identity đã tồn tại mới được kế thừa intent hiện hành. Sau khi gói
 * biên đã COMMITTED, một stage loader-fail còn phải giữ nguyên cả hai intent. */
TEST(ProgrammingStageAtomicity, ThirtyTwoProgramsPreserveExistingIntentAndDisableNewOnes)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());
    std::string detail;
    std::string error;

    ProgramEnableCommand disable;
    disable.operation_id = kOperation1;
    disable.instance_id = "P_boiler";
    disable.enabled = false;
    ASSERT_EQ(test::enable_at_boundary(system.coordinator.get(), &system.scheduler, disable,
                                       &detail, &error),
              ProgramEnableOutcome::APPLIED)
        << detail << ": " << error;
    ASSERT_TRUE(system.scheduler.find_program("P_ahu")->enabled);
    ASSERT_FALSE(system.scheduler.find_program("P_boiler")->enabled);

    std::vector<std::string> names;
    std::vector<uint32_t> periods;
    names.push_back("P_boiler");
    names.push_back("P_ahu");
    periods.push_back(5000u);
    periods.push_back(1000u);
    for (int index = 0; index < 30; ++index) {
        names.push_back("P_capacity" + std::to_string(index));
        periods.push_back(1000u);
    }
    ASSERT_EQ(names.size(), st_profile_generated::kMaxProgramsTotal);
    const StageCommand command = write_candidate(
        system.tree, kOperation2, kRevision2, package_of(names, periods), "P_boiler");
    const LiveSnapshot before_stage = system.snapshot();
    ASSERT_TRUE(system.coordinator->stage(command, &detail, &error)) << detail << ": " << error;
    expect_unchanged(before_stage, system.snapshot(), "stage gói đúng 32 Program");

    ActivateCommand activate;
    activate.operation_id = command.operation_id;
    activate.staged_token = command.operation_id;
    activate.expected_active_revision_id = kRevision1;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(system.coordinator->activate(activate, &detail, &error)) << detail << ": " << error;
    expect_unchanged(before_stage, system.snapshot(), "arm gói đúng 32 Program");

    std::size_t forward_allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        system.coordinator->on_safe_boundary();
        forward_allocations = counter.allocations();
    }
    EXPECT_EQ(forward_allocations, 0u) << "forward handoff cấp phát heap trong scan";
    const StTask* task = system.scheduler.find_task("main");
    ASSERT_NE(task, nullptr);
    ASSERT_EQ(task->programs().size(), st_profile_generated::kMaxProgramsTotal);
    ASSERT_NE(system.scheduler.find_program("P_ahu"), nullptr);
    ASSERT_NE(system.scheduler.find_program("P_boiler"), nullptr);
    EXPECT_TRUE(system.scheduler.find_program("P_ahu")->enabled)
        << "intent Enabled của identity tồn tại bị mất";
    EXPECT_EQ(system.scheduler.find_program("P_ahu")->state, StProgramState::RUNNING);
    EXPECT_FALSE(system.scheduler.find_program("P_boiler")->enabled)
        << "intent Disabled của identity tồn tại bị mất";
    EXPECT_EQ(system.scheduler.find_program("P_boiler")->state, StProgramState::DISABLED);
    for (int index = 0; index < 30; ++index) {
        const StProgramInstance* added =
            system.scheduler.find_program("P_capacity" + std::to_string(index));
        ASSERT_NE(added, nullptr) << index;
        EXPECT_FALSE(added->enabled) << "Program mới tự bật ở index " << index;
        EXPECT_EQ(added->state, StProgramState::DISABLED) << index;
    }

    /* Kết thúc transaction biên trước khi tiêm lỗi transaction kế tiếp. */
    system.now_ns += 1000ULL * 1000000ULL;
    system.scheduler.tick(system.now_ns);
    StIoBridgeStats stats;
    ASSERT_TRUE(st_apply_all_outputs(&system.scheduler, &system.resolver, &system.table, &stats));
    system.coordinator->on_output_commit(true);
    ASSERT_TRUE(system.coordinator->flush_progress(&error)) << error;
    ASSERT_EQ(system.coordinator->snapshot().state, LifecycleState::COMMITTED);

    const LiveSnapshot before_failure = system.snapshot();
    const std::vector<uint8_t> corrupt =
        package_of({"P_ahu", "P_new_broken"}, {1000u, 1000u}, {},
                   /*corrupt_program_index=*/1);
    const StageCommand failed =
        write_candidate(system.tree, kOperation3, kRevision3, corrupt, "P_ahu");
    EXPECT_FALSE(system.coordinator->stage(failed, &detail, &error));
    expect_unchanged(before_failure, system.snapshot(), "loader fail giữ nguyên enable intent");
}

/* Tiêm 3 — loader package từ chối hai signal TRÙNG TÊN bằng mã ổn định
 * PKG-E-010. Dù lỗi được bắt trước `prepare_replacement`, invariant vẫn phải
 * giữ nguyên bus live; test không được kỳ vọng mã IPC-RUNTIME-CONFIG cũ rồi
 * vô tình che việc validation đã được đẩy lên đúng trust boundary. */
TEST(ProgrammingStageAtomicity, DuplicateSignalNameDoesNotWipeLiveSignalBus)
{
    /* Writer production nay chặn duplicate trước khi tạo package. Để vẫn chứng
     * minh loader/runtime không tin writer khác, dựng hai tên hợp lệ cùng độ
     * dài, sửa tên thứ hai thành duplicate khác hoa/thường rồi băm lại container.
     * Như vậy lỗi đi qua hash và rơi đúng trust boundary PKG-E-010. */
    const std::vector<StPackageSignal> signals = {
        signal_of("SUPPLY_A", "P_ahu", 5000u, 0),
        signal_of("FEEDBK_B", "P_ahu", 5000u, 0),
    };
    std::vector<uint8_t> poisoned =
        package_of({"P_ahu", "P_boiler"}, {1000u, 5000u}, signals);
    const std::string needle = "FEEDBK_B";
    const std::string replacement = "supply_a";
    auto found = std::search(poisoned.begin(), poisoned.end(), needle.begin(), needle.end());
    ASSERT_NE(found, poisoned.end());
    std::copy(replacement.begin(), replacement.end(), found);
    ASSERT_GE(poisoned.size(), 64u);
    std::memset(poisoned.data() + 32, 0, crypto_hash_sha256_BYTES);
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(), poisoned.data(), poisoned.size());
    std::memcpy(poisoned.data() + 32, digest.data(), digest.size());
    expect_stage_failure_leaves_live_state_intact(poisoned, "signal declaration prepare",
                                                  "PKG-E-010");
}

/* Trần signal của WRITER và trần của BUS phải bằng nhau. Nâng một bên mà quên
 * bên kia tạo ra một lớp gói mà writer chấp nhận còn runtime từ chối — và nó chỉ
 * lộ ra ở lần Commission trên bo, không lộ ra ở bàn làm việc. */
TEST(ProgrammingStageAtomicity, PackageAndBusSignalCapsAgree)
{
    EXPECT_EQ(st_profile_generated::kMaxSignals, kMaxRuntimeSignals);
}

/* Tiêm 4 — Program THỨ HAI bị loader từ chối.
 *
 * Program thứ nhất đã stage xong lúc đó. Không có đường huỷ đúng thì thiết bị ở
 * lại với nửa gói mới nửa gói cũ. */
TEST(ProgrammingStageAtomicity, SecondProgramRejectionLeavesLiveStateIntact)
{
    const std::vector<uint8_t> poisoned =
        package_of({"P_ahu", "P_boiler"}, {1000u, 5000u}, {}, /*corrupt_program_index=*/1);
    expect_stage_failure_leaves_live_state_intact(poisoned, "Program thứ N stage fail",
                                                  "IPC-STAGE-REJECTED");
}

/* Tiêm 4b — gói mới có thêm một Program CHƯA TỒN TẠI, và Program đó hỏng.
 *
 * Đây là chỗ instance rời chứng minh giá trị của nó: bản dùng `add_program()`
 * sẽ để lại một Program rỗng mang tên `P_chiller` trong scheduler, hiện ra ở
 * Runtime Monitor như một Program có thật, đến từ một gói chưa bao giờ nạp. */
TEST(ProgrammingStageAtomicity, RejectedNewProgramIsNotLeftBehindInScheduler)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());
    const LiveSnapshot before = system.snapshot();

    const std::vector<uint8_t> poisoned =
        package_of({"P_ahu", "P_boiler", "P_chiller"}, {1000u, 5000u, 30000u}, {},
                   /*corrupt_program_index=*/2);
    const StageCommand command =
        write_candidate(system.tree, kOperation2, kRevision2, poisoned, "P_ahu");
    std::string detail;
    std::string error;
    EXPECT_FALSE(system.coordinator->stage(command, &detail, &error));

    EXPECT_EQ(system.scheduler.find_program("P_chiller"), nullptr)
        << "instance của một gói bị từ chối bị bỏ lại trong scheduler";
    const LiveSnapshot after = system.snapshot();
    expect_unchanged(before, after, "instance mới bị từ chối");
}

/* Tiêm 5 — journal append/fsync `PREPARED` thất bại.
 *
 * Đây là tiêm quan trọng nhất: mọi thứ khác đã thành công, chỉ riêng bản ghi
 * bền là hỏng. Bản trước đã kịp đổi topology, xoá bus, xoá sổ candidate và ghi
 * đè toàn bộ field danh tính TRƯỚC dòng `append_phase(PREPARED)` — nên nhánh
 * lỗi này để lại một coordinator trỏ vào một revision chưa bao giờ tồn tại. */
TEST(ProgrammingStageAtomicity, JournalFsyncFailureLeavesLiveStateIntact)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());
    const LiveSnapshot before = system.snapshot();

    /* Gói HỢP LỆ: lỗi duy nhất được tiêm là ở journal. */
    const std::vector<uint8_t> healthy =
        package_of({"P_ahu", "P_boiler"}, {30000u, 30000u},
                   {signal_of("NEW_SIGNAL", "P_ahu", 30000u, 0)});
    const StageCommand command =
        write_candidate(system.tree, kOperation2, kRevision2, healthy, "P_ahu");

    /* Bỏ quyền GHI của journal. `append` sẽ hỏng ở lần mở/ghi kế tiếp. */
    const std::filesystem::path journal = system.tree.path + "/journal.bin";
    ASSERT_EQ(::chmod(journal.c_str(), 0400), 0) << "không tiêm được lỗi journal";

    std::string detail;
    std::string error;
    const bool staged = system.coordinator->stage(command, &detail, &error);
    (void)::chmod(journal.c_str(), 0600);
    ASSERT_FALSE(staged) << "journal chỉ-đọc mà stage vẫn báo thành công";
    EXPECT_EQ(detail, "IPC-JOURNAL-FSYNC") << error;

    const LiveSnapshot after = system.snapshot();
    expect_unchanged(before, after, "journal PREPARED fsync");
}

/* Sau khi một lần stage hỏng, hệ phải còn NHẬN được gói tốt. Một bất biến
 * "không mutation" đạt được bằng cách tự khoá mình lại thì vô dụng. */
TEST(ProgrammingStageAtomicity, HealthyPackageStillStagesAfterFailedAttempt)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());

    const std::vector<uint8_t> poisoned =
        package_of({"P_ahu", "P_boiler"}, {1000u, 5000u}, {}, /*corrupt_program_index=*/1);
    const StageCommand bad =
        write_candidate(system.tree, kOperation2, kRevision2, poisoned, "P_ahu");
    std::string detail;
    std::string error;
    ASSERT_FALSE(system.coordinator->stage(bad, &detail, &error));

    const std::vector<uint8_t> healthy =
        package_of({"P_ahu", "P_boiler"}, {1000u, 30000u},
                   {signal_of("SUPPLY", "P_ahu", 5000u, 0)});
    const StageCommand good =
        write_candidate(system.tree, "55555555-5555-4555-8555-555555555555", kRevision2,
                        healthy, "P_ahu");
    ASSERT_TRUE(system.candidates.claim("P_ahu", PointKind::AO, 0,
                                        system.scheduler.base_step_count(), &error));
    const LiveSnapshot before_stage = system.snapshot();
    ASSERT_TRUE(system.coordinator->stage(good, &detail, &error)) << detail << ": " << error;
    EXPECT_EQ(system.coordinator->snapshot().state, LifecycleState::STAGED);

    /* PREPARED đã bền nhưng live vẫn nguyên: không đổi period, bus
     * hay candidate. Activate chỉ arm shadow, cũng chưa handoff. */
    expect_unchanged(before_stage, system.snapshot(), "sau PREPARED");
    ActivateCommand activate;
    activate.operation_id = good.operation_id;
    activate.staged_token = good.operation_id;
    activate.expected_active_revision_id = kRevision1;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = good.plan_hash;
    ASSERT_TRUE(system.coordinator->activate(activate, &detail, &error)) << detail << ": " << error;
    expect_unchanged(before_stage, system.snapshot(), "sau COMMIT_INTENT/arm");

    system.coordinator->on_safe_boundary();
    const StProgramInstance* boiler = system.scheduler.find_program("P_boiler");
    ASSERT_NE(boiler, nullptr);
    EXPECT_EQ(boiler->period_ms, 30000u) << "handoff không áp chu kỳ của gói mới";
    ASSERT_EQ(system.bus.size(), 1u) << "handoff không áp hợp đồng signal của gói mới";
    EXPECT_GE(system.bus.index_of("SUPPLY"), 0);
    EXPECT_EQ(system.candidates.size(), 0u) << "candidate cũ chưa được rút tại handoff";
}

/* Shadow là ảnh TOÀN PACKAGE, không phải danh sách patch. Gói mới có
 * thể bỏ P_boiler, thêm P_chiller và đưa P_ahu sang order 1 trong đúng
 * một handoff. Chu kỳ đầu hỏng phải đổi ngược NGUYÊN topology lẫn bus. */
TEST(ProgrammingStageAtomicity, WholePackageShrinkAddReorderAndRollbackAreAtomic)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());
    const LiveSnapshot old_live = system.snapshot();

    const std::vector<uint8_t> replacement =
        package_of({"P_chiller", "P_ahu"}, {30000u, 1000u},
                   {signal_of("CHILLED_WATER", "P_chiller", 30000u, 0)});
    const StageCommand command =
        write_candidate(system.tree, kOperation2, kRevision2, replacement, "P_chiller");
    std::string detail;
    std::string error;
    ASSERT_TRUE(system.coordinator->stage(command, &detail, &error)) << detail << ": " << error;
    expect_unchanged(old_live, system.snapshot(), "stage package shrink/add/reorder");

    ActivateCommand activate;
    activate.operation_id = command.operation_id;
    activate.staged_token = command.operation_id;
    activate.expected_active_revision_id = kRevision1;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(system.coordinator->activate(activate, &detail, &error)) << detail << ": " << error;
    expect_unchanged(old_live, system.snapshot(), "arm package shrink/add/reorder");

    system.coordinator->on_safe_boundary();
    const StTask* task = system.scheduler.find_task("main");
    ASSERT_NE(task, nullptr);
    ASSERT_EQ(task->programs().size(), 2u);
    EXPECT_EQ(task->programs()[0]->instance_id, "P_chiller");
    EXPECT_EQ(task->programs()[0]->order, 0u);
    EXPECT_EQ(task->programs()[0]->period_ms, 30000u);
    EXPECT_EQ(task->programs()[1]->instance_id, "P_ahu");
    EXPECT_EQ(task->programs()[1]->order, 1u);
    EXPECT_EQ(system.scheduler.find_program("P_boiler"), nullptr);
    ASSERT_EQ(system.bus.size(), 1u);
    EXPECT_GE(system.bus.index_of("CHILLED_WATER"), 0);

    system.coordinator->on_output_commit(false);
    ASSERT_EQ(system.coordinator->snapshot().state, LifecycleState::ROLLING_BACK);
    std::size_t rollback_allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        system.coordinator->on_safe_boundary();
        rollback_allocations = counter.allocations();
    }
    EXPECT_EQ(rollback_allocations, 0u) << "rollback handoff cấp phát heap trong scan";
    ASSERT_EQ(system.coordinator->snapshot().state, LifecycleState::ROLLED_BACK);
    expect_unchanged(old_live, system.snapshot(), "rollback whole package");
}

/* Ba lần Commission liên tiếp phải chạy được. Bus chỉ có ba bank; quên thả bank
 * cũ thì lần thứ ba bị từ chối vì một lý do không liên quan gì tới gói của nó. */
TEST(ProgrammingStageAtomicity, ThreeConsecutiveStagesDoNotExhaustSignalBanks)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());
    std::string detail;
    std::string error;
    for (int round = 0; round < 3; ++round) {
        const std::string operation =
            "6666666" + std::to_string(round) + "-6666-4666-8666-666666666666";
        /* Cả hai Program chu kỳ 1 s: barrier chu kỳ đầu là barrier của cả GÓI,
         * nên một Program 5 s sẽ giữ vòng lặp ở PENDING mãi mãi. */
        const std::vector<uint8_t> bytes =
            package_of({"P_ahu", "P_boiler"}, {1000u, 1000u},
                       {signal_of("S" + std::to_string(round), "P_ahu", 5000u, 0)});
        const StageCommand command =
            write_candidate(system.tree, operation, kRevision2, bytes, "P_ahu");
        const std::string signal_before_boundary =
            round == 0 ? "SUPPLY" : "S" + std::to_string(round - 1);
        ASSERT_TRUE(system.coordinator->stage(command, &detail, &error))
            << "vòng " << round << " — " << detail << ": " << error;
        EXPECT_GE(system.bus.index_of(signal_before_boundary), 0)
            << "stage đã đổi bus trước boundary ở vòng " << round;

        /* Đưa về trạng thái ổn định để vòng sau được phép stage. */
        ActivateCommand activate;
        activate.operation_id = operation;
        activate.staged_token = operation;
        activate.cutover = CutoverMode::PROGRAM_ONLY;
        activate.plan_hash = command.plan_hash;
        activate.expected_active_revision_id = system.coordinator->snapshot().active_revision_id;
        ASSERT_TRUE(system.coordinator->activate(activate, &detail, &error))
            << "vòng " << round << " — " << detail << ": " << error;
        system.coordinator->on_safe_boundary();
        ASSERT_EQ(system.bus.size(), 1u) << "vòng " << round;
        EXPECT_GE(system.bus.index_of("S" + std::to_string(round)), 0) << "vòng " << round;
        system.now_ns += 1000ULL * 1000000ULL;
        system.scheduler.tick(system.now_ns);
        StIoBridgeStats stats;
        ASSERT_TRUE(st_apply_all_outputs(&system.scheduler, &system.resolver, &system.table,
                                         &stats));
        system.coordinator->on_output_commit(true);
        ASSERT_TRUE(system.coordinator->flush_progress(&error)) << error;
        ASSERT_EQ(system.coordinator->snapshot().state, LifecycleState::COMMITTED)
            << "vòng " << round << " chưa kết thúc lifecycle";
    }
}

/* ---- F-P59-ENABLE-BOUNDARY-001 — Enable/Disable phải áp dụng tại safe boundary ----
 *
 * Trên bo thật, `SET_PROGRAM_ENABLED` chạy trên IPC WORKER THREAD
 * (`apps/core/bootstrap/main.cpp` dựng `programming_ipc_thread` riêng) trong
 * khi scan loop RT `SCHED_FIFO 80` đang tick CÙNG scheduler. Nhóm test còn lại
 * của file này chạy đơn luồng nên không bao giờ chạm vào mô hình luồng đó —
 * và chính vì vậy nó không bắt được đường Enable/Disable sửa thẳng
 * `StProgramInstance::state`/`enabled` từ luồng non-RT.
 *
 * Test này mô phỏng đúng hai luồng production. Chạy dưới `-fsanitize=thread`
 * nó là phép đo trực tiếp cho bất biến "chỉ RT ghi trạng thái Program"; chạy
 * bản thường nó vẫn khoá hành vi: sau một chuỗi Disable/Enable đan xen với
 * scan, Program phải dừng đúng ở RUNNING/enabled. */
TEST(ProgrammingStageAtomicity, EnableIntentAppliesAtSafeBoundaryWhileScanRuns)
{
    RunningSystem system;
    ASSERT_NO_FATAL_FAILURE(system.build());

    std::atomic<bool> stop_scan{false};
    std::atomic<uint64_t> ticks{0};
    std::thread scan([&] {
        uint64_t now = system.now_ns;
        while (!stop_scan.load(std::memory_order_acquire)) {
            system.coordinator->on_safe_boundary();
            now += 1000ULL * 1000000ULL;
            system.scheduler.tick(now);
            ticks.fetch_add(1, std::memory_order_relaxed);
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    });

    std::string detail;
    std::string error;
    for (int round = 0; round < 8; ++round) {
        ProgramEnableCommand disable;
        disable.operation_id = kOperation2;
        disable.instance_id = "P_boiler";
        disable.enabled = false;
        EXPECT_EQ(system.coordinator->set_program_enabled(disable, &detail, &error),
                  ProgramEnableOutcome::APPLIED)
            << "vòng " << round << " (Disable) — " << detail << ": " << error;
        ProgramEnableCommand enable = disable;
        enable.enabled = true;
        EXPECT_EQ(system.coordinator->set_program_enabled(enable, &detail, &error),
                  ProgramEnableOutcome::APPLIED)
            << "vòng " << round << " (Enable) — " << detail << ": " << error;
    }

    stop_scan.store(true, std::memory_order_release);
    scan.join();

    EXPECT_GT(ticks.load(std::memory_order_relaxed), 0u)
        << "scan thread chưa chạy vòng nào — test không chứng minh gì";
    const StProgramInstance* boiler = system.scheduler.find_program("P_boiler");
    ASSERT_NE(boiler, nullptr);
    EXPECT_TRUE(boiler->enabled) << "Enable cuối cùng phải thắng";
    EXPECT_EQ(boiler->state, StProgramState::RUNNING);
}
