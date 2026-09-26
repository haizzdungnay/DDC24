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
#include "runtime/pid_file.hpp"

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

TEST(CpuHousekeepingParse, CpuListRangesAndSingles)
{
    EXPECT_TRUE(cpu_list_contains("0-3", 3));
    EXPECT_FALSE(cpu_list_contains("0-2", 3));
    EXPECT_TRUE(cpu_list_contains("0-1,3", 3));
    EXPECT_FALSE(cpu_list_contains("0-1,4-7", 3));
    EXPECT_TRUE(cpu_list_contains("3", 3));
    EXPECT_FALSE(cpu_list_contains("", 3));
}

TEST(CpuHousekeepingParse, HexMaskWithGroupsAndCase)
{
    /* Giá trị thật của `/sys/devices/virtual/workqueue/cpumask` trên Foxlinx:
     * "f" trước khi sửa, "7" sau khi sửa. */
    EXPECT_TRUE(cpu_hex_mask_contains("f", 3));
    EXPECT_FALSE(cpu_hex_mask_contains("7", 3));
    EXPECT_TRUE(cpu_hex_mask_contains("00000000,00000008", 3));
    EXPECT_FALSE(cpu_hex_mask_contains("00000000,00000007\n", 3));
    EXPECT_TRUE(cpu_hex_mask_contains("F", 0));
    EXPECT_TRUE(cpu_hex_mask_contains("10", 4));
    EXPECT_FALSE(cpu_hex_mask_contains("zz", 0));
}

TEST_F(CpuIdleSysfs, HousekeepingExposedWhenPid1AndWorkqueueMayRunOnScanCpu)
{
    write(root_ + "/proc/1/status", "Name:\tsystemd\nCpus_allowed:\tf\nCpus_allowed_list:\t0-3\n");
    write(root_ + "/wq/cpumask", "f\n");
    const HousekeepingExposure before = housekeeping_exposure(root_ + "/proc", root_ + "/wq/cpumask", 3);
    EXPECT_TRUE(before.pid1_known);
    EXPECT_TRUE(before.pid1_on_cpu);
    EXPECT_EQ(before.pid1_cpus, "0-3");
    EXPECT_TRUE(before.workqueue_on_cpu);

    write(root_ + "/proc/1/status", "Name:\tsystemd\nCpus_allowed_list:\t0-2\n");
    write(root_ + "/wq/cpumask", "7\n");
    const HousekeepingExposure after = housekeeping_exposure(root_ + "/proc", root_ + "/wq/cpumask", 3);
    EXPECT_FALSE(after.pid1_on_cpu);
    EXPECT_FALSE(after.workqueue_on_cpu);
}

TEST_F(CpuIdleSysfs, HousekeepingUnknownWhenFilesMissing)
{
    const HousekeepingExposure missing = housekeeping_exposure(root_ + "/proc", root_ + "/wq/cpumask", 3);
    EXPECT_FALSE(missing.pid1_known);
    EXPECT_FALSE(missing.workqueue_known);
    EXPECT_FALSE(missing.pid1_on_cpu);
}

TEST_F(CpuIdleSysfs, CountsOnlyUnboundKernelThreadsThatMayRunOnScanCpu)
{
    /* Ảnh chụp thu nhỏ của Foxlinx: kthreadd và luồng Wi-Fi không gắn CPU
     * (0-3), ksoftirqd/3 gắn CPU3, một tiến trình user-space 0-3. */
    write(root_ + "/proc/2/status", "Name:\tkthreadd\nPPid:\t0\nCpus_allowed_list:\t0-3\n");
    write(root_ + "/proc/1561/status", "Name:\tRTW_XMIT_THREAD\nPPid:\t2\nCpus_allowed_list:\t0-3\n");
    write(root_ + "/proc/28/status", "Name:\tksoftirqd/3\nPPid:\t2\nCpus_allowed_list:\t3\n");
    write(root_ + "/proc/884/status", "Name:\tweston\nPPid:\t625\nCpus_allowed_list:\t0-3\n");
    write(root_ + "/proc/self/status", "Name:\tnot-a-pid\nPPid:\t2\nCpus_allowed_list:\t0-3\n");
    /* Rescuer workqueue thật trên Foxlinx: flags=69238880 có PF_NO_SETAFFINITY,
     * kernel tự quản — không đếm (rt-housekeeping cũng không dời được). */
    write(root_ + "/proc/38/status", "Name:\tkblockd\nPPid:\t2\nCpus_allowed_list:\t0-3\n");
    write(root_ + "/proc/38/stat", "38 (kblockd) I 2 0 0 0 -1 69238880 0 0 0 0\n");
    /* comm có khoảng trắng và ngoặc: phải đọc sau ')' cuối. */
    write(root_ + "/proc/1561/stat", "1561 (RTW_XMIT (x) T) S 2 0 0 0 -1 2129984 0 0\n");
    EXPECT_EQ(unbound_kthreads_on_cpu(root_ + "/proc", 3), 2);

    /* Sau rt-housekeeping: hai thread đó thành 0-2. */
    write(root_ + "/proc/2/status", "Name:\tkthreadd\nPPid:\t0\nCpus_allowed_list:\t0-2\n");
    write(root_ + "/proc/1561/status", "Name:\tRTW_XMIT_THREAD\nPPid:\t2\nCpus_allowed_list:\t0-2\n");
    EXPECT_EQ(unbound_kthreads_on_cpu(root_ + "/proc", 3), 0);
}

TEST_F(CpuIdleSysfs, ReadsTaskFlagsAfterLastParenthesis)
{
    unsigned long flags = 0;
    write(root_ + "/stat", "91638 (kworker/u8:4-events_unbound) I 2 0 0 0 -1 69238880 0\n");
    ASSERT_TRUE(read_task_flags(root_ + "/stat", &flags));
    EXPECT_EQ(flags, 69238880ul);
    EXPECT_NE(flags & kPfNoSetAffinity, 0ul);
    write(root_ + "/stat", "7 (a) b) c) S 2 0 0 0 -1 2129984 0\n");
    ASSERT_TRUE(read_task_flags(root_ + "/stat", &flags));
    EXPECT_EQ(flags, 2129984ul);
    EXPECT_EQ(flags & kPfNoSetAffinity, 0ul);
    EXPECT_FALSE(read_task_flags(root_ + "/khong-co", &flags));
}

TEST_F(CpuIdleSysfs, KthreadCountUnknownWithoutProc)
{
    EXPECT_EQ(unbound_kthreads_on_cpu(root_ + "/khong-co", 3), -1);
}

TEST_F(CpuIdleSysfs, PidFileWrittenAtomicallyAndRemovedOnlyByOwner)
{
    /* F16: Core tự ghi pidfile thay cho `ExecStartPost` chạy FIFO 80 trên CPU3. */
    const std::string path = root_ + "/core.pid";
    ASSERT_TRUE(write_pid_file(path, 4242));
    std::FILE* file = std::fopen(path.c_str(), "r");
    ASSERT_NE(file, nullptr);
    char text[16] = {};
    ASSERT_NE(std::fgets(text, sizeof(text), file), nullptr);
    std::fclose(file);
    EXPECT_STREQ(text, "4242\n") << "web đọc bằng strconv.Atoi(TrimSpace)";
    EXPECT_NE(::access((path + ".tmp").c_str(), F_OK), 0) << "không để lại file tạm";

    /* Core mới đã ghi đè: Core cũ tắt không được xoá file của Core mới. */
    ASSERT_TRUE(write_pid_file(path, 5151));
    remove_pid_file_if_owned(path, 4242);
    EXPECT_EQ(::access(path.c_str(), F_OK), 0);
    remove_pid_file_if_owned(path, 5151);
    EXPECT_NE(::access(path.c_str(), F_OK), 0);

    EXPECT_FALSE(write_pid_file(root_ + "/khong-co/core.pid", 1));
    EXPECT_FALSE(write_pid_file(path, 0));
}

} // namespace
} // namespace core
