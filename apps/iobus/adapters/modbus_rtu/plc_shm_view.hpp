/**
 * @file  plc_shm_view.hpp
 * @brief G7 (EV-PROG-FBD-ST-MB-20260925): ánh xạ plc_shm GIỮ LÂU cho luồng
 *        `mb-extcmd` soi lệnh EXT mỗi 5 ms.
 *
 * Trước G7, cầu nối ghi chạy trong `fb-publish` mỗi 100 ms và mỗi lượt làm trọn
 * `shm_open` + `mmap` + `munmap`. Ở 5 ms, làm vậy là 600 syscall/s chỉ để nhìn
 * một vùng nhớ vốn không đổi địa chỉ. Lớp này ánh xạ MỘT lần và chỉ kiểm lại
 * danh tính object (dev/inode) theo nhịp `recheck_ms`:
 *
 *  - object bị xoá rồi tạo lại (dọn `/dev/shm` khi deploy, test) ⇒ inode đổi
 *    ⇒ ánh xạ lại, không đọc mãi một object mồ côi;
 *  - object biến mất ⇒ gỡ ánh xạ, trả nullptr (không có Core thì không có lệnh);
 *  - object nhỏ hơn `sizeof(kx_plc_shm_t)` (Core đang dựng dở, layout cũ) ⇒
 *    KHÔNG ánh xạ: đọc quá cuối object là SIGBUS, giết cả iobus lẫn IOP.
 *
 * Magic được kiểm ở MỖI lần `get()`: Core khởi động lại dùng lại object cũ
 * (O_CREAT, không unlink) và ghi magic sau cùng.
 *
 * Không an toàn đa luồng — chỉ luồng `mb-extcmd` gọi.
 */
#ifndef IOBUS_PLC_SHM_VIEW_HPP
#define IOBUS_PLC_SHM_VIEW_HPP

#include <cstdint>
#include <string>
#include <sys/types.h>

#include "mkddc_shm.h"

namespace iobus::fieldbus {

class PlcShmView {
public:
    /* `name` là tên POSIX shm (bắt đầu bằng '/'), ví dụ "/mkddc_plc_shm". */
    explicit PlcShmView(std::string name, uint32_t recheck_ms = 1000);
    ~PlcShmView();
    PlcShmView(const PlcShmView&) = delete;
    PlcShmView& operator=(const PlcShmView&) = delete;

    /* Ảnh plc_shm hợp lệ (đủ kích thước, magic đúng) hoặc nullptr. */
    const kx_plc_shm_t* get(uint64_t now_ms);
    /* Số lần đã ánh xạ (lần đầu + mỗi lần object đổi danh tính). */
    uint64_t map_count() const { return maps_; }
    void reset();

private:
    void revalidate();

    std::string          name_;
    uint32_t             recheck_ms_;
    const kx_plc_shm_t*  shm_ = nullptr;
    dev_t                dev_ = 0;
    ino_t                ino_ = 0;
    bool                 checked_ = false;
    uint64_t             next_check_ms_ = 0;
    uint64_t             maps_ = 0;
};

} // namespace iobus::fieldbus

#endif /* IOBUS_PLC_SHM_VIEW_HPP */
