/**
 * @file  test_programming_package_v2_stage.cpp
 * @brief T59-401 — coordinator nạp package v2 nhiều Program.
 *
 *        Ba điều được khoá ở đây:
 *        1. Dual-reader còn sống: artifact v1 (một Program) VẪN nạp được. Mất
 *           đường này nghĩa là một lần nâng cấp là mất bản LKG cuối cùng.
 *        2. Package v2 tạo topology theo CHÍNH package — bootstrap không còn
 *           phải biết trước tên Program.
 *        3. Gói hỏng KHÔNG để lại mutation: không instance nào ở trạng thái
 *           staged, và tập instance của coordinator không đổi.
 */
#include <gtest/gtest.h>

#include <array>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include <sodium.h>
#include <unistd.h>

#include "programming/programming_runtime_coordinator.hpp"
#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "st/st_compile.hpp"
#include "st/st_io_map.hpp"
#include "st/st_process_image.hpp"
#include "st/st_ir.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

#include "enable_at_boundary.hpp"

using namespace core;
using namespace core::programming;

namespace {

struct TempTree {
    std::string path;
    TempTree()
    {
        char pattern[] = "/tmp/mkddc-pkg-XXXXXX";
        if (::mkdtemp(pattern) != nullptr) path = pattern;
    }
    ~TempTree()
    {
        if (!path.empty()) std::filesystem::remove_all(path);
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

std::vector<uint8_t> signal_program_ir(
    const std::string& source, const std::string& program_id,
    const std::vector<StPublishedSignalContract>& signals,
    const std::vector<StIoMapEntry>& io_map = {})
{
    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = program_id;
    options.published_signals = signals;
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic, options))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<StDiagnostic> binding_diagnostics;
    EXPECT_TRUE(resolve_io_bindings(&module, io_map, &binding_diagnostics))
        << (!binding_diagnostics.empty() ? binding_diagnostics.front().code : "") << ": "
        << (!binding_diagnostics.empty() ? binding_diagnostics.front().message : "");
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

/* Package v2 dựng bằng ĐÚNG writer production — golden và fuzz của T59-106 canh
 * writer đó, nên test này không tự chế một định dạng thứ hai. */
std::vector<uint8_t> package_of(const std::vector<std::string>& names,
                                const std::vector<uint32_t>& periods_ms = {},
                                const std::vector<StPackageSignal>& signals = {})
{
    StPackageInput input;
    input.signals = signals;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    int value = 1;
    for (std::size_t index = 0; index < names.size(); ++index) {
        const std::string& name = names[index];
        const uint32_t period = index < periods_ms.size() ? periods_ms[index] : 1000u;
        input.programs.push_back({name, program_ir(name, value++), period, 0u});
        StPouSignature signature;
        signature.name = name;
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
    const std::filesystem::path directory = std::filesystem::path(tree.path) / "staging" / operation;
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

constexpr const char* kOperation = "11111111-1111-4111-8111-111111111111";
constexpr const char* kRevision = "22222222-2222-4222-8222-222222222222";

} // namespace

/* Dual-reader (DDD §12.1): artifact v1 vẫn nạp được, và instance id đến từ chính
 * lệnh — không còn bị khoá ở "program-main". */
TEST(ProgrammingPackageV2Stage, ArtifactV1StillStagesUnderAnyInstanceName)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    const StageCommand command =
        write_candidate(tree, kOperation, kRevision, program_ir("Solo", 7), "P_solo");
    std::string detail;
    const std::vector<std::string> live_ids_before = coordinator.instance_ids();
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;

    EXPECT_EQ(coordinator.instance_ids(), live_ids_before)
        << "PREPARED không được công bố identity live trước safe boundary";
    EXPECT_EQ(scheduler.find_program("P_solo"), nullptr)
        << "stage đã gắn Program mới vào topology live";

    ActivateCommand activate;
    activate.operation_id = kOperation;
    activate.staged_token = kOperation;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
    EXPECT_EQ(scheduler.find_program("P_solo"), nullptr)
        << "arm đã đổi topology trước safe boundary";
    coordinator.on_safe_boundary();

    ASSERT_EQ(coordinator.instance_ids().size(), 1u);
    EXPECT_EQ(coordinator.instance_ids()[0], "P_solo");
    /* Bootstrap KHÔNG khai instance này; coordinator tự dựng topology theo
     * package — đây là thứ gỡ bỏ hardcode `program-main`. */
    EXPECT_NE(scheduler.find_program("P_solo"), nullptr);
}

/* Package v2: topology đến từ CHÍNH package, mỗi Program một instance. */
TEST(ProgrammingPackageV2Stage, PackageV2CreatesOneInstancePerProgram)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    const std::vector<std::string> names = {"P_ahu", "P_boiler", "P_chiller"};
    const StageCommand command =
        write_candidate(tree, kOperation, kRevision, package_of(names), "P_ahu");
    std::string detail;
    const std::vector<std::string> live_ids_before = coordinator.instance_ids();
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;

    EXPECT_EQ(coordinator.instance_ids(), live_ids_before);
    for (const std::string& name : names)
        EXPECT_EQ(scheduler.find_program(name), nullptr) << name << " xuất hiện từ stage";

    ActivateCommand activate;
    activate.operation_id = kOperation;
    activate.staged_token = kOperation;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
    coordinator.on_safe_boundary();

    ASSERT_EQ(coordinator.instance_ids().size(), names.size());
    for (const std::string& name : names) {
        EXPECT_NE(scheduler.find_program(name), nullptr) << name;
        const StProgramInstance* instance = scheduler.find_program(name);
        ASSERT_NE(instance, nullptr);
        EXPECT_TRUE(instance->pending_artifact.empty()) << name << " còn artifact pending sau handoff";
        EXPECT_FALSE(instance->enabled) << name << " mới phải fail-closed ở Disabled";
        EXPECT_EQ(instance->state, StProgramState::DISABLED) << name;
    }
}

/* Gói hỏng: KHÔNG instance nào bị để lại ở trạng thái staged, và tập instance
 * của coordinator không đổi. Nạp nửa gói là nạp một cấu hình chưa từng được Check. */
TEST(ProgrammingPackageV2Stage, CorruptPackageLeavesNoStagedMutation)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;
    const std::vector<std::string> before = coordinator.instance_ids();

    std::vector<uint8_t> bytes = package_of({"P_ahu", "P_boiler"});
    /* Lật một byte trong vùng payload: hash header sẽ không khớp và loader phải
     * từ chối TRƯỚC khi bất kỳ instance nào được stage. */
    bytes[bytes.size() - 1] ^= 0xFFu;
    const StageCommand command = write_candidate(tree, kOperation, kRevision, bytes, "P_ahu");
    std::string detail;
    EXPECT_FALSE(coordinator.stage(command, &detail, &error));
    EXPECT_FALSE(detail.empty()) << "gói hỏng phải có detail code";

    EXPECT_EQ(coordinator.instance_ids(), before) << "tập instance đổi dù stage hỏng";
    for (const char* name : {"P_ahu", "P_boiler"}) {
        const StProgramInstance* instance = scheduler.find_program(name);
        if (instance != nullptr) {
            EXPECT_TRUE(instance->pending_artifact.empty()) << name;
        }
    }
}

/* Instance id rác không được đi vào scheduler. Bỏ hardcode `program-main` KHÔNG
 * có nghĩa là nhận mọi chuỗi. */
TEST(ProgrammingPackageV2Stage, RejectsHostileInstanceIdentity)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    for (const std::string& hostile : {std::string("../escape"), std::string(""),
                                       std::string(65, 'x'), std::string("a b")}) {
        const StageCommand command =
            write_candidate(tree, kOperation, kRevision, program_ir("Solo", 3), hostile);
        std::string detail;
        EXPECT_FALSE(coordinator.stage(command, &detail, &error))
            << "instance id độc hại được chấp nhận: " << hostile;
    }
}

/* T59-402 — chu kỳ là dữ liệu của PACKAGE. Nếu runtime tự chọn chu kỳ thì hai
 * controller nạp cùng một gói sẽ chạy hai dãy release khác nhau, và mọi tuyên bố
 * "cùng package cho cùng hành vi" mất nghĩa. */
TEST(ProgrammingPackageV2Stage, PerProgramPeriodComesFromPackage)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    const std::vector<std::string> names = {"P_fast", "P_medium", "P_slow"};
    const std::vector<uint32_t> periods = {1000u, 5000u, 30000u};
    const StageCommand command =
        write_candidate(tree, kOperation, kRevision, package_of(names, periods), "P_fast");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;

    for (const std::string& name : names)
        EXPECT_EQ(scheduler.find_program(name), nullptr) << name << " xuất hiện từ stage";
    ActivateCommand activate;
    activate.operation_id = kOperation;
    activate.staged_token = kOperation;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
    coordinator.on_safe_boundary();

    for (std::size_t index = 0; index < names.size(); ++index) {
        const StProgramInstance* instance = scheduler.find_program(names[index]);
        ASSERT_NE(instance, nullptr) << names[index];
        EXPECT_EQ(instance->period_ms, periods[index]) << names[index];
    }
}

/* Chu kỳ ngoài ba lớp profile bị chặn ở CHÍNH writer: một lớp lập lịch không tồn
 * tại chấp nhận ở đây chỉ đẩy lỗi xuống runtime, nơi nó biểu hiện thành deadline
 * miss chứ không thành một câu trả lời hiểu được. */
TEST(ProgrammingPackageV2Stage, WriterRejectsPeriodOutsideProfileClasses)
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    input.programs.push_back({"P_odd", program_ir("P_odd", 3), 750u, 0u});
    StPouSignature signature;
    signature.name = "P_odd";
    signature.kind = StPouKind::PROGRAM;
    input.pou_signatures.push_back(signature);

    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_FALSE(WritePackageV2(input, &bytes, &error));
    EXPECT_NE(error.find("ngoài ba lớp"), std::string::npos) << error;
}

/* Gói v2 phải sống sót qua reboot nhưng checkpoint không mang desiredEnabled.
 * Vì vậy Core khôi phục đủ topology/artifact ở Disabled và chỉ chạy Program
 * sau PROGRAM_ENABLE explicit/replay; tự start ở boot là bypass intent bền. */
TEST(ProgrammingPackageV2Stage, RestartRestoresTopologyFailClosedUntilExplicitEnable)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    const std::vector<std::string> names = {"P_ahu", "P_boiler"};
    const std::vector<uint32_t> periods = {1000u, 5000u};
    const std::vector<uint8_t> bytes = package_of(names, periods);
    const StageCommand command = write_candidate(tree, kOperation, kRevision, bytes, "P_ahu");

    {
        StScheduler scheduler(StSchedulerProfile::REV_A);
        configure_task(&scheduler);
        ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
        ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                                   tree.path + "/staging");
        std::string error;
        ASSERT_TRUE(coordinator.recover(&error)) << error;
        std::string detail;
        ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;
        ActivateCommand activate;
        activate.operation_id = kOperation;
        activate.staged_token = kOperation;
        activate.cutover = CutoverMode::PROGRAM_ONLY;
        activate.plan_hash = command.plan_hash;
        ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
        /* Checkpoint chỉ được ghi sau khi chu kỳ đầu tiên đẩy được output —
         * "đã activate" chưa phải "đã cam kết". Phải đi hết đường đó, nếu không
         * test chỉ chứng minh rằng không có gì để khôi phục. */
        coordinator.on_safe_boundary();
        scheduler.tick(scheduler.base_step_count() * 1000ULL * 1000000ULL + 1000ULL * 1000000ULL);
        PointTable table;
        PriorityResolver resolver;
        StIoBridgeStats stats;
        ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
        coordinator.on_output_commit(true);
        ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
        ASSERT_EQ(coordinator.snapshot().state, LifecycleState::COMMITTED);
    }

    /* Tiến trình MỚI: cùng journal, cùng staging, không còn gì trong bộ nhớ. */
    StScheduler restarted(StSchedulerProfile::REV_A);
    configure_task(&restarted);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&restarted, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    ASSERT_EQ(coordinator.instance_ids().size(), names.size());
    for (std::size_t index = 0; index < names.size(); ++index) {
        const StProgramInstance* instance = restarted.find_program(names[index]);
        ASSERT_NE(instance, nullptr) << names[index] << " mất sau khởi động lại";
        EXPECT_EQ(instance->state, StProgramState::DISABLED) << names[index];
        EXPECT_FALSE(instance->enabled) << names[index] << " tự bật lại từ checkpoint";
        EXPECT_EQ(instance->period_ms, periods[index]) << names[index];
    }

    ProgramEnableCommand replay;
    replay.operation_id = kOperation;
    replay.instance_id = "P_ahu";
    replay.enabled = true;
    std::string detail;
    ASSERT_EQ(test::enable_at_boundary(&coordinator, &restarted, replay, &detail, &error),
              ProgramEnableOutcome::APPLIED)
        << detail << ": " << error;
    EXPECT_EQ(restarted.find_program("P_ahu")->state, StProgramState::RUNNING);
    EXPECT_EQ(restarted.find_program("P_boiler")->state, StProgramState::DISABLED)
        << "replay một intent đã làm Program khác tự chạy";
}

/* T59-404 — bus signal dựng theo ĐÚNG khai báo của package, và dựng LẠI mỗi lần
 * nạp gói mới. Giữ khai báo của gói cũ nghĩa là chạy gói mới với hợp đồng gói
 * cũ, và sai lệch đó không lộ ra cho tới khi ai đó đọc một signal đã bị bỏ. */
TEST(ProgrammingPackageV2Stage, SignalBusIsRebuiltFromPackage)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    StSignalBus bus;
    scheduler.set_signal_bus(&bus);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    StPackageSignal held;
    held.name = "SUPPLY";
    held.producer_program = "P_ahu";
    held.data_type = static_cast<uint8_t>(StType::REAL);
    held.freshness_ms = 5000;
    held.stale_policy = 0;
    StPackageSignal fallback;
    fallback.name = "RESET";
    fallback.producer_program = "P_boiler";
    fallback.data_type = static_cast<uint8_t>(StType::REAL);
    fallback.freshness_ms = 30000;
    fallback.stale_policy = 1;
    fallback.fallback_bits = 0x40A00000ull;
    fallback.has_fallback = true;

    const StageCommand command = write_candidate(
        tree, kOperation, kRevision,
        package_of({"P_ahu", "P_boiler"}, {1000u, 5000u}, {held, fallback}), "P_ahu");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;

    EXPECT_EQ(bus.size(), 0u) << "PREPARED đã đổi bank signal live";
    ActivateCommand activate;
    activate.operation_id = kOperation;
    activate.staged_token = kOperation;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
    EXPECT_EQ(bus.size(), 0u) << "arm đã đổi bank signal live";
    coordinator.on_safe_boundary();

    ASSERT_EQ(bus.size(), 2u);
    const int supply = bus.index_of("SUPPLY");
    const int reset = bus.index_of("RESET");
    ASSERT_GE(supply, 0);
    ASSERT_GE(reset, 0);
    EXPECT_EQ(bus.definition(supply).stale_policy, StStalePolicy::HOLD_LAST);
    EXPECT_EQ(bus.definition(supply).freshness_ms, 5000u);
    EXPECT_EQ(bus.definition(reset).stale_policy, StStalePolicy::USE_FALLBACK);
    EXPECT_FLOAT_EQ(bus.definition(reset).fallback.r, 5.0f);

    /* Kết thúc transaction thứ nhất rồi nạp gói KHÔNG có signal trên chính
     * coordinator/bus đó. Stage và arm vẫn phải giữ bank cũ; chỉ handoff mới
     * thay toàn bộ hợp đồng signal bằng bank rỗng. */
    coordinator.on_output_commit(true);
    ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
    ASSERT_EQ(coordinator.snapshot().state, LifecycleState::COMMITTED);

    const StageCommand second = write_candidate(
        tree, "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444", package_of({"P_ahu"}, {1000u}),
        "P_ahu");
    ASSERT_TRUE(coordinator.stage(second, &detail, &error)) << detail << ": " << error;
    EXPECT_EQ(bus.size(), 2u) << "stage đã xoá bank signal cũ";
    ActivateCommand second_activate;
    second_activate.operation_id = second.operation_id;
    second_activate.staged_token = second.operation_id;
    second_activate.expected_active_revision_id = kRevision;
    second_activate.cutover = CutoverMode::PROGRAM_ONLY;
    second_activate.plan_hash = second.plan_hash;
    ASSERT_TRUE(coordinator.activate(second_activate, &detail, &error))
        << detail << ": " << error;
    EXPECT_EQ(bus.size(), 2u) << "arm đã xoá bank signal cũ";
    coordinator.on_safe_boundary();
    EXPECT_EQ(bus.size(), 0u) << "handoff giữ khai báo của gói cũ";
}

/* F-P59-SIGNAL-001: package thật phải bind ref trong artifact vào đúng bank,
 * publisher ghi draft, consumer BLOCK_PROGRAM thành WAITING ở chu kỳ đầu rồi
 * tự hồi phục ở boundary kế. Test bus trực tiếp không chứng minh coordinator
 * đã làm bước resolve ref này. */
TEST(ProgrammingPackageV2Stage, SourceSignalFlowsThroughPackageCoordinator)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    StSignalBus bus;
    scheduler.set_signal_bus(&bus);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
                                               tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    const std::vector<StPublishedSignalContract> contracts = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    input.programs.push_back({
        "P_pub",
        signal_program_ir(
            "PROGRAM Producer\nVAR value : REAL; END_VAR\n"
            "value := 42.0;\nSIGNAL_PUBLISH(shared_temp, value);\nEND_PROGRAM\n",
            "P_pub", contracts),
        1000u, 0u});
    input.programs.push_back({
        "P_cons",
        signal_program_ir(
            "PROGRAM Consumer\nVAR_INPUT physical : REAL; END_VAR\n"
            "VAR_OUTPUT observed : REAL; END_VAR\n"
            "observed := SIGNAL_READ(SHARED_TEMP);\nEND_PROGRAM\n",
            "P_cons", contracts,
            {StIoMapEntry{"physical", "input", "UI-01", StType::REAL, "", false,
                          0.0f, 0.0f, "LOCAL", "", 0, false}}),
        1000u, 0u});
    for (const char* name : {"P_pub", "P_cons"}) {
        StPouSignature signature;
        signature.name = name;
        signature.kind = StPouKind::PROGRAM;
        input.pou_signatures.push_back(std::move(signature));
    }
    StPackageSignal signal;
    signal.name = "SHARED_TEMP";
    signal.producer_program = "P_pub";
    signal.data_type = static_cast<uint8_t>(StType::REAL);
    signal.freshness_ms = 30000;
    signal.stale_policy = static_cast<uint8_t>(StStalePolicy::WAIT);
    input.signals.push_back(signal);
    std::vector<uint8_t> package;
    ASSERT_TRUE(WritePackageV2(input, &package, &error)) << error;

    const StageCommand command =
        write_candidate(tree, kOperation, kRevision, package, "P_pub");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;
    ActivateCommand activate;
    activate.operation_id = kOperation;
    activate.staged_token = kOperation;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
    coordinator.on_safe_boundary();

    for (const char* name : {"P_pub", "P_cons"}) {
        ProgramEnableCommand enable;
        enable.operation_id = kOperation;
        enable.instance_id = name;
        enable.enabled = true;
        ASSERT_EQ(test::enable_at_boundary(&coordinator, &scheduler, enable, &detail, &error),
                  ProgramEnableOutcome::APPLIED)
            << name << ": " << detail << ": " << error;
    }
    ASSERT_EQ(bus.size(), 1u);
    ASSERT_EQ(scheduler.find_program("P_pub")->runtime.program()->signal_refs.size(), 1u);
    ASSERT_EQ(scheduler.find_program("P_cons")->runtime.program()->signal_refs.size(), 1u);
    EXPECT_GE(scheduler.find_program("P_pub")->runtime.program()->signal_refs[0].runtime_index, 0);
    EXPECT_GE(scheduler.find_program("P_cons")->runtime.program()->signal_refs[0].runtime_index, 0);

    PointTable points;
    IoSnapshot snapshot{};
    snapshot.ts_ns = 1;
    snapshot.valid = true;
    snapshot.ui_value[0] = 7.0f;
    snapshot.ui_quality[0] = KX_Q_GOOD;
    points.update_inputs(snapshot);
    StIoBridgeStats io_stats;
    ASSERT_TRUE(st_capture_due_inputs(&scheduler, points, 1000ULL * 1000000ULL, &io_stats));
    scheduler.tick(1000ULL * 1000000ULL);
    EXPECT_EQ(scheduler.find_program("P_cons")->state, StProgramState::WAITING);
    EXPECT_EQ(scheduler.find_program("P_cons")->fault_count, 0u);
    ASSERT_TRUE(st_capture_due_inputs(&scheduler, points, 2000ULL * 1000000ULL, &io_stats));
    scheduler.tick(2000ULL * 1000000ULL);
    EXPECT_EQ(scheduler.find_program("P_cons")->state, StProgramState::RUNNING);
    StValue observed;
    ASSERT_TRUE(scheduler.find_program("P_cons")->runtime.get_variable("observed", &observed));
    EXPECT_FLOAT_EQ(observed.r, 42.0f);
}

/* Scheduler commit bus ở BOUNDARY, trước khi Program nào chạy: mọi consumer
 * trong một chu kỳ phải thấy cùng một ảnh signal. */
TEST(ProgrammingPackageV2Stage, SchedulerCommitsSignalsAtBoundary)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    StSignalBus bus;
    scheduler.set_signal_bus(&bus);
    std::string error;
    StSignalDefinition definition;
    definition.name = "SUPPLY";
    definition.publisher_program = "P_pub";
    definition.type = StType::REAL;
    definition.freshness_ms = 30000;
    definition.stale_policy = StStalePolicy::HOLD_LAST;
    ASSERT_TRUE(bus.declare(definition, &error)) << error;
    const int index = bus.index_of("SUPPLY");

    StCell cell{};
    cell.r = 42.0f;
    ASSERT_TRUE(bus.publish(index, cell, 0, "P_pub"));
    EXPECT_EQ(bus.read(index, 0).state, StSignalReadState::STALE_HELD)
        << "chưa qua boundary mà đã đọc được";

    scheduler.on_base_step(1000ULL * 1000000ULL);
    const StSignalRead read = bus.read(index, 1000ULL * 1000000ULL);
    EXPECT_EQ(read.state, StSignalReadState::FRESH);
    EXPECT_FLOAT_EQ(read.value.r, 42.0f);
}

/* T59-405 — intent Enable/Disable áp lên đúng một Program. */
TEST(ProgrammingPackageV2Stage, SetProgramEnabledAppliesToOneInstance)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    const std::vector<std::string> names = {"P_ahu", "P_boiler"};
    const StageCommand command =
        write_candidate(tree, kOperation, kRevision, package_of(names, {1000u, 5000u}), "P_ahu");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;
    ActivateCommand activate;
    activate.operation_id = kOperation;
    activate.staged_token = kOperation;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
    coordinator.on_safe_boundary();

    ASSERT_EQ(scheduler.find_program("P_ahu")->state, StProgramState::DISABLED);
    ASSERT_EQ(scheduler.find_program("P_boiler")->state, StProgramState::DISABLED);

    ProgramEnableCommand enable;
    enable.operation_id = kOperation;
    enable.instance_id = "P_boiler";
    enable.enabled = true;
    ASSERT_EQ(test::enable_at_boundary(&coordinator, &scheduler, enable, &detail, &error),
              ProgramEnableOutcome::APPLIED)
        << detail << ": " << error;
    ASSERT_EQ(scheduler.find_program("P_boiler")->state, StProgramState::RUNNING);

    enable.instance_id = "P_ahu";
    enable.enabled = false;
    ASSERT_EQ(test::enable_at_boundary(&coordinator, &scheduler, enable, &detail, &error),
              ProgramEnableOutcome::APPLIED)
        << detail << ": " << error;
    EXPECT_EQ(scheduler.find_program("P_ahu")->state, StProgramState::DISABLED);
    EXPECT_FALSE(scheduler.find_program("P_ahu")->enabled);
    /* Chỉ MỘT Program bị tác động: lệnh cho một instance không được làm gì với
     * instance khác. */
    EXPECT_EQ(scheduler.find_program("P_boiler")->state, StProgramState::RUNNING);

    /* Tắt lại Program đã dừng là no-op THÀNH CÔNG: intent đã đạt, và trả lỗi ở
     * đây sẽ biến một lần gửi lại thành một lỗi giả. */
    ASSERT_EQ(test::enable_at_boundary(&coordinator, &scheduler, enable, &detail, &error),
              ProgramEnableOutcome::APPLIED)
        << detail;

    enable.enabled = true;
    ASSERT_EQ(test::enable_at_boundary(&coordinator, &scheduler, enable, &detail, &error),
              ProgramEnableOutcome::APPLIED)
        << detail << ": " << error;
    EXPECT_EQ(scheduler.find_program("P_ahu")->state, StProgramState::RUNNING);
    EXPECT_TRUE(scheduler.find_program("P_ahu")->enabled);

    /* Instance không có trong package đang chạy: KHÔNG tự tạo. Bật một Program
     * không tồn tại nghĩa là người gọi và thiết bị đang nói về hai gói khác
     * nhau — im lặng tạo ra nó sẽ giấu đúng sự lệch đó đi. */
    enable.instance_id = "P_ghost";
    EXPECT_EQ(test::enable_at_boundary(&coordinator, &scheduler, enable, &detail, &error),
              ProgramEnableOutcome::REJECTED);
    EXPECT_EQ(detail, "IPC-UNKNOWN-INSTANCE");
    EXPECT_EQ(scheduler.find_program("P_ghost"), nullptr);

    /* Identity rác bị chặn trước khi chạm scheduler. */
    enable.instance_id = "../escape";
    EXPECT_EQ(test::enable_at_boundary(&coordinator, &scheduler, enable, &detail, &error),
              ProgramEnableOutcome::REJECTED);
    EXPECT_EQ(detail, "IPC-PAYLOAD");
}

/* T59-406 — nạp gói mới xoá sổ candidate, kèm lý do `PACKAGE_REPLACED`. Giữ
 * claim của gói cũ nghĩa là trả lời SAI câu "ai đang giữ điểm này". */
TEST(ProgrammingPackageV2Stage, NewPackageClearsCandidateOwnership)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_task(&scheduler);
    ProgramCandidateRegistry registry;
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                               tree.path + "/staging");
    coordinator.set_candidate_registry(&registry);
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error)) << error;

    std::string claim_error;
    ASSERT_TRUE(registry.claim("P_old", PointKind::AO, 1, 1, &claim_error)) << claim_error;
    EXPECT_EQ(registry.owner_of(PointKind::AO, 1), "P_old");

    const StageCommand command =
        write_candidate(tree, kOperation, kRevision, package_of({"P_ahu"}, {1000u}), "P_ahu");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;
    EXPECT_EQ(registry.size(), 1u) << "stage đã rút candidate trước handoff";
    EXPECT_EQ(registry.owner_of(PointKind::AO, 1), "P_old");

    ActivateCommand activate;
    activate.operation_id = kOperation;
    activate.staged_token = kOperation;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = command.plan_hash;
    ASSERT_TRUE(coordinator.activate(activate, &detail, &error)) << detail << ": " << error;
    EXPECT_EQ(registry.size(), 1u) << "arm đã rút candidate trước handoff";
    coordinator.on_safe_boundary();
    EXPECT_EQ(registry.size(), 0u) << "sổ giữ quyền sở hữu của gói cũ";
    EXPECT_EQ(registry.owner_of(PointKind::AO, 1), "");
}
