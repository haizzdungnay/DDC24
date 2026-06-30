#include "screens/screen_home.hpp"

#include <cstdio>

namespace hmi {

static lv_obj_t* home_label(lv_obj_t* root, int y, int h)
{
    lv_obj_t* label = lv_label_create(root);
    lv_obj_set_pos(label, 3, y);
    lv_obj_set_size(label, 312, h);
    lv_obj_set_style_text_font(label, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
    return label;
}

void ScreenHome::build(lv_obj_t* root, const Locale& l, const PointDb& db)
{
    root_ = root;
    locale_ = &l;
    db_ = &db;
    title_  = home_label(root, 0, 20);
    alarm_  = home_label(root, 21, 28);
    health_ = home_label(root, 50, 34);
    io_     = home_label(root, 85, 48);
    comm_   = home_label(root, 134, 34);
    config_ = home_label(root, 169, 28);
    lv_obj_set_style_text_color(title_, lv_color_hex(0xFFFFFF), LV_PART_MAIN);
    lv_obj_set_style_text_color(alarm_, lv_color_hex(0xFFCC33), LV_PART_MAIN);
    rebuild_labels(l);
}

void ScreenHome::render_data()
{
    if (!db_ || !locale_) return;
    const int active = alarms_ ? alarms_->active_count() : 0;
    const int unacked = alarms_ ? alarms_->unacked_count() : 0;
    const int critical = alarms_ ? alarms_->critical_count() : 0;
    lv_label_set_text_fmt(alarm_, "%s  %s:%d  %s:%d  %s:%d",
                          locale_->str(StrKey::STR_ALARM_HEADER),
                          locale_->str(StrKey::STR_ACTIVE), active,
                          locale_->str(StrKey::STR_UNACKED), unacked,
                          locale_->str(StrKey::STR_CRITICAL), critical);

    const bool stale = last_data_.age_ns == UINT64_MAX ||
        last_data_.age_ns > static_cast<uint64_t>(db_->meta().stale_threshold_s) * 1000000000ull;
    auto total_for = [&](const char* type, int fallback) {
        const size_t configured = db_->count_by_type(type);
        return configured == 0 ? fallback : static_cast<int>(configured);
    };
    const int ui_total = total_for("UI", KX_N_UI);
    const int di_total = total_for("DI", KX_N_DI);
    const int ao_total = total_for("AO", KX_N_AO);
    const int do_total = total_for("DO", KX_N_DO);
    int ui_bad = 0;
    if (!stale && last_data_.iop_status == KX_IOP_NORMAL) {
        if (db_->count_by_type("UI") == 0) {
            for (int i = 0; i < KX_N_UI; ++i)
                if (last_data_.ui_quality[i] == KX_Q_BAD) ++ui_bad;
        } else {
            for (const auto& point : db_->entries()) {
                if (point.io_type == "UI" &&
                    last_data_.ui_quality[point.channel - 1] == KX_Q_BAD) ++ui_bad;
            }
        }
    }
    const bool global_bad = last_data_.iop_status != KX_IOP_NORMAL;
    auto ok = [&](int total, int bad) { return stale || global_bad ? 0 : total - bad; };
    auto bad = [&](int total, int point_bad) { return global_bad ? total : point_bad; };
    auto stale_count = [&](int total) { return stale && !global_bad ? total : 0; };
    lv_label_set_text_fmt(io_, "%s\nUI:%d/%d/%d  DI:%d/%d/%d  (OK/BAD/STALE)\nAO:%d/%d/%d  DO:%d/%d/%d",
                          locale_->str(StrKey::STR_IO_HEALTH),
                          ok(ui_total, ui_bad), bad(ui_total, ui_bad), stale_count(ui_total),
                          ok(di_total, 0), bad(di_total, 0), stale_count(di_total),
                          ok(ao_total, 0), bad(ao_total, 0), stale_count(ao_total),
                          ok(do_total, 0), bad(do_total, 0), stale_count(do_total));

    const char* run = last_data_.iop_status == KX_IOP_NORMAL
                    ? locale_->str(StrKey::STR_RUNNING)
                    : (last_data_.iop_status == KX_IOP_SAFE
                       ? locale_->str(StrKey::STR_SAFE) : locale_->str(StrKey::STR_FAULT));
    const char* id = db_->meta().project_id.empty() ? "MK-DDC-24" : db_->meta().project_id.c_str();
    lv_label_set_text_fmt(title_, "%s                                  %s", id, run);
    lv_obj_set_style_text_color(title_, last_data_.iop_status == KX_IOP_NORMAL
        ? lv_color_hex(0x66DD88) : lv_color_hex(0xFF5555), LV_PART_MAIN);

    lv_label_set_text_fmt(config_, "%s  %s:%s  %s:%d  %s:%.12s",
                          locale_->str(StrKey::STR_CONFIG),
                          locale_->str(StrKey::STR_PROFILE), db_->meta().profile.c_str(),
                          locale_->str(StrKey::STR_CONFIG_REV), db_->meta().revision,
                          locale_->str(StrKey::STR_CHECKSUM),
                          db_->meta().checksum.empty() ? "N/A" : db_->meta().checksum.c_str());
}

void ScreenHome::render_sys()
{
    if (!locale_) return;
    char uptime[32];
    fmt_uptime(uptime, sizeof(uptime), last_sys_.uptime_s);
    lv_label_set_text_fmt(health_, "%s\nCPU:%.0f%%  RAM:%u/%uMB  Disk:%u/%uGB  Temp:%.1fC  Up:%s",
                          locale_->str(StrKey::STR_CONTROLLER_HEALTH),
                          static_cast<double>(last_sys_.cpu_pct), last_sys_.ram_used_mb,
                          last_sys_.ram_total_mb, last_sys_.storage_used_gb,
                          last_sys_.storage_total_gb,
                          static_cast<double>(last_sys_.cpu_temp_c10) / 10.0, uptime);
    lv_label_set_text_fmt(comm_, "%s\nETH:%s IP:%s  BACnet:%s (Last req:%us)  Modbus:%s",
                          locale_->str(StrKey::STR_COMMUNICATION),
                          last_sys_.eth_link ? "OK" : "LINK_DOWN", last_sys_.eth_ip,
                          last_sys_.bacnet_status, last_sys_.bacnet_last_req_s,
                          last_sys_.modbus_rtu1_status);
}

void ScreenHome::on_data_update(const DataCache& c, const PointDb& db, const Locale& l)
{
    last_data_ = c; db_ = &db; locale_ = &l; render_data();
}

void ScreenHome::on_sys_update(const SysSnapshot& s, const Locale& l)
{
    last_sys_ = s; locale_ = &l; render_sys();
}

void ScreenHome::rebuild_labels(const Locale& l)
{
    locale_ = &l; render_data(); render_sys();
}

} // namespace hmi
