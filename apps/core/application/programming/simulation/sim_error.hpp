/**
 * @file  sim_error.hpp
 * @brief `T59-814` — mã lỗi chi tiết của `mkddc-programming-sim-worker`.
 *
 *        Tách khỏi họ `ST-RT-*`/`IR-E-*` vì cách sửa khác hẳn: `SIM-E-*` luôn
 *        là "phiên mô phỏng hỏng", và bất biến kèm theo là **không** có gì
 *        trong production đổi theo. Mỗi mã ở đây được ánh xạ sang đúng một
 *        public code `PRG-SIM-*` trong `contracts/programming/error_catalog_v1.json`;
 *        generator sẽ đỏ nếu thêm mã mà quên ánh xạ.
 *
 *        Chuỗi là hằng tĩnh: worker báo lỗi trên đường đã cạn tài nguyên, nên
 *        không được cấp phát để mô tả chính việc mình hết tài nguyên.
 */
#ifndef CORE_PROGRAMMING_SIM_ERROR_HPP
#define CORE_PROGRAMMING_SIM_ERROR_HPP

namespace core::programming::sim {

/* Bắt tay/khung giao thức sai: sai token, sai version, dòng vượt trần. */
constexpr const char* kErrProtocol = "SIM-E-001";
/* Artifact không nạp được bằng loader production. */
constexpr const char* kErrArtifact = "SIM-E-002";
/* Không có Program nào mang chu kỳ hợp lệ, nên không tính được base tick. */
constexpr const char* kErrNoSchedule = "SIM-E-003";
/* Runtime fault khi chạy một Program trong sandbox. */
constexpr const char* kErrExecFault = "SIM-E-004";
/* `observationId` không có trong manifest allowlist của phiên. */
constexpr const char* kErrInputUnknown = "SIM-E-005";
/* Giá trị sai kiểu/đơn vị/miền, hoặc NaN/Inf. */
constexpr const char* kErrInputValue = "SIM-E-006";
/* Lệnh không hợp lệ ở trạng thái hiện tại, hoặc sequence không khớp. */
constexpr const char* kErrCommandState = "SIM-E-007";
/* Vượt trần tài nguyên do chính worker tự thi hành. */
constexpr const char* kErrLimit = "SIM-E-008";

} // namespace core::programming::sim

#endif /* CORE_PROGRAMMING_SIM_ERROR_HPP */
