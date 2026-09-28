/**
 * @file  test_binary_provenance.cpp
 * @brief T63-002 — binary C++ mà `scripts/artifact_manifest.py` khai
 *        `embeds_commit=True` phải THẬT SỰ mang `MKDDC_GIT_COMMIT`.
 *
 *        `mkddc_apply_provenance()` chỉ định nghĩa macro; không dòng nào dùng
 *        macro thì compiler bỏ chuỗi, và `record`/`deploy-record` từ chối binary
 *        ("không mang MKDDC_GIT_COMMIT"). `mkddc-programming-sim-worker` và
 *        `mkddc-schedule-sim` từng rơi đúng vào trường hợp đó: `build-release.sh`
 *        hỏng và deploy lên bo không ghi được manifest. Test chạy chính binary
 *        vừa build, không đọc lại hằng số trong mã.
 */
#include <gtest/gtest.h>

#include <array>
#include <cstdio>
#include <regex>
#include <string>

namespace {

std::string run(const std::string& command)
{
    std::array<char, 512> buffer{};
    std::string output;
    FILE* pipe = popen(command.c_str(), "r");
    if (pipe == nullptr) return output;
    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe) != nullptr) output += buffer.data();
    pclose(pipe);
    return output;
}

void expect_provenance(const char* binary)
{
    const std::string output = run(std::string(binary) + " --provenance");
    /* Cùng định dạng `mkddc-core --version`. Build ngoài git cho `unknown` —
     * vẫn là chuỗi có thật trong binary, chỉ là không có nguồn. */
    static const std::regex kLine(
        "^version=[^ ]+ git_commit=([0-9a-f]{40}(-dirty)?|unknown) build_time=[^ ]+ toolchain=[^ ]+\n$");
    EXPECT_TRUE(std::regex_match(output, kLine)) << binary << " --provenance → '" << output << "'";
}

} // namespace

TEST(BinaryProvenance, ProgrammingSimWorkerCarriesGitCommit)
{
    expect_provenance(PROGRAMMING_SIM_WORKER_PATH);
}

TEST(BinaryProvenance, ScheduleSimCarriesGitCommit)
{
    expect_provenance(SCHEDULE_SIM_PATH);
}

/* `--version` của worker là `workerVersion` web đọc — không được đổi theo. */
TEST(BinaryProvenance, SimWorkerVersionStaysTheWorkerContract)
{
    const std::string output = run(std::string(PROGRAMMING_SIM_WORKER_PATH) + " --version");
    EXPECT_EQ(output.find("git_commit="), std::string::npos) << output;
    EXPECT_FALSE(output.empty());
}
