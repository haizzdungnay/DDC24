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

lv_obj_t* button(lv_obj_t* root, int x, int y, int w, int h, const char* text,
                 lv_event_cb_t callback, void* user)
{
    lv_obj_t* result = lv_button_create(root);
    lv_obj_set_pos(result, x, y); lv_obj_set_size(result, w, h);
    lv_obj_add_event_cb(result, callback, LV_EVENT_CLICKED, user);
    lv_obj_t* caption = lv_label_create(result);
    lv_obj_set_style_text_font(caption, hmi_font(), LV_PART_MAIN);
    lv_label_set_text(caption, text); lv_obj_center(caption);
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
    diagnostics_label_ = label(root, 130, 23);
    network_btn_ = lv_button_create(root);
    lv_obj_set_pos(network_btn_, 3, 154); lv_obj_set_size(network_btn_, 314, 28);
    network_btn_label_ = lv_label_create(network_btn_); lv_obj_center(network_btn_label_);
    lv_obj_set_style_text_font(network_btn_label_, hmi_font(), LV_PART_MAIN);
    lv_obj_add_event_cb(network_btn_, network_open_cb, LV_EVENT_CLICKED, this);

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
    if (network_model_.update(reply)) {
        if (pending_action_ == "network_status" && network_interface_ &&
            !network_model_.interface().empty())
            lv_textarea_set_text(network_interface_, network_model_.interface().c_str());
        render_network();
    }
    pending_action_.clear();
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
    lv_label_set_text(network_btn_label_, "Network configuration");
    if (pending_.valid()) lv_obj_add_state(auth_btn_, LV_STATE_DISABLED);
    else lv_obj_clear_state(auth_btn_, LV_STATE_DISABLED);
    render_network();
}

void ScreenService::show_network()
{
    if (!api_ || !api_->authenticated()) {
        status_ = locale_->str(StrKey::STR_CREDENTIALS_REQUIRED);
        render(); return;
    }
    if (network_modal_) return;
    network_modal_ = lv_obj_create(lv_layer_top());
    lv_obj_set_pos(network_modal_, 2, 2); lv_obj_set_size(network_modal_, 316, 236);
    lv_obj_clear_flag(network_modal_, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* title = label(network_modal_, 1, 20);
    lv_label_set_text(title, "Network commissioning (120s rollback)");
    network_status_ = label(network_modal_, 22, 38);
    network_mode_ = lv_dropdown_create(network_modal_);
    lv_obj_set_pos(network_mode_, 3, 62); lv_obj_set_size(network_mode_, 88, 36);
    lv_dropdown_set_options(network_mode_, "static\ndhcp");
    network_interface_ = lv_textarea_create(network_modal_);
    lv_obj_set_pos(network_interface_, 95, 62); lv_obj_set_size(network_interface_, 104, 36);
    lv_textarea_set_one_line(network_interface_, true); lv_textarea_set_max_length(network_interface_, 15);
    lv_textarea_set_text(network_interface_, "eth0");
    lv_obj_add_event_cb(network_interface_, focus_cb, LV_EVENT_FOCUSED, this);
    network_close_ = button(network_modal_, 203, 62, 106, 36, "Close", network_cb, this);

    network_ip_ = lv_textarea_create(network_modal_);
    lv_obj_set_pos(network_ip_, 3, 102); lv_obj_set_size(network_ip_, 150, 36);
    lv_textarea_set_one_line(network_ip_, true); lv_textarea_set_max_length(network_ip_, 15);
    lv_textarea_set_placeholder_text(network_ip_, "IPv4 address");
    lv_obj_add_event_cb(network_ip_, focus_cb, LV_EVENT_FOCUSED, this);
    network_mask_ = lv_textarea_create(network_modal_);
    lv_obj_set_pos(network_mask_, 157, 102); lv_obj_set_size(network_mask_, 152, 36);
    lv_textarea_set_one_line(network_mask_, true); lv_textarea_set_max_length(network_mask_, 15);
    lv_textarea_set_placeholder_text(network_mask_, "Netmask");
    lv_obj_add_event_cb(network_mask_, focus_cb, LV_EVENT_FOCUSED, this);
    network_gateway_ = lv_textarea_create(network_modal_);
    lv_obj_set_pos(network_gateway_, 3, 142); lv_obj_set_size(network_gateway_, 150, 36);
    lv_textarea_set_one_line(network_gateway_, true); lv_textarea_set_max_length(network_gateway_, 15);
    lv_textarea_set_placeholder_text(network_gateway_, "Gateway");
    lv_obj_add_event_cb(network_gateway_, focus_cb, LV_EVENT_FOCUSED, this);
    network_stage_ = button(network_modal_, 157, 142, 73, 36, "Stage", network_cb, this);
    network_apply_ = button(network_modal_, 234, 142, 75, 36, "Apply", network_cb, this);
    network_confirm_ = button(network_modal_, 3, 182, 98, 44, "Confirm", network_cb, this);
    network_rollback_ = button(network_modal_, 105, 182, 98, 44, "Rollback", network_cb, this);
    network_refresh_ = button(network_modal_, 207, 182, 102, 44, "Refresh", network_cb, this);
    render_network();
    network_action("status");
}

void ScreenService::close_network()
{
    if (keyboard_) lv_obj_add_flag(keyboard_, LV_OBJ_FLAG_HIDDEN);
    if (network_modal_) lv_obj_delete(network_modal_);
    network_modal_ = network_status_ = network_mode_ = network_interface_ = nullptr;
    network_ip_ = network_mask_ = network_gateway_ = nullptr;
    network_stage_ = network_apply_ = network_confirm_ = network_rollback_ = nullptr;
    network_refresh_ = network_close_ = nullptr;
}

void ScreenService::network_action(const std::string& action)
{
    if (!api_ || pending_.valid()) return;
    if (action != "status" && api_->role() != "admin") {
        status_ = "Network changes require Admin role";
        render_network(); return;
    }
    pending_action_ = "network_" + action;
    if (action == "status") {
        pending_ = std::async(std::launch::async, [this] { return api_->network_status(); });
    } else if (action == "stage") {
        char mode[16]{};
        lv_dropdown_get_selected_str(network_mode_, mode, sizeof(mode));
        nlohmann::json candidate{{"interface", lv_textarea_get_text(network_interface_)}, {"mode", mode}};
        if (std::string(mode) == "static") {
            candidate["ipv4"] = lv_textarea_get_text(network_ip_);
            candidate["netmask"] = lv_textarea_get_text(network_mask_);
            candidate["gateway"] = lv_textarea_get_text(network_gateway_);
        }
        pending_ = std::async(std::launch::async, [this, candidate] { return api_->network_stage(candidate); });
    } else {
        const std::string transaction = network_model_.transaction_id();
        if (transaction.empty()) { pending_action_.clear(); return; }
        pending_ = std::async(std::launch::async, [this, action, transaction] {
            if (action == "apply") return api_->network_apply(transaction);
            if (action == "confirm") return api_->network_confirm(transaction);
            return api_->network_rollback(transaction);
        });
    }
    render_network();
}

void ScreenService::render_network()
{
    if (!network_modal_) return;
    const std::string summary = network_model_.summary() +
        (pending_action_.empty() ? "" : "\nWorking: " + pending_action_);
    lv_label_set_text(network_status_, summary.c_str());
    const bool admin = api_ && api_->role() == "admin";
    const bool busy = pending_.valid();
    const auto enabled = [busy](lv_obj_t* object, bool allowed) {
        if (!object) return;
        if (!busy && allowed) lv_obj_clear_state(object, LV_STATE_DISABLED);
        else lv_obj_add_state(object, LV_STATE_DISABLED);
    };
    enabled(network_stage_, admin);
    enabled(network_apply_, admin && network_model_.can_apply());
    enabled(network_confirm_, admin && network_model_.can_confirm_or_rollback());
    enabled(network_rollback_, admin && network_model_.can_confirm_or_rollback());
    enabled(network_refresh_, true);
}

void ScreenService::auth_cb(lv_event_t* e)
{
    static_cast<ScreenService*>(lv_event_get_user_data(e))->authenticate();
}

void ScreenService::network_open_cb(lv_event_t* e)
{
    static_cast<ScreenService*>(lv_event_get_user_data(e))->show_network();
}

void ScreenService::network_cb(lv_event_t* e)
{
    auto* self = static_cast<ScreenService*>(lv_event_get_user_data(e));
    lv_obj_t* target = lv_event_get_target_obj(e);
    if (target == self->network_close_) self->close_network();
    else if (target == self->network_stage_) self->network_action("stage");
    else if (target == self->network_apply_) self->network_action("apply");
    else if (target == self->network_confirm_) self->network_action("confirm");
    else if (target == self->network_rollback_) self->network_action("rollback");
    else if (target == self->network_refresh_) self->network_action("status");
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
    else if (key == LV_KEY_ESC && keyboard_ && !lv_obj_has_flag(keyboard_, LV_OBJ_FLAG_HIDDEN))
        lv_obj_add_flag(keyboard_, LV_OBJ_FLAG_HIDDEN);
    else if (key == LV_KEY_ESC && network_modal_) close_network();
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
