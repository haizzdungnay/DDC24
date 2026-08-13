/**
 * @file  test_st_control_api.cpp
 * @brief ACTION 13 — hợp đồng điều khiển runtime cho BE.
 *
 *        Bất biến quan trọng nhất: MỌI request, kể cả rác, đều nhận lại một
 *        JSON đúng shape có `errorCode` ổn định và `keepsRunningPackage`.
 *        BE không bao giờ phải đoán chương trình đang chạy có bị ảnh hưởng không.
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_compile.hpp"
#include "st/st_control_api.hpp"
#include "st/st_ir.hpp"
#include "st/st_process_image.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

using json = nlohmann::json;

std::vector<uint8_t> build(const std::string& src)
{
    StIrModule mod;
    StDiagnostic d;
    EXPECT_TRUE(compile_st_source(src, &mod, &d)) << d.code << ": " << d.message;
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

const char* kCounter = R"ST(
PROGRAM c
VAR_OUTPUT n : INT; END_VAR
    n := n + 1;
END_PROGRAM
)ST";

const char* kRetainCounter = R"ST(
PROGRAM retained_counter
VAR RETAIN n : INT; END_VAR
    n := n + 1;
END_PROGRAM
)ST";

void setup(StScheduler* s)
{
    std::string err;
    StTaskConfig c;
    c.id = "T";
    c.priority = 0;
    c.period_ms = 100;
    c.budget_ms = 100;
    ASSERT_TRUE(s->add_task(c, &err)) << err;
    ASSERT_TRUE(s->add_program("T", "p", 0, &err)) << err;
}

json call(StScheduler* s, const json& req)
{
    const std::string out = st_handle_control_request(s, req.dump());
    EXPECT_FALSE(out.empty());
    return json::parse(out);
}

/* Bất biến chung cho mọi response — gọi ở mọi test. */
void expect_well_formed(const json& r)
{
    EXPECT_TRUE(r.contains("version"));
    EXPECT_TRUE(r.contains("requestId"));
    EXPECT_TRUE(r.contains("result"));
    if (r["result"] == "error") {
        EXPECT_TRUE(r.contains("errorCode"));
        EXPECT_TRUE(r.contains("message"));
        EXPECT_TRUE(r.contains("keepsRunningPackage"));
    }
}

} // namespace

/* ---- Request rác ---- */

TEST(StControlApi, MalformedJsonStillReturnsWellFormedError)
{
    StScheduler s;
    const std::string out = st_handle_control_request(&s, "{ this is not json");
    ASSERT_FALSE(out.empty());
    const json r = json::parse(out);
    expect_well_formed(r);
    EXPECT_EQ(r["errorCode"], st_api_error::kBadRequest);
    EXPECT_TRUE(r["keepsRunningPackage"].get<bool>());
}

TEST(StControlApi, EmptyRequestReturnsError)
{
    StScheduler s;
    const json r = json::parse(st_handle_control_request(&s, ""));
    expect_well_formed(r);
    EXPECT_EQ(r["errorCode"], st_api_error::kBadRequest);
}

TEST(StControlApi, NonObjectJsonReturnsError)
{
    StScheduler s;
    const json r = json::parse(st_handle_control_request(&s, "[1,2,3]"));
    expect_well_formed(r);
    EXPECT_EQ(r["errorCode"], st_api_error::kBadRequest);
}

TEST(StControlApi, MissingActionReturnsError)
{
    StScheduler s;
    const json r = call(&s, {{"requestId", "r1"}});
    expect_well_formed(r);
    EXPECT_EQ(r["errorCode"], st_api_error::kBadRequest);
    EXPECT_EQ(r["requestId"], "r1") << "requestId phải được phản chiếu kể cả khi lỗi";
}

TEST(StControlApi, UnknownActionReturnsStableCode)
{
    StScheduler s;
    setup(&s);
    const json r = call(&s, {{"requestId", "r"}, {"action", "program_selfdestruct"},
                             {"instanceId", "p"}});
    EXPECT_EQ(r["errorCode"], st_api_error::kUnknownAction);
}

TEST(StControlApi, UnknownInstanceReturnsStableCode)
{
    StScheduler s;
    setup(&s);
    const json r = call(&s, {{"action", "program_start"}, {"instanceId", "khong-co"}});
    EXPECT_EQ(r["errorCode"], st_api_error::kUnknownInstance);
}

/* ---- Truy vấn ---- */

TEST(StControlApi, CapabilitiesPublishesEverythingBeNeedsToCompile)
{
    StScheduler s(StSchedulerProfile::REV_A);
    const json r = call(&s, {{"action", "program_capabilities"}});
    ASSERT_EQ(r["result"], "ok");
    /* BE phải biết trước nên compile với profile/ABI nào, thay vì thử rồi
     * nhận lỗi IR-E-003/004. */
    EXPECT_EQ(r["artifactSchemaVersion"], st_ir::kSchemaVersion);
    EXPECT_EQ(r["compilerProfile"], st_ir::kCompilerProfile);
    EXPECT_EQ(r["targetAbi"], st_ir::kTargetAbi);
    EXPECT_EQ(r["maxArtifactBytes"], st_ir::kMaxArtifactSize);
    EXPECT_TRUE(r.contains("compilerVersion"));
    EXPECT_EQ(r["runtimeProfile"], st_profile_generated::kProfileId);
    EXPECT_EQ(r["maxTasks"], 1);
    EXPECT_EQ(r["maxProgramsPerTask"], 1);
    EXPECT_EQ(r["maxProgramsTotal"], 1);
    EXPECT_EQ(r["allowedPeriodMs"], json({1000, 5000, 30000}));
    EXPECT_EQ(r["baseStepMs"], 1000);
    EXPECT_EQ(r["baseStepMinMs"], 500);
    EXPECT_EQ(r["baseStepMaxMs"], 2000);
    EXPECT_EQ(r["maxTaskBudgetPercentExclusive"], 20);
    /* TASK-PROG-305: capability monitor/trace theo OD-PROG-011 — 1 Hz, stale
     * sau 3 kỳ, trace event bounded. */
    EXPECT_EQ(r["monitorPollHz"], 1);
    EXPECT_EQ(r["monitorStaleAfterPolls"], 3);
    EXPECT_EQ(r["maxTraceEvents"], kSchedulerTraceCapacity);
}

TEST(StControlApi, StatusReportsTasksAndPrograms)
{
    StScheduler s;
    setup(&s);
    const json r = call(&s, {{"action", "program_status"}});
    ASSERT_EQ(r["result"], "ok");
    ASSERT_EQ(r["tasks"].size(), 1u);
    const json& t = r["tasks"][0];
    EXPECT_EQ(t["taskId"], "T");
    EXPECT_EQ(t["periodMs"], 100);
    ASSERT_EQ(t["programs"].size(), 1u);
    EXPECT_EQ(t["programs"][0]["instanceId"], "p");
    EXPECT_EQ(t["programs"][0]["state"], "EMPTY");
    EXPECT_FALSE(r["anyForcingSafeState"].get<bool>());
}

TEST(StControlApi, StatusExposesFaultDetailForDiagnosis)
{
    StScheduler s;
    std::string err;
    setup(&s);
    const char* boom = R"ST(
PROGRAM b
VAR_INPUT  d : INT; END_VAR
VAR_OUTPUT o : INT; END_VAR
    o := 1 / d;
END_PROGRAM
)ST";
    ASSERT_TRUE(s.request_activation("p", build(boom), &err));
    s.tick(0);
    ASSERT_TRUE(s.start("p", &err));
    s.tick(100000000ull);

    const json r = call(&s, {{"action", "program_status"}});
    const json& p = r["tasks"][0]["programs"][0];
    EXPECT_EQ(p["state"], "FAULTED");
    ASSERT_FALSE(p["lastFault"].is_null());
    EXPECT_EQ(p["lastFault"]["code"], "ST-RT-002") << "chia cho 0";
    EXPECT_GT(p["lastFault"]["line"].get<int>(), 0) << "phải chỉ được về dòng ST gốc";
}

TEST(StControlApi, StatusExposesMonitorInputsWithQualityAndSource)
{
    /* TASK-PROG-305 "monitor": source/quality/freshness per input binding —
     * đọc lại process_inputs đã chụp ở TASK-PROG-302, không suy diễn. */
    StScheduler s;
    std::string err;
    setup(&s);
    const char* echo = R"ST(
PROGRAM e
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := a;
END_PROGRAM
)ST";
    const StIrModule mod = [&] {
        StIrModule m;
        StDiagnostic d;
        EXPECT_TRUE(compile_st_source(echo, &m, &d));
        return m;
    }();
    StIrIoBinding in{};
    for (const StIrVariable& v : mod.variables) if (v.name == "a") in.slot = v.slot;
    in.point_kind = StPointKind::AV;
    in.point_index = 1;
    StIrModule m2 = mod;
    m2.io_bindings.push_back(in);
    std::vector<uint8_t> bytes;
    ASSERT_TRUE(serialize_st_ir(m2, &bytes, &err)) << err;
    ASSERT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));

    ASSERT_TRUE(s.request_activation("p", bytes, &err)) << err;
    s.tick(0);
    ASSERT_TRUE(s.start("p", &err));

    PointTable table;
    ASSERT_TRUE(table.set_virtual({PointKind::AV, 0}, 3.5f, PointSource::WEB));
    StIoBridgeStats stats;
    ASSERT_TRUE(st_load_all_inputs(&s, table, &stats));
    ASSERT_EQ(s.tick(100 * 1000000ull).programs_run, 1u);

    const json r = call(&s, {{"action", "program_status"}});
    const json& p = r["tasks"][0]["programs"][0];
    ASSERT_EQ(p["monitorInputs"].size(), 1u);
    EXPECT_EQ(p["monitorInputs"][0]["variable"], "a");
    EXPECT_EQ(p["monitorInputs"][0]["pointCategory"], "VP");
    EXPECT_EQ(p["monitorInputs"][0]["quality"], static_cast<int>(KX_Q_GOOD));
    EXPECT_EQ(p["monitorInputs"][0]["source"], static_cast<int>(PointSource::WEB));
    EXPECT_TRUE(p["inputSnapshotValid"].get<bool>());
}

TEST(StControlApi, TraceActionIsGracefulWithoutAttachedLog)
{
    StScheduler s;
    setup(&s);
    const json r = call(&s, {{"action", "program_trace"}});
    ASSERT_EQ(r["result"], "ok");
    EXPECT_EQ(r["events"].size(), 0u);
    EXPECT_EQ(r["capacity"], 0);
    EXPECT_EQ(r["droppedCount"], 0);
}

TEST(StControlApi, TraceActionReportsRuntimeFaultEventWhenLogAttached)
{
    StScheduler s;
    std::string err;
    setup(&s);
    StSchedulerTrace trace;
    s.set_trace_log(&trace);

    const char* boom = R"ST(
PROGRAM b
VAR_INPUT  d : INT; END_VAR
VAR_OUTPUT o : INT; END_VAR
    o := 1 / d;
END_PROGRAM
)ST";
    ASSERT_TRUE(s.request_activation("p", build(boom), &err));
    s.tick(0);
    ASSERT_TRUE(s.start("p", &err));
    s.tick(100000000ull);

    const json r = call(&s, {{"action", "program_trace"}});
    ASSERT_EQ(r["result"], "ok");
    EXPECT_EQ(r["capacity"], kSchedulerTraceCapacity);
    bool found_fault = false;
    for (const json& e : r["events"]) {
        if (e["kind"] == static_cast<int>(StTraceEventKind::RUNTIME_FAULT) &&
            e["code"] == "ST-RT-002") {
            found_fault = true;
            EXPECT_EQ(e["taskId"], "T");
            EXPECT_EQ(e["instanceId"], "p");
            EXPECT_FALSE(e["ok"].get<bool>());
        }
    }
    EXPECT_TRUE(found_fault) << "chia cho 0 phải sinh RUNTIME_FAULT event";

    /* Còn hai event ACTIVATION_RESULT (stage) — cũng phải có mặt, chứng
     * minh log không chỉ ghi fault. */
    bool found_activation = false;
    for (const json& e : r["events"])
        if (e["kind"] == static_cast<int>(StTraceEventKind::ACTIVATION_RESULT)) found_activation = true;
    EXPECT_TRUE(found_activation);
}

TEST(StControlApi, TraceLogDropsOldestAndCountsWhenFull)
{
    StBoundedRuntimeTrace<2> tiny;
    StRuntimeTraceEvent e1; e1.code = "A";
    StRuntimeTraceEvent e2; e2.code = "B";
    StRuntimeTraceEvent e3; e3.code = "C";
    tiny.push(e1);
    tiny.push(e2);
    EXPECT_EQ(tiny.size(), 2u);
    EXPECT_EQ(tiny.dropped_count(), 0u);
    tiny.push(e3);
    EXPECT_EQ(tiny.size(), 2u) << "capacity cố định, không phình ra";
    EXPECT_EQ(tiny.dropped_count(), 1u);
    EXPECT_STREQ(tiny.at(0).code, "B") << "event cũ nhất (A) đã bị drop";
    EXPECT_STREQ(tiny.at(1).code, "C");
}

/* ---- Vòng đời qua API ---- */

TEST(StControlApi, FullLifecycleStageStartStopRollback)
{
    StScheduler s;
    setup(&s);
    const std::vector<uint8_t> art = build(kCounter);

    json r = call(&s, {{"requestId", "1"}, {"action", "program_stage"}, {"instanceId", "p"},
                       {"artifact", st_base64_encode(art.data(), art.size())}});
    ASSERT_EQ(r["result"], "ok") << r.dump();
    EXPECT_EQ(r["state"], "STAGED");
    EXPECT_EQ(r["appliedAt"], "next_tick_boundary")
        << "BE không được kết luận 'đã chạy' khi mới stage";
    EXPECT_EQ(r["artifactBytes"], art.size());

    s.tick(0);
    r = call(&s, {{"action", "program_status"}});
    EXPECT_EQ(r["tasks"][0]["programs"][0]["state"], "ACTIVE");

    r = call(&s, {{"action", "program_start"}, {"instanceId", "p"}});
    ASSERT_EQ(r["result"], "ok");
    EXPECT_EQ(r["state"], "RUNNING");

    s.tick(100000000ull);
    s.tick(200000000ull);

    r = call(&s, {{"action", "program_stop"}, {"instanceId", "p"}});
    ASSERT_EQ(r["result"], "ok");
    EXPECT_EQ(r["state"], "STOPPED");

    r = call(&s, {{"action", "program_rollback"}, {"instanceId", "p"}});
    ASSERT_EQ(r["result"], "ok") << r.dump();
    EXPECT_EQ(r["state"], "STAGED");
    EXPECT_EQ(r["appliedAt"], "next_tick_boundary");
    s.tick(300000000ull);
    r = call(&s, {{"action", "program_status"}});
    EXPECT_EQ(r["tasks"][0]["programs"][0]["state"], "ROLLED_BACK");
}

TEST(StControlApi, InvalidTransitionReportsBadTransitionNotCrash)
{
    StScheduler s;
    setup(&s);
    const json r = call(&s, {{"action", "program_start"}, {"instanceId", "p"}});
    EXPECT_EQ(r["errorCode"], st_api_error::kBadTransition);
    EXPECT_TRUE(r["keepsRunningPackage"].get<bool>());
}

TEST(StControlApi, DisableEnableRoundTrip)
{
    StScheduler s;
    setup(&s);
    json r = call(&s, {{"action", "program_disable"}, {"instanceId", "p"}});
    ASSERT_EQ(r["result"], "ok");
    EXPECT_EQ(r["state"], "DISABLED");
    r = call(&s, {{"action", "program_enable"}, {"instanceId", "p"}});
    ASSERT_EQ(r["result"], "ok");
    EXPECT_EQ(r["state"], "STOPPED");
}

/* ---- Artifact ---- */

TEST(StControlApi, InvalidBase64Rejected)
{
    StScheduler s;
    setup(&s);
    const json r = call(&s, {{"action", "program_stage"}, {"instanceId", "p"},
                             {"artifact", "!!!khong-phai-base64!!!"}});
    EXPECT_EQ(r["errorCode"], st_api_error::kBadArtifact);
    EXPECT_TRUE(r["keepsRunningPackage"].get<bool>());
}

TEST(StControlApi, OversizedArtifactRejectedWithoutAllocating)
{
    StScheduler s;
    setup(&s);
    /* Chuỗi base64 lớn hơn nhiều so với 1 MiB — phải bị từ chối bằng ước
     * lượng kích thước, không phải sau khi đã giải mã hết. */
    const std::string huge(3 * 1024 * 1024, 'A');
    const json r = call(&s, {{"action", "program_stage"}, {"instanceId", "p"},
                             {"artifact", huge}});
    EXPECT_EQ(r["errorCode"], st_api_error::kBadArtifact);
}

TEST(StControlApi, Base64RoundTrip)
{
    const std::vector<uint8_t> data = {0, 1, 2, 250, 251, 255, 42};
    const std::string enc = st_base64_encode(data.data(), data.size());
    std::vector<uint8_t> dec;
    ASSERT_TRUE(st_base64_decode(enc, &dec, 1024));
    EXPECT_EQ(dec, data);
}

TEST(StControlApi, StagingCorruptArtifactKeepsRunningPackage)
{
    StScheduler s;
    std::string err;
    setup(&s);
    ASSERT_TRUE(s.request_activation("p", build(kCounter), &err));
    s.tick(0);
    ASSERT_TRUE(s.start("p", &err));
    s.tick(100000000ull); /* promote package hiện hành thành last-known-good */

    std::vector<uint8_t> broken = build(kCounter);
    broken[broken.size() - 1] ^= 0xFF;
    json r = call(&s, {{"action", "program_stage"}, {"instanceId", "p"},
                       {"artifact", st_base64_encode(broken.data(), broken.size())}});
    ASSERT_EQ(r["result"], "error") << "stage phải verify fail-closed ngoài RT";
    EXPECT_EQ(r["errorCode"], st_api_error::kBadArtifact);

    s.tick(200000000ull);
    r = call(&s, {{"action", "program_status"}});
    /* Package cũ vẫn chạy — bất biến của TYPED_IR_ARTIFACT_SPEC §8. */
    EXPECT_EQ(r["tasks"][0]["programs"][0]["state"], "RUNNING");
}

TEST(StControlApi, StatusIncludesArtifactHashForBeToVerifyWhatIsRunning)
{
    StScheduler s;
    std::string err;
    setup(&s);
    ASSERT_TRUE(s.request_activation("p", build(kCounter), &err));
    s.tick(0);

    const json r = call(&s, {{"action", "program_status"}});
    const json& p = r["tasks"][0]["programs"][0];
    ASSERT_FALSE(p["artifactSha256"].is_null());
    EXPECT_EQ(p["artifactSha256"].get<std::string>().size(), 44u) << "SHA-256 base64";
    EXPECT_EQ(p["programName"], "c");
}

TEST(StControlApi, StatusExposesRetainColdInitAndWriteHealth)
{
    StScheduler scheduler;
    std::string error;
    setup(&scheduler);
    ASSERT_TRUE(scheduler.request_activation("p", build(kRetainCounter), &error)) << error;
    scheduler.tick(0);

    const json response = call(&scheduler, {{"action", "program_status"}});
    const json& program = response["tasks"][0]["programs"][0];
    EXPECT_TRUE(program["hasRetain"].get<bool>());
    EXPECT_EQ(program["retainState"], "COLD_INIT_MISSING");
    EXPECT_TRUE(program["retainDetailCode"].is_null())
        << "thiếu record lần đầu là cold-init bình thường, không phải corruption";
    EXPECT_EQ(program["retainGeneration"], 0);
    EXPECT_EQ(program["retainWriteCount"], 0);
    EXPECT_EQ(program["retainWriteFailures"], 0);
}

} // namespace core
