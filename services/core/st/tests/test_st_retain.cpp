/**
 * @file  test_st_retain.cpp
 * @brief ACTION 11 — RETAIN và restart recovery.
 *        Phủ đủ 6 kịch bản bắt buộc: cold start, warm restart, mất điện khi
 *        đang ghi, CRC sai, đổi program version, đổi variable layout.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

#include <unistd.h>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_retain.hpp"
#include "st/st_runtime.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

std::vector<uint8_t> build(const std::string& src)
{
    StIrModule mod;
    StDiagnostic d;
    EXPECT_TRUE(compile_st_source(src, &mod, &d)) << d.code << ": " << d.message;
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

/* Chương trình có một biến RETAIN đếm lên mỗi chu kỳ. */
const char* kCounter = R"ST(
PROGRAM c
VAR RETAIN n : INT; END_VAR
    n := n + 1;
END_PROGRAM
)ST";

/* Cùng ý nghĩa nhưng ĐỔI TÊN biến RETAIN -> layout_hash phải khác. */
const char* kCounterRenamed = R"ST(
PROGRAM c
VAR RETAIN counter : INT; END_VAR
    counter := counter + 1;
END_PROGRAM
)ST";

/* Đổi KIỂU biến RETAIN -> layout_hash phải khác. */
const char* kCounterRetyped = R"ST(
PROGRAM c
VAR RETAIN n : REAL; END_VAR
    n := n + 1.0;
END_PROGRAM
)ST";

std::string temp_path()
{
    char buf[] = "/tmp/mkddc-retain-test-XXXXXX";
    const int fd = ::mkstemp(buf);
    if (fd >= 0) ::close(fd);
    ::unlink(buf);   /* chỉ mượn tên; file do StRetainStore tạo */
    return buf;
}

bool load(StProgramRuntime* rt, const std::vector<uint8_t>& art)
{
    StLoadError err;
    const bool ok = rt->activate(art.data(), art.size(), &err);
    EXPECT_TRUE(ok) << err.code << ": " << err.message;
    return ok;
}

int32_t counter(StProgramRuntime& rt, const char* name = "n")
{
    StValue v;
    EXPECT_TRUE(rt.get_variable(name, &v));
    return v.i;
}

constexpr uint64_t kMin = 60ull * 1000000000ull;

} // namespace

TEST(StRetain, ColdStartWithoutFileIsNotAnError)
{
    const std::string path = temp_path();
    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, build(kCounter)));

    StRetainStore store(path);
    const StRetainResult r = store.restore(const_cast<StLoadedProgram*>(rt.program()));
    EXPECT_FALSE(r.restored);
    EXPECT_EQ(r.reject_code, nullptr)
        << "lần chạy đầu tiên là bình thường, không phải lỗi";
    EXPECT_EQ(counter(rt), 0);
}

TEST(StRetain, WarmRestartRestoresValue)
{
    const std::string path = temp_path();
    const std::vector<uint8_t> art = build(kCounter);

    {
        StProgramRuntime rt;
        ASSERT_TRUE(load(&rt, art));
        for (int i = 0; i < 7; i++) ASSERT_TRUE(rt.execute(i * 1000).ok);
        ASSERT_EQ(counter(rt), 7);

        StRetainStore store(path);
        EXPECT_TRUE(store.save_if_needed(*rt.program(), 0, /*force=*/true));
    }

    /* "Khởi động lại": runtime hoàn toàn mới, cùng artifact. */
    StProgramRuntime rt2;
    ASSERT_TRUE(load(&rt2, art));
    EXPECT_EQ(counter(rt2), 0) << "trước restore phải là giá trị khởi tạo";

    StRetainStore store2(path);
    const StRetainResult r = store2.restore(const_cast<StLoadedProgram*>(rt2.program()));
    EXPECT_TRUE(r.restored) << r.message;
    EXPECT_EQ(counter(rt2), 7);

    ::unlink(path.c_str());
}

TEST(StRetain, CorruptedCrcIsRejectedAndColdStarts)
{
    const std::string path = temp_path();
    const std::vector<uint8_t> art = build(kCounter);

    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, art));
    for (int i = 0; i < 5; i++) rt.execute(i * 1000);
    StRetainStore store(path);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 0, true));

    /* Hỏng 1 byte payload. */
    {
        std::fstream f(path, std::ios::in | std::ios::out | std::ios::binary);
        ASSERT_TRUE(f.is_open());
        f.seekp(20);   /* byte đầu của payload */
        const char bad = 0x7F;
        f.write(&bad, 1);
    }

    StProgramRuntime rt2;
    ASSERT_TRUE(load(&rt2, art));
    StRetainStore store2(path);
    const StRetainResult r = store2.restore(const_cast<StLoadedProgram*>(rt2.program()));
    EXPECT_FALSE(r.restored);
    EXPECT_STREQ(r.reject_code, st_retain_error::kBadCrc);
    EXPECT_EQ(counter(rt2), 0) << "từ chối bản ghi -> cold start, KHÔNG dừng chương trình";

    ::unlink(path.c_str());
}

TEST(StRetain, TruncatedFileFromPowerLossIsRejected)
{
    const std::string path = temp_path();
    const std::vector<uint8_t> art = build(kCounter);

    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, art));
    rt.execute(0);
    StRetainStore store(path);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 0, true));

    /* Cắt file như thể mất điện giữa lúc ghi. */
    ASSERT_EQ(::truncate(path.c_str(), 22), 0);

    StProgramRuntime rt2;
    ASSERT_TRUE(load(&rt2, art));
    StRetainStore store2(path);
    const StRetainResult r = store2.restore(const_cast<StLoadedProgram*>(rt2.program()));
    EXPECT_FALSE(r.restored);
    EXPECT_NE(r.reject_code, nullptr);
    EXPECT_EQ(counter(rt2), 0);

    ::unlink(path.c_str());
}

TEST(StRetain, BadMagicRejected)
{
    const std::string path = temp_path();
    const std::vector<uint8_t> art = build(kCounter);
    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, art));
    rt.execute(0);
    StRetainStore store(path);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 0, true));

    {
        std::fstream f(path, std::ios::in | std::ios::out | std::ios::binary);
        f.seekp(0);
        const char junk = 0x00;
        f.write(&junk, 1);
    }

    StProgramRuntime rt2;
    ASSERT_TRUE(load(&rt2, art));
    StRetainStore store2(path);
    const StRetainResult r = store2.restore(const_cast<StLoadedProgram*>(rt2.program()));
    EXPECT_STREQ(r.reject_code, st_retain_error::kBadMagicOrVersion);

    ::unlink(path.c_str());
}

TEST(StRetain, RenamingRetainVariableInvalidatesRecord)
{
    /* Đổi tên biến RETAIN = đổi layout. Bản ghi cũ PHẢI bị từ chối, không
     * được âm thầm đọc bytes cũ vào biến mới. */
    const std::string path = temp_path();

    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, build(kCounter)));
    for (int i = 0; i < 9; i++) rt.execute(i * 1000);
    StRetainStore store(path);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 0, true));

    StProgramRuntime rt2;
    ASSERT_TRUE(load(&rt2, build(kCounterRenamed)));
    StRetainStore store2(path);
    const StRetainResult r = store2.restore(const_cast<StLoadedProgram*>(rt2.program()));
    EXPECT_FALSE(r.restored);
    EXPECT_STREQ(r.reject_code, st_retain_error::kLayoutMismatch);
    EXPECT_EQ(counter(rt2, "counter"), 0);

    ::unlink(path.c_str());
}

TEST(StRetain, ChangingRetainVariableTypeInvalidatesRecord)
{
    const std::string path = temp_path();

    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, build(kCounter)));
    for (int i = 0; i < 3; i++) rt.execute(i * 1000);
    StRetainStore store(path);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 0, true));

    StProgramRuntime rt2;
    ASSERT_TRUE(load(&rt2, build(kCounterRetyped)));
    StRetainStore store2(path);
    const StRetainResult r = store2.restore(const_cast<StLoadedProgram*>(rt2.program()));
    EXPECT_FALSE(r.restored);
    EXPECT_STREQ(r.reject_code, st_retain_error::kLayoutMismatch);

    ::unlink(path.c_str());
}

/* ---- Chính sách ghi: wear control ---- */

TEST(StRetain, DoesNotWriteWhenValueUnchanged)
{
    const std::string path = temp_path();
    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, build(kCounter)));
    rt.execute(0);

    StRetainStore store(path);
    EXPECT_TRUE(store.save_if_needed(*rt.program(), 0, true));
    /* Không chạy thêm chu kỳ nào -> giá trị không đổi -> không ghi lại, kể cả
     * khi force. Điều kiện "có thay đổi" quan trọng hơn giãn cách thời gian:
     * chương trình có RETAIN nhưng giá trị đứng yên không tốn chu kỳ ghi nào. */
    EXPECT_FALSE(store.save_if_needed(*rt.program(), 10 * kMin, true));
    EXPECT_EQ(store.write_count(), 1u);

    ::unlink(path.c_str());
}

TEST(StRetain, RespectsMinimumWriteInterval)
{
    const std::string path = temp_path();
    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, build(kCounter)));

    StRetainStore store(path);
    rt.execute(0);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 1000, false));

    rt.execute(1000);
    EXPECT_FALSE(store.save_if_needed(*rt.program(), 1000 + kMin / 2, false))
        << "chưa đủ giãn cách thì không ghi";

    rt.execute(2000);
    EXPECT_TRUE(store.save_if_needed(*rt.program(), 1000 + kMin + 1, false));
    EXPECT_EQ(store.write_count(), 2u);

    ::unlink(path.c_str());
}

TEST(StRetain, ForceBypassesIntervalForCleanShutdown)
{
    const std::string path = temp_path();
    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, build(kCounter)));

    StRetainStore store(path);
    rt.execute(0);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 1000, false));
    rt.execute(1000);
    /* Shutdown sạch phải ghi được ngay, không đợi hết giãn cách. */
    EXPECT_TRUE(store.save_if_needed(*rt.program(), 1001, true));

    ::unlink(path.c_str());
}

TEST(StRetain, ProgramWithoutRetainVariablesNeverWrites)
{
    const std::string path = temp_path();
    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, build(R"ST(
PROGRAM p
VAR_OUTPUT o : REAL; END_VAR
    o := 1.0;
END_PROGRAM
)ST")));
    rt.execute(0);

    StRetainStore store(path);
    EXPECT_FALSE(store.save_if_needed(*rt.program(), 0, true));
    std::ifstream f(path);
    EXPECT_FALSE(f.good()) << "không có biến RETAIN thì không được tạo file";
}

TEST(StRetain, RestoredValueContinuesCountingFromRestoredPoint)
{
    /* Kiểm end-to-end: khôi phục xong thì chương trình chạy tiếp TỪ giá trị
     * khôi phục, không phải từ 0. */
    const std::string path = temp_path();
    const std::vector<uint8_t> art = build(kCounter);

    StProgramRuntime rt;
    ASSERT_TRUE(load(&rt, art));
    for (int i = 0; i < 4; i++) rt.execute(i * 1000);
    StRetainStore store(path);
    ASSERT_TRUE(store.save_if_needed(*rt.program(), 0, true));

    StProgramRuntime rt2;
    ASSERT_TRUE(load(&rt2, art));
    StRetainStore store2(path);
    ASSERT_TRUE(store2.restore(const_cast<StLoadedProgram*>(rt2.program())).restored);
    ASSERT_EQ(counter(rt2), 4);

    ASSERT_TRUE(rt2.execute(5000).ok);
    EXPECT_EQ(counter(rt2), 5) << "phải đếm tiếp từ 4, không phải từ 0";

    ::unlink(path.c_str());
}

} // namespace core
