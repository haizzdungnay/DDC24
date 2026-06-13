/**
 * @file  web_ipc.hpp
 * @brief Contract 07 §8 — core là server Unix stream socket /run/mkddc/core.sock,
 *        web là client. 1 message = 1 dòng JSON. Đủ 3 result: accepted / rejected /
 *        overridden (nguồn cao hơn hoặc safe-state đang thắng — COR-007).
 *        Mỗi lệnh in 1 dòng AUDIT chuẩn {id,user,point,op,value,result,active_source}.
 */
#ifndef CORE_WEB_IPC_HPP
#define CORE_WEB_IPC_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "point_table.hpp"

namespace core {

struct WebCommand {
    uint64_t    id = 0;
    bool        is_write = false;   /* write | release */
    PointId     point{PointKind::AV, -1};
    std::string point_name;         /* đã sanitize [A-Za-z0-9] ≤8 — cho audit log */
    float       value = 0.0f;
    std::string user;               /* đã sanitize [A-Za-z0-9_.@-] ≤32 — cho audit */
    int         client_fd = -1;     /* để trả response đúng connection */
};

class WebIpc {
public:
    ~WebIpc();

    /* Bind + listen. Fail → WARN, degraded (commissioning qua web tắt). */
    bool open(const std::string& sock_path = "/run/mkddc/core.sock");
    void close();

    /* Scan step 4: accept client mới + đọc JSON lines + validate.
     * Lệnh hợp lệ → trả về queue (≤64/scan, quá → rejected "busy").
     * Lệnh sai → respond rejected ngay. */
    std::vector<WebCommand> drain();

    /* Trả response cho lệnh đã xử lý — gọi SAU resolve + safe-state (scan step 7):
     * applied_value/active_source là giá trị THẬT sau khi mọi nguồn tranh chấp xong. */
    void respond_accepted(const WebCommand& cmd, float applied_value,
                          const char* active_source = "manual");
    void respond_overridden(const WebCommand& cmd, float applied_value,
                            const char* active_source);
    void respond_rejected(const WebCommand& cmd, const char* error);

private:
    void respond(int fd, const std::string& json_line);
    void handle_line(int fd, const std::string& line, std::vector<WebCommand>* out);
    void audit(const WebCommand& cmd, const char* result, const char* active_source,
               float applied_value);

    int fd_ = -1;
    std::string path_;
    struct Client { int fd; std::string buf; };
    std::vector<Client> clients_;
};

/* "DO1"/"AO2"/"AV3"/"BV1"/"MSV2"/"AI1"/"BI1" → PointId; false nếu không hợp lệ */
bool parse_point_name(const std::string& name, PointId* out);

} // namespace core

#endif /* CORE_WEB_IPC_HPP */
