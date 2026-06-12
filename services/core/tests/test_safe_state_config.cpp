/**
 * @file  test_safe_state_config.cpp
 * @brief Loader io_safe_state.conf (CONFIG_SCHEMA §4): hợp lệ, thiếu file,
 *        JSON hỏng fail-fast, ch/giá trị ngoài dải, áp vào resolver mức 6.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <string>

#include <unistd.h>

#include "safe_state_config.hpp"

using namespace core;

namespace {

class TempConf {
public:
    explicit TempConf(const std::string& content)
    {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "/tmp/safe-cfg-test-%d-%d.json", getpid(), counter_++);
        path_ = buf;
        std::ofstream f(path_);
        f << content;
    }
    ~TempConf() { ::unlink(path_.c_str()); }
    const std::string& path() const { return path_; }

private:
    std::string path_;
    static int counter_;
};

int TempConf::counter_ = 0;

} // namespace

TEST(SafeStateConfig, ValidConfigPerSchema)
{
    /* đúng ví dụ CONFIG_SCHEMA §4 */
    TempConf f(R"({
      "ao": [ {"ch":1,"safe":0.0}, {"ch":2,"safe":4.0} ],
      "do": [ {"ch":1,"safe":"open"}, {"ch":2,"safe":"closed"} ]
    })");
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config(f.path(), true, &cfg));
    EXPECT_FLOAT_EQ(cfg.ao_default[0], 0.0f);
    EXPECT_FLOAT_EQ(cfg.ao_default[1], 4.0f);
    EXPECT_FALSE(cfg.do_default[0]);
    EXPECT_TRUE(cfg.do_default[1]);
    EXPECT_FLOAT_EQ(cfg.ao_default[2], 0.0f) << "kênh không khai → default 0";
}

TEST(SafeStateConfig, MissingFileUsesFixedDefaults)
{
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config("/tmp/khong-co-file-9999.json", false, &cfg));
    for (int i = 0; i < KX_N_AO; i++) EXPECT_FLOAT_EQ(cfg.ao_default[i], 0.0f);
    for (int i = 0; i < KX_N_DO; i++) EXPECT_FALSE(cfg.do_default[i]);
}

TEST(SafeStateConfig, MalformedFailsFast)
{
    TempConf f(R"({ "ao": [ {"ch":1,"safe":0.0} )");
    SafeStateConfig cfg;
    EXPECT_FALSE(load_safe_state_config(f.path(), true, &cfg));
}

TEST(SafeStateConfig, RejectsOutOfRange)
{
    SafeStateConfig cfg;
    TempConf bad_ch(R"({ "ao": [ {"ch":9,"safe":0.0} ] })");
    EXPECT_FALSE(load_safe_state_config(bad_ch.path(), true, &cfg)) << "ch 9 > 4";

    TempConf bad_v(R"({ "ao": [ {"ch":1,"safe":99.0} ] })");
    EXPECT_FALSE(load_safe_state_config(bad_v.path(), true, &cfg)) << "safe 99 > 20";

    TempConf bad_do(R"({ "do": [ {"ch":1,"safe":"tach"} ] })");
    EXPECT_FALSE(load_safe_state_config(bad_do.path(), true, &cfg)) << "do safe lạ";
}

TEST(SafeStateConfig, AppliesToResolverLevel6)
{
    TempConf f(R"({
      "ao": [ {"ch":1,"safe":2.5} ],
      "do": [ {"ch":2,"safe":"closed"} ]
    })");
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config(f.path(), true, &cfg));

    PriorityResolver r;
    apply_safe_state_config(cfg, &r);
    const OutputCmd out = r.resolve();   /* không nguồn nào active → mức 6 */
    EXPECT_FLOAT_EQ(out.ao[0], 2.5f);
    EXPECT_EQ(out.dout[1], 1);
    EXPECT_EQ(out.dout[0], 0);

    /* nguồn cao hơn vẫn thắng default */
    r.set_do(PRIO_FIRE_SAFETY, 1, false);
    EXPECT_EQ(r.resolve().dout[1], 0);
}
