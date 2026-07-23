#include "screens/screen_io.hpp"

#include <algorithm>
#include <cstdio>

namespace hmi {

static lv_obj_t* io_label(lv_obj_t* root, int x, int y, int w, int h)
{
    lv_obj_t* label = lv_label_create(root);
    lv_obj_set_pos(label, x, y);
    lv_obj_set_size(label, w, h);
    lv_obj_set_style_text_font(label, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
    return label;
}

void ScreenIo::build(lv_obj_t* root, const Locale& l, const PointDb& db)
{
    root_ = root; locale_ = &l; db_ = &db;
    title_ = io_label(root, 3, 0, 220, 18);
    header_ = io_label(root, 3, 19, 314, 18);
    for (int i = 0; i < VISIBLE_ROWS; ++i)
        row_labels_[i] = io_label(root, 3, 38 + i * 20, 314, 19);
    filter_btn_ = lv_button_create(root);
    lv_obj_set_pos(filter_btn_, 3, 140);
    lv_obj_set_size(filter_btn_, 140, 40);
    filter_label_ = lv_label_create(filter_btn_);
    lv_obj_center(filter_label_);
    lv_obj_add_event_cb(filter_btn_, filter_cb, LV_EVENT_CLICKED, this);
    page_label_ = io_label(root, 150, 150, 165, 24);
    lv_obj_set_style_text_align(page_label_, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
    rebuild_labels(l);
}

std::vector<ScreenIo::Row> ScreenIo::rows() const
{
    std::vector<Row> out;
    if (!db_) return out;
    const bool all_stale = cache_.age_ns == UINT64_MAX ||
        cache_.age_ns > static_cast<uint64_t>(db_->meta().stale_threshold_s) * 1000000000ull;
    auto append = [&](const std::string& type, int ch, const std::string& id,
                      float value, const std::string& unit, uint8_t quality) {
        const PointEntry* p = db_->find_by_type_ch(type, ch);
        Row r{id, p && !p->display_name.empty() ? p->display_name : id,
              type, p && !p->unit.empty() ? p->unit : unit,
              value, quality, all_stale};
        if (filter_ == Filter::BAD && r.quality != KX_Q_BAD) return;
        if (filter_ == Filter::STALE && !r.stale) return;
        out.push_back(std::move(r));
    };
    auto append_configured = [&](const PointEntry& p) {
        const int i = p.channel - 1;
        if (p.io_type == "UI" && i >= 0 && i < KX_N_UI)
            append("UI", p.channel, p.point_id, cache_.ui_value[i], cache_.ui_unit[i], cache_.ui_quality[i]);
        else if (p.io_type == "DI" && i >= 0 && i < KX_N_DI)
            append("DI", p.channel, p.point_id, static_cast<float>(cache_.di_state[i]), "",
                   cache_.iop_status == KX_IOP_NORMAL ? KX_Q_GOOD : KX_Q_BAD);
        else if (p.io_type == "AO" && i >= 0 && i < KX_N_AO)
            append("AO", p.channel, p.point_id, cache_.ao_setpoint[i], cache_.ao_mode[i] ? "mA" : "V",
                   cache_.iop_status == KX_IOP_NORMAL ? KX_Q_GOOD : KX_Q_BAD);
        else if (p.io_type == "DO" && i >= 0 && i < KX_N_DO)
            append("DO", p.channel, p.point_id, static_cast<float>(cache_.do_feedback[i]), "",
                   cache_.iop_status == KX_IOP_NORMAL ? KX_Q_GOOD : KX_Q_BAD);
    };
    if (!db_->entries().empty()) {
        for (const auto& p : db_->entries()) append_configured(p);
    } else {
        for (int i = 0; i < KX_N_UI; ++i) {
            char id[8]; std::snprintf(id, sizeof(id), "UI%d", i + 1);
            append("UI", i + 1, id, cache_.ui_value[i], cache_.ui_unit[i], cache_.ui_quality[i]);
        }
        for (int i = 0; i < KX_N_DI; ++i) {
            char id[8]; std::snprintf(id, sizeof(id), "DI%d", i + 1);
            append("DI", i + 1, id, static_cast<float>(cache_.di_state[i]), "",
                   cache_.iop_status == KX_IOP_NORMAL ? KX_Q_GOOD : KX_Q_BAD);
        }
        for (int i = 0; i < KX_N_AO; ++i) {
            char id[8]; std::snprintf(id, sizeof(id), "AO%d", i + 1);
            append("AO", i + 1, id, cache_.ao_setpoint[i], cache_.ao_mode[i] ? "mA" : "V",
                   cache_.iop_status == KX_IOP_NORMAL ? KX_Q_GOOD : KX_Q_BAD);
        }
        for (int i = 0; i < KX_N_DO; ++i) {
            char id[8]; std::snprintf(id, sizeof(id), "DO%d", i + 1);
            append("DO", i + 1, id, static_cast<float>(cache_.do_feedback[i]), "",
                   cache_.iop_status == KX_IOP_NORMAL ? KX_Q_GOOD : KX_Q_BAD);
        }
    }
    return out;
}

void ScreenIo::render()
{
    if (!locale_) return;
    lv_label_set_text(title_, locale_->str(StrKey::STR_IO_MONITOR));
    lv_label_set_text(header_, "POINT TY NAME     VALUE UNIT QUALITY AGE");
    const auto data = rows();
    if (data.empty()) offset_ = 0;
    else if (offset_ >= data.size()) offset_ = data.size() - 1;
    char age[20]; fmt_age(age, sizeof(age), cache_.age_ns);
    for (int i = 0; i < VISIBLE_ROWS; ++i) {
        const size_t idx = offset_ + static_cast<size_t>(i);
        if (idx >= data.size()) {
            lv_label_set_text(row_labels_[i], i == 0 ? locale_->str(StrKey::STR_NO_FAULT_POINTS) : "");
            continue;
        }
        const Row& r = data[idx];
        const char* quality = r.stale ? locale_->str(StrKey::STR_STALE)
            : (r.quality == KX_Q_GOOD ? locale_->str(StrKey::STR_GOOD)
               : r.quality == KX_Q_UNCERTAIN ? locale_->str(StrKey::STR_UNCERTAIN)
                                             : locale_->str(StrKey::STR_BAD));
        char value[16];
        if (r.stale || r.quality == KX_Q_BAD) std::snprintf(value, sizeof(value), "---");
        else std::snprintf(value, sizeof(value), "%.2f", static_cast<double>(r.value));
        lv_label_set_text_fmt(row_labels_[i], "%-5s %-2s %-8.8s %6s %-4.4s %-8s %s",
                              r.id.c_str(), r.type.c_str(), r.name.c_str(), value,
                              r.unit.c_str(), quality, age);
        lv_obj_set_style_text_color(row_labels_[i], r.stale ? lv_color_hex(0xFFCC33)
            : (r.quality == KX_Q_BAD ? lv_color_hex(0xFF5555) : lv_color_hex(0xEEEEEE)),
            LV_PART_MAIN);
    }
    const char* filter = filter_ == Filter::ALL ? locale_->str(StrKey::STR_FILTER_ALL)
                       : filter_ == Filter::BAD ? locale_->str(StrKey::STR_FILTER_BAD)
                                               : locale_->str(StrKey::STR_FILTER_STALE);
    lv_label_set_text_fmt(filter_label_, "Filter: %s", filter);
    const size_t page = data.empty() ? 0 : offset_ / VISIBLE_ROWS + 1;
    const size_t pages = data.empty() ? 0 : (data.size() + VISIBLE_ROWS - 1) / VISIBLE_ROWS;
    lv_label_set_text_fmt(page_label_, "Page %zu/%zu", page, pages);
}

void ScreenIo::cycle_filter()
{
    filter_ = filter_ == Filter::ALL ? Filter::BAD
            : filter_ == Filter::BAD ? Filter::STALE : Filter::ALL;
    offset_ = 0;
    render();
}

void ScreenIo::filter_cb(lv_event_t* e)
{
    static_cast<ScreenIo*>(lv_event_get_user_data(e))->cycle_filter();
}

void ScreenIo::on_key(uint32_t key, lv_indev_state_t state)
{
    if (state != LV_INDEV_STATE_PRESSED) return;
    if (key == LV_KEY_UP && offset_ > 0) --offset_;
    else if (key == LV_KEY_DOWN) {
        const auto data = rows();
        if (offset_ + 1 < data.size()) ++offset_;
    } else if (key == LV_KEY_ENTER) cycle_filter();
    render();
}

void ScreenIo::on_data_update(const DataCache& c, const PointDb& db, const Locale& l)
{
    cache_ = c; db_ = &db; locale_ = &l; render();
}

void ScreenIo::rebuild_labels(const Locale& l) { locale_ = &l; render(); }

} // namespace hmi
