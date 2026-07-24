/**
 * @file  test_st_validate_cli.cpp
 * @brief FW SOM IEC programming foundation, item 2: validate gateway CLI —
 *        test end-to-end bằng cách fork+execv binary THẬT đã build
 *        (`mkddc-st-validate`, path do CMake truyền qua ST_VALIDATE_CLI_PATH),
 *        đúng contract "fixed executable + fixed argv, source luôn qua file
 *        path" — không dùng shell/popen để không lẫn shell-eval vào chính
 *        test đang verify "không shell-eval".
 */
#include <gtest/gtest.h>

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <sys/wait.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

#ifndef ST_VALIDATE_CLI_PATH
#error "ST_VALIDATE_CLI_PATH phải được CMake truyền vào (target_compile_definitions)"
#endif

namespace {

struct CliRun {
    int exit_code = -1;
    std::string stdout_text;
};

std::string write_temp_source(const std::string& content)
{
    char path[] = "/tmp/mkddc-st-validate-test-XXXXXX";
    const int fd = ::mkstemp(path);
    if (fd < 0) { ADD_FAILURE() << "mkstemp: " << std::strerror(errno); return ""; }
    ssize_t written = 0;
    while (written < static_cast<ssize_t>(content.size())) {
        const ssize_t n = ::write(fd, content.data() + written, content.size() - written);
        if (n <= 0) { ADD_FAILURE() << "write temp source failed"; break; }
        written += n;
    }
    ::close(fd);
    return path;
}

/* fork+execv nhị phân THẬT, argv cố định [path_binary, "--source", path_file]
 * — đúng contract CLI mô tả trong st_validate_main.cpp. */
CliRun run_cli(const std::string& source_path)
{
    int out_pipe[2];
    if (::pipe(out_pipe) != 0) { ADD_FAILURE() << "pipe() failed"; return {}; }

    const pid_t pid = ::fork();
    if (pid < 0) { ADD_FAILURE() << "fork() failed"; return {}; }

    if (pid == 0) {
        ::close(out_pipe[0]);
        ::dup2(out_pipe[1], STDOUT_FILENO);
        ::close(out_pipe[1]);
        std::vector<char*> argv = {
            const_cast<char*>(ST_VALIDATE_CLI_PATH),
            const_cast<char*>("--source"),
            const_cast<char*>(source_path.c_str()),
            nullptr,
        };
        ::execv(ST_VALIDATE_CLI_PATH, argv.data());
        std::fprintf(stderr, "execv failed: %s\n", std::strerror(errno));
        std::_Exit(127);
    }

    ::close(out_pipe[1]);
    CliRun run;
    char buf[4096];
    ssize_t n;
    while ((n = ::read(out_pipe[0], buf, sizeof(buf))) > 0)
        run.stdout_text.append(buf, static_cast<std::size_t>(n));
    ::close(out_pipe[0]);

    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    run.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    return run;
}

const char* kHvacCtrl = R"ST(
PROGRAM HVAC_CTRL
VAR_INPUT
    SupplyTemp : REAL;
    Setpoint : REAL;
END_VAR
VAR_OUTPUT
    FanEnable : BOOL;
END_VAR
IF SupplyTemp > Setpoint THEN
    FanEnable := TRUE;
ELSE
    FanEnable := FALSE;
END_IF;
END_PROGRAM
)ST";

} // namespace

TEST(StValidateCli, ValidSourceExitsZeroWithOkTrueAndSymbols)
{
    const std::string path = write_temp_source(kHvacCtrl);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    EXPECT_EQ(run.exit_code, 0);
    ASSERT_NO_THROW({
        const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
        EXPECT_TRUE(j.at("ok").get<bool>());
        EXPECT_TRUE(j.at("diagnostics").empty());
        ASSERT_EQ(j.at("symbols").size(), 3u);
        EXPECT_EQ(j.at("symbols")[0].at("name"), "SupplyTemp");
        EXPECT_EQ(j.at("symbols")[0].at("direction"), "input");
        EXPECT_EQ(j.at("symbols")[0].at("type"), "REAL");
        EXPECT_EQ(j.at("symbols")[2].at("name"), "FanEnable");
        EXPECT_EQ(j.at("symbols")[2].at("direction"), "output");
        EXPECT_EQ(j.at("symbols")[2].at("type"), "BOOL");
        EXPECT_FALSE(j.at("artifactHash").get<std::string>().empty());
        EXPECT_FALSE(j.at("compilerVersion").get<std::string>().empty());
        EXPECT_GT(j.at("irSchemaVersion").get<int>(), 0);
    });
}

TEST(StValidateCli, InvalidSyntaxExitsOneWithDiagnosticPosition)
{
    const std::string path = write_temp_source("PROGRAM P VAR_INPUT A : REAL; END_VAR");
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    EXPECT_EQ(run.exit_code, 1);
    ASSERT_NO_THROW({
        const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
        EXPECT_FALSE(j.at("ok").get<bool>());
        ASSERT_EQ(j.at("diagnostics").size(), 1u);
        EXPECT_EQ(j.at("diagnostics")[0].at("severity"), "error");
        EXPECT_FALSE(j.at("diagnostics")[0].at("code").get<std::string>().empty());
        EXPECT_GT(j.at("diagnostics")[0].at("line").get<int>(), 0);
    });
}

TEST(StValidateCli, TypeMismatchExitsOneWithSemCode)
{
    const char* src = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
Out := A;
END_PROGRAM
)ST";
    const std::string path = write_temp_source(src);
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    EXPECT_EQ(run.exit_code, 1);
    ASSERT_NO_THROW({
        const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
        EXPECT_FALSE(j.at("ok").get<bool>());
        EXPECT_EQ(j.at("diagnostics")[0].at("code"), "ST-SEM-002");
    });
}

TEST(StValidateCli, MissingArgsExitsTwoWithCliArgsCode)
{
    int out_pipe[2];
    ASSERT_EQ(::pipe(out_pipe), 0);
    const pid_t pid = ::fork();
    ASSERT_GE(pid, 0);
    if (pid == 0) {
        ::close(out_pipe[0]);
        ::dup2(out_pipe[1], STDOUT_FILENO);
        ::close(out_pipe[1]);
        std::vector<char*> argv = {const_cast<char*>(ST_VALIDATE_CLI_PATH), nullptr};
        ::execv(ST_VALIDATE_CLI_PATH, argv.data());
        std::_Exit(127);
    }
    ::close(out_pipe[1]);
    std::string out;
    char buf[1024];
    ssize_t n;
    while ((n = ::read(out_pipe[0], buf, sizeof(buf))) > 0) out.append(buf, static_cast<std::size_t>(n));
    ::close(out_pipe[0]);
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}

    EXPECT_EQ(WIFEXITED(status) ? WEXITSTATUS(status) : -1, 2);
    ASSERT_NO_THROW({
        const nlohmann::json j = nlohmann::json::parse(out);
        EXPECT_FALSE(j.at("ok").get<bool>());
        EXPECT_EQ(j.at("diagnostics")[0].at("code"), "ST-CLI-ARGS");
    });
}

TEST(StValidateCli, NonexistentFileExitsTwoWithCliIoCode)
{
    const CliRun run = run_cli("/tmp/mkddc-st-validate-does-not-exist-12345.st");
    EXPECT_EQ(run.exit_code, 2);
    ASSERT_NO_THROW({
        const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
        EXPECT_FALSE(j.at("ok").get<bool>());
        EXPECT_EQ(j.at("diagnostics")[0].at("code"), "ST-CLI-IO");
    });
}

TEST(StValidateCli, SameSourceProducesSameArtifactHashAcrossRuns)
{
    const std::string path = write_temp_source(kHvacCtrl);
    const CliRun run1 = run_cli(path);
    const CliRun run2 = run_cli(path);
    ::unlink(path.c_str());

    const nlohmann::json j1 = nlohmann::json::parse(run1.stdout_text);
    const nlohmann::json j2 = nlohmann::json::parse(run2.stdout_text);
    EXPECT_EQ(j1.at("artifactHash"), j2.at("artifactHash"))
        << "2 lần build cùng input phải ra cùng hash (deterministic)";
}
