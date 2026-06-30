#ifndef HMI_FAULT_BANNER_HPP
#define HMI_FAULT_BANNER_HPP

#include <lvgl.h>
#include "mkddc_shm.h"
#include "i18n/locale.hpp"

namespace hmi {

class ScreenSaver;

/* Full-width red banner rendered on lv_layer_top() — always above all screens.
 * Cannot be dismissed by user; clears automatically when iop_status != FAULT. */
class FaultBanner {
public:
    void create(ScreenSaver* ss, const Locale& locale);
    void update(uint8_t iop_status);
    void rebuild_label(const Locale& locale);

    bool visible() const { return visible_; }

private:
    lv_obj_t*   banner_  = nullptr;
    bool        visible_ = false;
    ScreenSaver* ss_     = nullptr;
};

} // namespace hmi

#endif
