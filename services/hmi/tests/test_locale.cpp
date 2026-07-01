#include <gtest/gtest.h>

#include <fstream>
#include <string>
#include <unistd.h>

#include "i18n/locale.hpp"

namespace hmi {
namespace {

bool valid_utf8(const char* text)
{
    const auto* p = reinterpret_cast<const unsigned char*>(text);
    while (*p) {
        int continuation = 0;
        if (*p <= 0x7f) continuation = 0;
        else if ((*p & 0xe0) == 0xc0) continuation = 1;
        else if ((*p & 0xf0) == 0xe0) continuation = 2;
        else if ((*p & 0xf8) == 0xf0) continuation = 3;
        else return false;
        ++p;
        for (int i = 0; i < continuation; ++i, ++p)
            if ((*p & 0xc0) != 0x80) return false;
    }
    return true;
}

class TempConfig {
public:
    explicit TempConfig(const std::string& contents)
    {
        char pattern[] = "/tmp/mkddc-hmi-locale-XXXXXX";
        const int fd = mkstemp(pattern);
        EXPECT_GE(fd, 0);
        if (fd >= 0) close(fd);
        path_ = pattern;
        write(contents);
    }
    ~TempConfig() { unlink(path_.c_str()); }
    void write(const std::string& contents)
    {
        std::ofstream out(path_, std::ios::trunc);
        out << contents;
    }
    const std::string& path() const { return path_; }

private:
    std::string path_;
};

TEST(LocaleTest, ParsesOnlyExactLanguageKey)
{
    TempConfig config("not_language=vi\nlanguage = en\n");
    Locale locale;
    ASSERT_TRUE(locale.load(config.path()));
    EXPECT_FALSE(locale.is_vi());
    EXPECT_STREQ(locale.str(StrKey::TAB_HOME), "Home");
}

TEST(LocaleTest, ReloadSwitchesToVietnamese)
{
    TempConfig config("language=en\n");
    Locale locale;
    ASSERT_TRUE(locale.load(config.path()));
    config.write("language = vi\n");
    locale.reload();
    EXPECT_TRUE(locale.is_vi());
    EXPECT_STRNE(locale.str(StrKey::TAB_HOME), "Home");
}

TEST(LocaleTest, EveryEnglishAndVietnameseStringIsValidUtf8)
{
    TempConfig config("language=en\n");
    Locale locale;
    ASSERT_TRUE(locale.load(config.path()));
    for (int i = 0; i < static_cast<int>(StrKey::STR_COUNT); ++i)
        EXPECT_TRUE(valid_utf8(locale.str(static_cast<StrKey>(i)))) << "EN index " << i;

    config.write("language=vi\n");
    locale.reload();
    for (int i = 0; i < static_cast<int>(StrKey::STR_COUNT); ++i)
        EXPECT_TRUE(valid_utf8(locale.str(static_cast<StrKey>(i)))) << "VI index " << i;
}

} // namespace
} // namespace hmi
