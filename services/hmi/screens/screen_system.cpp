#include "screens/screen_system.hpp"

namespace hmi {

static lv_obj_t* sys_label(lv_obj_t* root, int y, int h)
{
    lv_obj_t* label = lv_label_create(root);
    lv_obj_set_pos(label, 4, y); lv_obj_set_size(label, 312, h);
    lv_obj_set_style_text_font(label, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
    return label;
}

void ScreenSystem::build(lv_obj_t* root, const Locale& l, const PointDb& db)
{
    root_ = root; locale_ = &l; db_ = &db;
    title_ = sys_label(root, 0, 19);
    firmware_ = sys_label(root, 20, 34);
    runtime_ = sys_label(root, 55, 34);
    resource_ = sys_label(root, 90, 34);
    process_ = sys_label(root, 125, 38);
    watchdog_ = sys_label(root, 164, 35);
    render();
}

void ScreenSystem::render()
{
    if (!locale_ || !db_) return;
    char uptime[32]; fmt_uptime(uptime, sizeof(uptime), sys_.uptime_s);
    lv_label_set_text(title_, locale_->str(StrKey::STR_SYSTEM_DIAG));
    lv_label_set_text_fmt(firmware_, "FIRMWARE\nSOM:%s  MCU:%s  Config Rev:%d",
                          sys_.fw_version, sys_.mcu_fw_version, db_->meta().revision);
    lv_label_set_text_fmt(runtime_, "RUNTIME\nUptime:%s  Boot:%s  Last Error:%s",
                          uptime, sys_.boot_reason, sys_.last_error);
    lv_label_set_text_fmt(resource_, "RESOURCE\nCPU:%.0f%% RAM:%u/%uMB Disk:%u/%uGB Temp:%.1fC",
                          static_cast<double>(sys_.cpu_pct), sys_.ram_used_mb, sys_.ram_total_mb,
                          sys_.storage_used_gb, sys_.storage_total_gb,
                          static_cast<double>(sys_.cpu_temp_c10) / 10.0);
    lv_label_set_text_fmt(process_, "PROCESS\ncore:%s iobus:%s hmi:RUNNING bacnet:%s modbus:%s",
                          sys_.core_running ? "RUNNING" : "STOPPED",
                          sys_.iobus_running ? "RUNNING" : "STOPPED",
                          sys_.bacnet_running ? "RUNNING" : "STOPPED",
                          sys_.modbus_running ? "RUNNING" : "STOPPED");
    lv_label_set_text_fmt(watchdog_, "WATCHDOG:%s Last Reset:%s\nLOG Warn:%s Fault:%s",
                          sys_.watchdog_status, sys_.watchdog_last_reset,
                          sys_.last_warn, sys_.last_fault);
}

void ScreenSystem::on_data_update(const DataCache& c, const PointDb& db, const Locale& l)
{ data_ = c; db_ = &db; locale_ = &l; render(); }
void ScreenSystem::on_sys_update(const SysSnapshot& s, const Locale& l)
{ sys_ = s; locale_ = &l; render(); }
void ScreenSystem::rebuild_labels(const Locale& l) { locale_ = &l; render(); }

} // namespace hmi
