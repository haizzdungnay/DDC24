/**
 * @file  test_st_pou_registry.cpp
 * @brief T59-102 — bảng ký hiệu, call graph, phân giải library và guard DAG.
 *
 *        Rủi ro thật: ba tình huống "gọi một tên không dùng được" có ba cách sửa
 *        hoàn toàn khác nhau — thêm entry, đổi pin version, phá vòng gọi. Nếu
 *        chúng cùng một mã lỗi thì người vận hành không biết phải làm gì. Bộ test
 *        này khoá đúng sự phân biệt đó, cộng với tính XÁC ĐỊNH của đồ thị.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_parser.hpp"
#include "st/st_pou_registry.hpp"

namespace core {
namespace {

std::unique_ptr<StProgram> parse_or_die(const std::string& source)
{
    auto pou = std::make_unique<StProgram>();
    StDiagnostic diag;
    if (!parse_st_pou(source, pou.get(), &diag)) {
        ADD_FAILURE() << "parse fail " << diag.code << ": " << diag.message;
        return nullptr;
    }
    return pou;
}

std::string fn(const std::string& name, const std::string& body)
{
    return "FUNCTION " + name + " : REAL\nVAR_INPUT x : REAL; END_VAR\n" + body +
           "END_FUNCTION\n";
}

struct Fixture {
    std::vector<std::unique_ptr<StProgram>> owned;
    std::vector<StPouSource> sources;

    void add(const std::string& source,
             std::vector<StLibraryRequirement> requirements = {})
    {
        owned.push_back(parse_or_die(source));
        sources.push_back({owned.back().get(), std::move(requirements)});
    }
};

const std::vector<StLibraryEntry> kLibrary = {
    {"Ramp", StPouKind::FUNCTION, "1.0.0"},
    {"Latch", StPouKind::FUNCTION_BLOCK, "2.1.0"},
};

} // namespace

TEST(StPouRegistry, BuildsSortedSymbolTableAndCallGraph)
{
    Fixture fixture;
    fixture.add(fn("Zulu", "Zulu := Alpha(x);\n"));
    fixture.add(fn("Alpha", "Alpha := Ramp(x);\n"));

    StPouRegistryResult result;
    StDiagnostic diag;
    ASSERT_TRUE(st_build_pou_registry(fixture.sources, kLibrary, &result, &diag))
        << diag.code << ": " << diag.message;

    /* Thứ tự nạp là Zulu rồi Alpha, nhưng bảng ký hiệu phải sắp theo tên. */
    ASSERT_EQ(result.pou_order.size(), 2U);
    EXPECT_EQ(result.pou_order[0], "Alpha");
    EXPECT_EQ(result.pou_order[1], "Zulu");

    ASSERT_EQ(result.edges.size(), 2U);
    EXPECT_EQ(result.edges[0].caller, "Alpha");
    EXPECT_EQ(result.edges[0].callee, "Ramp");
    EXPECT_TRUE(result.edges[0].callee_is_library);
    EXPECT_EQ(result.edges[1].caller, "Zulu");
    EXPECT_EQ(result.edges[1].callee, "Alpha");
    EXPECT_FALSE(result.edges[1].callee_is_library);

    /* Lowering cần callee đứng trước caller. */
    ASSERT_EQ(result.topological_order.size(), 2U);
    EXPECT_EQ(result.topological_order[0], "Alpha");
    EXPECT_EQ(result.topological_order[1], "Zulu");
}

TEST(StPouRegistry, GraphIsIndependentOfLoadOrder)
{
    /* Hai lần Check trên cùng nguồn phải cho cùng kết quả; nếu thứ tự nạp làm
     * đổi diagnostic thì người dùng thấy lỗi "nhảy" giữa các lần chạy. */
    Fixture forward;
    forward.add(fn("Alpha", "Alpha := Bravo(x);\n"));
    forward.add(fn("Bravo", "Bravo := Charlie(x);\n"));
    forward.add(fn("Charlie", "Charlie := x;\n"));

    Fixture backward;
    backward.add(fn("Charlie", "Charlie := x;\n"));
    backward.add(fn("Bravo", "Bravo := Charlie(x);\n"));
    backward.add(fn("Alpha", "Alpha := Bravo(x);\n"));

    StPouRegistryResult first, second;
    StDiagnostic diag;
    ASSERT_TRUE(st_build_pou_registry(forward.sources, kLibrary, &first, &diag))
        << diag.message;
    ASSERT_TRUE(st_build_pou_registry(backward.sources, kLibrary, &second, &diag))
        << diag.message;

    EXPECT_EQ(first.pou_order, second.pou_order);
    EXPECT_EQ(first.topological_order, second.topological_order);
    ASSERT_EQ(first.edges.size(), second.edges.size());
    for (std::size_t index = 0; index < first.edges.size(); ++index) {
        EXPECT_EQ(first.edges[index].caller, second.edges[index].caller);
        EXPECT_EQ(first.edges[index].callee, second.edges[index].callee);
    }
    EXPECT_EQ(first.topological_order.front(), "Charlie");
    EXPECT_EQ(first.topological_order.back(), "Alpha");
}

TEST(StPouRegistry, DirectRecursionIsRejectedAtTheCallSite)
{
    Fixture fixture;
    fixture.add(fn("Loop", "Loop := Loop(x);\n"));

    StPouRegistryResult result;
    StDiagnostic diag;
    EXPECT_FALSE(st_build_pou_registry(fixture.sources, kLibrary, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouRecursion);
    /* Vị trí phải trỏ dòng gọi, không phải dòng khai báo POU. */
    EXPECT_EQ(diag.line, 3);
}

TEST(StPouRegistry, IndirectRecursionIsRejectedForCyclesOfAnyLength)
{
    for (int length = 2; length <= 4; ++length) {
        Fixture fixture;
        for (int index = 0; index < length; ++index) {
            const std::string self = "P" + std::to_string(index);
            const std::string next = "P" + std::to_string((index + 1) % length);
            fixture.add(fn(self, self + " := " + next + "(x);\n"));
        }
        StPouRegistryResult result;
        StDiagnostic diag;
        EXPECT_FALSE(st_build_pou_registry(fixture.sources, kLibrary, &result, &diag))
            << "chu trình dài " << length;
        EXPECT_EQ(diag.code, st_diag_code::kPouRecursion) << "chu trình dài " << length;
        /* Thông điệp phải xác định: cùng nguồn thì cùng đỉnh được nêu tên. */
        EXPECT_NE(diag.message.find("P0"), std::string::npos) << diag.message;
    }
}

TEST(StPouRegistry, AcyclicDiamondIsAccepted)
{
    /* Hai đường tới cùng một callee KHÔNG phải chu trình — guard không được
     * nhầm chia sẻ với đệ quy, nếu không thì mọi thư viện dùng chung đều bị chặn. */
    Fixture fixture;
    fixture.add(fn("Top", "Top := Left(x) + Right(x);\n"));
    fixture.add(fn("Left", "Left := Shared(x);\n"));
    fixture.add(fn("Right", "Right := Shared(x);\n"));
    fixture.add(fn("Shared", "Shared := x;\n"));

    StPouRegistryResult result;
    StDiagnostic diag;
    ASSERT_TRUE(st_build_pou_registry(fixture.sources, kLibrary, &result, &diag))
        << diag.code << ": " << diag.message;
    EXPECT_EQ(result.topological_order.front(), "Shared");
    EXPECT_EQ(result.topological_order.back(), "Top");
}

TEST(StPouRegistry, MissingCalleeAndVersionDriftHaveDifferentCodes)
{
    /* Đây là điểm cốt lõi: "chưa có entry" và "sai version" cần hai hành động
     * sửa khác nhau nên không được gộp mã. */
    Fixture missing;
    missing.add(fn("Alpha", "Alpha := KhongTonTai(x);\n"));
    StPouRegistryResult result;
    StDiagnostic diag;
    EXPECT_FALSE(st_build_pou_registry(missing.sources, kLibrary, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kLibraryEntryMissing);

    Fixture drift;
    drift.add(fn("Alpha", "Alpha := Ramp(x);\n"), {{"Ramp", "9.9.9"}});
    EXPECT_FALSE(st_build_pou_registry(drift.sources, kLibrary, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kLibraryVersionDrift);
    EXPECT_NE(diag.message.find("1.0.0"), std::string::npos) << diag.message;
    EXPECT_NE(diag.message.find("9.9.9"), std::string::npos) << diag.message;

    Fixture pinned_missing;
    pinned_missing.add(fn("Alpha", "Alpha := x;\n"), {{"KhongTonTai", "1.0.0"}});
    EXPECT_FALSE(st_build_pou_registry(pinned_missing.sources, kLibrary, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kLibraryEntryMissing);
}

TEST(StPouRegistry, MatchingLibraryVersionIsAccepted)
{
    Fixture fixture;
    fixture.add(fn("Alpha", "Alpha := Ramp(x);\n"), {{"Ramp", "1.0.0"}});
    StPouRegistryResult result;
    StDiagnostic diag;
    EXPECT_TRUE(st_build_pou_registry(fixture.sources, kLibrary, &result, &diag))
        << diag.code << ": " << diag.message;
}

TEST(StPouRegistry, DuplicateAndAmbiguousNamesAreRejected)
{
    Fixture duplicate;
    duplicate.add(fn("Alpha", "Alpha := x;\n"));
    /* Trùng tên chỉ khác hoa/thường vẫn là trùng (DDD §4.2 case-folded). */
    duplicate.add(fn("ALPHA", "ALPHA := x;\n"));
    StPouRegistryResult result;
    StDiagnostic diag;
    EXPECT_FALSE(st_build_pou_registry(duplicate.sources, kLibrary, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);

    Fixture shadow;
    shadow.add(fn("Ramp", "Ramp := x;\n"));
    EXPECT_FALSE(st_build_pou_registry(shadow.sources, kLibrary, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);
    EXPECT_NE(diag.message.find("ambiguous"), std::string::npos) << diag.message;
}

TEST(StPouRegistry, CallsInsideNestedStatementsAreCollected)
{
    /* Lời gọi nằm trong nhánh IF hoặc trong đối số FB vẫn phải vào đồ thị —
     * bỏ sót một nhánh nghĩa là đệ quy lọt qua guard. */
    Fixture fixture;
    fixture.add(
        "FUNCTION_BLOCK Outer\n"
        "VAR_INPUT x : REAL; END_VAR\n"
        "VAR_OUTPUT y : REAL; END_VAR\n"
        "IF x > 0.0 THEN\n  y := Inner(x);\nELSE\n  y := 0.0;\nEND_IF;\n"
        "END_FUNCTION_BLOCK\n");
    fixture.add(fn("Inner", "Inner := Outer(x);\n"));

    StPouRegistryResult result;
    StDiagnostic diag;
    EXPECT_FALSE(st_build_pou_registry(fixture.sources, kLibrary, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouRecursion);
}

TEST(StPouRegistry, LibraryWithDuplicateEntryFailsClosed)
{
    const std::vector<StLibraryEntry> broken = {
        {"Ramp", StPouKind::FUNCTION, "1.0.0"},
        {"ramp", StPouKind::FUNCTION, "2.0.0"},
    };
    Fixture fixture;
    fixture.add(fn("Alpha", "Alpha := x;\n"));
    StPouRegistryResult result;
    StDiagnostic diag;
    EXPECT_FALSE(st_build_pou_registry(fixture.sources, broken, &result, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kLibraryVersionDrift);
}

} // namespace core
