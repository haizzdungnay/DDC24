/**
 * @file  device_profile.cpp
 * @brief MOD-003: device profile JSON parser + validator.
 */
#include "device_profile.hpp"

#include <cmath>
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

static bool is_read_fc(uint8_t fc)
{
    return fc == 1 || fc == 2 || fc == 3 || fc == 4;
}

/* ---- Ext slot accounting (F-17): nguồn chân lý duy nhất ---- */

bool point_type_is_32bit(PointType t)
{
    return t == PointType::Int32 || t == PointType::Uint32 || t == PointType::Float32;
}

uint16_t ext_slots_for_point(const ProfilePoint& pt)
{
    if (!is_read_fc(pt.fc)) return 0;              /* FC ghi không chiếm slot */
    if (pt.fc == 1 || pt.fc == 2) return pt.count; /* 1 bit = 1 điểm luận lý */
    if (point_type_is_32bit(pt.type))
        return static_cast<uint16_t>(pt.count / 2u);  /* 2 register = 1 điểm */
    return pt.count;
}

uint16_t ext_slots_for_profile(const DeviceProfile& prof)
{
    uint32_t total = 0;
    for (const auto& pt : prof.points) total += ext_slots_for_point(pt);
    return (total > UINT16_MAX) ? UINT16_MAX : static_cast<uint16_t>(total);
}

static bool parse_point(const std::string& obj, ProfilePoint* pt)
{
    double v = 0.0;
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
    const bool is32bit = point_type_is_32bit(pt->type);

    /* F-18: validation này đã được hứa ở device_profile.hpp nhưng trước
     * 2026-07-30 KHÔNG được hiện thực — is32bit chỉ dùng cho check byte_order.
     * Profile `{"type":"float32","count":1}` đi qua loader trọn vẹn, rồi RTU
     * decode với count=1 → decode_register trả 0.0f và publish `0*scale+offset`
     * với KX_Q_GOOD, tức một giá trị BỊA được đánh dấu là dữ liệu tốt.
     *
     * Chốt luật: bội số của 2 (không phải đúng bằng 2) để giữ khả năng đọc
     * block nhiều điểm 32-bit liên tiếp mà cả hai vòng đọc đã hỗ trợ. */
    if (is32bit && (pt->fc == 3 || pt->fc == 4) && (pt->count % 2u) != 0u) {
        std::fprintf(stderr, "ERROR profile.odd_count_for_32bit name=%s count=%u"
                     " — 32-bit cần count là bội số của 2 — skip\n",
                     pt->name.c_str(), pt->count);
        return false;
    }

    /* byte_order bắt buộc cho 32-bit */
    pt->byte_order = ByteOrder::AB;
    if (jget_str(obj, "byte_order", &s)) {
        if      (s == "AB")   pt->byte_order = ByteOrder::AB;
        else if (s == "BA")   pt->byte_order = ByteOrder::BA;
        else if (s == "ABCD") pt->byte_order = ByteOrder::ABCD;
        else if (s == "BADC") pt->byte_order = ByteOrder::BADC;
        else if (s == "CDAB") pt->byte_order = ByteOrder::CDAB;
        else if (s == "DCBA") pt->byte_order = ByteOrder::DCBA;
    } else if (is32bit) {
        std::fprintf(stderr, "ERROR profile.missing_byte_order name=%s type=%s — skip\n",
                     pt->name.c_str(), s.c_str());
        return false;
    }

    if (jget_num(obj, "scale", &v))  pt->scale  = static_cast<float>(v);
    if (jget_num(obj, "offset", &v)) pt->offset = static_cast<float>(v);

    /* D-02: scale=0 làm phép quy đổi ghi (eng - offset)/scale vô nghĩa. BE đã
     * chặn ở validator của nó, nhưng profile viết tay trong /data/config/profiles
     * là đường hợp lệ theo find_profile_path() và trước đây đi lọt: điểm sẽ được
     * ghi xuống thiết bị với giá trị 0. Chặn tại đây để nguồn nào cũng bị kiểm. */
    if (!std::isfinite(pt->scale) || pt->scale == 0.0f) {
        std::fprintf(stderr, "ERROR profile.invalid_scale name=%s scale=%g — skip\n",
                     pt->name.c_str(), static_cast<double>(pt->scale));
        return false;
    }
    if (!std::isfinite(pt->offset)) {
        std::fprintf(stderr, "ERROR profile.invalid_offset name=%s offset=%g — skip\n",
                     pt->name.c_str(), static_cast<double>(pt->offset));
        return false;
    }

    bool wb = false;
    if (jget_bool(obj, "writable", &wb)) {
        pt->writable = wb;
        /* Một Point read/write vẫn được poll bằng FC01/FC03; đường ghi runtime
         * suy ra FC05/06/16. Luật cũ làm Coil/Holding Register read/write
         * không thể cấu hình dù drain_ext_writes() đã hỗ trợ chúng. */
        if (wb && fc != 1 && fc != 3) {
            std::fprintf(stderr, "ERROR profile.writable_readonly_fc name=%s fc=%u — skip\n",
                         pt->name.c_str(), fc);
            return false;
        }
    }

    jget_str(obj, "map_to", &pt->map_to);

    /* `expose_bacnet` — ĐỌC ĐỂ CẢNH BÁO, KHÔNG THỰC THI (OD-MBRTU-014).
     *
     * Khoá này từng được parse vào ProfilePoint nhưng chưa bao giờ có consumer
     * runtime, và BE cũng chưa bao giờ sinh ra nó. Nay nó bị gỡ khỏi phạm vi
     * Rev A. Vẫn đọc ở đây để cấu hình cũ KHÔNG bị im lặng bỏ qua: người vận
     * hành phải thấy rõ trường của mình không có tác dụng, thay vì tin rằng
     * BACnet exposure đang chạy. Đây là đường migration, không phải đường
     * tính năng — vì vậy chỉ log, không lưu, và không làm Point bị loại. */
    bool legacy_expose = false;
    if (jget_bool(obj, "expose_bacnet", &legacy_expose) && legacy_expose) {
        std::fprintf(stderr,
                     "WARN profile.expose_bacnet_deprecated name=%s — trường này bị BỎ QUA ở "
                     "Rev A (OD-MBRTU-014); đưa Point Modbus RTU ra BACnet là phạm vi Rev B\n",
                     pt->name.c_str());
    }

    /* validate block size limits (plan 25 §4) */
    /* F-21: biểu thức cũ là `count * (count > 0) > 2000` — nhân tử thứ hai là
     * một bool luôn bằng 1 (count >= 1 đã bảo đảm ở trên), nên nó rút gọn thành
     * đúng ý định `count > 2000`. Viết thẳng ra để không còn là bẫy.
     * Giới hạn 2000 = MODBUS_MAX_READ_BITS, khớp buffer bits[2000] ở vòng đọc. */
    if ((fc == 1 || fc == 2) && pt->count > 2000) {
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
    double v = 0.0;
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
        profile_id,
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
