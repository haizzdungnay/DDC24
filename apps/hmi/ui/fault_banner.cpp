#include "ui/fault_banner.hpp"
#include "ui/screen_saver.hpp"

namespace hmi {

void FaultBanner::create(ScreenSaver* ss, const Locale& locale)
{
    ss_ = ss;

    /* lv_layer_top() renders above all screens — no need to recreate on screen switch */
    lv_obj_t* top = lv_layer_top();

    banner_ = lv_label_create(top);
    lv_obj_set_size(banner_, 320, 20);
    lv_obj_align(banner_, LV_ALIGN_TOP_MID, 0, 0);

    lv_obj_set_style_bg_color(banner_, lv_color_make(0xD5, 0x20, 0x2A), 0);
    lv_obj_set_style_bg_opa(banner_, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(banner_, lv_color_white(), 0);
    lv_obj_set_style_text_align(banner_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_pad_top(banner_, 2, 0);
    lv_label_set_text(banner_, locale.str(StrKey::STR_IO_FAULT_BANNER));

    lv_obj_add_flag(banner_, LV_OBJ_FLAG_HIDDEN);   /* hidden by default */
}

void FaultBanner::rebuild_label(const Locale& locale)
{
    if (banner_) lv_label_set_text(banner_, locale.str(StrKey::STR_IO_FAULT_BANNER));
}

void FaultBanner::update(uint8_t iop_status)
{
    bool fault = (iop_status == KX_IOP_FAULT);
    if (fault == visible_) return;
    visible_ = fault;
    if (fault) {
        lv_obj_clear_flag(banner_, LV_OBJ_FLAG_HIDDEN);
        if (ss_) ss_->force_wake();
    } else {
        lv_obj_add_flag(banner_, LV_OBJ_FLAG_HIDDEN);
        if (ss_) ss_->clear_fault();
    }
}

} // namespace hmi
