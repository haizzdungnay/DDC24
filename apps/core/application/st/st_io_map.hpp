/**
 * @file  st_io_map.hpp
 * @brief FW SOM IEC programming foundation: validator cho io_map — binding
 *        typed ST variable (VAR_INPUT/VAR_OUTPUT) ↔ LOCAL/VP/MB_RTU Point. Đây là
 *        LOGIC VALIDATE THUẦN TUÝ — chưa đọc/ghi file `io_map.json` thật,
 *        chưa có CRUD (đó là việc của `mkddc-program-service`/BE, C2). FW
 *        SOM chỉ cung cấp `StIoMapEntry` + `validate_io_map()` để BE gọi khi
 *        có storage layer thật.
 *
 *        Khác với parser/semantic (fail-fast, 1 StDiagnostic): io_map
 *        thường có nhiều dòng độc lập, nên validate_io_map() trả về TẤT CẢ
 *        lỗi tìm thấy trong 1 lần gọi (hữu ích hơn cho UI hiển thị danh sách
 *        lỗi io_map, thay vì bắt user sửa từng dòng một).
 */
#ifndef CORE_ST_IO_MAP_HPP
#define CORE_ST_IO_MAP_HPP

#include <string>
#include <utility>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_program.hpp"

namespace core {

struct StIoMapEntry {
    std::string variable;    /* phải khớp tên khai báo trong VAR_INPUT/VAR_OUTPUT */
    std::string direction;   /* "input" | "output" — phải khớp variable là input hay output */
    std::string point_id;    /* vd "UI-01", "DO-03" — xem valid_st_point_id() */
    StType      type = StType::REAL;
    std::string unit;        /* có thể rỗng */
    bool        has_range = false;
    float       range_min = 0.0f;
    float       range_max = 0.0f;
    /* Discriminated identity Rev A. Hai field này đặt sau contract cũ
     * để source dùng aggregate initializer 8 field vẫn tương thích. */
    std::string category = "LOCAL"; /* "LOCAL" | "VP" | "MB_RTU" */
    std::string device_id;          /* bắt buộc chỉ với MB_RTU */
    /* T59-303: slot EXT 1..KX_N_EXT do Point Catalog phân giải, CHỈ dùng cho
     * MB_RTU. Compiler KHÔNG tự suy nó từ `point_id`: ánh xạ điểm Modbus sang
     * slot là việc của hệ Modbus RTU (địa chỉ register, function code, endian,
     * chu kỳ poll). Tự suy ở đây nghĩa là định nghĩa lại giao thức ở lớp không
     * sở hữu nó, và hai định nghĩa sẽ trôi khỏi nhau. */
    uint16_t ext_index = 0;
    bool        writable = true;    /* snapshot metadata từ Point Catalog */

    StIoMapEntry() = default;
    StIoMapEntry(std::string variable_in, std::string direction_in,
                 std::string point_id_in, StType type_in, std::string unit_in,
                 bool has_range_in, float range_min_in, float range_max_in,
                 std::string category_in = "LOCAL", std::string device_id_in = {},
                 uint16_t ext_index_in = 0,
                 bool writable_in = true)
        : variable(std::move(variable_in)), direction(std::move(direction_in)),
          point_id(std::move(point_id_in)), type(type_in), unit(std::move(unit_in)),
          has_range(has_range_in), range_min(range_min_in), range_max(range_max_in),
          category(std::move(category_in)), device_id(std::move(device_id_in)),
          ext_index(ext_index_in), writable(writable_in)
    {
    }
};

/* LOCAL PREFIX-NN, PREFIX chữ hoa thuộc {UI,DI,AO,DO}, NN là 1+ chữ
 * số > 0. VP và MB_RTU được validate theo category trong
 * validate_io_map(). */
bool valid_st_point_id(const std::string& point_id);

/* Validate toàn bộ entries so với symbol table của prog (prog đã typecheck
 * thành công — hàm này không tự parse/typecheck lại).
 * true  = entries hợp lệ, MỌI VAR_INPUT/VAR_OUTPUT của prog có đúng 1 binding.
 * false = *diagnostics có >=1 lỗi (unknown var, direction/type sai, point_id
 *         sai format/category/identity/writable, range mâu thuẫn, thiếu
 *         binding, trùng binding). */
bool validate_io_map(const StProgram& prog, const std::vector<StIoMapEntry>& entries,
                     std::vector<StDiagnostic>* diagnostics);

/* F-PROG-ASBUILT-013 / D-07 (REV-PROG-ASBUILT-GAP-2026-08-14): nối io_map đã
 * validate vào artifact thật — trước hàm này, `validate_io_map()` là logic
 * "chết", không nơi nào trong pipeline compile từng gọi tới, nên
 * `StIrModule::io_bindings` luôn rỗng bất kể Mapping tab cấu hình đúng đến
 * đâu (không Program nào từng điều khiển được output vật lý qua Rev A).
 *
 * Khác `validate_io_map()`: hàm này CHO PHÉP binding một phần — biến chưa có
 * entry vẫn hợp lệ (không bắt buộc mọi VAR_INPUT/VAR_OUTPUT phải bind), khớp
 * đúng UC-05 hiện hành (Mapping tab cho map từng biến một, không ép làm hết
 * một lượt) và không đổi hành vi Check của các Program đã có/đang phát triển
 * dở. Đã bind thì validate chặt y hệt `validate_io_map()` (variable tồn tại,
 * direction/type khớp, point identity hợp lệ, không trùng biến/không trùng
 * physical point).
 *
 * `module` phải là kết quả `compile_st_to_ir`/`compile_st_source` đã thành
 * công (cần `.variables[].slot` để gán `StIrIoBinding.slot`). Chỉ
 * `category == "LOCAL"` được hỗ trợ — "VP" hiện KHÔNG có đường dẫn runtime
 * thật tới Core (VP chỉ là overlay cấu hình phía Web API, không ghi được vào
 * SHM AV/BV mà Core đọc — phát hiện phụ khi điều tra F-013, xem
 * `F-PROG-ASBUILT-014`), "MB_RTU" (T59-303) được resolve qua `ext_index` mà Point
 * Catalog cấp — compiler KHÔNG tự suy slot từ `point_id`, vì ánh xạ điểm Modbus
 * sang slot (register, function code, endian, chu kỳ poll) thuộc hệ Modbus RTU
 * chứ không thuộc compiler.
 *
 * true  = mọi entry (nếu có) hợp lệ; `module->io_bindings` được thay bằng
 *         danh sách đã resolve (biến không có entry thì không có trong đó,
 *         y hệt hành vi "chưa map thì không điều khiển gì" hiện tại).
 * false = *diagnostics có lỗi đầu tiên gặp phải (fail-closed); `module`
 *         không đổi. */
bool resolve_io_bindings(StIrModule* module, const std::vector<StIoMapEntry>& entries,
                         std::vector<StDiagnostic>* diagnostics);

} // namespace core

#endif /* CORE_ST_IO_MAP_HPP */
