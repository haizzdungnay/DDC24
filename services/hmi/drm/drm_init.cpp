#include "drm/drm_init.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <xf86drm.h>
#include <xf86drmMode.h>

namespace hmi {

static bool alloc_fb(DrmContext* ctx, int idx)
{
    struct drm_mode_create_dumb creq{};
    creq.width  = ctx->mode_w;
    creq.height = ctx->mode_h;
    creq.bpp    = 16;  /* RGB565 */
    if (drmIoctl(ctx->fd, DRM_IOCTL_MODE_CREATE_DUMB, &creq) < 0) {
        std::fprintf(stderr, "HMI DRM create_dumb[%d] failed: %s\n", idx, strerror(errno));
        return false;
    }
    ctx->handle[idx] = creq.handle;
    ctx->pitch[idx]  = creq.pitch;
    ctx->size[idx]   = static_cast<size_t>(creq.size);

    if (drmModeAddFB(ctx->fd, ctx->mode_w, ctx->mode_h, 16, 16,
                     creq.pitch, creq.handle, &ctx->fb_id[idx]) < 0) {
        std::fprintf(stderr, "HMI DRM AddFB[%d] failed: %s\n", idx, strerror(errno));
        return false;
    }

    struct drm_mode_map_dumb mreq{};
    mreq.handle = creq.handle;
    if (drmIoctl(ctx->fd, DRM_IOCTL_MODE_MAP_DUMB, &mreq) < 0) {
        std::fprintf(stderr, "HMI DRM map_dumb[%d] failed: %s\n", idx, strerror(errno));
        return false;
    }
    void* map = mmap(nullptr, creq.size, PROT_READ | PROT_WRITE, MAP_SHARED,
                     ctx->fd, static_cast<off_t>(mreq.offset));
    if (map == MAP_FAILED) {
        std::fprintf(stderr, "HMI DRM mmap[%d] failed: %s\n", idx, strerror(errno));
        return false;
    }
    std::memset(map, 0, creq.size);
    ctx->map[idx] = map;
    return true;
}

bool drm_init(DrmContext* ctx, const char* dev)
{
    ctx->fd = open(dev, O_RDWR | O_CLOEXEC);
    if (ctx->fd < 0) {
        std::fprintf(stderr, "HMI DRM open(%s) failed: %s\n", dev, strerror(errno));
        return false;
    }

    drmModeRes* res = drmModeGetResources(ctx->fd);
    if (!res) {
        std::fprintf(stderr, "HMI DRM GetResources failed\n");
        return false;
    }

    /* Find first connected connector */
    drmModeConnector* conn = nullptr;
    for (int i = 0; i < res->count_connectors && !conn; i++) {
        drmModeConnector* c = drmModeGetConnector(ctx->fd, res->connectors[i]);
        if (c && c->connection == DRM_MODE_CONNECTED && c->count_modes > 0) {
            conn = c;
            ctx->conn_id = c->connector_id;
        } else if (c) {
            drmModeFreeConnector(c);
        }
    }
    if (!conn) {
        std::fprintf(stderr, "HMI DRM no connected connector\n");
        drmModeFreeResources(res);
        return false;
    }

    /* Use the connector's preferred mode, falling back to the first mode. */
    int mode_index = 0;
    for (int i = 0; i < conn->count_modes; ++i) {
        if (conn->modes[i].type & DRM_MODE_TYPE_PREFERRED) {
            mode_index = i;
            break;
        }
    }
    ctx->mode = conn->modes[mode_index];
    ctx->mode_w = static_cast<uint32_t>(ctx->mode.hdisplay);
    ctx->mode_h = static_cast<uint32_t>(ctx->mode.vdisplay);
    std::fprintf(stderr, "INFO  hmi.drm mode=%ux%u@%uHz conn=%u\n",
                 ctx->mode_w, ctx->mode_h, ctx->mode.vrefresh, ctx->conn_id);
    if (!((ctx->mode_w == 240u && ctx->mode_h == 320u) ||
          (ctx->mode_w == 320u && ctx->mode_h == 240u))) {
        std::fprintf(stderr, "HMI DRM unsupported mode %ux%u (expected 240x320 or 320x240)\n",
                     ctx->mode_w, ctx->mode_h);
        drmModeFreeConnector(conn);
        drmModeFreeResources(res);
        drm_destroy(ctx);
        return false;
    }

    /* Find encoder → CRTC */
    if (conn->encoder_id) {
        drmModeEncoder* enc = drmModeGetEncoder(ctx->fd, conn->encoder_id);
        if (enc) {
            ctx->crtc_id = enc->crtc_id;
            drmModeFreeEncoder(enc);
        }
    }
    if (!ctx->crtc_id && res->count_crtcs > 0)
        ctx->crtc_id = res->crtcs[0];

    drmModeFreeConnector(conn);
    drmModeFreeResources(res);

    /* Allocate double-buffered dumb FBs */
    if (!alloc_fb(ctx, 0) || !alloc_fb(ctx, 1)) {
        drm_destroy(ctx);
        return false;
    }

    /* Set initial CRTC mode using FB[0] */
    if (drmModeSetCrtc(ctx->fd, ctx->crtc_id, ctx->fb_id[0],
                       0, 0, &ctx->conn_id, 1, &ctx->mode) < 0) {
        std::fprintf(stderr, "HMI DRM SetCrtc failed: %s\n", strerror(errno));
        drm_destroy(ctx);
        return false;
    }
    ctx->cur_fb = 0;
    std::fprintf(stderr, "INFO  hmi.drm_init ok fb=[%u,%u]\n",
                 ctx->fb_id[0], ctx->fb_id[1]);
    return true;
}

bool drm_page_flip(DrmContext* ctx)
{
    const int next = ctx->draw_fb;
    /* Use SetCrtc (synchronous) — page-flip event loop omitted to keep main loop simple */
    if (drmModeSetCrtc(ctx->fd, ctx->crtc_id, ctx->fb_id[next],
                       0, 0, &ctx->conn_id, 1, &ctx->mode) < 0) {
        std::fprintf(stderr, "WARN  hmi.drm.flip_fail errno=%s\n", strerror(errno));
        return false;
    }
    ctx->cur_fb = next;
    return true;
}

void drm_destroy(DrmContext* ctx)
{
    for (int i = 0; i < 2; i++) {
        if (ctx->map[i]) {
            munmap(ctx->map[i], ctx->size[i]);
            ctx->map[i] = nullptr;
        }
        if (ctx->fb_id[i]) {
            drmModeRmFB(ctx->fd, ctx->fb_id[i]);
            ctx->fb_id[i] = 0;
        }
        if (ctx->handle[i]) {
            struct drm_mode_destroy_dumb dreq{};
            dreq.handle = ctx->handle[i];
            drmIoctl(ctx->fd, DRM_IOCTL_MODE_DESTROY_DUMB, &dreq);
            ctx->handle[i] = 0;
        }
    }
    if (ctx->fd >= 0) {
        close(ctx->fd);
        ctx->fd = -1;
    }
}

} // namespace hmi
