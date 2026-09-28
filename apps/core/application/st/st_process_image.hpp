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
#include "programming/program_candidate_registry.hpp"
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
    /* TASK-PROG-401: số instance vừa bị rút proposal mức PRIO_LOCAL_LOGIC
     * (release_ao/release_do) ở lần gọi st_withdraw_stale_outputs() gần nhất. */
    uint32_t outputs_withdrawn = 0;
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

/* Issue #798 — giá trị ĐỌC LẠI của điểm mà một binding ĐẦU RA trỏ tới: bảng
 * điểm giữ feedback (AO/DO nội bộ) hoặc giá trị poll gần nhất (Modbus EXT), KHÁC
 * với lệnh Program vừa ghi. Trả false khi binding không map được, điểm không
 * GOOD hoặc giá trị không đổi được về kiểu của biến — "không có số đọc lại" phải
 * hiện là không có, không phải chép lệnh sang. `*age_ms` = tuổi của mẫu điểm tại
 * `now_ns` (bão hoà ở UINT32_MAX). Không cấp phát: gọi được từ đường quét. */
bool st_output_readback(const StIrIoBinding& binding, const PointTable& table, uint64_t now_ns,
                        StCell* value, uint32_t* age_ms);

/* Đường ScanLoop: chỉ chụp Task đến hạn, sau safe-boundary activation.
 * Instance WAITING vẫn phải nhận snapshot input mới để lần retry cùng
 * generation không fault vì dùng ảnh cũ. */
bool st_capture_due_inputs(StScheduler* sched, const PointTable& table, uint64_t now_ns,
                           StIoBridgeStats* stats);

/* API tương thích test/supporting: nạp mọi instance RUNNING hoặc WAITING cho
 * generation kế. */
bool st_load_all_inputs(StScheduler* sched, const PointTable& table, StIoBridgeStats* stats);

/* Batch của toàn Task: chỉ instance chạy thành công ở base-step hiện tại được
 * publish; một proposal lỗi hủy toàn bộ batch và giữ contribution trước. */
bool st_apply_all_outputs(StScheduler* sched, PriorityResolver* resolver, PointWriter* writer,
                          StIoBridgeStats* stats);
bool st_apply_all_outputs(StScheduler* sched, PriorityResolver* resolver, PointTable* table,
                          StIoBridgeStats* stats);

/* TASK-PROG-401, DDD-CTRL-PROG-001 §6: rút proposal mức PRIO_LOCAL_LOGIC
 * (release_ao/release_do) của MỌI output binding AO/DO thuộc instance —
 * AV/BV/MSV/EXT không qua PriorityResolver nên không có gì để rút. Idempotent:
 * gọi lại trên instance đã rút hoặc chưa từng load không lỗi. */
bool st_withdraw_instance_outputs(const StProgramInstance& instance, PriorityResolver* resolver,
                                  PointWriter* writer = nullptr);

/* Chính sách hold-last + rút an toàn cho MỌI instance (DDD-CTRL-PROG-001 §6,
 * ADR-051):
 *  - STOPPED/DISABLED: rút NGAY tại safe boundary, không chờ TTL — lệnh dừng
 *    có chủ ý của operator phải nhả quyền ngay, không giữ mãi.
 *  - Mọi instance ĐÃ từng publish mà lệnh cuối đã già hơn TTL CỦA INSTANCE theo
 *    ĐỒNG HỒ của tick: rút, bất kể trạng thái là FAULTED, ROLLED_BACK hay
 *    RUNNING-trong-Task-bị-disable. TTL đo tuổi của lệnh, không đo trạng thái,
 *    nên trần "không lệnh mức 5 nào sống quá TTL" là tuyệt đối.
 *  - ADR-061 4.4: TTL của instance = max(`hold_ttl_ns`, 2 × chu kỳ Program) —
 *    `hold_ttl_ns` là SÀN (60 s đã ký hoặc `--program-hold-ttl-ms`), Program
 *    50 000 ms được 100 s. Xem `st_hold_ttl::instance_ttl_ns`.
 *  - `hold_ttl_ns == 0` TẮT TTL (giữ vô hạn). Sau ADR-051 đây chỉ còn là
 *    affordance cho test/chẩn đoán: bootstrap sản phẩm LUÔN truyền giá trị đã
 *    ký `st_hold_ttl::kSignedTtlNs` (60 s).
 * Trả về số instance vừa bị rút ở lần gọi này; gọi lại trên instance đã rút
 * là no-op (outputs_withdrawn chặn double-release). */
uint32_t st_withdraw_stale_outputs(StScheduler* scheduler, PriorityResolver* resolver,
                                   uint64_t hold_ttl_ns, StIoBridgeStats* stats);

/* T59-406 — bản có SỔ ĐĂNG KÝ. Cùng chính sách rút, nhưng ghi thêm LÝ DO vào
 * `programming::ProgramCandidateRegistry` để câu hỏi "vì sao van này về default"
 * có câu trả lời. `registry == nullptr` cho hành vi y hệt bản trên. */
uint32_t st_withdraw_stale_outputs(StScheduler* scheduler, PriorityResolver* resolver,
                                   uint64_t hold_ttl_ns,
                                   programming::ProgramCandidateRegistry* registry,
                                   StIoBridgeStats* stats);

/* F06 (EV-PROG-FBD-ST-MB-20260925) — cùng chính sách rút, thêm nhả lệnh EXT về
 * `safe_value` qua `writer` cho instance ĐÃ từng publish output trong đời tiến
 * trình này. Instance chưa từng publish (ví dụ mọi Program lúc Core khởi động ở
 * DISABLED) KHÔNG nhả EXT: nhả ở đó sẽ giật mọi DO Modbus về safe ở mỗi lần
 * Core khởi động lại, trước khi intent kịp bật Program trở lại. */
uint32_t st_withdraw_stale_outputs(StScheduler* scheduler, PriorityResolver* resolver,
                                   uint64_t hold_ttl_ns,
                                   programming::ProgramCandidateRegistry* registry,
                                   PointWriter* writer, StIoBridgeStats* stats);

/* F20 (EV-PROG-FBD-ST-MB-20260925) — kết quả rút claim của các instance vừa RỜI
 * topology ở safe boundary đổi gói. Chỉ để log và test đọc lại. */
struct StReplacedOutputs {
    uint32_t retired_instances = 0; /* instance rời topology còn giữ claim */
    uint32_t released_ao = 0;       /* claim mức 5 đang active vừa được nhả */
    uint32_t released_do = 0;
    uint32_t released_ext = 0;      /* lệnh EXT vừa nhả về `safe_value` */
    uint32_t handed_over = 0;       /* điểm gói mới cũng nắm: giữ nguyên, không nhả */
};

/* F20 — gọi ĐÚNG MỘT lần tại safe boundary vừa đổi topology (Commission, Restore,
 * hoặc rollback chu kỳ đầu), trước khi Program nào của topology mới chạy và
 * trước khi `retired` bị huỷ ở luồng non-RT.
 *
 * `retired` là tập instance vừa rời scheduler; `live` là scheduler đã mang
 * topology mới. Một điểm AO/DO/EXT của instance đã rời được coi là GÓI MỚI NẮM
 * khi `live_publishes` (owner hiện hành là `PROGRAM_ONLY`) và có instance
 * `RUNNING` của topology mới khai nó là output:
 *  - Gói mới nắm: KHÔNG nhả. Instance mới publish điểm đó ngay trong scan này
 *    (Program có intent Enable chạy tại boundary kích hoạt, ADR-062). Nhả rồi
 *    claim lại trong cùng scan cho iobus (soi `ext_cmd_seq` mỗi 5 ms) một cửa sổ
 *    `dirty=0` để phát `safe_value` lên dây — glitch. Instance mới kế thừa mốc
 *    publish của lệnh đang nằm trong resolver/slot EXT, để TTL (ADR-051) và nhánh
 *    nhả EXT của F06 tính đúng tuổi lệnh nếu nó không kịp publish.
 *  - Gói mới không nắm: AO/DO nhả mức PRIO_LOCAL_LOGIC để tầng dưới (manual/
 *    BMS/schedule/default/T7) quyết định, như khi Disable. EXT mà instance cũ ĐÃ
 *    publish được nhả qua `PointWriter::release_ext_command` (`dirty=0` + seq
 *    mới): iobus ghi `safe_value`, điểm không khai thì giữ giá trị cuối kèm WARN.
 * AV/BV/MSV không qua PriorityResolver nên không có gì để rút (§6).
 *
 * Không cấp phát, không lock: bảng chủ sở hữu là mảng cố định theo SHM contract. */
StReplacedOutputs st_withdraw_replaced_outputs(StPreparedProgramSet* retired,
                                               StScheduler* live, bool live_publishes,
                                               PriorityResolver* resolver,
                                               PointWriter* writer) noexcept;

/* Đăng ký toàn bộ output binding AO/DO của một instance vào sổ. Gọi khi Program
 * bắt đầu chạy; trả false + `*error` khi một điểm đã thuộc Program KHÁC — bất
 * biến "một output, một owner" của DDD §4.6, ép lại ở runtime vì gói có thể tới
 * từ bundle import chứ không chỉ từ Check. */
bool st_register_instance_candidates(const StProgramInstance& instance,
                                     programming::ProgramCandidateRegistry* registry,
                                     uint64_t generation, std::string* error);

} // namespace core

#endif /* CORE_ST_PROCESS_IMAGE_HPP */
