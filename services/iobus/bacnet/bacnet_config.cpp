/**
 * @file  bacnet_config.cpp
 * @brief BAC-002: config loader.
 */
#include "bacnet_config.hpp"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace iobus::bacnet {

static bool jget_str(const std::string& s, const char* key, std::string* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p]==' '||s[p]=='\t'||s[p]=='\n')) ++p;
    if (p >= s.size() || s[p] != '"') return false;
    const size_t e = s.find('"', p+1);
    if (e == std::string::npos) return false;
    *out = s.substr(p+1, e-p-1);
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
    while (p < s.size() && (s[p]==' '||s[p]=='\t')) ++p;
    char* ep = nullptr;
    const long v = std::strtol(s.c_str()+p, &ep, 10);
    if (ep == s.c_str()+p) return false;
    *out = v; return true;
}

static bool jget_bool(const std::string& s, const char* key, bool* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p]==' '||s[p]=='\t')) ++p;
    if (p+4<=s.size() && s.substr(p,4)=="true")  { *out=true;  return true; }
    if (p+5<=s.size() && s.substr(p,5)=="false") { *out=false; return true; }
    return false;
}

static std::string read_file(const std::string& path, bool* ok)
{
    std::ifstream f(path);
    *ok = f.good();
    if (!*ok) return "";
    std::ostringstream ss; ss << f.rdbuf();
    return ss.str();
}

bool load_bacnet_config(const std::string& device_conf_path,
                         const std::string& bacnet_conf_path,
                         bool from_cli,
                         BacnetConfig* out)
{
    /* device.conf */
    bool ok;
    const std::string dev_json = read_file(device_conf_path, &ok);
    if (ok) {
        long v;
        if (jget_int(dev_json, "device_id", &v) && v >= 1 && v <= 4194302)
            out->device.device_id = static_cast<uint32_t>(v);
        jget_str(dev_json, "device_name", &out->device.device_name);
        jget_str(dev_json, "description",  &out->device.description);
        jget_str(dev_json, "location",     &out->device.location);
    } else if (from_cli) {
        std::fprintf(stderr, "WARN  bacnet_config.device_conf_missing path=%s (defaults)\n",
                     device_conf_path.c_str());
    }

    /* bacnet.conf */
    const std::string bac_json = read_file(bacnet_conf_path, &ok);
    if (ok) {
        if (bac_json.find('{') == std::string::npos) {
            std::fprintf(stderr, "ERROR bacnet_config.json_syntax path=%s\n",
                         bacnet_conf_path.c_str());
            return false;
        }
        /* bip object */
        bool b = false;
        long v = 0;
        jget_bool(bac_json, "enabled", &b);       out->bip.enabled = b;
        if (jget_int(bac_json, "udp_port", &v) && v > 0)
            out->bip.udp_port = static_cast<uint16_t>(v);
        jget_str(bac_json, "bind_interface", &out->bip.bind_interface);

        if (out->bip.bind_interface.empty())
            std::fprintf(stderr, "WARN  bacnet_config.bind_interface_empty — khuyến nghị đặt"
                         " tường minh để tránh listen WAN (CONFIG_SCHEMA §5)\n");
    } else {
        std::fprintf(stderr, "WARN  bacnet_config.bacnet_conf_missing path=%s (defaults)\n",
                     bacnet_conf_path.c_str());
    }

    out->loaded = true;
    std::fprintf(stderr, "INFO  bacnet_config.loaded device_id=%u name=%s bip=%s port=%u iface=%s\n",
                 out->device.device_id, out->device.device_name.c_str(),
                 out->bip.enabled ? "ON" : "OFF",
                 out->bip.udp_port,
                 out->bip.bind_interface.empty() ? "(all)" : out->bip.bind_interface.c_str());
    return true;
}

} // namespace iobus::bacnet
