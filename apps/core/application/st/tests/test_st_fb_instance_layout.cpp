/**
 * @file  test_st_fb_instance_layout.cpp
 * @brief T59-104 — layout state instance FB, quyền sở hữu RETAIN, identity ổn định.
 *
 *        Bất biến đắt giá nhất ở đây là ỔN ĐỊNH KHI SẮP XẾP LẠI NGUỒN: nếu đổi
 *        thứ tự khai báo làm đổi offset hay identity, thì mỗi lần chỉnh sửa vô
 *        hại sẽ gây RETAIN mismatch và cold-init toàn bộ state đang chạy. Test
 *        đầu tiên khoá đúng điều đó.
 */
#include <gtest/gtest.h>

#include <memory>
#include <set>
#include <string>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_fb_instance_layout.hpp"
#include "st/st_parser.hpp"
#include "st/st_profile_generated.hpp"

namespace core {
namespace {

const std::vector<StLibraryEntry> kLibrary = {
    {"LibLatch", StPouKind::FUNCTION_BLOCK, "1.0.0"},
    {"LibScale", StPouKind::FUNCTION, "1.0.0"},
};

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

struct Fixture {
    std::vector<std::unique_ptr<StProgram>> owned;
    std::vector<StPouSource> sources;

    bool add(const std::string& source)
    {
        auto pou = parse_or_die(source);
        if (pou == nullptr) return false;
        owned.push_back(std::move(pou));
        sources.push_back({owned.back().get(), {}});
        return true;
    }
};

const StFbInstanceNode* find(const StFbLayoutResult& layout, const std::string& path)
{
    for (const StFbInstanceNode& node : layout.instances)
        if (node.path == path) return &node;
    return nullptr;
}

std::string block(const std::string& name, const std::string& body)
{
    return "FUNCTION_BLOCK " + name + "\n"
           "VAR_INPUT x : REAL; END_VAR\n"
           "VAR_OUTPUT y : REAL; END_VAR\n" + body +
           "y := x;\nEND_FUNCTION_BLOCK\n";
}

} // namespace

TEST(StFbInstanceLayout, LayoutIsStableWhenSourceDeclarationsAreReordered)
{
    /* Cùng tập instance, hai thứ tự khai báo ngược nhau. Offset và identity phải
     * giống hệt — nếu không, sắp xếp lại nguồn sẽ cold-init state đang chạy. */
    Fixture forward, backward;
    ASSERT_TRUE(forward.add(
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
        "VAR alpha : TON; bravo : TOF; charlie : R_TRIG; END_VAR\n"
        "y := 1.0;\nEND_PROGRAM\n"));
    ASSERT_TRUE(backward.add(
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
        "VAR charlie : R_TRIG; bravo : TOF; alpha : TON; END_VAR\n"
        "y := 1.0;\nEND_PROGRAM\n"));

    StFbLayoutResult first, second;
    StDiagnostic diag;
    ASSERT_TRUE(st_plan_fb_instance_layout(forward.sources, kLibrary, &first, &diag))
        << diag.code << ": " << diag.message;
    ASSERT_TRUE(st_plan_fb_instance_layout(backward.sources, kLibrary, &second, &diag))
        << diag.code << ": " << diag.message;

    ASSERT_EQ(first.instances.size(), 3U);
    EXPECT_EQ(first.layout_identity, second.layout_identity);
    EXPECT_EQ(first.total_state_bytes, second.total_state_bytes);
    for (std::size_t index = 0; index < first.instances.size(); ++index) {
        EXPECT_EQ(first.instances[index].path, second.instances[index].path);
        EXPECT_EQ(first.instances[index].state_offset, second.instances[index].state_offset);
        EXPECT_EQ(first.instances[index].identity, second.instances[index].identity);
    }
}

TEST(StFbInstanceLayout, InstancesDoNotOverlapAndEachHasOneOwner)
{
    Fixture fixture;
    ASSERT_TRUE(fixture.add(block("Inner", "VAR t : TON; END_VAR\n")));
    ASSERT_TRUE(fixture.add(
        "PROGRAM Alpha\nVAR_OUTPUT y : REAL; END_VAR\n"
        "VAR a : Inner; b : Inner; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    ASSERT_TRUE(fixture.add(
        "PROGRAM Bravo\nVAR_OUTPUT y : REAL; END_VAR\n"
        "VAR a : Inner; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));

    StFbLayoutResult layout;
    StDiagnostic diag;
    ASSERT_TRUE(st_plan_fb_instance_layout(fixture.sources, kLibrary, &layout, &diag))
        << diag.code << ": " << diag.message;

    /* Alpha.a, Alpha.a.t, Alpha.b, Alpha.b.t, Bravo.a, Bravo.a.t */
    ASSERT_EQ(layout.instances.size(), 6U);

    /* Không vùng state nào chồng lên vùng khác — cùng một FB type dùng hai lần
     * vẫn là hai state riêng. */
    std::vector<std::pair<uint32_t, uint32_t>> ranges;
    std::set<std::string> paths;
    for (const StFbInstanceNode& node : layout.instances) {
        EXPECT_TRUE(paths.insert(node.path).second) << "trùng path " << node.path;
        if (node.state_size == 0) continue;
        for (const auto& range : ranges) {
            const bool overlap = node.state_offset < range.second &&
                                 range.first < node.state_offset + node.state_size;
            EXPECT_FALSE(overlap) << node.path << " chồng vùng state khác";
        }
        ranges.push_back({node.state_offset, node.state_offset + node.state_size});
    }

    /* Mỗi state thuộc đúng một Program owner (DDD §4.4). */
    EXPECT_EQ(find(layout, "Alpha.a")->owner_program, "Alpha");
    EXPECT_EQ(find(layout, "Alpha.a.t")->owner_program, "Alpha");
    EXPECT_EQ(find(layout, "Bravo.a")->owner_program, "Bravo");
    /* Cùng tên instance nhưng khác Program là hai identity khác nhau. */
    EXPECT_NE(find(layout, "Alpha.a")->identity, find(layout, "Bravo.a")->identity);
}

TEST(StFbInstanceLayout, RenamingAnInstanceChangesOnlyItsOwnIdentity)
{
    Fixture original, renamed;
    ASSERT_TRUE(original.add(
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\nVAR alpha : TON; zulu : TOF; END_VAR\n"
        "y := 1.0;\nEND_PROGRAM\n"));
    ASSERT_TRUE(renamed.add(
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\nVAR alpha : TON; yankee : TOF; END_VAR\n"
        "y := 1.0;\nEND_PROGRAM\n"));

    StFbLayoutResult before, after;
    StDiagnostic diag;
    ASSERT_TRUE(st_plan_fb_instance_layout(original.sources, kLibrary, &before, &diag));
    ASSERT_TRUE(st_plan_fb_instance_layout(renamed.sources, kLibrary, &after, &diag));

    EXPECT_EQ(find(before, "Main.alpha")->identity, find(after, "Main.alpha")->identity);
    EXPECT_EQ(find(before, "Main.alpha")->state_offset, find(after, "Main.alpha")->state_offset);
    /* Đổi tên là đổi identity — layout identity phải đổi theo để runtime cold-init
     * đúng phần đã đổi thay vì đọc nhầm state cũ. */
    EXPECT_NE(before.layout_identity, after.layout_identity);
    EXPECT_EQ(find(after, "Main.zulu"), nullptr);
}

TEST(StFbInstanceLayout, LayoutIdentityChangesWhenTypeChanges)
{
    Fixture ton, tof;
    ASSERT_TRUE(ton.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\nVAR a : TON; END_VAR\n"
                        "y := 1.0;\nEND_PROGRAM\n"));
    ASSERT_TRUE(tof.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\nVAR a : R_TRIG; END_VAR\n"
                        "y := 1.0;\nEND_PROGRAM\n"));
    StFbLayoutResult first, second;
    StDiagnostic diag;
    ASSERT_TRUE(st_plan_fb_instance_layout(ton.sources, kLibrary, &first, &diag));
    ASSERT_TRUE(st_plan_fb_instance_layout(tof.sources, kLibrary, &second, &diag));
    EXPECT_NE(first.layout_identity, second.layout_identity);
    EXPECT_NE(find(first, "Main.a")->identity, find(second, "Main.a")->identity);
}

TEST(StFbInstanceLayout, RetainOwnershipIsTrackedPerInstance)
{
    Fixture fixture;
    ASSERT_TRUE(fixture.add(
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
        "VAR plain : TON; END_VAR\nVAR RETAIN kept : TON; END_VAR\n"
        "y := 1.0;\nEND_PROGRAM\n"));
    StFbLayoutResult layout;
    StDiagnostic diag;
    ASSERT_TRUE(st_plan_fb_instance_layout(fixture.sources, kLibrary, &layout, &diag))
        << diag.code << ": " << diag.message;
    EXPECT_FALSE(find(layout, "Main.plain")->retained);
    EXPECT_TRUE(find(layout, "Main.kept")->retained);
    /* Chỉ instance RETAIN mới tính vào ngân sách RETAIN. */
    EXPECT_EQ(layout.retain_state_bytes, find(layout, "Main.kept")->state_size);
    EXPECT_LT(layout.retain_state_bytes, layout.total_state_bytes);
}

TEST(StFbInstanceLayout, ContainmentCycleIsRejected)
{
    Fixture direct;
    ASSERT_TRUE(direct.add(block("Loop", "VAR self : Loop; END_VAR\n")));
    ASSERT_TRUE(direct.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
                           "VAR a : Loop; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    StFbLayoutResult layout;
    StDiagnostic diag;
    EXPECT_FALSE(st_plan_fb_instance_layout(direct.sources, kLibrary, &layout, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouRecursion);

    Fixture indirect;
    ASSERT_TRUE(indirect.add(block("Ping", "VAR next : Pong; END_VAR\n")));
    ASSERT_TRUE(indirect.add(block("Pong", "VAR next : Ping; END_VAR\n")));
    ASSERT_TRUE(indirect.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
                             "VAR a : Ping; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    EXPECT_FALSE(st_plan_fb_instance_layout(indirect.sources, kLibrary, &layout, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouRecursion);
}

TEST(StFbInstanceLayout, InstantiatingAFunctionOrProgramIsRejected)
{
    Fixture function_type;
    ASSERT_TRUE(function_type.add(
        "FUNCTION Helper : REAL\nVAR_INPUT x : REAL; END_VAR\nHelper := x;\nEND_FUNCTION\n"));
    ASSERT_TRUE(function_type.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
                                  "VAR a : Helper; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    StFbLayoutResult layout;
    StDiagnostic diag;
    EXPECT_FALSE(st_plan_fb_instance_layout(function_type.sources, kLibrary, &layout, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);
    EXPECT_NE(diag.message.find("FUNCTION"), std::string::npos) << diag.message;

    /* Entry library kind FUNCTION cũng không instantiate được. */
    Fixture library_function;
    ASSERT_TRUE(library_function.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
                                     "VAR a : LibScale; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    EXPECT_FALSE(st_plan_fb_instance_layout(library_function.sources, kLibrary, &layout, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);
}

TEST(StFbInstanceLayout, UnknownInstanceTypeIsRejectedAsMissingLibraryEntry)
{
    Fixture fixture;
    ASSERT_TRUE(fixture.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
                            "VAR a : KhongTonTai; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    StFbLayoutResult layout;
    StDiagnostic diag;
    EXPECT_FALSE(st_plan_fb_instance_layout(fixture.sources, kLibrary, &layout, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kLibraryEntryMissing);
}

TEST(StFbInstanceLayout, LibraryFunctionBlockInstanceIsAcceptedWithoutGuessingItsSize)
{
    /* Kích thước state của entry library đến cùng artifact library (T59-204).
     * Đoán một con số ở đây sẽ làm lệch mọi offset phía sau, nên ghi 0 và nói rõ. */
    Fixture fixture;
    ASSERT_TRUE(fixture.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
                            "VAR a : LibLatch; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    StFbLayoutResult layout;
    StDiagnostic diag;
    ASSERT_TRUE(st_plan_fb_instance_layout(fixture.sources, kLibrary, &layout, &diag))
        << diag.code << ": " << diag.message;
    const StFbInstanceNode* node = find(layout, "Main.a");
    ASSERT_NE(node, nullptr);
    EXPECT_TRUE(node->is_library_type);
    EXPECT_EQ(node->state_size, 0U);
}

TEST(StFbInstanceLayout, PerProgramInstanceCapIsEnforcedAtTheBoundary)
{
    const std::size_t limit = st_profile_generated::kMaxFunctionBlocks;
    auto build_program = [](std::size_t count) {
        std::string decls;
        for (std::size_t index = 0; index < count; ++index)
            decls += "  i" + std::to_string(index) + " : TON;\n";
        return "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\nVAR\n" + decls +
               "END_VAR\ny := 1.0;\nEND_PROGRAM\n";
    };

    Fixture at_limit;
    ASSERT_TRUE(at_limit.add(build_program(limit)));
    StFbLayoutResult layout;
    StDiagnostic diag;
    EXPECT_TRUE(st_plan_fb_instance_layout(at_limit.sources, kLibrary, &layout, &diag))
        << diag.code << ": " << diag.message;
    EXPECT_EQ(layout.instances.size(), limit);

    /* Một-trên-trần: parser chặn trước bằng `ST-LIM-007`, đó là hành vi thật và
     * test khoá đúng nó thay vì ép thêm một nhánh trùng lặp ở layout. */
    auto over = std::make_unique<StProgram>();
    StDiagnostic parse_diag;
    EXPECT_FALSE(parse_st_pou(build_program(limit + 1), over.get(), &parse_diag));
    EXPECT_EQ(parse_diag.code, st_diag_code::kTooManyFbInstances);
}

TEST(StFbInstanceLayout, HundredInstancesKeepDisjointStateAndUniqueIdentity)
{
    /* Acceptance nêu rõ 100 instance phải cô lập nhau. Trần MỘT Program là 64
     * (`kMaxFunctionBlocks`), nên 100 instance nhất thiết trải trên nhiều Program
     * — và đó đúng là trường hợp đáng kiểm: cô lập phải giữ được cả khi hai
     * Program dùng trùng tên instance. */
    std::string decls;
    for (int index = 0; index < 50; ++index)
        decls += "  i" + std::to_string(index) + " : TON;\n";
    Fixture fixture;
    for (const char* name : {"Alpha", "Bravo"}) {
        ASSERT_TRUE(fixture.add(std::string("PROGRAM ") + name +
                                "\nVAR_OUTPUT y : REAL; END_VAR\nVAR\n" + decls +
                                "END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    }

    StFbLayoutResult layout;
    StDiagnostic diag;
    ASSERT_TRUE(st_plan_fb_instance_layout(fixture.sources, kLibrary, &layout, &diag))
        << diag.code << ": " << diag.message;
    ASSERT_EQ(layout.instances.size(), 100U);

    std::set<std::string> identities;
    uint32_t previous_end = 0;
    for (const StFbInstanceNode& node : layout.instances) {
        EXPECT_GT(node.state_size, 0U) << node.path;
        EXPECT_GE(node.state_offset, previous_end) << node.path << " chồng vùng trước";
        previous_end = node.state_offset + node.state_size;
        identities.insert(std::string(reinterpret_cast<const char*>(node.identity.data()),
                                      node.identity.size()));
    }
    EXPECT_EQ(identities.size(), 100U) << "có identity trùng nhau";
    EXPECT_EQ(layout.total_state_bytes, previous_end);
}

TEST(StFbInstanceLayout, PackageInstanceCapIsEnforcedAcrossPrograms)
{
    /* Trần 1024 là trần CẤP PACKAGE: từng PROGRAM đều dưới trần 64 của mình mà
     * tổng vẫn có thể vượt. Nếu chỉ kiểm cấp Program thì trần package vô nghĩa. */
    const std::size_t per_program = st_profile_generated::kMaxFunctionBlocks;
    const std::size_t package_cap = st_profile_generated::kMaxFunctionBlockInstances;
    const std::size_t programs = (package_cap / per_program) + 1;

    std::string decls;
    for (std::size_t index = 0; index < per_program; ++index)
        decls += "  i" + std::to_string(index) + " : TON;\n";

    Fixture fixture;
    for (std::size_t index = 0; index < programs; ++index) {
        ASSERT_TRUE(fixture.add("PROGRAM P" + std::to_string(index) +
                                "\nVAR_OUTPUT y : REAL; END_VAR\nVAR\n" + decls +
                                "END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    }
    ASSERT_GT(programs * per_program, package_cap);

    StFbLayoutResult layout;
    StDiagnostic diag;
    EXPECT_FALSE(st_plan_fb_instance_layout(fixture.sources, kLibrary, &layout, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouInstanceLayout);
    EXPECT_NE(diag.message.find(std::to_string(package_cap)), std::string::npos)
        << diag.message;
}

TEST(StFbInstanceLayout, NestingDepthIsBounded)
{
    /* Cây hợp lệ nhưng sâu vô hạn vẫn phải bị chặn — vòng chứa đã bắt riêng, đây
     * là trần cho trường hợp không có vòng. */
    Fixture fixture;
    const std::size_t depth = st_fb_layout::kMaxNestingDepth + 2;
    for (std::size_t index = 0; index < depth; ++index) {
        const std::string name = "L" + std::to_string(index);
        const std::string body = (index + 1 < depth)
                                     ? "VAR next : L" + std::to_string(index + 1) + "; END_VAR\n"
                                     : "";
        ASSERT_TRUE(fixture.add(block(name, body)));
    }
    ASSERT_TRUE(fixture.add("PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
                            "VAR a : L0; END_VAR\ny := 1.0;\nEND_PROGRAM\n"));
    StFbLayoutResult layout;
    StDiagnostic diag;
    EXPECT_FALSE(st_plan_fb_instance_layout(fixture.sources, kLibrary, &layout, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouRecursion);
}

} // namespace core
