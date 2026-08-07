/**
 * @file  point_writer.hpp
 * @brief Đường ghi DÙNG CHUNG cho mọi nguồn điều khiển ghi vào point ảo và
 *        điểm mở rộng (P1-02, yêu cầu kiến trúc của CTO khi duyệt QĐ-7).
 *
 *        Trước bản này, ghi một điểm EXT cần HAI bước — `table.set_virtual()`
 *        rồi `shm->ext[idx].setpoint` + `dirty = 1` — và chỉ đường lệnh tay
 *        trong scan_loop làm đủ. `ScheduleRuntime` chỉ làm bước một, nên lệnh
 *        lịch cho điểm Modbus chết lặng: giao diện báo OK, thiết bị không nhận
 *        gì.
 *
 *        Sửa bằng cách gom hai bước vào MỘT chỗ mà mọi nguồn cùng gọi, thay vì
 *        cho mỗi nguồn tự dựng đường riêng:
 *
 *            Nguồn (lịch / web / logic)
 *                → PointWriter
 *                → PointTable  +  plc_shm.ext[].setpoint/dirty
 *                → IOBus → thiết bị Modbus RTU
 *
 *        Quy tắc: KHÔNG nguồn nào được gọi thẳng `table.set_virtual()` cho EXT
 *        nữa. Thêm một đường ghi riêng là thêm một chỗ để quên một bước.
 *
 *        AO/BO vẫn đi qua `PriorityResolver` như cũ — lớp này chỉ lo point ảo
 *        và điểm mở rộng, là những thứ không có priority array.
 */
#ifndef CORE_POINT_WRITER_HPP
#define CORE_POINT_WRITER_HPP

#include "graph/point_table.hpp"
#include "mkddc_shm.h"

namespace core {

class PointWriter {
public:
    /* `shm` có thể là nullptr (test, hoặc chưa attach SHM). Khi đó ghi EXT vẫn
     * cập nhật point table nhưng KHÔNG tới được thiết bị, và write() trả false
     * để nguồn gọi biết mà báo lỗi thay vì tưởng đã xong. */
    PointWriter(PointTable& table, kx_plc_shm_t* shm) : table_(table), shm_(shm) {}

    /* Ghi một point ảo hoặc điểm mở rộng.
     * EXT: ngoài point table còn đặt setpoint + dirty để iobus đẩy xuống bus.
     * Trả false nếu point không hợp lệ, hoặc EXT mà không có SHM để ghi. */
    bool write(PointId id, float value, PointSource source);

    /* Nhả quyền ghi: GIỮ value, chỉ trả source về DEFAULT (point ảo không có
     * priority array nên release ≠ ghi giá trị). Với EXT thì KHÔNG đặt dirty —
     * nhả quyền không phải là ra thêm một lệnh xuống thiết bị. */
    bool release(PointId id);

    bool can_write_ext() const { return shm_ != nullptr; }

private:
    PointTable& table_;
    kx_plc_shm_t* shm_;
};

} // namespace core

#endif /* CORE_POINT_WRITER_HPP */
