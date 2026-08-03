#include "ui/nav_controller.hpp"

#include <cstdio>
#include <ctime>
#include <cstring>

namespace hmi {

static constexpr int TAB_H    = 40;
static constexpr int HINT_H   = 16;
static constexpr int DISP_W   = 320;
static constexpr int DISP_H   = 240;
static constexpr int CONTENT_H = DISP_H - TAB_H - HINT_H;
static constexpr int TAB_AREA_W = 320;
static constexpr int TAB_W    = TAB_AREA_W / static_cast<int>(ScreenId::SCR_COUNT);

NavController::NavController(ScreenSaver* ss, FaultBanner* fb)
    : ss_(ss), fb_(fb) {}

NavController::~NavController() {}

void NavController::build(const Locale& l, const PointDb& db,
                          std::array<std::unique_ptr<ScreenBase>, 5> screens)
{
    screens_ = std::move(screens);

    /* Build each LVGL screen object */
    for (int i = 0; i < N; i++) {
        lv_screens_[i] = lv_obj_create(nullptr);   /* lv_scr_create() pattern */
        lv_obj_set_size(lv_screens_[i], DISP_W, DISP_H);
        lv_obj_set_style_bg_color(lv_screens_[i], lv_color_hex(0x1C1C1C), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(lv_screens_[i],  LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_text_font(lv_screens_[i], hmi_font(), LV_PART_MAIN);
        /* Content area offset below tab bar */
        lv_obj_t* content = lv_obj_create(lv_screens_[i]);
        lv_obj_set_pos(content, 0, TAB_H);
        lv_obj_set_size(content, DISP_W, CONTENT_H);
        lv_obj_set_style_bg_opa(content, LV_OPA_TRANSP, LV_PART_MAIN);
        lv_obj_set_style_border_width(content, 0, LV_PART_MAIN);
        lv_obj_set_style_pad_all(content, 0, LV_PART_MAIN);
        lv_obj_clear_flag(content, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_add_event_cb(content, gesture_cb_, LV_EVENT_GESTURE, this);
        screens_[i]->build(content, l, db);
    }

    build_tab_bar_(l);
    set_tab_active_(ScreenId::SCR_HOME);
    lv_scr_load(lv_screens_[0]);
    built_ = true;
}

void NavController::build_tab_bar_(const Locale& l)
{
    /* Tab bar is on lv_layer_top to stay above all screens */
    lv_obj_t* top = lv_layer_top();

    tab_bar_ = lv_obj_create(top);
    lv_obj_set_pos(tab_bar_, 0, 0);
    lv_obj_set_size(tab_bar_, TAB_AREA_W, TAB_H);
    lv_obj_set_style_bg_color(tab_bar_, lv_color_hex(0x2A2A2A), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(tab_bar_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(tab_bar_, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(tab_bar_, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(tab_bar_, 0, LV_PART_MAIN);
    lv_obj_clear_flag(tab_bar_, LV_OBJ_FLAG_SCROLLABLE);

    static const StrKey tab_keys[5] = {
        StrKey::TAB_HOME, StrKey::TAB_IO, StrKey::TAB_COMM,
        StrKey::TAB_ALARM, StrKey::TAB_SERVICE
    };

    for (int i = 0; i < N; i++) {
        tab_btns_[i] = lv_btn_create(tab_bar_);
        lv_obj_set_pos(tab_btns_[i], i * TAB_W, 0);
        lv_obj_set_size(tab_btns_[i], TAB_W, TAB_H);
        lv_obj_set_style_radius(tab_btns_[i], 0, LV_PART_MAIN);
        lv_obj_set_style_border_width(tab_btns_[i], 0, LV_PART_MAIN);
        lv_obj_set_style_pad_all(tab_btns_[i], 0, LV_PART_MAIN);
        lv_obj_set_style_bg_color(tab_btns_[i], lv_color_hex(0x2A2A2A), LV_PART_MAIN);
        lv_obj_set_style_bg_color(tab_btns_[i], lv_color_hex(0x0077CC), LV_STATE_CHECKED);
        lv_obj_add_flag(tab_btns_[i], LV_OBJ_FLAG_CHECKABLE);

        tab_labels_[i] = lv_label_create(tab_btns_[i]);
        lv_label_set_text(tab_labels_[i], l.str(tab_keys[i]));
        lv_obj_set_style_text_color(tab_labels_[i], lv_color_hex(0xAAAAAA), LV_PART_MAIN);
        lv_obj_set_style_text_color(tab_labels_[i], lv_color_hex(0xFFFFFF), LV_STATE_CHECKED);
        lv_obj_set_style_text_font(tab_labels_[i], hmi_font(), LV_PART_MAIN);
        lv_obj_center(tab_labels_[i]);

        /* Store index in user_data so callback can identify which tab */
        lv_obj_set_user_data(tab_btns_[i], reinterpret_cast<void*>(static_cast<intptr_t>(i)));
        lv_obj_add_event_cb(tab_btns_[i], tab_btn_cb_, LV_EVENT_CLICKED, this);
    }

    /* Hint bar at bottom */
    hint_lbl_ = lv_label_create(top);
    lv_label_set_text(hint_lbl_, l.str(StrKey::STR_HINT_BAR));
    lv_obj_set_style_text_color(hint_lbl_, lv_color_hex(0x888888), LV_PART_MAIN);
    lv_obj_set_style_text_font(hint_lbl_, hmi_font(), LV_PART_MAIN);
    lv_obj_set_pos(hint_lbl_, 0, DISP_H - HINT_H - 1);
    lv_obj_set_size(hint_lbl_, DISP_W, HINT_H + 2);
    lv_obj_set_style_text_align(hint_lbl_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
}

void NavController::set_tab_active_(ScreenId id)
{
    for (int i = 0; i < N; i++) {
        if (!tab_btns_[i]) continue;
        if (i == static_cast<int>(id))
            lv_obj_add_state(tab_btns_[i], LV_STATE_CHECKED);
        else
            lv_obj_clear_state(tab_btns_[i], LV_STATE_CHECKED);
    }
}

void NavController::navigate_to(ScreenId id)
{
    if (!built_) return;
    lv_scr_load_anim_t anim = (id > cur_)
        ? LV_SCR_LOAD_ANIM_MOVE_LEFT
        : LV_SCR_LOAD_ANIM_MOVE_RIGHT;
    if (id == cur_) return;
    lv_scr_load_anim(lv_screens_[static_cast<int>(id)], anim, 200, 0, false);
    cur_ = id;
    set_tab_active_(id);
}

void NavController::navigate_left()
{
    navigate_to(left_of(cur_));
}

void NavController::navigate_right()
{
    navigate_to(right_of(cur_));
}

ScreenId NavController::left_of(ScreenId id)
{
    const int next = (static_cast<int>(id) - 1 + N) % N;
    return static_cast<ScreenId>(next);
}

ScreenId NavController::right_of(ScreenId id)
{
    const int next = (static_cast<int>(id) + 1) % N;
    return static_cast<ScreenId>(next);
}

void NavController::on_data_update(const DataCache& c, const PointDb& db, const Locale& l)
{
    if (!built_) return;
    screens_[static_cast<int>(cur_)]->on_data_update(c, db, l);
}

void NavController::on_sys_update(const SysSnapshot& s, const Locale& l)
{
    if (!built_) return;
    screens_[static_cast<int>(cur_)]->on_sys_update(s, l);
}

void NavController::rebuild_labels(const Locale& l)
{
    if (!built_) return;
    static const StrKey tab_keys[5] = {
        StrKey::TAB_HOME, StrKey::TAB_IO, StrKey::TAB_COMM,
        StrKey::TAB_ALARM, StrKey::TAB_SERVICE
    };
    for (int i = 0; i < N; i++) {
        if (tab_labels_[i])
            lv_label_set_text(tab_labels_[i], l.str(tab_keys[i]));
    }
    if (hint_lbl_)
        lv_label_set_text(hint_lbl_, l.str(StrKey::STR_HINT_BAR));
    for (int i = 0; i < N; i++)
        screens_[i]->rebuild_labels(l);
}

void NavController::on_key(uint32_t key, lv_indev_state_t state)
{
    if (!built_) return;
    if (state == LV_INDEV_STATE_PRESSED) {
        switch (key) {
            case LV_KEY_LEFT:  navigate_left();  return;
            case LV_KEY_RIGHT: navigate_right(); return;
            default: break;
        }
    }
    screens_[static_cast<int>(cur_)]->on_key(key, state);
}

void NavController::gesture_cb_(lv_event_t* e)
{
    auto* self = static_cast<NavController*>(lv_event_get_user_data(e));
    lv_indev_t* indev = lv_indev_active();
    if (!self || !indev) return;
    const lv_dir_t dir = lv_indev_get_gesture_dir(indev);
    if (dir == LV_DIR_LEFT) self->navigate_right();
    else if (dir == LV_DIR_RIGHT) self->navigate_left();
}

void NavController::tick_clock()
{
    if (!clock_lbl_) return;
    time_t now = time(nullptr);
    struct tm t{};
    localtime_r(&now, &t);
    char buf[10];
    snprintf(buf, sizeof(buf), "%02d:%02d:%02d", t.tm_hour, t.tm_min, t.tm_sec);
    lv_label_set_text(clock_lbl_, buf);
}

void NavController::tab_btn_cb_(lv_event_t* e)
{
    NavController* self = static_cast<NavController*>(lv_event_get_user_data(e));
    lv_obj_t* btn = lv_event_get_target_obj(e);
    int idx = static_cast<int>(reinterpret_cast<intptr_t>(lv_obj_get_user_data(btn)));
    if (idx >= 0 && idx < self->N)
        self->navigate_to(static_cast<ScreenId>(idx));
}

} // namespace hmi
