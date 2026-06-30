#include "drm/lv_drm_display.hpp"

#include <cstring>
#include <cstdint>

namespace hmi {

lv_point_t drm_landscape_to_native(int32_t x, int32_t y,
                                    uint32_t mode_w, uint32_t mode_h)
{
    if (mode_w == 240u && mode_h == 320u)
        return {static_cast<int32_t>(mode_w - 1u) - y, x};
    return {x, y};
}

/* Two partial draw buffers: 10 scan lines × 320 px × 2 bytes (RGB565) */
static uint8_t s_buf1[320 * 10 * 2];
static uint8_t s_buf2[320 * 10 * 2];

void drm_flush_cb(lv_display_t* disp, const lv_area_t* area, uint8_t* px_map)
{
    DrmContext* ctx = static_cast<DrmContext*>(lv_display_get_user_data(disp));
    if (!ctx || !ctx->map[0] || !ctx->map[1]) {
        lv_display_flush_ready(disp);
        return;
    }

    if (!ctx->frame_active) {
        ctx->draw_fb = ctx->cur_fb ^ 1;
        const size_t copy_n = ctx->size[ctx->draw_fb] < ctx->size[ctx->cur_fb]
                            ? ctx->size[ctx->draw_fb] : ctx->size[ctx->cur_fb];
        std::memcpy(ctx->map[ctx->draw_fb], ctx->map[ctx->cur_fb], copy_n);
        ctx->frame_active = true;
    }
    const int off = ctx->draw_fb;
    uint16_t* fb = static_cast<uint16_t*>(ctx->map[off]);
    const uint16_t* src = reinterpret_cast<const uint16_t*>(px_map);

    const int32_t row_len = area->x2 - area->x1 + 1;
    const size_t stride_px = ctx->pitch[off] / sizeof(uint16_t);
    const bool portrait_native = ctx->mode_w == 240u && ctx->mode_h == 320u;
    for (int32_t y = area->y1; y <= area->y2; ++y) {
        if (portrait_native) {
            /* LVGL coordinates are landscape after ROTATION_90. Map logical
             * (x,y) back to the physical 240x320 KMS framebuffer. */
            for (int32_t x = area->x1; x <= area->x2; ++x) {
                const lv_point_t physical = drm_landscape_to_native(
                    x, y, ctx->mode_w, ctx->mode_h);
                fb[static_cast<size_t>(physical.y) * stride_px +
                   static_cast<size_t>(physical.x)] =
                    src[static_cast<size_t>(x - area->x1)];
            }
        } else {
            std::memcpy(&fb[static_cast<size_t>(y) * stride_px + area->x1],
                        src, static_cast<size_t>(row_len) * sizeof(uint16_t));
        }
        src += row_len;
    }

    /* Only page-flip when this is the last partial-area flush of the frame */
    if (lv_display_flush_is_last(disp)) {
        drm_page_flip(ctx);
        ctx->frame_active = false;
    }
    lv_display_flush_ready(disp);
}

lv_display_t* lvgl_drm_display_create(DrmContext* ctx)
{
    lv_display_t* disp = lv_display_create(
        static_cast<int32_t>(ctx->mode_w),
        static_cast<int32_t>(ctx->mode_h));

    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(disp, s_buf1, s_buf2, sizeof(s_buf1),
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, drm_flush_cb);
    lv_display_set_user_data(disp, ctx);
    if (ctx->mode_w == 240u && ctx->mode_h == 320u)
        lv_display_set_rotation(disp, LV_DISPLAY_ROTATION_90);
    return disp;
}

} // namespace hmi
