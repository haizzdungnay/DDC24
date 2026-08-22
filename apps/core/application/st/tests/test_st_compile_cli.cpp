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

/* T59-607 — profile nay đòi `SIGNATURE_REQUIRED`, nên MỌI lệnh biên dịch phải
 * kèm khoá. Khoá được sinh một lần cho cả bộ test từ seed cố định: test cần
 * tất định, và khoá này không bao giờ rời thư mục tạm của tiến trình test. */
const std::string& shared_signing_key_path()
{
    static const std::string path = [] {
        std::array<unsigned char, crypto_sign_SEEDBYTES> seed{};
        for (std::size_t index = 0; index < seed.size(); ++index)
            seed[index] = static_cast<unsigned char>(0xA0u + index);
        std::array<unsigned char, crypto_sign_PUBLICKEYBYTES> public_key{};
        std::array<unsigned char, crypto_sign_SECRETKEYBYTES> secret_key{};
        if (crypto_sign_seed_keypair(public_key.data(), secret_key.data(), seed.data()) != 0)
            return std::string();
        static constexpr char kHex[] = "0123456789abcdef";
        std::string key_hex;
        key_hex.reserve(secret_key.size() * 2u);
        for (const unsigned char byte : secret_key) {
            key_hex.push_back(kHex[byte >> 4u]);
            key_hex.push_back(kHex[byte & 0x0Fu]);
        }
        const std::string key_file = temporary_path("/tmp/mkddc-cli-shared-key-XXXXXX");
        if (key_file.empty() || !write_text(key_file, key_hex)) return std::string();
        return key_file;
    }();
    return path;
}

/* Chạy CLI với khoá ký mặc định. Test nào cố ý kiểm đường KHÔNG khoá thì gọi
 * thẳng `run_cli`. */
CliRun run_cli_signed(std::vector<std::string> arguments)
{
    arguments.push_back("--key");
    arguments.push_back(shared_signing_key_path());
    return run_cli(arguments);
}

} // namespace

TEST(StCompileCli, EmitsDeterministicStructuredTextArtifactAndManifest)
{
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const CliRun first = run_cli_signed({"--source", source, "--source-id", "cli-st"});
    const CliRun second = run_cli_signed({"--source", source, "--source-id", "cli-st"});
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
    EXPECT_NE(run.stdout_text.find("compiler_version=fwsom-st-1.2.0"), std::string::npos);
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

    const CliRun run = run_cli_signed({"--source", source, "--language", "FBD", "--source-id",
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
    const CliRun run = run_cli_signed({"--source", source, "--source-id", "sandbox-st",
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
    const CliRun run = run_cli_signed({"--source", source, "--source-id", "../../secret"});
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
    const CliRun run = run_cli_signed({"--source", source, "--language", "LD"});
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
    const CliRun run = run_cli_signed({"--source", source_path, "--source-id", "bad-st"});
    ::unlink(source_path.c_str());
    ASSERT_EQ(run.exit_code, 1);
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_FALSE(result.at("ok"));
    EXPECT_EQ(result.at("diagnostics")[0].at("sourceId"), "bad-st");
    EXPECT_GT(result.at("diagnostics")[0].at("line").get<uint32_t>(), 0u);
    EXPECT_GT(result.at("diagnostics")[0].at("column").get<uint32_t>(), 0u);
}

TEST(StCompileCli, IoMapInBindsVariablesIntoArtifactBindingSection)
{
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const std::string io_map_path = temporary_path("/tmp/mkddc-cli-iomap-XXXXXX");
    ASSERT_FALSE(io_map_path.empty());
    const nlohmann::json io_map = {
        {"entries", nlohmann::json::array({
            {{"variable", "SupplyTemp"}, {"direction", "input"}, {"pointId", "UI-01"},
             {"type", "REAL"}, {"category", "LOCAL"}},
            {{"variable", "FanEnable"}, {"direction", "output"}, {"pointId", "DO-01"},
             {"type", "BOOL"}, {"category", "LOCAL"}},
            {{"variable", "FanSpeed"}, {"direction", "output"}, {"pointId", "AO-01"},
             {"type", "REAL"}, {"category", "LOCAL"}},
        })},
    };
    ASSERT_TRUE(write_text(io_map_path, io_map.dump()));
    const CliRun run = run_cli_signed({"--source", source, "--source-id", "cli-io-map",
                                "--io-map-in", io_map_path});
    ::unlink(io_map_path.c_str());
    ASSERT_EQ(run.exit_code, 0) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_TRUE(result.at("ok"));
    EXPECT_EQ(result.at("ioBindingCount"), 3u);
}

TEST(StCompileCli, IoMapInRejectsBindingBoolOutputToReadOnlyPoint)
{
    /* Tái hiện đúng bug thật F-PROG-ASBUILT-013 phát hiện qua Mapping tab:
     * AlarmHigh (BOOL, VAR_OUTPUT) bind vào UI-09 — UI là ngõ vào vật lý
     * read-only, không phải lỗi giả định. */
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const std::string io_map_path = temporary_path("/tmp/mkddc-cli-iomap-bad-XXXXXX");
    ASSERT_FALSE(io_map_path.empty());
    const nlohmann::json io_map = {
        {"entries", nlohmann::json::array({
            {{"variable", "AlarmHigh"}, {"direction", "output"}, {"pointId", "UI-09"},
             {"type", "BOOL"}, {"category", "LOCAL"}, {"writable", false}},
        })},
    };
    ASSERT_TRUE(write_text(io_map_path, io_map.dump()));
    const CliRun run = run_cli_signed({"--source", source, "--source-id", "cli-io-map-bad",
                                "--io-map-in", io_map_path});
    ::unlink(io_map_path.c_str());
    ASSERT_EQ(run.exit_code, 1);
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_FALSE(result.at("ok"));
    EXPECT_EQ(result.at("diagnostics")[0].at("code"), "ST-IOMAP-002");
}

TEST(StCompileCli, IoMapInRejectsVirtualPointCategoryForOutputDirection)
{
    /* F-PROG-ASBUILT-014: chiều READ (VAR_INPUT) đã được nối tới Core
     * av_[]/bv_[]/msv_[] (xem StResolveIoBindings.AcceptsVpCategoryForInputDirection),
     * nhưng chiều WRITE (VAR_OUTPUT) vẫn chưa có đường đồng bộ ngược Core->Web
     * API nên còn bị từ chối tường minh — xem F-PROG-ASBUILT-016. */
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const std::string io_map_path = temporary_path("/tmp/mkddc-cli-iomap-vp-XXXXXX");
    ASSERT_FALSE(io_map_path.empty());
    const nlohmann::json io_map = {
        {"entries", nlohmann::json::array({
            {{"variable", "FanEnable"}, {"direction", "output"}, {"pointId", "BV-01"},
             {"type", "BOOL"}, {"category", "VP"}},
        })},
    };
    ASSERT_TRUE(write_text(io_map_path, io_map.dump()));
    const CliRun run = run_cli_signed({"--source", source, "--source-id", "cli-io-map-vp",
                                "--io-map-in", io_map_path});
    ::unlink(io_map_path.c_str());
    ASSERT_EQ(run.exit_code, 1);
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_FALSE(result.at("ok"));
    EXPECT_EQ(result.at("diagnostics")[0].at("code"), "ST-IOMAP-008");
}

/* T59-607 — thiếu khoá phải hỏng NGAY và nói đúng lý do.
 *
 * Trước bản vá, biên dịch không khoá vẫn chạy hết rồi hỏng ở bước dựng manifest
 * với `IR-E-007: artifact is not signed` — một câu đúng về hiện tượng nhưng chỉ
 * sai chỗ: người đọc đi tìm lỗi trong artifact, trong khi thứ thiếu là cấu hình
 * khoá của worker. */
TEST(StCompileCli, MissingSigningKeyFailsWithConfigurationError)
{
    const std::string source = std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st";
    const CliRun run = run_cli({"--source", source, "--source-id", "no-key-st"});
    ASSERT_NE(run.exit_code, 0) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_FALSE(result.at("ok"));
    EXPECT_EQ(result.at("diagnostics")[0].at("code"), "ST-CLI-KEY-REQUIRED");
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
    EXPECT_EQ(result.at("integrityMode"), "SIGNED");
}
