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
    KX_WRITE_BEGIN(shm_);
    const bool new_command = source == PointSource::WEB ||
        !shm_->ext[id.idx].dirty || shm_->ext[id.idx].setpoint != value;
    shm_->ext[id.idx].setpoint = value;
    shm_->ext[id.idx].dirty = 1;
    if (new_command) {
        uint32_t& seq = shm_->ext_cmd_seq[id.idx];
        if (++seq == 0) ++seq; /* 0 dành cho "chưa có lệnh" kể cả khi wrap. */
    }
    KX_WRITE_END(shm_);
    return true;
}

bool PointWriter::release(PointId id)
{
    return table_.release_virtual(id);
}

bool PointWriter::release_ext_command(PointId id)
{
    if (id.kind != PointKind::EXT || shm_ == nullptr || id.idx >= shm_->ext_count) return false;
    (void)table_.release_virtual(id);
    KX_WRITE_BEGIN(shm_);
    shm_->ext[id.idx].dirty = 0;
    uint32_t& seq = shm_->ext_cmd_seq[id.idx];
    if (++seq == 0) ++seq; /* 0 dành cho "chưa có lệnh" kể cả khi wrap. */
    KX_WRITE_END(shm_);
    return true;
}

} // namespace core
