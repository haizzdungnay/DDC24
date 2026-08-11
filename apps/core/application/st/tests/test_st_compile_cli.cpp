#include <gtest/gtest.h>

#include <array>
#include <cerrno>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include <sys/wait.h>
#include <unistd.h>

#include <nlohmann/json.hpp>
#include <sodium.h>

#include "st/st_artifact.hpp"

#ifndef ST_COMPILE_CLI_PATH
#error "ST_COMPILE_CLI_PATH phải được CMake truyền vào"
#endif

namespace {

struct CliRun {
    int exit_code = -1;
    std::string stdout_text;
};

std::string temporary_path(const char* pattern)
{
    std::vector<char> path(pattern, pattern + std::strlen(pattern) + 1);
    const int fd = ::mkstemp(path.data());
    if (fd < 0) {
        ADD_FAILURE() << "mkstemp: " << std::strerror(errno);
        return {};
    }
    ::close(fd);
    return path.data();
}

std::vector<uint8_t> read_bytes(const std::string& path)
{
    std::ifstream input(path, std::ios::binary);
    return std::vector<uint8_t>(std::istreambuf_iterator<char>(input),
                                std::istreambuf_iterator<char>());
}

std::string read_text(const std::string& path)
{
    std::ifstream input(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(input),
                       std::istreambuf_iterator<char>());
}

bool write_text(const std::string& path, const std::string& text)
{
    std::ofstream output(path, std::ios::binary);
    output << text;
    return static_cast<bool>(output);
}

CliRun run_cli(const std::vector<std::string>& arguments)
{
    int out_pipe[2];
    if (::pipe(out_pipe) != 0) {
        ADD_FAILURE() << "pipe() failed";
        return {};
    }
    const pid_t pid = ::fork();
    if (pid < 0) {
        ADD_FAILURE() << "fork() failed";
        return {};
    }
    if (pid == 0) {
        ::close(out_pipe[0]);
        ::dup2(out_pipe[1], STDOUT_FILENO);
        ::close(out_pipe[1]);
        std::vector<char*> argv{const_cast<char*>(ST_COMPILE_CLI_PATH)};
        for (const std::string& argument : arguments)
            argv.push_back(const_cast<char*>(argument.c_str()));
        argv.push_back(nullptr);
        ::execv(ST_COMPILE_CLI_PATH, argv.data());
        std::_Exit(127);
    }
    ::close(out_pipe[1]);
    CliRun result;
    char buffer[4096];
    ssize_t count;
    while ((count = ::read(out_pipe[0], buffer, sizeof(buffer))) > 0)
        result.stdout_text.append(buffer, static_cast<std::size_t>(count));
    ::close(out_pipe[0]);
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    result.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    return result;
}

} // namespace

TEST(StCompileCli, EmitsDeterministicStructuredTextArtifactAndManifest)
{
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const CliRun first = run_cli({"--source", source, "--source-id", "cli-st"});
    const CliRun second = run_cli({"--source", source, "--source-id", "cli-st"});
    ASSERT_EQ(first.exit_code, 0);
    ASSERT_EQ(second.exit_code, 0);
    EXPECT_EQ(first.stdout_text, second.stdout_text);
    const nlohmann::json result = nlohmann::json::parse(first.stdout_text);
    EXPECT_TRUE(result.at("ok"));
    EXPECT_EQ(result.at("language"), "ST");
    EXPECT_EQ(result.at("sourceId"), "cli-st");
    EXPECT_EQ(result.at("artifactFileSha256").get<std::string>().size(), 64u);
    EXPECT_EQ(result.at("artifactIntegritySha256").get<std::string>().size(), 64u);
    EXPECT_EQ(result.at("sourceSha256").get<std::string>().size(), 64u);
    EXPECT_EQ(result.at("buildKeySha256").get<std::string>().size(), 64u);
    EXPECT_EQ(result.at("manifest").at("manifestVersion"), 1);
    EXPECT_FALSE(result.at("manifest").at("sourceMap").at("entries").empty());
}

TEST(StCompileCli, ReportsCompilerProfileVersionForDeployEvidence)
{
    const CliRun run = run_cli({"--version"});
    ASSERT_EQ(run.exit_code, 0);
    EXPECT_NE(run.stdout_text.find("compiler_version=fwsom-st-1.1.0"), std::string::npos);
    EXPECT_NE(run.stdout_text.find("profile_id=revA-1t-1-5-30"), std::string::npos);
    EXPECT_NE(run.stdout_text.find("artifact_schema=1"), std::string::npos);
    EXPECT_NE(run.stdout_text.find("target_abi=3841"), std::string::npos);
}

TEST(StCompileCli, CompilesFbdAndWritesByteExactOutputs)
{
    const std::string source = std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) +
                               "/fbd/golden/ahu_fan_enable.json";
    const std::string artifact_path = temporary_path("/tmp/mkddc-cli-artifact-XXXXXX");
    const std::string manifest_path = temporary_path("/tmp/mkddc-cli-manifest-XXXXXX");
    ASSERT_FALSE(artifact_path.empty());
    ASSERT_FALSE(manifest_path.empty());
    ::unlink(artifact_path.c_str());
    ::unlink(manifest_path.c_str());

    const CliRun run = run_cli({"--source", source, "--language", "FBD", "--source-id",
                                "cli-fbd", "--out", artifact_path, "--manifest-out",
                                manifest_path});
    ASSERT_EQ(run.exit_code, 0) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(result.at("language"), "FBD");
    const std::vector<uint8_t> artifact = read_bytes(artifact_path);
    const std::string manifest_text = read_text(manifest_path);
    ::unlink(artifact_path.c_str());
    ::unlink(manifest_path.c_str());
    ASSERT_FALSE(artifact.empty());
    ASSERT_FALSE(manifest_text.empty());
    EXPECT_EQ(core::compute_file_sha256(artifact.data(), artifact.size()),
              result.at("artifactFileSha256"));
    const nlohmann::json manifest = nlohmann::json::parse(manifest_text);
    EXPECT_EQ(manifest, result.at("manifest"));
    ASSERT_FALSE(manifest.at("sourceMap").at("entries").empty());
    EXPECT_TRUE(manifest.at("sourceMap").at("entries")[0].at("fbdLocation").is_object());
}

TEST(StCompileCli, WorkerSandboxCompilesWithoutOpeningAdditionalResources)
{
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const std::string artifact_path = temporary_path("/tmp/mkddc-cli-sandbox-artifact-XXXXXX");
    const std::string manifest_path = temporary_path("/tmp/mkddc-cli-sandbox-manifest-XXXXXX");
    ASSERT_FALSE(artifact_path.empty());
    ASSERT_FALSE(manifest_path.empty());
    ::unlink(artifact_path.c_str());
    ::unlink(manifest_path.c_str());
    const CliRun run = run_cli({"--source", source, "--source-id", "sandbox-st",
                                "--out", artifact_path, "--manifest-out", manifest_path,
                                "--sandbox"});
    ASSERT_EQ(run.exit_code, 0) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_TRUE(result.at("ok"));
    EXPECT_FALSE(read_bytes(artifact_path).empty());
    EXPECT_FALSE(read_text(manifest_path).empty());
    ::unlink(artifact_path.c_str());
    ::unlink(manifest_path.c_str());
}

TEST(StCompileCli, RejectsHostPathSourceIdWithoutPublishingArtifact)
{
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const CliRun run = run_cli({"--source", source, "--source-id", "../../secret"});
    EXPECT_EQ(run.exit_code, 1);
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_FALSE(result.at("ok"));
    EXPECT_EQ(result.at("diagnostics")[0].at("code"), "COMP-MANIFEST-REQ-001");
    EXPECT_TRUE(result.at("artifact").is_null());
    EXPECT_TRUE(result.at("manifest").is_null());
}

TEST(StCompileCli, RejectsUnknownLanguageAtArgumentBoundary)
{
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const CliRun run = run_cli({"--source", source, "--language", "LD"});
    EXPECT_EQ(run.exit_code, 2);
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(result.at("diagnostics")[0].at("code"), "ST-CLI-ARGS");
}

TEST(StCompileCli, PreservesStructuredTextDiagnosticLocation)
{
    const std::string source_path = temporary_path("/tmp/mkddc-cli-invalid-XXXXXX");
    ASSERT_FALSE(source_path.empty());
    ASSERT_TRUE(write_text(source_path,
                           "PROGRAM BAD\nVAR_OUTPUT X : BOOL; END_VAR\nX := ;\nEND_PROGRAM\n"));
    const CliRun run = run_cli({"--source", source_path, "--source-id", "bad-st"});
    ::unlink(source_path.c_str());
    ASSERT_EQ(run.exit_code, 1);
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_FALSE(result.at("ok"));
    EXPECT_EQ(result.at("diagnostics")[0].at("sourceId"), "bad-st");
    EXPECT_GT(result.at("diagnostics")[0].at("line").get<uint32_t>(), 0u);
    EXPECT_GT(result.at("diagnostics")[0].at("column").get<uint32_t>(), 0u);
}

TEST(StCompileCli, SignedCompatibilityPathUsesPublicHalfOfProvidedKey)
{
    std::array<unsigned char, crypto_sign_SEEDBYTES> seed{};
    for (std::size_t index = 0; index < seed.size(); ++index)
        seed[index] = static_cast<unsigned char>(index + 1u);
    std::array<unsigned char, crypto_sign_PUBLICKEYBYTES> public_key{};
    std::array<unsigned char, crypto_sign_SECRETKEYBYTES> secret_key{};
    ASSERT_EQ(crypto_sign_seed_keypair(public_key.data(), secret_key.data(), seed.data()), 0);

    static constexpr char kHex[] = "0123456789abcdef";
    std::string key_hex;
    key_hex.reserve(secret_key.size() * 2u);
    for (const unsigned char byte : secret_key) {
        key_hex.push_back(kHex[byte >> 4u]);
        key_hex.push_back(kHex[byte & 0x0Fu]);
    }
    const std::string key_path = temporary_path("/tmp/mkddc-cli-key-XXXXXX");
    ASSERT_FALSE(key_path.empty());
    ASSERT_TRUE(write_text(key_path, key_hex));

    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const CliRun run = run_cli({"--source", source, "--source-id", "signed-st",
                                "--key", key_path});
    ::unlink(key_path.c_str());
    ASSERT_EQ(run.exit_code, 0) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_TRUE(result.at("signaturePresent"));
    EXPECT_TRUE(result.at("manifest").at("artifact").at("signaturePresent"));
    EXPECT_EQ(result.at("integrityMode"), "HASH_ONLY");
}
