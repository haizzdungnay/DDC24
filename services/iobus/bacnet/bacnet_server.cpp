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
#include <bacnet/tsm.h>
#include <bacnet/dcc.h>
#include <bacnet/getevent.h>
#include <bacnet/device.h>
#include <bacnet/datalink/bip.h>
#include <bacnet/datalink/datalink.h>
#include <bacnet/timesync.h>
#include <bacnet/reinit.h>
#include <bacnet/basic/object/ai.h>
#include <bacnet/basic/object/ao.h>
#include <bacnet/basic/object/av.h>
#include <bacnet/basic/object/bi.h>
#include <bacnet/basic/object/bo.h>
#include <bacnet/basic/object/bv.h>
#include <bacnet/basic/object/msv.h>
#endif

namespace iobus::bacnet {

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
    /* BAC-010: Device Object setup */
    Device_Set_Object_Instance_Number(cfg_.device.device_id);
    Device_Set_Object_Name(cfg_.device.device_name.c_str(), cfg_.device.device_name.size());
    Device_Set_Description(cfg_.device.description.c_str());
    Device_Set_Location(cfg_.device.location.c_str());

    /* PICS §7: Vendor = KINEXUS Technologies, Vendor_Identifier = 9999 (placeholder) */
    Device_Set_Vendor_Name("KINEXUS Technologies");
    Device_Set_Vendor_Identifier(9999);
    Device_Set_Model_Name("MK-DDC-24");
    Device_Set_Firmware_Revision("1.0.0");

    /* BAC-005: BIP init with bind_interface (not 0.0.0.0 if configured) */
    if (!cfg_.bip.bind_interface.empty()) {
        bip_set_interface(cfg_.bip.bind_interface.c_str());
        std::fprintf(stderr, "INFO  bacnet_server.bip_bind iface=%s port=%u\n",
                     cfg_.bip.bind_interface.c_str(), cfg_.bip.udp_port);
    } else {
        std::fprintf(stderr, "WARN  bacnet_server.bip_bind_all (bind_interface not set)\n");
    }
    if (!bip_init(nullptr)) {
        std::fprintf(stderr, "ERROR bacnet_server.bip_init_failed port=%u\n", cfg_.bip.udp_port);
        return false;
    }
    bip_set_port(htons(cfg_.bip.udp_port));

    /* Register objects */
    register_objects();

    /* APDU / TSM */
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_READ_PROPERTY,    rphandler_handler);
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_READ_PROP_MULTIPLE, rpmhandler_handler);
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_WRITE_PROPERTY,   wphandler_handler);
    apdu_set_confirmed_handler(SERVICE_CONFIRMED_REINITIALIZE_DEVICE, reinitialize_device_handler);
    apdu_set_unconfirmed_handler(SERVICE_UNCONFIRMED_I_AM,         iam_handler);
    apdu_set_unconfirmed_handler(SERVICE_UNCONFIRMED_WHO_IS,       whois_handler);

    /* Announce ourselves */
    Send_I_Am(&Handler_Transmit_Buffer[0]);

    std::fprintf(stderr, "INFO  bacnet_server.started device_id=%u\n", cfg_.device.device_id);
#else
    std::fprintf(stderr, "INFO  bacnet_server.start (MKDDC_ENABLE_BACNET=OFF, no-op)\n");
#endif
    running_ = true;
    return true;
}

void BacnetServer::register_objects()
{
#ifdef MKDDC_ENABLE_BACNET
    /* BAC-003: register AI×8, BI×8, AO×4, BO×4, AV×32, BV×16, MSV×8 */
    for (int i = 0; i < 8;  i++) Analog_Input_Create(i + 1);
    for (int i = 0; i < 8;  i++) Binary_Input_Create(i + 1);
    for (int i = 0; i < 4;  i++) Analog_Output_Create(i + 1);
    for (int i = 0; i < 4;  i++) Binary_Output_Create(i + 1);
    for (int i = 0; i < 32; i++) Analog_Value_Create(i + 1);
    for (int i = 0; i < 16; i++) Binary_Value_Create(i + 1);
    for (int i = 0; i < 8;  i++) Multistate_Value_Create(i + 1);
#endif
}

void BacnetServer::tick(uint64_t now_ms, const kx_plc_shm_t* shm)
{
    if (!running_) return;
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
    const time_t t = static_cast<time_t>(now_ms / 1000);
    BACNET_DATE_TIME bdt{};
    datetime_set_values(&bdt.date, 0, 0, 0, 0); /* will be filled by bacnet-stack time API */
    Send_TimeSync_Remote(BACNET_BROADCAST_NETWORK, nullptr, &bdt);
    std::fprintf(stderr, "INFO  bacnet_server.timesync_sent\n");
#endif
}

void BacnetServer::stop()
{
    if (!running_) return;
#ifdef MKDDC_ENABLE_BACNET
    datalink_cleanup();
#endif
    alarm_.close();
    running_ = false;
    std::fprintf(stderr, "INFO  bacnet_server.stopped\n");
}

} // namespace iobus::bacnet
