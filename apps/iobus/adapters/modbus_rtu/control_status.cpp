/**
 * @file  control_status.cpp
 * @brief Op `status` của kênh điều khiển fieldbus — xem control_status.hpp.
 */
#include "modbus_rtu/control_status.hpp"

#include <cstdio>

#include "modbus_rtu/control_channel.hpp"

namespace iobus::fieldbus {

namespace {

using ull = unsigned long long;

std::string latency_json(const LatencyWindowStats& s)
{
    char buf[192];
    std::snprintf(buf, sizeof(buf),
                  "{\"p50_us\":%u,\"p95_us\":%u,\"max_us\":%u,\"sample_count\":%u,"
                  "\"window_size\":%u,\"total\":%llu}",
                  s.p50_us, s.p95_us, s.max_us, s.sample_count, s.window_size,
                  static_cast<ull>(s.total));
    return buf;
}

std::string bus_json(const BusMetrics& bus)
{
    /* Phần đầu giữ NGUYÊN thứ tự và định dạng của bản trong main.cpp trước
     * T63-003; trường mới nối sau. */
    char head[512];
    std::snprintf(head, sizeof(head),
                  "{\"id\":%u,\"name\":\"%s\",\"device\":\"%s\","
                  "\"state\":\"%s\",\"latency_p50_us\":%u,\"latency_p95_us\":%u,"
                  "\"utilization_pct_x100\":%u,\"timeout_errors\":%llu,"
                  "\"crc_errors\":%llu,\"port_reopens\":%llu,"
                  "\"total_transactions\":%llu,\"total_errors\":%llu",
                  bus.id,
                  json_escape(bus.name).c_str(),
                  json_escape(bus.device).c_str(),
                  json_escape(bus.state).c_str(),
                  bus.latency_p50_us, bus.latency_p95_us,
                  bus.utilization_pct_x100,
                  static_cast<ull>(bus.timeout_errors),
                  static_cast<ull>(bus.crc_errors),
                  static_cast<ull>(bus.port_reopens),
                  static_cast<ull>(bus.total_transactions),
                  static_cast<ull>(bus.total_errors));
    return std::string(head) + ",\"latency_read\":" + latency_json(bus.read_latency) +
           ",\"latency_write\":" + latency_json(bus.write_latency) + "}";
}

} // namespace

std::string control_status_fields(const ControlStatusIdentity& id,
                                  const FieldbusMetrics::BusSnapshot& buses,
                                  const IopCounterSnapshot& iop)
{
    char head[768];
    std::snprintf(head, sizeof(head),
                  "\"generation\":%llu,\"config_revision\":%llu,"
                  "\"producer_boot_id\":%llu,\"counters_since_ms\":%llu,"
                  "\"ext_count\":%u,\"sequence\":%llu,"
                  "\"bus_counters_epoch\":%llu,\"bus_counters_since_ms\":%llu,"
                  "\"iop\":{\"rx\":%llu,\"tx\":%llu,\"crc_errors\":%llu,\"seq_errors\":%llu,"
                  "\"timeouts\":%llu,\"retries\":%llu,\"nacks\":%llu}",
                  static_cast<ull>(id.generation),
                  static_cast<ull>(id.config_revision),
                  static_cast<ull>(id.producer_boot_id),
                  static_cast<ull>(id.counters_since_ms),
                  id.ext_count,
                  static_cast<ull>(id.sequence),
                  static_cast<ull>(buses.bus_counters_epoch),
                  static_cast<ull>(buses.bus_counters_since_ms),
                  static_cast<ull>(iop.rx), static_cast<ull>(iop.tx),
                  static_cast<ull>(iop.crc_errors), static_cast<ull>(iop.seq_errors),
                  static_cast<ull>(iop.timeouts), static_cast<ull>(iop.retries),
                  static_cast<ull>(iop.nacks));
    std::string out(head);
    out += ",\"buses\":[";
    for (std::size_t i = 0; i < buses.buses.size(); i++) {
        if (i != 0) out += ",";
        out += bus_json(buses.buses[i]);
    }
    out += "]";
    return out;
}

} // namespace iobus::fieldbus
