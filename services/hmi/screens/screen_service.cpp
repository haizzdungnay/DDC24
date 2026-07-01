#include "screens/screen_service.hpp"

#include <algorithm>

namespace hmi {

static lv_obj_t* svc_label(lv_obj_t* root, int y, int h)
{
    lv_obj_t* label = lv_label_create(root);
    lv_obj_set_pos(label, 3, y); lv_obj_set_size(label, 314, h);
    lv_obj_set_style_text_font(label, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
    return label;
}

bool ScreenService::role_allows_service(const std::string& role)
{
    return role == "Engineer" || role == "Service" || role == "admin";
}

bool ScreenService::held_long_enough(uint32_t start_ms, uint32_t end_ms)
{
    return static_cast<uint32_t>(end_ms - start_ms) >= 3000u;
}

void ScreenService::set_access_policy(std::string expected_pin, bool service_switch,
                                      std::string role)
{
    expected_pin_ = std::move(expected_pin);
    service_switch_ = service_switch;
    role_ = std::move(role);
    unlocked_ = pin_unlocked_ || service_switch_ || role_allows_service(role_);
    render();
}

bool ScreenService::try_unlock(const std::string& pin)
{
    if (service_switch_ || role_allows_service(role_)) unlocked_ = true;
    else if (!expected_pin_.empty() && pin.size() == expected_pin_.size()) {
        unsigned diff = 0;
        for (size_t i = 0; i < pin.size(); ++i)
            diff |= static_cast<unsigned char>(pin[i]) ^
                    static_cast<unsigned char>(expected_pin_[i]);
        pin_unlocked_ = diff == 0;
        unlocked_ = pin_unlocked_;
    }
    render();
    return unlocked_;
}

void ScreenService::lock()
{
    pin_unlocked_ = false;
    unlocked_ = false;
    reboot_press_ms_ = 0;
    render();
}

void ScreenService::build(lv_obj_t* root, const Locale& l, const PointDb& db)
{
    root_ = root; locale_ = &l; db_ = &db;
    title_ = svc_label(root, 0, 18);
    access_ = svc_label(root, 19, 22);
    project_ = svc_label(root, 42, 22);
    point_db_ = svc_label(root, 65, 22);
    safe_ = svc_label(root, 88, 22);
    status_ = svc_label(root, 111, 19);

    pin_ = lv_textarea_create(root);
    lv_obj_set_pos(pin_, 3, 124); lv_obj_set_size(pin_, 112, 29);
    lv_textarea_set_one_line(pin_, true);
    lv_textarea_set_password_mode(pin_, true);
    lv_textarea_set_max_length(pin_, 12);
    lv_obj_add_event_cb(pin_, pin_focus_cb, LV_EVENT_FOCUSED, this);
    unlock_btn_ = lv_button_create(root);
    lv_obj_set_pos(unlock_btn_, 120, 124); lv_obj_set_size(unlock_btn_, 82, 29);
    unlock_label_ = lv_label_create(unlock_btn_); lv_obj_center(unlock_label_);
    lv_obj_add_event_cb(unlock_btn_, unlock_cb, LV_EVENT_CLICKED, this);

    static const int x[ACTION_COUNT] = {3, 106, 209, 55, 160};
    static const int y[ACTION_COUNT] = {155, 155, 155, 179, 179};
    static const int w[ACTION_COUNT] = {98, 98, 108, 100, 100};
    for (int i = 0; i < ACTION_COUNT; ++i) {
        action_btn_[i] = lv_button_create(root);
        lv_obj_set_pos(action_btn_[i], x[i], y[i]);
        lv_obj_set_size(action_btn_[i], w[i], 22);
        lv_obj_set_user_data(action_btn_[i], reinterpret_cast<void*>(static_cast<intptr_t>(i)));
        lv_obj_add_event_cb(action_btn_[i], action_cb, LV_EVENT_ALL, this);
        action_label_[i] = lv_label_create(action_btn_[i]);
        lv_obj_set_style_text_font(action_label_[i], hmi_font(), LV_PART_MAIN);
        lv_obj_center(action_label_[i]);
    }

    keyboard_ = lv_keyboard_create(lv_layer_top());
    lv_obj_set_size(keyboard_, 320, 120);
    lv_obj_align(keyboard_, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_keyboard_set_textarea(keyboard_, pin_);
    lv_obj_add_event_cb(keyboard_, keyboard_cb, LV_EVENT_ALL, this);
    lv_obj_add_flag(keyboard_, LV_OBJ_FLAG_HIDDEN);
    render();
}

void ScreenService::render()
{
    if (!locale_ || !db_ || !title_) return;
    lv_label_set_text_fmt(title_, "%s                                      %s",
                          locale_->str(StrKey::STR_SERVICE_CONFIG),
                          unlocked_ ? locale_->str(StrKey::STR_UNLOCKED)
                                    : locale_->str(StrKey::STR_LOCKED));
    lv_label_set_text_fmt(access_, "ACCESS  Role:%s  Service SW:%s",
                          role_.c_str(), service_switch_ ? "ON" : "OFF");
    lv_label_set_text_fmt(project_, "PROJECT  ID:%s Profile:%s Rev:%d Sum:%.8s",
                          db_->meta().project_id.c_str(), db_->meta().profile.c_str(),
                          db_->meta().revision,
                          db_->meta().checksum.empty() ? "N/A" : db_->meta().checksum.c_str());
    lv_label_set_text_fmt(point_db_, "POINT DB  Total:%zu UI:%zu DI:%zu AO:%zu DO:%zu",
                          db_->count(), db_->count_by_type("UI"), db_->count_by_type("DI"),
                          db_->count_by_type("AO"), db_->count_by_type("DO"));
    lv_label_set_text(safe_, "SAFE STATE  AO/DO:PER_POINT  UI/DI:READ_ONLY");
    lv_label_set_text(status_, unlocked_ ? "Actions enabled" : "PIN / switch / Engineer required");
    lv_label_set_text(unlock_label_, unlocked_ ? "Lock" : "Unlock");
    static const StrKey keys[ACTION_COUNT] = {
        StrKey::STR_RELOAD_CONFIG, StrKey::STR_RESTART_SERVICES,
        StrKey::STR_REBOOT_SYSTEM, StrKey::STR_BACKUP_CONFIG,
        StrKey::STR_RESTORE_CONFIG};
    for (int i = 0; i < ACTION_COUNT; ++i) {
        lv_label_set_text(action_label_[i], locale_->str(keys[i]));
        if (unlocked_) lv_obj_clear_state(action_btn_[i], LV_STATE_DISABLED);
        else lv_obj_add_state(action_btn_[i], LV_STATE_DISABLED);
        lv_obj_set_style_border_width(action_btn_[i], i == selected_action_ ? 2 : 0,
                                      LV_PART_MAIN);
    }
}

void ScreenService::invoke_action(int action)
{
    if (!unlocked_) return;
    bool ok = false;
    if (action == RELOAD && actions_.reload_config) ok = actions_.reload_config();
    else if (action == RESTART && actions_.restart_services) ok = actions_.restart_services();
    else if (action == REBOOT && actions_.safe_reboot) ok = actions_.safe_reboot();
    else if (action == BACKUP && actions_.backup_config) ok = actions_.backup_config();
    else if (action == RESTORE && actions_.restore_config) ok = actions_.restore_config();
    lv_label_set_text(status_, ok ? "Action accepted" : "Action failed / unavailable");
}

void ScreenService::begin_reboot_hold()
{
    if (!unlocked_) return;
    reboot_press_ms_ = lv_tick_get();
    lv_label_set_text(status_, locale_->str(StrKey::STR_REBOOT_CONFIRM));
}

void ScreenService::finish_reboot_hold()
{
    if (!reboot_press_ms_) return;
    const bool confirmed = held_long_enough(reboot_press_ms_, lv_tick_get());
    reboot_press_ms_ = 0;
    if (confirmed) invoke_action(REBOOT);
    else lv_label_set_text(status_, "Reboot cancelled: hold for 3 seconds");
}

void ScreenService::unlock_cb(lv_event_t* e)
{
    auto* self = static_cast<ScreenService*>(lv_event_get_user_data(e));
    if (self->unlocked_) self->lock();
    else self->try_unlock(lv_textarea_get_text(self->pin_));
}

void ScreenService::action_cb(lv_event_t* e)
{
    auto* self = static_cast<ScreenService*>(lv_event_get_user_data(e));
    const int action = static_cast<int>(reinterpret_cast<intptr_t>(
        lv_obj_get_user_data(lv_event_get_target_obj(e))));
    if (action < 0 || action >= ACTION_COUNT || !self->unlocked_) return;
    self->selected_action_ = action;
    const lv_event_code_t code = lv_event_get_code(e);
    if (action == REBOOT) {
        if (code == LV_EVENT_PRESSED) self->begin_reboot_hold();
        else if (code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST)
            self->finish_reboot_hold();
    } else if (code == LV_EVENT_CLICKED) {
        self->invoke_action(action);
    }
    self->render();
}

void ScreenService::pin_focus_cb(lv_event_t* e)
{
    auto* self = static_cast<ScreenService*>(lv_event_get_user_data(e));
    lv_obj_clear_flag(self->keyboard_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_move_foreground(self->keyboard_);
}

void ScreenService::keyboard_cb(lv_event_t* e)
{
    const lv_event_code_t code = lv_event_get_code(e);
    if (code != LV_EVENT_READY && code != LV_EVENT_CANCEL) return;
    auto* self = static_cast<ScreenService*>(lv_event_get_user_data(e));
    lv_obj_add_flag(self->keyboard_, LV_OBJ_FLAG_HIDDEN);
    if (code == LV_EVENT_READY) self->try_unlock(lv_textarea_get_text(self->pin_));
}

void ScreenService::on_key(uint32_t key, lv_indev_state_t state)
{
    if (key == LV_KEY_ESC && state == LV_INDEV_STATE_PRESSED) {
        if (keyboard_) lv_obj_add_flag(keyboard_, LV_OBJ_FLAG_HIDDEN);
        lock(); return;
    }
    if (key == LV_KEY_UP && state == LV_INDEV_STATE_PRESSED)
        selected_action_ = (selected_action_ - 1 + ACTION_COUNT) % ACTION_COUNT;
    else if (key == LV_KEY_DOWN && state == LV_INDEV_STATE_PRESSED)
        selected_action_ = (selected_action_ + 1) % ACTION_COUNT;
    else if (key == LV_KEY_ENTER) {
        if (!unlocked_ && state == LV_INDEV_STATE_PRESSED)
            try_unlock(lv_textarea_get_text(pin_));
        else if (selected_action_ == REBOOT) {
            if (state == LV_INDEV_STATE_PRESSED) begin_reboot_hold();
            else finish_reboot_hold();
        } else if (state == LV_INDEV_STATE_PRESSED) invoke_action(selected_action_);
    }
    render();
}

void ScreenService::on_data_update(const DataCache&, const PointDb& db, const Locale& l)
{ db_ = &db; locale_ = &l; render(); }
void ScreenService::rebuild_labels(const Locale& l) { locale_ = &l; render(); }

} // namespace hmi
