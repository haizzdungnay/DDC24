/**
 * @file  test_programming_activate_intent.cpp
 * @brief ADR-062 — intent Enable đã lưu đi cùng ACTIVATE (F13 về 0 ms).
 *
 *        F13 (EV-PROG-FBD-ST-MB-20260925): Restore sang Revision có Program chưa
 *        chạy trong gói cũ làm Core dựng Program đó ở Disabled (T59-305/405).
 *        Intent Enable chỉ tới SAU boundary kích hoạt, nên trong khoảng đó không
 *        ai giữ proposal mức 5 và SafeState vào T7 `no_ctrl`: mọi DO bị ép mở.
 *        Đo trên Foxlinx: 1,38 s, rồi 70 ms sau `Nudge`.
 *
 *        Ba điều được khoá ở đây:
 *        1. Qua ScanLoop THẬT: có intent Enable thì KHÔNG scan nào giữa ACTIVATE
 *           và RUNNING ở `no_ctrl`, và DO giữ nguyên giá trị Program ghi. Một ca
 *           đối chứng không có intent phải thấy đúng khoảng hở đó — không thì
 *           test đầu chứng minh được gì cũng không biết.
 *        2. Fail-closed giữ nguyên: Program không có intent vẫn Disabled; intent
 *           Disable thắng enable của bản đang chạy; vượt trần 16 thì giữ Disabled
 *           mà không chặn kích hoạt; chu kỳ đầu hỏng vẫn rollback cả gói.
 *        3. Golden liên ngôn ngữ: đúng chuỗi byte Go mã hoá phải được Core nhận
 *           và áp đúng intent.
 */
#include <gtest/gtest.h>

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include <sodium.h>
#include <unistd.h>

#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "programming/program_ipc_server.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "runtime/scan_loop.hpp"
#include "st/st_compile.hpp"
#include "st/st_io_map.hpp"
#include "st/st_ir.hpp"
#include "st/st_journal.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_process_image.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

using namespace core;
using namespace core::programming;

namespace {

constexpr uint64_t kMs = 1000000ull;
constexpr const char* kOp1 = "11111111-1111-4111-8111-111111111111";
constexpr const char* kOp2 = "22222222-2222-4222-8222-222222222222";
constexpr const char* kRevision1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
constexpr const char* kRevision2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

struct TempTree {
    std::string path;
    TempTree()
    {
        char pattern[] = "/tmp/mkddc-activate-intent-XXXXXX";
        if (::mkdtemp(pattern) != nullptr) path = pattern;
        if (!path.empty()) std::filesystem::create_directories(path + "/staging");
    }
    ~TempTree()
    {
        if (!path.empty()) std::filesystem::remove_all(path);
    }
};

/* Program ghi `valve := TRUE` ra DO-01. Có output thật là điểm mấu chốt: T7
 * `no_ctrl` chỉ tắt khi có ai đó giữ proposal mức 5 trên một đầu ra. */
std::vector<uint8_t> valve_program_ir(const std::string& name)
{
    const std::string source = "PROGRAM " + name +
                               "\nVAR_OUTPUT valve : BOOL; END_VAR\nvalve := TRUE;\nEND_PROGRAM\n";
    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = name;
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic, options))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<StDiagnostic> binding_diagnostics;
    const std::vector<StIoMapEntry> io_map = {StIoMapEntry{
        "valve", "output", "DO-01", StType::BOOL, "", false, 0.0f, 0.0f, "LOCAL", "", 0, true}};
    EXPECT_TRUE(resolve_io_bindings(&module, io_map, &binding_diagnostics))
        << (!binding_diagnostics.empty() ? binding_diagnostics.front().message : "");
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

/* Program không có output: dùng cho các ca chỉ kiểm cờ Enabled/Disabled. */
std::vector<uint8_t> plain_program_ir(const std::string& name)
{
    const std::string source =
        "PROGRAM " + name + "\nVAR x : DINT; END_VAR\nx := x + 1;\nEND_PROGRAM\n";
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

/* Package v2 dựng bằng đúng writer production. `with_valve` chọn Program nào có
 * output DO-01 (tối đa một Program mỗi gói: một output một owner). */
std::vector<uint8_t> package_of(const std::vector<std::string>& names,
                                const std::string& valve_owner = "")
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    for (const std::string& name : names) {
        input.programs.push_back({name,
                                  name == valve_owner ? valve_program_ir(name) : plain_program_ir(name),
                                  10u, 0u});
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
                             const std::string& instance, char plan_fill = 'a')
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
    command.plan_hash = std::string(64, plan_fill);
    return command;
}

ActivateCommand activation_for(const StageCommand& staged, const std::string& expected,
                               const std::vector<ActivateProgramIntent>* intents)
{
    ActivateCommand command;
    command.operation_id = staged.operation_id;
    command.expected_active_revision_id = expected;
    command.staged_token = staged.operation_id;
    command.cutover = CutoverMode::PROGRAM_ONLY;
    command.plan_hash = staged.plan_hash;
    if (intents != nullptr) {
        command.has_program_intents = true;
        command.program_intents = *intents;
    }
    return command;
}

void configure_task(StScheduler* scheduler)
{
    scheduler->set_base_step_ns(10 * kMs);
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 10;
    task.budget_us = st_base_step::kDefaultBudgetUs;
    std::string error;
    ASSERT_TRUE(scheduler->add_task(task, &error)) << error;
}

bool execute_and_commit(StScheduler* scheduler, uint64_t now_ns)
{
    scheduler->tick(now_ns);
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    return st_apply_all_outputs(scheduler, &resolver, &table, &stats);
}

/* Hệ Core tối thiểu nhưng THẬT: ScanLoop + coordinator + scheduler + SafeState
 * nối như `bootstrap/main.cpp` (`SafeState safe(quality, &graph, &resolver)`).
 * Đồng hồ tiêm để mỗi `step()` là đúng một base step 10 ms. */
struct ScanRig {
    TempTree tree;
    kx_io_shm_t shm{};
    IobusReader reader;
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph; /* không load: PROGRAM_ONLY là producer duy nhất */
    PriorityResolver resolver;
    SafeState safe{quality, &graph, &resolver};
    OutputWriter writer{reader};
    BacnetObjTable bacnet;
    CoreMetrics metrics;
    StScheduler scheduler{StSchedulerProfile::REV_A};
    ProgrammingCutover cutover{CutoverMode::GRAPH_ONLY};
    std::unique_ptr<ProgrammingRuntimeCoordinator> coordinator;
    std::unique_ptr<ScanLoop> loop;
    uint64_t now_ns = 1000 * kMs;

    static uint64_t monotonic(void* ctx) { return static_cast<ScanRig*>(ctx)->now_ns; }
    static void sleep_until(void*, uint64_t) {}

    ScanRig()
    {
        shm.magic = KX_SHM_MAGIC;
        shm.iop_status = KX_IOP_NORMAL;
        shm.ts_ns = 1;
        reader.attach_external(&shm);
        configure_task(&scheduler);
        coordinator = std::make_unique<ProgrammingRuntimeCoordinator>(
            &scheduler, &cutover, tree.path + "/journal.bin", tree.path + "/staging");
        std::string error;
        EXPECT_TRUE(coordinator->recover(&error)) << error;
        ScanDeps deps{&reader, &table, &quality, &web, &graph, &resolver,
                      &safe, &writer, &bacnet, &metrics};
        deps.st_sched = &scheduler;
        deps.cutover = &cutover;
        deps.programming_coordinator = coordinator.get();
        loop = std::make_unique<ScanLoop>(deps);
        ScanTimeSource source;
        source.monotonic_ns = &ScanRig::monotonic;
        source.sleep_until = &ScanRig::sleep_until;
        source.ctx = this;
        loop->set_time_source_for_test(source);
    }

    /* Một base step: iobus còn sống (ts đổi), đồng hồ tiến 10 ms. */
    void step()
    {
        now_ns += 10 * kMs;
        shm.ts_ns += 10 * kMs;
        loop->step();
    }

    /* STAGE (Commission) hoặc RESTORE rồi ACTIVATE một gói. Trả false nếu Core
     * từ chối. Hai đường dùng chung loader và safe swap (DDD-LIFE-PROG-001 §5). */
    bool commission(const std::string& operation, const std::string& revision,
                    const std::vector<uint8_t>& package, const std::string& expected,
                    const std::vector<ActivateProgramIntent>* intents, char plan_fill,
                    bool restore = false)
    {
        const StageCommand staged =
            write_candidate(tree, operation, revision, package, "P_first", plan_fill);
        std::string detail, error;
        const bool staged_ok = restore ? coordinator->restore(staged, &detail, &error)
                                       : coordinator->stage(staged, &detail, &error);
        if (!staged_ok) {
            ADD_FAILURE() << (restore ? "RESTORE: " : "STAGE: ") << detail << ": " << error;
            return false;
        }
        if (!coordinator->activate(activation_for(staged, expected, intents), &detail, &error)) {
            ADD_FAILURE() << "ACTIVATE: " << detail << ": " << error;
            return false;
        }
        return true;
    }

    /* Chạy scan tới khi giao dịch COMMITTED (flush như worker IPC làm). */
    void run_until_committed(std::size_t max_steps = 20)
    {
        std::string error;
        for (std::size_t index = 0; index < max_steps; ++index) {
            step();
            ASSERT_TRUE(coordinator->flush_progress(&error)) << error;
            if (coordinator->snapshot().state == LifecycleState::COMMITTED) return;
        }
        FAIL() << "giao dịch không COMMITTED sau " << max_steps << " scan, state="
               << lifecycle_state_name(coordinator->snapshot().state);
    }
};

} // namespace

/* ── 1. Qua ScanLoop thật ─────────────────────────────────────────────────── */

/* Đúng kịch bản F13: Active #52 chạy P_old giữ DO-01; Restore #63 chứa P_new
 * (không có trong #52) cũng lái DO-01, và người vận hành đã lưu intent Enable
 * cho P_new. Từ lúc ACTIVATE được chấp nhận tới lúc giao dịch COMMITTED, không
 * scan nào được ở `no_ctrl` và DO-01 không được bị ép mở dù chỉ một scan. */
TEST(ProgrammingActivateIntent, ScanLoopNeverEntersNoControllerAcrossRestoreWithEnableIntent)
{
    ScanRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const std::vector<ActivateProgramIntent> first_intents = {{"P_old", true}};
    ASSERT_TRUE(rig.commission(kOp1, kRevision1, package_of({"P_old"}, "P_old"), "",
                               &first_intents, 'a'));
    rig.run_until_committed();
    ASSERT_EQ(rig.scheduler.find_program("P_old")->state, StProgramState::RUNNING);
    rig.step();
    ASSERT_FALSE(rig.safe.active()) << "tiền điều kiện: #52 đang điều khiển DO-01";
    ASSERT_EQ(rig.shm.do_cmd[0], 1);

    const std::vector<ActivateProgramIntent> intents = {{"P_new", true}};
    ASSERT_TRUE(rig.commission(kOp2, kRevision2, package_of({"P_new"}, "P_new"), kRevision1,
                               &intents, 'b', /*restore=*/true));
    EXPECT_EQ(rig.coordinator->last_activate_intents().enabled, 1u);

    std::string error;
    bool committed = false;
    for (std::size_t scan = 1; scan <= 20 && !committed; ++scan) {
        rig.step();
        ASSERT_TRUE(rig.coordinator->flush_progress(&error)) << error;
        EXPECT_FALSE(rig.safe.triggers().no_controller)
            << "scan " << scan << " sau ACTIVATE rơi vào no_ctrl — F13 chưa về 0";
        EXPECT_FALSE(rig.safe.active()) << "scan " << scan << ": safe-state ép đầu ra";
        EXPECT_EQ(rig.shm.do_cmd[0], 1) << "scan " << scan << ": DO-01 bị ép mở";
        if (scan == 1) {
            const StProgramInstance* fresh = rig.scheduler.find_program("P_new");
            ASSERT_NE(fresh, nullptr);
            EXPECT_EQ(fresh->state, StProgramState::RUNNING)
                << "P_new phải RUNNING ngay trong boundary kích hoạt gói";
            EXPECT_EQ(rig.scheduler.find_program("P_old"), nullptr);
        }
        committed = rig.coordinator->snapshot().state == LifecycleState::COMMITTED;
    }
    EXPECT_TRUE(committed) << lifecycle_state_name(rig.coordinator->snapshot().state);
    EXPECT_EQ(rig.coordinator->snapshot().active_revision_id, kRevision2);
}

/* Đối chứng: cùng kịch bản nhưng ACTIVATE 4 phần tử (web cũ hoặc Core chưa công
 * bố tính năng). Scan áp boundary PHẢI rơi vào `no_ctrl` — đây là khoảng hở F13.
 * Nếu ca này xanh mà ca trên cũng xanh thì test trên không chứng minh gì. */
TEST(ProgrammingActivateIntent, ScanLoopWithoutIntentsStillShowsTheF13Gap)
{
    ScanRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const std::vector<ActivateProgramIntent> first_intents = {{"P_old", true}};
    ASSERT_TRUE(rig.commission(kOp1, kRevision1, package_of({"P_old"}, "P_old"), "",
                               &first_intents, 'a'));
    rig.run_until_committed();
    rig.step();
    ASSERT_FALSE(rig.safe.active());

    ASSERT_TRUE(rig.commission(kOp2, kRevision2, package_of({"P_new"}, "P_new"), kRevision1,
                               nullptr, 'b', /*restore=*/true));
    rig.step();
    const StProgramInstance* fresh = rig.scheduler.find_program("P_new");
    ASSERT_NE(fresh, nullptr);
    EXPECT_EQ(fresh->state, StProgramState::DISABLED) << "luật T59-305 cũ: Program mới Disabled";
    EXPECT_TRUE(rig.safe.triggers().no_controller)
        << "không có intent thì boundary kích hoạt phải để lộ đúng khoảng hở F13";
    EXPECT_EQ(rig.shm.do_cmd[0], 0) << "safe-state ép DO-01 mở";
}

/* ── 2. Fail-closed giữ nguyên ─────────────────────────────────────────────── */

namespace {

struct CoordinatorRig {
    TempTree tree;
    StScheduler scheduler{StSchedulerProfile::REV_A};
    ProgrammingCutover cutover{CutoverMode::GRAPH_ONLY};
    std::unique_ptr<ProgrammingRuntimeCoordinator> coordinator;
    uint64_t now_ns = 1000 * kMs;

    CoordinatorRig()
    {
        configure_task(&scheduler);
        coordinator = std::make_unique<ProgrammingRuntimeCoordinator>(
            &scheduler, &cutover, tree.path + "/journal.bin", tree.path + "/staging");
        std::string error;
        EXPECT_TRUE(coordinator->recover(&error)) << error;
    }

    StageCommand stage(const std::string& operation, const std::string& revision,
                       const std::vector<std::string>& names, char plan_fill)
    {
        StageCommand staged =
            write_candidate(tree, operation, revision, package_of(names), names.front(), plan_fill);
        std::string detail, error;
        EXPECT_TRUE(coordinator->stage(staged, &detail, &error)) << detail << ": " << error;
        return staged;
    }

    void boundary_and_commit()
    {
        coordinator->on_safe_boundary();
        now_ns += 10 * kMs;
        const bool committed = execute_and_commit(&scheduler, now_ns);
        coordinator->on_output_commit(committed);
        std::string error;
        ASSERT_TRUE(coordinator->flush_progress(&error)) << error;
    }

    StProgramState state_of(const std::string& name)
    {
        const StProgramInstance* program = scheduler.find_program(name);
        return program != nullptr ? program->state : StProgramState::EMPTY;
    }
};

} // namespace

/* T59-305 không đổi: Program không có phần tử nào trong `programIntents` vẫn
 * Disabled, kể cả khi danh sách có intent cho Program khác. Intent cho instance
 * không thuộc gói (Program đã rời gói, F07) bị bỏ qua, không làm hỏng lệnh. */
TEST(ProgrammingActivateIntent, ProgramWithoutIntentStaysDisabled)
{
    CoordinatorRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const StageCommand staged = rig.stage(kOp1, kRevision1, {"P_ahu", "P_boiler"}, 'a');
    const std::vector<ActivateProgramIntent> intents = {{"P_ahu", true}, {"P_gone", true}};
    std::string detail, error;
    ASSERT_TRUE(rig.coordinator->activate(activation_for(staged, "", &intents), &detail, &error))
        << detail << ": " << error;
    const ActivateIntentSummary summary = rig.coordinator->last_activate_intents();
    EXPECT_EQ(summary.enabled, 1u);
    EXPECT_EQ(summary.ignored, 1u) << "P_gone không thuộc gói";
    rig.boundary_and_commit();
    EXPECT_EQ(rig.state_of("P_ahu"), StProgramState::RUNNING);
    EXPECT_EQ(rig.state_of("P_boiler"), StProgramState::DISABLED)
        << "Program không có intent phải fail-closed ở Disabled";
    EXPECT_EQ(rig.scheduler.find_program("P_gone"), nullptr) << "intent không được tạo instance";
}

/* Intent Disable thắng giá trị nền "giữ enable của bản đang chạy": người vận
 * hành đã tắt Program thì gói mới không được cho nó chạy thêm một scan nào. */
TEST(ProgrammingActivateIntent, DisableIntentWinsOverLiveEnabled)
{
    CoordinatorRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const StageCommand first = rig.stage(kOp1, kRevision1, {"P_ahu"}, 'a');
    const std::vector<ActivateProgramIntent> enable = {{"P_ahu", true}};
    std::string detail, error;
    ASSERT_TRUE(rig.coordinator->activate(activation_for(first, "", &enable), &detail, &error));
    rig.boundary_and_commit();
    ASSERT_EQ(rig.coordinator->snapshot().state, LifecycleState::COMMITTED);
    ASSERT_EQ(rig.state_of("P_ahu"), StProgramState::RUNNING);

    const StageCommand second = rig.stage(kOp2, kRevision2, {"P_ahu", "P_boiler"}, 'b');
    const std::vector<ActivateProgramIntent> intents = {{"P_ahu", false}, {"P_boiler", true}};
    ASSERT_TRUE(rig.coordinator->activate(activation_for(second, kRevision1, &intents), &detail,
                                          &error))
        << detail << ": " << error;
    EXPECT_EQ(rig.coordinator->last_activate_intents().disabled, 1u);
    EXPECT_EQ(rig.coordinator->last_activate_intents().enabled, 1u);
    rig.coordinator->on_safe_boundary();
    EXPECT_EQ(rig.state_of("P_ahu"), StProgramState::DISABLED)
        << "intent Disable phải có hiệu lực ngay tại boundary kích hoạt";
    EXPECT_EQ(rig.state_of("P_boiler"), StProgramState::RUNNING);
}

/* Vượt trần 16 Enabled: Program thứ 17 giữ Disabled, kích hoạt vẫn được chấp
 * nhận. Từ chối ở đây là chặn cả một Restore vì một con số mà reconcile vẫn báo
 * được về sau. */
TEST(ProgrammingActivateIntent, LimitOverflowStaysDisabledWithoutBlockingActivation)
{
    CoordinatorRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const std::size_t limit = st_profile_generated::kMaxProgramsEnabled;
    std::vector<std::string> names;
    std::vector<ActivateProgramIntent> intents;
    for (std::size_t index = 0; index <= limit; ++index) {
        char name[16];
        std::snprintf(name, sizeof(name), "P_%02zu", index);
        names.emplace_back(name);
        intents.push_back({name, true});
    }
    const StageCommand staged = rig.stage(kOp1, kRevision1, names, 'a');
    std::string detail, error;
    testing::internal::CaptureStderr();
    const bool activated =
        rig.coordinator->activate(activation_for(staged, "", &intents), &detail, &error);
    const std::string log = testing::internal::GetCapturedStderr();
    ASSERT_TRUE(activated) << detail << ": " << error;
    EXPECT_EQ(rig.coordinator->last_activate_intents().enabled, limit);
    EXPECT_EQ(rig.coordinator->last_activate_intents().dropped_limit, 1u);
    EXPECT_NE(log.find("WARN  programming.activate_intent_limit instance=" + names.back()),
              std::string::npos)
        << log;
    EXPECT_NE(log.find("INFO  programming.activate_intents operation=" + std::string(kOp1)),
              std::string::npos)
        << log;
    rig.coordinator->on_safe_boundary();
    std::size_t running = 0;
    for (const std::string& name : names)
        if (rig.state_of(name) == StProgramState::RUNNING) ++running;
    EXPECT_EQ(running, limit);
    EXPECT_EQ(rig.state_of(names.back()), StProgramState::DISABLED)
        << "Program vượt trần theo thứ tự gói phải giữ Disabled";
}

/* Payload sai bị từ chối TRƯỚC mọi thay đổi: không COMMIT_INTENT, không arm,
 * vẫn STAGED; và một ACTIVATE hợp lệ ngay sau đó vẫn chạy được. */
TEST(ProgrammingActivateIntent, InvalidIntentsAreRejectedBeforeAnyStateChange)
{
    CoordinatorRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const StageCommand staged = rig.stage(kOp1, kRevision1, {"P_ahu", "P_boiler"}, 'a');
    const std::string journal = rig.tree.path + "/journal.bin";
    const auto records_before = StJournal(journal).read_last().valid_record_count;

    std::vector<ActivateProgramIntent> too_many;
    for (std::size_t index = 0; index <= kMaxActivateProgramIntents; ++index)
        too_many.push_back({"P_" + std::to_string(index), true});
    const std::vector<std::vector<ActivateProgramIntent>> invalid = {
        {{"P_ahu", true}, {"P_ahu", false}},    /* trùng id, hai giá trị mâu thuẫn */
        {{"../escape", true}},                  /* id sai định dạng */
        {{"", true}},                           /* id rỗng */
        too_many,                               /* quá 32 phần tử */
    };
    for (const auto& intents : invalid) {
        std::string detail, error;
        EXPECT_FALSE(rig.coordinator->activate(activation_for(staged, "", &intents), &detail,
                                               &error));
        EXPECT_EQ(detail, "IPC-PAYLOAD") << error;
        EXPECT_EQ(rig.coordinator->snapshot().state, LifecycleState::STAGED);
        EXPECT_EQ(StJournal(journal).read_last().valid_record_count, records_before)
            << "payload sai không được ghi COMMIT_INTENT";
    }

    const std::vector<ActivateProgramIntent> valid = {{"P_ahu", true}};
    std::string detail, error;
    ASSERT_TRUE(rig.coordinator->activate(activation_for(staged, "", &valid), &detail, &error))
        << detail << ": " << error;
    rig.coordinator->on_safe_boundary();
    EXPECT_EQ(rig.state_of("P_ahu"), StProgramState::RUNNING);
}

/* Barrier chu kỳ đầu (T59-501) vẫn là của cả gói. Program bật bằng intent tham
 * gia barrier; chu kỳ đầu hỏng thì cả gói quay về LKG, và rollback trả lại
 * topology cũ NGUYÊN TRẠNG — intent chỉ chạm shadow của gói mới. */
TEST(ProgrammingActivateIntent, FirstCycleFaultStillRollsBackWholePackage)
{
    CoordinatorRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const StageCommand first = rig.stage(kOp1, kRevision1, {"P_old"}, 'a');
    const std::vector<ActivateProgramIntent> enable_old = {{"P_old", true}};
    std::string detail, error;
    ASSERT_TRUE(rig.coordinator->activate(activation_for(first, "", &enable_old), &detail, &error));
    rig.boundary_and_commit();
    ASSERT_EQ(rig.coordinator->snapshot().state, LifecycleState::COMMITTED);

    const StageCommand second = rig.stage(kOp2, kRevision2, {"P_new"}, 'b');
    const std::vector<ActivateProgramIntent> enable_new = {{"P_new", true}};
    ASSERT_TRUE(rig.coordinator->activate(activation_for(second, kRevision1, &enable_new), &detail,
                                          &error));
    rig.coordinator->on_safe_boundary();
    ASSERT_EQ(rig.state_of("P_new"), StProgramState::RUNNING);
    rig.now_ns += 10 * kMs;
    rig.scheduler.tick(rig.now_ns);
    rig.coordinator->on_output_commit(false); /* batch output chu kỳ đầu bị từ chối */
    EXPECT_EQ(rig.coordinator->snapshot().state, LifecycleState::ROLLING_BACK);
    rig.coordinator->on_safe_boundary();
    EXPECT_EQ(rig.coordinator->snapshot().state, LifecycleState::ROLLED_BACK);
    EXPECT_EQ(rig.scheduler.find_program("P_new"), nullptr);
    EXPECT_EQ(rig.state_of("P_old"), StProgramState::RUNNING)
        << "rollback phải trả topology cũ nguyên trạng";
    EXPECT_EQ(rig.coordinator->snapshot().active_revision_id, kRevision1);
}

/* ── 3. IPC: payload 4/5 phần tử, CAPABILITIES và golden liên ngôn ngữ ────── */

namespace {

std::vector<uint8_t> load_golden(const std::string& name)
{
    std::ifstream input(std::string(PROGRAMMING_IPC_CONTRACT_DIR) + "/golden/" + name);
    std::stringstream buffer;
    buffer << input.rdbuf();
    std::string hex;
    for (const char ch : buffer.str())
        if ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) hex.push_back(ch);
    std::vector<uint8_t> output;
    for (std::size_t index = 0; index + 1 < hex.size(); index += 2)
        output.push_back(static_cast<uint8_t>(std::stoul(hex.substr(index, 2), nullptr, 16)));
    return output;
}

PeerCredentials allowed_peer()
{
    return PeerCredentials{true, static_cast<uint32_t>(::getuid()),
                           static_cast<uint32_t>(::getgid()), static_cast<int32_t>(::getpid())};
}

ProgramRequest activate_request(const std::string& operation, const nlohmann::json& payload,
                                uint8_t request_seed)
{
    ProgramRequest request;
    request.request_id.assign(16, request_seed);
    request.operation_id.clear();
    for (std::size_t index = 0; index < operation.size(); index += 2) {
        if (operation[index] == '-') { --index; continue; }
        request.operation_id.push_back(
            static_cast<uint8_t>(std::stoul(operation.substr(index, 2), nullptr, 16)));
    }
    request.controller_id = "controller-1";
    request.actor_id = "admin-1";
    request.deadline_mono_ns = 2'000'000;
    request.action = ProgramAction::Activate;
    request.correlation_id = "correlation-id-0001";
    request.payload = nlohmann::json::to_cbor(payload);
    crypto_hash_sha256(request.payload_hash.data(), request.payload.data(), request.payload.size());
    return request;
}

ProgramResponse handle(ProgramIpcServer* server, const std::vector<uint8_t>& frame)
{
    ProgramResponse response;
    ProgramCodecError error = ProgramCodecError::None;
    EXPECT_TRUE(DecodeResponseFrame(server->HandleFrame(frame, allowed_peer(), 1), &response, &error));
    return response;
}

} // namespace

/* Core mới công bố tính năng ở phần tử thứ năm của CAPABILITIES; bốn phần tử
 * đầu giữ nguyên vị trí và nghĩa. */
TEST(ProgrammingActivateIntent, CapabilitiesAdvertiseActivateProgramIntents)
{
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    ProgramRequest request;
    request.request_id.assign(16, 0x31);
    request.controller_id = "controller-1";
    request.deadline_mono_ns = 2'000'000;
    request.action = ProgramAction::Capabilities;
    request.correlation_id = "correlation-id-0001";
    request.payload = {0x80};
    crypto_hash_sha256(request.payload_hash.data(), request.payload.data(), request.payload.size());
    ProgramCodecError error = ProgramCodecError::None;
    const ProgramResponse response = handle(&server, EncodeRequestFrame(request, &error));
    ASSERT_EQ(response.result, ProgramResult::Ok);
    const nlohmann::json body = nlohmann::json::from_cbor(response.payload, true, true);
    ASSERT_TRUE(body.is_array());
    ASSERT_EQ(body.size(), 5u);
    EXPECT_EQ(body[0], "MK-DDC-24-REV-A");
    ASSERT_TRUE(body[4].is_array());
    bool advertised = false;
    for (const auto& feature : body[4])
        if (feature == PROGRAM_IPC_FEATURE_ACTIVATE_PROGRAM_INTENTS) advertised = true;
    EXPECT_TRUE(advertised) << body.dump();
}

/* Đúng chuỗi byte do codec Go sinh (golden) phải được Core nhận và áp đúng
 * intent. Đây là chỗ hai phía dễ lệch nhất: Go mã hoá mảng rỗng/`nil` khác nhau,
 * bool khác kiểu... — nên khoá bằng byte, không bằng hai bản mô tả song song. */
TEST(ProgrammingActivateIntent, GoldenActivateFrameFromGoIsAppliedByCore)
{
    const std::vector<uint8_t> frame = load_golden("request_activate_program_intents.hex");
    ASSERT_FALSE(frame.empty()) << "thiếu golden request_activate_program_intents.hex";
    ProgramRequest decoded;
    ProgramCodecError error = ProgramCodecError::None;
    ASSERT_TRUE(DecodeRequestFrame(frame, &decoded, &error));
    EXPECT_EQ(EncodeRequestFrame(decoded, &error), frame) << "golden không byte-identical";
    ASSERT_EQ(decoded.action, ProgramAction::Activate);

    CoordinatorRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    /* operationId của golden là 16 byte 0x10..0x1f; stagedToken là dạng text. */
    const std::string operation = "10111213-1415-1617-1819-1a1b1c1d1e1f";
    const StageCommand staged =
        rig.stage(operation, kRevision1, {"P_ahu", "P_boiler", "P_chiller"}, 'a');
    ASSERT_EQ(rig.coordinator->snapshot().state, LifecycleState::STAGED);
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()), rig.coordinator.get());
    const ProgramResponse response = handle(&server, frame);
    ASSERT_EQ(response.result, ProgramResult::Accepted)
        << (response.has_detail_code ? response.detail_code : "");
    rig.coordinator->on_safe_boundary();
    EXPECT_EQ(rig.state_of("P_ahu"), StProgramState::RUNNING);
    EXPECT_EQ(rig.state_of("P_boiler"), StProgramState::DISABLED);
    EXPECT_EQ(rig.state_of("P_chiller"), StProgramState::DISABLED);
}

/* Web cũ gửi 4 phần tử: vẫn Accepted, luật cũ. Phần tử thứ năm sai kiểu
 * (`null`, phần tử không phải `[text, bool]`) bị từ chối IPC-PAYLOAD và Core vẫn
 * STAGED — không có "đoán" nào biến một payload hỏng thành "không có intent". */
TEST(ProgrammingActivateIntent, IpcAcceptsLegacyPayloadAndRejectsMalformedIntents)
{
    CoordinatorRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    const StageCommand staged = rig.stage(kOp1, kRevision1, {"P_ahu"}, 'a');
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()), rig.coordinator.get());
    const std::string plan(64, 'a');
    const std::vector<nlohmann::json> malformed = {
        nlohmann::json::array({nullptr, kOp1, "PROGRAM_ONLY", plan, nullptr}),
        nlohmann::json::array({nullptr, kOp1, "PROGRAM_ONLY", plan,
                               nlohmann::json::array({nlohmann::json::array({"P_ahu", 1})})}),
        nlohmann::json::array({nullptr, kOp1, "PROGRAM_ONLY", plan,
                               nlohmann::json::array({nlohmann::json::array({"P_ahu"})})}),
        nlohmann::json::array({nullptr, kOp1, "PROGRAM_ONLY", plan,
                               nlohmann::json::array({"P_ahu", true})}),
    };
    uint8_t seed = 0x40;
    ProgramCodecError error = ProgramCodecError::None;
    for (const auto& payload : malformed) {
        const ProgramResponse response =
            handle(&server, EncodeRequestFrame(activate_request(kOp1, payload, seed++), &error));
        EXPECT_EQ(response.result, ProgramResult::Rejected) << payload.dump();
        EXPECT_EQ(response.detail_code, "IPC-PAYLOAD") << payload.dump();
        EXPECT_EQ(rig.coordinator->snapshot().state, LifecycleState::STAGED) << payload.dump();
    }

    const nlohmann::json legacy = nlohmann::json::array({nullptr, kOp1, "PROGRAM_ONLY", plan});
    const ProgramResponse accepted =
        handle(&server, EncodeRequestFrame(activate_request(kOp1, legacy, seed++), &error));
    ASSERT_EQ(accepted.result, ProgramResult::Accepted)
        << (accepted.has_detail_code ? accepted.detail_code : "");
    rig.coordinator->on_safe_boundary();
    EXPECT_EQ(rig.state_of("P_ahu"), StProgramState::DISABLED)
        << "payload 4 phần tử giữ đúng luật T59-305 cũ";
    (void)staged;
}
