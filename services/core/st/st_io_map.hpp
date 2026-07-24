/**
 * @file  st_io_map.hpp
 * @brief FW SOM IEC programming foundation: validator cho io_map — binding
 *        typed ST variable (VAR_INPUT/VAR_OUTPUT) ↔ physical point. Đây là
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
#include <vector>

#include "st/st_diagnostic.hpp"
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
};

/* PREFIX-NN, PREFIX chữ hoa thuộc {UI,DI,AO,DO} (physical I/O point — theo
 * phạm vi C2 "typed variable ↔ physical point"; AV/BV/MSV virtual point
 * binding không thuộc phạm vi validator này, để mở rộng sau nếu cần), NN là
 * 1+ chữ số > 0. */
bool valid_st_point_id(const std::string& point_id);

/* Validate toàn bộ entries so với symbol table của prog (prog đã typecheck
 * thành công — hàm này không tự parse/typecheck lại).
 * true  = entries hợp lệ, MỌI VAR_INPUT/VAR_OUTPUT của prog có đúng 1 binding.
 * false = *diagnostics có >=1 lỗi (unknown var, direction/type sai, point_id
 *         sai format, range mâu thuẫn, thiếu binding, trùng binding). */
bool validate_io_map(const StProgram& prog, const std::vector<StIoMapEntry>& entries,
                     std::vector<StDiagnostic>* diagnostics);

} // namespace core

#endif /* CORE_ST_IO_MAP_HPP */
