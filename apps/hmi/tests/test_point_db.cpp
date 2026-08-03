#include <gtest/gtest.h>

#include <fstream>
#include <string>
#include <unistd.h>

#include "data/point_db.hpp"

namespace hmi {
namespace {

class TempFile {
public:
    explicit TempFile(const std::string& contents)
    {
        char pattern[] = "/tmp/mkddc-hmi-point-db-XXXXXX";
        const int fd = mkstemp(pattern);
        EXPECT_GE(fd, 0);
        if (fd >= 0) close(fd);
        path_ = pattern;
        write(contents);
    }
    ~TempFile() { unlink(path_.c_str()); }
    void write(const std::string& contents)
    {
        std::ofstream out(path_, std::ios::trunc);
        out << contents;
    }
    const std::string& path() const { return path_; }

private:
    std::string path_;
};

const char* valid_db = R"({
  "project_id":"P-1", "profile":"GENERIC_DDC", "revision":7,
  "stale_threshold_s":5,
  "points":[
    {"point_id":"UI1","io_type":"UI","channel":1,"display_name":"Supply","unit":"degC"},
    {"point_id":"AO1","io_type":"AO","channel":1,"safe_state":2.5},
    {"point_id":"DO1","io_type":"DO","channel":1,"safe_state":false}
  ]
})";

TEST(PointDbTest, LoadsMetadataPointsAndPerPointSafeStates)
{
    TempFile file(valid_db);
    PointDb db;
    ASSERT_TRUE(db.load(file.path()));
    EXPECT_TRUE(db.loaded());
    EXPECT_EQ(db.count(), 3u);
    EXPECT_EQ(db.meta().revision, 7);
    EXPECT_EQ(db.display_name("UI1"), "Supply");
    EXPECT_EQ(db.display_name("MISSING"), "MISSING");
    ASSERT_NE(db.find("AO1"), nullptr);
    EXPECT_TRUE(db.find("AO1")->has_safe_state);
    EXPECT_FLOAT_EQ(db.find("AO1")->safe_state_ao, 2.5f);
}

TEST(PointDbTest, FailedReloadKeepsLastValidDatabase)
{
    TempFile file(valid_db);
    PointDb db;
    ASSERT_TRUE(db.load(file.path()));
    file.write(R"({"points":[
      {"point_id":"UI1","io_type":"UI","channel":1},
      {"point_id":"UI2","io_type":"UI","channel":1}
    ]})");
    EXPECT_FALSE(db.reload(file.path()));
    EXPECT_TRUE(db.loaded());
    EXPECT_EQ(db.count(), 3u);
    EXPECT_NE(db.find("AO1"), nullptr);
}

TEST(PointDbTest, RejectsOutputSafeStateTypeMismatch)
{
    TempFile file(R"({"points":[
      {"point_id":"DO1","io_type":"DO","channel":1,"safe_state":0}
    ]})");
    PointDb db;
    EXPECT_FALSE(db.load(file.path()));
    EXPECT_FALSE(db.loaded());
}

} // namespace
} // namespace hmi
