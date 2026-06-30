#include "screens/screen_comm.hpp"

namespace hmi {

static lv_obj_t* comm_label(lv_obj_t* root, int y, int h)
{
    lv_obj_t* label = lv_label_create(root);
    lv_obj_set_pos(label, 4, y); lv_obj_set_size(label, 312, h);
    lv_obj_set_style_text_font(label, hmi_font(), LV_PART_MAIN);
    lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
    return label;
}

void ScreenComm::build(lv_obj_t* root, const Locale& l, const PointDb&)
{
    root_ = root; locale_ = &l;
    title_ = comm_label(root, 0, 20);
    ethernet_ = comm_label(root, 23, 58);
    bacnet_ = comm_label(root, 84, 52);
    modbus_ = comm_label(root, 139, 60);
    render();
}

void ScreenComm::render()
{
    if (!locale_) return;
    lv_label_set_text(title_, locale_->str(StrKey::STR_COMMUNICATION_PAGE));
    lv_label_set_text_fmt(ethernet_, "%s\nLink:%s  IP:%s\nMask:%s  GW:%s  MAC:%s",
                          locale_->str(StrKey::STR_ETHERNET), sys_.eth_link ? "UP" : "DOWN",
                          sys_.eth_ip, sys_.eth_mask, sys_.eth_gw, sys_.eth_mac);
    lv_label_set_text_fmt(bacnet_, "BACnet/IP\nStatus:%s  Last Request:%us ago",
                          sys_.bacnet_status, sys_.bacnet_last_req_s);
    lv_label_set_text_fmt(modbus_, "Modbus RTU-1: %s\nModbus RTU-2: %s\nModbus TCP: %s",
                          sys_.modbus_rtu1_status, sys_.modbus_rtu2_status,
                          sys_.modbus_tcp_status);
}

void ScreenComm::on_data_update(const DataCache&, const PointDb&, const Locale& l)
{ locale_ = &l; render(); }
void ScreenComm::on_sys_update(const SysSnapshot& s, const Locale& l)
{ sys_ = s; locale_ = &l; render(); }
void ScreenComm::rebuild_labels(const Locale& l) { locale_ = &l; render(); }

} // namespace hmi
