/**
 * @file  pid_file.hpp
 * @brief iobus tự ghi pidfile cho web (`IOBUS_PID`, mặc định
 *        `/run/mkddc/iobus.pid`).
 *
 *        Web đọc file này ở hai chỗ: health (`processAlive`, check `iobus`) và
 *        gửi SIGHUP reload iobus. Trước bản này KHÔNG ai ghi nó trong gói phát
 *        hành: binary không ghi, unit gốc cũng không. Bo lab Foxlinx chỉ chạy được
 *        nhờ một drop-in vá tay `ExecStartPost=/bin/sh -c "echo $MAINPID > …"`
 *        (2026-08-04), nên một bo cài mới bằng `install.sh` sẽ báo health iobus
 *        hỏng và không nạp lại cấu hình iobus được — lộ ra khi cài sạch bo lab
 *        ngày 2026-09-27. Cùng cách với Core (F16, `core/…/runtime/pid_file.hpp`):
 *        tiến trình biết PID của chính nó, không cần tiến trình phụ.
 *
 *        Ghi file tạm rồi rename để web không bao giờ đọc được file dở. Xoá khi
 *        thoát, nhưng chỉ khi file vẫn là của CHÍNH tiến trình này: pidfile cũ trỏ
 *        tới một PID đã được tái sử dụng sẽ làm web gửi SIGHUP cho tiến trình khác.
 */
#ifndef IOBUS_PID_FILE_HPP
#define IOBUS_PID_FILE_HPP

#include <fcntl.h>
#include <unistd.h>

#include <cstdio>
#include <string>
#include <utility>

namespace iobus {

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

/* Chỉ xoá khi file vẫn là của CHÍNH tiến trình này — một iobus mới đã ghi đè thì
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

/* Xoá pidfile ở MỌI đường thoát của main (kể cả `return 1` sớm khi config hỏng),
 * không chỉ ở cuối vòng poll. */
class PidFileGuard {
public:
    PidFileGuard(std::string path, long pid) : path_(std::move(path)), pid_(pid) {}
    ~PidFileGuard() { remove_pid_file_if_owned(path_, pid_); }
    PidFileGuard(const PidFileGuard&) = delete;
    PidFileGuard& operator=(const PidFileGuard&) = delete;

private:
    std::string path_;
    long pid_;
};

} // namespace iobus

#endif /* IOBUS_PID_FILE_HPP */
