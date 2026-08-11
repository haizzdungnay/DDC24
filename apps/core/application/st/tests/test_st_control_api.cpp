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
    StScheduler s;
    const json r = call(&s, {{"action", "program_capabilities"}});
    ASSERT_EQ(r["result"], "ok");
    /* BE phải biết trước nên compile với profile/ABI nào, thay vì thử rồi
     * nhận lỗi IR-E-003/004. */
    EXPECT_EQ(r["artifactSchemaVersion"], st_ir::kSchemaVersion);
    EXPECT_EQ(r["compilerProfile"], st_ir::kCompilerProfile);
    EXPECT_EQ(r["targetAbi"], st_ir::kTargetAbi);
    EXPECT_EQ(r["maxArtifactBytes"], st_ir::kMaxArtifactSize);
    EXPECT_TRUE(r.contains("compilerVersion"));
    EXPECT_TRUE(r.contains("baseTickMs"));
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

} // namespace core
