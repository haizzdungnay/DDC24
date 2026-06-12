/**
 * @file  safe_state_config.hpp
 * @brief Loader /data/config/io_safe_state.conf (CONFIG_SCHEMA §4) → relinquish
 *        default MỨC 6 của PriorityResolver (07 §4).
 *
 * QUAN HỆ CHỐT (Rev A — quyết định product 2026-06-12):
 *   - io_safe_state.conf cấu hình GIÁ TRỊ DEFAULT MỨC 6 per-channel (giá trị khi
 *     không nguồn nào active — "relinquish default").
 *   - safe_state OVERRIDE (07 §5.3) là lớp cứng CỐ ĐỊNH: AO→0V/4mA theo ao_mode,
 *     DO→open. KHÔNG cấu hình được, LUÔN thắng default khi trigger (IO fault/stale/
 *     T6/T7) — để 3 lớp safety (MCU/iobus/core) hội tụ cùng một trạng thái.
 *   - Không có file → default cố định AO=0.0, DO=open + WARN.
 *   - JSON sai cú pháp / giá trị ngoài dải → fail-fast (config an toàn không đoán mò).
 */
#ifndef CORE_SAFE_STATE_CONFIG_HPP
#define CORE_SAFE_STATE_CONFIG_HPP

#include <string>

#include "priority_resolver.hpp"

namespace core {

struct SafeStateConfig {
    float ao_default[KX_N_AO] = {0.0f, 0.0f, 0.0f, 0.0f};   /* eng V/mA theo mode */
    bool  do_default[KX_N_DO] = {false, false, false, false}; /* false = open */
};

/* Trả về:
 *   true  — config hợp lệ (kể cả thiếu file khi must_exist=false → default + WARN)
 *   false — JSON hỏng / ch ngoài 1..4 / safe ngoài dải → caller fail-fast
 */
bool load_safe_state_config(const std::string& path, bool must_exist, SafeStateConfig* out);

/* Bơm config vào mức 6 của resolver. */
void apply_safe_state_config(const SafeStateConfig& cfg, PriorityResolver* resolver);

} // namespace core

#endif /* CORE_SAFE_STATE_CONFIG_HPP */
