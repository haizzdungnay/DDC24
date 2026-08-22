/**
 * @file  test_st_io_map.cpp
 * @brief FW SOM IEC programming foundation, item 4: io_map validator —
 *        variable tồn tại, direction/type khớp, point_id format, range hợp
 *        lệ, unbound variable bị reject trước build/activation.
 */
#include <gtest/gtest.h>

#include "st/st_io_map.hpp"
#include "st/st_parser.hpp"
#include "st/st_semantic.hpp"

using namespace core;

namespace {

StProgram parse_ok(const char* src)
{
    StProgram p;
    StDiagnostic diag;
    if (!parse_st_program(src, &p, &diag)) ADD_FAILURE() << "parse failed: " << diag.message;
    if (!typecheck_st_program(&p, &diag)) ADD_FAILURE() << "typecheck failed: " << diag.message;
    return p;
}

const char* kHvac = R"ST(
PROGRAM HVAC_CTRL
VAR_INPUT
    SupplyTemp : REAL;
    Setpoint : REAL;
END_VAR
VAR_OUTPUT
    FanEnable : BOOL;
END_VAR
IF SupplyTemp > Setpoint THEN
    FanEnable := TRUE;
ELSE
    FanEnable := FALSE;
END_IF;
END_PROGRAM
)ST";

std::vector<StIoMapEntry> valid_entries()
{
    return {
        {"SupplyTemp", "input", "UI-01", StType::REAL, "degC", true, -40.0f, 120.0f},
        {"Setpoint", "input", "UI-02", StType::REAL, "degC", false, 0.0f, 0.0f},
        {"FanEnable", "output", "DO-01", StType::BOOL, "", false, 0.0f, 0.0f},
    };
}

} // namespace

TEST(StIoMap, PointIdFormatValidation)
{
    EXPECT_TRUE(valid_st_point_id("UI-01"));
    EXPECT_TRUE(valid_st_point_id("DO-1"));
    EXPECT_TRUE(valid_st_point_id("AO-123"));
    EXPECT_TRUE(valid_st_point_id("DI-9"));
    EXPECT_FALSE(valid_st_point_id("ui-01")) << "phải chữ hoa";
    EXPECT_FALSE(valid_st_point_id("XX-01")) << "prefix không hợp lệ";
    EXPECT_FALSE(valid_st_point_id("UI01")) << "thiếu dấu '-'";
    EXPECT_FALSE(valid_st_point_id("UI-0")) << "kênh phải > 0";
    EXPECT_FALSE(valid_st_point_id("UI-")) << "thiếu số";
    EXPECT_FALSE(valid_st_point_id("UI-1a")) << "ký tự không phải số";
    EXPECT_FALSE(valid_st_point_id("")) << "rỗng";
}

TEST(StIoMap, ValidCompleteMapPasses)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StDiagnostic> diags;
    EXPECT_TRUE(validate_io_map(prog, valid_entries(), &diags));
    EXPECT_TRUE(diags.empty());
}

TEST(StIoMap, AcceptsExactlyThreePointCategoriesWithDiscriminatedIdentity)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[0].category = "VP";
    entries[0].point_id = "AV-01";
    entries[1].category = "MB_RTU";
    entries[1].device_id = "PUMP_VFD-01";
    entries[1].point_id = "speed_ref";
    /* T59-303: slot EXT do Point Catalog phân giải; thiếu nó là dữ liệu chưa
     * đủ, không phải identity hợp lệ. */
    entries[1].ext_index = 9;
    std::vector<StDiagnostic> diags;
    EXPECT_TRUE(validate_io_map(prog, entries, &diags));
    EXPECT_TRUE(diags.empty());
}

TEST(StIoMap, RejectsModbusRtuFlatIdentityAndOutOfScopeCategory)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[0].category = "MB_RTU";
    entries[0].point_id = "MB-042";
    entries[0].device_id.clear();
    entries[1].category = "BACNET";
    entries[1].point_id = "AV-01";
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    EXPECT_GE(diags.size(), 2u);
    for (const StDiagnostic& d : diags)
        EXPECT_EQ(d.code, st_diag_code::kIoMapBadPointId);
}

TEST(StIoMap, RejectsPointKindTypeAndWritableMismatch)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[0].category = "VP";
    entries[0].point_id = "BV-01"; /* SupplyTemp REAL không bind BV */
    entries[2].writable = false;    /* output không bind Point read-only */
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool type_mismatch = false;
    bool bad_direction = false;
    for (const StDiagnostic& d : diags) {
        if (d.code == st_diag_code::kIoMapTypeMismatch) type_mismatch = true;
        if (d.code == st_diag_code::kIoMapBadDirection) bad_direction = true;
    }
    EXPECT_TRUE(type_mismatch);
    EXPECT_TRUE(bad_direction);
}

TEST(StIoMap, RejectsUnknownVariable)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries.push_back({"NotDeclared", "input", "UI-03", StType::REAL, "", false, 0, 0});
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags) if (d.code == st_diag_code::kIoMapUnknownVar) found = true;
    EXPECT_TRUE(found);
}

TEST(StIoMap, RejectsDirectionMismatch)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[0].direction = "output";   /* SupplyTemp thực ra là input */
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags) if (d.code == st_diag_code::kIoMapBadDirection) found = true;
    EXPECT_TRUE(found);
}

TEST(StIoMap, RejectsInvalidDirectionString)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[0].direction = "inout";
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapBadDirection);
}

TEST(StIoMap, RejectsTypeMismatch)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[2].type = StType::REAL;   /* FanEnable thực ra là BOOL */
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags) if (d.code == st_diag_code::kIoMapTypeMismatch) found = true;
    EXPECT_TRUE(found);
}

TEST(StIoMap, RejectsInvalidPointId)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[0].point_id = "not-a-point";
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags) if (d.code == st_diag_code::kIoMapBadPointId) found = true;
    EXPECT_TRUE(found);
}

TEST(StIoMap, RejectsRangeMinGreaterEqualMax)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[0].range_min = 100.0f;
    entries[0].range_max = 50.0f;
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags) if (d.code == st_diag_code::kIoMapBadRange) found = true;
    EXPECT_TRUE(found);
}

TEST(StIoMap, RejectsRangeOnBoolVariable)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries[2].has_range = true;
    entries[2].range_min = 0.0f;
    entries[2].range_max = 1.0f;
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags) if (d.code == st_diag_code::kIoMapBadRange) found = true;
    EXPECT_TRUE(found);
}

TEST(StIoMap, RejectsMissingBindingForDeclaredVariable)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries.pop_back();   /* bỏ binding cho FanEnable */
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags)
        if (d.code == st_diag_code::kIoMapMissingBinding && d.message.find("FanEnable") != std::string::npos)
            found = true;
    EXPECT_TRUE(found) << "VAR_OUTPUT không có binding phải bị reject trước build/activation";
}

TEST(StIoMap, RejectsDuplicateBindingForSameVariable)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StIoMapEntry> entries = valid_entries();
    entries.push_back({"SupplyTemp", "input", "UI-09", StType::REAL, "degC", false, 0, 0});
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, entries, &diags));
    bool found = false;
    for (const StDiagnostic& d : diags) if (d.code == st_diag_code::kIoMapDuplicateBinding) found = true;
    EXPECT_TRUE(found);
}

TEST(StIoMap, EmptyMapReportsAllDeclaredVariablesMissing)
{
    const StProgram prog = parse_ok(kHvac);
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(validate_io_map(prog, {}, &diags));
    EXPECT_EQ(diags.size(), 3u) << "3 biến khai báo (SupplyTemp/Setpoint/FanEnable), mỗi biến 1 lỗi missing-binding";
}
