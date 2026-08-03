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

/* ---- M-01 / PARSER_SAFETY_GATE: input đối kháng qua CLI thật ----
 * Yêu cầu tuyệt đối: dù input độc hại tới đâu, CLI phải kết thúc bằng exit
 * code hợp lệ (0/1/2) và ĐÚNG MỘT dòng JSON parse được. Không segfault
 * (exit 139), không abort (134), không stdout rỗng. */

namespace {

std::string repeat_str(const std::string& unit, std::size_t n)
{
    std::string s;
    s.reserve(unit.size() * n);
    for (std::size_t i = 0; i < n; i++) s += unit;
    return s;
}

std::string wrap_program(const std::string& body)
{
    return "PROGRAM p\nVAR_INPUT a : REAL; END_VAR\nVAR_OUTPUT b : REAL; END_VAR\n" +
           body + "END_PROGRAM\n";
}

/* Kiểm bất biến chung cho MỌI input đối kháng. */
void expect_controlled_rejection(const CliRun& run, const char* what)
{
    EXPECT_NE(run.exit_code, 139) << what << ": segfault (SIGSEGV)";
    EXPECT_NE(run.exit_code, 134) << what << ": abort (SIGABRT)";
    EXPECT_NE(run.exit_code, -1) << what << ": bị kill bởi signal";
    EXPECT_TRUE(run.exit_code == 0 || run.exit_code == 1 || run.exit_code == 2)
        << what << ": exit code ngoài hợp đồng = " << run.exit_code;
    ASSERT_FALSE(run.stdout_text.empty()) << what << ": stdout RỖNG";
    /* Đúng 1 dòng: chính xác một '\n' và nằm ở cuối. */
    EXPECT_EQ(run.stdout_text.find('\n'), run.stdout_text.size() - 1)
        << what << ": stdout không phải đúng 1 dòng";
    ASSERT_NO_THROW({
        const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
        EXPECT_TRUE(j.contains("ok"));
        EXPECT_TRUE(j.contains("diagnostics"));
        EXPECT_TRUE(j.contains("symbols"));
        EXPECT_TRUE(j.contains("artifactHash"));
        EXPECT_TRUE(j.contains("compilerVersion"));
        EXPECT_TRUE(j.contains("irSchemaVersion"));
    }) << what << ": stdout không parse được thành JSON";
}

} // namespace

TEST(StValidateCli, DeepParen12000ExitsOneWithJsonNotSegfault)
{
    const std::string src =
        wrap_program("b := " + repeat_str("(", 12000) + "a" + repeat_str(")", 12000) + ";\n");
    const std::string path = write_temp_source(src);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "12000 ngoặc lồng");
    EXPECT_EQ(run.exit_code, 1) << "lỗi ST thật -> exit 1";
    const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
    EXPECT_FALSE(j.at("ok").get<bool>());
    const std::string code = j.at("diagnostics")[0].at("code");
    EXPECT_TRUE(code == "ST-SYN-002" || code == "ST-LIM-002") << "actual: " << code;
}

TEST(StValidateCli, DeepParen20000ExitsCleanlyWithJson)
{
    const std::string src =
        wrap_program("b := " + repeat_str("(", 20000) + "a" + repeat_str(")", 20000) + ";\n");
    const std::string path = write_temp_source(src);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "20000 ngoặc lồng");
}

TEST(StValidateCli, DeepNestedIfExitsOneWithNestingCode)
{
    const std::string src = wrap_program(repeat_str("IF a > 1.0 THEN\n", 500) + "b := 1.0;\n" +
                                         repeat_str("END_IF;\n", 500));
    const std::string path = write_temp_source(src);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "IF lồng sâu");
    EXPECT_EQ(run.exit_code, 1);
    const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(j.at("diagnostics")[0].at("code"), "ST-SYN-002");
}

TEST(StValidateCli, SourceOverSizeLimitExitsTwoWithJson)
{
    std::string src = wrap_program("b := a;\n");
    src += std::string(70u * 1024u, ' ');   /* > kMaxSourceBytes = 64 KiB */
    const std::string path = write_temp_source(src);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "source vượt giới hạn");
    EXPECT_EQ(run.exit_code, 2) << "quá lớn = lỗi phía caller -> exit 2";
    const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(j.at("diagnostics")[0].at("code"), "ST-CLI-TOOLARGE");
}

TEST(StValidateCli, BinaryGarbageExitsOneWithJson)
{
    std::string src;
    for (int i = 0; i < 8192; i++) src += static_cast<char>(i % 251 + 1);
    const std::string path = write_temp_source(src);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "rác nhị phân");
}

TEST(StValidateCli, EmptySourceExitsOneWithJson)
{
    const std::string path = write_temp_source("");
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "source rỗng");
    EXPECT_EQ(run.exit_code, 1);
}

TEST(StValidateCli, OnlyOpenParensExitsCleanlyWithJson)
{
    const std::string src = wrap_program("b := " + repeat_str("(", 30000) + ";\n");
    const std::string path = write_temp_source(src);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "chỉ toàn ngoặc mở");
}

TEST(StValidateCli, LongIdentifierExitsOneWithLimitCode)
{
    const std::string long_name = "V" + std::string(200, 'x');
    const std::string src = "PROGRAM p\nVAR_INPUT " + long_name +
                            " : REAL; END_VAR\nVAR_OUTPUT b : REAL; END_VAR\nb := " + long_name +
                            ";\nEND_PROGRAM\n";
    const std::string path = write_temp_source(src);
    ASSERT_FALSE(path.empty());
    const CliRun run = run_cli(path);
    ::unlink(path.c_str());

    expect_controlled_rejection(run, "identifier quá dài");
    EXPECT_EQ(run.exit_code, 1);
    const nlohmann::json j = nlohmann::json::parse(run.stdout_text);
    EXPECT_EQ(j.at("diagnostics")[0].at("code"), "ST-LIM-005");
}
