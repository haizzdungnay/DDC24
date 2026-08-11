#include "programming/program_ipc_server.hpp"

#include <array>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>
#include <sodium.h>

#include <sys/socket.h>
#include <unistd.h>

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
} // namespace core::programming
