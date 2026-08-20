/**
 * @file  test_st_library_registry.cpp
 * @brief T59-003 — chống entry "ma" trong Control Library SYSTEM.
 *
 *        Trước task này ba danh sách entry tồn tại song song và đã trôi khỏi
 *        nhau thật: allowlist FBD của Core cho phép SCALE/DEADBAND/CTU/PI mà
 *        compiler không hề có, đồng thời từ chối SQRT và bốn conversion mà FE
 *        vẫn chào người dùng. Test này khoá cả HAI chiều để lỗi đó không quay lại.
 */
#include <gtest/gtest.h>

#include <fstream>
#include <set>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>

#include "st/st_fbd_model.hpp"
#include "st/st_library_registry_generated.hpp"
#include "st/st_program.hpp"

namespace core {
namespace {

namespace registry = st_library_registry_generated;

nlohmann::json read_registry()
{
    std::ifstream input(std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) +
                            "/pou_library_registry_v1.json",
                        std::ios::binary);
    std::ostringstream content;
    content << input.rdbuf();
    return nlohmann::json::parse(content.str());
}

} // namespace

/* Chiều 1: mọi entry registry PHẢI giải được ở compiler. */
TEST(StLibraryRegistry, EveryFuncTableEntryResolvesInCompiler)
{
    ASSERT_FALSE(registry::kFuncTable.empty());
    for (std::string_view name : registry::kFuncTable) {
        StFunc resolved{};
        EXPECT_TRUE(st_func_from_name(std::string(name), &resolved))
            << name << " có trong registry nhưng không có trong kFuncs[]";
    }
}

TEST(StLibraryRegistry, EveryFbTypeEntryResolvesInCompiler)
{
    ASSERT_FALSE(registry::kFbTypes.empty());
    for (std::string_view name : registry::kFbTypes) {
        EXPECT_NE(st_fb_type_from_name(std::string(name)), StFbType::NONE)
            << name << " có trong registry nhưng không có FB type";
    }
}

/* Chiều 2: mọi symbol compiler PHẢI có trong registry — chặn entry ma ngược lại,
 * tức compiler hỗ trợ thứ mà palette/allowlist không bao giờ chào. */
TEST(StLibraryRegistry, EveryCompilerFunctionAppearsInRegistry)
{
    std::set<std::string> declared;
    for (std::string_view name : registry::kFuncTable) declared.emplace(name);

    for (std::size_t index = 0; index < registry::kFuncTable.size(); ++index) {
        const char* name = st_func_name(static_cast<StFunc>(index));
        ASSERT_STRNE(name, "?")
            << "kFuncs[] ít hơn registry tại index " << index;
        EXPECT_EQ(declared.count(name), 1u)
            << name << " có trong compiler nhưng thiếu trong registry";
    }
    /* Một-trên-trần: kFuncs[] không được nhiều hơn registry. */
    EXPECT_STREQ(st_func_name(static_cast<StFunc>(registry::kFuncTable.size())), "?")
        << "kFuncs[] nhiều hơn registry — có hàm compiler chưa khai trong registry";
}

TEST(StLibraryRegistry, EveryCompilerFbTypeAppearsInRegistry)
{
    std::set<std::string> declared;
    for (std::string_view name : registry::kFbTypes) declared.emplace(name);

    /* StFbType::NONE = 0 nên FB thật bắt đầu ở 1. */
    for (std::size_t index = 1; index <= registry::kFbTypes.size(); ++index) {
        const char* name = st_fb_type_name(static_cast<StFbType>(index));
        ASSERT_STRNE(name, "?") << "FB type ít hơn registry tại " << index;
        EXPECT_EQ(declared.count(name), 1u)
            << name << " có trong compiler nhưng thiếu trong registry";
    }
    EXPECT_STREQ(st_fb_type_name(static_cast<StFbType>(registry::kFbTypes.size() + 1)), "?")
        << "FB type nhiều hơn registry";
}

/* Các entry ma cụ thể đã bị gỡ. */
TEST(StLibraryRegistry, RemovedGhostEntriesStayRemoved)
{
    for (const char* ghost : {"SCALE", "DEADBAND", "CTU", "PI"}) {
        StFunc resolved{};
        EXPECT_FALSE(st_func_from_name(ghost, &resolved)) << ghost;
        EXPECT_EQ(st_fb_type_from_name(ghost), StFbType::NONE) << ghost;
        bool declared = false;
        for (std::string_view name : registry::kPureFunctions)
            declared = declared || name == ghost;
        for (std::string_view name : registry::kFbTypes)
            declared = declared || name == ghost;
        EXPECT_FALSE(declared) << ghost << " vẫn còn trong registry";
    }
}

/* Các entry FE vốn chào mà Core từng từ chối nay phải được chấp nhận. */
TEST(StLibraryRegistry, PreviouslyRejectedEntriesAreNowAllowed)
{
    for (const char* name : {"SQRT"}) {
        bool declared = false;
        for (std::string_view item : registry::kPureFunctions)
            declared = declared || item == name;
        EXPECT_TRUE(declared) << name << " thiếu trong allowlist FUNCTION";
    }
    for (const char* name : {"INT_TO_REAL", "REAL_TO_INT", "TIME_TO_REAL", "REAL_TO_TIME"}) {
        bool declared = false;
        for (std::string_view item : registry::kExplicitConversions)
            declared = declared || item == name;
        EXPECT_TRUE(declared) << name << " thiếu trong allowlist CONVERSION";
        StFunc resolved{};
        EXPECT_TRUE(st_func_from_name(name, &resolved)) << name;
    }
}

TEST(StLibraryRegistry, GeneratedConstantsMatchContractFile)
{
    const nlohmann::json contract = read_registry();
    EXPECT_EQ(contract.at("libraryVersion"), registry::kLibraryVersion);

    std::set<std::string> operators, func_table, fb_types, pure, conversions, review;
    for (const auto& entry : contract.at("entries")) {
        const std::string identity = entry.at("id");
        const std::string dispatch = entry.at("dispatch");
        const std::string kind = entry.at("kind");
        if (dispatch == "OPERATOR") operators.insert(identity);
        if (dispatch == "FUNC_TABLE") func_table.insert(identity);
        if (dispatch == "FB_TYPE") fb_types.insert(identity);
        if (kind == "FUNCTION") pure.insert(identity);
        if (kind == "CONVERSION") conversions.insert(identity);
        if (entry.at("featureState") == "REVIEW_REQUIRED") review.insert(identity);
    }

    auto to_set = [](const auto& generated) {
        std::set<std::string> values;
        for (std::string_view item : generated) values.emplace(item);
        return values;
    };
    EXPECT_EQ(to_set(registry::kOperators), operators);
    EXPECT_EQ(to_set(registry::kFuncTable), func_table);
    EXPECT_EQ(to_set(registry::kFbTypes), fb_types);
    EXPECT_EQ(to_set(registry::kPureFunctions), pure);
    EXPECT_EQ(to_set(registry::kExplicitConversions), conversions);
    EXPECT_EQ(to_set(registry::kReviewRequired), review);

    /* PID phải giữ REVIEW_REQUIRED tới khi có evidence Controls/Safety. */
    EXPECT_EQ(review, (std::set<std::string>{"PID"}));
}

} // namespace core
