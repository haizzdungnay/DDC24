/**
 * @file  io_conditioning.hpp
 * @brief ISS-PIO-24 §7 — điều hoà tín hiệu Universal Input SAU khi `ui_to_eng`
 *        đã scale: mặt nạ lỗi range/loop, clamp, deadband, giá trị khi lỗi.
 *
 * Tách thành hàm thuần để kiểm thử được từng bậc thang mà không cần MCU thật.
 * Bộ lọc trung bình động (`filter_samples`) KHÔNG nằm ở đây: nó đã có sẵn trong
 * vòng lặp poll của `bootstrap/main.cpp` và giữ nguyên vị trí cũ (trước clamp).
 */
#ifndef IOBUS_IO_CONDITIONING_HPP
#define IOBUS_IO_CONDITIONING_HPP

#include "io/io_types.hpp"

namespace iobus {

/* Bậc 1 — mặt nạ lỗi. `ui_to_eng` luôn phát hiện over/under range và
 * open/shorted loop; hai cờ cấu hình quyết định có ĐƯỢC PHÉP hạ quality vì
 * chúng hay không. Tắt cờ ⇒ quality quay lại GOOD, reliability = RELIABLE.
 * Các nguyên nhân khác (sensor không lắp, comm fail…) KHÔNG bị mặt nạ. */
void apply_fault_mask(const UiScaleConfig& cfg, kx_quality_t* q, kx_reliability_t* r);

/* Bậc 2 — clamp về [clamp_min, clamp_max]. Dải nghịch (min > max) bị coi là
 * cấu hình hỏng và bỏ qua thay vì kẹp về một điểm. */
float apply_clamp(const UiScaleConfig& cfg, float value);

/* Bậc 3 — deadband: thay đổi nhỏ hơn ngưỡng thì phát lại giá trị cũ.
 * Chỉ áp dụng khi quality GOOD; điểm lỗi phải đi thẳng tới bậc 4. */
float apply_deadband(const UiScaleConfig& cfg, const UiConditioningState& st, float value);

/* Bậc 4 — chính sách giá trị khi lỗi. KHÔNG đổi quality/reliability. */
float apply_failure_value(const UiScaleConfig& cfg, const UiConditioningState& st,
                          kx_quality_t q, float value);

/* Chạy cả bốn bậc theo đúng thứ tự và cập nhật trạng thái kênh.
 * `q`/`r` có thể bị bậc 1 sửa; giá trị trả về là thứ sẽ ghi vào snapshot. */
float condition_ui_sample(const UiScaleConfig& cfg, UiConditioningState* st,
                          kx_quality_t* q, kx_reliability_t* r, float value);

} // namespace iobus

#endif /* IOBUS_IO_CONDITIONING_HPP */
