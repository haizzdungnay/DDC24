/**
 * @file  sim_sandbox.hpp
 * @brief `T59-814` — hàng rào tiến trình mà `mkddc-programming-sim-worker` tự
 *        dựng quanh chính nó.
 *
 *        Vì sao worker tự dựng thay vì chỉ dựa vào supervisor: supervisor là
 *        tiến trình KHÁC. Nếu ai đó chạy worker bằng tay, hoặc supervisor bị
 *        sửa sai, thì mọi bảo đảm "không chạm production" biến mất mà không có
 *        dấu hiệu nào. Hàng rào phải nằm trong chính binary được kiểm.
 *
 *        Bốn lớp, theo thứ tự áp dụng:
 *
 *        1. Đóng mọi FD thừa kế ngoài stdin/stdout/stderr. Một FD bỏ quên trỏ
 *           vào SHM hay socket Core là đường đi thẳng qua mọi lớp còn lại.
 *        2. `RLIMIT_FSIZE=0` — worker KHÔNG tạo được file nào. Đây là cách rẻ
 *           nhất để "không có output writer" thành một tính chất kiểm được của
 *           tiến trình, không phải một câu trong review.
 *        3. `PR_SET_NO_NEW_PRIVS` + `RLIMIT_NPROC`/`RLIMIT_AS`.
 *        4. seccomp-BPF: allowlist syscall của vòng tính toán; nhóm syscall
 *           "thoát sandbox" trả thẳng `EACCES` để negative probe đọc được đúng
 *           errno mà `DDD-SW-PGM02-WORKSPACE-001` §8.4 yêu cầu, thay vì tiến
 *           trình chết bằng SIGSYS và không nói được gì.
 *
 *        Hành động mặc định là `EPERM` chứ không phải kill. Một syscall lạ của
 *        libc trên nền tảng khác sẽ làm worker hỏng phiên đó một cách quan sát
 *        được, thay vì làm cả tính năng chết theo cách không chẩn đoán nổi.
 */
#ifndef CORE_PROGRAMMING_SIM_SANDBOX_HPP
#define CORE_PROGRAMMING_SIM_SANDBOX_HPP

#include <string>

namespace core::programming::sim {

struct SandboxReport {
    bool closed_inherited_fds = false;
    bool file_writes_denied = false;   /* RLIMIT_FSIZE = 0 */
    bool no_new_privs = false;
    bool address_space_capped = false;
    bool seccomp_installed = false;
    unsigned long address_space_bytes = 0;
};

/* Áp hàng rào. Trả false + `*error` khi một lớp BẮT BUỘC không áp được; caller
 * phải coi đó là lỗi khởi động và thoát, không được chạy tiếp "gần an toàn".
 *
 * `max_address_space_bytes = 0` giữ nguyên giới hạn hiện có. */
bool apply_sandbox(unsigned long max_address_space_bytes, SandboxReport* report,
                   std::string* error);

} // namespace core::programming::sim

#endif /* CORE_PROGRAMMING_SIM_SANDBOX_HPP */
