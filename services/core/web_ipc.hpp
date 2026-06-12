/**
 * @file  web_ipc.hpp
 * @brief STUB contract 07 §8 — core là server Unix stream socket /run/mkddc/core.sock,
 *        web là client. 1 message = 1 dòng JSON. Stub Rev A: parse + queue + trả
 *        accepted/rejected (chưa có overridden) — đủ commissioning.
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
    float       value = 0.0f;
    std::string user;
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

    /* Trả response cho lệnh đã xử lý (accepted + applied_value). */
    void respond_accepted(const WebCommand& cmd, float applied_value);
    void respond_rejected(const WebCommand& cmd, const char* error);

private:
    void respond(int fd, const std::string& json_line);
    void handle_line(int fd, const std::string& line, std::vector<WebCommand>* out);

    int fd_ = -1;
    std::string path_;
    struct Client { int fd; std::string buf; };
    std::vector<Client> clients_;
};

/* "DO1"/"AO2"/"AV3"/"BV1"/"MSV2"/"AI1"/"BI1" → PointId; false nếu không hợp lệ */
bool parse_point_name(const std::string& name, PointId* out);

} // namespace core

#endif /* CORE_WEB_IPC_HPP */
