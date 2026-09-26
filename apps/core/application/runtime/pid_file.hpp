/**
 * @file  pid_file.hpp
 * @brief Core tự ghi pidfile cho web gửi SIGHUP reload (`CORE_PID`, mặc định
 *        `/run/mkddc/core.pid`).
 *
 *        F16 (EV-PROG-FBD-ST-MB-20260925, Foxlinx 2026-09-26): trước đây pidfile
 *        do một drop-in `ExecStartPost=/bin/sh -c "echo $MAINPID > …; chown …"`
 *        ghi. Mọi lệnh `Exec*` của unit nhận `CPUAffinity=3` và
 *        `CPUSchedulingPolicy=fifo`/80 của CHÍNH mkddc-core, nên shell đó chạy
 *        SCHED_FIFO 80 trên CPU3 — cùng CPU, cùng mức ưu tiên với vòng quét — đúng
 *        lúc Core vừa gửi READY=1. FIFO cùng mức không preempt nhau: vòng quét
 *        thức dậy trễ 4–12 ms và lỡ một base step ở 3/5 lần khởi động. Core biết
 *        PID của chính nó; ghi ở đây thì không còn tiến trình phụ nào.
 *
 *        Ghi file tạm rồi rename để web không bao giờ đọc được file dở. Xoá khi
 *        tắt sạch: pidfile cũ trỏ tới một PID đã được tái sử dụng sẽ làm web gửi
 *        SIGHUP cho tiến trình khác. Không gọi trên đường RT.
 */
#ifndef CORE_PID_FILE_HPP
#define CORE_PID_FILE_HPP

#include <fcntl.h>
#include <unistd.h>

#include <cstdio>
#include <string>

namespace core {

inline bool write_pid_file(const std::string& path, long pid)
{
    if (path.empty() || pid <= 0) return false;
    const std::string staged = path + ".tmp";
    const int fd = ::open(staged.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) return false;
    char text[32];
    const int length = std::snprintf(text, sizeof(text), "%ld\n", pid);
    const bool written = length > 0 && ::write(fd, text, static_cast<std::size_t>(length)) == length;
    const bool closed = ::close(fd) == 0;
    if (!written || !closed || ::rename(staged.c_str(), path.c_str()) != 0) {
        (void)::unlink(staged.c_str());
        return false;
    }
    return true;
}

/* Chỉ xoá khi file vẫn là của CHÍNH tiến trình này — một Core mới đã ghi đè thì
 * để nguyên. */
inline void remove_pid_file_if_owned(const std::string& path, long pid)
{
    std::FILE* file = std::fopen(path.c_str(), "r");
    if (file == nullptr) return;
    long stored = 0;
    const bool parsed = std::fscanf(file, "%ld", &stored) == 1;
    std::fclose(file);
    if (parsed && stored == pid) (void)::unlink(path.c_str());
}

} // namespace core

#endif /* CORE_PID_FILE_HPP */
