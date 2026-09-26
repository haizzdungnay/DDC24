/**
 * @file  plc_shm_view.cpp
 * @brief G7: ánh xạ plc_shm giữ lâu — xem plc_shm_view.hpp.
 */
#include "plc_shm_view.hpp"

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <utility>

namespace iobus::fieldbus {

PlcShmView::PlcShmView(std::string name, uint32_t recheck_ms)
    : name_(std::move(name)), recheck_ms_(recheck_ms == 0 ? 1 : recheck_ms)
{
}

PlcShmView::~PlcShmView()
{
    reset();
}

void PlcShmView::reset()
{
    if (shm_) {
        ::munmap(const_cast<kx_plc_shm_t*>(shm_), sizeof(kx_plc_shm_t));
        shm_ = nullptr;
    }
    dev_ = 0;
    ino_ = 0;
}

void PlcShmView::revalidate()
{
    const int fd = ::shm_open(name_.c_str(), O_RDONLY, 0);
    if (fd < 0) {
        reset();
        return;
    }
    struct stat st {};
    if (::fstat(fd, &st) != 0) {
        ::close(fd);
        reset();
        return;
    }
    if (shm_ && st.st_dev == dev_ && st.st_ino == ino_) {
        ::close(fd);   /* vẫn là object đang ánh xạ */
        return;
    }
    if (static_cast<size_t>(st.st_size) < sizeof(kx_plc_shm_t)) {
        ::close(fd);
        reset();
        return;
    }
    void* mem = ::mmap(nullptr, sizeof(kx_plc_shm_t), PROT_READ, MAP_SHARED, fd, 0);
    ::close(fd);
    if (mem == MAP_FAILED) {
        reset();
        return;
    }
    reset();
    shm_ = static_cast<const kx_plc_shm_t*>(mem);
    dev_ = st.st_dev;
    ino_ = st.st_ino;
    maps_++;
}

const kx_plc_shm_t* PlcShmView::get(uint64_t now_ms)
{
    if (!checked_ || now_ms >= next_check_ms_) {
        checked_ = true;
        next_check_ms_ = now_ms + recheck_ms_;
        revalidate();
    }
    if (!shm_) return nullptr;
    if (__atomic_load_n(&shm_->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) return nullptr;
    return shm_;
}

} // namespace iobus::fieldbus
