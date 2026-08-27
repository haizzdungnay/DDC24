/**
 * @file  test_programming_sim_session.cpp
 * @brief `T59-814` — bất biến của máy chạy mô phỏng (`ADR-053` §5/§6).
 *
 *        Test ở đây cố ý dùng chương trình ST THẬT đã biên dịch và đóng gói
 *        bằng đúng writer production, không dùng blob giả: thứ đang kiểm là
 *        ngữ nghĩa lịch chạy và tất định, mà blob giả thì không có ngữ nghĩa
 *        nào để mà sai.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <limits>
#include <string>
#include <vector>

#include "programming/simulation/sim_error.hpp"
#include "programming/simulation/sim_session.hpp"
#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_test_key.hpp"

namespace core::programming::sim {
namespace {

std::vector<uint8_t> compile_program(const std::string& source)
{
    StIrModule module;
    StDiagnostic diagnostic;
    StCompileOptions options;
    options.enforce_review_gate = false;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic, options))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

struct ProgramSpec {
    std::string name;
    std::string source;
    uint32_t    period_ms;
};

std::vector<uint8_t> build_package(const std::vector<ProgramSpec>& specs)
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    for (const ProgramSpec& spec : specs) {
        StPackageProgram program;
        program.program_name = spec.name;
        program.ir_blob = compile_program(spec.source);
        program.period_ms = spec.period_ms;
        input.programs.push_back(std::move(program));

        StPouSignature signature;
        signature.name = spec.name;
        signature.kind = StPouKind::PROGRAM;
        input.pou_signatures.push_back(std::move(signature));
    }
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    return bytes;
}

/* Một Program nhanh (1 s) và một Program chậm (5 s). Cả hai đều đếm số lần
 * chính mình được release, nên "đã chạy mấy lần" là thứ đọc được từ đầu ra chứ
 * không phải suy từ đồng hồ của test. */
const char* kFastSource = R"ST(
PROGRAM Fast
VAR_INPUT  Setpoint : REAL; END_VAR
VAR_OUTPUT Runs : DINT; Doubled : REAL; END_VAR
    Runs := Runs + 1;
    Doubled := Setpoint * 2.0;
END_PROGRAM
)ST";

const char* kSlowSource = R"ST(
PROGRAM Slow
VAR_INPUT  Enable : BOOL; END_VAR
VAR_OUTPUT Runs : DINT; Elapsed : BOOL; END_VAR
VAR dly : TON; END_VAR
    Runs := Runs + 1;
    dly(IN := Enable, PT := T#10s);
    Elapsed := dly.Q;
END_PROGRAM
)ST";

std::vector<uint8_t> two_program_package()
{
    return build_package({{"Fast", kFastSource, 1000u}, {"Slow", kSlowSource, 5000u}});
}

int32_t observation_int(const SimSession& session, const std::string& observation_id)
{
    for (const SimObservation& observation : session.observations()) {
        if (observation.observation_id == observation_id) {
            EXPECT_TRUE(observation.has_value) << observation_id;
            return observation.value.i;
        }
    }
    ADD_FAILURE() << "không có observation " << observation_id;
    return -1;
}

bool observation_bool(const SimSession& session, const std::string& observation_id)
{
    for (const SimObservation& observation : session.observations()) {
        if (observation.observation_id == observation_id) return observation.value.b;
    }
    ADD_FAILURE() << "không có observation " << observation_id;
    return false;
}

float observation_real(const SimSession& session, const std::string& observation_id)
{
    for (const SimObservation& observation : session.observations()) {
        if (observation.observation_id == observation_id) return observation.value.r;
    }
    ADD_FAILURE() << "không có observation " << observation_id;
    return 0.0f;
}

bool prepare(SimSession* session, const std::vector<uint8_t>& artifact)
{
    const char* code = nullptr;
    std::string detail;
    const bool ok = session->prepare(artifact, st_profile_generated::kProfileCode,
                                     st_profile_generated::kTargetAbi, &code, &detail);
    EXPECT_TRUE(ok) << (code != nullptr ? code : "") << " " << detail;
    return ok;
}

bool step(SimSession* session)
{
    const char* code = nullptr;
    std::string detail;
    const bool ok = session->step(&code, &detail);
    EXPECT_TRUE(ok) << (code != nullptr ? code : "") << " " << detail;
    return ok;
}

} // namespace

TEST(SimBaseTick, GcdOfAllowedPeriods)
{
    EXPECT_EQ(sim_base_tick_ms({1000u, 5000u, 30000u}), 1000u);
    EXPECT_EQ(sim_base_tick_ms({5000u, 30000u}), 5000u);
    EXPECT_EQ(sim_base_tick_ms({30000u}), 30000u);
    /* Chu kỳ 0 KHÔNG được thay bằng một base tick đoán: package v2 legacy có
     * thể mang 0, và đoán ở đây là bịa ra một lịch chạy khác với lịch trên tủ. */
    EXPECT_EQ(sim_base_tick_ms({1000u, 0u}), 0u);
    EXPECT_EQ(sim_base_tick_ms({}), 0u);
}

TEST(SimSessionPrepare, DerivesBaseTickAndInputAllowlistFromArtifact)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));

    EXPECT_EQ(session.base_tick_ms(), 1000u);
    EXPECT_EQ(session.virtual_time_ms(), 0u);
    EXPECT_EQ(session.programs().size(), 2u);

    /* Allowlist chỉ gồm VAR_INPUT. Biến ra và biến trong KHÔNG được có mặt —
     * đó đúng là cạnh mà sandbox tồn tại để cắt. */
    std::vector<std::string> allowed;
    for (const SimInputDescriptor& descriptor : session.inputs()) {
        allowed.push_back(descriptor.observation_id);
    }
    EXPECT_NE(std::find(allowed.begin(), allowed.end(), "Fast.Setpoint"), allowed.end());
    EXPECT_NE(std::find(allowed.begin(), allowed.end(), "Slow.Enable"), allowed.end());
    EXPECT_EQ(std::find(allowed.begin(), allowed.end(), "Fast.Runs"), allowed.end());
    EXPECT_EQ(std::find(allowed.begin(), allowed.end(), "Fast.Doubled"), allowed.end());
    EXPECT_EQ(std::find(allowed.begin(), allowed.end(), "Slow.Elapsed"), allowed.end());
}

TEST(SimSessionStep, AllProgramsDueAtTimeZeroRunInOneBatch)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));

    ASSERT_TRUE(step(&session));
    /* Cả hai Program đều đến hạn ở t=0 và phải chạy trong ĐÚNG một batch. */
    EXPECT_EQ(observation_int(session, "Fast.Runs"), 1);
    EXPECT_EQ(observation_int(session, "Slow.Runs"), 1);
    EXPECT_EQ(session.virtual_time_ms(), 1000u);
    EXPECT_EQ(session.snapshot_sequence(), 1u);
}

TEST(SimSessionStep, SlowProgramDoesNotAdvanceOnTicksItIsNotDueFor)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));

    for (int tick = 0; tick < 5; ++tick) ASSERT_TRUE(step(&session));

    /* Sau 5 tick 1 s: Fast chạy 5 lần, Slow chỉ chạy lần ở t=0. Nếu Slow chạy
     * theo mọi tick thì chu kỳ trong artifact đã bị bỏ qua — và một chương
     * trình 5 s chạy mỗi giây là một lịch chạy khác hẳn cái người dùng viết. */
    EXPECT_EQ(observation_int(session, "Fast.Runs"), 5);
    EXPECT_EQ(observation_int(session, "Slow.Runs"), 1);
    EXPECT_EQ(session.virtual_time_ms(), 5000u);

    ASSERT_TRUE(step(&session));
    EXPECT_EQ(observation_int(session, "Fast.Runs"), 6);
    EXPECT_EQ(observation_int(session, "Slow.Runs"), 2);
}

TEST(SimSessionStep, TimerAdvancesOnlyByTheReleasingTaskPeriod)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));

    const char* code = nullptr;
    ASSERT_TRUE(session.set_input("Slow.Enable", StValue::make_bool(true), &code)) << code;

    /* TON PT = 10 s trong Program chu kỳ 5 s. Nó chỉ được "thấy" thời gian ở
     * những tick chính nó release, nên phải mất đúng 10 s ảo chứ không phải 10
     * tick base. */
    for (int tick = 0; tick < 10; ++tick) ASSERT_TRUE(step(&session));
    EXPECT_EQ(session.virtual_time_ms(), 10000u);
    EXPECT_FALSE(observation_bool(session, "Slow.Elapsed"));

    ASSERT_TRUE(step(&session));
    EXPECT_EQ(session.virtual_time_ms(), 11000u);
    EXPECT_TRUE(observation_bool(session, "Slow.Elapsed"));
}

TEST(SimSessionInputs, SnapshotIsTakenOncePerTick)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));

    const char* code = nullptr;
    ASSERT_TRUE(session.set_input("Fast.Setpoint", StValue::make_real(21.0f), &code)) << code;
    ASSERT_TRUE(step(&session));
    EXPECT_FLOAT_EQ(observation_real(session, "Fast.Doubled"), 42.0f);
}

TEST(SimSessionInputs, RejectsIdentityTypeAndRangeWithoutTouchingPriorValue)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));

    const char* code = nullptr;
    ASSERT_TRUE(session.set_input("Fast.Setpoint", StValue::make_real(10.0f), &code)) << code;
    ASSERT_TRUE(step(&session));
    EXPECT_FLOAT_EQ(observation_real(session, "Fast.Doubled"), 20.0f);

    /* Ghi vào một biến ĐẦU RA: không có trong allowlist. */
    code = nullptr;
    EXPECT_FALSE(session.set_input("Fast.Runs", StValue::make_integer(StType::DINT, 99), &code));
    EXPECT_STREQ(code, kErrInputUnknown);

    /* Ghi vào một `observationId` không tồn tại. */
    code = nullptr;
    EXPECT_FALSE(session.set_input("Fast.Ghost", StValue::make_real(1.0f), &code));
    EXPECT_STREQ(code, kErrInputUnknown);

    /* Sai kiểu. */
    code = nullptr;
    EXPECT_FALSE(session.set_input("Fast.Setpoint", StValue::make_bool(true), &code));
    EXPECT_STREQ(code, kErrInputValue);

    /* NaN. */
    code = nullptr;
    EXPECT_FALSE(session.set_input("Fast.Setpoint",
                                   StValue::make_real(std::numeric_limits<float>::quiet_NaN()),
                                   &code));
    EXPECT_STREQ(code, kErrInputValue);

    /* Sau bốn lần từ chối, giá trị đã commit trước đó phải còn NGUYÊN. Một lần
     * từ chối làm hỏng giá trị đang chạy là kiểu lỗi tệ nhất ở đây: người dùng
     * tin rằng "không có gì xảy ra". */
    ASSERT_TRUE(step(&session));
    EXPECT_FLOAT_EQ(observation_real(session, "Fast.Doubled"), 20.0f);
}

TEST(SimSessionDeterminism, SameArtifactAndInputsReplayIdentically)
{
    const std::vector<uint8_t> artifact = two_program_package();

    std::vector<std::string> signatures;
    for (int replay = 0; replay < 5; ++replay) {
        SimSession session;
        ASSERT_TRUE(prepare(&session, artifact));
        const char* code = nullptr;
        ASSERT_TRUE(session.set_input("Fast.Setpoint", StValue::make_real(3.5f), &code)) << code;
        ASSERT_TRUE(session.set_input("Slow.Enable", StValue::make_bool(true), &code)) << code;

        for (int tick = 0; tick < 12; ++tick) ASSERT_TRUE(step(&session));

        std::string signature;
        for (const SimObservation& observation : session.observations()) {
            signature += observation.observation_id;
            signature += "=";
            signature += std::to_string(observation.value.i);
            signature += ":";
            signature += std::to_string(observation.value.r);
            signature += ":";
            signature += observation.value.b ? "1" : "0";
            signature += ";";
        }
        signature += "t=" + std::to_string(session.virtual_time_ms());
        signatures.push_back(signature);
    }

    for (std::size_t index = 1; index < signatures.size(); ++index) {
        EXPECT_EQ(signatures[index], signatures[0])
            << "replay " << index << " lệch — phiên mô phỏng không còn tất định";
    }
}

TEST(SimSessionReset, ReturnsToTimeZeroAndForgetsWrittenInputsButKeepsManifest)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));

    const char* code = nullptr;
    ASSERT_TRUE(session.set_input("Fast.Setpoint", StValue::make_real(8.0f), &code)) << code;
    for (int tick = 0; tick < 3; ++tick) ASSERT_TRUE(step(&session));
    EXPECT_EQ(observation_int(session, "Fast.Runs"), 3);
    EXPECT_FLOAT_EQ(observation_real(session, "Fast.Doubled"), 16.0f);

    const std::size_t manifest_size = session.inputs().size();
    const uint64_t epoch_before = session.reset_epoch();
    std::string detail;
    code = nullptr;
    ASSERT_TRUE(session.reset(&code, &detail)) << (code != nullptr ? code : "") << detail;

    EXPECT_EQ(session.virtual_time_ms(), 0u);
    EXPECT_EQ(session.snapshot_sequence(), 0u);
    EXPECT_EQ(session.reset_epoch(), epoch_before + 1);
    EXPECT_EQ(session.inputs().size(), manifest_size);
    EXPECT_TRUE(session.trace().empty());

    /* Reset mà còn nhớ giá trị lần trước là reset dối: chu kỳ đầu sau reset phải
     * chạy với input khởi tạo của artifact, không phải 8.0. */
    ASSERT_TRUE(step(&session));
    EXPECT_EQ(observation_int(session, "Fast.Runs"), 1);
    EXPECT_FLOAT_EQ(observation_real(session, "Fast.Doubled"), 0.0f);
}

TEST(SimSessionTrace, BoundedAndCountsWhatItDropped)
{
    SimSession session;
    ASSERT_TRUE(prepare(&session, two_program_package()));
    for (int tick = 0; tick < 20; ++tick) ASSERT_TRUE(step(&session));
    EXPECT_EQ(session.trace().size(), 20u);
    EXPECT_EQ(session.trace_dropped(), 0u);
    EXPECT_EQ(session.trace().front().virtual_time_ms, 0u);
    EXPECT_EQ(session.trace().back().virtual_time_ms, 19000u);
    /* Sequence của sample phải tăng đều — client dùng nó để bỏ mẫu lùi. */
    for (std::size_t index = 1; index < session.trace().size(); ++index) {
        EXPECT_GT(session.trace()[index].snapshot_sequence,
                  session.trace()[index - 1].snapshot_sequence);
    }
}

TEST(SimSessionPrepare, RejectsPackageWithoutResolvedPeriods)
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    StPackageProgram program;
    program.program_name = "Fast";
    program.ir_blob = compile_program(kFastSource);
    program.period_ms = 1000u;
    input.programs.push_back(std::move(program));
    StPouSignature signature;
    signature.name = "Fast";
    signature.kind = StPouKind::PROGRAM;
    input.pou_signatures.push_back(std::move(signature));

    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;

    /* Artifact rác phải bị loader từ chối, không được "chạy tạm". */
    std::vector<uint8_t> corrupted = bytes;
    corrupted[64] ^= 0xFFu;
    SimSession session;
    const char* code = nullptr;
    std::string detail;
    EXPECT_FALSE(session.prepare(corrupted, st_profile_generated::kProfileCode,
                                 st_profile_generated::kTargetAbi, &code, &detail));
    EXPECT_STREQ(code, kErrArtifact);
    EXPECT_FALSE(session.prepared());
}

} // namespace core::programming::sim
