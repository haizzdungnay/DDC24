/**
 * @file  test_programming_package_swap_withdraw.cpp
 * @brief F20 (EV-PROG-FBD-ST-MB-20260925) — đổi gói phải rút output của instance
 *        gói cũ mà gói mới không nắm.
 *
 *        Triệu chứng: Commission/Restore sang gói không còn Program nào lái DO-01
 *        thì DO-01 giữ giá trị cuối của gói cũ ở mức 5 VÔ THỜI HẠN — không hết
 *        `holdTtl`, không bật T7 `no_ctrl` (đo trên host: vẫn 1 sau 65 s). EXT
 *        Modbus cũng giữ giá trị cuối. Lý do: chỉ `st_withdraw_stale_outputs`
 *        gọi `release_*`, và nó chỉ duyệt Program của gói ĐANG chạy; instance cũ
 *        rời topology ở safe boundary mà không ai rút claim của nó.
 *
 *        Quyết định của chủ sở hữu (ADR-061 §3, `PROGRAMMING_CONTROL_SEMANTICS`
 *        §6, F06): instance đã publish bị rút thì thiết bị về `safe_value`. Một
 *        instance rời gói khi đổi gói là một instance bị rút.
 *
 *        Các điều được khoá ở đây, đều qua `ScanLoop` THẬT trừ một ca:
 *        1. Gói mới không có output ⇒ DO-01 được nhả ngay scan kích hoạt, T7
 *           tiếp quản; gói mới lái kênh khác ⇒ DO-01 về tầng dưới (mức 6).
 *        2. EXT đã publish được nhả đúng một lần (`dirty=0`, seq mới).
 *        3. Điểm có trong CẢ HAI gói không bao giờ ở trạng thái đã nhả: DO giữ
 *           claim mức 5 qua mọi scan, seq EXT không đổi nếu giá trị không đổi và
 *           tăng đúng một lần nếu đổi. Ca boundary trực tiếp kiểm trạng thái
 *           GIỮA boundary và lần publish đầu của gói mới — đúng chỗ một bản sửa
 *           ngây thơ (nhả hết rồi để gói mới claim lại) sẽ lộ glitch cho iobus.
 *        4. Restore về gói cũ claim lại điểm.
 *        5. Chu kỳ đầu hỏng ⇒ rollback về `GRAPH_ONLY`: claim của gói ứng viên
 *           không được treo lại.
 */
#include <gtest/gtest.h>

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include <sodium.h>
#include <unistd.h>

#include "graph/point_writer.hpp"
#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "runtime/scan_loop.hpp"
#include "st/st_compile.hpp"
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
constexpr const char* kOp1 = "31111111-1111-4111-8111-111111111111";
constexpr const char* kOp2 = "32222222-2222-4222-8222-222222222222";
constexpr const char* kOp3 = "33333333-3333-4333-8333-333333333333";
constexpr const char* kRevisionA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
constexpr const char* kRevisionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

/* Slot EXT 3 (1-based trong IR, idx 2 trong SHM): một DO Modbus ghi được. */
constexpr uint16_t kExtSlot = 3;
constexpr int kExtIdx = kExtSlot - 1;

struct TempTree {
    std::string path;
    TempTree()
    {
        char pattern[] = "/tmp/mkddc-swap-withdraw-XXXXXX";
        if (::mkdtemp(pattern) != nullptr) path = pattern;
        if (!path.empty()) std::filesystem::create_directories(path + "/staging");
    }
    ~TempTree()
    {
        if (!path.empty()) std::filesystem::remove_all(path);
    }
};

/* Một output của Program: DO cục bộ (`ext_slot == 0`) hoặc EXT Modbus. */
struct OutputSpec {
    std::string variable;
    std::string point_id;
    StType type = StType::BOOL;
    std::string expression;
    uint16_t ext_slot = 0;
};

OutputSpec local_do(const std::string& variable, const std::string& point_id, bool on)
{
    return OutputSpec{variable, point_id, StType::BOOL, on ? "TRUE" : "FALSE", 0};
}

OutputSpec ext_real(const std::string& variable, const char* expression)
{
    return OutputSpec{variable, "mb.cmd3", StType::REAL, expression, kExtSlot};
}

struct ProgramSpec {
    std::string name;
    std::vector<OutputSpec> outputs;
    /* true: chia cho 0 ngay chu kỳ đầu (ST-RT-002), trước khi gán output. */
    bool faults = false;
};

std::vector<uint8_t> program_ir(const ProgramSpec& spec)
{
    std::string source = "PROGRAM " + spec.name + "\nVAR n : DINT; z : DINT; END_VAR\n";
    if (!spec.outputs.empty()) {
        source += "VAR_OUTPUT\n";
        for (const OutputSpec& output : spec.outputs)
            source += "  " + output.variable +
                      (output.type == StType::BOOL ? " : BOOL;\n" : " : REAL;\n");
        source += "END_VAR\n";
    }
    source += "n := n + 1;\n";
    if (spec.faults) source += "n := n / z;\n";
    for (const OutputSpec& output : spec.outputs)
        source += output.variable + " := " + output.expression + ";\n";
    source += "END_PROGRAM\n";

    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = spec.name;
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic, options))
        << diagnostic.code << ": " << diagnostic.message << "\n" << source;
    if (!spec.outputs.empty()) {
        std::vector<StIoMapEntry> io_map;
        for (const OutputSpec& output : spec.outputs) {
            const bool modbus = output.ext_slot != 0;
            io_map.emplace_back(output.variable, "output", output.point_id, output.type, "",
                                false, 0.0f, 0.0f, modbus ? "MB_RTU" : "LOCAL",
                                modbus ? "mb-rtu-1" : "", output.ext_slot, true);
        }
        std::vector<StDiagnostic> binding_diagnostics;
        EXPECT_TRUE(resolve_io_bindings(&module, io_map, &binding_diagnostics))
            << (!binding_diagnostics.empty() ? binding_diagnostics.front().message : "");
    }
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

std::vector<uint8_t> package_of(const std::vector<ProgramSpec>& programs)
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    for (const ProgramSpec& program : programs) {
        input.programs.push_back({program.name, program_ir(program), 10u, 0u});
        StPouSignature signature;
        signature.name = program.name;
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
                             char plan_fill)
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
    command.instance_id = "P_first";
    command.locator = locator.string();
    command.byte_size = bytes.size();
    command.sha256.assign(digest.begin(), digest.end());
    command.plan_hash = std::string(64, plan_fill);
    return command;
}

/* Core tối thiểu nhưng THẬT, nối như `bootstrap/main.cpp`: ScanLoop +
 * coordinator + scheduler + SafeState, cộng PLC SHM thật (tên riêng theo tiến
 * trình, `tests/plc_shm_isolation.cpp`) để đường EXT đi đúng `PointWriter`. */
struct SwapRig {
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

    static uint64_t monotonic(void* ctx) { return static_cast<SwapRig*>(ctx)->now_ns; }
    static void sleep_until(void*, uint64_t) {}

    SwapRig()
    {
        shm.magic = KX_SHM_MAGIC;
        shm.iop_status = KX_IOP_NORMAL;
        shm.ts_ns = 1;
        reader.attach_external(&shm);
        EXPECT_TRUE(bacnet.attach());
        if (kx_plc_shm_t* plc = bacnet.shm()) {
            plc->ext_count = 8;
            plc->ext[kExtIdx].writable = 1;
        }
        scheduler.set_base_step_ns(10 * kMs);
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
        source.monotonic_ns = &SwapRig::monotonic;
        source.sleep_until = &SwapRig::sleep_until;
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

    /* STAGE (Commission) hoặc RESTORE rồi ACTIVATE, mang intent Enable cho mọi
     * Program trong `enabled` (ADR-062, như web gửi). */
    bool commission(const std::string& operation, const std::string& revision,
                    const std::vector<uint8_t>& package, const std::string& expected,
                    const std::vector<std::string>& enabled, char plan_fill,
                    bool restore = false)
    {
        const StageCommand staged = write_candidate(tree, operation, revision, package, plan_fill);
        std::string detail, error;
        const bool staged_ok = restore ? coordinator->restore(staged, &detail, &error)
                                       : coordinator->stage(staged, &detail, &error);
        if (!staged_ok) {
            ADD_FAILURE() << (restore ? "RESTORE: " : "STAGE: ") << detail << ": " << error;
            return false;
        }
        ActivateCommand command;
        command.operation_id = staged.operation_id;
        command.expected_active_revision_id = expected;
        command.staged_token = staged.operation_id;
        command.cutover = CutoverMode::PROGRAM_ONLY;
        command.plan_hash = staged.plan_hash;
        command.has_program_intents = true;
        for (const std::string& name : enabled) command.program_intents.push_back({name, true});
        if (!coordinator->activate(command, &detail, &error)) {
            ADD_FAILURE() << "ACTIVATE: " << detail << ": " << error;
            return false;
        }
        return true;
    }

    /* Chạy scan tới khi COMMITTED (flush như worker IPC làm). */
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

    /* DO kênh `ch` đang có claim mức 5 (PRIO_LOCAL_LOGIC) không. */
    bool do_level5(int ch, bool* value = nullptr) const
    {
        bool on = false;
        const bool active = resolver.do_value_at_level(PRIO_LOCAL_LOGIC, ch, &on);
        if (value != nullptr) *value = on;
        return active;
    }

    kx_plc_shm_t& plc() { return *bacnet.shm(); }
    uint32_t ext_seq() { return plc().ext_cmd_seq[kExtIdx]; }
    uint8_t ext_dirty() { return plc().ext[kExtIdx].dirty; }

    /* Gói A đang Active và đã COMMITTED: `P_old` lái DO-01 := TRUE và EXT 3 := 1.0. */
    void commit_package_a()
    {
        ASSERT_TRUE(commission(kOp1, kRevisionA,
                               package_of({{"P_old",
                                            {local_do("valve", "DO-01", true),
                                             ext_real("cmd", "1.0")}}}),
                               "", {"P_old"}, 'a'));
        run_until_committed();
        step();
        ASSERT_EQ(scheduler.find_program("P_old")->state, StProgramState::RUNNING);
        ASSERT_TRUE(do_level5(0)) << "tiền điều kiện: gói A giữ DO-01 ở mức 5";
        ASSERT_EQ(shm.do_cmd[0], 1);
        ASSERT_FALSE(safe.active());
        ASSERT_EQ(ext_dirty(), 1) << "tiền điều kiện: gói A đã ra lệnh EXT 3";
        ASSERT_NE(ext_seq(), 0u);
        ASSERT_FLOAT_EQ(plc().ext[kExtIdx].setpoint, 1.0f);
    }
};

} // namespace

/* ── 1. Gói mới không nắm điểm ⇒ rút ngay tại boundary kích hoạt ──────────── */

/* Đúng kịch bản soak lần 3: gói thử chỉ có Program không output. DO-01 phải được
 * nhả ở mức 5 ngay trong scan kích hoạt gói, và T7 `no_ctrl` tiếp quản (graph
 * không nạp, không nguồn nào khác). Trên mã cũ: DO-01 = 1 ở mức 5 mãi mãi. */
TEST(ProgrammingPackageSwapWithdraw, CommissionWithoutOutputsReleasesLocalDoAtActivationBoundary)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_NO_FATAL_FAILURE(rig.commit_package_a());

    ASSERT_TRUE(rig.commission(kOp2, kRevisionB, package_of({{"P_soak", {}}}), kRevisionA,
                               {"P_soak"}, 'b'));
    std::string error;
    bool committed = false;
    for (std::size_t scan = 1; scan <= 20 && !committed; ++scan) {
        rig.step();
        ASSERT_TRUE(rig.coordinator->flush_progress(&error)) << error;
        EXPECT_FALSE(rig.do_level5(0))
            << "scan " << scan << ": DO-01 vẫn bị gói cũ giữ ở mức 5 (F20)";
        EXPECT_TRUE(rig.safe.triggers().no_controller)
            << "scan " << scan << ": T7 phải tiếp quản khi không còn ai điều khiển";
        EXPECT_EQ(rig.shm.do_cmd[0], 0) << "scan " << scan << ": DO-01 phải về an toàn";
        committed = rig.coordinator->snapshot().state == LifecycleState::COMMITTED;
    }
    ASSERT_TRUE(committed);
    EXPECT_EQ(rig.scheduler.find_program("P_old"), nullptr);
    EXPECT_EQ(rig.scheduler.find_program("P_soak")->state, StProgramState::RUNNING);
}

/* Gói mới vẫn điều khiển MỘT kênh khác nên T7 không bật; kênh gói cũ bỏ lại phải
 * rơi xuống tầng dưới (default mức 6), không giữ giá trị của gói cũ. */
TEST(ProgrammingPackageSwapWithdraw, ReleasedLocalOutputFallsToLowerTierWhenOthersStillControl)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_NO_FATAL_FAILURE(rig.commit_package_a());

    ASSERT_TRUE(rig.commission(kOp2, kRevisionB,
                               package_of({{"P_new", {local_do("fan", "DO-02", true)}}}),
                               kRevisionA, {"P_new"}, 'b'));
    rig.step();
    EXPECT_FALSE(rig.do_level5(0)) << "DO-01 vẫn bị gói cũ giữ ở mức 5 (F20)";
    EXPECT_EQ(rig.resolver.winning_do_level(0), PRIO_DEFAULT);
    EXPECT_EQ(rig.shm.do_cmd[0], 0) << "DO-01 phải theo default mức 6";
    EXPECT_TRUE(rig.do_level5(1)) << "DO-02 của gói mới";
    EXPECT_EQ(rig.shm.do_cmd[1], 1);
    EXPECT_FALSE(rig.safe.active()) << "còn Program điều khiển DO-02 nên T7 không được bật";
}

/* EXT đã publish: nhả đúng MỘT lần (`dirty=0` + seq mới) để iobus ghi
 * `safe_value`, rồi không phát thêm lệnh nào ở các scan sau. */
TEST(ProgrammingPackageSwapWithdraw, CommissionWithoutOutputsReleasesPublishedExtCommandOnce)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_NO_FATAL_FAILURE(rig.commit_package_a());
    const uint32_t seq_before = rig.ext_seq();

    ASSERT_TRUE(rig.commission(kOp2, kRevisionB, package_of({{"P_soak", {}}}), kRevisionA,
                               {"P_soak"}, 'b'));
    rig.step();
    EXPECT_EQ(rig.ext_dirty(), 0) << "EXT 3 phải được nhả để iobus về safe_value (F20)";
    EXPECT_EQ(rig.ext_seq(), seq_before + 1) << "nhả phải mang danh tính lệnh mới";
    EXPECT_NE(rig.table.get({PointKind::EXT, kExtIdx}).source, PointSource::PROGRAM);

    rig.run_until_committed();
    for (int scan = 0; scan < 5; ++scan) rig.step();
    EXPECT_EQ(rig.ext_seq(), seq_before + 1) << "nhả một lần, không lặp mỗi scan";
    EXPECT_EQ(rig.ext_dirty(), 0);
}

/* ── 2. Điểm cả hai gói cùng nắm: không bao giờ nhả ───────────────────────── */

/* Gói B (instance KHÁC tên) lái đúng DO-01 và EXT 3 với cùng giá trị. Từ ACTIVATE
 * tới COMMITTED, không scan nào được thấy DO-01 mất claim mức 5, không `no_ctrl`,
 * và seq EXT không đổi: nhả rồi claim lại sẽ tăng seq hai lần và cho iobus một
 * cửa sổ `dirty=0` để phát `safe_value` lên dây. */
TEST(ProgrammingPackageSwapWithdraw, PointClaimedByBothPackagesIsNeverReleased)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_NO_FATAL_FAILURE(rig.commit_package_a());
    const uint32_t seq_before = rig.ext_seq();

    ASSERT_TRUE(rig.commission(kOp2, kRevisionB,
                               package_of({{"P_next",
                                            {local_do("valve", "DO-01", true),
                                             ext_real("cmd", "1.0")}}}),
                               kRevisionA, {"P_next"}, 'b'));
    std::string error;
    bool committed = false;
    for (std::size_t scan = 1; scan <= 20 && !committed; ++scan) {
        rig.step();
        ASSERT_TRUE(rig.coordinator->flush_progress(&error)) << error;
        bool on = false;
        EXPECT_TRUE(rig.do_level5(0, &on)) << "scan " << scan << ": DO-01 mất claim mức 5";
        EXPECT_TRUE(on);
        EXPECT_EQ(rig.shm.do_cmd[0], 1) << "scan " << scan;
        EXPECT_FALSE(rig.safe.triggers().no_controller) << "scan " << scan;
        EXPECT_EQ(rig.ext_dirty(), 1) << "scan " << scan << ": EXT 3 bị nhả";
        EXPECT_EQ(rig.ext_seq(), seq_before) << "scan " << scan << ": lệnh EXT thừa";
        committed = rig.coordinator->snapshot().state == LifecycleState::COMMITTED;
    }
    EXPECT_TRUE(committed);
    EXPECT_EQ(rig.scheduler.find_program("P_old"), nullptr);
}

/* Trạng thái GIỮA boundary đổi gói và lần publish đầu của gói mới — đúng cửa sổ
 * iobus có thể nhìn thấy. Gọi boundary trực tiếp như ScanLoop gọi (cùng resolver,
 * cùng PointWriter trên PLC SHM), rồi soi trước khi Program nào chạy:
 *  - DO-01 và EXT 3 (gói mới cũng nắm): claim còn nguyên, seq không đổi;
 *  - DO-02 (chỉ gói cũ nắm): đã nhả.
 * Một bản sửa "nhả hết rồi để gói mới claim lại" đỏ ở đây dù ca ScanLoop ở trên
 * có thể vẫn xanh với DO cục bộ (resolve chạy sau khi gói mới đã claim lại). */
TEST(ProgrammingPackageSwapWithdraw, BoundaryKeepsSharedClaimsUntilNewPackagePublishes)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_TRUE(rig.commission(kOp1, kRevisionA,
                               package_of({{"P_old",
                                            {local_do("valve", "DO-01", true),
                                             local_do("fan", "DO-02", true),
                                             ext_real("cmd", "1.0")}}}),
                               "", {"P_old"}, 'a'));
    rig.run_until_committed();
    rig.step();
    ASSERT_TRUE(rig.do_level5(0));
    ASSERT_TRUE(rig.do_level5(1));
    ASSERT_EQ(rig.ext_dirty(), 1);
    const uint32_t seq_before = rig.ext_seq();

    ASSERT_TRUE(rig.commission(kOp2, kRevisionB,
                               package_of({{"P_next",
                                            {local_do("valve", "DO-01", true),
                                             ext_real("cmd", "1.0")}}}),
                               kRevisionA, {"P_next"}, 'b'));
    PointWriter writer(rig.table, rig.bacnet.shm());
    rig.coordinator->on_safe_boundary(&rig.resolver, &writer);
    ASSERT_EQ(rig.coordinator->snapshot().state, LifecycleState::ACTIVE_CANDIDATE);
    ASSERT_EQ(rig.scheduler.find_program("P_next")->state, StProgramState::RUNNING);
    ASSERT_EQ(rig.scheduler.find_program("P_next")->run_count, 0u) << "chưa Program nào chạy";
    bool on = false;
    EXPECT_TRUE(rig.do_level5(0, &on)) << "DO-01 gói mới nắm: không được nhả ở boundary";
    EXPECT_TRUE(on);
    EXPECT_EQ(rig.ext_dirty(), 1) << "EXT 3 gói mới nắm: iobus không được thấy dirty=0";
    EXPECT_EQ(rig.ext_seq(), seq_before) << "EXT 3 gói mới nắm: không có lệnh nhả";
    EXPECT_FALSE(rig.do_level5(1)) << "DO-02 chỉ gói cũ nắm: phải nhả ngay ở boundary";

    rig.step(); /* boundary đã áp: scan này chỉ chạy Program của gói mới */
    EXPECT_TRUE(rig.do_level5(0));
    EXPECT_EQ(rig.ext_seq(), seq_before) << "cùng giá trị: gói mới không phát lệnh mới";
    EXPECT_EQ(rig.ext_dirty(), 1);
    EXPECT_FALSE(rig.do_level5(1));
    EXPECT_EQ(rig.shm.do_cmd[1], 0);
}

/* Cùng điểm nhưng gói mới đổi giá trị EXT: seq tăng ĐÚNG MỘT lần (lệnh mới của
 * gói mới), `dirty` không bao giờ về 0. */
TEST(ProgrammingPackageSwapWithdraw, SharedExtPointWithNewValueAdvancesSequenceExactlyOnce)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_NO_FATAL_FAILURE(rig.commit_package_a());
    const uint32_t seq_before = rig.ext_seq();

    ASSERT_TRUE(rig.commission(kOp2, kRevisionB,
                               package_of({{"P_next", {ext_real("cmd", "2.0")}}}), kRevisionA,
                               {"P_next"}, 'b'));
    rig.step();
    EXPECT_EQ(rig.ext_dirty(), 1);
    EXPECT_EQ(rig.ext_seq(), seq_before + 1);
    EXPECT_FLOAT_EQ(rig.plc().ext[kExtIdx].setpoint, 2.0f);
    rig.run_until_committed();
    rig.step();
    EXPECT_EQ(rig.ext_seq(), seq_before + 1) << "giá trị không đổi nữa thì không có lệnh mới";
    EXPECT_EQ(rig.ext_dirty(), 1);
    EXPECT_FALSE(rig.do_level5(0)) << "DO-01 chỉ gói cũ nắm: phải được nhả";
}

/* ── 3. Restore về gói cũ ─────────────────────────────────────────────────── */

/* A → B (không output) nhả DO-01 và EXT 3; Restore A thì Program của A claim lại
 * cả hai ngay scan kích hoạt, T7 tắt. */
TEST(ProgrammingPackageSwapWithdraw, RestoreBackToOldPackageReclaimsOutputs)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_NO_FATAL_FAILURE(rig.commit_package_a());

    ASSERT_TRUE(rig.commission(kOp2, kRevisionB, package_of({{"P_soak", {}}}), kRevisionA,
                               {"P_soak"}, 'b'));
    rig.run_until_committed();
    rig.step();
    ASSERT_FALSE(rig.do_level5(0)) << "tiền điều kiện: B đã nhả DO-01 (F20)";
    ASSERT_EQ(rig.ext_dirty(), 0) << "tiền điều kiện: B đã nhả EXT 3 (F20)";
    const uint32_t seq_released = rig.ext_seq();

    ASSERT_TRUE(rig.commission(kOp3, kRevisionA,
                               package_of({{"P_old",
                                            {local_do("valve", "DO-01", true),
                                             ext_real("cmd", "1.0")}}}),
                               kRevisionB, {"P_old"}, 'c', /*restore=*/true));
    rig.step();
    bool on = false;
    EXPECT_TRUE(rig.do_level5(0, &on)) << "Restore phải claim lại DO-01 ngay scan kích hoạt";
    EXPECT_TRUE(on);
    EXPECT_EQ(rig.shm.do_cmd[0], 1);
    EXPECT_FALSE(rig.safe.triggers().no_controller);
    EXPECT_EQ(rig.ext_dirty(), 1);
    EXPECT_EQ(rig.ext_seq(), seq_released + 1) << "đúng một lệnh EXT mới";
    rig.run_until_committed();
    EXPECT_EQ(rig.coordinator->snapshot().active_revision_id, kRevisionA);
    EXPECT_EQ(rig.scheduler.find_program("P_soak"), nullptr);
}

/* ── 4. Rollback chu kỳ đầu ───────────────────────────────────────────────── */

/* Gói ứng viên cùng lái DO-01/EXT 3 nhưng fault ngay chu kỳ đầu: nó tiếp quản
 * claim của gói cũ ở boundary rồi chưa kịp publish. Rollback trả topology cũ và
 * chuyển owner về `GRAPH_ONLY`, nên KHÔNG Program nào còn publish: claim đó phải
 * được nhả, không được treo giá trị cuối của gói cũ như F20. */
TEST(ProgrammingPackageSwapWithdraw, FirstCycleRollbackDoesNotLeaveOrphanedClaims)
{
    SwapRig rig;
    ASSERT_FALSE(rig.tree.path.empty());
    ASSERT_NO_FATAL_FAILURE(rig.commit_package_a());
    const uint32_t seq_before = rig.ext_seq();

    ProgramSpec bad{"P_bad", {local_do("valve", "DO-01", true), ext_real("cmd", "1.0")}, true};
    ASSERT_TRUE(rig.commission(kOp2, kRevisionB, package_of({bad}), kRevisionA, {"P_bad"}, 'b'));
    rig.step();
    EXPECT_EQ(rig.scheduler.find_program("P_bad")->state, StProgramState::FAULTED);
    EXPECT_EQ(rig.coordinator->snapshot().state, LifecycleState::ROLLING_BACK);
    EXPECT_TRUE(rig.do_level5(0)) << "boundary kích hoạt không được nhả điểm gói mới nắm";
    EXPECT_EQ(rig.ext_seq(), seq_before);

    rig.step();
    ASSERT_EQ(rig.coordinator->snapshot().state, LifecycleState::ROLLED_BACK);
    ASSERT_EQ(rig.cutover.current(), CutoverMode::GRAPH_ONLY);
    EXPECT_FALSE(rig.do_level5(0)) << "sau rollback không Program nào publish DO-01";
    EXPECT_TRUE(rig.safe.triggers().no_controller);
    EXPECT_EQ(rig.shm.do_cmd[0], 0);
    EXPECT_EQ(rig.ext_dirty(), 0);
    EXPECT_EQ(rig.ext_seq(), seq_before + 1);
}
