#include "screens/screen_service.hpp"

#include <chrono>
#include <cstdio>

namespace hmi {

namespace {
lv_obj_t* label(lv_obj_t* root, int y, int h)
{
    lv_obj_t* result = lv_label_create(root);
    lv_obj_set_pos(result, 3, y); lv_obj_set_size(result, 314, h);
    lv_obj_set_style_text_font(result, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(result, LV_LABEL_LONG_WRAP);
    return result;
}
} // namespace

void ScreenService::build(lv_obj_t* root, const Locale& l, const PointDb&)
{
    root_ = root; locale_ = &l;
    title_ = label(root, 0, 20);
    session_ = label(root, 21, 22);
    username_ = lv_textarea_create(root);
    lv_obj_set_pos(username_, 3, 45); lv_obj_set_size(username_, 98, 40);
    lv_textarea_set_one_line(username_, true); lv_textarea_set_max_length(username_, 32);
    lv_textarea_set_placeholder_text(username_, l.str(StrKey::STR_USERNAME));
    lv_obj_add_event_cb(username_, focus_cb, LV_EVENT_FOCUSED, this);
    password_ = lv_textarea_create(root);
    lv_obj_set_pos(password_, 105, 45); lv_obj_set_size(password_, 103, 40);
    lv_textarea_set_one_line(password_, true); lv_textarea_set_password_mode(password_, true);
    lv_textarea_set_max_length(password_, 64);
    lv_textarea_set_placeholder_text(password_, l.str(StrKey::STR_PASSWORD));
    lv_obj_add_event_cb(password_, focus_cb, LV_EVENT_FOCUSED, this);
    auth_btn_ = lv_button_create(root);
    lv_obj_set_pos(auth_btn_, 212, 45); lv_obj_set_size(auth_btn_, 105, 40);
    auth_label_ = lv_label_create(auth_btn_); lv_obj_center(auth_label_);
    lv_obj_set_style_text_font(auth_label_, hmi_font(), LV_PART_MAIN);
    lv_obj_add_event_cb(auth_btn_, auth_cb, LV_EVENT_CLICKED, this);
    status_label_ = label(root, 88, 40);
    diagnostics_label_ = label(root, 130, 52);

    keyboard_ = lv_keyboard_create(lv_layer_top());
    lv_obj_set_size(keyboard_, 320, 120);
    lv_obj_align(keyboard_, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_add_event_cb(keyboard_, keyboard_cb, LV_EVENT_ALL, this);
    lv_obj_add_flag(keyboard_, LV_OBJ_FLAG_HIDDEN);
    render();
}

void ScreenService::authenticate()
{
    if (!api_ || pending_.valid()) return;
    if (api_->authenticated()) {
        status_ = "Logging out...";
        pending_ = std::async(std::launch::async, [this] { return api_->logout(); });
    } else {
        const std::string username = lv_textarea_get_text(username_);
        const std::string password = lv_textarea_get_text(password_);
        if (username.empty() || password.empty()) {
            status_ = locale_->str(StrKey::STR_CREDENTIALS_REQUIRED);
            render(); return;
        }
        status_ = "Authenticating...";
        lv_textarea_set_text(password_, "");
        pending_ = std::async(std::launch::async, [this, username, password] {
            return api_->login(username, password);
        });
    }
    render();
}

void ScreenService::poll()
{
    if (!pending_.valid() || pending_.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready)
        return;
    const ApiReply reply = pending_.get();
    status_ = reply.result + " / " + reply.reason_code;
}

void ScreenService::render()
{
    if (!title_) return;
    const bool authenticated = api_ && api_->authenticated();
    lv_label_set_text_fmt(title_, "%s / %s", locale_->str(StrKey::STR_SERVICE_SESSION),
                          locale_->str(StrKey::STR_DIAGNOSTICS));
    lv_label_set_text_fmt(session_, "%s: %s  User:%s  Role:%s",
                          locale_->str(StrKey::STR_SESSION),
                          authenticated ? "ACTIVE" : locale_->str(StrKey::STR_READ_ONLY),
                          authenticated ? api_->username().c_str() : "-",
                          authenticated ? api_->role().c_str() : "viewer");
    lv_label_set_text(auth_label_, locale_->str(authenticated ? StrKey::STR_LOGOUT : StrKey::STR_LOGIN));
    lv_textarea_set_placeholder_text(username_, locale_->str(StrKey::STR_USERNAME));
    lv_textarea_set_placeholder_text(password_, locale_->str(StrKey::STR_PASSWORD));
    lv_label_set_text(status_label_, status_.c_str());
    lv_label_set_text(diagnostics_label_, diagnostics_.c_str());
    if (pending_.valid()) lv_obj_add_state(auth_btn_, LV_STATE_DISABLED);
    else lv_obj_clear_state(auth_btn_, LV_STATE_DISABLED);
}

void ScreenService::auth_cb(lv_event_t* e)
{
    static_cast<ScreenService*>(lv_event_get_user_data(e))->authenticate();
}

void ScreenService::focus_cb(lv_event_t* e)
{
    auto* self = static_cast<ScreenService*>(lv_event_get_user_data(e));
    lv_keyboard_set_textarea(self->keyboard_, lv_event_get_target_obj(e));
    lv_obj_clear_flag(self->keyboard_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_move_foreground(self->keyboard_);
}

void ScreenService::keyboard_cb(lv_event_t* e)
{
    const lv_event_code_t code = lv_event_get_code(e);
    if (code != LV_EVENT_READY && code != LV_EVENT_CANCEL) return;
    auto* self = static_cast<ScreenService*>(lv_event_get_user_data(e));
    lv_obj_add_flag(self->keyboard_, LV_OBJ_FLAG_HIDDEN);
    if (code == LV_EVENT_READY && lv_keyboard_get_textarea(self->keyboard_) == self->password_)
        self->authenticate();
}

void ScreenService::on_key(uint32_t key, lv_indev_state_t state)
{
    if (state != LV_INDEV_STATE_PRESSED) return;
    if (key == LV_KEY_ENTER) authenticate();
    else if (key == LV_KEY_ESC && keyboard_) lv_obj_add_flag(keyboard_, LV_OBJ_FLAG_HIDDEN);
}

void ScreenService::on_data_update(const DataCache& c, const PointDb&, const Locale& l)
{
    locale_ = &l; poll();
    diagnostics_ = std::string("Core telemetry: ") + (c.age_ns == UINT64_MAX ? "STALE" : "LIVE") +
                   "  IOP:" + (c.iop_status == KX_IOP_NORMAL ? "NORMAL" : "FAULT") +
                   "\nBroker:" + (api_ ? api_->socket_path() : "unavailable") +
                   " " + (api_ && api_->available() ? "ONLINE" : "OFFLINE");
    render();
}

void ScreenService::on_sys_update(const SysSnapshot& s, const Locale& l)
{
    locale_ = &l;
    char uptime[32]; fmt_uptime(uptime, sizeof(uptime), s.uptime_s);
    char buf[160];
    const double ram_pct = s.ram_total_mb == 0 ? 0.0 :
        100.0 * static_cast<double>(s.ram_used_mb) / static_cast<double>(s.ram_total_mb);
    std::snprintf(buf, sizeof(buf), "CPU:%.0f%% RAM:%.0f%% Temp:%.1fC Uptime:%s\nBroker:%s",
                  static_cast<double>(s.cpu_pct), ram_pct,
                  static_cast<double>(s.cpu_temp_c10) / 10.0, uptime,
                  api_ ? (api_->socket_path() + (api_->available() ? " ONLINE" : " OFFLINE")).c_str()
                       : "unavailable");
    diagnostics_ = buf; render();
}

void ScreenService::rebuild_labels(const Locale& l) { locale_ = &l; render(); }

} // namespace hmi
