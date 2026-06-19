/**
 * @file  device_profile.cpp
 * @brief MOD-003: device profile JSON parser + validator.
 */
#include "device_profile.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <sys/stat.h>

namespace iobus::fieldbus {

/* ---- minimal JSON helpers (same pattern as fieldbus_config) ---- */

static bool jget_str(const std::string& s, const char* key, std::string* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n')) ++p;
    if (p >= s.size() || s[p] != '"') return false;
    const size_t e = s.find('"', p + 1);
    if (e == std::string::npos) return false;
    *out = s.substr(p + 1, e - p - 1);
    return true;
}

static bool jget_num(const std::string& s, const char* key, double* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t')) ++p;
    char* ep = nullptr;
    const double v = std::strtod(s.c_str() + p, &ep);
    if (ep == s.c_str() + p) return false;
    *out = v;
    return true;
}

static bool jget_bool(const std::string& s, const char* key, bool* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t')) ++p;
    if (p + 4 <= s.size() && s.substr(p, 4) == "true")  { *out = true;  return true; }
    if (p + 5 <= s.size() && s.substr(p, 5) == "false") { *out = false; return true; }
    return false;
}

static bool is_write_fc(uint8_t fc)
{
    return fc == 5 || fc == 6 || fc == 15 || fc == 16;
}

static bool parse_point(const std::string& obj, ProfilePoint* pt)
{
    double v;
    std::string s;

    if (!jget_str(obj, "name", &pt->name)) pt->name = "?";

    if (!jget_num(obj, "fc", &v)) return false;
    const uint8_t fc = static_cast<uint8_t>(v);
    /* validate fc */
    if (fc != 1 && fc != 2 && fc != 3 && fc != 4 &&
        fc != 5 && fc != 6 && fc != 15 && fc != 16) {
        std::fprintf(stderr, "ERROR profile.bad_fc name=%s fc=%u — skip\n",
                     pt->name.c_str(), fc);
        return false;
    }
    pt->fc = fc;

    if (!jget_num(obj, "addr", &v) || v < 0 || v > 65535) {
        std::fprintf(stderr, "ERROR profile.bad_addr name=%s — skip\n", pt->name.c_str());
        return false;
    }
    pt->addr = static_cast<uint16_t>(v);

    pt->count = 1;
    if (jget_num(obj, "count", &v)) {
        if (v < 1 || v > 65535) {
            std::fprintf(stderr, "ERROR profile.bad_count name=%s count=%g — skip\n",
                         pt->name.c_str(), v);
            return false;
        }
        pt->count = static_cast<uint16_t>(v);
    }

    /* type */
    pt->type = PointType::Uint16;
    if (jget_str(obj, "type", &s)) {
        if      (s == "bool")    pt->type = PointType::Bool;
        else if (s == "int16")   pt->type = PointType::Int16;
        else if (s == "uint16")  pt->type = PointType::Uint16;
        else if (s == "int32")   pt->type = PointType::Int32;
        else if (s == "uint32")  pt->type = PointType::Uint32;
        else if (s == "float32") pt->type = PointType::Float32;
        else {
            std::fprintf(stderr, "ERROR profile.bad_type name=%s type=%s — skip\n",
                         pt->name.c_str(), s.c_str());
            return false;
        }
    }

    /* 32-bit types require count=2 registers (each FC03/04 register = 2 bytes) */
    const bool is32bit = (pt->type == PointType::Int32 ||
                          pt->type == PointType::Uint32 ||
                          pt->type == PointType::Float32);

    /* byte_order bắt buộc cho 32-bit */
    pt->byte_order = ByteOrder::AB;
    if (jget_str(obj, "byte_order", &s)) {
        if      (s == "AB")   pt->byte_order = ByteOrder::AB;
        else if (s == "BA")   pt->byte_order = ByteOrder::BA;
        else if (s == "ABCD") pt->byte_order = ByteOrder::ABCD;
        else if (s == "CDAB") pt->byte_order = ByteOrder::CDAB;
    } else if (is32bit) {
        std::fprintf(stderr, "ERROR profile.missing_byte_order name=%s type=%s — skip\n",
                     pt->name.c_str(), s.c_str());
        return false;
    }

    if (jget_num(obj, "scale", &v))  pt->scale  = static_cast<float>(v);
    if (jget_num(obj, "offset", &v)) pt->offset = static_cast<float>(v);

    bool wb = false;
    if (jget_bool(obj, "writable", &wb)) {
        pt->writable = wb;
        if (wb && !is_write_fc(fc)) {
            std::fprintf(stderr, "ERROR profile.writable_non_write_fc name=%s fc=%u — skip\n",
                         pt->name.c_str(), fc);
            return false;
        }
    }

    jget_str(obj, "map_to", &pt->map_to);

    /* BACnet expose (FB-Q-002) */
    bool exp = false;
    jget_bool(obj, "expose_bacnet", &exp);
    pt->expose_bacnet = exp;
    if (exp) {
        jget_str(obj, "bacnet_object_type", &pt->bacnet_object_type);
        if (pt->bacnet_object_type.empty()) {
            std::fprintf(stderr, "ERROR profile.expose_bacnet_no_type name=%s — skip bacnet\n",
                         pt->name.c_str());
            pt->expose_bacnet = false;
        }
        if (jget_num(obj, "bacnet_instance", &v) && v >= 0)
            pt->bacnet_instance = static_cast<uint32_t>(v);
    }

    /* validate block size limits (plan 25 §4) */
    if ((fc == 1 || fc == 2) && static_cast<int>(pt->count) * static_cast<int>(pt->count > 0) > 2000) {
        std::fprintf(stderr, "ERROR profile.coil_block_too_large name=%s count=%u — skip\n",
                     pt->name.c_str(), pt->count);
        return false;
    }
    if ((fc == 3 || fc == 4) && pt->count > 125) {
        std::fprintf(stderr, "ERROR profile.reg_block_too_large name=%s count=%u — skip\n",
                     pt->name.c_str(), pt->count);
        return false;
    }

    return true;
}

bool load_device_profile(const std::string& path, DeviceProfile* out)
{
    std::ifstream f(path);
    if (!f) {
        std::fprintf(stderr, "ERROR device_profile.file_not_found path=%s\n", path.c_str());
        return false;
    }
    std::ostringstream ss;
    ss << f.rdbuf();
    const std::string json = ss.str();

    if (json.find('{') == std::string::npos) {
        std::fprintf(stderr, "ERROR device_profile.json_syntax path=%s\n", path.c_str());
        return false;
    }

    jget_str(json, "profile_id",   &out->profile_id);
    jget_str(json, "vendor",       &out->vendor);
    jget_str(json, "description",  &out->description);
    double v;
    if (jget_num(json, "default_baud", &v) && v > 0)
        out->default_baud = static_cast<uint32_t>(v);

    /* parse points array */
    const std::string pat_pts = "\"points\"";
    size_t p = json.find(pat_pts);
    if (p != std::string::npos) {
        p = json.find('[', p);
        if (p != std::string::npos) {
            /* iterate objects */
            int depth = 0;
            while (p < json.size()) {
                const size_t ob = json.find('{', p);
                if (ob == std::string::npos) break;
                size_t end = ob;
                depth = 0;
                for (size_t k = ob; k < json.size(); ++k) {
                    if (json[k] == '{') ++depth;
                    else if (json[k] == '}') { if (--depth == 0) { end = k; break; } }
                    else if (json[k] == '"') { while (++k < json.size() && json[k] != '"') { if (json[k] == '\\') ++k; } }
                }
                const std::string obj = json.substr(ob, end - ob + 1);
                ProfilePoint pt;
                if (parse_point(obj, &pt))
                    out->points.push_back(pt);
                p = end + 1;
            }
        }
    }

    out->loaded = true;
    std::fprintf(stderr, "INFO  device_profile.loaded path=%s id=%s points=%zu\n",
                 path.c_str(), out->profile_id.c_str(), out->points.size());
    return true;
}

std::string find_profile_path(const std::string& profile_id)
{
    const std::string candidates[] = {
        "/data/config/profiles/" + profile_id + ".json",
        "/usr/share/kinexus/profiles/" + profile_id + ".json"
    };
    for (const auto& c : candidates) {
        struct stat st;
        if (::stat(c.c_str(), &st) == 0) return c;
    }
    return "";
}

} // namespace iobus::fieldbus
