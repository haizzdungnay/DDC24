/**
 * @file  test_programming_startup_input_wait.cpp
 * @brief Issue #827 — Program có đầu vào Virtual Point chờ đầu vào khi Core
 *        khởi động, không FAULTED `ST-RT-008` ngay mẫu xấu đầu tiên.
 *
 *        Triệu chứng đo trên bo Foxlinx 2026-09-28: sau mỗi lần Core khởi động,
 *        `PRG_DO16_MODBUS` (8 đầu vào VP `REQUIRE_GOOD`) đứng `FAULTED`
 *        `ST-RT-008` với `lastRunAtUtc = null`, chỉ gỡ được bằng Disable → Enable.
 *        Core khởi động lại làm slot AV/BV/MSV về 0/BAD; web đẩy VP xuống sau tới
 *        ~10 s (vòng đối chiếu), còn scheduler fault ngay base step đầu.
 *
 *        Quyết định chủ dự án (DECISIONS, Issue #827):
 *        Q1  Đầu vào REQUIRED chưa GOOD ⇒ WAITING + `INPUT_NOT_READY`: không
 *            execute, không publish, không tăng `faultCount`.
 *        Q2  Ngưỡng mất đầu vào liên tục trước khi FAULT: 60 s.
 *        Q3  Quá ngưỡng ⇒ FAULT Program (`ST-RT-008`), không FAULT Task.
 *        Q4  GOOD trở lại trước ngưỡng ⇒ tự về RUNNING, không cần ack.
 *
 *        Mọi ca dựng đúng Core thật: ScanLoop + coordinator + scheduler +
 *        PointTable + SafeState nối như `bootstrap/main.cpp`, đồng hồ tiêm để mỗi
 *        `step()` là đúng một base step 10 ms. "Khởi động lại Core" là dựng một
 *        tiến trình Core MỚI trên cùng journal/checkpoint: `recover()` nạp gói
 *        Active ở Disabled (fail-closed), rồi web phát lại intent Enable.
 */
#include <gtest/gtest.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include <sodium.h>
#include <unistd.h>

#include "graph/runtime_point_snapshot.hpp"
#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "runtime/scan_loop.hpp"
#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_io_map.hpp"
#include "st/st_ir.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_process_image.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

using namespace core;
using namespace core::programming;

namespace {

constexpr uint64_t kMs = 1000000ull;
constexpr uint64_t kSecond = 1000ull * kMs;
constexpr uint64_t kStepNs = 10 * kMs;
constexpr const char* kOp = "33333333-3333-4333-8333-333333333333";
constexpr const char* kRevision = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
constexpr const char* kProgram = "PRG_VP_GATE";

struct TempTree {
    std::string path;
    TempTree()
    {
        char pattern[] = "/tmp/mkddc-startup-input-wait-XXXXXX";
        if (::mkdtemp(pattern) != nullptr) path = pattern;
        if (!path.empty()) std::filesystem::create_directories(path + "/staging");
    }
    ~TempTree()
    {
        if (!path.empty()) std::filesystem::remove_all(path);
    }
};

/* Program thu gọn của `PRG_DO16_MODBUS`: đầu vào là Virtual Point REQUIRED, đầu
 * ra là DO/AO vật lý. DO-01 = BV-01, AO-01 = AV-01. */
std::vector<uint8_t> vp_gate_ir()
{
    const std::string source = std::string("PROGRAM ") + kProgram +
                               "\nVAR_INPUT run_cmd : BOOL; level : REAL; END_VAR"
                               "\nVAR_OUTPUT valve : BOOL; damper : REAL; END_VAR"
                               "\nvalve := run_cmd;\ndamper := level;\nEND_PROGRAM\n";
    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = kProgram;
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic, options))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<StDiagnostic> binding_diagnostics;
    const std::vector<StIoMapEntry> io_map = {
        StIoMapEntry{"run_cmd", "input", "BV-01", StType::BOOL, "", false, 0.0f, 0.0f, "VP"},
        StIoMapEntry{"level", "input", "AV-01", StType::REAL, "", false, 0.0f, 0.0f, "VP"},
        StIoMapEntry{"valve", "output", "DO-01", StType::BOOL, "", false, 0.0f, 0.0f, "LOCAL"},
        StIoMapEntry{"damper", "output", "AO-01", StType::REAL, "", false, 0.0f, 0.0f, "LOCAL"},
    };
    EXPECT_TRUE(resolve_io_bindings(&module, io_map, &binding_diagnostics))
        << (!binding_diagnostics.empty() ? binding_diagnostics.front().message : "");
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

std::vector<uint8_t> vp_gate_package()
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    input.programs.push_back({kProgram, vp_gate_ir(), 10u, 0u});
    StPouSignature signature;
    signature.name = kProgram;
    signature.kind = StPouKind::PROGRAM;
    input.pou_signatures.push_back(signature);
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    return bytes;
}

StageCommand write_candidate(const TempTree& tree, const std::vector<uint8_t>& bytes)
{
    const std::filesystem::path directory = std::filesystem::path(tree.path) / "staging" / kOp;
    std::filesystem::create_directories(directory);
    const std::filesystem::path locator = directory / "candidate.mkddcir";
    std::ofstream output(locator, std::ios::binary);
    output.write(reinterpret_cast<const char*>(bytes.data()),
                 static_cast<std::streamsize>(bytes.size()));
    output.close();
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(), bytes.data(), bytes.size());
    StageCommand command;
    command.operation_id = kOp;
    command.revision_id = kRevision;
    command.instance_id = kProgram;
    command.locator = locator.string();
    command.byte_size = bytes.size();
    command.sha256.assign(digest.begin(), digest.end());
    command.plan_hash = std::string(64, 'c');
    return command;
}

/* MỘT tiến trình Core. Hủy đối tượng = Core dừng; dựng lại trên cùng `tree` =
 * Core khởi động lại: bảng điểm mới (VP 0/BAD), journal/checkpoint giữ nguyên. */
struct CoreProcess {
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
    uint64_t now_ns;

    static uint64_t monotonic(void* ctx) { return static_cast<CoreProcess*>(ctx)->now_ns; }
    static void sleep_until(void*, uint64_t) {}

    CoreProcess(const TempTree& tree, uint64_t boot_ns) : now_ns(boot_ns)
    {
        shm.magic = KX_SHM_MAGIC;
        shm.iop_status = KX_IOP_NORMAL;
        shm.ts_ns = 1;
        reader.attach_external(&shm);
        scheduler.set_base_step_ns(kStepNs);
        StTaskConfig task;
        task.id = "main";
        task.period_ms = 10;
        task.budget_us = st_base_step::kDefaultBudgetUs;
        std::string error;
        EXPECT_TRUE(scheduler.add_task(task, &error)) << error;
        coordinator = std::make_unique<ProgrammingRuntimeCoordinator>(
            &scheduler, &cutover, tree.path + "/journal.bin", tree.path + "/staging");
        EXPECT_TRUE(coordinator->recover(&error)) << error;
        ScanDeps deps{&reader, &table, &quality, &web, &graph, &resolver,
                      &safe, &writer, &bacnet, &metrics};
        deps.st_sched = &scheduler;
        deps.cutover = &cutover;
        deps.programming_coordinator = coordinator.get();
        loop = std::make_unique<ScanLoop>(deps);
        ScanTimeSource source;
        source.monotonic_ns = &CoreProcess::monotonic;
        source.sleep_until = &CoreProcess::sleep_until;
        source.ctx = this;
        loop->set_time_source_for_test(source);
    }

    /* Một base step: iobus còn sống (ts đổi), đồng hồ tiến 10 ms. */
    void step()
    {
        now_ns += kStepNs;
        shm.ts_ns += kStepNs;
        loop->step();
    }

    /* Web đẩy VP xuống Core (`syncBoundVirtualPointsToCore` / reconciler). */
    void push_vps(bool run_cmd, float level)
    {
        ASSERT_TRUE(table.set_virtual({PointKind::BV, 0}, run_cmd ? 1.0f : 0.0f, PointSource::WEB));
        ASSERT_TRUE(table.set_virtual({PointKind::AV, 0}, level, PointSource::WEB));
    }

    /* Một VP mất chất lượng (web mất kết nối nguồn, VP bị đánh BAD). */
    void lose_vp() { table.set_quality({PointKind::AV, 0}, KX_Q_BAD); }

    /* Web phát lại intent Enable sau khi Core khởi động (runtime_intent.go). */
    void replay_enable_intent()
    {
        StProgramInstance* instance = nullptr;
        uint64_t baseline = 0;
        std::string error;
        ASSERT_EQ(scheduler.request_program_enabled(kProgram, true, &instance, &baseline, &error),
                  StScheduler::StEnableRequestOutcome::ARMED)
            << error;
    }

    const StProgramInstance& program() const
    {
        const StProgramInstance* instance =
            const_cast<StScheduler&>(scheduler).find_program(kProgram);
        EXPECT_NE(instance, nullptr);
        return *instance;
    }

    const RuntimeProgramSnapshot& published_program() const
    {
        const RuntimePointSnapshot& snapshot = web.snapshot_for_test();
        EXPECT_EQ(snapshot.program_count, 1u);
        return snapshot.programs[0];
    }
};

/* STAGE + ACTIVATE gói `PRG_VP_GATE` kèm intent Enable (ADR-062). */
void stage_and_activate(const TempTree& tree, CoreProcess* core)
{
    const StageCommand staged = write_candidate(tree, vp_gate_package());
    std::string detail, error;
    ASSERT_TRUE(core->coordinator->stage(staged, &detail, &error)) << detail << ": " << error;
    ActivateCommand activate;
    activate.operation_id = staged.operation_id;
    activate.staged_token = staged.operation_id;
    activate.cutover = CutoverMode::PROGRAM_ONLY;
    activate.plan_hash = staged.plan_hash;
    activate.has_program_intents = true;
    activate.program_intents = {{kProgram, true}};
    ASSERT_TRUE(core->coordinator->activate(activate, &detail, &error)) << detail << ": " << error;
}

/* Lần Commission đầu (VP GOOD, intent Enable) tới COMMITTED — dựng journal và
 * checkpoint Active mà lần khởi động lại sau đó sẽ nạp. */
void commission_running(const TempTree& tree, CoreProcess* core)
{
    core->push_vps(true, 5.0f);
    ASSERT_NO_FATAL_FAILURE(stage_and_activate(tree, core));
    std::string error;
    for (std::size_t index = 0; index < 50; ++index) {
        core->step();
        ASSERT_TRUE(core->coordinator->flush_progress(&error)) << error;
        if (core->coordinator->snapshot().state == LifecycleState::COMMITTED) break;
    }
    ASSERT_EQ(core->coordinator->snapshot().state, LifecycleState::COMMITTED);
    ASSERT_EQ(core->program().state, StProgramState::RUNNING);
    ASSERT_EQ(core->shm.do_cmd[0], 1) << "tiền điều kiện: Program đang giữ DO-01";
}

/* Khởi động lại Core trên gói Active đã Commission: `recover()` nạp ở Disabled,
 * web phát lại intent Enable, KHÔNG có VP nào (web chưa kịp đẩy). */
std::unique_ptr<CoreProcess> restart_core(const TempTree& tree, uint64_t boot_ns)
{
    auto core = std::make_unique<CoreProcess>(tree, boot_ns);
    EXPECT_EQ(core->coordinator->snapshot().state, LifecycleState::COMMITTED);
    EXPECT_EQ(core->program().state, StProgramState::DISABLED) << "boot fail-closed";
    core->replay_enable_intent();
    return core;
}

} // namespace

/* (a) Khởi động: VP chưa có ⇒ WAITING, không fault, không publish, safe giữ. */
TEST(ProgrammingStartupInputWait, BootWithoutVirtualPointsWaitsInsteadOfFaulting)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    {
        CoreProcess first(tree, 1000 * kMs);
        commission_running(tree, &first);
    }
    auto core = restart_core(tree, 5000 * kSecond);

    /* 5 s không VP: 500 base step. */
    for (int scan = 1; scan <= 500; ++scan) {
        core->step();
        const StProgramInstance& program = core->program();
        ASSERT_EQ(program.state, StProgramState::WAITING)
            << "scan " << scan << ": " << st_program_state_name(program.state)
            << " lastFault=" << (program.last_fault_code ? program.last_fault_code : "-");
        ASSERT_EQ(program.waiting_reason, StWaitingReason::INPUT_NOT_READY) << "scan " << scan;
        ASSERT_EQ(program.fault_count, 0u) << "scan " << scan;
        ASSERT_EQ(program.last_fault_code, nullptr) << "scan " << scan;
        ASSERT_EQ(program.run_count, 0u) << "scan " << scan << ": không được execute";
        ASSERT_EQ(program.output_commit_generation, 0u) << "scan " << scan << ": không publish";
        ASSERT_EQ(core->resolver.winning_do_level(0), PRIO_DEFAULT) << "scan " << scan;
        ASSERT_EQ(core->resolver.winning_ao_level(0), PRIO_DEFAULT) << "scan " << scan;
        ASSERT_TRUE(core->safe.triggers().no_controller)
            << "scan " << scan << ": chưa ai điều khiển ⇒ T7 no_ctrl giữ đầu ra an toàn";
        ASSERT_EQ(core->shm.do_cmd[0], 0) << "scan " << scan << ": DO-01 phải mở (safe)";
    }
    EXPECT_STREQ(core->published_program().state.data(), "WAITING");
    EXPECT_STREQ(core->published_program().waiting_reason.data(), "INPUT_NOT_READY");
    EXPECT_EQ(core->published_program().fault_count, 0u);
    EXPECT_STREQ(core->published_program().last_fault_code.data(), "");
    EXPECT_EQ(core->published_program().last_run_mono_ns, 0u) << "chưa chạy lần nào";
    EXPECT_STREQ(core->web.snapshot_for_test().task.state.data(), "RUNNING")
        << "Task vẫn dispatch Program WAITING, không được báo STOPPED";
    const std::string json = serialize_runtime_point_snapshot(core->web.snapshot_for_test());
    EXPECT_NE(json.find("\"state\":\"WAITING\""), std::string::npos) << json.substr(0, 400);
    EXPECT_NE(json.find("\"waitingReason\":\"INPUT_NOT_READY\""), std::string::npos)
        << "IPC point_snapshot phải mang lý do chờ";
}

/* (b) VP tới sau 12 s ⇒ RUNNING ở base step kế, chưa từng FAULTED. */
TEST(ProgrammingStartupInputWait, VirtualPointsArrivingAfterTwelveSecondsResumeWithoutFault)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    {
        CoreProcess first(tree, 1000 * kMs);
        commission_running(tree, &first);
    }
    auto core = restart_core(tree, 5000 * kSecond);

    bool ever_faulted = false;
    for (int scan = 1; scan <= 1200; ++scan) {
        core->step();
        ever_faulted = ever_faulted || core->program().state == StProgramState::FAULTED;
        ASSERT_EQ(core->shm.do_cmd[0], 0) << "scan " << scan << ": DO-01 đóng khi đang chờ";
    }
    EXPECT_FALSE(ever_faulted) << "12 s chờ VP không được FAULT (ngưỡng 60 s)";
    ASSERT_EQ(core->program().state, StProgramState::WAITING);

    core->push_vps(true, 7.5f);
    core->step();
    EXPECT_EQ(core->program().state, StProgramState::RUNNING)
        << "VP GOOD ⇒ RUNNING ngay base step kế";
    EXPECT_EQ(core->program().fault_count, 0u);
    EXPECT_EQ(core->program().run_count, 1u);
    EXPECT_EQ(core->resolver.winning_do_level(0), PRIO_LOCAL_LOGIC);
    EXPECT_FALSE(core->safe.active());
    EXPECT_EQ(core->shm.do_cmd[0], 1);
    EXPECT_FLOAT_EQ(core->resolver.resolve().ao[0], 7.5f);
    EXPECT_STREQ(core->published_program().state.data(), "RUNNING");
    EXPECT_EQ(core->program().waiting_reason, StWaitingReason::NONE);
    EXPECT_STREQ(core->published_program().waiting_reason.data(), "");
}

/* (c1) VP không bao giờ tới ⇒ FAULTED `ST-RT-008` đúng một lần, đúng ngưỡng. */
TEST(ProgrammingStartupInputWait, MissingVirtualPointsFaultExactlyOnceAtSixtySeconds)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    {
        CoreProcess first(tree, 1000 * kMs);
        commission_running(tree, &first);
    }
    auto core = restart_core(tree, 5000 * kSecond);

    core->step(); /* base step đầu: Enable áp dụng, mẫu đầu vào xấu đầu tiên */
    const uint64_t first_bad_ns = core->now_ns;
    ASSERT_NE(core->program().state, StProgramState::FAULTED)
        << "mẫu xấu ĐẦU TIÊN đã FAULT — đúng lỗi của Issue #827";

    uint64_t faulted_at_ns = 0;
    for (int scan = 0; scan < 6500 && faulted_at_ns == 0; ++scan) {
        core->step();
        if (core->program().state == StProgramState::FAULTED) faulted_at_ns = core->now_ns;
    }
    ASSERT_NE(faulted_at_ns, 0u) << "quá ngưỡng mà vẫn không FAULT";
    EXPECT_EQ(faulted_at_ns - first_bad_ns, 60 * kSecond) << "FAULT phải đúng lúc ngưỡng 60 s";
    EXPECT_EQ(core->program().fault_count, 1u);
    EXPECT_STREQ(core->program().last_fault_code, st_diag_code::kRtNonFiniteInput);

    /* Chốt: thêm 10 s không fault lại, và VP tới cũng KHÔNG tự hồi phục (Q4). */
    for (int scan = 0; scan < 1000; ++scan) core->step();
    core->push_vps(true, 5.0f);
    for (int scan = 0; scan < 10; ++scan) core->step();
    EXPECT_EQ(core->program().state, StProgramState::FAULTED);
    EXPECT_EQ(core->program().fault_count, 1u) << "FAULT đúng một lần";
    EXPECT_EQ(core->shm.do_cmd[0], 0);
    EXPECT_STREQ(core->published_program().state.data(), "FAULTED");
    EXPECT_STREQ(core->published_program().last_fault_code.data(), "ST-RT-008");
    EXPECT_STREQ(core->published_program().waiting_reason.data(), "")
        << "FAULTED không còn mang lý do chờ";
    EXPECT_STREQ(core->web.snapshot_for_test().task.state.data(), "FAULT");
}

/* (c2) Đang RUNNING, VP mất liên tục ⇒ hold-last tới TTL (ADR-051) rồi FAULT ở
 * 60 s kể từ mẫu xấu đầu tiên. Lệnh cũ không sống quá TTL. */
TEST(ProgrammingStartupInputWait, RunningProgramHoldsLastUntilTtlThenFaultsAtThreshold)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    CoreProcess core(tree, 1000 * kMs);
    commission_running(tree, &core);
    for (int scan = 0; scan < 20; ++scan) core.step();
    ASSERT_EQ(core.program().state, StProgramState::RUNNING);

    core.lose_vp();
    core.step();
    const uint64_t first_bad_ns = core.now_ns;
    const uint64_t last_commit_ns = core.program().output_commit_now_ns;
    ASSERT_LT(last_commit_ns, first_bad_ns);
    ASSERT_NE(core.program().state, StProgramState::FAULTED);

    uint64_t withdrawn_at_ns = 0;
    uint64_t faulted_at_ns = 0;
    for (int scan = 0; scan < 6500 && faulted_at_ns == 0; ++scan) {
        core.step();
        if (withdrawn_at_ns == 0 && core.resolver.winning_do_level(0) != PRIO_LOCAL_LOGIC)
            withdrawn_at_ns = core.now_ns;
        if (core.program().state == StProgramState::FAULTED) faulted_at_ns = core.now_ns;
        if (withdrawn_at_ns == 0) {
            ASSERT_EQ(core.shm.do_cmd[0], 1) << "hold-last: DO-01 giữ lệnh cuối trong TTL";
        }
    }
    ASSERT_NE(withdrawn_at_ns, 0u);
    ASSERT_NE(faulted_at_ns, 0u);
    EXPECT_EQ(withdrawn_at_ns - last_commit_ns, st_hold_ttl::kSignedTtlNs)
        << "lệnh cuối nhả đúng TTL 60 s kể từ lần publish cuối";
    EXPECT_LE(withdrawn_at_ns, faulted_at_ns) << "TTL không được vượt quá lúc FAULT";
    EXPECT_EQ(faulted_at_ns - first_bad_ns, 60 * kSecond);
    EXPECT_EQ(core.program().fault_count, 1u);
    EXPECT_STREQ(core.program().last_fault_code, st_diag_code::kRtNonFiniteInput);
    EXPECT_EQ(core.shm.do_cmd[0], 0);
}

/* (d) Đang RUNNING, VP xấu 5 s rồi tốt lại ⇒ về RUNNING, không FAULT, hold-last
 * giữ DO-01 trong suốt 5 s và chưa bao giờ vượt TTL. */
TEST(ProgrammingStartupInputWait, ShortInputLossRecoversWithoutFaultAndHoldsLastWithinTtl)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    CoreProcess core(tree, 1000 * kMs);
    commission_running(tree, &core);
    for (int scan = 0; scan < 20; ++scan) core.step();
    ASSERT_EQ(core.program().state, StProgramState::RUNNING);
    const uint32_t runs_before = core.program().run_count;

    core.lose_vp();
    uint64_t max_hold_age_ns = 0;
    for (int scan = 1; scan <= 500; ++scan) {
        core.step();
        const StProgramInstance& program = core.program();
        ASSERT_NE(program.state, StProgramState::FAULTED) << "scan " << scan;
        ASSERT_EQ(program.fault_count, 0u) << "scan " << scan;
        ASSERT_EQ(core.resolver.winning_do_level(0), PRIO_LOCAL_LOGIC)
            << "scan " << scan << ": hold-last phải giữ proposal trong TTL";
        ASSERT_EQ(core.shm.do_cmd[0], 1) << "scan " << scan;
        ASSERT_FALSE(core.safe.active()) << "scan " << scan;
        const uint64_t age = core.now_ns - program.output_commit_now_ns;
        if (age > max_hold_age_ns) max_hold_age_ns = age;
    }
    EXPECT_EQ(core.program().run_count, runs_before) << "đầu vào xấu thì không execute";
    EXPECT_LT(max_hold_age_ns, st_hold_ttl::kSignedTtlNs);

    core.push_vps(true, 3.0f);
    core.step();
    EXPECT_EQ(core.program().state, StProgramState::RUNNING);
    EXPECT_EQ(core.program().fault_count, 0u);
    EXPECT_EQ(core.program().run_count, runs_before + 1);
    EXPECT_EQ(core.program().output_commit_now_ns, core.now_ns) << "publish lại ngay";
    EXPECT_FLOAT_EQ(core.resolver.resolve().ao[0], 3.0f);

    /* Mốc mất đầu vào đã xoá khi GOOD: lần mất sau đếm lại từ đầu, không cộng
     * dồn 5 s cũ. */
    core.lose_vp();
    for (int scan = 0; scan < 5600; ++scan) core.step(); /* 56 s < 60 s */
    EXPECT_NE(core.program().state, StProgramState::FAULTED)
        << "5 s + 56 s: mốc cũ không được cộng dồn";
}

/* (e) Checkpoint/restart recovery: Core khởi động lại khi Program đang RUNNING ⇒
 * nạp checkpoint Active ở Disabled, intent Enable ⇒ WAITING (không FAULTED),
 * VP tới ⇒ RUNNING. Lặp lại lần hai để khoá "mọi lần khởi động" (field: hai lần
 * 09:22Z và 09:45Z đều FAULTED). */
TEST(ProgrammingStartupInputWait, RestartRecoveryKeepsWaitingThenRunningAcrossTwoRestarts)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    {
        CoreProcess first(tree, 1000 * kMs);
        commission_running(tree, &first);
    }
    uint64_t boot_ns = 5000 * kSecond;
    for (int restart = 1; restart <= 2; ++restart) {
        auto core = restart_core(tree, boot_ns);
        core->step();
        EXPECT_EQ(core->program().state, StProgramState::WAITING)
            << "restart " << restart << ": " << st_program_state_name(core->program().state);
        EXPECT_EQ(core->program().waiting_reason, StWaitingReason::INPUT_NOT_READY)
            << "restart " << restart;
        EXPECT_EQ(core->program().fault_count, 0u) << "restart " << restart;
        EXPECT_EQ(core->coordinator->snapshot().state, LifecycleState::COMMITTED)
            << "restart " << restart << ": WAITING không được đẩy giao dịch về rollback";

        /* Vòng đối chiếu VP 10 s của web. */
        for (int scan = 0; scan < 1000; ++scan) core->step();
        EXPECT_EQ(core->program().state, StProgramState::WAITING) << "restart " << restart;
        core->push_vps(true, 5.0f);
        core->step();
        EXPECT_EQ(core->program().state, StProgramState::RUNNING) << "restart " << restart;
        EXPECT_EQ(core->program().fault_count, 0u) << "restart " << restart;
        EXPECT_EQ(core->shm.do_cmd[0], 1) << "restart " << restart;
        EXPECT_EQ(core->coordinator->snapshot().state, LifecycleState::COMMITTED);
        boot_ns += 1000 * kSecond;
    }
}

/* (f) Commission khi VP chưa có: barrier chu kỳ đầu của GÓI coi WAITING là
 * PENDING — giao dịch đứng ACTIVE_CANDIDATE, không rollback, rồi COMMITTED ngay
 * khi VP tới và Program publish lần đầu. Trước #827 Program FAULTED ở base step
 * đầu và cả gói bị rollback. */
TEST(ProgrammingStartupInputWait, CommissionWithoutVirtualPointsWaitsThenCommits)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    CoreProcess core(tree, 1000 * kMs);
    ASSERT_NO_FATAL_FAILURE(stage_and_activate(tree, &core));
    std::string error;
    for (int scan = 1; scan <= 500; ++scan) {
        core.step();
        ASSERT_TRUE(core.coordinator->flush_progress(&error)) << error;
        ASSERT_EQ(core.coordinator->snapshot().state, LifecycleState::ACTIVE_CANDIDATE)
            << "scan " << scan << ": "
            << lifecycle_state_name(core.coordinator->snapshot().state);
        ASSERT_EQ(core.program().state, StProgramState::WAITING) << "scan " << scan;
    }
    core.push_vps(true, 5.0f);
    for (int scan = 0; scan < 5 && core.coordinator->snapshot().state != LifecycleState::COMMITTED;
         ++scan) {
        core.step();
        ASSERT_TRUE(core.coordinator->flush_progress(&error)) << error;
    }
    EXPECT_EQ(core.coordinator->snapshot().state, LifecycleState::COMMITTED)
        << lifecycle_state_name(core.coordinator->snapshot().state);
    EXPECT_EQ(core.program().state, StProgramState::RUNNING);
    EXPECT_EQ(core.program().fault_count, 0u);
    EXPECT_EQ(core.shm.do_cmd[0], 1);
}

/* (g) Commission mà VP không bao giờ tới: sau đúng ngưỡng 60 s Program FAULT và
 * barrier chu kỳ đầu rollback CẢ gói như mọi fault chu kỳ đầu — chờ có biên,
 * giao dịch không treo vô hạn ở ACTIVE_CANDIDATE. */
TEST(ProgrammingStartupInputWait, CommissionWhoseInputsNeverArriveRollsBackAtThreshold)
{
    TempTree tree;
    ASSERT_FALSE(tree.path.empty());
    CoreProcess core(tree, 1000 * kMs);
    ASSERT_NO_FATAL_FAILURE(stage_and_activate(tree, &core));
    std::string error;
    core.step();
    ASSERT_TRUE(core.coordinator->flush_progress(&error)) << error;
    const uint64_t first_bad_ns = core.now_ns;
    uint64_t left_candidate_ns = 0;
    for (int scan = 0; scan < 6500 && left_candidate_ns == 0; ++scan) {
        core.step();
        ASSERT_TRUE(core.coordinator->flush_progress(&error)) << error;
        if (core.coordinator->snapshot().state != LifecycleState::ACTIVE_CANDIDATE)
            left_candidate_ns = core.now_ns;
    }
    ASSERT_NE(left_candidate_ns, 0u) << "giao dịch treo ở ACTIVE_CANDIDATE quá ngưỡng";
    EXPECT_EQ(left_candidate_ns - first_bad_ns, 60 * kSecond);
    const LifecycleState state = core.coordinator->snapshot().state;
    EXPECT_TRUE(state == LifecycleState::ROLLING_BACK || state == LifecycleState::ROLLED_BACK)
        << lifecycle_state_name(state);
    EXPECT_NE(state, LifecycleState::COMMITTED);
    for (int scan = 0; scan < 10; ++scan) {
        core.step();
        ASSERT_TRUE(core.coordinator->flush_progress(&error)) << error;
    }
    EXPECT_EQ(core.cutover.current(), CutoverMode::GRAPH_ONLY) << "rollback trả quyền cho graph";
    EXPECT_EQ(core.shm.do_cmd[0], 0);
}
