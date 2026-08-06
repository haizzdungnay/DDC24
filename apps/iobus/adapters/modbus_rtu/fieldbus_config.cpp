/**
 * @file  fieldbus_config.cpp
 * @brief MOD-002: load fieldbus.conf (JSON minimal parser).
 */
#include "fieldbus_config.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <sstream>

namespace iobus::fieldbus {

/* ---- minimal JSON helpers (flat key-value, no nesting recursion needed) ---- */

static bool jget_str(const std::string& s, const char* key, std::string* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n' || s[p] == '\r')) ++p;
    if (p >= s.size() || s[p] != '"') return false;
    const size_t e = s.find('"', p + 1);
    if (e == std::string::npos) return false;
    *out = s.substr(p + 1, e - p - 1);
    return true;
}

static bool jget_int(const std::string& s, const char* key, long* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t')) ++p;
    char* ep = nullptr;
    const long v = std::strtol(s.c_str() + p, &ep, 10);
    if (ep == s.c_str() + p) return false;
    *out = v;
    return true;
}

/* Trích nội dung object/array theo key bằng cách đếm braces */
static bool jget_obj(const std::string& s, const char* key, std::string* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n')) ++p;
    if (p >= s.size()) return false;
    const char open  = s[p];
    const char close = (open == '{') ? '}' : ((open == '[') ? ']' : '\0');
    if (!close) return false;
    int depth = 0;
    const size_t start = p;
    for (; p < s.size(); ++p) {
        if (s[p] == open) ++depth;
        else if (s[p] == close) { if (--depth == 0) { *out = s.substr(start, p - start + 1); return true; } }
        else if (s[p] == '"') { while (++p < s.size() && s[p] != '"') { if (s[p] == '\\') ++p; } }
    }
    return false;
}

/* Parse TCP slave object từ một phần tử mảng tcp_slaves[] */
static bool parse_tcp_slave(const std::string& obj, uint32_t default_poll_ms, TcpSlaveConfig* ts)
{
    if (!jget_str(obj, "host", &ts->host) || ts->host.empty())
        return false;   /* host bắt buộc */
    if (!jget_str(obj, "profile", &ts->profile) || ts->profile.empty())
        return false;   /* profile bắt buộc */
    if (!jget_str(obj, "name", &ts->name) || ts->name.empty())
        return false;   /* name bắt buộc */
    long v = 0;
    if (jget_int(obj, "port", &v) && v > 0 && v <= 65535)
        ts->port = static_cast<uint16_t>(v);
    if (jget_int(obj, "unit", &v) && v >= 0 && v <= 247)
        ts->unit = static_cast<uint8_t>(v);
    ts->poll_ms = default_poll_ms;
    if (jget_int(obj, "poll_ms", &v) && v > 0)
        ts->poll_ms = static_cast<uint32_t>(v);
    if (jget_int(obj, "reconnect_s", &v) && v > 0)
        ts->reconnect_s = static_cast<uint32_t>(v);
    if (jget_int(obj, "timeout_ms", &v) && v > 0)
        ts->timeout_ms = static_cast<uint32_t>(v);
    return true;
}

/* Parse slave JSON object từ một phần tử mảng slaves[] */
static bool parse_slave(const std::string& obj, uint32_t default_poll_ms, SlaveConfig* sl)
{
    long v = 0;
    if (jget_int(obj, "addr", &v) && v >= 1 && v <= 247)
        sl->addr = static_cast<uint8_t>(v);
    else
        return false;   /* addr bắt buộc */
    if (!jget_str(obj, "profile", &sl->profile) || sl->profile.empty())
        return false;   /* profile bắt buộc */
    if (!jget_str(obj, "name", &sl->name) || sl->name.empty())
        return false;   /* name bắt buộc */
    sl->poll_ms = default_poll_ms;
    if (jget_int(obj, "poll_ms", &v) && v > 0)
        sl->poll_ms = static_cast<uint32_t>(v);
    if (jget_int(obj, "timeout_ms", &v) && v >= 20 && v <= 10000)
        sl->timeout_ms = static_cast<uint32_t>(v);
    /* D-05: `retry` nay là SỐ LẦN PHÁT LẠI một giao dịch (0..3). Giá trị cũ tới
     * 10 vẫn nhận được nhưng bị clamp: 10 lần phát lại × timeout 300 ms = 3 giây
     * chiếm dây cho MỘT block, không chấp nhận được trên bus dùng chung. */
    if (jget_int(obj, "retry", &v) && v >= 0) {
        if (v > 3) {
            std::fprintf(stderr, "WARN  fieldbus_config.retry_clamped slave=%s value=%lld → 3"
                         " — retry là số lần phát lại một giao dịch, không phải ngưỡng offline\n",
                         sl->name.c_str(), static_cast<long long>(v));
            v = 3;
        }
        sl->retry = static_cast<uint8_t>(v);
    }
    /* Ngưỡng OFFLINE tách riêng (D-05). Mặc định 2 lượt poll thất bại liên tiếp,
     * giữ đúng hành vi cũ cho cấu hình chưa khai báo trường này. */
    if (jget_int(obj, "offline_after_errors", &v) && v >= 1 && v <= 10)
        sl->offline_after_errors = static_cast<uint8_t>(v);
    /* MBR-B101: bus_id vắng ⇒ 1. Cấu hình một-bus cũ chạy y nguyên. */
    if (jget_int(obj, "bus_id", &v) && v >= 1 && v <= 255)
        sl->bus_id = static_cast<uint8_t>(v);
    return true;
}

/* Parse một phần tử của buses[] (MBR-B101). */
static bool parse_bus(const std::string& obj, BusConfig* bus)
{
    long v = 0;
    if (jget_int(obj, "id", &v) && v >= 1 && v <= 255)
        bus->id = static_cast<uint8_t>(v);
    else
        return false;   /* id bắt buộc — slave tham chiếu theo id */
    if (!jget_str(obj, "device", &bus->device) || bus->device.empty())
        return false;   /* device bắt buộc */
    jget_str(obj, "name", &bus->name);
    if (bus->name.empty()) bus->name = "RS485-" + std::to_string(bus->id);
    if (jget_int(obj, "baud", &v) && v > 0)
        bus->baud = static_cast<uint32_t>(v);
    std::string parity;
    if (jget_str(obj, "parity", &parity) && !parity.empty())
        bus->parity = static_cast<char>(parity[0]);
    if (jget_int(obj, "stop", &v) && (v == 1 || v == 2))
        bus->stop = static_cast<uint8_t>(v);
    if (jget_int(obj, "offline_probe_ms", &v)) {
        if (v < 1000)       v = 1000;
        else if (v > 60000) v = 60000;
        bus->offline_probe_ms = static_cast<uint32_t>(v);
    }
    if (jget_int(obj, "enabled", &v))
        bus->enabled = (v != 0);
    /* G-D: cơ chế điều hướng. Vắng ⇒ Auto (phần cứng đã xác nhận không có DE/RE). */
    std::string direction;
    if (jget_str(obj, "direction", &direction)) {
        if (direction == "rts") {
            bus->direction = Rs485Direction::Rts;
        } else if (direction == "auto") {
            bus->direction = Rs485Direction::Auto;
        } else {
            std::fprintf(stderr, "WARN  fieldbus_config.unknown_direction bus=%u value=%s"
                         " — chỉ nhận \"auto\" hoặc \"rts\"; dùng auto\n",
                         bus->id, direction.c_str());
        }
    }
    if (jget_int(obj, "rts_delay_before_us", &v) && v >= 0 && v <= 100000)
        bus->rts_delay_before_us = static_cast<uint32_t>(v);
    if (jget_int(obj, "rts_delay_after_us", &v) && v >= 0 && v <= 100000)
        bus->rts_delay_after_us = static_cast<uint32_t>(v);
    return true;
}

/* Duyệt các object `{...}` trong một chuỗi mảng JSON. */
static void for_each_json_object(const std::string& arr,
                                 const std::function<void(const std::string&)>& fn)
{
    size_t p = 0;
    while (p < arr.size()) {
        const size_t ob = arr.find('{', p);
        if (ob == std::string::npos) break;
        int depth = 0;
        size_t end = ob;
        for (size_t k = ob; k < arr.size(); ++k) {
            if (arr[k] == '{') ++depth;
            else if (arr[k] == '}') { if (--depth == 0) { end = k; break; } }
            else if (arr[k] == '"') { while (++k < arr.size() && arr[k] != '"') { if (arr[k] == '\\') ++k; } }
        }
        fn(arr.substr(ob, end - ob + 1));
        p = end + 1;
    }
}

void normalize_buses(FieldbusConfig* cfg)
{
    /* Migration cấu hình một-bus: `rs485{}` không có `buses[]` ⇒ dựng bus id 1.
     * Giữ nguyên hành vi cho mọi file đã provision trước 2026-08-05. */
    if (cfg->buses.empty() && !cfg->rs485.device.empty()) {
        BusConfig bus;
        bus.id               = 1;
        bus.name             = "RS485-1";
        bus.device           = cfg->rs485.device;
        bus.baud             = cfg->rs485.baud;
        bus.parity           = cfg->rs485.parity;
        bus.stop             = cfg->rs485.stop;
        bus.offline_probe_ms = cfg->rs485.offline_probe_ms;
        bus.direction        = Rs485Direction::Auto;
        cfg->buses.push_back(bus);
    }
    if (cfg->buses.empty()) return;
    for (auto& slave : cfg->slaves) {
        if (cfg->bus(slave.bus_id) != nullptr) continue;
        std::fprintf(stderr, "WARN  fieldbus_config.slave_bus_fallback slave=%s bus_id=%u → %u\n",
                     slave.name.c_str(), slave.bus_id, cfg->buses[0].id);
        slave.bus_id = cfg->buses[0].id;
    }
}

bool load_fieldbus_config(const std::string& path, bool path_from_cli,
                           FieldbusConfig* out)
{
    std::ifstream f(path);
    if (!f) {
        if (path_from_cli) {
            std::fprintf(stderr, "ERROR fieldbus_config.file_not_found path=%s\n", path.c_str());
            return false;
        }
        std::fprintf(stderr, "WARN  fieldbus_config.file_missing path=%s (defaults)\n",
                     path.c_str());
        out->loaded = false;
        return true;   /* bình thường khi chưa provision */
    }
    std::ostringstream ss;
    ss << f.rdbuf();
    const std::string json = ss.str();

    /* Kiểm tra JSON hợp lệ tối thiểu: phải có {} */
    if (json.find('{') == std::string::npos) {
        std::fprintf(stderr, "ERROR fieldbus_config.json_syntax path=%s\n", path.c_str());
        return false;
    }

    /* rs485 object */
    std::string rs485_obj;
    if (jget_obj(json, "rs485", &rs485_obj)) {
        jget_str(rs485_obj, "device", &out->rs485.device);
        long v = 0;
        if (jget_int(rs485_obj, "baud", &v) && v > 0)
            out->rs485.baud = static_cast<uint32_t>(v);
        std::string parity;
        if (jget_str(rs485_obj, "parity", &parity) && !parity.empty())
            out->rs485.parity = static_cast<char>(parity[0]);
        if (jget_int(rs485_obj, "stop", &v) && (v == 1 || v == 2))
            out->rs485.stop = static_cast<uint8_t>(v);
        /* D-04: nhịp thử lại slave OFFLINE. Clamp 1..60 s — dưới 1 s thì slave
         * chết vẫn chiếm dây đáng kể, trên 60 s thì thiết bị hồi phục quá lâu
         * mới được phát hiện. */
        if (jget_int(rs485_obj, "offline_probe_ms", &v)) {
            if (v < 1000)       v = 1000;
            else if (v > 60000) v = 60000;
            out->rs485.offline_probe_ms = static_cast<uint32_t>(v);
        }
    }

    long v = 0;
    if (jget_int(json, "poll_default_ms", &v) && v > 0)
        out->poll_default_ms = static_cast<uint32_t>(v);

    /* Provenance từ BE (MBR-B104). Vắng ⇒ 0 = "không biết", KHÔNG phải 1. */
    if (jget_int(json, "revision", &v) && v > 0)
        out->revision = static_cast<uint64_t>(v);
    jget_str(json, "checksum", &out->checksum);

    /* MBR-B101: buses[] là dạng chuẩn từ contract v2. */
    std::string buses_arr;
    if (jget_obj(json, "buses", &buses_arr)) {
        for_each_json_object(buses_arr, [&](const std::string& obj) {
            BusConfig bus;
            if (parse_bus(obj, &bus)) {
                for (const auto& existing : out->buses) {
                    if (existing.id == bus.id) {
                        std::fprintf(stderr, "WARN  fieldbus_config.duplicate_bus_id id=%u"
                                     " — bỏ qua phần tử sau\n", bus.id);
                        return;
                    }
                }
                out->buses.push_back(bus);
            } else {
                std::fprintf(stderr, "WARN  fieldbus_config.bus_parse_error — thiếu id/device;"
                             " bỏ qua phần tử buses\n");
            }
        });
    }

    /* slaves array */
    std::string slaves_arr;
    if (jget_obj(json, "slaves", &slaves_arr)) {
        for_each_json_object(slaves_arr, [&](const std::string& obj) {
            SlaveConfig sl;
            if (parse_slave(obj, out->poll_default_ms, &sl)) {
                out->slaves.push_back(sl);
            } else {
                std::fprintf(stderr, "WARN  fieldbus_config.slave_parse_error — thiếu addr/profile/name"
                             " trong phần tử slaves; bỏ qua\n");
            }
        });
    }

    normalize_buses(out);

    /* Phải có ít nhất một bus khi có RTU slaves. Fail-fast: một slave trỏ vào
     * bus không tồn tại thì không có cách nào poll nó, và im lặng ở đây tạo ra
     * đúng tình trạng "đèn xanh, bảng điểm trống" mà F-16 đã phải sửa. */
    if (!out->slaves.empty() && out->buses.empty()) {
        std::fprintf(stderr, "ERROR fieldbus_config.no_bus — bắt buộc khai báo buses[] hoặc"
                     " rs485.device trong fieldbus.conf khi có RTU slaves\n");
        return false;
    }
    for (const auto& sl : out->slaves) {
        if (out->bus(sl.bus_id) == nullptr) {
            std::fprintf(stderr, "ERROR fieldbus_config.slave_bus_not_found slave=%s bus_id=%u"
                         " — slave trỏ vào bus không khai báo\n", sl.name.c_str(), sl.bus_id);
            return false;
        }
    }

    /* tcp_slaves array */
    std::string tcp_arr;
    if (jget_obj(json, "tcp_slaves", &tcp_arr)) {
        for_each_json_object(tcp_arr, [&](const std::string& obj) {
            TcpSlaveConfig ts;
            if (parse_tcp_slave(obj, out->poll_default_ms, &ts)) {
                out->tcp_slaves.push_back(ts);
            } else {
                std::fprintf(stderr, "WARN  fieldbus_config.tcp_slave_parse_error — thiếu"
                             " host/profile/name; bỏ qua phần tử\n");
            }
        });
    }

    out->loaded = true;
    std::fprintf(stderr, "INFO  fieldbus_config.loaded path=%s buses=%zu slaves=%zu"
                 " tcp_slaves=%zu revision=%llu\n",
                 path.c_str(), out->buses.size(), out->slaves.size(),
                 out->tcp_slaves.size(), static_cast<unsigned long long>(out->revision));
    for (const auto& bus : out->buses) {
        std::fprintf(stderr, "INFO  fieldbus_config.bus id=%u name=%s device=%s %u%c8%u"
                     " probe=%ums enabled=%d\n",
                     bus.id, bus.name.c_str(), bus.device.c_str(), bus.baud, bus.parity,
                     bus.stop, bus.offline_probe_ms, bus.enabled ? 1 : 0);
    }
    return true;
}

} // namespace iobus::fieldbus
