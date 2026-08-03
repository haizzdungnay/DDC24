/**
 * @file  st_exec.hpp
 * @brief Thực thi Typed IR đã load. Đây là code chạy TRONG vòng điều khiển
 *        SCHED_FIFO, nên ràng buộc quan trọng nhất không phải tốc độ mà là:
 *
 *          KHÔNG cấp phát. KHÔNG file I/O. KHÔNG network I/O. KHÔNG parse.
 *          KHÔNG tra biến bằng chuỗi.
 *
 *        (PROGRAM_SOM_FW_DRAFT_DESIGN §7.2)
 *
 *        Executor KHÔNG kiểm biên: loader đã chứng minh mọi slot, mọi đích
 *        nhảy, mọi chỉ số FB nằm trong biên (TYPED_IR_ARTIFACT_SPEC §6.1).
 *        Nhờ vậy vòng thực thi chỉ còn switch trên opcode.
 */
#ifndef CORE_ST_EXEC_HPP
#define CORE_ST_EXEC_HPP

#include <cstdint>
#include <string>

#include "st/st_loader.hpp"

namespace core {

struct StExecFault {
    bool        faulted = false;
    const char* code = nullptr;   /* ST-RT-* (hằng tĩnh, không cấp phát) */
    uint32_t    pc = 0;
    int         line = 0;
    int         column = 0;
};

/* Chạy trọn một chu kỳ chương trình.
 *
 * `now_ns` là mốc đồng hồ đơn điệu CHỤP MỘT LẦN ở đầu tick và dùng chung cho
 * mọi Program/FB trong tick đó (PROGRAM_TASK_SCHEDULER_SPEC §4) — nhờ vậy hai
 * timer khởi động cùng tick sẽ hết hạn cùng tick, tất định và tái lập được.
 *
 * Trả true nếu chạy tới HALT không lỗi. Trả false + *fault khi có runtime
 * fault; khi đó CALLER PHẢI HUỶ staging và không commit output nào. */
bool execute_st_program(StLoadedProgram* prog, int64_t now_ns, StExecFault* fault);

} // namespace core

#endif /* CORE_ST_EXEC_HPP */
