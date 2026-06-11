#include "bacnet_objtable.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

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

static void fill(kx_point_t* dst, const Point& p)
{
    dst->value = p.value;
    dst->quality = static_cast<uint8_t>(p.quality);
    /* STUB: bỏ priority array / relinquish_default / reliability chi tiết */
}

void BacnetObjTable::publish(const PointTable& table, uint32_t scan_count, uint32_t scan_overrun)
{
    if (!shm_) return;
    KX_WRITE_BEGIN(shm_);
    shm_->ts_ns = now_ns();
    for (int i = 0; i < KX_N_UI; i++)  fill(&shm_->ai[i],  table.get({PointKind::AI, i}));
    for (int i = 0; i < KX_N_DI; i++)  fill(&shm_->bi[i],  table.get({PointKind::BI, i}));
    for (int i = 0; i < KX_N_AO; i++)  fill(&shm_->ao[i],  table.get({PointKind::AO, i}));
    for (int i = 0; i < KX_N_DO; i++)  fill(&shm_->bo[i],  table.get({PointKind::BO, i}));
    for (int i = 0; i < KX_N_AV; i++)  fill(&shm_->av[i],  table.get({PointKind::AV, i}));
    for (int i = 0; i < KX_N_BV; i++)  fill(&shm_->bv[i],  table.get({PointKind::BV, i}));
    for (int i = 0; i < KX_N_MSV; i++) fill(&shm_->msv[i], table.get({PointKind::MSV, i}));
    shm_->plc_running = 1;
    shm_->scan_count = scan_count;
    shm_->scan_overrun = scan_overrun;
    KX_WRITE_END(shm_);
}

} // namespace core
