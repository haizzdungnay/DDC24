#ifndef HMI_DRM_INIT_HPP
#define HMI_DRM_INIT_HPP

#include <cstdint>
#include <cstddef>
#include <xf86drmMode.h>

namespace hmi {

struct DrmContext {
    int      fd       = -1;
    uint32_t conn_id  = 0;
    uint32_t crtc_id  = 0;
    uint32_t mode_w   = 320;
    uint32_t mode_h   = 240;
    uint32_t fb_id[2] = {};    /* double-buffer */
    void*    map[2]   = {};    /* mmap'd framebuffer (RGB565) */
    int      cur_fb   = 0;     /* index currently displayed */
    uint32_t handle[2] = {};   /* GEM handle per FB */
    uint32_t pitch[2]  = {};
    size_t   size[2]   = {};
    drmModeModeInfo mode{};
    bool     frame_active = false;
    int      draw_fb      = 1;
};

/* Opens DRM device, finds connector+CRTC, allocates 2 dumb FBs (320×240 RGB565).
 * Returns true on success. ctx must be zero-initialised by caller.  */
bool drm_init(DrmContext* ctx, const char* dev = "/dev/dri/card0");

/* Schedule off-screen FB for display (page-flip or immediate set-crtc fallback),
 * then toggle cur_fb.  */
bool drm_page_flip(DrmContext* ctx);

/* Munmap + destroy FBs + close fd. */
void drm_destroy(DrmContext* ctx);

} // namespace hmi

#endif
