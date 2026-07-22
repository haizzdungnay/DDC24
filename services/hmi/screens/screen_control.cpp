#include "screens/screen_control.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>

namespace hmi {

namespace {
enum ButtonId {
    BTN_POINT, BTN_MINUS, BTN_PLUS, BTN_REASON, BTN_AUTO, BTN_MANUAL,
    BTN_OVERRIDE, BTN_SETPOINT, BTN_RELEASE
};
const char* REASONS[] = {"maintenance", "commissioning", "temporary-check"};

lv_obj_t* button(lv_obj_t* root, int x, int y, int w, const char* text,
                 ScreenControl* self, int id, lv_obj_t** label_out)
{
    lv_obj_t* btn = lv_button_create(root);
    lv_obj_set_pos(btn, x, y); lv_obj_set_size(btn, w, 40);
    lv_obj_set_user_data(btn, reinterpret_cast<void*>(static_cast<intptr_t>(id)));
    lv_obj_add_event_cb(btn, ScreenControl::event_cb, LV_EVENT_CLICKED, self);
    lv_obj_t* label = lv_label_create(btn);
    lv_obj_set_style_text_font(label, hmi_font(), LV_PART_MAIN);
    lv_label_set_text(label, text); lv_obj_center(label);
    if (label_out) *label_out = label;
    return btn;
}
} // namespace

void ScreenControl::build(lv_obj_t* root, const Locale& l, const PointDb&)
{
    root_ = root; locale_ = &l;
    title_ = lv_label_create(root);
    lv_obj_set_pos(title_, 3, 0); lv_obj_set_size(title_, 314, 26);
    lv_obj_set_style_text_font(title_, hmi_font(), LV_PART_MAIN);
    point_btn_ = button(root, 3, 28, 105, "", this, BTN_POINT, &point_label_);
    minus_btn_ = button(root, 112, 28, 50, "-", this, BTN_MINUS, nullptr);
    plus_btn_ = button(root, 166, 28, 50, "+", this, BTN_PLUS, nullptr);
    reason_btn_ = button(root, 220, 28, 97, "", this, BTN_REASON, &reason_label_);
    auto_btn_ = button(root, 3, 70, 100, "", this, BTN_AUTO, &auto_label_);
    manual_btn_ = button(root, 110, 70, 100, "", this, BTN_MANUAL, &manual_label_);
    override_btn_ = button(root, 217, 70, 100, "", this, BTN_OVERRIDE, &override_label_);
    setpoint_btn_ = button(root, 3, 112, 154, "", this, BTN_SETPOINT, &setpoint_label_);
    release_btn_ = button(root, 163, 112, 154, "", this, BTN_RELEASE, &release_label_);
    status_label_ = lv_label_create(root);
    lv_obj_set_pos(status_label_, 3, 154); lv_obj_set_size(status_label_, 314, 30);
    lv_obj_set_style_text_font(status_label_, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(status_label_, LV_LABEL_LONG_WRAP);
    requested_ = effective_value();
    render();
}

std::string ScreenControl::point_id() const
{
    char id[8];
    std::snprintf(id, sizeof(id), "%s-%02d", selected_ < KX_N_AO ? "AO" : "DO",
                  selected_ < KX_N_AO ? selected_ + 1 : selected_ - KX_N_AO + 1);
    return id;
}

double ScreenControl::effective_value() const
{
    if (selected_ < KX_N_AO) return cache_.ao_setpoint[selected_];
    return cache_.do_feedback[selected_ - KX_N_AO] ? 1.0 : 0.0;
}

void ScreenControl::adjust(double delta)
{
    if (selected_ < KX_N_AO) {
        const double lo = cache_.ao_mode[selected_] ? 4.0 : 0.0;
        const double hi = cache_.ao_mode[selected_] ? 20.0 : 10.0;
        requested_ = std::max(lo, std::min(hi, requested_ + delta));
    } else {
        requested_ = delta > 0 ? 1.0 : 0.0;
    }
    dirty_ = true; confirm_action_.clear(); render();
}

void ScreenControl::cycle_point()
{
    selected_ = (selected_ + 1) % (KX_N_AO + KX_N_DO);
    requested_ = effective_value(); dirty_ = false; confirm_action_.clear(); render();
}

void ScreenControl::cycle_reason()
{
    reason_ = (reason_ + 1) % 3; render();
}

void ScreenControl::launch(const std::string& action, const std::string& mode)
{
    if (!api_ || !api_->available() || !api_->authenticated() ||
        !api_->can_control(point_id(), action) || pending_.valid())
        return;
    const std::string confirmation = action + ":" + mode;
    const uint32_t now = lv_tick_get();
    if (confirm_action_ != confirmation ||
        static_cast<int32_t>(now - confirm_until_ms_) > 0) {
        confirm_action_ = confirmation;
        confirm_until_ms_ = now + 5000u;
        status_ = std::string(locale_->str(StrKey::STR_CONFIRM)) + " " + action +
                  " " + point_id() + " - press again";
        render();
        return;
    }
    confirm_action_.clear();
    const std::string point = point_id();
    const double value = requested_;
    const std::string reason = action == "override" ? REASONS[reason_] : "";
    const uint32_t ttl = action == "override" ? 300u : 0u;
    status_ = "PENDING " + action + " " + point;
    pending_ = std::async(std::launch::async, [this, action, point, value, mode, reason, ttl] {
        return api_->command(action, point, value, mode, reason, ttl);
    });
    pending_query_ = false;
    render();
}

void ScreenControl::query()
{
    if (!api_ || !api_->authenticated() || !api_->can_control(point_id()) || pending_.valid()) return;
    const std::string point = point_id();
    pending_query_ = true;
    pending_ = std::async(std::launch::async, [this, point] {
        return api_->request("query", {{"pointId", point}});
    });
    next_query_ms_ = lv_tick_get() + 3000u;
}

void ScreenControl::poll()
{
    if (!pending_.valid() || pending_.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready)
        return;
    const ApiReply reply = pending_.get();
    const bool was_query = pending_query_;
    pending_query_ = false;
    status_ = (was_query ? "STATE " : "COMMAND ") + reply.result + " / " + reply.reason_code;
    if (reply.payload.contains("point")) {
        const auto& point = reply.payload["point"];
        status_ += "\nsource=" + point.value("priority", "unknown");
        if (point.contains("overrideExpiresInS"))
            status_ += " ttl=" + std::to_string(point.value("overrideExpiresInS", 0u)) + "s";
    }
    dirty_ = false;
}

void ScreenControl::render()
{
    if (!title_) return;
    const bool session = api_ && api_->authenticated();
    const bool auth = session && api_->available() && api_->can_control(point_id());
    lv_label_set_text_fmt(title_, "%s  %s:%s role:%s",
                          locale_->str(StrKey::STR_CONTROL),
                          locale_->str(StrKey::STR_SESSION),
                          session ? api_->username().c_str() : "none",
                          session ? api_->role().c_str() : "viewer");
    lv_label_set_text_fmt(point_label_, "%s\n%.1f", point_id().c_str(), requested_);
    lv_label_set_text_fmt(reason_label_, "%s\n%s", locale_->str(StrKey::STR_REASON), REASONS[reason_]);
    lv_label_set_text(auto_label_, locale_->str(StrKey::STR_AUTO));
    lv_label_set_text(manual_label_, locale_->str(StrKey::STR_MANUAL));
    lv_label_set_text(override_label_, locale_->str(StrKey::STR_OVERRIDE));
    lv_label_set_text(setpoint_label_, locale_->str(StrKey::STR_SETPOINT));
    lv_label_set_text(release_label_, locale_->str(StrKey::STR_RELEASE));
    const bool idle = !pending_.valid();
    const auto gate = [this, session, idle](lv_obj_t* btn, const char* action) {
        if (session && idle && api_->available() && api_->can_control(point_id(), action))
            lv_obj_clear_state(btn, LV_STATE_DISABLED);
        else
            lv_obj_add_state(btn, LV_STATE_DISABLED);
    };
    gate(auto_btn_, "mode"); gate(manual_btn_, "mode");
    gate(override_btn_, "override"); gate(setpoint_btn_, "setpoint");
    gate(release_btn_, "release");
    const std::string read_only = std::string(locale_->str(StrKey::STR_READ_ONLY)) +
        (session ? " - authority policy denied" : " - login in Service");
    lv_label_set_text(status_label_, auth ? status_.c_str() : read_only.c_str());
}

void ScreenControl::event_cb(lv_event_t* e)
{
    auto* self = static_cast<ScreenControl*>(lv_event_get_user_data(e));
    const int id = static_cast<int>(reinterpret_cast<intptr_t>(
        lv_obj_get_user_data(lv_event_get_target_obj(e))));
    if (id == BTN_POINT) self->cycle_point();
    else if (id == BTN_MINUS) self->adjust(self->selected_ < KX_N_AO ? -0.5 : -1.0);
    else if (id == BTN_PLUS) self->adjust(self->selected_ < KX_N_AO ? 0.5 : 1.0);
    else if (id == BTN_REASON) self->cycle_reason();
    else if (id == BTN_AUTO) self->launch("mode", "auto");
    else if (id == BTN_MANUAL) self->launch("mode", "manual");
    else if (id == BTN_OVERRIDE) self->launch("override");
    else if (id == BTN_SETPOINT) self->launch("setpoint");
    else if (id == BTN_RELEASE) self->launch("release");
}

void ScreenControl::on_key(uint32_t key, lv_indev_state_t state)
{
    if (state != LV_INDEV_STATE_PRESSED) return;
    if (key == LV_KEY_UP) adjust(selected_ < KX_N_AO ? 0.5 : 1.0);
    else if (key == LV_KEY_DOWN) adjust(selected_ < KX_N_AO ? -0.5 : -1.0);
    else if (key == LV_KEY_ENTER) launch("override");
    else if (key == LV_KEY_ESC) cycle_point();
}

void ScreenControl::on_data_update(const DataCache& c, const PointDb&, const Locale& l)
{
    cache_ = c; locale_ = &l; poll();
    if (!dirty_ && !pending_.valid()) requested_ = effective_value();
    if (!pending_.valid() && api_ && api_->authenticated() && api_->can_control(point_id()) &&
        static_cast<int32_t>(lv_tick_get() - next_query_ms_) >= 0) query();
    render();
}

void ScreenControl::rebuild_labels(const Locale& l) { locale_ = &l; render(); }

} // namespace hmi
