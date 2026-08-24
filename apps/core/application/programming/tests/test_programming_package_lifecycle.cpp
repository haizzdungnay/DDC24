/**
 * @file  test_programming_package_lifecycle.cpp
 * @brief T59-501 — vòng đời Commission/Restore ở mức GÓI.
 *
 *        Ba bất biến được khoá ở đây, và cả ba chỉ có nghĩa khi gói có NHIỀU
 *        Program — đó là lý do chúng không lộ ra ở các test một Program:
 *
 *        1. Barrier chu kỳ đầu là barrier của cả gói. Một Program hỏng không
 *           được để gói đi tiếp chỉ vì Program chính chạy sạch.
 *        2. Không có "active một nửa". Rollback quay TOÀN BỘ gói về, không quay
 *           riêng Program chính rồi để lại nửa cũ nửa mới.
 *        3. LKG thăng cấp all-or-nothing. Với gói trộn chu kỳ, Program 1 s đủ
 *           tư cách ngay còn Program 30 s phải chờ — thăng cấp riêng lẻ sẽ tạo
 *           một tập LKG chưa từng được Check.
 */
#include <gtest/gtest.h>

#include <array>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include <sodium.h>
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
#include "st/st_test_key.hpp"

#include "enable_at_boundary.hpp"

using namespace core;
using namespace core::programming;

namespace {

constexpr const char* kOperation = "44444444-4444-4444-8444-444444444441";
constexpr const char* kOperation2 = "44444444-4444-4444-8444-444444444442";
constexpr const char* kRevision = "55555555-5555-4555-8555-555555555551";

struct TempTree {
    std::string path;
    TempTree()
    {
        char pattern[] = "/tmp/mkddc-lifecycle-XXXXXX";
        if (::mkdtemp(pattern) != nullptr) path = pattern;
    }
    ~TempTree()
    {
        if (!path.empty()) std::filesystem::remove_all(path);
    }
};

/* `faulting == true` cho một Program chia cho 0 ngay chu kỳ đầu — cách trực tiếp
 * nhất để dựng "một Program hỏng trong gói nhiều Program". `d` là VAR_INPUT
 * không có binding nên giữ giá trị khởi tạo 0, đúng mẫu đã dùng ở
 * `test_st_scheduler.cpp`. */
std::vector<uint8_t> program_ir(const std::string& name, bool faulting)
{
    std::string source = "PROGRAM " + name + "\n";
    if (faulting) source += "VAR_INPUT d : INT; END_VAR\n";
    source += "VAR_OUTPUT n : INT; END_VAR\n";
    source += "  n := n + 1;\n";
    if (faulting) source += "  n := n / d;\n";
    source += "END_PROGRAM\n";
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

std::vector<uint8_t> package_of(const std::vector<std::pair<std::string, bool>>& programs,
                                const std::vector<uint32_t>& periods = {})
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    for (std::size_t index = 0; index < programs.size(); ++index) {
        const uint32_t period = index < periods.size() ? periods[index] : 0u;
        input.programs.push_back(
            {programs[index].first, program_ir(programs[index].first, programs[index].second),
             period, 0u});
        StPouSignature signature;
        signature.name = programs[index].first;
        signature.kind = StPouKind::PROGRAM;
        input.pou_signatures.push_back(signature);
    }
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    return bytes;
}

StageCommand write_candidate(const TempTree& tree, const std::string& operation,
                             const std::vector<uint8_t>& bytes, const std::string& instance)
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
    command.revision_id = kRevision;
    command.instance_id = instance;
    command.locator = locator.string();
    command.byte_size = bytes.size();
    command.sha256.assign(digest.begin(), digest.end());
    command.plan_hash = std::string(64, 'b');
    return command;
}

void configure_task(StScheduler* scheduler)
{
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    std::string error;
    ASSERT_TRUE(scheduler->add_task(task, &error)) << error;
}

ActivateCommand activation_for(const StageCommand& staged, const std::string& expected_active = "")
{
    ActivateCommand command;
    command.operation_id = staged.operation_id;
    command.expected_active_revision_id = expected_active;
    command.staged_token = staged.operation_id;
    command.cutover = CutoverMode::PROGRAM_ONLY;
    command.plan_hash = staged.plan_hash;
    return command;
}

/* Package mới handoff ở Disabled theo T59-305/405. Các test lifecycle cần
 * thực thi thân Program nên phải đi qua chính command PROGRAM_ENABLE, không
 * được biến fixture thành một lối auto-start song song với production. */
bool enable_all(ProgrammingRuntimeCoordinator* coordinator, StScheduler* scheduler)
{
    const RuntimeOperationSnapshot snapshot = coordinator->snapshot();
    for (const std::string& instance_id : coordinator->instance_ids()) {
        ProgramEnableCommand command;
        command.operation_id = snapshot.operation_id;
        command.instance_id = instance_id;
        command.enabled = true;
        std::string detail;
        std::string error;
        if (test::enable_at_boundary(coordinator, scheduler, command, &detail, &error) !=
            ProgramEnableOutcome::APPLIED)
            return false;
    }
    return true;
}

/* Một base step đầy đủ: boundary → tick → publish output → báo coordinator. */
bool run_cycle(StScheduler* scheduler, ProgrammingRuntimeCoordinator* coordinator,
               PointTable* table, PriorityResolver* resolver, uint64_t now_ns)
{
    coordinator->on_safe_boundary();
    if (!enable_all(coordinator, scheduler)) return false;
    scheduler->tick(now_ns);
    StIoBridgeStats stats;
    const bool committed = st_apply_all_outputs(scheduler, resolver, table, &stats);
    coordinator->on_output_commit(committed);
    return committed;
}

} // namespace

/* Bất biến 1+2: một Program hỏng chu kỳ đầu làm CẢ GÓI quay về, không phải chỉ
 * Program đó. Trước T59-501, barrier chỉ xét `instance_id_` nên gói được tuyên
 * bố FIRST_CYCLE_OK trong khi một Program đã chết. */
TEST(ProgrammingPackageLifecycle, OneProgramFailingFirstCycleRollsBackWholePackage)
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
    PointTable table;
    PriorityResolver resolver;

    /* Gói LÀNH chạy trước để có LKG thật cho cả hai Program. */
    const StageCommand healthy =
        write_candidate(tree, kOperation, package_of({{"P_a", false}, {"P_b", false}}), "P_a");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(healthy, &detail, &error)) << detail << ": " << error;
    ASSERT_TRUE(coordinator.activate(activation_for(healthy), &detail, &error)) << detail;
    ASSERT_TRUE(run_cycle(&scheduler, &coordinator, &table, &resolver, 1000ULL * 1000000ULL));
    ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
    ASSERT_EQ(coordinator.snapshot().state, LifecycleState::COMMITTED);
    for (const char* id : {"P_a", "P_b"})
        ASSERT_FALSE(scheduler.find_program(id)->last_known_good.empty()) << id;
    const std::vector<uint8_t> lkg_a = scheduler.find_program("P_a")->last_known_good;
    const std::vector<uint8_t> lkg_b = scheduler.find_program("P_b")->last_known_good;

    /* Gói MỚI: P_a lành, P_b chia cho 0 ở chu kỳ đầu. */
    const StageCommand broken =
        write_candidate(tree, kOperation2, package_of({{"P_a", false}, {"P_b", true}}), "P_a");
    ASSERT_TRUE(coordinator.stage(broken, &detail, &error)) << detail << ": " << error;
    /* Lần activate thứ hai phải khai đúng revision đang active — nếu không,
     * coordinator từ chối bằng `IPC-EXPECTED-ACTIVE` trước khi tới barrier. */
    ASSERT_TRUE(coordinator.activate(activation_for(broken, kRevision), &detail, &error)) << detail;
    run_cycle(&scheduler, &coordinator, &table, &resolver, 2000ULL * 1000000ULL);

    const LifecycleState state = coordinator.snapshot().state;
    ASSERT_EQ(state, LifecycleState::ROLLING_BACK)
        << "gói có Program chết không arm được whole-package rollback";
    coordinator.on_safe_boundary();
    ASSERT_EQ(coordinator.snapshot().state, LifecycleState::ROLLED_BACK)
        << "topology cũ chưa được khôi phục ở rollback boundary";

    /* LKG kiểm SAU rollback handoff: trong ROLLING_BACK scheduler vẫn đang sở
     * hữu shadow candidate, còn topology/LKG cũ được coordinator giữ nguyên ở
     * `previous_program_set_`. Đọc trước boundary là đọc nhầm phía transaction. */
    EXPECT_EQ(scheduler.find_program("P_a")->last_known_good, lkg_a);
    EXPECT_EQ(scheduler.find_program("P_b")->last_known_good, lkg_b);
}

/* Bất biến 3, kiểm THẲNG vào luật thăng cấp.
 *
 * Không dựng kịch bản "Program 30 s chưa tới lượt" vì `st_program_due` cho lần
 * release ĐẦU TIÊN chạy ngay (T59-402) — mọi Program của gói đều chạy ở base
 * step đầu. Kịch bản đó chỉ xảy ra khi một Task bị disable đúng lúc activate, và
 * dựng nó qua nhiều lớp sẽ đo lẫn nhiều thứ khác. Ở đây bỏ cờ tư cách của đúng
 * một Program rồi kiểm luật: KHÔNG Program nào được thăng cấp. */
TEST(ProgrammingPackageLifecycle, LkgPromotionIsAllOrNothingAcrossPackage)
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

    const StageCommand staged = write_candidate(
        tree, kOperation, package_of({{"P_fast", false}, {"P_slow", false}}, {1000u, 5000u}),
        "P_fast");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(staged, &detail, &error)) << detail << ": " << error;
    ASSERT_TRUE(coordinator.activate(activation_for(staged), &detail, &error)) << detail;
    coordinator.on_safe_boundary();
    ASSERT_TRUE(enable_all(&coordinator, &scheduler));
    scheduler.tick(1000ULL * 1000000ULL);

    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
    /* Cả hai chạy được ở base step đầu (first release chạy ngay), nên cả hai
     * cùng đủ tư cách và cùng được thăng cấp. */
    EXPECT_FALSE(scheduler.find_program("P_fast")->last_known_good.empty());
    EXPECT_FALSE(scheduler.find_program("P_slow")->last_known_good.empty());

    /* Chiều ngược lại kiểm THẲNG vào luật, trên một scheduler riêng: bỏ tư cách
     * của đúng một Program thì KHÔNG Program nào được thăng cấp — kể cả Program
     * vẫn đủ tư cách. Dựng qua coordinator sẽ phải đi qua cả máy trạng thái
     * operation và đo lẫn nhiều thứ khác. */
    StScheduler plain(StSchedulerProfile::REV_A);
    configure_task(&plain);
    ASSERT_TRUE(plain.add_program("main", "P_one", 0, &error)) << error;
    ASSERT_TRUE(plain.add_program("main", "P_two", 1, &error)) << error;
    for (const char* id : {"P_one", "P_two"})
        ASSERT_TRUE(plain.request_activation(id, program_ir(id, false), &error)) << error;
    plain.tick(0);
    for (const char* id : {"P_one", "P_two"}) ASSERT_TRUE(plain.start(id, &error)) << error;
    plain.tick(1000ULL * 1000000ULL);

    /* Giả lập đúng một Program chưa chạy sạch chu kỳ nào kể từ activate. */
    plain.find_program("P_one")->committed_since_activation = true;
    plain.find_program("P_two")->committed_since_activation = false;
    plain.promote_output_committed_artifacts();
    EXPECT_TRUE(plain.find_program("P_one")->last_known_good.empty())
        << "Program đủ tư cách được thăng cấp riêng lẻ — tập LKG thành nửa gói mới nửa gói cũ";
    EXPECT_TRUE(plain.find_program("P_two")->last_known_good.empty());

    /* Đủ tư cách cả hai thì thăng cấp cả hai, cùng một lượt. */
    plain.find_program("P_two")->committed_since_activation = true;
    plain.promote_output_committed_artifacts();
    EXPECT_FALSE(plain.find_program("P_one")->last_known_good.empty());
    EXPECT_FALSE(plain.find_program("P_two")->last_known_good.empty());
}

/* Gói trộn chu kỳ vẫn qua barrier ở base step đầu vì lần release đầu tiên chạy
 * ngay (T59-402). Khoá điều đó lại để nếu ai đổi luật release thì đỏ ở đây chứ
 * không đỏ ở hiện trường bằng một Commission treo. */
TEST(ProgrammingPackageLifecycle, MixedPeriodPackageClearsBarrierOnFirstBaseStep)
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
    PointTable table;
    PriorityResolver resolver;

    const StageCommand staged = write_candidate(
        tree, kOperation, package_of({{"P_fast", false}, {"P_slow", false}}, {1000u, 5000u}), "P_fast");
    std::string detail;
    ASSERT_TRUE(coordinator.stage(staged, &detail, &error)) << detail << ": " << error;
    ASSERT_TRUE(coordinator.activate(activation_for(staged), &detail, &error)) << detail;

    /* Base step đầu: chỉ P_fast tới hạn. Barrier phải là PENDING, và KHÔNG
     * Program nào được thăng cấp LKG. */
    run_cycle(&scheduler, &coordinator, &table, &resolver, 1000ULL * 1000000ULL);
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::FIRST_CYCLE_OK)
        << "gói trộn chu kỳ treo ở ACTIVE_CANDIDATE — luật first-release đã đổi";
    EXPECT_FALSE(scheduler.find_program("P_fast")->last_known_good.empty());
    EXPECT_FALSE(scheduler.find_program("P_slow")->last_known_good.empty());
}

/* Khởi động lại ở TỪNG pha: không pha nào để lại gói active một nửa. Đây là
 * "fault mọi phase/restart" ở mức có thể mô phỏng trên host. */
TEST(ProgrammingPackageLifecycle, RestartAtEveryPhaseLeavesNoPartialActive)
{
    struct Phase {
        const char* name;
        int stop_after; /* 0=sau stage, 1=sau activate, 2=sau chu kỳ đầu, 3=sau flush */
    };
    for (const Phase phase : {Phase{"sau stage", 0}, Phase{"sau activate", 1},
                              Phase{"sau chu kỳ đầu", 2}, Phase{"sau flush", 3}}) {
        TempTree tree;
        ASSERT_FALSE(tree.path.empty()) << phase.name;
        std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
        const std::vector<uint8_t> bytes = package_of({{"P_a", false}, {"P_b", false}});
        const StageCommand staged = write_candidate(tree, kOperation, bytes, "P_a");
        {
            StScheduler scheduler(StSchedulerProfile::REV_A);
            configure_task(&scheduler);
            ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
            ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
                                                       tree.path + "/journal.bin",
                                                       tree.path + "/staging");
            std::string error;
            ASSERT_TRUE(coordinator.recover(&error)) << phase.name << ": " << error;
            std::string detail;
            ASSERT_TRUE(coordinator.stage(staged, &detail, &error)) << phase.name << ": " << detail;
            if (phase.stop_after >= 1) {
                ASSERT_TRUE(coordinator.activate(activation_for(staged), &detail, &error))
                    << phase.name << ": " << detail;
            }
            if (phase.stop_after >= 2) {
                PointTable table;
                PriorityResolver resolver;
                run_cycle(&scheduler, &coordinator, &table, &resolver, 1000ULL * 1000000ULL);
            }
            if (phase.stop_after >= 3) {
                ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
            }
        }

        /* Tiến trình mới trên cùng journal/staging. */
        StScheduler restarted(StSchedulerProfile::REV_A);
        configure_task(&restarted);
        ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
        ProgrammingRuntimeCoordinator coordinator(&restarted, &cutover, tree.path + "/journal.bin",
                                                   tree.path + "/staging");
        std::string error;
        ASSERT_TRUE(coordinator.recover(&error)) << phase.name << ": " << error;

        /* Bất biến: hoặc CẢ HAI Program chạy gói này, hoặc KHÔNG Program nào —
         * không bao giờ một nửa. */
        const StProgramInstance* a = restarted.find_program("P_a");
        const StProgramInstance* b = restarted.find_program("P_b");
        const bool a_active = a != nullptr && a->runtime.loaded();
        const bool b_active = b != nullptr && b->runtime.loaded();
        EXPECT_EQ(a_active, b_active)
            << phase.name << ": gói active một nửa sau khởi động lại";
    }
}
