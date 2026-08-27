#include "programming/simulation/sim_sandbox.hpp"

#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>

#include <dirent.h>
#include <unistd.h>
#include <sys/resource.h>

#if defined(__linux__)
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#endif

namespace core::programming::sim {

namespace {

std::string errno_text(const char* what)
{
    return std::string(what) + ": " + std::strerror(errno);
}

/* Đóng mọi FD > 2. Duyệt `/proc/self/fd` thay vì đếm tới `RLIMIT_NOFILE`: trần
 * FD có thể rất lớn và một vòng lặp mù vừa chậm vừa không chứng minh được gì. */
bool close_inherited_fds()
{
    DIR* dir = opendir("/proc/self/fd");
    if (dir == nullptr) return false;
    std::vector<int> victims;
    const int dir_fd = dirfd(dir);
    for (struct dirent* entry = readdir(dir); entry != nullptr; entry = readdir(dir)) {
        char* end = nullptr;
        const long value = std::strtol(entry->d_name, &end, 10);
        if (end == nullptr || *end != '\0') continue;
        const int fd = static_cast<int>(value);
        if (fd <= 2 || fd == dir_fd) continue;
        victims.push_back(fd);
    }
    closedir(dir);
    for (int fd : victims) ::close(fd);
    return true;
}

#if defined(__linux__)

struct SyscallRule {
    int      number;
    uint32_t action;
};

/* Mỗi syscall được bọc `#ifdef` riêng vì bảng syscall của x86_64 và aarch64
 * không trùng nhau: máy phát triển là x86_64 còn bo là aarch64, và một bảng
 * cứng theo một kiến trúc sẽ lặng lẽ cấm nhầm syscall trên kiến trúc kia. */
#define SIM_ADD_SYSCALL(vector, name) \
    do {                              \
        vector.push_back(__NR_##name);\
    } while (0)

std::vector<int> escape_syscalls()
{
    std::vector<int> list;
#ifdef __NR_open
    SIM_ADD_SYSCALL(list, open);
#endif
#ifdef __NR_openat
    SIM_ADD_SYSCALL(list, openat);
#endif
#ifdef __NR_openat2
    SIM_ADD_SYSCALL(list, openat2);
#endif
#ifdef __NR_socket
    SIM_ADD_SYSCALL(list, socket);
#endif
#ifdef __NR_socketpair
    SIM_ADD_SYSCALL(list, socketpair);
#endif
#ifdef __NR_connect
    SIM_ADD_SYSCALL(list, connect);
#endif
#ifdef __NR_bind
    SIM_ADD_SYSCALL(list, bind);
#endif
#ifdef __NR_ioctl
    SIM_ADD_SYSCALL(list, ioctl);
#endif
#ifdef __NR_mount
    SIM_ADD_SYSCALL(list, mount);
#endif
#ifdef __NR_ptrace
    SIM_ADD_SYSCALL(list, ptrace);
#endif
#ifdef __NR_execve
    SIM_ADD_SYSCALL(list, execve);
#endif
#ifdef __NR_execveat
    SIM_ADD_SYSCALL(list, execveat);
#endif
#ifdef __NR_clone
    SIM_ADD_SYSCALL(list, clone);
#endif
#ifdef __NR_clone3
    SIM_ADD_SYSCALL(list, clone3);
#endif
#ifdef __NR_fork
    SIM_ADD_SYSCALL(list, fork);
#endif
#ifdef __NR_shmget
    SIM_ADD_SYSCALL(list, shmget);
#endif
#ifdef __NR_shmat
    SIM_ADD_SYSCALL(list, shmat);
#endif
#ifdef __NR_mknod
    SIM_ADD_SYSCALL(list, mknod);
#endif
#ifdef __NR_mknodat
    SIM_ADD_SYSCALL(list, mknodat);
#endif
#ifdef __NR_unlink
    SIM_ADD_SYSCALL(list, unlink);
#endif
#ifdef __NR_unlinkat
    SIM_ADD_SYSCALL(list, unlinkat);
#endif
#ifdef __NR_init_module
    SIM_ADD_SYSCALL(list, init_module);
#endif
#ifdef __NR_finit_module
    SIM_ADD_SYSCALL(list, finit_module);
#endif
    return list;
}

std::vector<int> allowed_syscalls()
{
    std::vector<int> list;
#ifdef __NR_read
    SIM_ADD_SYSCALL(list, read);
#endif
#ifdef __NR_write
    SIM_ADD_SYSCALL(list, write);
#endif
#ifdef __NR_readv
    SIM_ADD_SYSCALL(list, readv);
#endif
#ifdef __NR_writev
    SIM_ADD_SYSCALL(list, writev);
#endif
#ifdef __NR_close
    SIM_ADD_SYSCALL(list, close);
#endif
#ifdef __NR_exit
    SIM_ADD_SYSCALL(list, exit);
#endif
#ifdef __NR_exit_group
    SIM_ADD_SYSCALL(list, exit_group);
#endif
#ifdef __NR_rt_sigreturn
    SIM_ADD_SYSCALL(list, rt_sigreturn);
#endif
#ifdef __NR_rt_sigaction
    SIM_ADD_SYSCALL(list, rt_sigaction);
#endif
#ifdef __NR_rt_sigprocmask
    SIM_ADD_SYSCALL(list, rt_sigprocmask);
#endif
#ifdef __NR_brk
    SIM_ADD_SYSCALL(list, brk);
#endif
#ifdef __NR_mmap
    SIM_ADD_SYSCALL(list, mmap);
#endif
#ifdef __NR_munmap
    SIM_ADD_SYSCALL(list, munmap);
#endif
#ifdef __NR_mremap
    SIM_ADD_SYSCALL(list, mremap);
#endif
#ifdef __NR_mprotect
    SIM_ADD_SYSCALL(list, mprotect);
#endif
#ifdef __NR_madvise
    SIM_ADD_SYSCALL(list, madvise);
#endif
#ifdef __NR_futex
    SIM_ADD_SYSCALL(list, futex);
#endif
#ifdef __NR_clock_gettime
    SIM_ADD_SYSCALL(list, clock_gettime);
#endif
#ifdef __NR_clock_nanosleep
    SIM_ADD_SYSCALL(list, clock_nanosleep);
#endif
#ifdef __NR_nanosleep
    SIM_ADD_SYSCALL(list, nanosleep);
#endif
#ifdef __NR_getrandom
    SIM_ADD_SYSCALL(list, getrandom);
#endif
#ifdef __NR_getpid
    SIM_ADD_SYSCALL(list, getpid);
#endif
#ifdef __NR_gettid
    SIM_ADD_SYSCALL(list, gettid);
#endif
#ifdef __NR_fstat
    SIM_ADD_SYSCALL(list, fstat);
#endif
#ifdef __NR_newfstatat
    SIM_ADD_SYSCALL(list, newfstatat);
#endif
#ifdef __NR_lseek
    SIM_ADD_SYSCALL(list, lseek);
#endif
#ifdef __NR_ppoll
    SIM_ADD_SYSCALL(list, ppoll);
#endif
#ifdef __NR_poll
    SIM_ADD_SYSCALL(list, poll);
#endif
#ifdef __NR_sched_yield
    SIM_ADD_SYSCALL(list, sched_yield);
#endif
#ifdef __NR_restart_syscall
    SIM_ADD_SYSCALL(list, restart_syscall);
#endif
#ifdef __NR_prlimit64
    SIM_ADD_SYSCALL(list, prlimit64);
#endif
#ifdef __NR_set_robust_list
    SIM_ADD_SYSCALL(list, set_robust_list);
#endif
#ifdef __NR_rseq
    SIM_ADD_SYSCALL(list, rseq);
#endif
#ifdef __NR_membarrier
    SIM_ADD_SYSCALL(list, membarrier);
#endif
#ifdef __NR_tgkill
    SIM_ADD_SYSCALL(list, tgkill);
#endif
    return list;
}

#undef SIM_ADD_SYSCALL

bool install_seccomp(std::string* error)
{
#if defined(__x86_64__)
    const uint32_t expected_arch = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
    const uint32_t expected_arch = AUDIT_ARCH_AARCH64;
#elif defined(__arm__)
    const uint32_t expected_arch = AUDIT_ARCH_ARM;
#else
    if (error) *error = "seccomp: kiến trúc chưa được hỗ trợ";
    return false;
#endif

#if defined(__x86_64__) || defined(__aarch64__) || defined(__arm__)
    std::vector<SyscallRule> rules;
    /* Nhóm "thoát sandbox" đặt TRƯỚC allowlist vì bộ lọc dừng ở luật khớp đầu
     * tiên; chúng trả `EACCES` để negative probe đọc được đúng errno mà
     * `DDD-SW-PGM02-WORKSPACE-001` §8.4 yêu cầu, thay vì tiến trình chết bằng
     * SIGSYS và không nói được gì. */
    for (int number : escape_syscalls()) {
        rules.push_back(SyscallRule{number, SECCOMP_RET_ERRNO | (EACCES & SECCOMP_RET_DATA)});
    }
    for (int number : allowed_syscalls()) {
        rules.push_back(SyscallRule{number, SECCOMP_RET_ALLOW});
    }

    std::vector<sock_filter> filter;
    filter.push_back(BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
                              static_cast<uint32_t>(offsetof(struct seccomp_data, arch))));
    filter.push_back(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, expected_arch, 1, 0));
    filter.push_back(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)));
    filter.push_back(BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
                              static_cast<uint32_t>(offsetof(struct seccomp_data, nr))));
    for (const SyscallRule& rule : rules) {
        filter.push_back(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K,
                                  static_cast<uint32_t>(rule.number), 0, 1));
        filter.push_back(BPF_STMT(BPF_RET | BPF_K, rule.action));
    }
    /* Mặc định là `EPERM`, không phải kill. Một syscall lạ của libc trên nền
     * tảng khác sẽ làm hỏng đúng phiên đó một cách quan sát được, thay vì làm
     * cả tính năng chết theo cách không chẩn đoán nổi. */
    filter.push_back(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)));

    if (filter.size() > 4096) {
        if (error) *error = "seccomp: bộ lọc quá lớn";
        return false;
    }
    struct sock_fprog program;
    program.len = static_cast<unsigned short>(filter.size());
    program.filter = filter.data();
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program, 0, 0) != 0) {
        if (error) *error = errno_text("seccomp");
        return false;
    }
    return true;
#endif
}

#endif /* __linux__ */

} // namespace

bool apply_sandbox(unsigned long max_address_space_bytes, SandboxReport* report,
                   std::string* error)
{
    SandboxReport local;

    local.closed_inherited_fds = close_inherited_fds();
    if (!local.closed_inherited_fds) {
        if (error) *error = errno_text("không duyệt được /proc/self/fd");
        return false;
    }

    struct rlimit no_files;
    no_files.rlim_cur = 0;
    no_files.rlim_max = 0;
    if (setrlimit(RLIMIT_FSIZE, &no_files) != 0) {
        if (error) *error = errno_text("RLIMIT_FSIZE");
        return false;
    }
    local.file_writes_denied = true;

    /* Không fork được: worker không có lý do gì để sinh tiến trình con, và cấm
     * ở đây làm mọi đường "chạy nhờ tiến trình khác" biến mất. Không chặn khởi
     * động khi thất bại vì một số nền tảng đếm NPROC theo UID dùng chung. */
    struct rlimit no_procs;
    no_procs.rlim_cur = 0;
    no_procs.rlim_max = 0;
    setrlimit(RLIMIT_NPROC, &no_procs);

    if (max_address_space_bytes > 0) {
        struct rlimit address_space;
        address_space.rlim_cur = max_address_space_bytes;
        address_space.rlim_max = max_address_space_bytes;
        if (setrlimit(RLIMIT_AS, &address_space) == 0) {
            local.address_space_capped = true;
            local.address_space_bytes = max_address_space_bytes;
        }
    }

#if defined(__linux__)
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        if (error) *error = errno_text("PR_SET_NO_NEW_PRIVS");
        return false;
    }
    local.no_new_privs = true;

    std::string seccomp_error;
    if (!install_seccomp(&seccomp_error)) {
        if (error) *error = seccomp_error;
        return false;
    }
    local.seccomp_installed = true;
#endif

    if (report) *report = local;
    return true;
}

} // namespace core::programming::sim
