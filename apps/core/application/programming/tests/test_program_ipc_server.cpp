#include "programming/program_ipc_server.hpp"

#include <array>
#include <atomic>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>
#include <sodium.h>

#include <sys/socket.h>
#include <unistd.h>

#include "programming/programming_cutover.hpp"
#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_test_key.hpp"

namespace core::programming {
namespace {

std::vector<uint8_t> bytes(std::size_t count, uint8_t start)
{
    std::vector<uint8_t> output(count);
    for (std::size_t index = 0; index < count; ++index) {
        output[index] = static_cast<uint8_t>(start + index);
    }
    return output;
}

ProgramRequest request(ProgramAction action = ProgramAction::Capabilities)
{
    ProgramRequest output;
    output.request_id = bytes(16, 0x00);
    output.operation_id = (action == ProgramAction::Stage) ? bytes(16, 0x10)
                                                           : std::vector<uint8_t>{};
    output.controller_id = "controller-1";
    output.actor_id = (action == ProgramAction::Stage) ? "admin-1" : "";
    output.deadline_mono_ns = 2'000'000;
    output.action = action;
    output.correlation_id = "correlation-id-0001";
    output.payload = {0x80};
    crypto_hash_sha256(output.payload_hash.data(), output.payload.data(), output.payload.size());
    return output;
}

PeerCredentials allowed_peer()
{
    return PeerCredentials{true, static_cast<uint32_t>(::getuid()),
                           static_cast<uint32_t>(::getgid()),
                           static_cast<int32_t>(::getpid())};
}

std::vector<uint8_t> load_hex(const std::string& name)
{
    std::ifstream input(std::string(PROGRAMMING_IPC_CONTRACT_DIR) + "/golden/" + name);
    std::stringstream buffer;
    buffer << input.rdbuf();
    std::string hex;
    for (const char ch : buffer.str()) {
        if ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') ||
            (ch >= 'A' && ch <= 'F')) {
            hex.push_back(ch);
        }
    }
    if (hex.size() % 2 != 0) return {};
    std::vector<uint8_t> output;
    output.reserve(hex.size() / 2);
    for (std::size_t index = 0; index < hex.size(); index += 2) {
        output.push_back(static_cast<uint8_t>(std::stoul(hex.substr(index, 2), nullptr, 16)));
    }
    return output;
}

std::vector<uint8_t> uuid_bytes(const std::string& value)
{
    std::vector<uint8_t> output;
    int high = -1;
    for (const char ch : value) {
        if (ch == '-') continue;
        const int nibble = ch >= '0' && ch <= '9' ? ch - '0' : ch - 'a' + 10;
        if (high < 0) high = nibble;
        else { output.push_back(static_cast<uint8_t>((high << 4) | nibble)); high = -1; }
    }
    return output;
}

std::vector<uint8_t> signed_artifact()
{
    const char* source = "PROGRAM p\nVAR x : DINT; END_VAR\nx := 7;\nEND_PROGRAM\n";
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic));
    std::vector<uint8_t> artifact;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &artifact, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&artifact, st_test_secret_key()));
    return artifact;
}

TEST(ProgramIpcCodec, RequestRoundTrip)
{
    const ProgramRequest original = request(ProgramAction::Stage);
    ProgramCodecError error = ProgramCodecError::None;
    const std::vector<uint8_t> frame = EncodeRequestFrame(original, &error);
    ASSERT_EQ(error, ProgramCodecError::None);
    ASSERT_FALSE(frame.empty());
    ProgramRequest decoded;
    ASSERT_TRUE(DecodeRequestFrame(frame, &decoded, &error));
    EXPECT_EQ(decoded.action, ProgramAction::Stage);
    EXPECT_EQ(decoded.request_id, original.request_id);
    EXPECT_EQ(decoded.operation_id, original.operation_id);
    EXPECT_EQ(decoded.payload, original.payload);
    EXPECT_EQ(decoded.payload_hash, original.payload_hash);
    EXPECT_EQ(EncodeRequestFrame(decoded, &error), frame);
}

TEST(ProgramIpcCodec, ResponseRoundTrip)
{
    ProgramResponse original;
    original.request_id = bytes(16, 0x00);
    original.correlation_id = "correlation-id-0001";
    original.result = ProgramResult::Unavailable;
    original.has_detail_code = true;
    original.detail_code = "IPC-CONTRACT-ONLY";
    original.payload = {0x80};
    ProgramCodecError error = ProgramCodecError::None;
    const std::vector<uint8_t> frame = EncodeResponseFrame(original, &error);
    ProgramResponse decoded;
    ASSERT_TRUE(DecodeResponseFrame(frame, &decoded, &error));
    EXPECT_EQ(decoded.result, ProgramResult::Unavailable);
    EXPECT_TRUE(decoded.keeps_running);
    EXPECT_EQ(decoded.detail_code, "IPC-CONTRACT-ONLY");
    EXPECT_EQ(EncodeResponseFrame(decoded, &error), frame);
}

TEST(ProgramIpcCodec, PayloadRequiresPreferredShortestFloatEncoding)
{
    ProgramResponse response;
    response.request_id = bytes(16, 0x00);
    response.correlation_id = "correlation-id-0001";
    response.result = ProgramResult::Ok;
    ProgramCodecError error = ProgramCodecError::None;

    /* [1.25] bằng float16 là preferred/canonical theo RFC 8949 và encoder Go. */
    response.payload = {0x81, 0xf9, 0x3d, 0x00};
    EXPECT_FALSE(EncodeResponseFrame(response, &error).empty());
    EXPECT_EQ(error, ProgramCodecError::None);

    /* Cùng giá trị nhưng ép float32 phải bị từ chối; chính drift này từng làm
     * STATUS Core COMMITTED bị BE hiểu thành IPC unavailable. */
    response.payload = {0x81, 0xfa, 0x3f, 0xa0, 0x00, 0x00};
    EXPECT_TRUE(EncodeResponseFrame(response, &error).empty());
    EXPECT_EQ(error, ProgramCodecError::InvalidEnvelope);
}

TEST(ProgramIpcCodec, RejectsTruncatedOversizeAndUnknownMajor)
{
    ProgramCodecError error = ProgramCodecError::None;
    ProgramRequest decoded;
    EXPECT_FALSE(DecodeRequestFrame({0x01, 0x00, 0x00}, &decoded, &error));
    EXPECT_EQ(error, ProgramCodecError::FrameTruncated);

    std::vector<uint8_t> oversize(4, 0);
    const uint32_t length = static_cast<uint32_t>(PROGRAM_IPC_MAX_FRAME + 1);
    oversize[0] = static_cast<uint8_t>(length & 0xffU);
    oversize[1] = static_cast<uint8_t>((length >> 8U) & 0xffU);
    oversize[2] = static_cast<uint8_t>((length >> 16U) & 0xffU);
    oversize[3] = static_cast<uint8_t>((length >> 24U) & 0xffU);
    EXPECT_FALSE(DecodeRequestFrame(oversize, &decoded, &error));
    EXPECT_EQ(error, ProgramCodecError::FrameTooLarge);

    ProgramRequest unknown = request();
    unknown.protocol_major = 2;
    EXPECT_TRUE(EncodeRequestFrame(unknown, &error).empty());
    EXPECT_EQ(error, ProgramCodecError::UnsupportedMajor);

    ProgramRequest newer_minor = request();
    newer_minor.protocol_minor = PROGRAM_IPC_PROTOCOL_MINOR + 1U;
    EXPECT_TRUE(EncodeRequestFrame(newer_minor, &error).empty());
    EXPECT_EQ(error, ProgramCodecError::UnsupportedMinor);

    ProgramRequest noncanonical_payload = request();
    noncanonical_payload.payload = {0x9f, 0xff};
    crypto_hash_sha256(noncanonical_payload.payload_hash.data(),
                       noncanonical_payload.payload.data(),
                       noncanonical_payload.payload.size());
    EXPECT_TRUE(EncodeRequestFrame(noncanonical_payload, &error).empty());
    EXPECT_EQ(error, ProgramCodecError::InvalidEnvelope);

    std::vector<uint8_t> noncanonical_envelope = EncodeRequestFrame(request(), &error);
    ASSERT_FALSE(noncanonical_envelope.empty());
    noncanonical_envelope.insert(noncanonical_envelope.begin() + 5, 0x18);
    ++noncanonical_envelope[0];
    EXPECT_FALSE(DecodeRequestFrame(noncanonical_envelope, &decoded, &error));
    EXPECT_EQ(error, ProgramCodecError::InvalidEnvelope);
}

TEST(ProgramIpcServer, PeerDeadlineQueueAndNoMutationFailClosed)
{
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    ProgramCodecError error = ProgramCodecError::None;
    const std::vector<uint8_t> capabilities = EncodeRequestFrame(request(), &error);

    EXPECT_TRUE(server.HandleFrame(capabilities, PeerCredentials{}, 1).empty());

    ProgramRequest expired = request();
    expired.deadline_mono_ns = 5;
    const auto expired_response = server.HandleFrame(EncodeRequestFrame(expired, &error),
                                                      allowed_peer(), 5);
    ProgramResponse decoded;
    ASSERT_TRUE(DecodeResponseFrame(expired_response, &decoded, &error));
    EXPECT_EQ(decoded.result, ProgramResult::Rejected);
    EXPECT_EQ(decoded.detail_code, "IPC-DEADLINE");

    ProgramRequest queued = request();
    queued.request_id[0] = 0x42;
    server.set_queue_depth_for_test(PROGRAM_IPC_MAX_QUEUE);
    const auto busy_response = server.HandleFrame(EncodeRequestFrame(queued, &error),
                                                   allowed_peer(), 1);
    ASSERT_TRUE(DecodeResponseFrame(busy_response, &decoded, &error));
    EXPECT_EQ(decoded.result, ProgramResult::Busy);

    ProgramIpcServer mutation_server(static_cast<uint32_t>(::getuid()));
    const auto mutation_response = mutation_server.HandleFrame(
        EncodeRequestFrame(request(ProgramAction::Stage), &error), allowed_peer(), 1);
    ASSERT_TRUE(DecodeResponseFrame(mutation_response, &decoded, &error));
    EXPECT_EQ(decoded.result, ProgramResult::Unavailable);
    EXPECT_TRUE(decoded.keeps_running);
}

TEST(ProgramIpcServer, CapabilitiesAndDuplicateRequestAreDeterministic)
{
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    ProgramCodecError error = ProgramCodecError::None;
    ProgramRequest original = request();
    const std::vector<uint8_t> frame = EncodeRequestFrame(original, &error);
    const std::vector<uint8_t> first = server.HandleFrame(frame, allowed_peer(), 1);
    const std::vector<uint8_t> second = server.HandleFrame(frame, allowed_peer(), 1);
    EXPECT_EQ(first, second);
    EXPECT_EQ(server.cache_size_for_test(), 1U);

    ProgramResponse response;
    ASSERT_TRUE(DecodeResponseFrame(first, &response, &error));
    EXPECT_EQ(response.result, ProgramResult::Ok);
    EXPECT_FALSE(response.payload.empty());

    original.controller_id = "controller-2";
    const std::vector<uint8_t> conflict = server.HandleFrame(
        EncodeRequestFrame(original, &error), allowed_peer(), 1);
    ASSERT_TRUE(DecodeResponseFrame(conflict, &response, &error));
    EXPECT_EQ(response.result, ProgramResult::Rejected);
    EXPECT_EQ(response.detail_code, "IPC-REQUEST-ID-CONFLICT");
}

TEST(ProgramIpcServer, StatusPublishesTypedSignalTruthWithoutInventingZero)
{
    const std::filesystem::path root = std::filesystem::temp_directory_path() /
        ("mkddc-ipc-status-" + std::to_string(::getpid()));
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root / "staging");

    StScheduler scheduler(StSchedulerProfile::REV_A);
    StSignalBus signal_bus;
    scheduler.set_signal_bus(&signal_bus);
    StSignalDefinition definition;
    definition.name = "SUPPLY_TEMP";
    definition.publisher_program = "program-ahu";
    definition.type = StType::REAL;
    definition.freshness_ms = 5000;
    definition.stale_policy = StStalePolicy::HOLD_LAST;
    std::string error;
    ASSERT_TRUE(signal_bus.declare(definition, &error)) << error;

    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
                                                (root / "journal.bin").string(),
                                                (root / "staging").string());
    PriorityResolver resolver;
    coordinator.capture_priority_overrides(resolver);
    StValueTrace trace;
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()), &coordinator);
    server.set_value_trace(&trace, &scheduler);

    ProgramCodecError codec_error = ProgramCodecError::None;
    ProgramRequest status = request(ProgramAction::Status);
    ProgramResponse response;
    ASSERT_TRUE(DecodeResponseFrame(
        server.HandleFrame(EncodeRequestFrame(status, &codec_error), allowed_peer(), 1),
        &response, &codec_error));
    ASSERT_EQ(response.result, ProgramResult::Ok);
    const nlohmann::json unavailable = nlohmann::json::from_cbor(response.payload, true, true);
    ASSERT_EQ(unavailable.size(), 5u);
    ASSERT_EQ(unavailable[4].size(), 1u);
    EXPECT_EQ(unavailable[4][0][0], "SUPPLY_TEMP");
    EXPECT_TRUE(unavailable[4][0][3].is_null());
    EXPECT_FALSE(unavailable[4][0][4].get<bool>());
    EXPECT_EQ(unavailable[4][0][6], "UNAVAILABLE");
    EXPECT_EQ(signal_bus.unavailable_read_count(), 0u)
        << "poll status không được tính như consumer runtime";

    StCell value{};
    value.r = 21.5f;
    ASSERT_TRUE(signal_bus.publish(0, value, 100, "program-ahu"));
    signal_bus.commit_at_boundary();
    status.request_id[0] = 0x77;
    crypto_hash_sha256(status.payload_hash.data(), status.payload.data(), status.payload.size());
    ASSERT_TRUE(DecodeResponseFrame(
        server.HandleFrame(EncodeRequestFrame(status, &codec_error), allowed_peer(), 101),
        &response, &codec_error));
    const nlohmann::json live = nlohmann::json::from_cbor(response.payload, true, true);
    EXPECT_TRUE(live[4][0][4].get<bool>());
    EXPECT_FLOAT_EQ(live[4][0][3].get<float>(), 21.5f);
    EXPECT_EQ(live[4][0][5], "GOOD");
    EXPECT_EQ(live[4][0][6], "FRESH");

    std::filesystem::remove_all(root);
}

TEST(ProgramIpcServer, UnconfiguredDependencyFailsClosedWithStableDetail)
{
    /* T59-408 đã hiện thực `TRACE_START`, nên nó không còn là ví dụ "action chưa
     * hiện thực" — bảng handler nay 0 action ma (test `TestNoGhostActionsInContract`
     * ở lớp Go khoá điều đó). Bất biến CÒN LẠI vẫn phải đúng và vẫn cần một test:
     * khi phụ thuộc chưa được cấu hình, Core từ chối ổn định bằng một detail code
     * duy nhất, KHÔNG BAO GIỜ trả "ok" giả. Ở đây là `TRACE_START` không có bus
     * trace. */
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    ProgramCodecError error = ProgramCodecError::None;
    ProgramRequest original = request(ProgramAction::TraceStart);
    original.operation_id = bytes(16, 0x20);
    original.actor_id = "admin-1";

    const std::vector<uint8_t> frame = EncodeRequestFrame(original, &error);
    ASSERT_EQ(error, ProgramCodecError::None);
    const std::vector<uint8_t> encoded = server.HandleFrame(frame, allowed_peer(), 1);

    ProgramResponse response;
    ASSERT_TRUE(DecodeResponseFrame(encoded, &response, &error));
    EXPECT_NE(response.result, ProgramResult::Ok);
    /* Điều bắt buộc là KHÔNG BAO GIỜ trả Ok khi phụ thuộc chưa sẵn sàng. */
    EXPECT_TRUE(response.detail_code == "IPC-ACTION-NOT-IMPLEMENTED" ||
                response.detail_code == "IPC-RUNTIME-NOT-CONFIGURED" ||
                response.detail_code == "IPC-TRACE-UNAVAILABLE")
        << "detail=" << response.detail_code;
    EXPECT_FALSE(response.detail_code.empty());

    /* Lặp lại cùng requestId phải cho đúng byte cũ — từ chối cũng phải xác định. */
    const std::vector<uint8_t> again = server.HandleFrame(frame, allowed_peer(), 1);
    EXPECT_EQ(encoded, again);
}

TEST(ProgramIpcServer, ReadsLinuxPeerCredentials)
{
    int sockets[2] = {-1, -1};
    ASSERT_EQ(::socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, sockets), 0);
    const PeerCredentials peer = ReadPeerCredentials(sockets[0]);
    EXPECT_TRUE(peer.valid);
    EXPECT_EQ(peer.uid, static_cast<uint32_t>(::getuid()));
    ::close(sockets[0]);
    ::close(sockets[1]);
}

TEST(ProgramIpcServer, DispatchesCanonicalStageAndActivateToRuntimeCoordinator)
{
    char root_template[] = "/tmp/mkddc-ipc-dispatch-XXXXXX";
    const char* created = ::mkdtemp(root_template);
    ASSERT_NE(created, nullptr);
    const std::filesystem::path root(created);
    const std::string operation = "11111111-1111-4111-8111-111111111111";
    const std::string revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const std::string plan(64, 'a');
    const std::filesystem::path staging = root / "staging" / operation;
    std::filesystem::create_directories(staging);
    const std::vector<uint8_t> artifact = signed_artifact();
    const std::filesystem::path locator = staging / "candidate.mkddcir";
    {
        std::ofstream output(locator, std::ios::binary);
        output.write(reinterpret_cast<const char*>(artifact.data()), artifact.size());
    }
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(), artifact.data(), artifact.size());

    StScheduler scheduler(StSchedulerProfile::REV_A);
    StTaskConfig task;
    task.id = "main";
    task.priority = 0;
    task.period_ms = 1000;
    task.budget_us = 199000;
    std::string runtime_error;
    ASSERT_TRUE(scheduler.add_task(task, &runtime_error));
    ASSERT_TRUE(scheduler.add_program("main", "program-main", 0, &runtime_error));
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(&scheduler, &cutover,
        (root / "journal.bin").string(), (root / "staging").string());
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()), &coordinator);
    ProgramCodecError codec_error = ProgramCodecError::None;

    ProgramRequest stage = request(ProgramAction::Stage);
    stage.request_id.assign(16, 0x21);
    stage.operation_id = uuid_bytes(operation);
    stage.payload = nlohmann::json::to_cbor(nlohmann::json::array({revision,
        "program-main", locator.string(), artifact.size(),
        nlohmann::json::binary(std::vector<uint8_t>(digest.begin(), digest.end())), plan}));
    crypto_hash_sha256(stage.payload_hash.data(), stage.payload.data(), stage.payload.size());
    ProgramResponse response;
    ASSERT_TRUE(DecodeResponseFrame(server.HandleFrame(EncodeRequestFrame(stage, &codec_error),
        allowed_peer(), 1), &response, &codec_error));
    EXPECT_EQ(response.result, ProgramResult::Staged);
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::STAGED);

    ProgramRequest activate = request(ProgramAction::Activate);
    activate.request_id.assign(16, 0x22);
    activate.operation_id = uuid_bytes(operation);
    activate.actor_id = "admin-1";
    activate.payload = nlohmann::json::to_cbor(nlohmann::json::array({nullptr,
        operation, "PROGRAM_ONLY", plan}));
    crypto_hash_sha256(activate.payload_hash.data(), activate.payload.data(), activate.payload.size());
    ASSERT_TRUE(DecodeResponseFrame(server.HandleFrame(EncodeRequestFrame(activate, &codec_error),
        allowed_peer(), 1), &response, &codec_error));
    EXPECT_EQ(response.result, ProgramResult::Accepted);
    EXPECT_EQ(coordinator.snapshot().state, LifecycleState::COMMIT_INTENT);
    std::filesystem::remove_all(root);
}

TEST(ProgramIpcGolden, CrossLanguageCorpus)
{
    ProgramCodecError error = ProgramCodecError::None;
    const auto request_frame = load_hex("request_capabilities.hex");
    ASSERT_FALSE(request_frame.empty());
    ProgramRequest decoded_request;
    ASSERT_TRUE(DecodeRequestFrame(request_frame, &decoded_request, &error));
    EXPECT_EQ(EncodeRequestFrame(decoded_request, &error), request_frame);

    const auto response_frame = load_hex("response_unavailable.hex");
    ASSERT_FALSE(response_frame.empty());
    ProgramResponse decoded_response;
    ASSERT_TRUE(DecodeResponseFrame(response_frame, &decoded_response, &error));
    EXPECT_EQ(EncodeResponseFrame(decoded_response, &error), response_frame);

    const auto unknown_major = load_hex("request_unknown_major.hex");
    ASSERT_FALSE(unknown_major.empty());
    EXPECT_FALSE(DecodeRequestFrame(unknown_major, &decoded_request, &error));
    EXPECT_EQ(error, ProgramCodecError::UnsupportedMajor);
}

} // namespace

/* T59-408 — ba action trace đi trọn: START lấy mẫu, READ đọc ra, STOP dừng. */
TEST(ProgramIpcServer, TraceStartReadStopRoundTrip)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_us = 199000;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_ahu", 0, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_ahu", signed_artifact(), &error)) << error;
    scheduler.apply_pending_activations_at_boundary();
    ASSERT_TRUE(scheduler.start("P_ahu", &error)) << error;

    StValueTrace trace;
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    server.set_value_trace(&trace, &scheduler);

    auto send = [&](ProgramAction action, const nlohmann::json& body, uint8_t seed) {
        ProgramRequest input = request(action);
        input.request_id = bytes(16, seed);
        input.operation_id = bytes(16, static_cast<uint8_t>(seed + 1));
        input.actor_id = "admin-1";
        input.payload = nlohmann::json::to_cbor(body);
        crypto_hash_sha256(input.payload_hash.data(), input.payload.data(), input.payload.size());
        ProgramCodecError codec_error = ProgramCodecError::None;
        const std::vector<uint8_t> frame = EncodeRequestFrame(input, &codec_error);
        EXPECT_EQ(codec_error, ProgramCodecError::None);
        const std::vector<uint8_t> reply = server.HandleFrame(frame, allowed_peer(), 1'000'000);
        EXPECT_FALSE(reply.empty());
        ProgramResponse response;
        EXPECT_TRUE(DecodeResponseFrame(reply, &response, &codec_error));
        return response;
    };

    const nlohmann::json start_body = nlohmann::json::array(
        {"session-1", 1000u, 10000u, nlohmann::json::array({nlohmann::json::array({"P_ahu", "x"})})});
    EXPECT_EQ(send(ProgramAction::TraceStart, start_body, 0x20).result, ProgramResult::Accepted);
    EXPECT_EQ(trace.status().state, StTraceState::RUNNING);

    /* Lấy mẫu ở boundary — đúng chỗ scan loop gọi, SAU khi Program chạy
     * (Issue #798: mẫu chỉ lấy ở boundary có release). */
    for (const uint64_t now : {1'000'000ull, 1'001'000'000ull}) {
        scheduler.on_base_step(now);
        trace.on_boundary(scheduler, now);
    }
    EXPECT_EQ(trace.sample_count(), 2u);

    const ProgramResponse read =
        send(ProgramAction::TraceRead, nlohmann::json::array({"session-1"}), 0x40);
    ASSERT_EQ(read.result, ProgramResult::Ok);
    const nlohmann::json body = nlohmann::json::from_cbor(read.payload, true, true);
    ASSERT_TRUE(body.is_array());
    ASSERT_EQ(body.size(), 3u);
    EXPECT_EQ(body[0].get<std::string>(), "RUNNING");
    EXPECT_EQ(body[1].get<uint32_t>(), 0u);
    ASSERT_EQ(body[2].size(), 2u);
    /* Mẫu mang cờ `valid` cho từng biến — "không đo được" khác "đo được 0". */
    EXPECT_TRUE(body[2][0][1][0][0].get<bool>());

    /* Đọc nhầm session của người khác bị từ chối. */
    EXPECT_EQ(send(ProgramAction::TraceRead, nlohmann::json::array({"session-khac"}), 0x60).result,
              ProgramResult::Rejected);

    EXPECT_EQ(send(ProgramAction::TraceStop, nlohmann::json::array({"session-1"}), 0x80).result,
              ProgramResult::Ok);
    EXPECT_EQ(trace.status().state, StTraceState::STOPPED);
}

/* F18 (EV-PROG-FBD-ST-MB-20260925) — `TRACE_READ` đọc TĂNG DẦN theo số thứ tự
 * tuyệt đối, mỗi phản hồi có trần. Bản cũ trả trọn ring: trên Foxlinx, Trace
 * 10 ms hỏng sau đúng 256 mẫu (2,56 s) vì bộ giải mã CBOR của web từ chối mảng
 * > 256 phần tử, rồi web rơi âm thầm về poll monitor với mốc thời gian sai. */
TEST(ProgramIpcServer, TraceReadIsIncrementalBoundedAndReportsOverwrittenGap)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    /* Issue #798: mẫu lấy ở boundary có release — Task 10 ms để mỗi boundary
     * 10 ms là một lần chạy. */
    task.period_ms = 10;
    task.budget_us = 1999;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_ahu", 0, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_ahu", signed_artifact(), &error)) << error;
    scheduler.apply_pending_activations_at_boundary();
    ASSERT_TRUE(scheduler.start("P_ahu", &error)) << error;

    StValueTrace trace;
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    server.set_value_trace(&trace, &scheduler);
    uint8_t seed = 0x10;
    auto send = [&](ProgramAction action, const nlohmann::json& body) {
        ProgramRequest input = request(action);
        input.request_id = bytes(16, seed++);
        input.operation_id = bytes(16, seed++);
        input.actor_id = "admin-1";
        input.payload = nlohmann::json::to_cbor(body);
        crypto_hash_sha256(input.payload_hash.data(), input.payload.data(), input.payload.size());
        ProgramCodecError codec_error = ProgramCodecError::None;
        const std::vector<uint8_t> frame = EncodeRequestFrame(input, &codec_error);
        EXPECT_EQ(codec_error, ProgramCodecError::None);
        const std::vector<uint8_t> reply = server.HandleFrame(frame, allowed_peer(), 1'000'000);
        ProgramResponse response;
        EXPECT_TRUE(DecodeResponseFrame(reply, &response, &codec_error));
        return response;
    };
    auto boundary = [&](uint64_t now) {
        scheduler.on_base_step(now);
        trace.on_boundary(scheduler, now);
    };
    auto body_of = [](const ProgramResponse& response) {
        return nlohmann::json::from_cbor(response.payload, true, true);
    };

    /* 10 ms × 10 050 mẫu = 100,5 s: vượt sức chứa 10 000 Ô (1 biến) ⇒ ring ghi đè
     * 50 mẫu cũ nhất. */
    const nlohmann::json start_body = nlohmann::json::array(
        {"session-f18", 10u, 600000u, nlohmann::json::array({nlohmann::json::array({"P_ahu", "x"})})});
    ASSERT_EQ(send(ProgramAction::TraceStart, start_body).result, ProgramResult::Accepted);
    ASSERT_EQ(trace.status().effective_sample_period_ms, 10u);
    const uint64_t t0 = 1'000'000;
    for (uint64_t k = 0; k < 300; ++k) boundary(t0 + k * 10'000'000ull);
    ASSERT_EQ(trace.sample_count(), 300u);
    EXPECT_EQ(trace.first_sequence(), 1u);
    EXPECT_EQ(trace.next_sequence(), 301u);

    /* Đường cũ `[sessionId]`: đúng 3 phần tử, tối đa 200 mẫu MỚI NHẤT — dưới
     * trần 256 phần tử của web, và mẫu cuối là mẫu vừa ghi. */
    const nlohmann::json legacy = body_of(send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18"})));
    ASSERT_EQ(legacy.size(), 3u);
    ASSERT_EQ(legacy[2].size(), 200u);
    EXPECT_EQ(legacy[2][199][0].get<uint64_t>(), t0 + 299ull * 10'000'000ull);

    /* Đọc tăng dần: lô 1..200, rồi 201..300, rồi rỗng. */
    const nlohmann::json first = body_of(send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18", 1u})));
    ASSERT_EQ(first.size(), 5u);
    ASSERT_EQ(first[2].size(), 200u);
    EXPECT_EQ(first[3].get<uint64_t>(), 1u);
    EXPECT_EQ(first[4].get<uint64_t>(), 301u);
    EXPECT_EQ(first[2][0][0].get<uint64_t>(), t0);
    const nlohmann::json second = body_of(send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18", 201u})));
    ASSERT_EQ(second[2].size(), 100u);
    EXPECT_EQ(second[3].get<uint64_t>(), 201u);
    EXPECT_EQ(second[2][0][0].get<uint64_t>(), t0 + 200ull * 10'000'000ull);
    const nlohmann::json empty = body_of(send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18", 301u})));
    EXPECT_EQ(empty[2].size(), 0u);
    EXPECT_EQ(empty[3].get<uint64_t>(), 301u);

    /* Ghi tiếp tới 10 050 mẫu: 50 mẫu đầu bị ghi đè. Người đọc dừng ở 301 vẫn
     * đọc tiếp đúng từ 301; người đọc còn ở 1 thấy `firstSequence = 51` —
     * khoảng hụt 50 chính là số mẫu nó đã mất. */
    for (uint64_t k = 300; k < 10050; ++k) boundary(t0 + k * 10'000'000ull);
    ASSERT_EQ(trace.sample_count(), 10000u);
    EXPECT_EQ(trace.first_sequence(), 51u);
    const nlohmann::json resumed = body_of(send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18", 301u})));
    EXPECT_EQ(resumed[3].get<uint64_t>(), 301u);
    EXPECT_EQ(resumed[2][0][0].get<uint64_t>(), t0 + 300ull * 10'000'000ull);
    const nlohmann::json late = body_of(send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18", 1u})));
    EXPECT_EQ(late[3].get<uint64_t>(), 51u);
    EXPECT_EQ(late[4].get<uint64_t>(), 10051u);

    /* Phản hồi luôn dưới trần payload IPC, kể cả khi ring đầy. */
    const ProgramResponse full = send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18", 1u}));
    EXPECT_LT(full.payload.size(), 32u * 1024u);

    /* `fromSequence = 0` không có nghĩa: từ chối thay vì đoán. */
    EXPECT_EQ(send(ProgramAction::TraceRead, nlohmann::json::array({"session-f18", 0u})).result,
              ProgramResult::Rejected);
}

/* Issue #798 — BE mới xin dạng ô 2 bằng phần tử thứ ba của payload và nhận
 * `[valid, bits, reason, releaseSeq, readbackState, readbackBits,
 * readbackAgeMs]`; BE cũ không gửi nên vẫn nhận `[valid, bits]`. Dạng lạ bị từ
 * chối thay vì rơi về dạng cũ. */
TEST(ProgramIpcServer, TraceReadCellFormatTwoCarriesReleaseAndReadback)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_us = 199000;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_ahu", 0, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_ahu", signed_artifact(), &error)) << error;
    scheduler.apply_pending_activations_at_boundary();
    ASSERT_TRUE(scheduler.start("P_ahu", &error)) << error;

    StValueTrace trace;
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    server.set_value_trace(&trace, &scheduler);
    uint8_t seed = 0x30;
    auto send = [&](ProgramAction action, const nlohmann::json& body) {
        ProgramRequest input = request(action);
        input.request_id = bytes(16, seed++);
        input.operation_id = bytes(16, seed++);
        input.actor_id = "admin-1";
        input.payload = nlohmann::json::to_cbor(body);
        crypto_hash_sha256(input.payload_hash.data(), input.payload.data(), input.payload.size());
        ProgramCodecError codec_error = ProgramCodecError::None;
        const std::vector<uint8_t> frame = EncodeRequestFrame(input, &codec_error);
        EXPECT_EQ(codec_error, ProgramCodecError::None);
        const std::vector<uint8_t> reply = server.HandleFrame(frame, allowed_peer(), 1'000'000);
        ProgramResponse response;
        EXPECT_TRUE(DecodeResponseFrame(reply, &response, &codec_error));
        return response;
    };
    const nlohmann::json start_body = nlohmann::json::array(
        {"session-798", 1000u, 10000u,
         nlohmann::json::array({nlohmann::json::array({"P_ahu", "x"}),
                                nlohmann::json::array({"P_ahu", "khong_co"})})});
    ASSERT_EQ(send(ProgramAction::TraceStart, start_body).result, ProgramResult::Accepted);
    for (uint64_t k = 0; k < 3; ++k) {
        const uint64_t now = 1'000'000ull + k * 1'000'000'000ull;
        scheduler.on_base_step(now);
        trace.on_boundary(scheduler, now);
    }
    ASSERT_EQ(trace.sample_count(), 3u);

    const ProgramResponse legacy =
        send(ProgramAction::TraceRead, nlohmann::json::array({"session-798", 1u}));
    const nlohmann::json legacy_body = nlohmann::json::from_cbor(legacy.payload, true, true);
    ASSERT_EQ(legacy_body[2][0][1][0].size(), 2u) << "BE cũ phải nhận đúng dạng nó giải mã được";

    const ProgramResponse read =
        send(ProgramAction::TraceRead, nlohmann::json::array({"session-798", 1u, 2u}));
    ASSERT_EQ(read.result, ProgramResult::Ok);
    const nlohmann::json body = nlohmann::json::from_cbor(read.payload, true, true);
    ASSERT_EQ(body.size(), 5u);
    ASSERT_EQ(body[2].size(), 3u);
    for (std::size_t index = 0; index < 3; ++index) {
        const nlohmann::json& cells = body[2][index][1];
        ASSERT_EQ(cells[0].size(), 7u);
        EXPECT_TRUE(cells[0][0].get<bool>());
        EXPECT_EQ(cells[0][2].get<uint64_t>(), 0u) << "OK";
        EXPECT_EQ(cells[0][3].get<uint64_t>(), index + 1) << "số release liên tiếp";
        EXPECT_EQ(cells[0][4].get<uint64_t>(), 0u) << "x không gắn điểm đầu ra: NONE";
        EXPECT_FALSE(cells[1][0].get<bool>());
        EXPECT_EQ(cells[1][2].get<uint64_t>(), 1u) << "UNRESOLVED";
        EXPECT_EQ(cells[1][3].get<uint64_t>(), 0u);
    }
    EXPECT_EQ(send(ProgramAction::TraceRead, nlohmann::json::array({"session-798", 1u, 3u})).result,
              ProgramResult::Rejected);
    EXPECT_EQ(send(ProgramAction::TraceRead, nlohmann::json::array({"session-798", 1u, "2"})).result,
              ProgramResult::Rejected);
}

/* X19 / F05 — `TRACE_READ` chạy trên luồng `prog-ipc` trong khi luồng quét ghi
 * trace mỗi base step. Trạng thái, số thứ tự và mẫu phải đến từ CÙNG một lần
 * giữ khoá: nếu đọc rời từng hàm, ring (đầy, đang ghi đè) có thể dịch một mẫu
 * giữa lúc lấy `firstSequence` và lúc đọc `samples[0]`, và một số thứ tự sẽ
 * được gán cho hai mốc thời gian khác nhau ở hai lần đọc. Test đọc chồng lấn
 * liên tục trong lúc luồng "quét" ghi, rồi kiểm mỗi số thứ tự chỉ ứng với ĐÚNG
 * một mốc và mốc tăng dần trong mỗi lô. */
TEST(ProgramIpcServer, TraceReadSequencesStayBoundToTheirSamplesUnderConcurrentWrites)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    /* Issue #798: trace lấy mẫu ở boundary có release, nên luồng "quét" phải
     * chạy Program ở MỖI boundary (Task 10 ms) như ScanLoop thật. */
    task.period_ms = 10;
    task.budget_us = 1999;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_ahu", 0, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_ahu", signed_artifact(), &error)) << error;
    scheduler.apply_pending_activations_at_boundary();
    ASSERT_TRUE(scheduler.start("P_ahu", &error)) << error;

    StValueTrace trace;
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    server.set_value_trace(&trace, &scheduler);
    uint32_t seed = 0;
    auto send = [&](ProgramAction action, const nlohmann::json& body) {
        ProgramRequest input = request(action);
        input.request_id = bytes(16, static_cast<uint8_t>(seed));
        input.request_id[15] = static_cast<uint8_t>(seed >> 8);
        input.request_id[14] = static_cast<uint8_t>(seed >> 16);
        ++seed;
        input.operation_id = input.request_id;
        input.operation_id[0] ^= 0x5a;
        input.actor_id = "admin-1";
        input.payload = nlohmann::json::to_cbor(body);
        crypto_hash_sha256(input.payload_hash.data(), input.payload.data(), input.payload.size());
        ProgramCodecError codec_error = ProgramCodecError::None;
        const std::vector<uint8_t> frame = EncodeRequestFrame(input, &codec_error);
        EXPECT_EQ(codec_error, ProgramCodecError::None);
        const std::vector<uint8_t> reply = server.HandleFrame(frame, allowed_peer(), 1'000'000);
        ProgramResponse response;
        EXPECT_TRUE(DecodeResponseFrame(reply, &response, &codec_error));
        return response;
    };

    /* 32 biến ⇒ ring chỉ 312 mẫu, nên luồng "quét" ghi đè liên tục. */
    nlohmann::json variables = nlohmann::json::array();
    for (int index = 0; index < 32; ++index) variables.push_back(nlohmann::json::array({"P_ahu", "x"}));
    ASSERT_EQ(send(ProgramAction::TraceStart,
                   nlohmann::json::array({"session-x19", 10u, 600000u, variables}))
                  .result,
              ProgramResult::Accepted);

    /* Luồng "quét" ghi lại SỰ THẬT: mẫu thứ s (đánh từ 1) mang mốc nào. Một
     * boundary bị bỏ lượt vì khoá không tạo mẫu, nên chỉ ghi khi bộ đếm bỏ lượt
     * không đổi. */
    constexpr std::size_t kMaxBoundaries = 40000;
    std::vector<uint64_t> truth;
    truth.reserve(kMaxBoundaries);
    std::atomic<bool> stop{false};
    std::thread scan([&] {
        uint32_t contended_before = trace.status().contended_boundary_count;
        for (uint64_t k = 0; k < kMaxBoundaries && !stop.load(std::memory_order_acquire); ++k) {
            const uint64_t now = 1'000'000ull + k * 10'000'000ull;
            scheduler.on_base_step(now);
            trace.on_boundary(scheduler, now);
            const StTraceStatus status = trace.status();
            if (status.state != StTraceState::RUNNING) break;
            if (status.contended_boundary_count == contended_before) truth.push_back(now);
            contended_before = status.contended_boundary_count;
        }
    });

    std::vector<std::pair<uint64_t, uint64_t>> observed;
    uint64_t from = 1;
    for (int read = 0; read < 300; ++read) {
        const ProgramResponse response =
            send(ProgramAction::TraceRead, nlohmann::json::array({"session-x19", from}));
        ASSERT_EQ(response.result, ProgramResult::Ok);
        const nlohmann::json body = nlohmann::json::from_cbor(response.payload, true, true);
        ASSERT_EQ(body.size(), 5u);
        const uint64_t first = body[3].get<uint64_t>();
        for (std::size_t index = 0; index < body[2].size(); ++index)
            observed.emplace_back(first + index, body[2][index][0].get<uint64_t>());
        /* Đọc chồng lấn: lùi lại một đoạn so với chỗ Core đang ghi. */
        const uint64_t next = body[4].get<uint64_t>();
        from = next > 40 ? next - 40 : 1;
    }
    stop.store(true, std::memory_order_release);
    scan.join();

    ASSERT_FALSE(observed.empty());
    uint64_t mismatched = 0;
    for (const auto& [sequence, timestamp] : observed) {
        ASSERT_GE(sequence, 1u);
        ASSERT_LE(sequence, truth.size());
        if (truth[sequence - 1] != timestamp) ++mismatched;
    }
    EXPECT_EQ(mismatched, 0u) << "số thứ tự trả về không khớp mẫu thật (" << mismatched << "/"
                              << observed.size() << ")";
}

/* Không có bus trace: ba action trả UNAVAILABLE tường minh. Một `TRACE_START`
 * "thành công" mà không có nơi lấy mẫu là lời hứa suông. */
TEST(ProgramIpcServer, TraceActionsWithoutBusAreUnavailableNotSilentlyOk)
{
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    ProgramRequest input = request(ProgramAction::TraceRead);
    input.actor_id = "admin-1";
    input.payload = nlohmann::json::to_cbor(nlohmann::json::array({"session-1"}));
    crypto_hash_sha256(input.payload_hash.data(), input.payload.data(), input.payload.size());
    ProgramCodecError codec_error = ProgramCodecError::None;
    const std::vector<uint8_t> frame = EncodeRequestFrame(input, &codec_error);
    ASSERT_EQ(codec_error, ProgramCodecError::None);
    const std::vector<uint8_t> reply = server.HandleFrame(frame, allowed_peer(), 1'000'000);
    ProgramResponse response;
    ASSERT_TRUE(DecodeResponseFrame(reply, &response, &codec_error));
    EXPECT_EQ(response.result, ProgramResult::Unavailable);
    EXPECT_EQ(response.detail_code, "IPC-TRACE-UNAVAILABLE");
}

} // namespace core::programming
