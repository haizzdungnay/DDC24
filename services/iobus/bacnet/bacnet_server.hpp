/**
 * @file  bacnet_server.hpp
 * @brief BAC-005 + BAC-010: BACnet/IP server — bip_init, object registration,
 *        ReadProperty/WriteProperty dispatch, TimeSync (master),
 *        ReinitializeDevice (warm/cold with password).
 *        Network I/O requires MKDDC_ENABLE_BACNET.
 */
#ifndef IOBUS_BACNET_SERVER_HPP
#define IOBUS_BACNET_SERVER_HPP

#include <cstdint>
#include <array>
#include <string>
#include <functional>
#include "bacnet_config.hpp"
#include "bacnet_objects.hpp"
#include "bacnet_alarm.hpp"

namespace iobus::bacnet {

/** Callback to open UNIX socket connection to core and send write command.
 *  Parameters: op, point_idx (0-based), value, user, prio (3=PRIO_BACNET).
 *  Returns true if accepted (not overridden). */
using CoreWriteFn = std::function<bool(const std::string& op,
                                        uint32_t point_idx,
                                        float value,
                                        const std::string& user,
                                        int prio)>;

/** Callback for warm/cold restart on ReinitializeDevice. */
using ReinitFn = std::function<void(bool cold)>;

/**
 * BAC-010: BACnet server lifecycle manager.
 *
 * Usage:
 *   BacnetServer srv;
 *   srv.init(cfg, objects, core_fn, reinit_fn);
 *   srv.start();
 *   while (!done) srv.tick(now_ms, shm);
 *   srv.stop();
 */
class BacnetServer {
public:
    BacnetServer();
    ~BacnetServer();

    /**
     * Init: configure (does not open socket yet).
     * reinit_password: for ReinitializeDevice (BAC-010). Empty = no password.
     */
    bool init(const BacnetConfig& cfg,
              BacnetObjects* objects,
              const CoreWriteFn& core_fn,
              const ReinitFn& reinit_fn,
              const std::string& reinit_password = "");

    /**
     * BAC-005: Start BACnet/IP stack.
     * bip_init with bind_interface from config (not 0.0.0.0 if field set).
     * Registers all objects (AI×8, BI×8, AO×4, BO×4, AV×32, BV×16, MSV×8, Device).
     */
    bool start();

    /**
     * Tick: process one round of incoming BACnet packets + COV dispatch.
     * shm: current plc_shm snapshot (for ReadProperty values).
     */
    void tick(uint64_t now_ms, const kx_plc_shm_t* shm);

    /**
     * BAC-010: TimeSync master — send TimeSynchronization to all devices.
     * Call periodically (e.g. every 60s).
     */
    void send_time_sync(uint64_t now_ms);

    /** Push unit codes from objects->ai_unit() into bacnet-stack AI objects.
     *  Call once after start() and after each SIGHUP config reload. */
    void apply_ai_units();

    /** ADR-012: push AO metadata (Name/Units/Min/Max_Pres_Value) from objects into bacnet-stack.
     *  Call once after start() and after each SIGHUP config reload. */
    void apply_ao_config();

    /* Called by bacnet-stack AO/BO callbacks after Priority_Array changes. */
    void handle_output_write(bool analog, uint32_t instance, float value,
                             bool released);

    void stop();
    bool is_running() const { return running_; }

    /** Access alarm dispatcher (BAC-009). */
    BacnetAlarm& alarm() { return alarm_; }

private:
    BacnetConfig   cfg_;
    BacnetObjects* objects_    = nullptr;
    CoreWriteFn    core_fn_;
    ReinitFn       reinit_fn_;
    std::string    reinit_password_;
    BacnetAlarm    alarm_;
    bool           running_    = false;
    uint64_t       last_timesync_ms_ = 0;
    std::array<std::array<char, 65>, 4> ao_name_storage_{};

    void register_objects();
    void sync_stack_inputs(const kx_plc_shm_t* shm);
    void process_bacnet_packet(uint64_t now_ms, const kx_plc_shm_t* shm);
    void dispatch_cov(uint64_t now_ms, const kx_plc_shm_t* shm);

    bool check_reinit_password(const std::string& provided) const;
};

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_SERVER_HPP */
