/* iobus tự ghi pidfile cho web (health `iobus` + SIGHUP reload) — xem
 * adapters/platform/pid_file.hpp. Cài sạch bo lab 2026-09-27 lộ ra gói phát hành
 * không ai ghi `/run/mkddc/iobus.pid`. */
#include <gtest/gtest.h>

#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

#include "platform/pid_file.hpp"

namespace {

class PidFileTest : public ::testing::Test {
protected:
    void SetUp() override
    {
        char pattern[] = "/tmp/iobus-pidfile-XXXXXX";
        const char* made = ::mkdtemp(pattern);
        ASSERT_NE(made, nullptr);
        dir_ = made;
        path_ = dir_ + "/iobus.pid";
    }
    void TearDown() override
    {
        (void)::unlink(path_.c_str());
        (void)::unlink((path_ + ".tmp").c_str());
        (void)::rmdir(dir_.c_str());
    }
    std::string read_all() const
    {
        std::ifstream in(path_);
        return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    }
    bool exists(const std::string& p) const
    {
        struct stat st {};
        return ::stat(p.c_str(), &st) == 0;
    }
    std::string dir_;
    std::string path_;
};

TEST_F(PidFileTest, WritesPidAndLeavesNoStagingFile)
{
    ASSERT_TRUE(iobus::write_pid_file(path_, 4242));
    EXPECT_EQ(read_all(), "4242\n");
    EXPECT_FALSE(exists(path_ + ".tmp"));
}

TEST_F(PidFileTest, RejectsMissingDirectoryAndInvalidPid)
{
    EXPECT_FALSE(iobus::write_pid_file(dir_ + "/khong-co/iobus.pid", 1));
    EXPECT_FALSE(iobus::write_pid_file(path_, 0));
    EXPECT_FALSE(iobus::write_pid_file("", 1));
    EXPECT_FALSE(exists(path_));
}

TEST_F(PidFileTest, RemovesOnlyWhenStillOwned)
{
    ASSERT_TRUE(iobus::write_pid_file(path_, 100));
    iobus::remove_pid_file_if_owned(path_, 200); /* một iobus mới đã ghi đè */
    EXPECT_TRUE(exists(path_));
    iobus::remove_pid_file_if_owned(path_, 100);
    EXPECT_FALSE(exists(path_));
}

TEST_F(PidFileTest, GuardRemovesOwnFileOnScopeExit)
{
    {
        ASSERT_TRUE(iobus::write_pid_file(path_, 321));
        iobus::PidFileGuard guard(path_, 321);
        EXPECT_TRUE(exists(path_));
    }
    EXPECT_FALSE(exists(path_));
}

TEST_F(PidFileTest, GuardKeepsFileWrittenByAnotherProcess)
{
    {
        iobus::PidFileGuard guard(path_, 321);
        ASSERT_TRUE(iobus::write_pid_file(path_, 654));
    }
    EXPECT_EQ(read_all(), "654\n");
}

} // namespace
