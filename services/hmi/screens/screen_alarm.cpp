#include "screens/screen_alarm.hpp"

#include <cstring>

namespace hmi {

static const char* alarm_state_text(AlarmState s)
{
    switch (s) {
        case AlarmState::ACTIVE_UNACK: return "ACTIVE_UNACK";
        case AlarmState::ACTIVE_ACK: return "ACTIVE_ACK";
        case AlarmState::CLEARED_UNACK: return "CLEARED_UNACK";
        case AlarmState::CLEARED_ACK: return "CLEARED_ACK";
    }
    return "UNKNOWN";
}

static lv_obj_t* alarm_label(lv_obj_t* root, int y, int h)
{
    lv_obj_t* label = lv_label_create(root);
    lv_obj_set_pos(label, 3, y);
    lv_obj_set_size(label, 314, h);
    lv_obj_set_style_text_font(label, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
    return label;
}

void ScreenAlarm::build(lv_obj_t* root, const Locale& l, const PointDb&)
{
    root_ = root; locale_ = &l;
    title_ = alarm_label(root, 0, 18);
    summary_ = alarm_label(root, 19, 20);
    for (int i = 0; i < VISIBLE_ROWS; ++i)
        rows_[i] = alarm_label(root, 40 + i * 32, 31);
    ack_btn_ = lv_button_create(root);
    lv_obj_set_pos(ack_btn_, 3, 171); lv_obj_set_size(ack_btn_, 135, 29);
    ack_label_ = lv_label_create(ack_btn_); lv_obj_center(ack_label_);
    lv_obj_add_event_cb(ack_btn_, ack_cb, LV_EVENT_CLICKED, this);
    filter_btn_ = lv_button_create(root);
    lv_obj_set_pos(filter_btn_, 145, 171); lv_obj_set_size(filter_btn_, 165, 29);
    filter_label_ = lv_label_create(filter_btn_); lv_obj_center(filter_label_);
    lv_obj_add_event_cb(filter_btn_, filter_cb, LV_EVENT_CLICKED, this);
    render();
}

std::vector<int> ScreenAlarm::visible_indices(
    const std::array<AlarmEntry, AlarmModel::RING>& snap) const
{
    std::vector<int> out;
    for (int i = 0; i < AlarmModel::RING; ++i) {
        if (!snap[i].used) continue;
        const bool active = snap[i].state == AlarmState::ACTIVE_UNACK ||
                            snap[i].state == AlarmState::ACTIVE_ACK;
        const bool unacked = snap[i].state == AlarmState::ACTIVE_UNACK ||
                             snap[i].state == AlarmState::CLEARED_UNACK;
        if ((filter_ == Filter::ACTIVE && !active) ||
            (filter_ == Filter::UNACKED && !unacked)) continue;
        out.push_back(i);
    }
    return out;
}

void ScreenAlarm::render()
{
    if (!model_ || !locale_) return;
    lv_label_set_text(title_, locale_->str(StrKey::STR_ALARM_EVENT));
    lv_label_set_text_fmt(summary_, "%s:%d  %s:%d  %s:%d",
                          locale_->str(StrKey::STR_ACTIVE), model_->active_count(),
                          locale_->str(StrKey::STR_UNACKED), model_->unacked_count(),
                          locale_->str(StrKey::STR_CRITICAL), model_->critical_count());
    int count = 0;
    const auto snap = model_->snapshot(&count);
    const auto idxs = visible_indices(snap);
    if (idxs.empty()) selected_ = 0;
    else if (selected_ >= static_cast<int>(idxs.size())) selected_ = static_cast<int>(idxs.size()) - 1;
    const int first = selected_ >= VISIBLE_ROWS ? selected_ - VISIBLE_ROWS + 1 : 0;
    for (int row = 0; row < VISIBLE_ROWS; ++row) {
        const int pos = first + row;
        if (pos >= static_cast<int>(idxs.size())) {
            lv_label_set_text(rows_[row], "");
            continue;
        }
        const AlarmEntry& a = snap[idxs[pos]];
        const char* sev = a.severity == AlarmSeverity::FAULT ? "FAULT"
                        : a.severity == AlarmSeverity::WARN ? "WARN" : "INFO";
        const char* time = std::strlen(a.ts) >= 8 ? a.ts + std::strlen(a.ts) - 8 : a.ts;
        lv_label_set_text_fmt(rows_[row], "%c %.8s %-7s %-5s %.8s\n  %.18s %.15s",
                              pos == selected_ ? '>' : ' ', time, a.code, sev,
                              a.source, a.msg, alarm_state_text(a.state));
        lv_obj_set_style_text_color(rows_[row], a.severity == AlarmSeverity::FAULT
            ? lv_color_hex(0xFF5555) : a.severity == AlarmSeverity::WARN
            ? lv_color_hex(0xFFCC33) : lv_color_hex(0xBBBBBB), LV_PART_MAIN);
    }
    lv_label_set_text(ack_label_, locale_->str(StrKey::STR_ACK_SELECTED));
    const char* filter = filter_ == Filter::ACTIVE ? "Active"
                       : filter_ == Filter::ALL ? "All" : "Unacked";
    lv_label_set_text_fmt(filter_label_, "Filter: %s", filter);
}

void ScreenAlarm::ack_selected()
{
    int count = 0;
    const auto snap = model_->snapshot(&count);
    const auto idxs = visible_indices(snap);
    if (selected_ >= 0 && selected_ < static_cast<int>(idxs.size()))
        model_->ack(idxs[selected_]);
    render();
}

void ScreenAlarm::cycle_filter()
{
    filter_ = filter_ == Filter::ACTIVE ? Filter::ALL
            : filter_ == Filter::ALL ? Filter::UNACKED : Filter::ACTIVE;
    selected_ = 0; render();
}

void ScreenAlarm::ack_cb(lv_event_t* e)
{ static_cast<ScreenAlarm*>(lv_event_get_user_data(e))->ack_selected(); }
void ScreenAlarm::filter_cb(lv_event_t* e)
{ static_cast<ScreenAlarm*>(lv_event_get_user_data(e))->cycle_filter(); }

void ScreenAlarm::on_key(uint32_t key, lv_indev_state_t state)
{
    if (state != LV_INDEV_STATE_PRESSED) return;
    int count = 0; const auto snap = model_->snapshot(&count);
    const auto idxs = visible_indices(snap);
    if (key == LV_KEY_UP && selected_ > 0) --selected_;
    else if (key == LV_KEY_DOWN && selected_ + 1 < static_cast<int>(idxs.size())) ++selected_;
    else if (key == LV_KEY_ENTER) ack_selected();
    render();
}

void ScreenAlarm::on_data_update(const DataCache&, const PointDb&, const Locale& l)
{ locale_ = &l; render(); }
void ScreenAlarm::rebuild_labels(const Locale& l) { locale_ = &l; render(); }

} // namespace hmi
