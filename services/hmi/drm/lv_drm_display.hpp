#ifndef HMI_LV_DRM_DISPLAY_HPP
#define HMI_LV_DRM_DISPLAY_HPP

#include <lvgl.h>
#include "drm/drm_init.hpp"

namespace hmi {

lv_point_t drm_landscape_to_native(int32_t x, int32_t y,
                                    uint32_t mode_w, uint32_t mode_h);

/* Register LVGL v9 display backed by DrmContext.
 * Returns the lv_display_t* (owned by LVGL — do not free). */
lv_display_t* lvgl_drm_display_create(DrmContext* ctx);

/* LVGL v9 flush callback — called by LVGL render engine. */
void drm_flush_cb(lv_display_t* disp, const lv_area_t* area, uint8_t* px_map);

} // namespace hmi

#endif
