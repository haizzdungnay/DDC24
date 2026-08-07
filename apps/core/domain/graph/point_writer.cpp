#include "graph/point_writer.hpp"

namespace core {

bool PointWriter::write(PointId id, float value, PointSource source)
{
    if (!table_.set_virtual(id, value, source)) return false;

    if (id.kind != PointKind::EXT) return true;

    /* Điểm mở rộng chỉ thật sự tới thiết bị khi iobus thấy cờ dirty. Thiếu bước
     * này thì point table đúng mà thiết bị vẫn giữ giá trị cũ — sai lặng lẽ,
     * kiểu sai tệ nhất vì không ai đi tìm. */
    if (!shm_ || id.idx < 0 || id.idx >= KX_N_EXT) return false;
    shm_->ext[id.idx].setpoint = value;
    shm_->ext[id.idx].dirty = 1;
    return true;
}

bool PointWriter::release(PointId id)
{
    return table_.release_virtual(id);
}

} // namespace core
