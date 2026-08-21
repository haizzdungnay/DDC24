/**
 * @file  test_st_mb_rtu_binding.cpp
 * @brief T59-303 — binding MB_RTU đi qua Point contract canonical.
 *
 *        Điểm mấu chốt: compiler KHÔNG định nghĩa lại giao thức. Nó không biết
 *        register, function code, endian hay chu kỳ poll — nó chỉ nhận
 *        `(deviceId, pointId, extIndex)` mà Point Catalog đã phân giải. Bộ test
 *        này khoá đúng ranh giới đó: nhận khi Catalog đã phân giải, TỪ CHỐI khi
 *        chưa, và không có nhánh nào tự đoán slot.
 */
#include <gtest/gtest.h>

#include <unordered_map>

#include "st/st_compile.hpp"
#include "st/st_io_map.hpp"

using namespace core;

namespace {

const char* kModbusProgram = R"ST(
PROGRAM MbRtuDemo
VAR_INPUT
    ReturnTemp : REAL;
END_VAR
VAR_OUTPUT
    ValveCmd : REAL;
END_VAR
    ValveCmd := ReturnTemp;
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

StIoMapEntry mb_entry(std::string variable, std::string direction, std::string point_id,
                      StType type, uint16_t ext_index, bool writable = true)
{
    StIoMapEntry e;
    e.variable = std::move(variable);
    e.direction = std::move(direction);
    e.point_id = std::move(point_id);
    e.type = type;
    e.category = "MB_RTU";
    e.device_id = "mb-rtu-1";
    e.ext_index = ext_index;
    e.writable = writable;
    return e;
}

StIoMapEntry local_entry(std::string variable, std::string direction, std::string point_id, StType type)
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

const StIrIoBinding* binding_for(const StIrModule& module, const char* name)
{
    for (const StIrVariable& variable : module.variables) {
        if (variable.name != name) continue;
        for (const StIrIoBinding& binding : module.io_bindings)
            if (binding.slot == variable.slot) return &binding;
    }
    return nullptr;
}

} // namespace

/* Chiều khẳng định: MB_RTU đọc và ghi đều resolve được, và slot đi thẳng từ
 * `ext_index` — compiler không tính lại gì. */
TEST(StMbRtuBinding, ResolvesInputAndOutputThroughCatalogExtIndex)
{
    StIrModule module = compile_ok(kModbusProgram);
    const std::vector<StIoMapEntry> entries = {
        mb_entry("ReturnTemp", "input", "device.returnTemp", StType::REAL, 7),
        mb_entry("ValveCmd", "output", "device.valveCmd", StType::REAL, 12),
    };
    std::vector<StDiagnostic> diags;
    ASSERT_TRUE(resolve_io_bindings(&module, entries, &diags))
        << (diags.empty() ? "" : diags[0].code + ": " + diags[0].message);
    ASSERT_EQ(module.io_bindings.size(), 2u);

    const StIrIoBinding* input = binding_for(module, "ReturnTemp");
    ASSERT_NE(input, nullptr);
    EXPECT_EQ(input->point_kind, StPointKind::EXT);
    EXPECT_EQ(input->point_index, 7);
    EXPECT_FALSE(input->is_output);

    const StIrIoBinding* output = binding_for(module, "ValveCmd");
    ASSERT_NE(output, nullptr);
    EXPECT_EQ(output->point_kind, StPointKind::EXT);
    EXPECT_EQ(output->point_index, 12);
    EXPECT_TRUE(output->is_output);
    /* Category suy từ point kind, không phải từ một field thứ hai có thể trôi. */
    EXPECT_EQ(st_point_category(output->point_kind), StPointCategory::MB_RTU);
}

/* LOCAL và MB_RTU sống chung trong một Program: gỡ khoá MB_RTU không được làm
 * hỏng đường LOCAL vốn đang chạy trên board. */
TEST(StMbRtuBinding, MixedLocalAndModbusBindingsCoexist)
{
    StIrModule module = compile_ok(kModbusProgram);
    const std::vector<StIoMapEntry> entries = {
        local_entry("ReturnTemp", "input", "UI-02", StType::REAL),
        mb_entry("ValveCmd", "output", "device.valveCmd", StType::REAL, 3),
    };
    std::vector<StDiagnostic> diags;
    ASSERT_TRUE(resolve_io_bindings(&module, entries, &diags))
        << (diags.empty() ? "" : diags[0].message);
    EXPECT_EQ(binding_for(module, "ReturnTemp")->point_kind, StPointKind::UI);
    EXPECT_EQ(binding_for(module, "ValveCmd")->point_kind, StPointKind::EXT);
}

/* Compiler KHÔNG tự suy slot: thiếu `extIndex` là thiếu dữ liệu, phải từ chối
 * chứ không đoán. Đây là ranh giới giữ compiler khỏi định nghĩa lại ánh xạ
 * Modbus (register/function code/endian/chu kỳ poll). */
TEST(StMbRtuBinding, RejectsUnresolvedExtIndexInsteadOfGuessing)
{
    StIrModule module = compile_ok(kModbusProgram);
    for (uint16_t index : {static_cast<uint16_t>(0), static_cast<uint16_t>(257)}) {
        StIrModule candidate = module;
        std::vector<StDiagnostic> diags;
        EXPECT_FALSE(resolve_io_bindings(&candidate, {mb_entry("ReturnTemp", "input", "device.t", StType::REAL, index)}, &diags))
            << "extIndex=" << index << " được chấp nhận";
        EXPECT_TRUE(candidate.io_bindings.empty()) << "từ chối vẫn ghi binding";
    }
}

/* Thiếu `deviceId` thì `(deviceId, pointId)` không còn là identity duy nhất —
 * hai thiết bị có thể dùng cùng tên điểm. */
TEST(StMbRtuBinding, RejectsMissingDeviceIdentity)
{
    StIrModule module = compile_ok(kModbusProgram);
    StIoMapEntry entry = mb_entry("ReturnTemp", "input", "device.t", StType::REAL, 5);
    entry.device_id.clear();
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, {entry}, &diags));
}

/* Sai chiều bị từ chối: ghi vào một điểm không writable, và bind VAR_INPUT với
 * `direction=output`. Hai lỗi khác nhau nhưng cùng phải fail-closed. */
TEST(StMbRtuBinding, RejectsWrongDirection)
{
    {
        StIrModule module = compile_ok(kModbusProgram);
        std::vector<StDiagnostic> diags;
        EXPECT_FALSE(resolve_io_bindings(
            &module, {mb_entry("ValveCmd", "output", "device.valveCmd", StType::REAL, 4, /*writable=*/false)}, &diags))
            << "ghi vào điểm read-only vẫn qua";
    }
    {
        StIrModule module = compile_ok(kModbusProgram);
        std::vector<StDiagnostic> diags;
        EXPECT_FALSE(resolve_io_bindings(
            &module, {mb_entry("ReturnTemp", "output", "device.t", StType::REAL, 4)}, &diags))
            << "VAR_INPUT bind chiều output vẫn qua";
    }
}

/* TIME không có biểu diễn trên dây Modbus; kiểu sai phải chết ở Check chứ không
 * chết muộn ở runtime. */
TEST(StMbRtuBinding, RejectsTypeWithoutModbusRepresentation)
{
    StIrModule module = compile_ok(kModbusProgram);
    StIoMapEntry entry = mb_entry("ReturnTemp", "input", "device.t", StType::TIME, 5);
    std::vector<StDiagnostic> diags;
    EXPECT_FALSE(resolve_io_bindings(&module, {entry}, &diags));
}
