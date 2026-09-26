/**
 * @file  test_cpu_idle_check.cpp
 * @brief ADR-061 C4 — Core đọc đúng việc CPU của vòng quét còn được vào trạng
 *        thái nghỉ sâu hay không (cấu trúc sysfs dựng trong thư mục tạm, số
 *        liệu lấy từ CPU3 của Foxlinx: WFI 1 µs, cpu-sleep 370 µs).
 */
#include <gtest/gtest.h>

#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <string>

#include "runtime/cpu_idle_check.hpp"

namespace core {
namespace {

class CpuIdleSysfs : public ::testing::Test {
protected:
    void SetUp() override
    {
        char pattern[] = "/tmp/mkddc-cpuidle-XXXXXX";
        ASSERT_NE(::mkdtemp(pattern), nullptr);
        root_ = pattern;
    }

    void TearDown() override
    {
        if (!root_.empty()) {
            const std::string command = "rm -rf '" + root_ + "'";
            if (std::system(command.c_str()) != 0) ADD_FAILURE() << "không xoá được " << root_;
        }
    }

    void mkdirs(const std::string& path)
    {
        std::string partial;
        for (std::size_t i = 0; i < path.size(); ++i) {
            partial.push_back(path[i]);
            if (path[i] == '/' && partial.size() > 1) ::mkdir(partial.c_str(), 0755);
        }
        ::mkdir(path.c_str(), 0755);
    }

    void write(const std::string& path, const std::string& text)
    {
        const std::size_t slash = path.rfind('/');
        mkdirs(path.substr(0, slash));
        std::FILE* file = std::fopen(path.c_str(), "w");
        ASSERT_NE(file, nullptr);
        std::fputs(text.c_str(), file);
        std::fclose(file);
    }

    /* Hai trạng thái như CPU3 của RV1126B. */
    void foxlinx_cpu3(const std::string& qos)
    {
        const std::string cpu = root_ + "/cpu3";
        write(cpu + "/cpuidle/state0/name", "WFI\n");
        write(cpu + "/cpuidle/state0/latency", "1\n");
        write(cpu + "/cpuidle/state0/disable", "0\n");
        write(cpu + "/cpuidle/state1/name", "cpu-sleep\n");
        write(cpu + "/cpuidle/state1/latency", "370\n");
        write(cpu + "/cpuidle/state1/disable", "0\n");
        write(cpu + "/power/pm_qos_resume_latency_us", qos);
    }

    std::string root_;
};

TEST_F(CpuIdleSysfs, NoQosConstraintExposesDeepSleepOnFoxlinxCpu3)
{
    /* Mặc định của kernel: "0" nghĩa là KHÔNG ràng buộc. */
    foxlinx_cpu3("0\n");
    const CpuIdleExposure exposure = cpu_idle_exposure(root_, 3);
    EXPECT_TRUE(exposure.known);
    EXPECT_EQ(exposure.qos_resume_latency_us, -1);
    EXPECT_EQ(exposure.worst_allowed_exit_latency_us, 370);
    EXPECT_EQ(exposure.worst_state_name, "cpu-sleep");
}

TEST_F(CpuIdleSysfs, QosTwentyMicrosecondsLeavesOnlyWfi)
{
    foxlinx_cpu3("20\n");
    const CpuIdleExposure exposure = cpu_idle_exposure(root_, 3);
    EXPECT_EQ(exposure.qos_resume_latency_us, 20);
    EXPECT_EQ(exposure.worst_allowed_exit_latency_us, 1);
    EXPECT_EQ(exposure.worst_state_name, "WFI");
}

TEST_F(CpuIdleSysfs, QosNotApplicableMeansZeroMicrosecondsNotUnconstrained)
{
    /* "n/a" là ràng buộc 0 µs, KHÔNG phải "không ràng buộc" — đọc nhầm hai
     * chiều này là báo sai hướng. */
    foxlinx_cpu3("n/a\n");
    const CpuIdleExposure exposure = cpu_idle_exposure(root_, 3);
    EXPECT_EQ(exposure.qos_resume_latency_us, 0);
    EXPECT_EQ(exposure.worst_allowed_exit_latency_us, 1);
}

TEST_F(CpuIdleSysfs, QosAboveDeepStateLatencyStillExposesIt)
{
    foxlinx_cpu3("500\n");
    const CpuIdleExposure exposure = cpu_idle_exposure(root_, 3);
    EXPECT_EQ(exposure.worst_allowed_exit_latency_us, 370);
}

TEST_F(CpuIdleSysfs, DisabledDeepStateIsNotExposed)
{
    foxlinx_cpu3("0\n");
    write(root_ + "/cpu3/cpuidle/state1/disable", "1\n");
    const CpuIdleExposure exposure = cpu_idle_exposure(root_, 3);
    EXPECT_EQ(exposure.worst_allowed_exit_latency_us, 1);
}

TEST_F(CpuIdleSysfs, MissingCpuidleIsUnknownNotSafe)
{
    const CpuIdleExposure exposure = cpu_idle_exposure(root_, 7);
    EXPECT_FALSE(exposure.known);
    EXPECT_EQ(exposure.worst_allowed_exit_latency_us, 0);
}

} // namespace
} // namespace core
