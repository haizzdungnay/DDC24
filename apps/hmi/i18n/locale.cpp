#include "i18n/locale.hpp"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

namespace hmi {

/* English string table */
const char* Locale::STR_EN[static_cast<int>(StrKey::STR_COUNT)] = {
    /* Tabs */
    "Home", "Points", "Alarm", "Control", "System", "Service",
    /* Status */
    "RUNNING", "FAULT", "SAFE", "OK", "DISABLED", "UNKNOWN",
    "LOCKED", "UNLOCKED",
    /* Home */
    "ALARM", "Active", "Unacked", "Critical",
    "CONTROLLER HEALTH", "CPU", "RAM", "Storage", "Temp", "Uptime",
    "I/O HEALTH", "COMMUNICATION", "CONFIG",
    "Profile", "Config Rev", "Checksum",
    /* I/O Monitor */
    "I/O MONITOR", "POINT", "NAME", "TYPE", "VALUE", "UNIT",
    "QUALITY", "AGE",
    "ALL", "BAD", "STALE",
    "No BAD/STALE points",
    /* Quality */
    "GOOD", "BAD", "STALE", "UNCERTAIN",
    /* Alarm */
    "ALARM / EVENT", "SUMMARY",
    "ACTIVE_UNACK", "ACTIVE_ACK", "CLEARED_UNACK", "CLEARED_ACK",
    "Ack Selected", "Active",
    "FAULT", "WARN", "INFO",
    /* Communication */
    "COMMUNICATION",
    "ETHERNET", "Link", "IP", "Mask", "Gateway", "MAC",
    "BACnet/IP", "Device ID", "Port", "Status", "Last req",
    "Modbus RTU-1", "Modbus RTU-2", "Modbus TCP",
    "Baudrate", "Parity", "Slaves", "Timeouts",
    /* BACnet status codes */
    "NO_TRAFFIC", "TIMEOUT", "CONFIG_ERROR", "DUPLICATE_ID", "LINK_DOWN",
    /* System */
    "SYSTEM / DIAGNOSTICS",
    "FIRMWARE", "RUNTIME", "RESOURCE", "PROCESS", "WATCHDOG", "LOG",
    "SOM FW", "MCU FW", "Build ID", "Boot Reason", "Last Error",
    "Last Warn", "Last Fault", "Uptime",
    /* Limited-operator Control and Service */
    "SERVICE / SESSION", "SESSION", "DIAGNOSTICS",
    "Username", "Password", "LOGIN", "LOGOUT", "READ ONLY",
    "CONTROL", "AUTO", "MANUAL", "OVERRIDE", "SETPOINT", "RELEASE",
    "CONFIRM", "REASON", "Username and password required",
    /* Fault banner */
    "I/O FAULT — Check MCU connection",
    /* Hint */
    "\xe2""\x97""\x84"" \xe2""\x96""\xba"": page   \xe2""\x96""\xb2""\xe2""\x96""\xbc"": select   \xe2""\x8f""\x8e"": OK   \xe2""\x8e""\x8b"": back",
};

/* Vietnamese string table */
const char* Locale::STR_VI[static_cast<int>(StrKey::STR_COUNT)] = {
    /* Tabs */
    "Trang ch\xe1""\xbb""\xa7""", "\xc4""\x90""i\xe1""\xbb""\x83""m", "C\xe1""\xba""\xa3""nh b\xc3""\xa1""o", "\xc4""\x90""i\xe1""\xbb""\x81""u khi\xe1""\xbb""\x83""n", "H\xe1""\xbb""\x87"" th\xe1""\xbb""\x91""ng", "D\xe1""\xbb""\x8b""ch v\xe1""\xbb""\xa5""",
    /* Status */
    "\xc4""\x90""ANG CH\xe1""\xba""\xa0""Y", "L\xe1""\xbb""\x96""I", "AN TO\xc3""\x80""N", "OK", "T\xe1""\xba""\xaf""T", "UNKNOWN",
    "KH\xc3""\x93""A", "M\xe1""\xbb""\x9e"" KH\xc3""\x93""A",
    /* Home */
    "C\xe1""\xba""\xa2""NH B\xc3""\x81""O", "Ho\xe1""\xba""\xa1""t \xc4""\x91""\xe1""\xbb""\x99""ng", "Ch\xc6""\xb0""a x\xc3""\xa1""c nh\xe1""\xba""\xad""n", "Nghi\xea""\xba""\xbf""m tr\xe1""\xbb""\x8d""ng",
    "S\xe1""\xbb""\xa8""C KH\xe1""\xbb""\x8e""E B\xe1""\xbb""\x98"" \xc4""\x90""I\xe1""\xbb""\x80""U KHI\xe1""\xbb""\x82""N",
    "CPU", "RAM", "L\xc6""\xb0""u tr\xe1""\xbb""\xaf""", "Nhi\xe1""\xbb""\x87""t \xc4""\x91""\xe1""\xbb""\x99""", "Ho\xe1""\xba""\xa1""t \xc4""\x91""\xe1""\xbb""\x99""ng",
    "S\xe1""\xbb""\xa8""C KH\xe1""\xbb""\x8e""E I/O", "GIAO TI\xe1""\xba""\xbe""P", "C\xe1""\xba""\xa4""U H\xc3""\x8c""NH",
    "Profile", "Phi\xea""\xba""\xbf""n b\xe1""\xba""\xa3""n c\xe1""\xba""\xa5""u h\xc3""\xac""nh", "Checksum",
    /* I/O Monitor */
    "GI\xc3""\x81""M S\xc3""\x81""T I/O", "\xc4""\x90""I\xe1""\xbb""\x82""M", "T\xc3""\x8e""N", "LO\xe1""\xba""\xa0""I", "GI\xc3""\x81"" TR\xe1""\xbb""\x8a""", "\xc4""\x90""\xc6""\xa0""N V\xe1""\xbb""\x8a""",
    "CH\xe1""\xba""\xa4""T L\xc6""\xaf""\xe1""\xbb""\xa2""NG", "TU\xe1""\xbb""\x94""I",
    "T\xe1""\xba""\xa4""T C\xe1""\xba""\xa2""", "L\xe1""\xbb""\x96""I", "C\xc5""\xa8""",
    "Kh\xc3""\xb4""ng c\xc3""\xb3"" \xc4""\x91""i\xe1""\xbb""\x83""m l\xe1""\xbb""\x97""i",
    /* Quality */
    "T\xe1""\xbb""\x91""T", "L\xe1""\xbb""\x96""I", "C\xc5""\xa8""", "NGHI NG\xe1""\xbb""\x9c""",
    /* Alarm */
    "C\xe1""\xba""\xa2""NH B\xc3""\x81""O / S\xe1""\xbb""\xb0"" KI\xe1""\xbb""\x86""N", "T\xe1""\xbb""\x94""NG H\xe1""\xbb""\xa2""P",
    "HO\xe1""\xba""\xa0""T \xc4""\x90""\xe1""\xbb""\x98""NG_CH\xc6""\xb0""A XN", "HO\xe1""\xba""\xa0""T \xc4""\x90""\xe1""\xbb""\x98""NG_\xc4""\x90""\xc3""\x83"" XN",
    "\xc4""\x90""\xc3""\x83"" X\xc3""\x93""A_CH\xc6""\xb0""A XN", "\xc4""\x90""\xc3""\x83"" X\xc3""\x93""A_\xc4""\x90""\xc3""\x83"" XN",
    "X\xc3""\xa1""c nh\xe1""\xba""\xad""n", "Ho\xe1""\xba""\xa1""t \xc4""\x91""\xe1""\xbb""\x99""ng",
    "L\xe1""\xbb""\x96""I", "C\xe1""\xba""\xa2""NH B\xc3""\x81""O", "TH\xc3""\x94""NG TIN",
    /* Communication */
    "GIAO TI\xe1""\xba""\xbe""P",
    "ETHERNET", "K\xe1""\xba""\xbf""t n\xe1""\xbb""\x91""i", "IP", "Mask", "C\xe1""\xbb""\x95""ng nh\xe1""\xbb""\x8f""", "MAC",
    "BACnet/IP", "Device ID", "C\xe1""\xbb""\x95""ng", "Tr\xe1""\xba""\xa1""ng th\xc3""\xa1""i", "\xc6""\xb0""u c\xe1""\xba""\xa7""u g\xe1""\xba""\xa7""n nh\xe1""\xba""\xa5""t",
    "Modbus RTU-1", "Modbus RTU-2", "Modbus TCP",
    "T\xe1""\xbb""\x91""c \xc4""\x91""\xe1""\xbb""\x99""", "Parity", "Slave", "H\xe1""\xba""\xbf""t h\xe1""\xba""\xa1""n",
    /* BACnet status codes */
    "KH\xc3""\x94""NG C\xc3""\x93"" TRAFFIC", "H\xe1""\xba""\xbc""T H\xe1""\xba""\xa0""N", "L\xe1""\xbb""\x96""I C\xe1""\xba""\xa4""U H\xc3""\x8c""NH", "TR\xc3""\x9a""NG ID", "M\xe1""\xba""\xa4""T K\xe1""\xba""\xbe""T N\xe1""\xbb""\x90""I",
    /* System */
    "H\xe1""\xbb""\x86"" TH\xe1""\xbb""\x90""NG / CH\xe1""\xba""\xa8""N \xc4""\x90""O\xc3""\x81""N",
    "FIRMWARE", "V\xe1""\xba""\xac""N H\xc3""\x80""NH", "T\xc3""\x80""I NGUY\xc3""\x8a""N", "TI\xe1""\xba""\xbe""N TR\xc3""\x8c""NH", "WATCHDOG", "NH\xe1""\xba""\xac""T K\xc3""\x9d""",
    "FW SOM", "FW MCU", "Build ID", "L\xc3""\xbd"" do kh\xe1""\xbb""\x9f""i \xc4""\x91""\xe1""\xbb""\x99""ng", "L\xe1""\xbb""\x97""i cu\xe1""\xbb""\x91""i",
    "C\xe1""\xba""\xa3""nh b\xc3""\xa1""o cu\xe1""\xbb""\x91""i", "L\xe1""\xbb""\x97""i cu\xe1""\xbb""\x91""i", "Ho\xe1""\xba""\xa1""t \xc4""\x91""\xe1""\xbb""\x99""ng",
    /* Limited-operator Control and Service */
    "DỊCH VỤ / PHIÊN", "PHIÊN", "CHẨN ĐOÁN",
    "Tên người dùng", "Mật khẩu", "ĐĂNG NHẬP", "ĐĂNG XUẤT", "CHỈ ĐỌC",
    "ĐIỀU KHIỂN", "TỰ ĐỘNG", "THỦ CÔNG", "GHI ĐÈ", "GIÁ TRỊ ĐẶT", "NHẢ",
    "XÁC NHẬN", "LÝ DO", "Cần tên người dùng và mật khẩu",
    /* Fault banner */
    "L\xe1""\xbb""\x96""I I/O \xe2""\x80""\x94"" Ki\xe1""\xbb""\x83""m tra k\xe1""\xba""\xbf""t n\xe1""\xbb""\x91""i MCU",
    /* Hint */
    "\xe2""\x97""\x84"" \xe2""\x96""\xba"": trang   \xe2""\x96""\xb2""\xe2""\x96""\xbc"": ch\xe1""\xbb""\x8d""n   \xe2""\x8f""\x8e"": OK   \xe2""\x8e""\x8b"": tho\xc3""\xa1""t",
};

bool Locale::load(const std::string& conf_path)
{
    conf_path_ = conf_path;
    std::ifstream f(conf_path);
    if (!f.is_open()) return false;
    std::string line;
    while (std::getline(f, line)) {
        const size_t eq = line.find('=');
        if (eq == std::string::npos) continue;
        auto trim = [](std::string value) {
            const size_t begin = value.find_first_not_of(" \t\r");
            const size_t end = value.find_last_not_of(" \t\r");
            return begin == std::string::npos ? std::string{} :
                   value.substr(begin, end - begin + 1);
        };
        const std::string key = trim(line.substr(0, eq));
        if (key != "language") continue;
        const std::string value = trim(line.substr(eq + 1));
        if (value == "vi") vi_ = true;
        else if (value == "en") vi_ = false;
    }
    return true;
}

void Locale::reload() { load(conf_path_); }

const char* Locale::str(StrKey k) const
{
    int idx = static_cast<int>(k);
    if (idx < 0 || idx >= static_cast<int>(StrKey::STR_COUNT)) return "";
    const char* s = vi_ ? STR_VI[idx] : STR_EN[idx];
    return s ? s : "";
}

} // namespace hmi
