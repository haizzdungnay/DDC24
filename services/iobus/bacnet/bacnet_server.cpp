/**
 * @file  bacnet_server.cpp
 * @brief BAC-005 + BAC-010: BACnet/IP server.
 *        All bacnet-stack API calls guarded by #ifdef MKDDC_ENABLE_BACNET.
 */
#include "bacnet_server.hpp"
#include "mkddc_shm.h"

#include <cstdio>
#include <cstring>
#include <ctime>

#ifdef MKDDC_ENABLE_BACNET
#include <bacnet/bacdef.h>
#include <bacnet/bacenum.h>
#include <bacnet/bacdcode.h>
#include <bacnet/apdu.h>
#include <bacnet/npdu.h>
#include <bacnet/iam.h>
#include <bacnet/whois.h>
#include <bacnet/rp.h>
#include <bacnet/wp.h>
#include <bacnet/rpm.h>
#include <bacnet/basic/tsm/tsm.h>
#include <bacnet/basic/services.h>
#include <bacnet/dcc.h>
#include <bacnet/getevent.h>
#include <bacnet/basic/object/device.h>
#include <bacnet/datalink/bip.h>
#include <bacnet/datalink/datalink.h>
#include <bacnet/timesync.h>
#include <bacnet/basic/object/ai.h>
#include <bacnet/basic/object/ao.h>
#include <bacnet/basic/object/av.h>
#include <bacnet/basic/object/bi.h>
#include <bacnet/basic/object/bo.h>
#include <bacnet/basic/object/bv.h>
#include <bacnet/basic/object/msv.h>
#endif

namespace iobus::bacnet {
#ifdef MKDDC_ENABLE_BACNET
static BacnetServer* g_active_server = nullptr;

static void ao_write_callback(uint32_t instance, float, float value)
{
    if (g_active_server) {
        const bool released = Analog_Output_Present_Value_Priority(instance) == 0;
        g_active_server->handle_output_write(true, instance, value, released);
    }
}

static void bo_write_callback(uint32_t instance, BACNET_BINARY_PV,
                              BACNET_BINARY_PV value)
{
    if (g_active_server) {
        const bool released = Binary_Output_Present_Value_Priority(instance) == 0;
        g_active_server->handle_output_write(false, instance,
                                             value == BINARY_ACTIVE ? 1.0f : 0.0f,
                                             released);
    }
}
#endif

BacnetServer::BacnetServer() = default;
BacnetServer::~BacnetServer() { stop(); }

bool BacnetServer::init(const BacnetConfig& cfg,
                         BacnetObjects* objects,
                         const CoreWriteFn& core_fn,
                         const ReinitFn& reinit_fn,
                         const std::string& reinit_password)
{
    cfg_             = cfg;
    objects_         = objects;
    core_fn_         = core_fn;
    reinit_fn_       = reinit_fn;
    reinit_password_ = reinit_password;
    return true;
}

bool BacnetServer::check_reinit_password(const std::string& provided) const
{
    if (reinit_password_.empty()) return true;
    return provided == reinit_password_;
}

bool BacnetServer::start()
{
    if (running_) return true;

#ifdef MKDDC_ENABLE_BACNET
    Device_Init(nullptr);
    Device_Set_Object_Instance_Number(cfg_.device.device_id);
    Device_Object_Name_ANSI_Init(cfg_.device.device_name.c_str());
    Device_Set_Description(cfg_.device.description.c_str(), cfg_.device.description.size());
    Device_Set_Location(cfg_.device.location.c_str(), cfg_.device.location.size());
    Device_Set_Vendor_Identifier(9999);  /* placeholder until assigned by ASHRAE */
    Device_Set_Model_Name("MK-DDC-24", std::strlen("MK-DDC-24"));
    Device_Set_Application_Software_Version("1.0.0", std::strlen("1.0.0"));

    /* Port must be configured before bip_init(), which opens the UDP socket. */
    bip_set_port(cfg_.bip.udp_port);
    char* iface = cfg_.bip.bind_interface.empty()
        ? nullptr : const_cast<char*>(cfg_.bip.bind_interface.c_str());
    if (!bip_init(iface)) {
        std::fprintf(stderr, "ERROR bacnet_server.bip_init_failed iface=%s port=%u\n",
                     iface ? iface : "default", cfg_.bip.udp_port);
        return false;
    }

    register_objects();
    g_active_server = this;
    Analog_Output_Write_Present_Value_Callback_Set(ao_write_callback);
    Binary_Output_Write_Present_Value_Callback_Set(bo_write_callback);
    apdu_set_unrecognized_service_handler_handler(handler_unrecognized_service);
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_READ_PROPERTY,
                               handler_read_property);
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_READ_PROP_MULTIPLE,
                               handler_read_property_multiple);
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_WRITE_PROPERTY,
                               handler_write_property);
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_REINITIALIZE_DEVICE,
                               handler_reinitialize_device);
    /* Reply to the requester address. This also makes directed Who-Is work when
     * the client uses a non-default source port (BACnet Addendum 135-2004q). */
    apdu_set_unconfirmed_handler(SERVICE_UNCONFIRMED_WHO_IS, handler_who_is_unicast);

    Send_I_Am(&Handler_Transmit_Buffer[0]);
    std::fprintf(stderr,
                 "INFO  bacnet_server.started bound UDP/%u on %s device_id=%u\n",
                 cfg_.bip.udp_port, iface ? iface : "default", cfg_.device.device_id);
#else
    std::fprintf(stderr, "INFO  bacnet_server.start (MKDDC_ENABLE_BACNET=OFF, no-op)\n");
    return false;
#endif
    running_ = true;
    return true;
}

void BacnetServer::handle_output_write(bool analog, uint32_t instance, float value,
                                       bool released)
{
    if (!core_fn_ || instance == 0) return;
    const std::string op = released
        ? (analog ? "release_ao" : "release_bo")
        : (analog ? "ao_setpoint" : "do_cmd");
    const bool accepted = core_fn_(op, instance - 1, value, "bacnet:udp", 3);
    std::fprintf(stderr,
                 "AUDIT bacnet_cmd object=%s%u op=%s value=%g result=%s\n",
                 analog ? "AO" : "BO", instance, released ? "release" : "write",
                 static_cast<double>(value), accepted ? "accepted" : "overridden");
}

void BacnetServer::apply_ai_units()
{
#ifdef MKDDC_ENABLE_BACNET
    if (!objects_) return;
    auto unit_code = [](const char* s) -> BACNET_ENGINEERING_UNITS {
        if (!s || s[0] == '\0')          return UNITS_NO_UNITS;
        if (std::strcmp(s, "V") == 0)    return UNITS_VOLTS;
        if (std::strcmp(s, "mA") == 0)   return UNITS_MILLIAMPERES;
        if (std::strcmp(s, "degC") == 0) return UNITS_DEGREES_CELSIUS;
        if (std::strcmp(s, "%") == 0)    return UNITS_PERCENT;
        return UNITS_NO_UNITS;
    };
    for (int i = 0; i < KX_N_UI; i++) {
        Analog_Input_Units_Set(static_cast<uint32_t>(i + 1),
                               unit_code(objects_->ai_unit(static_cast<uint32_t>(i + 1)).c_str()));
    }
#endif
}

void BacnetServer::apply_ao_config()
{
#ifdef MKDDC_ENABLE_BACNET
    if (!objects_) return;
    for (uint32_t i = 1; i <= 4; i++) {
        auto& name_buf = ao_name_storage_[i - 1];
        std::strncpy(name_buf.data(), objects_->ao_name(i).c_str(), name_buf.size() - 1);
        name_buf.back() = '\0';
        Analog_Output_Name_Set(i, name_buf.data());
        Analog_Output_Units_Set(i, objects_->ao_bacnet_units(i));
        Analog_Output_Min_Pres_Value_Set(i, objects_->ao_min_pv(i));
        Analog_Output_Max_Pres_Value_Set(i, objects_->ao_max_pv(i));
    }
#endif
}

void BacnetServer::register_objects()
{
#ifdef MKDDC_ENABLE_BACNET
    /* BAC-003: AI×16 (ADR-010: KX_N_UI=16), BI×8, AO×4, BO×4, AV×32, BV×16, MSV×8 */
    for (int i = 0; i < KX_N_UI; i++) Analog_Input_Create(i + 1);
    for (int i = 0; i < 8;  i++) Binary_Input_Create(i + 1);
    for (int i = 0; i < 4;  i++) Analog_Output_Create(i + 1);
    for (int i = 0; i < 4;  i++) Binary_Output_Create(i + 1);
    for (int i = 0; i < 32; i++) Analog_Value_Create(i + 1);
    for (int i = 0; i < 16; i++) Binary_Value_Create(i + 1);
    for (int i = 0; i < 8;  i++) Multistate_Value_Create(i + 1);
#endif
}

void BacnetServer::sync_stack_inputs(const kx_plc_shm_t* shm)
{
#ifdef MKDDC_ENABLE_BACNET
    if (!objects_ || !shm) return;
    for (uint32_t instance = 1; instance <= KX_N_UI; ++instance) {
        float value = 0.0f;
        uint8_t status_flags = 0;
        uint8_t reliability = 0;
        if (objects_->read_ai(instance, &value, &status_flags, &reliability, shm)) {
            Analog_Input_Present_Value_Set(instance, value);
            Analog_Input_Reliability_Set(
                instance, static_cast<BACNET_RELIABILITY>(reliability));
            Analog_Input_Out_Of_Service_Set(instance,
                                             objects_->oos_ai(instance));
        }
        if (objects_->read_bi(instance, &value, &status_flags, &reliability, shm)) {
            Binary_Input_Present_Value_Set(
                instance, value != 0.0f ? BINARY_ACTIVE : BINARY_INACTIVE);
            Binary_Input_Reliability_Set(
                instance, static_cast<BACNET_RELIABILITY>(reliability));
            Binary_Input_Out_Of_Service_Set(instance,
                                             objects_->oos_bi(instance));
        }
    }
#else
    (void)shm;
#endif
}

void BacnetServer::tick(uint64_t now_ms, const kx_plc_shm_t* shm)
{
    if (!running_) return;
    sync_stack_inputs(shm);
    process_bacnet_packet(now_ms, shm);
    dispatch_cov(now_ms, shm);
    alarm_.drain(now_ms);
}

void BacnetServer::process_bacnet_packet(uint64_t now_ms, const kx_plc_shm_t* shm)
{
    (void)now_ms; (void)shm;
#ifdef MKDDC_ENABLE_BACNET
    BACNET_ADDRESS src{};
    uint8_t pdu[MAX_MPDU];
    const uint16_t pdu_len = datalink_receive(&src, pdu, sizeof(pdu), 5 /* ms timeout */);
    if (pdu_len > 0)
        npdu_handler(&src, pdu, pdu_len);
    tsm_timer_milliseconds(5);
    dcc_timer_seconds(1);
#endif
}

void BacnetServer::dispatch_cov(uint64_t now_ms, const kx_plc_shm_t* shm)
{
    (void)now_ms;
    if (!objects_ || !shm) return;

    auto check = [&](BacnetObjectType obj_type, uint32_t instance, float value, uint8_t sf) {
        auto subs = objects_->cov().check_and_update(obj_type, instance, value, sf);
#ifdef MKDDC_ENABLE_BACNET
        for (const auto* sub : subs) {
            (void)sub;
            /* bacnet-stack: Send_COV_Subscribe_Unconfirmed or confirmed COV notification */
            std::fprintf(stderr, "INFO  bacnet_cov.notify obj_type=%u inst=%u val=%.3f sf=%02x\n",
                         static_cast<uint16_t>(obj_type), instance, value, sf);
        }
#else
        for (const auto* sub : subs)
            (void)sub;
#endif
    };

    /* Scan AI/BI */
    for (uint32_t i = 1; i <= 8; i++) {
        float v; uint8_t sf, rel;
        if (objects_->read_ai(i, &v, &sf, &rel, shm))
            check(BacnetObjectType::ANALOG_INPUT, i, v, sf);
        if (objects_->read_bi(i, &v, &sf, &rel, shm))
            check(BacnetObjectType::BINARY_INPUT, i, v, sf);
    }
    /* AO/BO */
    for (uint32_t i = 1; i <= 4; i++) {
        float v; uint8_t sf, rel;
        if (objects_->read_ao(i, &v, &sf, &rel, shm))
            check(BacnetObjectType::ANALOG_OUTPUT, i, v, sf);
        if (objects_->read_bo(i, &v, &sf, &rel, shm))
            check(BacnetObjectType::BINARY_OUTPUT, i, v, sf);
    }
    /* AV/BV/MSV */
    for (uint32_t i = 1; i <= 32; i++) {
        float v; uint8_t sf;
        if (objects_->read_av(i, &v, &sf, shm))
            check(BacnetObjectType::ANALOG_VALUE, i, v, sf);
    }
    for (uint32_t i = 1; i <= 16; i++) {
        float v; uint8_t sf;
        if (objects_->read_bv(i, &v, &sf, shm))
            check(BacnetObjectType::BINARY_VALUE, i, v, sf);
    }
    for (uint32_t i = 1; i <= 8; i++) {
        float v; uint8_t sf;
        if (objects_->read_msv(i, &v, &sf, shm))
            check(BacnetObjectType::MULTI_STATE_VALUE, i, v, sf);
    }
}

void BacnetServer::send_time_sync(uint64_t now_ms)
{
    if (!running_) return;
    if (now_ms - last_timesync_ms_ < 60000) return;
    last_timesync_ms_ = now_ms;

#ifdef MKDDC_ENABLE_BACNET
    Send_TimeSync_Device();
    std::fprintf(stderr, "INFO  bacnet_server.timesync_sent\n");
#endif
}

void BacnetServer::stop()
{
    if (!running_) return;
#ifdef MKDDC_ENABLE_BACNET
    Analog_Output_Write_Present_Value_Callback_Set(nullptr);
    Binary_Output_Write_Present_Value_Callback_Set(nullptr);
    if (g_active_server == this) g_active_server = nullptr;
    datalink_cleanup();
#endif
    alarm_.close();
    running_ = false;
    std::fprintf(stderr, "INFO  bacnet_server.stopped\n");
}

} // namespace iobus::bacnet
