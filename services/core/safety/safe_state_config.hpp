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
 *   - Validate AO theo MODE THẬT của kênh (io_config.conf — CONFIG_SCHEMA §3):
 *     mode 0-10V → safe ∈ [0,10] V; mode 4-20mA → safe ∈ [4,20] mA.
 *     Sai mode/dải → fail-fast log rõ kênh, KHÔNG clamp âm thầm.
 *   - Không có file → default cố định AO=0V/4mA, DO=open + WARN.
 */
#ifndef CORE_SAFE_STATE_CONFIG_HPP
#define CORE_SAFE_STATE_CONFIG_HPP

#include <cstdint>
#include <string>

#include "ipc/priority_resolver.hpp"

namespace core {

/* mode per kênh: 0 = 0-10V, 1 = 4-20mA (khớp kx_io_shm.ao_mode + SET_AO_CFG bit) */
struct AoModeConfig {
    uint8_t mode[KX_N_AO] = {0, 0, 0, 0};
};

struct SafeStateConfig {
    float ao_default[KX_N_AO] = {0.0f, 0.0f, 0.0f, 0.0f};   /* eng V/mA theo mode */
    bool  do_default[KX_N_DO] = {false, false, false, false}; /* false = open */
};

/* Đọc mode AO từ io_config.conf ("ao":[{"ch":1,"mode":"0-10V"}] — CONFIG_SCHEMA §3;
 * entry thiếu "ch" → gán positional, khớp tolerance của iobus_config).
 * Thiếu file (ENOENT) + must_exist=false → default 0-10V + WARN (khớp MCU boot).
 * File tồn tại nhưng không đọc được (EACCES/EIO...) / JSON hỏng / mode lạ /
 * ch ngoài dải → false (fail-fast — không âm thầm rơi về default sai mode). */
bool load_ao_modes(const std::string& io_config_path, bool must_exist, AoModeConfig* out);

/* Dải eng hợp lệ + giá trị safe mặc định theo mode (default = cận dưới dải). */
void ao_mode_range(uint8_t mode, float* lo, float* hi);

/* Trả về:
 *   true  — config hợp lệ (kể cả thiếu file khi must_exist=false → default + WARN)
 *   false — JSON hỏng / ch ngoài 1..4 / safe sai dải THEO MODE → caller fail-fast
 */
bool load_safe_state_config(const std::string& path, bool must_exist,
                            const AoModeConfig& modes, SafeStateConfig* out);

/* Mặc định safe theo mode khi không có config: 0-10V → 0V; 4-20mA → 4mA. */
void apply_mode_defaults(const AoModeConfig& modes, SafeStateConfig* out);

/* Bơm config vào mức 6 của resolver. */
void apply_safe_state_config(const SafeStateConfig& cfg, PriorityResolver* resolver);

} // namespace core

#endif /* CORE_SAFE_STATE_CONFIG_HPP */
