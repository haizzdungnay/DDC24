/**
 * @file  test_safe_state_config.cpp
 * @brief Loader io_safe_state.conf (CONFIG_SCHEMA §4): hợp lệ, thiếu file,
 *        JSON hỏng fail-fast, validate THEO MODE THẬT của AO (0-10V → [0,10];
 *        4-20mA → [4,20]), load_ao_modes từ io_config.conf, áp resolver mức 6.
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

AoModeConfig all_volt()
{
    return AoModeConfig{};   /* mode 0 = 0-10V cả 4 kênh */
}

AoModeConfig mixed()
{
    AoModeConfig m;
    m.mode[1] = 1;   /* AO2 = 4-20mA */
    return m;
}

} // namespace

/* ---------- load_ao_modes (io_config.conf — CONFIG_SCHEMA §3) ---------- */

TEST(AoModes, ParsesIoConfig)
{
    TempConf f(R"({
      "ao": [ {"ch":1, "mode":"0-10V"}, {"ch":2, "mode":"4-20mA"} ]
    })");
    AoModeConfig m;
    ASSERT_TRUE(load_ao_modes(f.path(), true, &m));
    EXPECT_EQ(m.mode[0], 0);
    EXPECT_EQ(m.mode[1], 1);
    EXPECT_EQ(m.mode[2], 0) << "kênh không khai → default 0-10V";
}

TEST(AoModes, MissingFileDefaultsVolt)
{
    AoModeConfig m;
    ASSERT_TRUE(load_ao_modes("/tmp/khong-co-io-cfg-9999.json", false, &m));
    for (int i = 0; i < KX_N_AO; i++) EXPECT_EQ(m.mode[i], 0);
}

TEST(AoModes, MissingFileFailsWhenMustExist)
{
    AoModeConfig m;
    EXPECT_FALSE(load_ao_modes("/tmp/khong-co-io-cfg-9999.json", true, &m))
        << "--io-conf chỉ định tay mà thiếu file phải fail-fast";
}

TEST(AoModes, PositionalFallbackWhenNoCh)
{
    /* entry không có "ch" → gán theo thứ tự (tolerance khớp iobus_config) */
    TempConf f(R"({ "ao": [ {"mode":"4-20mA"}, {"mode":"0-10V"} ] })");
    AoModeConfig m;
    ASSERT_TRUE(load_ao_modes(f.path(), true, &m));
    EXPECT_EQ(m.mode[0], 1);
    EXPECT_EQ(m.mode[1], 0);
}

TEST(AoModes, RejectsBadModeOrChannel)
{
    AoModeConfig m;
    TempConf bad_mode(R"({ "ao": [ {"ch":1, "mode":"0-5V"} ] })");
    EXPECT_FALSE(load_ao_modes(bad_mode.path(), true, &m));
    TempConf bad_ch(R"({ "ao": [ {"ch":7, "mode":"0-10V"} ] })");
    EXPECT_FALSE(load_ao_modes(bad_ch.path(), true, &m));
    TempConf bad_json(R"({ "ao": [ )");
    EXPECT_FALSE(load_ao_modes(bad_json.path(), true, &m));
}

/* ---------- load_safe_state_config ---------- */

TEST(SafeStateConfig, ValidConfigPerSchemaAndMode)
{
    /* đúng ví dụ CONFIG_SCHEMA §4: AO1 volt safe=0.0, AO2 mA safe=4.0 */
    TempConf f(R"({
      "ao": [ {"ch":1,"safe":0.0}, {"ch":2,"safe":4.0} ],
      "do": [ {"ch":1,"safe":"open"}, {"ch":2,"safe":"closed"} ]
    })");
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config(f.path(), true, mixed(), &cfg));
    EXPECT_FLOAT_EQ(cfg.ao_default[0], 0.0f);
    EXPECT_FLOAT_EQ(cfg.ao_default[1], 4.0f);
    EXPECT_FALSE(cfg.do_default[0]);
    EXPECT_TRUE(cfg.do_default[1]);
}

TEST(SafeStateConfig, ModeDefaultsWhenMissingFile)
{
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config("/tmp/khong-co-file-9999.json", false, mixed(), &cfg));
    EXPECT_FLOAT_EQ(cfg.ao_default[0], 0.0f) << "0-10V → 0V";
    EXPECT_FLOAT_EQ(cfg.ao_default[1], 4.0f) << "4-20mA → 4mA (không phải 0)";
    for (int i = 0; i < KX_N_DO; i++) EXPECT_FALSE(cfg.do_default[i]);
}

TEST(SafeStateConfig, UnlistedChannelKeepsModeDefaultWithFilePresent)
{
    /* guard hồi quy: file TỒN TẠI nhưng không khai kênh → kênh đó vẫn phải có
     * default đúng mode (mA = 4.0, không phải 0.0 — điện-học 0mA = đứt dây) */
    TempConf f(R"({ "ao": [ {"ch":1,"safe":2.0} ] })");
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config(f.path(), true, mixed(), &cfg));
    EXPECT_FLOAT_EQ(cfg.ao_default[0], 2.0f);
    EXPECT_FLOAT_EQ(cfg.ao_default[1], 4.0f) << "AO2 mA không khai → 4mA";
    EXPECT_FLOAT_EQ(cfg.ao_default[2], 0.0f) << "AO3 V không khai → 0V";
}

TEST(SafeStateConfig, MalformedFailsFast)
{
    TempConf f(R"({ "ao": [ {"ch":1,"safe":0.0} )");
    SafeStateConfig cfg;
    EXPECT_FALSE(load_safe_state_config(f.path(), true, all_volt(), &cfg));
}

TEST(SafeStateConfig, VoltModeRejectsValueAbove10)
{
    /* yêu cầu fix 2: mode 0-10V + safe=15.0 KHÔNG được nhận */
    TempConf f(R"({ "ao": [ {"ch":1,"safe":15.0} ] })");
    SafeStateConfig cfg;
    EXPECT_FALSE(load_safe_state_config(f.path(), true, all_volt(), &cfg))
        << "0-10V nhận 15.0 là sai ngữ nghĩa — phải fail-fast";

    TempConf f2(R"({ "ao": [ {"ch":1,"safe":-1.0} ] })");
    EXPECT_FALSE(load_safe_state_config(f2.path(), true, all_volt(), &cfg));
}

TEST(SafeStateConfig, CurrentModeRejectsOutOf4to20)
{
    SafeStateConfig cfg;
    TempConf below(R"({ "ao": [ {"ch":2,"safe":3.0} ] })");
    EXPECT_FALSE(load_safe_state_config(below.path(), true, mixed(), &cfg))
        << "4-20mA + 3.0 < 4 → fail";

    TempConf above(R"({ "ao": [ {"ch":2,"safe":21.0} ] })");
    EXPECT_FALSE(load_safe_state_config(above.path(), true, mixed(), &cfg))
        << "4-20mA + 21.0 > 20 → fail";

    /* cùng giá trị 15.0: hợp lệ với mA, không hợp lệ với V */
    TempConf v15(R"({ "ao": [ {"ch":2,"safe":15.0} ] })");
    EXPECT_TRUE(load_safe_state_config(v15.path(), true, mixed(), &cfg))
        << "4-20mA + 15.0 hợp lệ";
    EXPECT_FLOAT_EQ(cfg.ao_default[1], 15.0f);
    EXPECT_FALSE(load_safe_state_config(v15.path(), true, all_volt(), &cfg))
        << "0-10V + 15.0 phải fail";
}

TEST(SafeStateConfig, RejectsBadChannelOrDoValue)
{
    SafeStateConfig cfg;
    TempConf bad_ch(R"({ "ao": [ {"ch":9,"safe":0.0} ] })");
    EXPECT_FALSE(load_safe_state_config(bad_ch.path(), true, all_volt(), &cfg));

    TempConf bad_do(R"({ "do": [ {"ch":1,"safe":"tach"} ] })");
    EXPECT_FALSE(load_safe_state_config(bad_do.path(), true, all_volt(), &cfg));
}

TEST(SafeStateConfig, AppliesToResolverLevel6)
{
    TempConf f(R"({
      "ao": [ {"ch":1,"safe":2.5} ],
      "do": [ {"ch":2,"safe":"closed"} ]
    })");
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config(f.path(), true, all_volt(), &cfg));

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

TEST(JsonParserUpgrade, HandlesEscapesAndDuplicateKeys)
{
    TempConf f(R"({
      "ao": [ {"ch":1,"safe":2.5}, {"ch":1,"safe":3.5} ]
    })");
    SafeStateConfig cfg;
    ASSERT_TRUE(load_safe_state_config(f.path(), true, all_volt(), &cfg));

    TempConf f2(R"({
      "do": [ {"ch":1,"safe":"cl\u006fsed"} ]
    })");
    ASSERT_TRUE(load_safe_state_config(f2.path(), true, all_volt(), &cfg));
    EXPECT_TRUE(cfg.do_default[0]) << "should parse 'closed' from escape sequence";
}
