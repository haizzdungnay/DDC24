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
#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"

#ifndef ST_COMPILE_CLI_PATH
#error "ST_COMPILE_CLI_PATH phải được CMake truyền vào"
#endif
#ifndef ST_PACKAGE_CLI_PATH
#error "ST_PACKAGE_CLI_PATH phải được CMake truyền vào"
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

std::string temporary_directory(const char* pattern)
{
    std::vector<char> path(pattern, pattern + std::strlen(pattern) + 1);
    if (::mkdtemp(path.data()) == nullptr) {
        ADD_FAILURE() << "mkdtemp: " << std::strerror(errno);
        return {};
    }
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

nlohmann::json make_fbd_signal_publish_graph()
{
    const char* input_node = "30000000-0000-4000-8000-000000000001";
    const char* publish_node = "30000000-0000-4000-8000-000000000002";
    const char* output_port = "40000000-0000-4000-8000-000000000001";
    const char* input_port = "40000000-0000-4000-8000-000000000002";
    return {
        {"$schema", "../../fbd_v1.schema.json"}, {"schemaVersion", 1},
        {"profileId", "revA-1t-1-5-30"},
        {"graphId", "10000000-0000-4000-8000-000000000059"},
        {"name", "FBD_SIGNAL_PRODUCER"},
        {"networks", nlohmann::json::array({{
            {"id", "20000000-0000-4000-8000-000000000059"},
            {"name", "MAIN"}, {"order", 0},
            {"nodes", nlohmann::json::array({
                {{"id", input_node}, {"kind", "INPUT"}, {"typeRef", "REAL"},
                 {"executionOrder", 0}, {"parameters", {{"variable", "VALUE"}}},
                 {"ports", nlohmann::json::array({{
                     {"id", output_port}, {"name", "OUT"}, {"direction", "OUTPUT"},
                     {"dataType", "REAL"}, {"unit", nullptr}, {"order", 0}}})}},
                {{"id", publish_node}, {"kind", "SIGNAL_PUBLISH"},
                 {"typeRef", "SIGNAL_PUBLISH"}, {"executionOrder", 1},
                 {"parameters", {{"signal", "SHARED_TEMP"}}},
                 {"ports", nlohmann::json::array({{
                     {"id", input_port}, {"name", "IN"}, {"direction", "INPUT"},
                     {"dataType", "REAL"}, {"unit", nullptr}, {"order", 0}}})}}
            })},
            {"wires", nlohmann::json::array({{
                {"id", "50000000-0000-4000-8000-000000000059"},
                {"from", {{"nodeId", input_node}, {"portId", output_port}}},
                {"to", {{"nodeId", publish_node}, {"portId", input_port}}}
            }})}
        }})}
    };
}

CliRun run_executable(const char* executable,
                      const std::vector<std::string>& arguments)
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
        std::vector<char*> argv{const_cast<char*>(executable)};
        for (const std::string& argument : arguments)
            argv.push_back(const_cast<char*>(argument.c_str()));
        argv.push_back(nullptr);
        ::execv(executable, argv.data());
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

CliRun run_cli(const std::vector<std::string>& arguments)
{
    return run_executable(ST_COMPILE_CLI_PATH, arguments);
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

struct LinkedPouCliFiles {
    std::string directory;
    std::string root_path;
    std::string helper_path;
    std::string manifest_path;
    std::string lock_path;
    std::string artifact_path;
    std::string pou_table_path;
    std::string package_path;
    std::string helper_source;
    nlohmann::json lock;

    bool create()
    {
        directory = temporary_directory("/tmp/mkddc-cli-pou-XXXXXX");
        if (directory.empty()) return false;
        root_path = directory + "/main.st";
        helper_path = directory + "/project_scale.st";
        manifest_path = directory + "/pou-manifest.json";
        lock_path = directory + "/library-lock.json";
        artifact_path = directory + "/main.mkir";
        pou_table_path = directory + "/pou-table.json";
        package_path = directory + "/bundle.mkpkg";
        helper_source =
            "FUNCTION ProjectScale : REAL\n"
            "VAR_INPUT x : REAL; END_VAR\n"
            "ProjectScale := x + 5.0;\n"
            "END_FUNCTION\n";
        const std::string root_source =
            "PROGRAM Main\n"
            "VAR_OUTPUT y : REAL; END_VAR\n"
            "y := ProjectScale(4.0);\n"
            "END_PROGRAM\n";
        lock = {
            {"schemaVersion", 1},
            {"systemVersion", "system-rev-a"},
            {"projectRevisionId", "project-revision-42"},
            {"entries", nlohmann::json::array({
                {{"entryId", "project-entry-scale"},
                 {"name", "ProjectScale"},
                 {"kind", "FUNCTION"},
                 {"version", "2.0.0"},
                 {"origin", "PROJECT"}},
            })},
        };
        return write_text(root_path, root_source) &&
               write_text(helper_path, helper_source) &&
               write_text(lock_path, lock.dump());
    }

    nlohmann::json manifest(bool declare_root_dependency,
                            const std::string& root_version = "2.0.0") const
    {
        nlohmann::json document = {
            {"schemaVersion", 1},
            {"pous", nlohmann::json::array({
                {{"name", "ProjectScale"},
                 {"kind", "FUNCTION"},
                 {"language", "ST"},
                 {"path", "project_scale.st"},
                 {"contentSha256", core::compute_source_sha256(helper_source)},
                 {"origin", "PROJECT"},
                 {"fromLibrary", true},
                 {"entryId", "project-entry-scale"},
                 {"version", "2.0.0"},
                 {"requiresLibrary", nlohmann::json::array()}},
            })},
        };
        if (declare_root_dependency) {
            document["rootRequiresLibrary"] = nlohmann::json::array({
                {{"name", "ProjectScale"},
                 {"version", root_version},
                 {"origin", "PROJECT"}},
            });
        }
        return document;
    }

    ~LinkedPouCliFiles()
    {
        for (const std::string* path : {&package_path, &pou_table_path, &artifact_path,
                                        &lock_path, &manifest_path, &helper_path,
                                        &root_path}) {
            if (!path->empty()) ::unlink(path->c_str());
        }
        if (!directory.empty()) ::rmdir(directory.c_str());
    }
};

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

TEST(StCompileCli, PackagerReportsMachineReadableProfileVersion)
{
    const CliRun run = run_executable(ST_PACKAGE_CLI_PATH, {"--version"});
    ASSERT_EQ(run.exit_code, 0);
    EXPECT_NE(run.stdout_text.find("packager_version=2"), std::string::npos);
    EXPECT_NE(run.stdout_text.find("profile_id=revA-1t-1-5-30"),
              std::string::npos);
    EXPECT_NE(run.stdout_text.find("profile_sha256="), std::string::npos);
    EXPECT_NE(run.stdout_text.find("artifact_schema=2"), std::string::npos);
    EXPECT_NE(run.stdout_text.find("target_abi=3841"), std::string::npos);
}

TEST(StCompileCli, ProjectLibraryCompilerOutputPackagesAndLoadsWithoutRebuildingSignature)
{
    LinkedPouCliFiles files;
    ASSERT_TRUE(files.create());
    ASSERT_TRUE(write_text(files.manifest_path, files.manifest(true).dump()));

    const CliRun compiled = run_cli_signed(
        {"--source", files.root_path, "--source-id", "project-library-main",
         "--pou-manifest", files.manifest_path, "--library-lock", files.lock_path,
         "--out", files.artifact_path, "--sandbox"});
    ASSERT_EQ(compiled.exit_code, 0) << compiled.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(compiled.stdout_text);
    ASSERT_TRUE(result.at("ok"));
    ASSERT_EQ(result.at("linkedPous").size(), 1U);
    const nlohmann::json& linked = result.at("linkedPous")[0];
    EXPECT_EQ(linked.at("name"), "ProjectScale");
    EXPECT_EQ(linked.at("kind"), "FUNCTION");
    EXPECT_TRUE(linked.at("fromLibrary"));
    EXPECT_EQ(linked.at("origin"), "PROJECT");
    EXPECT_EQ(linked.at("libraryEntryId"), "project-entry-scale");
    EXPECT_EQ(linked.at("version"), "2.0.0");
    EXPECT_EQ(linked.at("inputNames"), nlohmann::json::array({"x"}));
    EXPECT_EQ(linked.at("inputTypes"), nlohmann::json::array({"REAL"}));
    EXPECT_TRUE(linked.at("hasReturnType"));
    EXPECT_EQ(linked.at("returnType"), "REAL");
    EXPECT_EQ(linked.at("contentSha256").get<std::string>().size(), 64U);
    EXPECT_EQ(linked.at("bodySha256").get<std::string>().size(), 64U);
    EXPECT_GT(linked.at("instructionCount").get<uint32_t>(), 0U);

    const nlohmann::json table = {
        {"schemaVersion", 1},
        {"pous", result.at("linkedPous")},
    };
    ASSERT_TRUE(write_text(files.pou_table_path, table.dump()));
    const CliRun packaged = run_executable(
        ST_PACKAGE_CLI_PATH,
        {"--out", files.package_path, "--program",
         "Main=" + files.artifact_path, "--pou-table", files.pou_table_path,
         "--library-lock", files.lock_path});
    ASSERT_EQ(packaged.exit_code, 0) << packaged.stdout_text;

    const std::vector<uint8_t> package = read_bytes(files.package_path);
    ASSERT_FALSE(package.empty());
    core::StPackageView view;
    const char* error_code = nullptr;
    ASSERT_TRUE(core::LoadPackageV2(package.data(), package.size(),
                                    core::st_profile_generated::kProfileCode,
                                    core::st_profile_generated::kTargetAbi,
                                    &view, &error_code))
        << (error_code != nullptr ? error_code : "");
    ASSERT_EQ(view.pou_signatures.size(), 2U);
    const core::StPouSignature& decoded = view.pou_signatures[1];
    EXPECT_EQ(decoded.name, "ProjectScale");
    EXPECT_TRUE(decoded.from_library);
    EXPECT_EQ(decoded.library_origin, "PROJECT");
    EXPECT_EQ(decoded.library_entry_id, "project-entry-scale");
    EXPECT_EQ(decoded.version, "2.0.0");
    EXPECT_EQ(decoded.input_names, std::vector<std::string>({"x"}));
    EXPECT_EQ(decoded.input_types, std::vector<core::StType>({core::StType::REAL}));
    EXPECT_TRUE(decoded.has_return_type);
    EXPECT_EQ(decoded.return_type, core::StType::REAL);
    EXPECT_EQ(decoded.instruction_count,
              linked.at("instructionCount").get<uint32_t>());
    EXPECT_EQ(view.library_project_revision_id, "project-revision-42");
}

TEST(StCompileCli, RootLibraryDependencyIsMandatoryAndVersionExact)
{
    LinkedPouCliFiles files;
    ASSERT_TRUE(files.create());

    ASSERT_TRUE(write_text(files.manifest_path, files.manifest(false).dump()));
    const CliRun undeclared = run_cli_signed(
        {"--source", files.root_path, "--source-id", "undeclared-library",
         "--pou-manifest", files.manifest_path, "--library-lock", files.lock_path});
    ASSERT_EQ(undeclared.exit_code, 1) << undeclared.stdout_text;
    const nlohmann::json undeclared_result =
        nlohmann::json::parse(undeclared.stdout_text);
    EXPECT_EQ(undeclared_result.at("diagnostics")[0].at("code"), "ST-LIB-001");
    EXPECT_NE(undeclared_result.at("diagnostics")[0]
                  .at("message").get<std::string>().find("requiresLibrary"),
              std::string::npos);

    ASSERT_TRUE(write_text(files.manifest_path,
                           files.manifest(true, "9.9.9").dump()));
    const CliRun drift = run_cli_signed(
        {"--source", files.root_path, "--source-id", "wrong-library-version",
         "--pou-manifest", files.manifest_path, "--library-lock", files.lock_path});
    ASSERT_EQ(drift.exit_code, 1) << drift.stdout_text;
    const nlohmann::json drift_result = nlohmann::json::parse(drift.stdout_text);
    EXPECT_EQ(drift_result.at("diagnostics")[0].at("code"), "ST-LIB-002");
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

TEST(StCompileCli, SignalManifestProducesActualPublishReference)
{
    const std::string source_path = temporary_path("/tmp/mkddc-cli-signal-src-XXXXXX");
    const std::string signal_path = temporary_path("/tmp/mkddc-cli-signal-manifest-XXXXXX");
    const std::string artifact_path = temporary_path("/tmp/mkddc-cli-signal-artifact-XXXXXX");
    ASSERT_FALSE(source_path.empty());
    ASSERT_FALSE(signal_path.empty());
    ASSERT_FALSE(artifact_path.empty());
    ASSERT_TRUE(write_text(source_path,
                           "PROGRAM Producer\nVAR value : REAL; END_VAR\n"
                           "value := 24.5;\n"
                           "SIGNAL_PUBLISH(SHARED_TEMP, value);\nEND_PROGRAM\n"));
    ASSERT_TRUE(write_text(signal_path, nlohmann::json({
        {"schemaVersion", 1},
        {"programId", "P_pub"},
        {"signals", nlohmann::json::array({
            {{"name", "SHARED_TEMP"}, {"type", "REAL"},
             {"publisherProgramId", "P_pub"}},
        })},
    }).dump()));

    const CliRun run = run_cli_signed({"--source", source_path,
                                       "--source-id", "signal-producer",
                                       "--signal-manifest", signal_path,
                                       "--out", artifact_path});
    ::unlink(source_path.c_str());
    ::unlink(signal_path.c_str());
    const std::vector<uint8_t> artifact = read_bytes(artifact_path);
    ::unlink(artifact_path.c_str());

    ASSERT_EQ(run.exit_code, 0) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    ASSERT_EQ(result.at("signalRefs").size(), 1u);
    EXPECT_EQ(result.at("signalRefs")[0].at("name"), "SHARED_TEMP");
    EXPECT_EQ(result.at("signalRefs")[0].at("type"), "REAL");
    EXPECT_FALSE(result.at("signalRefs")[0].at("read"));
    EXPECT_TRUE(result.at("signalRefs")[0].at("publish"));
    EXPECT_EQ(artifact.size(), result.at("artifactBytes").get<std::size_t>());
    EXPECT_GT(artifact.size(), 0u);
}

TEST(StCompileCli, FbdSignalManifestProducesActualPublishReference)
{
    const std::string source_path = temporary_path("/tmp/mkddc-cli-fbd-signal-src-XXXXXX");
    const std::string signal_path = temporary_path("/tmp/mkddc-cli-fbd-signal-manifest-XXXXXX");
    const std::string artifact_path = temporary_path("/tmp/mkddc-cli-fbd-signal-artifact-XXXXXX");
    ASSERT_FALSE(source_path.empty());
    ASSERT_FALSE(signal_path.empty());
    ASSERT_FALSE(artifact_path.empty());
    ASSERT_TRUE(write_text(source_path, make_fbd_signal_publish_graph().dump()));
    ASSERT_TRUE(write_text(signal_path, nlohmann::json({
        {"schemaVersion", 1},
        {"programId", "P_pub"},
        {"signals", nlohmann::json::array({
            {{"name", "SHARED_TEMP"}, {"type", "REAL"},
             {"publisherProgramId", "P_pub"}},
        })},
    }).dump()));

    const CliRun run = run_cli_signed({"--source", source_path,
                                       "--language", "FBD",
                                       "--source-id", "fbd-signal-producer",
                                       "--signal-manifest", signal_path,
                                       "--out", artifact_path});
    ::unlink(source_path.c_str());
    ::unlink(signal_path.c_str());
    const std::vector<uint8_t> artifact = read_bytes(artifact_path);
    ::unlink(artifact_path.c_str());

    ASSERT_EQ(run.exit_code, 0) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(result.at("language"), "FBD");
    ASSERT_EQ(result.at("signalRefs").size(), 1U);
    EXPECT_EQ(result.at("signalRefs")[0].at("name"), "SHARED_TEMP");
    EXPECT_EQ(result.at("signalRefs")[0].at("type"), "REAL");
    EXPECT_FALSE(result.at("signalRefs")[0].at("read"));
    EXPECT_TRUE(result.at("signalRefs")[0].at("publish"));
    EXPECT_EQ(artifact.size(), result.at("artifactBytes").get<std::size_t>());
    EXPECT_GT(artifact.size(), 0U);
}

TEST(StCompileCli, FbdSignalManifestKeepsStableWrongPublisherDiagnostic)
{
    const std::string source_path = temporary_path("/tmp/mkddc-cli-fbd-signal-wrong-src-XXXXXX");
    const std::string signal_path = temporary_path("/tmp/mkddc-cli-fbd-signal-wrong-manifest-XXXXXX");
    ASSERT_FALSE(source_path.empty());
    ASSERT_FALSE(signal_path.empty());
    ASSERT_TRUE(write_text(source_path, make_fbd_signal_publish_graph().dump()));
    ASSERT_TRUE(write_text(signal_path, nlohmann::json({
        {"schemaVersion", 1},
        {"programId", "P_other"},
        {"signals", nlohmann::json::array({
            {{"name", "SHARED_TEMP"}, {"type", "REAL"},
             {"publisherProgramId", "P_pub"}},
        })},
    }).dump()));

    const CliRun run = run_cli_signed({"--source", source_path,
                                       "--language", "FBD",
                                       "--source-id", "fbd-signal-wrong-publisher",
                                       "--signal-manifest", signal_path});
    ::unlink(source_path.c_str());
    ::unlink(signal_path.c_str());
    ASSERT_EQ(run.exit_code, 1) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(result.at("diagnostics")[0].at("code"), "ST-SIG-001");
    EXPECT_TRUE(result.at("artifact").is_null());
    EXPECT_TRUE(result.at("signalRefs").empty());
}

TEST(StCompileCli, SignalManifestRejectsPublishFromWrongProgram)
{
    const std::string source_path = temporary_path("/tmp/mkddc-cli-signal-wrong-src-XXXXXX");
    const std::string signal_path = temporary_path("/tmp/mkddc-cli-signal-wrong-manifest-XXXXXX");
    ASSERT_FALSE(source_path.empty());
    ASSERT_FALSE(signal_path.empty());
    ASSERT_TRUE(write_text(source_path,
                           "PROGRAM Wrong\nSIGNAL_PUBLISH(SHARED_TEMP, 1.0);\n"
                           "END_PROGRAM\n"));
    ASSERT_TRUE(write_text(signal_path, nlohmann::json({
        {"schemaVersion", 1},
        {"programId", "P_other"},
        {"signals", nlohmann::json::array({
            {{"name", "SHARED_TEMP"}, {"type", "REAL"},
             {"publisherProgramId", "P_pub"}},
        })},
    }).dump()));

    const CliRun run = run_cli_signed({"--source", source_path,
                                       "--source-id", "signal-wrong-publisher",
                                       "--signal-manifest", signal_path});
    ::unlink(source_path.c_str());
    ::unlink(signal_path.c_str());
    ASSERT_EQ(run.exit_code, 1) << run.stdout_text;
    const nlohmann::json result = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(result.at("diagnostics")[0].at("code"), "ST-SIG-001");
    EXPECT_TRUE(result.at("artifact").is_null());
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
