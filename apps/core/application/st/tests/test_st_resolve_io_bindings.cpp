/**
 * @file  test_st_resolve_io_bindings.cpp
 * @brief F-PROG-ASBUILT-013/D-07 (REV-PROG-ASBUILT-GAP-2026-08-14):
 *        resolve_io_bindings() — nối io_map đã validate vào StIrModule.io_bindings
 *        trước khi encode artifact. Trước hàm này, io_bindings luôn rỗng bất
 *        kể Mapping tab cấu hình đúng đến đâu, nên không Program Rev A nào
 *        từng điều khiển được output vật lý thật.
 *
 *        Positive case dùng đúng kịch bản tái hiện thật trên board Foxlinx
 *        (AHU_FanControl: FanEnable BOOL -> DO-01, FanSpeed REAL -> AO-01).
 *        Negative case AlarmHigh/UI-09 là lỗi thật đã gặp: BOOL VAR_OUTPUT bị
 *        map nhầm vào Point INPUT-only.
 */
#include <gtest/gtest.h>

#include "st/st_compile.hpp"
#include "st/st_io_map.hpp"

using namespace core;

namespace {

const char* kAhuFanControl = R"ST(
PROGRAM AHU_FanControl
VAR_INPUT
    SupplyTemp : REAL;
END_VAR
VAR_OUTPUT
    FanEnable : BOOL;
    FanSpeed  : REAL;
    AlarmHigh : BOOL;
END_VAR
    FanEnable := SupplyTemp > 24.0;
    FanSpeed := 42.0;
    AlarmHigh := SupplyTemp > 30.0;
END_PROGRAM
)ST";

StIrModule compile_ok(const char* src)
{
    StIrModule module;
    StDiagnostic diag;
    if (!compile_st_source(src, &module, &diag))
        ADD_FAILURE() << "compile failed: " << diag.code << " " << diag.message;
    return module;
}

StIoMapEntry local_entry(std::string variable, std::string direction, std::string point_id,
                         StType type)
{
    StIoMapEntry e;
    e.variable = std::move(variable);
    e.direction = std::move(direction);
    e.point_id = std::move(point_id);
    e.type = type;
    e.category = "LOCAL";
    e.writable = true;
    return e;
}

} // namespace

TEST(StResolveIoBindings, ResolvesValidLocalOutputsMatchingRealBoardScenario)
{
    StIrModule module = compile_ok(kAhuFanControl);
    ASSERT_TRUE(module.io_bindings.empty());

    const std::vector<StIoMapEntry> entries = {
        local_entry("SupplyTemp", "input", "UI-01", StType::REAL),
        local_entry("FanEnable", "output", "DO-01", StType::BOOL),
        local_entry("FanSpeed", "output", "AO-01", StType::REAL),
    };
    std::vector<StDiagnostic> diags;
    ASSERT_TRUE(resolve_io_bindings(&module, entries, &diags)) << (diags.empty() ? "" : diags[0].message);
    EXPECT_TRUE(diags.empty());
    ASSERT_EQ(module.io_bindings.size(), 3u);

    /* slot phải khớp đúng biến đã compile — không phải thứ tự entries. */
    std::unordered_map<uint16_t, StIrIoBinding> by_slot;
    for (const StIrIoBinding& b : module.io_bindings) by_slot[b.slot] = b;
    for (const StIrVariable& v : module.variables) {
        if (v.name == "FanEnable") {
            ASSERT_TRUE(by_slot.count(v.slot));
            EXPECT_TRUE(by_slot[v.slot].is_output);
            EXPECT_EQ(by_slot[v.slot].point_kind, StPointKind::DO);
            EXPECT_EQ(by_slot[v.slot].point_index, 1);
        }
        if (v.name == "FanSpeed") {
            ASSERT_TRUE(by_slot.count(v.slot));
            EXPECT_EQ(by_slot[v.slot].point_kind, StPointKind::AO);
        }
        if (v.name == "SupplyTemp") {
            ASSERT_TRUE(by_slot.count(v.slot));
            EXPECT_FALSE(by_slot[v.slot].is_output);
            EXPECT_EQ(by_slot[v.slot].point_kind, StPointKind::UI);
        }
    }
}

TEST(StResolveIoBindings, PartialBindingAllowedUnlikeStrictValidateIoMap)
{
    /* UC-05 hiện hành: Mapping tab cho map từng biến một. AlarmHigh cố tình
     * KHÔNG có entry — phải vẫn OK, không đòi map hết như validate_io_map(). */
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("FanEnable", "output", "DO-01", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    ASSERT_TRUE(resolve_io_bindings(&module, entries, &diags));
    EXPECT_EQ(module.io_bindings.size(), 1u);
}

TEST(StResolveIoBindings, EmptyIoMapProducesEmptyBindings)
{
    StIrModule module = compile_ok(kAhuFanControl);
    std::vector<StDiagnostic> diags;
    ASSERT_TRUE(resolve_io_bindings(&module, {}, &diags));
    EXPECT_TRUE(module.io_bindings.empty());
}

TEST(StResolveIoBindings, RejectsUnknownVariable)
{
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("DoesNotExist", "output", "DO-01", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapUnknownVar);
}

TEST(StResolveIoBindings, RejectsTypeMismatch)
{
    /* Đúng lớp lỗi thật: FanSpeed là REAL, gửi entry khai BOOL. */
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("FanSpeed", "output", "DO-01", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapTypeMismatch);
}

TEST(StResolveIoBindings, RejectsDirectionFieldNotMatchingDeclaredStorage)
{
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("FanEnable", "input", "DO-01", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapBadDirection);
}

TEST(StResolveIoBindings, RejectsOutputBoundToInputOnlyPointKind_RegressionAlarmHighUi09)
{
    /* Lỗi thật đã gặp trên board Foxlinx 2026-08-14: AlarmHigh (BOOL,
     * VAR_OUTPUT) bị map vào LOCAL:UI-09 — UI là Universal Input, không ghi
     * được. DI-01 dùng ở đây để cô lập đúng lỗi "point kind không cho output"
     * khỏi lỗi type mismatch (UI vốn còn sai cả type REAL != BOOL). */
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("AlarmHigh", "output", "DI-01", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapBadDirection);
}

TEST(StResolveIoBindings, RejectsOutputBoundToUiWithWrongTypeExactBoardBug)
{
    /* Tái hiện Y HỆT dữ liệu thật trên board: BOOL -> LOCAL:UI-09. */
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("AlarmHigh", "output", "UI-09", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapBadDirection);
}

TEST(StResolveIoBindings, RejectsDuplicateBindingForSameVariable)
{
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("FanEnable", "output", "DO-01", StType::BOOL),
        local_entry("FanEnable", "output", "DO-02", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapDuplicateBinding);
}

TEST(StResolveIoBindings, RejectsTwoVariablesClaimingSamePhysicalOutput)
{
    /* "Một output vật lý chỉ một người ghi" (PROGRAM_SOM_FW_DRAFT_DESIGN §8,
     * đã enforce ở loader — compiler phải chặn SỚM HƠN, tại Check, không đợi
     * tới lúc load artifact mới phát hiện. */
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("FanEnable", "output", "DO-01", StType::BOOL),
        local_entry("AlarmHigh", "output", "DO-01", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapDuplicateBinding);
}

TEST(StResolveIoBindings, RejectsUnsupportedCategoryVp)
{
    /* F-PROG-ASBUILT-014: VP không có đường dẫn runtime thật tới Core trong
     * Rev A hiện hành (overlay cấu hình phía Web API, không ghi được SHM
     * AV/BV mà Core đọc) — compiler phải từ chối rõ ràng, không âm thầm ghi
     * vào raw AV/BV slot mà VP catalog không hề đọc. */
    StIrModule module = compile_ok(kAhuFanControl);
    StIoMapEntry entry = local_entry("SupplyTemp", "input", "AV1", StType::REAL);
    entry.category = "VP";
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, {entry}, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapUnsupportedCategory);
}

TEST(StResolveIoBindings, RejectsUnsupportedCategoryMbRtu)
{
    StIrModule module = compile_ok(kAhuFanControl);
    StIoMapEntry entry = local_entry("SupplyTemp", "input", "TEMP1", StType::REAL);
    entry.category = "MB_RTU";
    entry.device_id = "bus1";
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, {entry}, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapUnsupportedCategory);
}

TEST(StResolveIoBindings, RejectsPointIndexOutOfRange)
{
    /* KX_N_DO = 4 (mkddc_shm.h) — DO-05 không tồn tại trên board Rev A. */
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> entries = {
        local_entry("FanEnable", "output", "DO-05", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, entries, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapBadPointId);
}

TEST(StResolveIoBindings, FailureLeavesModuleIoBindingsUnchanged)
{
    StIrModule module = compile_ok(kAhuFanControl);
    const std::vector<StIoMapEntry> good = {
        local_entry("FanEnable", "output", "DO-01", StType::BOOL),
    };
    std::vector<StDiagnostic> diags;
    ASSERT_TRUE(resolve_io_bindings(&module, good, &diags));
    ASSERT_EQ(module.io_bindings.size(), 1u);
    const StIrIoBinding before = module.io_bindings[0];

    const std::vector<StIoMapEntry> bad = {
        local_entry("DoesNotExist", "output", "DO-02", StType::BOOL),
    };
    EXPECT_FALSE(resolve_io_bindings(&module, bad, &diags));
    ASSERT_EQ(module.io_bindings.size(), 1u) << "module không được đổi khi resolve fail";
    EXPECT_EQ(module.io_bindings[0].point_index, before.point_index);
}
