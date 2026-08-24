/**
 * @file test_programming_runtime_coordinator.cpp
 * @brief TASK-PROG-403..405 — durable stage/commit, exclusive cutover,
 *        first-cycle rollback và boot recovery fail-closed.
 */
#include <gtest/gtest.h>

#include <array>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

#include <sodium.h>
#include <unistd.h>

#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_process_image.hpp"
#include "st/st_test_key.hpp"

namespace core::programming {
namespace {

constexpr uint64_t kMs = 1000000ULL;
constexpr const char* kOp1 = "11111111-1111-4111-8111-111111111111";
constexpr const char* kOp2 = "22222222-2222-4222-8222-222222222222";
constexpr const char* kRevision1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
constexpr const char* kRevision2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

class TempTree {
public:
    TempTree()
    {
        char value[] = "/tmp/mkddc-programming-lifecycle-XXXXXX";
        const char* created = ::mkdtemp(value);
        if (created) path = created;
    }
    ~TempTree() { if (!path.empty()) std::filesystem::remove_all(path); }
    std::string path;
};

std::vector<uint8_t> artifact_with_value(int value)
{
    const std::string source = "PROGRAM p\nVAR x : DINT; END_VAR\nx := " +
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

/* WP-12 (RETAIN Reset). Biến RETAIN đếm lên mỗi chu kỳ — dùng để xác nhận
 * `reset_retain()` thật sự đưa giá trị sống về 0 qua toàn bộ đường
 * coordinator -> scheduler -> runtime, không chỉ ở tầng thấp nhất
 * (`test_st_retain.cpp` đã phủ tầng đó). */
std::vector<uint8_t> retained_counter_artifact()
{
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source("PROGRAM p\nVAR RETAIN n : INT; END_VAR\nn := n + 1;\nEND_PROGRAM\n",
                                  &module, &diagnostic))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

StageCommand write_candidate_bytes(const TempTree& tree, const std::string& operation,
                                   const std::string& revision, const std::vector<uint8_t>& bytes,
                                   char plan_hash_fill)
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
    command.instance_id = "program-main";
    command.locator = locator.string();
    command.byte_size = bytes.size();
    command.sha256.assign(digest.begin(), digest.end());
    command.plan_hash = std::string(64, plan_hash_fill);
    return command;
}

StageCommand write_candidate(const TempTree& tree, const std::string& operation,
                             const std::string& revision, int value)
{
    return write_candidate_bytes(tree, operation, revision, artifact_with_value(value),
                                 static_cast<char>('a' + value));
}

ActivateCommand activation_for(const StageCommand& staged, const std::string& expected)
{
    ActivateCommand command;
    command.operation_id = staged.operation_id;
    command.expected_active_revision_id = expected;
    command.staged_token = staged.operation_id;
    command.cutover = CutoverMode::PROGRAM_ONLY;
    command.plan_hash = staged.plan_hash;
    return command;
}

std::string digest_hex(const std::vector<uint8_t>& digest)
{
    static constexpr char HEX[] = "0123456789abcdef";
    std::string output(digest.size() * 2, '0');
    for (std::size_t index = 0; index < digest.size(); ++index) {
        output[index * 2] = HEX[digest[index] >> 4U];
        output[index * 2 + 1] = HEX[digest[index] & 0x0fU];
    }
    return output;
}

bool execute_and_commit(StScheduler* scheduler)
{
    scheduler->tick(scheduler->base_step_count() * 1000ULL * kMs + 1000ULL * kMs);
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    return st_apply_all_outputs(scheduler, &resolver, &table, &stats);
}

void configure_runtime_topology(StScheduler* scheduler)
{
    StTaskConfig task;
    task.id = "main";
    task.priority = 0;
    task.period_ms = 1000;
    task.budget_ms = 199;
    task.overrun_threshold = 3;
    std::string error;
    ASSERT_TRUE(scheduler->add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler->add_program("main", "program-main", 0, &error)) << error;
}

} // namespace

TEST(ProgrammingRuntimeCoordinator, CommitsOnlyAfterFirstOutputAndJournalsEachPhaseOnce)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    const std::string journal = tree.path + "/journal.bin";
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, journal,
                                               tree.path + "/staging");
    std::string detail, error;
    const StageCommand staged = write_candidate(tree, kOp1, kRevision1, 1);
    ASSERT_TRUE(coordinator.stage(staged, &detail, &error)) << detail << ": " << error;
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::STAGED);
    EXPECT_EQ(cutover.current(), CutoverMode::GRAPH_ONLY);
    ASSERT_TRUE(coordinator.activate(activation_for(staged, ""), &detail, &error))
        << detail << ": " << error;

    coordinator.on_safe_boundary();
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::ACTIVE_CANDIDATE);
    EXPECT_EQ(cutover.current(), CutoverMode::PROGRAM_ONLY);
    ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
    ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
    EXPECT_EQ(StJournal(journal).read_last().valid_record_count, 3U)
        << "PREPARED + COMMIT_INTENT + ACTIVE_CANDIDATE, không ghi lặp khi poll";

    ASSERT_TRUE(execute_and_commit(&scheduler));
    coordinator.on_output_commit(true);
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::FIRST_CYCLE_OK);
    ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
    const RuntimeOperationSnapshot snapshot = coordinator.snapshot();
    EXPECT_EQ(snapshot.state, LifecycleState::COMMITTED);
    EXPECT_EQ(snapshot.active_revision_id, kRevision1);
    EXPECT_EQ(snapshot.lkg_revision_id, kRevision1);
    const StJournalReadResult read = StJournal(journal).read_last();
    EXPECT_EQ(read.record.phase, StJournalPhase::COMMITTED);
    EXPECT_EQ(read.valid_record_count, 5U);
}

TEST(ProgrammingRuntimeCoordinator, FirstCycleFailureRestoresPriorLkgAndGraphOwner)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
        tree.path + "/journal.bin", tree.path + "/staging");
    std::string detail, error;

    const StageCommand first = write_candidate(tree, kOp1, kRevision1, 1);
    ASSERT_TRUE(coordinator.stage(first, &detail, &error));
    ASSERT_TRUE(coordinator.activate(activation_for(first, ""), &detail, &error));
    coordinator.on_safe_boundary();
    ASSERT_TRUE(execute_and_commit(&scheduler));
    coordinator.on_output_commit(true);
    ASSERT_TRUE(coordinator.flush_progress(&error));

    const StageCommand second = write_candidate(tree, kOp2, kRevision2, 2);
    ASSERT_TRUE(coordinator.stage(second, &detail, &error)) << detail << ": " << error;
    ASSERT_TRUE(coordinator.activate(activation_for(second, kRevision1), &detail, &error));
    coordinator.on_safe_boundary();
    scheduler.tick(2000ULL * kMs);
    coordinator.on_output_commit(false); /* fault/output preflight reject */
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::ROLLING_BACK);
    EXPECT_FALSE(coordinator.snapshot().keeps_running)
        << "chưa được claim LKG đang chạy trước safe boundary rollback";
    EXPECT_EQ(cutover.current(), CutoverMode::PROGRAM_ONLY)
        << "owner chỉ đổi ở safe boundary kế tiếp";

    coordinator.on_safe_boundary();
    EXPECT_EQ(cutover.current(), CutoverMode::GRAPH_ONLY);
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::ROLLED_BACK);
    EXPECT_TRUE(coordinator.snapshot().keeps_running);
    const StProgramInstance* instance = scheduler.find_program("program-main");
    ASSERT_NE(instance, nullptr);
    EXPECT_EQ(instance->state, StProgramState::RUNNING);
    EXPECT_EQ(coordinator.snapshot().active_revision_id, kRevision1);
    EXPECT_EQ(coordinator.snapshot().lkg_revision_id, kRevision1);
}

TEST(ProgrammingRuntimeCoordinator, RestoreUsesSameVerifiedActivationAndCommitsReadback)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
        tree.path + "/journal.bin", tree.path + "/staging");
    std::string detail, error;
    const StageCommand first = write_candidate(tree, kOp1, kRevision1, 1);
    ASSERT_TRUE(coordinator.stage(first, &detail, &error));
    ASSERT_TRUE(coordinator.activate(activation_for(first, ""), &detail, &error));
    coordinator.on_safe_boundary();
    ASSERT_TRUE(execute_and_commit(&scheduler));
    coordinator.on_output_commit(true);
    ASSERT_TRUE(coordinator.flush_progress(&error));

    const StageCommand restored = write_candidate(tree, kOp2, kRevision2, 2);
    ASSERT_TRUE(coordinator.restore(restored, &detail, &error));
    ASSERT_TRUE(coordinator.activate(activation_for(restored, kRevision1), &detail, &error));
    coordinator.on_safe_boundary();
    ASSERT_TRUE(execute_and_commit(&scheduler));
    coordinator.on_output_commit(true);
    ASSERT_TRUE(coordinator.flush_progress(&error));
    const RuntimeOperationSnapshot snapshot = coordinator.snapshot();
    EXPECT_EQ(snapshot.state, LifecycleState::COMMITTED);
    EXPECT_EQ(snapshot.operation_id, kOp2);
    EXPECT_EQ(snapshot.active_revision_id, kRevision2);
    EXPECT_EQ(snapshot.lkg_revision_id, kRevision2);
    EXPECT_EQ(cutover.current(), CutoverMode::PROGRAM_ONLY);
}

TEST(ProgrammingRuntimeCoordinator, RejectsCorruptHashAndSymlinkBeforeSchedulerMutation)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
        tree.path + "/journal.bin", tree.path + "/staging");
    std::string detail, error;
    StageCommand corrupt = write_candidate(tree, kOp1, kRevision1, 1);
    corrupt.sha256[0] ^= 0xffU;
    EXPECT_FALSE(coordinator.stage(corrupt, &detail, &error));
    EXPECT_EQ(detail, "IPC-STAGING-HASH");
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::IDLE);

    StageCommand symlink = write_candidate(tree, kOp2, kRevision2, 2);
    const std::string real = symlink.locator;
    const std::string link = tree.path + "/staging/" + std::string(kOp2) + "/link.mkddcir";
    ASSERT_EQ(::symlink(real.c_str(), link.c_str()), 0);
    symlink.locator = link;
    detail.clear();
    EXPECT_FALSE(coordinator.stage(symlink, &detail, &error));
    EXPECT_EQ(detail, "IPC-STAGING-OPEN");
    EXPECT_EQ(scheduler.find_program("program-main"), nullptr);

    StageCommand traversal = write_candidate(tree, kOp2, kRevision2, 2);
    traversal.locator = tree.path + "/staging/../outside.mkddcir";
    detail.clear();
    EXPECT_FALSE(coordinator.stage(traversal, &detail, &error));
    EXPECT_EQ(detail, "IPC-STAGING-OPEN");
}

TEST(ProgrammingRuntimeCoordinator, RecoveryMatrixNeverPublishesAmbiguousCandidate)
{
    struct Case { StJournalPhase phase; LifecycleState expected; };
    const Case cases[] = {
        {StJournalPhase::PREPARED, LifecycleState::IDLE},
        {StJournalPhase::COMMIT_INTENT, LifecycleState::FAILED},
        {StJournalPhase::ACTIVE_CANDIDATE, LifecycleState::RECOVERY_REQUIRED},
        {StJournalPhase::FIRST_CYCLE_OK, LifecycleState::RECOVERY_REQUIRED},
        {StJournalPhase::COMMITTED, LifecycleState::RECOVERY_REQUIRED},
    };
    for (const Case& item : cases) {
        TempTree tree;
        ASSERT_FALSE(tree.path.empty());
        const std::string path = tree.path + "/journal.bin";
        StJournalRecord record;
        record.phase = item.phase;
        record.timestamp_ns = 1;
        record.operation_id = kOp1;
        record.old_active_hash = "old";
        record.candidate_hash = "candidate";
        record.plan_hash = "plan";
        ASSERT_TRUE(StJournal(path).append(record));
        StScheduler scheduler(StSchedulerProfile::REV_A);
        ProgrammingCutover cutover(CutoverMode::PROGRAM_ONLY);
        ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, path,
                                                    tree.path + "/staging");
        std::string error;
        const bool recovered = coordinator.recover(&error);
        EXPECT_EQ(recovered, item.expected != LifecycleState::RECOVERY_REQUIRED);
        EXPECT_EQ(coordinator.snapshot().state, item.expected);
        EXPECT_EQ(cutover.current(), CutoverMode::GRAPH_ONLY);
        if (item.expected == LifecycleState::RECOVERY_REQUIRED) {
            std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
            const StageCommand candidate = write_candidate(tree, kOp2, kRevision2, 2);
            std::string detail;
            EXPECT_FALSE(coordinator.stage(candidate, &detail, &error));
            EXPECT_EQ(detail, "IPC-RECOVERY-REQUIRED");
        }
    }
}

/* T59-702 — `RECOVERY_REQUIRED` phải có LỐI RA tường minh.
 *
 * Trước bản này nó là ngõ cụt: mọi mutation trả `IPC-RECOVERY-REQUIRED`, nên bo
 * chỉ thoát được bằng cách xoá journal bằng tay — tức là xoá sổ vận hành để
 * thoát một trạng thái vận hành. Lần đầu gặp thật là trên bo Foxlinx
 * 2026-08-23: journal `COMMITTED` còn đó nhưng artifact đã bị dọn, Commission
 * mới bị Core từ chối và không có lệnh nào gỡ được.
 */
TEST(ProgrammingRuntimeCoordinator, RecoveryResetMoNutThatNutVaGiuLichSu)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    const std::string path = tree.path + "/journal.bin";
    StJournalRecord record;
    record.phase = StJournalPhase::COMMITTED;
    record.timestamp_ns = 1;
    record.operation_id = kOp1;
    record.old_active_hash = "old";
    record.candidate_hash = "candidate";
    record.plan_hash = "plan";
    ASSERT_TRUE(StJournal(path).append(record));

    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::PROGRAM_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, path, tree.path + "/staging");
    std::string error;
    EXPECT_FALSE(coordinator.recover(&error));
    ASSERT_EQ(coordinator.snapshot().state, LifecycleState::RECOVERY_REQUIRED);

    /* Thiếu actor: từ chối. Một quyết định bỏ giao dịch không có chủ thì không
     * truy được về sau. */
    RecoveryResetCommand nameless;
    nameless.operation_id = kOp2;
    std::string detail;
    EXPECT_EQ(coordinator.recovery_reset(nameless, &detail, &error),
              RecoveryResetOutcome::REJECTED);
    EXPECT_EQ(detail, "RECOVERY_RESET_ACTOR_REQUIRED");
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::RECOVERY_REQUIRED);

    RecoveryResetCommand command;
    command.operation_id = kOp2;
    command.actor_id = "operator-qa";
    EXPECT_EQ(coordinator.recovery_reset(command, &detail, &error), RecoveryResetOutcome::APPLIED);
    EXPECT_EQ(detail, "RECOVERY_RESET_APPLIED");
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::IDLE);
    EXPECT_EQ(cutover.current(), CutoverMode::GRAPH_ONLY);

    /* Journal GIỮ NGUYÊN bản ghi cũ và có thêm bản ghi reset — không xoá gì. */
    const StJournalReadResult read = StJournal(path).read_last();
    EXPECT_EQ(read.status, StJournalReadStatus::OK);
    EXPECT_EQ(read.valid_record_count, 2u);
    EXPECT_EQ(read.record.phase, StJournalPhase::RECOVERY_RESET);
    EXPECT_EQ(read.record.old_active_hash, "operator-qa");

    /* Sau reset, Commission mới đi được. */
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    const StageCommand candidate = write_candidate(tree, kOp2, kRevision2, 2);
    EXPECT_TRUE(coordinator.stage(candidate, &detail, &error)) << detail << " " << error;
}

/* Reset ngoài ngữ cảnh `RECOVERY_REQUIRED` phải bị từ chối: nếu không, nó thành
 * một cách bỏ Active đang chạy mà không đi qua Disable/Restore. */
TEST(ProgrammingRuntimeCoordinator, RecoveryResetTuChoiKhiKhongOTrangThaiRecovery)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    StScheduler scheduler(StSchedulerProfile::REV_A);
    ProgrammingCutover cutover(CutoverMode::PROGRAM_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                                tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(coordinator.recover(&error));
    ASSERT_EQ(coordinator.snapshot().state, LifecycleState::IDLE);

    RecoveryResetCommand command;
    command.operation_id = kOp1;
    command.actor_id = "operator-qa";
    std::string detail;
    EXPECT_EQ(coordinator.recovery_reset(command, &detail, &error),
              RecoveryResetOutcome::NOT_IN_RECOVERY);
    EXPECT_EQ(detail, "RECOVERY_RESET_NOT_IN_RECOVERY");
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::IDLE);
}

TEST(ProgrammingRuntimeCoordinator, CorruptJournalKeepsGraphAndBlocksMutation)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    const std::string path = tree.path + "/journal.bin";
    {
        std::ofstream output(path, std::ios::binary);
        /* Ít hơn một record là torn-first-write hợp lệ và được coi EMPTY;
         * đủ kích thước nhưng sai magic/CRC mới là journal CORRUPT. */
        const std::array<uint8_t, 300> corrupt{};
        output.write(reinterpret_cast<const char*>(corrupt.data()), corrupt.size());
    }
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::PROGRAM_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, path,
                                                tree.path + "/staging");
    std::string error;
    EXPECT_FALSE(coordinator.recover(&error));
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::RECOVERY_REQUIRED);
    EXPECT_EQ(coordinator.snapshot().detail_code, "JOURNAL_CORRUPT");
    EXPECT_EQ(cutover.current(), CutoverMode::GRAPH_ONLY);
    std::string detail;
    const StageCommand candidate = write_candidate(tree, kOp2, kRevision2, 2);
    EXPECT_FALSE(coordinator.stage(candidate, &detail, &error));
    EXPECT_EQ(detail, "IPC-RECOVERY-REQUIRED");
}

TEST(ProgrammingRuntimeCoordinator, CommittedCheckpointRestoresExactRuntimeAcrossCoreRestart)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    const std::string journal = tree.path + "/journal.bin";
    const StageCommand staged = write_candidate(tree, kOp1, kRevision1, 1);
    {
        StScheduler scheduler(StSchedulerProfile::REV_A);
        configure_runtime_topology(&scheduler);
        ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
        ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, journal,
                                                   tree.path + "/staging");
        std::string detail, error;
        ASSERT_TRUE(coordinator.stage(staged, &detail, &error));
        ASSERT_TRUE(coordinator.activate(activation_for(staged, ""), &detail, &error));
        coordinator.on_safe_boundary();
        ASSERT_TRUE(execute_and_commit(&scheduler));
        coordinator.on_output_commit(true);
        ASSERT_TRUE(coordinator.flush_progress(&error)) << error;
        ASSERT_EQ(coordinator.snapshot().state, LifecycleState::COMMITTED);
    }

    StScheduler restarted_scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&restarted_scheduler);
    ProgrammingCutover restarted_cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator restarted(&restarted_scheduler, &restarted_cutover,
                                             journal, tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(restarted.recover(&error)) << error;
    const RuntimeOperationSnapshot snapshot = restarted.snapshot();
    EXPECT_EQ(snapshot.state, LifecycleState::COMMITTED);
    EXPECT_EQ(snapshot.operation_id, kOp1);
    EXPECT_EQ(snapshot.active_revision_id, kRevision1);
    EXPECT_EQ(snapshot.lkg_revision_id, kRevision1);
    EXPECT_EQ(snapshot.artifact_sha256, digest_hex(staged.sha256));
    EXPECT_EQ(restarted_cutover.current(), CutoverMode::PROGRAM_ONLY);
    const StProgramInstance* program = restarted_scheduler.find_program("program-main");
    ASSERT_NE(program, nullptr);
    EXPECT_EQ(program->state, StProgramState::RUNNING);
    EXPECT_FALSE(program->last_known_good.empty());
}

TEST(ProgrammingRuntimeCoordinator, RestartDuringActiveCandidateRestoresPriorLkg)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    std::filesystem::create_directories(std::filesystem::path(tree.path) / "staging");
    const std::string journal = tree.path + "/journal.bin";
    const StageCommand first = write_candidate(tree, kOp1, kRevision1, 1);
    const StageCommand second = write_candidate(tree, kOp2, kRevision2, 2);
    {
        StScheduler scheduler(StSchedulerProfile::REV_A);
        configure_runtime_topology(&scheduler);
        ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
        ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, journal,
                                                   tree.path + "/staging");
        std::string detail, error;
        ASSERT_TRUE(coordinator.stage(first, &detail, &error));
        ASSERT_TRUE(coordinator.activate(activation_for(first, ""), &detail, &error));
        coordinator.on_safe_boundary();
        ASSERT_TRUE(execute_and_commit(&scheduler));
        coordinator.on_output_commit(true);
        ASSERT_TRUE(coordinator.flush_progress(&error));
        ASSERT_TRUE(coordinator.stage(second, &detail, &error));
        ASSERT_TRUE(coordinator.activate(activation_for(second, kRevision1), &detail, &error));
        coordinator.on_safe_boundary();
        ASSERT_TRUE(coordinator.flush_progress(&error));
        ASSERT_EQ(StJournal(journal).read_last().record.phase,
                  StJournalPhase::ACTIVE_CANDIDATE);
    }

    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator restarted(&scheduler, &cutover, journal,
                                             tree.path + "/staging");
    std::string error;
    ASSERT_TRUE(restarted.recover(&error)) << error;
    const RuntimeOperationSnapshot snapshot = restarted.snapshot();
    EXPECT_EQ(snapshot.state, LifecycleState::ROLLED_BACK);
    EXPECT_EQ(snapshot.operation_id, kOp2)
        << "OPERATION_STATUS phải reconcile đúng candidate bị ngắt";
    EXPECT_EQ(snapshot.active_revision_id, kRevision1);
    EXPECT_EQ(snapshot.lkg_revision_id, kRevision1);
    EXPECT_EQ(cutover.current(), CutoverMode::PROGRAM_ONLY);
    const StProgramInstance* program = scheduler.find_program("program-main");
    ASSERT_NE(program, nullptr);
    EXPECT_EQ(program->state, StProgramState::RUNNING);
}

TEST(ProgrammingRuntimeCoordinator, PriorityImpactIsUnavailableUntilScanSnapshotAndThenExact)
{
    TempTree tree;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
        tree.path + "/journal.bin", tree.path + "/staging");
    EXPECT_FALSE(coordinator.snapshot().impact_snapshot_valid);
    PriorityResolver resolver;
    ASSERT_TRUE(resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 3.0F));
    ASSERT_TRUE(resolver.set_do(PRIO_BACNET, 0, true));
    coordinator.capture_priority_overrides(resolver);
    const RuntimeOperationSnapshot snapshot = coordinator.snapshot();
    ASSERT_TRUE(snapshot.impact_snapshot_valid);
    ASSERT_EQ(snapshot.active_override_ids.size(), 2U);
    EXPECT_EQ(snapshot.active_override_ids[0], "AO-1:manual");
    EXPECT_EQ(snapshot.active_override_ids[1], "DO-1:bacnet");
}

/* ---- WP-12: RETAIN Reset (DDD-RETAIN-RESET-PROG-001) ---- */

/* Stage+activate+commit một artifact có VAR RETAIN tới COMMITTED — tiền
 * điều kiện bắt buộc để gọi `reset_retain()` (guard state ở §3 design). */
void commission_retained_program(ProgrammingRuntimeCoordinator* coordinator, StScheduler* scheduler,
                                 const TempTree& tree, const std::string& operation,
                                 const std::string& revision)
{
    std::string detail, error;
    const StageCommand staged =
        write_candidate_bytes(tree, operation, revision, retained_counter_artifact(), 'c');
    ASSERT_TRUE(coordinator->stage(staged, &detail, &error)) << detail << ": " << error;
    ASSERT_TRUE(coordinator->activate(activation_for(staged, ""), &detail, &error))
        << detail << ": " << error;
    coordinator->on_safe_boundary();
    ASSERT_TRUE(coordinator->flush_progress(&error)) << error;
    ASSERT_TRUE(execute_and_commit(scheduler));
    coordinator->on_output_commit(true);
    ASSERT_TRUE(coordinator->flush_progress(&error)) << error;
    ASSERT_EQ(coordinator->snapshot().state, LifecycleState::COMMITTED);
}

RetainResetCommand retain_reset_for(const std::string& operation, const std::string& expected_revision)
{
    RetainResetCommand command;
    command.operation_id = operation;
    command.instance_id = "program-main";
    command.expected_active_revision_id = expected_revision;
    return command;
}

TEST(ProgrammingRuntimeCoordinator, TC_RETAIN_03a_RejectsResetWhileCommissionInFlightNoHalfReset)
{
    /* "Reset lỗi giữa transaction -> state xác định, không half-reset" —
     * phần dễ nhất để vi phạm là cho phép reset đè lên một Commission đang
     * dở dang (STAGED, chưa COMMITTED). Coordinator phải từ chối THẲNG,
     * không chạm scheduler/instance ở bất kỳ mức nào. */
    TempTree tree;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                              tree.path + "/staging");
    std::string detail, error;
    const StageCommand staged =
        write_candidate_bytes(tree, kOp1, kRevision1, retained_counter_artifact(), 'c');
    ASSERT_TRUE(coordinator.stage(staged, &detail, &error)) << detail << ": " << error;
    ASSERT_EQ(coordinator.snapshot().state, LifecycleState::STAGED);

    const StProgramInstance* before = scheduler.find_program("program-main");
    ASSERT_NE(before, nullptr);
    const uint64_t ack_before = before->retain_reset_ack_generation.load();

    const RetainResetOutcome outcome =
        coordinator.reset_retain(retain_reset_for(kOp2, ""), &detail, &error);
    EXPECT_EQ(outcome, RetainResetOutcome::REJECTED);
    EXPECT_EQ(detail, "IPC-RETAIN-RESET-STATE");
    EXPECT_EQ(before->retain_reset_ack_generation.load(), ack_before)
        << "reject phải KHÔNG chạm cờ pending/ack — no half-reset";
    EXPECT_FALSE(before->pending_retain_reset.load());
}

TEST(ProgrammingRuntimeCoordinator, TC_RETAIN_03b_RejectsResetOnRevisionMismatchNoHalfReset)
{
    TempTree tree;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                              tree.path + "/staging");
    commission_retained_program(&coordinator, &scheduler, tree, kOp1, kRevision1);

    const StProgramInstance* instance = scheduler.find_program("program-main");
    ASSERT_NE(instance, nullptr);
    const uint64_t ack_before = instance->retain_reset_ack_generation.load();

    std::string detail, error;
    /* Gửi đúng operation mới nhưng SAI expected_active_revision_id — đúng
     * TC-RETAIN-05 ở tầng coordinator (Go test lặp lại kịch bản tương
     * đương qua HTTP, xem BE test); ở đây xác nhận reject KHÔNG chạm state. */
    const RetainResetOutcome outcome =
        coordinator.reset_retain(retain_reset_for(kOp2, kRevision2), &detail, &error);
    EXPECT_EQ(outcome, RetainResetOutcome::REJECTED);
    EXPECT_EQ(detail, "IPC-EXPECTED-ACTIVE");
    EXPECT_EQ(instance->retain_reset_ack_generation.load(), ack_before);
    EXPECT_FALSE(instance->pending_retain_reset.load());
}

TEST(ProgrammingRuntimeCoordinator, TC_RETAIN_03c_RejectsUnknownInstanceNoHalfReset)
{
    TempTree tree;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                              tree.path + "/staging");
    commission_retained_program(&coordinator, &scheduler, tree, kOp1, kRevision1);

    std::string detail, error;
    RetainResetCommand bad = retain_reset_for(kOp2, kRevision1);
    bad.instance_id = "no-such-instance";
    const RetainResetOutcome outcome = coordinator.reset_retain(bad, &detail, &error);
    EXPECT_EQ(outcome, RetainResetOutcome::REJECTED);
    EXPECT_EQ(detail, "IPC-RETAIN-RESET-INSTANCE");
}

TEST(ProgrammingRuntimeCoordinator, AppliesRetainResetEndToEndAndForceFlushesPastAutosaveWindow)
{
    /* Đường hạnh phúc đầy đủ: coordinator arm -> scheduler áp dụng tại
     * boundary kế tiếp -> coordinator force-flush -> giá trị RETAIN sống
     * VỀ 0. Đúng luồng Phương án B trong design §1.
     *
     * `reset_retain()` chặn (bounded poll) chờ boundary — trong production
     * một THREAD RIÊNG (scan loop) gọi `on_safe_boundary()` định kỳ trong
     * lúc IPC worker thread đang chờ trong `reset_retain()`. Mô phỏng đúng
     * mô hình luồng đó ở đây thay vì gọi boundary trên cùng thread gọi
     * `reset_retain()` (sẽ không bao giờ chạy tới vì bị chặn) — nếu không
     * test này luôn timeout, không phải vì code sai mà vì môi trường test
     * đơn luồng không mô phỏng đúng RT scan thread thật. */
    TempTree tree;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    configure_runtime_topology(&scheduler);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover, tree.path + "/journal.bin",
                                              tree.path + "/staging");
    commission_retained_program(&coordinator, &scheduler, tree, kOp1, kRevision1);

    /* Chạy thêm vài chu kỳ để giá trị RETAIN thật sự khác 0 trước khi reset. */
    for (int i = 0; i < 4; ++i) ASSERT_TRUE(execute_and_commit(&scheduler));
    StProgramInstance* instance = scheduler.find_program("program-main");
    ASSERT_NE(instance, nullptr);
    StValue before_value;
    ASSERT_TRUE(instance->runtime.get_variable("n", &before_value));
    ASSERT_GT(before_value.i, 0) << "tiền điều kiện: RETAIN phải khác 0 trước reset";

    std::atomic<bool> stop_boundary_thread{false};
    std::thread boundary_thread([&] {
        while (!stop_boundary_thread.load(std::memory_order_acquire)) {
            coordinator.on_safe_boundary();
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
    });

    std::string detail, error;
    const RetainResetOutcome outcome =
        coordinator.reset_retain(retain_reset_for(kOp2, kRevision1), &detail, &error);

    stop_boundary_thread.store(true, std::memory_order_release);
    boundary_thread.join();

    EXPECT_EQ(outcome, RetainResetOutcome::APPLIED) << detail << ": " << error;

    StValue after_value;
    ASSERT_TRUE(instance->runtime.get_variable("n", &after_value));
    EXPECT_EQ(after_value.i, 0) << "reset_retain() phải đưa giá trị sống về 0";
    EXPECT_GT(instance->retain_reset_ack_generation.load(), 0U);
    EXPECT_FALSE(instance->pending_retain_reset.load()) << "cờ pending phải được tiêu thụ";
}

} // namespace core::programming
