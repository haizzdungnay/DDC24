#include "graph/point_writer.hpp"

#include <cmath>

namespace core {

bool PointWriter::can_write(PointId id, float value) const
{
    if (!std::isfinite(value) || !PointTable::valid(id)) return false;
    if (id.kind != PointKind::AV && id.kind != PointKind::BV &&
        id.kind != PointKind::MSV && id.kind != PointKind::EXT)
        return false;
    if (id.kind != PointKind::EXT) return true;
    /* EXT output phải bám catalog active trong SHM: slot ngoài ext_count
     * hoặc Point read-only không được tạo dirty command. */
    return shm_ != nullptr && id.idx < shm_->ext_count && shm_->ext[id.idx].writable != 0;
}

bool PointWriter::write(PointId id, float value, PointSource source)
{
    /* Phải preflight trước set_virtual(): bản cũ sửa PointTable rồi mới phát
     * hiện EXT thiếu SHM, khiến caller nhận false nhưng state đã thay đổi. */
    if (!can_write(id, value)) return false;
    if (!table_.set_virtual(id, value, source)) return false;

    if (id.kind != PointKind::EXT) return true;

    /* Điểm mở rộng chỉ thật sự tới thiết bị khi iobus thấy cờ dirty. Thiếu bước
     * này thì point table đúng mà thiết bị vẫn giữ giá trị cũ — sai lặng lẽ,
     * kiểu sai tệ nhất vì không ai đi tìm. */
    shm_->ext[id.idx].setpoint = value;
    shm_->ext[id.idx].dirty = 1;
    return true;
}

bool PointWriter::release(PointId id)
{
    return table_.release_virtual(id);
}

} // namespace core
