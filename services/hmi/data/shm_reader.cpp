#include "data/shm_reader.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>

#include <arpa/inet.h>
#include <dirent.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/statvfs.h>
#include <unistd.h>

namespace hmi {

/* ---- SHM attach ---- */

static const char* shm_basename(const char* path)
{
    const char* p = std::strrchr(path, '/');
    return p ? p : path;
}

bool ShmReader::attach()
{
    if (!io_) {
        int fd = shm_open(shm_basename(KX_SHM_IO_PATH), O_RDONLY, 0);
        if (fd >= 0) {
            void* m = mmap(nullptr, sizeof(kx_io_shm_t), PROT_READ, MAP_SHARED, fd, 0);
            ::close(fd);
            if (m != MAP_FAILED) {
                const volatile kx_io_shm_t* s = static_cast<const volatile kx_io_shm_t*>(m);
                if (__atomic_load_n(&s->magic, __ATOMIC_ACQUIRE) == KX_SHM_MAGIC) {
                    io_ = s;
                    io_sz_ = sizeof(kx_io_shm_t);
                    std::fprintf(stderr, "INFO  hmi.shm io attached\n");
                } else {
                    munmap(m, sizeof(kx_io_shm_t));
                }
            }
        }
    }
    if (!plc_) {
        int fd = shm_open(shm_basename(KX_SHM_PLC_PATH), O_RDONLY, 0);
        if (fd >= 0) {
            void* m = mmap(nullptr, sizeof(kx_plc_shm_t), PROT_READ, MAP_SHARED, fd, 0);
            ::close(fd);
            if (m != MAP_FAILED) {
                const volatile kx_plc_shm_t* s = static_cast<const volatile kx_plc_shm_t*>(m);
                if (__atomic_load_n(&s->magic, __ATOMIC_ACQUIRE) == KX_SHM_MAGIC) {
                    plc_ = s;
                    plc_sz_ = sizeof(kx_plc_shm_t);
                    std::fprintf(stderr, "INFO  hmi.shm plc attached\n");
                } else {
                    munmap(m, sizeof(kx_plc_shm_t));
                }
            }
        }
    }
    return io_ != nullptr;  /* io is the critical one */
}

void ShmReader::detach()
{
    if (io_ && !ext_io_)  { munmap(const_cast<kx_io_shm_t*>(const_cast<const kx_io_shm_t*>(io_)),  io_sz_);  io_  = nullptr; }
    if (plc_ && !ext_plc_){ munmap(const_cast<kx_plc_shm_t*>(const_cast<const kx_plc_shm_t*>(plc_)), plc_sz_); plc_ = nullptr; }
}

/* ---- Seqlock reads ---- */

bool ShmReader::seqlock_read_io(const volatile kx_io_shm_t* s, DataCache* out)
{
    if (__atomic_load_n(&s->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) return false;
    for (int i = 0; i < 5; i++) {
        const uint32_t v1 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 & 1u) continue;
        /* Copy volatile struct via memcpy to avoid UB */
        kx_io_shm_t local;
        std::memcpy(&local, const_cast<const kx_io_shm_t*>(s), sizeof(local));
        const uint32_t v2 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 != v2) continue;
        /* Populate DataCache from local */
        out->ts_ns        = local.ts_ns;
        out->iop_status   = local.iop_status;
        out->fault_flags  = local.fault_flags;
        out->mcu_temp_x10 = local.mcu_temp_x10;
        out->iop_rx       = local.iop_rx;
        out->iop_crc_err  = local.iop_crc_err;
        out->iop_timeout  = local.iop_timeout;
        std::memcpy(out->ui_value,    local.ui_value,    sizeof(local.ui_value));
        std::memcpy(out->ui_quality,  local.ui_quality,  sizeof(local.ui_quality));
        std::memcpy(out->ui_unit,     local.ui_unit,     sizeof(local.ui_unit));
        std::memcpy(out->di_state,    local.di_state,    sizeof(local.di_state));
        std::memcpy(out->di_counter,  local.di_counter,  sizeof(local.di_counter));
        std::memcpy(out->ao_setpoint, local.ao_setpoint, sizeof(local.ao_setpoint));
        std::memcpy(out->ao_mode,     local.ao_mode,     sizeof(local.ao_mode));
        std::memcpy(out->do_cmd,      local.do_cmd,      sizeof(local.do_cmd));
        std::memcpy(out->do_feedback, local.do_feedback, sizeof(local.do_feedback));
        out->io_valid = true;
        return true;
    }
    return false;
}

bool ShmReader::seqlock_read_plc(const volatile kx_plc_shm_t* s, DataCache* out)
{
    if (__atomic_load_n(&s->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) return false;
    for (int i = 0; i < 5; i++) {
        const uint32_t v1 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 & 1u) continue;
        kx_plc_shm_t local;
        std::memcpy(&local, const_cast<const kx_plc_shm_t*>(s), sizeof(local));
        const uint32_t v2 = __atomic_load_n(&s->seq, __ATOMIC_ACQUIRE);
        if (v1 != v2) continue;
        std::memcpy(out->ai, local.ai, sizeof(local.ai));
        std::memcpy(out->bi, local.bi, sizeof(local.bi));
        std::memcpy(out->ao, local.ao, sizeof(local.ao));
        std::memcpy(out->bo, local.bo, sizeof(local.bo));
        std::memcpy(out->ext, local.ext, sizeof(local.ext));
        out->ext_count   = local.ext_count;
        out->plc_running = local.plc_running;
        out->scan_count  = local.scan_count;
        out->plc_ts_ns   = local.ts_ns;
        out->plc_valid   = true;
        return true;
    }
    return false;
}

ReadStatus ShmReader::read_all(DataCache* out) const
{
    /* Compute AGE */
    struct timespec now_ts{};
    clock_gettime(CLOCK_MONOTONIC, &now_ts);
    uint64_t now_ns = static_cast<uint64_t>(now_ts.tv_sec) * 1000000000ull
                    + static_cast<uint64_t>(now_ts.tv_nsec);

    /* F-03 fail-safe: reset các field lái annunciation TRƯỚC khi đọc.
     * DataCache được tái dùng qua từng chu kỳ ở main.cpp, nên nếu không reset ở
     * đây thì một lần đọc thất bại (magic chưa set xong lúc iobus restart, hoặc
     * 5 lần retry seqlock đều trượt) sẽ để iop_status=NORMAL của chu kỳ trước
     * tiếp tục lái quyết định → banner xanh, E001 im lặng.
     *
     * fault_flags reset về 0 chứ không về "có lỗi": khi không đọc được thì ta
     * KHÔNG biết cờ lỗi MCU, và kích E002 bằng dữ liệu bịa cũng sai như nuốt nó.
     * E001 (mất liên lạc I/O) là alarm đúng cho tình huống này và nó luôn kích.
     *
     * Các field *giá trị* (ui_value/ai/ext/... và ts_ns) KHÔNG reset — chúng đã
     * được age_ns bảo vệ ở screen_io.cpp, xoá chúng chỉ làm màn hình nháy dữ
     * liệu khi trượt đúng một chu kỳ đọc. */
    out->io_valid    = false;
    out->plc_valid   = false;
    out->iop_status  = KX_IOP_FAULT;
    out->fault_flags = 0;

    ReadStatus st;
    if (io_)  st.io_ok  = seqlock_read_io(io_, out);
    if (plc_) st.plc_ok = seqlock_read_plc(plc_, out);

    out->age_ns = (out->ts_ns > 0 && now_ns > out->ts_ns)
                  ? (now_ns - out->ts_ns)
                  : UINT64_MAX;
    return st;
}

/* ---- SysSnapshot ---- */

static float read_cpu_pct()
{
    /* /proc/stat: cpu user nice sys idle iowait irq sirq */
    static uint64_t prev_total = 0, prev_idle = 0;
    FILE* f = fopen("/proc/stat", "r");
    if (!f) return 0.0f;
    uint64_t user = 0, nice = 0, sys = 0, idle = 0, iowait = 0, irq = 0, sirq = 0;
    const int parsed = fscanf(f, "cpu %lu %lu %lu %lu %lu %lu %lu",
                              &user, &nice, &sys, &idle, &iowait, &irq, &sirq);
    fclose(f);
    if (parsed != 7) return 0.0f;
    uint64_t total = user + nice + sys + idle + iowait + irq + sirq;
    uint64_t dt = total - prev_total;
    uint64_t di = idle - prev_idle;
    float pct = (dt > 0) ? static_cast<float>(dt - di) / static_cast<float>(dt) * 100.0f : 0.0f;
    prev_total = total;
    prev_idle  = idle;
    return pct;
}

static void read_ram(uint32_t* used_mb, uint32_t* total_mb)
{
    FILE* f = fopen("/proc/meminfo", "r");
    if (!f) { *used_mb = *total_mb = 0; return; }
    uint64_t total = 0, avail = 0;
    char line[128];
    while (fgets(line, sizeof(line), f)) {
        uint64_t v;
        if (sscanf(line, "MemTotal: %lu kB", &v) == 1)  total = v;
        if (sscanf(line, "MemAvailable: %lu kB", &v) == 1) avail = v;
    }
    fclose(f);
    *total_mb = static_cast<uint32_t>(total / 1024u);
    *used_mb  = static_cast<uint32_t>((total - avail) / 1024u);
}

static int32_t read_cpu_temp_c10()
{
    FILE* f = fopen("/sys/class/thermal/thermal_zone0/temp", "r");
    if (!f) return 0;
    int millideg = 0;
    const int parsed = fscanf(f, "%d", &millideg);
    fclose(f);
    if (parsed != 1) return 0;
    return static_cast<int32_t>(millideg / 100);   /* millideg → 0.1°C */
}

static void read_storage(uint32_t* used_gb, uint32_t* total_gb)
{
    struct statvfs st{};
    if (statvfs("/data", &st) != 0) statvfs("/", &st);
    uint64_t bsize = st.f_frsize ? st.f_frsize : st.f_bsize;
    *total_gb = static_cast<uint32_t>(bsize * st.f_blocks / (1024u * 1024u * 1024u));
    *used_gb  = static_cast<uint32_t>(bsize * (st.f_blocks - st.f_bfree) / (1024u * 1024u * 1024u));
}

static void read_network(SysSnapshot* s)
{
    char iface[IFNAMSIZ] = "eth0";
    struct ifaddrs* probe = nullptr;
    if (getifaddrs(&probe) == 0) {
        for (struct ifaddrs* p = probe; p; p = p->ifa_next) {
            if (!p->ifa_addr || p->ifa_addr->sa_family != AF_INET ||
                (p->ifa_flags & IFF_LOOPBACK)) continue;
            std::snprintf(iface, sizeof(iface), "%s", p->ifa_name);
            break;
        }
        freeifaddrs(probe);
    }
    /* Link state */
    char path[128];
    snprintf(path, sizeof(path), "/sys/class/net/%s/operstate", iface);
    FILE* f = fopen(path, "r");
    if (f) {
        char state[16]{};
        const int parsed = fscanf(f, "%15s", state);
        fclose(f);
        if (parsed == 1)
            s->eth_link = (std::strncmp(state, "up", 2) == 0);
    }
    /* MAC */
    snprintf(path, sizeof(path), "/sys/class/net/%s/address", iface);
    f = fopen(path, "r");
    if (f) {
        const int parsed = fscanf(f, "%17s", s->eth_mac);
        if (parsed != 1) s->eth_mac[0] = '\0';
        fclose(f);
    }

    /* IP, mask, gateway via getifaddrs */
    struct ifaddrs* ifa_list = nullptr;
    if (getifaddrs(&ifa_list) == 0) {
        for (struct ifaddrs* ifa = ifa_list; ifa; ifa = ifa->ifa_next) {
            if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_INET) continue;
            if (std::strcmp(ifa->ifa_name, iface) != 0) continue;
            auto* sa = reinterpret_cast<struct sockaddr_in*>(ifa->ifa_addr);
            inet_ntop(AF_INET, &sa->sin_addr, s->eth_ip, sizeof(s->eth_ip));
            if (ifa->ifa_netmask) {
                auto* nm = reinterpret_cast<struct sockaddr_in*>(ifa->ifa_netmask);
                inet_ntop(AF_INET, &nm->sin_addr, s->eth_mask, sizeof(s->eth_mask));
            }
        }
        freeifaddrs(ifa_list);
    }

    f = fopen("/proc/net/route", "r");
    if (f) {
        char route_iface[IFNAMSIZ];
        unsigned long destination = 0, gateway = 0;
        char line[256];
        char* header = fgets(line, sizeof(line), f);
        (void)header;
        while (fgets(line, sizeof(line), f)) {
            if (sscanf(line, "%15s %lx %lx", route_iface, &destination, &gateway) == 3 &&
                std::strcmp(route_iface, iface) == 0 && destination == 0) {
                struct in_addr addr{};
                addr.s_addr = static_cast<in_addr_t>(gateway);
                inet_ntop(AF_INET, &addr, s->eth_gw, sizeof(s->eth_gw));
                break;
            }
        }
        fclose(f);
    }
}

static bool process_running(const char* name)
{
    DIR* proc = opendir("/proc");
    if (!proc) return false;
    bool found = false;
    while (const struct dirent* entry = readdir(proc)) {
        char* end = nullptr;
        const long pid = std::strtol(entry->d_name, &end, 10);
        if (!end || *end != '\0' || pid <= 1) continue;
        char path[64];
        std::snprintf(path, sizeof(path), "/proc/%ld/comm", pid);
        FILE* f = std::fopen(path, "r");
        if (!f) continue;
        char comm[64]{};
        const bool read = std::fgets(comm, sizeof(comm), f) != nullptr;
        std::fclose(f);
        if (!read) continue;
        comm[std::strcspn(comm, "\r\n")] = '\0';
        if (std::strcmp(comm, name) == 0) {
            found = true;
            break;
        }
    }
    closedir(proc);
    return found;
}

static void read_first_line(const char* path, char* dst, size_t n)
{
    FILE* f = fopen(path, "r");
    if (!f) return;
    if (fgets(dst, static_cast<int>(n), f)) dst[strcspn(dst, "\r\n")] = '\0';
    fclose(f);
}

void sys_snapshot_update(SysSnapshot* snap)
{
    read_first_line("/etc/mkddc/version", snap->fw_version, sizeof(snap->fw_version));
    read_first_line("/run/mkddc/mcu-version", snap->mcu_fw_version, sizeof(snap->mcu_fw_version));
    read_first_line("/run/mkddc/boot_reason", snap->boot_reason, sizeof(snap->boot_reason));

    /* Uptime */
    FILE* f = fopen("/proc/uptime", "r");
    if (f) {
        double up = 0.0;
        if (fscanf(f, "%lf", &up) == 1)
            snap->uptime_s = static_cast<uint32_t>(up);
        fclose(f);
    }

    snap->cpu_pct    = read_cpu_pct();
    snap->cpu_temp_c10 = read_cpu_temp_c10();
    read_ram(&snap->ram_used_mb, &snap->ram_total_mb);
    read_storage(&snap->storage_used_gb, &snap->storage_total_gb);
    read_network(snap);

    snap->core_running  = process_running("mkddc-core");
    snap->iobus_running = process_running("mkddc-iobus");
    snap->hmi_running   = true;  /* we are running */
    snap->bacnet_running = snap->iobus_running;
    snap->modbus_running = snap->iobus_running;
    std::snprintf(snap->bacnet_status, sizeof(snap->bacnet_status), "%s",
                  !snap->eth_link ? "LINK_DOWN" : snap->iobus_running ? "NO_TRAFFIC" : "CONFIG_ERROR");
    std::snprintf(snap->modbus_rtu1_status, sizeof(snap->modbus_rtu1_status), "%s",
                  snap->iobus_running ? "OK" : "TIMEOUT");
    std::snprintf(snap->modbus_rtu2_status, sizeof(snap->modbus_rtu2_status), "DISABLED");
    std::snprintf(snap->modbus_tcp_status, sizeof(snap->modbus_tcp_status), "%s",
                  snap->iobus_running && snap->eth_link ? "OK" : "LINK_DOWN");
    std::snprintf(snap->watchdog_status, sizeof(snap->watchdog_status), "%s",
                  snap->core_running && snap->iobus_running ? "OK" : "FAULT");
}

} // namespace hmi
