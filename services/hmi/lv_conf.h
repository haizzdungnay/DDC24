/**
 * @file  lv_conf.h
 * @brief LVGL v9 configuration cho mkddc-hmi (320x240 landscape, RGB565, DRM/KMS).
 *        Đặt tại services/hmi/lv_conf.h — referenced via LV_CONF_PATH in CMakeLists.
 */
#if 1  /* LVGL v9 requires the guard */

#ifndef LV_CONF_H
#define LV_CONF_H

#ifndef __ASSEMBLY__
#include <stdint.h>
#endif

/* Color depth: 16-bit RGB565 cho DRM framebuffer */
#define LV_COLOR_DEPTH 16

/* Resolution (landscape sau khi rotate 240x320 → 320x240) */
#define LV_HOR_RES_MAX 320
#define LV_VER_RES_MAX 240

/* Memory: 256 KB cho LVGL heap (screens + widgets) */
#define LV_MEM_SIZE (256ul * 1024ul)
#define LV_MEM_CUSTOM 0

/* Tick: 1ms internal tick (provided by lv_tick_inc in main loop) */
#define LV_TICK_CUSTOM 0

/* Refresh period: ~33ms = ~30fps cap (render happens on demand) */
#define LV_DEF_REFR_PERIOD 33

/* Draw buffer alignment */
#define LV_DRAW_BUF_STRIDE_ALIGN 1
#define LV_DRAW_BUF_ALIGN 4

/* ---- Font configuration ----
 * Dùng Montserrat 14 built-in làm default.
 * NotoSans với Vietnamese sẽ được thêm ở HMI-011 (lv_font_conv).
 */
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_12 1
#define LV_FONT_MONTSERRAT_10 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14

/* ---- Input devices ---- */
#define LV_INDEV_DEF_READ_PERIOD 16   /* ms */
#define LV_INDEV_DEF_DRAG_LIMIT 10
#define LV_INDEV_DEF_GESTURE_LIMIT 50
#define LV_INDEV_DEF_GESTURE_MIN_VELOCITY 3

/* ---- Display driver ----
 * Dùng custom DRM driver (drm/lv_drm_display.cpp) — không dùng built-in.
 */
#define LV_USE_LINUX_DRM 0
#define LV_USE_EVDEV     0

/* ---- Feature flags ---- */
#define LV_USE_ANIMATION 1
#define LV_USE_SHADOW    0  /* tắt shadow để tăng performance */
#define LV_USE_BLEND_MODES 1
#define LV_USE_OPA_SCALE 1

/* ---- Widget set (chỉ bật những gì dùng) ---- */
#define LV_USE_ARC         1
#define LV_USE_BAR         1
#define LV_USE_BTN         1
#define LV_USE_BTNMATRIX   0
#define LV_USE_CANVAS      0
#define LV_USE_CHECKBOX    0
#define LV_USE_DROPDOWN    1
#define LV_USE_IMG         0
#define LV_USE_LABEL       1
#define LV_USE_LINE        0
#define LV_USE_ROLLER      0
#define LV_USE_SLIDER      0
#define LV_USE_SWITCH      0
#define LV_USE_SCALE       0
#define LV_USE_TEXTAREA    1
#define LV_USE_TABLE       1
#define LV_USE_KEYBOARD    1
#define LV_USE_LIST        1
#define LV_USE_MENU        0
#define LV_USE_MSGBOX      0
#define LV_USE_SPAN        0
#define LV_USE_SPINBOX     0
#define LV_USE_SPINNER     0
#define LV_USE_TABVIEW     0
#define LV_USE_TILEVIEW    0
#define LV_USE_WIN         0

/* ---- Log ---- */
#define LV_USE_LOG 1
#define LV_LOG_LEVEL LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF 1

/* ---- Assert ---- */
#define LV_USE_ASSERT_NULL      1
#define LV_USE_ASSERT_MALLOC    1
#define LV_USE_ASSERT_STYLE     0
#define LV_USE_ASSERT_MEM_INTEGRITY 0

/* ---- Perf monitor (off in production) ---- */
#define LV_USE_PERF_MONITOR 0
#define LV_USE_MEM_MONITOR  0

/* NotoSans TTF is loaded at runtime through FreeType. */
#define LV_USE_FREETYPE 1
#define LV_FREETYPE_USE_LVGL_PORT 0
#define LV_FREETYPE_CACHE_FT_GLYPH_CNT 256

#endif /* LV_CONF_H */
#endif /* guard */
