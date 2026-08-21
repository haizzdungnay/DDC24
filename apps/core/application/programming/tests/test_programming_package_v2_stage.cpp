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
#include "st/st_process_image.hpp"
#include "st/st_ir.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

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

/* Package v2 dựng bằng ĐÚNG writer production — golden và fuzz của T59-106 canh
 * writer đó, nên test này không tự chế một định dạng thứ hai. */
std::vector<uint8_t> package_of(const std::vector<std::string>& names,
                                const std::vector<uint32_t>& periods_ms = {})
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    int value = 1;
    for (std::size_t index = 0; index < names.size(); ++index) {
        const std::string& name = names[index];
        const uint32_t period = index < periods_ms.size() ? periods_ms[index] : 0u;
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
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;

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
    ASSERT_TRUE(coordinator.stage(command, &detail, &error)) << detail << ": " << error;

    ASSERT_EQ(coordinator.instance_ids().size(), names.size());
    for (const std::string& name : names) {
        EXPECT_NE(scheduler.find_program(name), nullptr) << name;
        const StProgramInstance* instance = scheduler.find_program(name);
        ASSERT_NE(instance, nullptr);
        EXPECT_FALSE(instance->pending_artifact.empty()) << name << " chưa được stage";
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

/* Gói v2 phải sống sót qua reboot. Trước T59-402 đường khôi phục nạp NGUYÊN khối
 * container vào một instance như thể là artifact v1 — loader IR v1 từ chối, và
 * thiết bị tỉnh dậy không có Program nào. Hỏng đúng vào lúc không ai đang nhìn. */
TEST(ProgrammingPackageV2Stage, PackageV2SurvivesRestartWithEveryProgram)
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
        EXPECT_EQ(instance->state, StProgramState::RUNNING) << names[index];
        EXPECT_EQ(instance->period_ms, periods[index]) << names[index];
    }
}
