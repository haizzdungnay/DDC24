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

TEST(StResolveIoBindings, AcceptsVpCategoryForInputDirection)
{
    /* F-PROG-ASBUILT-014 (phần READ đã đóng): Web API giờ đồng bộ giá trị
     * Virtual Point đã "bound" vào av_[]/bv_[]/msv_[] của Core qua WebIpc
     * `write` trước mỗi chu kỳ scan (xem apps/web-api/internal/app/virtualpoint.go),
     * nên VAR_INPUT bind category VP với point id dạng AV-n/BV-n/MSV-n phải
     * resolve được y hệt LOCAL, không còn bị từ chối tường minh. */
    StIrModule module = compile_ok(kAhuFanControl);
    StIoMapEntry entry = local_entry("SupplyTemp", "input", "AV-01", StType::REAL);
    entry.category = "VP";
    entry.writable = false;
    std::vector<StDiagnostic> diags;
    ASSERT_TRUE(resolve_io_bindings(&module, {entry}, &diags)) << (diags.empty() ? "" : diags[0].message);
    ASSERT_EQ(module.io_bindings.size(), 1u);
    EXPECT_EQ(module.io_bindings[0].point_kind, StPointKind::AV);
    EXPECT_EQ(module.io_bindings[0].point_index, 1);
    EXPECT_FALSE(module.io_bindings[0].is_output);
}

/* F-PROG-ASBUILT-016 — chiều GHI của Virtual Point NAY ĐƯỢC MỞ.
 *
 * Test này trước đây khẳng định điều ngược lại. Lý do cũ ghi trong mã là "chưa
 * có đường đồng bộ ngược Core->Web API", tức sợ chương trình ghi `av_[]`/`bv_[]`
 * mà giao diện không bao giờ đọc lại được. Lý do đó không còn đúng: Point
 * Catalog đọc THẲNG bảng điểm của Core, nên giá trị do chương trình ghi hiện
 * ngay ở API và UI; `PointTable::set_virtual` cũng đã nhận `PointSource::PROGRAM`
 * và ghi lại nguồn vào chính ô điểm.
 *
 * Ranh giới còn phải giữ KHÔNG nằm ở compiler mà ở quyền sở hữu slot: một VP do
 * chương trình ghi thì web-api không được đồng bộ giá trị cấu hình vào đó nữa,
 * nếu không hai bên ghi đè nhau mỗi chu kỳ. Điều đó do `virtualPoint.source`
 * giữ ở web-api. */
TEST(StResolveIoBindings, AcceptsVpCategoryForOutputDirection)
{
    StIrModule module = compile_ok(kAhuFanControl);
    StIoMapEntry entry = local_entry("FanEnable", "output", "BV-01", StType::BOOL);
    entry.category = "VP";
    std::vector<StDiagnostic> diags;
    EXPECT_TRUE(resolve_io_bindings(&module, {entry}, &diags))
        << (diags.empty() ? std::string("(khong co diagnostic)") : diags[0].message);
}

/* Mở chiều ghi KHÔNG có nghĩa là bỏ luật kiểu: `BV` là slot nhị phân, nên một
 * biến BOOL ghi vào `AV` (slot số thực) vẫn phải bị từ chối. */
TEST(StResolveIoBindings, RejectsVpOutputWithMismatchedSlotType)
{
    StIrModule module = compile_ok(kAhuFanControl);
    StIoMapEntry entry = local_entry("FanEnable", "output", "AV-01", StType::BOOL);
    entry.category = "VP";
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, {entry}, &diags));
    ASSERT_FALSE(diags.empty());
}

/* T59-303 gỡ chặn MB_RTU: nó KHÔNG còn là "category không hỗ trợ". Thứ vẫn phải
 * bị từ chối là entry MB_RTU CHƯA được Point Catalog phân giải slot — compiler
 * không đoán `extIndex`. Category ngoài allowlist mới là lỗi category. */
TEST(StResolveIoBindings, RejectsMbRtuWithoutResolvedExtIndex)
{
    StIrModule module = compile_ok(kAhuFanControl);
    StIoMapEntry entry = local_entry("SupplyTemp", "input", "TEMP1", StType::REAL);
    entry.category = "MB_RTU";
    entry.device_id = "bus1";
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, {entry}, &diags));
    ASSERT_FALSE(diags.empty());
    EXPECT_EQ(diags[0].code, st_diag_code::kIoMapBadPointId);
}

TEST(StResolveIoBindings, RejectsCategoryOutsideAllowlist)
{
    StIrModule module = compile_ok(kAhuFanControl);
    StIoMapEntry entry = local_entry("SupplyTemp", "input", "AV-01", StType::REAL);
    entry.category = "BACNET";
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
