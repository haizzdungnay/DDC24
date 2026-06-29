/**
 * @file  bacnet_objtable.cpp
 * @brief BAC-004 + MOD-009: core publish kx_plc_shm + ext snapshot read.
 */
#include "bacnet_objtable.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <unistd.h>

#include "iop_protocol.h"

namespace core {

static const char* plc_shm_name()
{
    const char* p = KX_SHM_PLC_PATH;
    const char* base = std::strrchr(p, '/');
    return base ? base : p;
}

static uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

BacnetObjTable::~BacnetObjTable()
{
    detach();
}

bool BacnetObjTable::attach()
{
    const int fd = shm_open(plc_shm_name(), O_CREAT | O_RDWR, 0664);
    if (fd < 0) {
        std::fprintf(stderr, "ERROR plc_shm.attach_fail shm_open errno=%d\n", errno);
        return false;
    }
    if (ftruncate(fd, sizeof(kx_plc_shm_t)) != 0) {
        std::fprintf(stderr, "ERROR plc_shm.attach_fail ftruncate errno=%d\n", errno);
        ::close(fd);
        return false;
    }
    void* mem = mmap(nullptr, sizeof(kx_plc_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    ::close(fd);
    if (mem == MAP_FAILED) {
        std::fprintf(stderr, "ERROR plc_shm.attach_fail mmap errno=%d\n", errno);
        return false;
    }
    shm_ = static_cast<kx_plc_shm_t*>(mem);
    std::memset(shm_, 0, sizeof(kx_plc_shm_t));
    /* magic set CUỐI cùng — reader thấy magic hợp lệ chỉ khi memset xong */
    __atomic_store_n(&shm_->magic, KX_SHM_MAGIC, __ATOMIC_RELEASE);
    std::fprintf(stderr, "INFO  plc_shm.attached path=%s size=%zu\n",
                 KX_SHM_PLC_PATH, sizeof(kx_plc_shm_t));
    return true;
}

void BacnetObjTable::detach()
{
    if (shm_) {
        munmap(shm_, sizeof(kx_plc_shm_t));
        shm_ = nullptr;
    }
}

/* BAC-008: map quality + fault → BACnet Reliability (SW_BACNET_DESIGN §6).
 * ch_mask_bit: reserved for future per-channel diagnostics (unused in IOP v2). */
uint8_t quality_to_reliability(kx_quality_t q, uint16_t fault_flags, int ch_mask_bit)
{
    if (fault_flags & (IOP_FAULT_ADC1 | IOP_FAULT_ADC2)) return 5;   /* COMM_FAILURE */
    /* IOP v2 (ADR-010): FAULT_FLAGS bits 8-15 reserved/always-0.
     * Aggregate IOP_FAULT_UI_OV covers all 16 channels — no per-channel bit lookup. */
    (void)ch_mask_bit;
    if (fault_flags & IOP_FAULT_UI_OV)
        return 1;   /* OVER_RANGE */
    switch (q) {
        case KX_Q_GOOD:      return 0;   /* NO_FAULT_DETECTED */
        case KX_Q_UNCERTAIN: return 5;   /* COMM_FAILURE (stale) */
        case KX_Q_BAD:       return 5;   /* COMM_FAILURE */
        default:             return 0;
    }
}

static void fill_point(kx_point_t* dst, const Point& p,
                        uint16_t fault_flags, int ch_mask_bit)
{
    dst->value   = p.value;
    dst->quality = static_cast<uint8_t>(p.quality);
    dst->reliability = quality_to_reliability(p.quality, fault_flags, ch_mask_bit);
    /* priority[16] + relinquish_default: BACnet server (iobus) bảo trì riêng.
     * core không ghi các field này — để BACnet server tự đọc từ bộ nhớ nội bộ. */
}

void BacnetObjTable::publish(const PointTable& table,
                              uint32_t scan_count, uint32_t scan_overrun,
                              uint16_t fault_flags, uint8_t /*iop_status*/)
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    shm_->ts_ns = now_ns();
    for (int i = 0; i < KX_N_UI; i++)
        fill_point(&shm_->ai[i],  table.get({PointKind::AI,  i}), fault_flags, i);
    for (int i = 0; i < KX_N_DI; i++)
        fill_point(&shm_->bi[i],  table.get({PointKind::BI,  i}), 0, 0);
    for (int i = 0; i < KX_N_AO; i++)
        fill_point(&shm_->ao[i],  table.get({PointKind::AO,  i}), fault_flags, 0);
    for (int i = 0; i < KX_N_DO; i++)
        fill_point(&shm_->bo[i],  table.get({PointKind::BO,  i}), 0, 0);
    for (int i = 0; i < KX_N_AV; i++)
        fill_point(&shm_->av[i],  table.get({PointKind::AV,  i}), 0, 0);
    for (int i = 0; i < KX_N_BV; i++)
        fill_point(&shm_->bv[i],  table.get({PointKind::BV,  i}), 0, 0);
    for (int i = 0; i < KX_N_MSV; i++)
        fill_point(&shm_->msv[i], table.get({PointKind::MSV, i}), 0, 0);
    shm_->plc_running  = 1;
    shm_->scan_count   = scan_count;
    shm_->scan_overrun = scan_overrun;
    KX_WRITE_END(shm_);
}

/* MOD-009: nhận ext snapshot từ fieldbus.sock SOCK_DGRAM.
 * Nếu không có datagram → dùng ext[] cũ (core giữ nguyên, stale theo ts_ns).
 * setpoint/dirty GIỮ NGUYÊN trong ext[] (core đã ghi ở bước trước). */
void BacnetObjTable::read_ext(int sockfd)
{
    if (!shm_ || sockfd < 0) return;
    kx_ext_snapshot_msg_t msg;
    const ssize_t n = ::recv(sockfd, &msg, sizeof(msg), MSG_DONTWAIT);
    if (n < static_cast<ssize_t>(sizeof(uint32_t) + sizeof(uint16_t) + sizeof(uint16_t)))
        return;
    if (msg.magic != KX_EXT_SNAP_MAGIC) {
        std::fprintf(stderr, "WARN  ext_snap.bad_magic got=0x%08x\n", msg.magic);
        return;
    }
    const uint16_t cnt = (msg.count < KX_N_EXT) ? msg.count : static_cast<uint16_t>(KX_N_EXT);
    KX_WRITE_BEGIN(shm_);
    shm_->ext_count = cnt;
    for (uint16_t i = 0; i < cnt; i++) {
        shm_->ext[i].value      = msg.points[i].value;
        shm_->ext[i].quality    = msg.points[i].quality;
        shm_->ext[i].online     = msg.points[i].online;
        shm_->ext[i].slave_addr = msg.points[i].slave_addr;
        shm_->ext[i].writable   = msg.points[i].writable;
        std::memcpy(shm_->ext[i].name, msg.points[i].name, 24);
        /* setpoint/dirty GIỮ NGUYÊN — core là writer duy nhất của 2 field này */
    }
    KX_WRITE_END(shm_);
}

} // namespace core
