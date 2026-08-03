/**
 * @file  st_process_image.hpp
 * @brief Cầu nối giữa process image của SOM (PointTable/PriorityResolver) và
 *        không gian slot của chương trình ST.
 *
 *        Đây là chỗ duy nhất hai thế giới gặp nhau, nên mọi luật biên nằm ở
 *        đây chứ không rải rác:
 *
 *        - Đầu vào chỉ nạp MỘT LẦN ở đầu tick, từ snapshot đã chụp — không đọc
 *          lại giữa chừng, nên mọi Program trong tick nhìn thấy cùng một ảnh.
 *        - Đầu ra KHÔNG ghi thẳng ra phần cứng. Nó đi vào PriorityResolver ở
 *          mức PRIO_LOCAL_LOGIC, rồi mới qua trọng tài ưu tiên và safe-state.
 *          Nhờ vậy chương trình ST KHÔNG THỂ vượt mặt manual/BACnet/safety —
 *          bất biến này là cấu trúc, không phải kỷ luật lập trình
 *          (PROGRAM_SOM_FW_DRAFT_DESIGN §8).
 *        - Giá trị không hữu hạn bị chặn tại biên, không để lọt vào đầu ra
 *          analog (ST_SUBSET_SPEC §6.3).
 */
#ifndef CORE_ST_PROCESS_IMAGE_HPP
#define CORE_ST_PROCESS_IMAGE_HPP

#include <cstdint>

#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "st/st_scheduler.hpp"

namespace core {

struct StIoBridgeStats {
    uint32_t inputs_loaded = 0;
    uint32_t outputs_applied = 0;
    uint32_t outputs_rejected = 0;   /* non-finite hoặc ngoài dải */
    uint32_t bindings_unmapped = 0;  /* binding trỏ tới point không tồn tại */
};

/* Nạp đầu vào cho MỘT instance từ point table đã cập nhật trong tick này. */
void st_load_inputs(StProgramInstance* inst, const PointTable& table, StIoBridgeStats* stats);

/* Đẩy đầu ra của MỘT instance vào PriorityResolver ở mức PRIO_LOCAL_LOGIC.
 * Chỉ gọi khi chu kỳ của instance đó chạy THÀNH CÔNG — chương trình fault
 * không được đẩy giá trị nửa vời ra trọng tài. */
void st_apply_outputs(const StProgramInstance& inst, PriorityResolver* resolver,
                      PointTable* table, StIoBridgeStats* stats);

/* Nạp đầu vào cho mọi instance đang RUNNING của mọi task. */
void st_load_all_inputs(StScheduler* sched, const PointTable& table, StIoBridgeStats* stats);

/* Đẩy đầu ra của mọi instance chạy thành công trong tick vừa rồi. */
void st_apply_all_outputs(StScheduler* sched, PriorityResolver* resolver, PointTable* table,
                          StIoBridgeStats* stats);

} // namespace core

#endif /* CORE_ST_PROCESS_IMAGE_HPP */
