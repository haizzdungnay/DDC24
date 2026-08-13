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

#include "graph/point_writer.hpp"
#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "st/st_scheduler.hpp"

namespace core {

struct StIoBridgeStats {
    uint32_t inputs_loaded = 0;
    uint32_t inputs_rejected = 0;
    uint32_t outputs_applied = 0;
    uint32_t outputs_rejected = 0;   /* non-finite hoặc ngoài dải */
    uint32_t bindings_unmapped = 0;  /* binding trỏ tới point không tồn tại */
    uint32_t input_batches_committed = 0;
    uint32_t input_batches_rejected = 0;
    uint32_t output_batches_committed = 0;
    uint32_t output_batches_rejected = 0;
    uint64_t input_snapshot_generation = 0;
    uint64_t output_commit_generation = 0;
};

/* Chụp rồi commit đầu vào cho MỘT instance. Không slot nào đổi nếu bất kỳ
 * binding required nào unmapped, quality != GOOD, non-finite hoặc convert lỗi. */
bool st_load_inputs(StProgramInstance* inst, const PointTable& table, uint64_t generation,
                    StIoBridgeStats* stats);
bool st_load_inputs(StProgramInstance* inst, const PointTable& table,
                    StIoBridgeStats* stats);

/* Preflight toàn bộ output của MỘT instance rồi publish. PointWriter là adapter
 * chung cho VP và MB_RTU/EXT; AO/DO luôn qua PriorityResolver mức 5. */
bool st_apply_outputs(const StProgramInstance& inst, PriorityResolver* resolver,
                      PointWriter* writer, uint64_t generation, StIoBridgeStats* stats);
bool st_apply_outputs(const StProgramInstance& inst, PriorityResolver* resolver,
                      PointTable* table, StIoBridgeStats* stats);

/* Đường ScanLoop: chỉ chụp Task đến hạn, sau safe-boundary activation. */
bool st_capture_due_inputs(StScheduler* sched, const PointTable& table, uint64_t now_ns,
                           StIoBridgeStats* stats);

/* API tương thích test/supporting: nạp mọi instance RUNNING cho generation kế. */
bool st_load_all_inputs(StScheduler* sched, const PointTable& table, StIoBridgeStats* stats);

/* Batch của toàn Task: chỉ instance chạy thành công ở base-step hiện tại được
 * publish; một proposal lỗi hủy toàn bộ batch và giữ contribution trước. */
bool st_apply_all_outputs(StScheduler* sched, PriorityResolver* resolver, PointWriter* writer,
                          StIoBridgeStats* stats);
bool st_apply_all_outputs(StScheduler* sched, PriorityResolver* resolver, PointTable* table,
                          StIoBridgeStats* stats);

} // namespace core

#endif /* CORE_ST_PROCESS_IMAGE_HPP */
