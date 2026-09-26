#include "runtime/scan_loop.hpp"

#include "graph/point_writer.hpp"
#include "st/st_runtime_snapshot.hpp"

#include <cerrno>
#include <cstdio>
#include <ctime>

namespace core {

static uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

const char* scan_phase_name(ScanPhase phase)
{
    switch (phase) {
    case ScanPhase::IO_READ: return "io";
    case ScanPhase::IPC_DRAIN: return "ipc";
    case ScanPhase::SCHEDULES: return "sched";
    case ScanPhase::LOGIC: return "logic";
    case ScanPhase::ALARMS: return "alarm";
    case ScanPhase::EXT_WRITES: return "ext";
    case ScanPhase::OUTPUT: return "out";
    case ScanPhase::PUBLISH: return "publish";
    case ScanPhase::COUNT: break;
    }
    return "?";
}

uint64_t ScanLoop::monotonic_now() const
{
    return time_.monotonic_ns != nullptr ? time_.monotonic_ns(time_.ctx) : now_ns();
}

/* ADR-061 4.10 — đo WCET của một bước bằng đồng hồ THẬT (không phải đồng hồ
 * tiêm của test): đây là số đo thời gian thực thi, không phải logic. `*mark` là
 * mốc cuối bước trước; hàm ghi thời lượng bước này rồi dời mốc. Không cấp phát. */
void ScanLoop::record_phase(ScanPhase phase, uint64_t* mark)
{
    const uint64_t now = now_ns();
    const uint64_t elapsed = now - *mark;
    *mark = now;
    const std::size_t index = static_cast<std::size_t>(phase);
    wcet_.last_ns[index] = elapsed;
    if (elapsed > wcet_.minute_max_ns[index]) wcet_.minute_max_ns[index] = elapsed;
}

static const char* point_source_name(PointSource source)
{
    switch (source) {
    case PointSource::IO: return "input";
    case PointSource::GRAPH: return "logic";
    case PointSource::PROGRAM: return "program";
    case PointSource::WEB: return "manual";
    case PointSource::BACNET: return "bacnet";
    case PointSource::SCHEDULE: return "schedule";
    case PointSource::MODBUS_RTU: return "modbus_rtu";
    case PointSource::DEFAULT: return "default";
    }
    return "unknown";
}

void ScanLoop::step()
{
    const uint64_t t0 = now_ns();
    uint64_t phase_mark = t0;
    ClockSnapshot clock = capture_clock_snapshot();
    if (time_.monotonic_ns != nullptr) clock.monotonic_ns = time_.monotonic_ns(time_.ctx);

    /* 0. Re-attach: core lên trước iobus quá 30s → main đã thoát vòng retry,
     * scan loop tự thử lại mỗi scan tới khi iobus tạo shm (gap #3 analysis report) */
    if (!d_.reader->attached()) {
        if (d_.reader->attach())
            std::fprintf(stderr, "INFO  iobus_reader.reattached trong scan loop\n");
    }

    /* 1. Read IO state (seqlock) — fail → dùng snapshot cũ + metric */
    IoSnapshot io;
    if (d_.reader->read(&io)) {
        last_io_ = io;
    } else {
        d_.metrics->inc_seqlock_fail();
        if (d_.reader->attached() && !d_.reader->contract_valid()) {
            std::fprintf(stderr, "WARN  iobus_reader.magic_invalid -> detaching (will retry attach)\n");
            d_.reader->detach();
        }
    }

    /* 2. Update point table + quality (kể cả stale check ts_ns). Stale tính
     * theo THỜI GIAN của scan (ADR-061 4.7), không theo số scan. */
    d_.table->update_inputs(last_io_);
    d_.quality->evaluate(*d_.table, last_io_, clock.monotonic_ns);

    /* Đồng bộ mode thực tế MCU đã ACK trước khi nhận lệnh hoặc chạy graph.
     * Từ đây trở xuống AO luôn là giá trị vật lý V/mA, không phải phần trăm. */
    d_.resolver->set_ao_modes(last_io_.ao_mode);
    d_.graph->set_ao_modes(last_io_.ao_mode);

    /* Mở một chu kỳ trọng tài mới TRƯỚC mọi nguồn ghi của scan này (lệnh web/
     * BACnet ở bước 4, schedule, graph bước 5, ST bước 5b). Nhờ vậy cảnh báo
     * `priority.conflict` chỉ nổ khi hai nguồn cùng mức ghi trong CÙNG scan,
     * thay vì nổ mỗi scan chỉ vì một chương trình ghi giá trị biến thiên
     * (F-PRIO-001). */
    d_.resolver->begin_cycle();

    /* 3. Read Modbus ext snapshot từ fieldbus.sock (MOD-009).
     * SOCK_DGRAM MSG_DONTWAIT — nếu không có datagram: dùng ext[] cũ (stale theo ts_ns). */
    d_.bacnet->read_ext(d_.fieldbus_sockfd);

    /* 3a. COR-011: feed ext snapshot vào graph_runtime để Protocol nodes đọc.
     * Chỉ copy khi shm tồn tại và ext_count > 0. */
    {
        const kx_plc_shm_t* shm = d_.bacnet->shm();
        if (shm) {
            d_.table->update_ext(shm->ext, shm->ext_count);
            if (shm->ext_count > 0)
                d_.graph->feed_ext_snapshot(shm->ext, shm->ext_count);
        }
    }
    record_phase(ScanPhase::IO_READ, &phase_mark);

    /* 4. Read web/BACnet command queue.
     * source=manual → PRIO_LOCAL_MANUAL (mức 2); source=bacnet → PRIO_BACNET (mức 3).
     * Response trả SAU resolve + safe-state (bước 7b): applied_value/active_source
     * là giá trị THẬT sau khi mọi nguồn tranh chấp xong (07 §8, BAC-CONFLICT-001). */
    pending_.clear();
    pending_alarm_.clear();
    const uint64_t command_now = now_ns();
    for (int ch = 0; ch < KX_N_AO; ch++) {
        if (manual_ao_expiry_ns_[ch] != 0 && command_now >= manual_ao_expiry_ns_[ch]) {
            (void)d_.resolver->release_ao(PRIO_LOCAL_MANUAL, ch);
            manual_ao_expiry_ns_[ch] = 0;
            std::fprintf(stderr, "AUDIT hmi_override_expired id=%llu user=%s point=AO%d\n",
                         static_cast<unsigned long long>(manual_ao_request_id_[ch]),
                         manual_ao_user_[ch].empty() ? "-" : manual_ao_user_[ch].c_str(), ch + 1);
            manual_ao_request_id_[ch] = 0; manual_ao_user_[ch].clear();
        }
    }
    for (int ch = 0; ch < KX_N_DO; ch++) {
        if (manual_do_expiry_ns_[ch] != 0 && command_now >= manual_do_expiry_ns_[ch]) {
            (void)d_.resolver->release_do(PRIO_LOCAL_MANUAL, ch);
            manual_do_expiry_ns_[ch] = 0;
            std::fprintf(stderr, "AUDIT hmi_override_expired id=%llu user=%s point=DO%d\n",
                         static_cast<unsigned long long>(manual_do_request_id_[ch]),
                         manual_do_user_[ch].empty() ? "-" : manual_do_user_[ch].c_str(), ch + 1);
            manual_do_request_id_[ch] = 0; manual_do_user_[ch].clear();
        }
    }
    for (const WebCommand& cmd : d_.web->drain()) {
        if (cmd.kind != WebCommandKind::Point) {
            pending_alarm_.push_back(cmd);
            continue;
        }
        const int prio = cmd.prio;   /* 2=manual, 3=bacnet */
        bool ok = true;
        if (cmd.is_query) {
            pending_.push_back({cmd, true});
            continue;
        } else if (cmd.point.kind == PointKind::AO) {
            if (cmd.is_write) ok = d_.resolver->set_ao(prio, cmd.point.idx, cmd.value);
            else              ok = d_.resolver->release_ao(prio, cmd.point.idx);
            if (ok && prio == PRIO_LOCAL_MANUAL) {
                manual_ao_expiry_ns_[cmd.point.idx] = cmd.is_write && cmd.ttl_s > 0
                    ? command_now + static_cast<uint64_t>(cmd.ttl_s) * 1000000000ull : 0;
                manual_ao_request_id_[cmd.point.idx] = cmd.ttl_s > 0 ? cmd.id : 0;
                manual_ao_user_[cmd.point.idx] = cmd.ttl_s > 0 ? cmd.user : std::string();
            }
        } else if (cmd.point.kind == PointKind::BO) {
            if (cmd.is_write) ok = d_.resolver->set_do(prio, cmd.point.idx, cmd.value != 0.0f);
            else              ok = d_.resolver->release_do(prio, cmd.point.idx);
            if (ok && prio == PRIO_LOCAL_MANUAL) {
                manual_do_expiry_ns_[cmd.point.idx] = cmd.is_write && cmd.ttl_s > 0
                    ? command_now + static_cast<uint64_t>(cmd.ttl_s) * 1000000000ull : 0;
                manual_do_request_id_[cmd.point.idx] = cmd.ttl_s > 0 ? cmd.id : 0;
                manual_do_user_[cmd.point.idx] = cmd.ttl_s > 0 ? cmd.user : std::string();
            }
        } else {
            /* AV/BV/MSV/EXT: qua đường ghi dùng chung (P1-02). EXT được
             * PointWriter đặt luôn setpoint + dirty, nên ở đây không còn bước
             * riêng nào cho Modbus — trước kia bước đó chỉ có ở nhánh này và
             * ScheduleRuntime thiếu nó.
             * release GIỮ value, chỉ nhả source — KHÔNG ghi cmd.value. */
            PointWriter writer(*d_.table, d_.bacnet ? d_.bacnet->shm() : nullptr);
            if (cmd.is_write) ok = writer.write(cmd.point, cmd.value, PointSource::WEB);
            else              ok = writer.release(cmd.point);
        }
        pending_.push_back({cmd, ok});
    }
    record_phase(ScanPhase::IPC_DRAIN, &phase_mark);

    if (d_.schedules) {
        PointWriter schedule_writer(*d_.table, d_.bacnet ? d_.bacnet->shm() : nullptr);
        d_.schedules->evaluate(clock, last_io_, schedule_writer, *d_.resolver);
    }
    record_phase(ScanPhase::SCHEDULES, &phase_mark);

    if (d_.programming_coordinator)
        d_.programming_coordinator->capture_priority_overrides(*d_.resolver);

    /* TASK-PROG-404: áp owner swap tại đúng một safe boundary. Sau dòng này
     * toàn scan dùng cùng một mode; graph/program không thể cùng publish. */
    if (d_.programming_coordinator) d_.programming_coordinator->on_safe_boundary();
    else if (d_.cutover) (void)d_.cutover->apply_pending_at_boundary();
    const CutoverMode active_mode = d_.cutover ? d_.cutover->current() : d_.mode;

    /* 5. Execute graph — CHỈ khi GRAPH là producer Local logic (TASK-PROG-306,
     * DDD-CTRL-PROG-001 §10: "một Point Local logic không có hai producer").
     * PROGRAM_ONLY tắt hẳn graph.execute() thay vì lọc theo point: Rev A cutover
     * là toàn bộ Local logic, không migrate từng điểm. graph.load()/restore
     * vẫn chạy ở bootstrap nên config/RETAIN graph vẫn là backup immutable cho
     * Restore — chỉ đường XUẤT ra resolver bị khoá, không xoá gì. */
    if (active_mode != CutoverMode::PROGRAM_ONLY) d_.graph->execute(*d_.table, *d_.resolver);

    /* 5b. ACTION 10 — Program Runtime (ST).
     *
     * Vị trí trong chuỗi là có chủ ý: SAU khi point table đã cập nhật (bước 2)
     * và TRƯỚC trọng tài ưu tiên (bước 6). Nhờ vậy đầu ra của chương trình ST
     * đi qua đúng cùng một trọng tài với graph/manual/BACnet/schedule, rồi mới
     * tới safe-state ở bước 7. Chương trình ST KHÔNG có đường tắt nào ra thẳng
     * phần cứng (PROGRAM_SOM_FW_DRAFT_DESIGN §8).
     *
     * `clock.monotonic_ns` chụp MỘT LẦN ở đầu scan và dùng chung cho mọi Task
     * và mọi FB — hai timer khởi động cùng scan sẽ hết hạn cùng scan
     * (PROGRAM_TASK_SCHEDULER_SPEC §4). */
    /* Caller legacy chỉ truyền StScheduler (không có live-cutover object) vẫn
     * giữ hành vi TASK-PROG-302/306 để các embedding hiện hữu không bị tắt ST.
     * Khi coordinator/cutover tồn tại, mode là authority duy nhất. */
    const bool program_owner = active_mode == CutoverMode::PROGRAM_ONLY ||
        (!d_.cutover && !d_.programming_coordinator);
    if (d_.st_sched && program_owner) {
        st_io_stats_ = StIoBridgeStats{};
        /* Activation phải được áp dụng trước capture: candidate mới không
         * được chạy chu kỳ đầu bằng slot init hoặc process image của bản cũ. */
        if (!d_.programming_coordinator)
            d_.st_sched->apply_pending_activations_at_boundary();
        st_capture_due_inputs(d_.st_sched, *d_.table, clock.monotonic_ns,
                              &st_io_stats_);
        st_tick_ = d_.st_sched->on_base_step(clock.monotonic_ns);
        PointWriter program_writer(*d_.table, d_.bacnet ? d_.bacnet->shm() : nullptr);
        /* Đăng ký quyền sở hữu TRƯỚC khi publish: hai Program cùng giữ một
         * output vật lý là hai nguồn sự thật cho cùng một van, và phát hiện điều
         * đó SAU khi đã ghi ra thì đã muộn. */
        if (d_.candidate_registry != nullptr) {
            const uint64_t generation = d_.st_sched->base_step_count();
            for (const auto& task : d_.st_sched->tasks())
                for (const auto& program : task->programs()) {
                    if (program->state != StProgramState::RUNNING) continue;
                    std::string claim_error;
                    (void)st_register_instance_candidates(*program, d_.candidate_registry,
                                                          generation, &claim_error);
                }
        }
        const bool outputs_committed =
            st_apply_all_outputs(d_.st_sched, d_.resolver, &program_writer, &st_io_stats_);
        if (d_.programming_coordinator)
            d_.programming_coordinator->on_output_commit(outputs_committed);
        /* TASK-PROG-401: rút proposal mức 5 cho instance STOPPED/DISABLED
         * (ngay) hoặc FAULTED quá holdTtl (nếu đã cấu hình) — SAU khi outputs
         * vừa publish thành công đã reset outputs_withdrawn ở trên, nên
         * instance vẫn đang chạy tốt không bị rút nhầm. */
        st_withdraw_stale_outputs(d_.st_sched, d_.resolver, d_.program_hold_ttl_ns,
                                  d_.candidate_registry, &program_writer, &st_io_stats_);
        /* Lấy mẫu SAU khi Program đã chạy và output đã publish trong chu kỳ này:
         * mẫu phải là trạng thái đã ổn định của chu kỳ, không phải trạng thái
         * giữa chừng. */
        if (d_.value_trace != nullptr)
            d_.value_trace->on_boundary(*d_.st_sched, clock.monotonic_ns);
    }
    record_phase(ScanPhase::LOGIC, &phase_mark);

    if (d_.alarms)
        d_.alarms->evaluate(*d_.table, clock);
    record_phase(ScanPhase::ALARMS, &phase_mark);

    /* 5a. COR-011: apply Modbus write node setpoints → plc_shm.ext[].dirty.
     * iobus fieldbus thread đọc dirty flag ở chu kỳ poll kế. */
    d_.graph->apply_ext_writes(d_.bacnet->shm());
    record_phase(ScanPhase::EXT_WRITES, &phase_mark);

    /* 6. Resolve priority */
    OutputCmd out = d_.resolver->resolve();

    /* 7. Safe-state có thể ghi đè */
    d_.safe->apply(last_io_, *d_.table, &out);

    /* Physical output is realtime-critical. Publish/serialization is nonessential. */
    d_.writer->write(out);
    record_phase(ScanPhase::OUTPUT, &phase_mark);

    /* Phân biệt safe-state "chưa ai điều khiển" (T7 đơn độc — Commission một
     * Program có output tự giải quyết) khỏi safe-state do lỗi thật (T1/T2/T3/
     * T6/T8 — Commission KHÔNG được coi là an toàn để bỏ qua). Xem
     * safety/safe_state.hpp §5.2 và runtime_point_snapshot.hpp. */
    const SafeState::Triggers& safe_triggers = d_.safe->triggers();
    const bool safe_state_no_controller_only =
        safe_triggers.no_controller && !safe_triggers.iop_fault && !safe_triggers.stale &&
        !safe_triggers.graph_input_bad && !safe_triggers.overrun;
    RuntimePointSnapshot runtime_snapshot = snapshot_publisher_.build(
        next_snapshot_id_++, static_cast<uint64_t>(clock.utc_epoch_ms), clock.monotonic_ns, *d_.table,
        last_io_, out, *d_.resolver, d_.safe->active(), safe_state_no_controller_only);
    /* Task/Program read-back dùng cùng một helper với simulator E2E để đường
     * debug browser không thể trôi khỏi contract chạy thật trên board. */
    st_populate_runtime_snapshot(d_.st_sched, program_owner, &runtime_snapshot);
    /* ADR-061 4.9 — metric C4 của vòng quét đi cùng `task`: đó là nơi API đọc
     * sức khoẻ lập lịch, và một bộ đếm lệch nhịp nằm ở chỗ khác sẽ bị đọc lệch
     * snapshot với `runCount`/`missedReleaseCount` của cùng Task. */
    if (runtime_snapshot.task.present) {
        const BaseStepTimingSnapshot timing = pacer_.snapshot();
        runtime_snapshot.task.base_step_us = timing.base_step_ns / 1000ull;
        runtime_snapshot.task.jitter_max_us = timing.jitter_max_us;
        runtime_snapshot.task.jitter_violation_count = timing.jitter_violation_count;
        runtime_snapshot.task.missed_base_step_count = timing.missed_base_step_count;
    }
    d_.web->publish_point_snapshot(runtime_snapshot);

    for (const WebCommand& cmd : pending_alarm_) {
        if (cmd.kind == WebCommandKind::ScheduleState) {
            /* Trạng thái runtime là sự thật của controller. Không có
             * ScheduleRuntime thì trả danh sách rỗng, KHÔNG bịa. */
            const std::vector<ScheduleState> states =
                d_.schedules ? d_.schedules->states() : std::vector<ScheduleState>{};
            d_.web->respond_schedule_state(cmd, states);
        } else if (cmd.kind == WebCommandKind::AlarmList) {
            const std::vector<AlarmState> states =
                d_.alarms ? d_.alarms->active_states() : std::vector<AlarmState>{};
            d_.web->respond_alarm_list(cmd, states);
        } else if (cmd.kind == WebCommandKind::AlarmAck) {
            if (d_.alarms && d_.alarms->ack(cmd.alarm_id, cmd.duration_s, cmd.permanent))
                d_.web->respond_alarm_ack_accepted(cmd);
            else
                d_.web->respond_rejected(cmd, "unknown_alarm");
        } else if (cmd.kind == WebCommandKind::AlarmSuppress) {
            if (d_.alarms && d_.alarms->suppress(cmd.alarm_id, cmd.duration_s, cmd.permanent))
                d_.web->respond_alarm_suppress_accepted(cmd);
            else
                d_.web->respond_rejected(cmd, "unknown_alarm");
        } else if (cmd.kind == WebCommandKind::AlarmReturn) {
            if (d_.alarms && d_.alarms->return_to_active(cmd.alarm_id))
                d_.web->respond_alarm_return_accepted(cmd);
            else
                d_.web->respond_rejected(cmd, "unknown_alarm");
        }
    }

    /* 7b. Respond web/BACnet command theo output THẬT.
     * Overridden khi: safe-state active OR nguồn cao hơn cmd.prio đang thắng (07 §8). */
    const uint64_t response_now = now_ns();
    for (const PendingResp& p : pending_) {
        if (!p.ok) {
            d_.web->respond_rejected(p.cmd, "bad_request");
            continue;
        }
        const WebCommand& cmd = p.cmd;
        if (cmd.point.kind == PointKind::AO || cmd.point.kind == PointKind::BO) {
            const bool is_ao = cmd.point.kind == PointKind::AO;
            const float applied = is_ao ? out.ao[cmd.point.idx]
                                        : static_cast<float>(out.dout[cmd.point.idx]);
            const uint64_t expiry = is_ao ? manual_ao_expiry_ns_[cmd.point.idx]
                                          : manual_do_expiry_ns_[cmd.point.idx];
            const uint32_t remaining_ttl_s = expiry > response_now
                ? static_cast<uint32_t>((expiry - response_now + 999999999ull) / 1000000000ull) : 0;
            if (d_.safe->active()) {
                if (cmd.is_write)
                    d_.web->respond_overridden(cmd, applied, "safety", remaining_ttl_s);
                else
                    d_.web->respond_accepted(cmd, applied, "safety", remaining_ttl_s);
            } else {
                const int lv = is_ao ? d_.resolver->winning_ao_level(cmd.point.idx)
                                     : d_.resolver->winning_do_level(cmd.point.idx);
                if (cmd.is_write && lv != cmd.prio)
                    d_.web->respond_overridden(cmd, applied, prio_source_name(lv), remaining_ttl_s);
                else
                    d_.web->respond_accepted(cmd, applied, prio_source_name(lv), remaining_ttl_s);
            }
        } else {
            /* virtual point: không có nguồn vật lý tranh chấp */
            const char* vsrc = cmd.is_query ? point_source_name(d_.table->get(cmd.point).source)
                                            : prio_source_name(cmd.prio);
            d_.web->respond_accepted(cmd, d_.table->get(cmd.point).value, vsrc);
        }
    }

    /* 9. Publish BACnet object table — value/quality/reliability (BAC-004) */
    d_.bacnet->publish(*d_.table, d_.metrics->scan_count(), d_.metrics->scan_overrun(),
                       last_io_.fault_flags, last_io_.iop_status, last_io_.ui_reliability);

    record_phase(ScanPhase::PUBLISH, &phase_mark);

    /* 10. Metrics */
    const uint64_t total_ns = phase_mark - t0;
    wcet_.total_last_ns = total_ns;
    if (total_ns > wcet_.total_minute_max_ns) wcet_.total_minute_max_ns = total_ns;
    ++wcet_.minute_scans;
    d_.metrics->end_scan(total_ns, budget_ns_);
}

void ScanLoop::log_minute_stats()
{
    /* `core.jitter` giữ nguyên các trường cũ (tooling đọc log dựa vào chúng),
     * nối thêm metric C4 tích luỹ để log và snapshot nói cùng một con số. */
    const BaseStepJitterMinute& minute = pacer_.minute();
    const BaseStepTimingSnapshot timing = pacer_.snapshot();
    const double avg_us =
        minute.count == 0 ? 0.0 : (static_cast<double>(minute.sum_ns) / minute.count) / 1000.0;
    std::fprintf(stderr,
                 "INFO  core.jitter min_us=%.2f max_us=%.2f avg_us=%.2f overruns=%u count=%llu"
                 " window_max_us=%u violations=%llu missed_steps=%llu base_step_us=%llu\n",
                 minute.min_ns / 1000.0, minute.max_ns / 1000.0, avg_us,
                 d_.metrics->scan_overrun(), static_cast<unsigned long long>(minute.count),
                 timing.jitter_max_us,
                 static_cast<unsigned long long>(timing.jitter_violation_count),
                 static_cast<unsigned long long>(timing.missed_base_step_count),
                 static_cast<unsigned long long>(timing.base_step_ns / 1000ull));
    pacer_.reset_minute();

    /* ADR-061 4.10 bước 1 — WCET từng bước trong phút vừa qua, để quyết định
     * tách việc không-RT ra khỏi luồng quét DỰA TRÊN SỐ ĐO (bước 2). */
    auto us = [](uint64_t ns) { return static_cast<unsigned long long>((ns + 999ull) / 1000ull); };
    const auto& max_ns = wcet_.minute_max_ns;
    std::fprintf(stderr,
                 "INFO  core.step_wcet io_us=%llu ipc_us=%llu sched_us=%llu logic_us=%llu"
                 " alarm_us=%llu ext_us=%llu out_us=%llu publish_us=%llu total_us=%llu"
                 " base_step_us=%llu scans=%llu\n",
                 us(max_ns[static_cast<std::size_t>(ScanPhase::IO_READ)]),
                 us(max_ns[static_cast<std::size_t>(ScanPhase::IPC_DRAIN)]),
                 us(max_ns[static_cast<std::size_t>(ScanPhase::SCHEDULES)]),
                 us(max_ns[static_cast<std::size_t>(ScanPhase::LOGIC)]),
                 us(max_ns[static_cast<std::size_t>(ScanPhase::ALARMS)]),
                 us(max_ns[static_cast<std::size_t>(ScanPhase::EXT_WRITES)]),
                 us(max_ns[static_cast<std::size_t>(ScanPhase::OUTPUT)]),
                 us(max_ns[static_cast<std::size_t>(ScanPhase::PUBLISH)]),
                 us(wcet_.total_minute_max_ns),
                 static_cast<unsigned long long>(timing.base_step_ns / 1000ull),
                 static_cast<unsigned long long>(wcet_.minute_scans));
    wcet_.minute_max_ns.fill(0);
    wcet_.total_minute_max_ns = 0;
    wcet_.minute_scans = 0;
}

void ScanLoop::run(const std::atomic<bool>& shutdown, uint64_t base_step_ns,
                   void (*after_scan)(void*), void* ctx)
{
    budget_ns_ = base_step_ns;
    /* ADR-061 4.7: ngưỡng stale theo thời gian dựa trên base step THẬT. */
    d_.quality->set_base_step_ns(base_step_ns);
    /* 1 nguồn sự thật cho dt: graph PID/logic tính theo chu kỳ scan THẬT,
     * không theo device.scan_ms khai báo (lệch → graph tự WARN).
     * Làm tròn + sàn 1ms: base step sub-ms không được truncate về 0 (0 = silent skip). */
    uint32_t actual_ms = static_cast<uint32_t>((base_step_ns + 500000ull) / 1000000ull);
    if (actual_ms == 0) actual_ms = 1;
    d_.graph->sync_actual_scan_ms(actual_ms);

    uint64_t start_ns = monotonic_now();
    pacer_.start(base_step_ns, start_ns);
    uint64_t last_stats_print = start_ns;

    while (!shutdown.load()) {
        /* SIGHUP reload ở RANH GIỚI scan (COR-008) — config mới chỉ có hiệu lực
         * trọn vẹn từ scan kế, không bao giờ giữa lúc resolve */
        if (reload_flag_ && reload_flag_->exchange(false) && reload_fn_) {
            reload_fn_(reload_ctx_);
            /* BẮT BUỘC gọi ngay sau reload_fn_: GraphRuntime::reload() reset scan_ms_
             * về declared_scan_ms_; nếu thiếu dòng này PID tính dt sai cho 1 scan.
             * Thứ tự: reload_fn_ → sync_actual (CR-006). */
            d_.graph->sync_actual_scan_ms(actual_ms);
        }

        /* ADR-061 C4: lệch đánh thức đo so với mốc TUYỆT ĐỐI của lưới. Trễ >= 1
         * base step thì các mốc đã qua bị bỏ và đếm `missedBaseStepCount`. */
        const uint64_t actual_ns = monotonic_now();
        pacer_.on_wake(actual_ns);

        if (actual_ns - last_stats_print > 60000000000ull) {
            log_minute_stats();
            last_stats_print = actual_ns;
        }

        step();
        if (after_scan) after_scan(ctx);

        /* 11. Sleep tới mốc lưới kế tiếp — TUYỆT ĐỐI, không drift. Step chạy quá
         * một base step thì mốc đã qua bị BỎ, không chạy dồn (SPEC §4): chạy
         * liên tiếp để "bù" làm vòng quét không nghỉ đúng lúc nó đang quá tải. */
        const uint64_t deadline_ns = pacer_.advance(monotonic_now());
        if (time_.sleep_until != nullptr) {
            time_.sleep_until(time_.ctx, deadline_ns);
        } else {
            struct timespec next;
            next.tv_sec = static_cast<time_t>(deadline_ns / 1000000000ull);
            next.tv_nsec = static_cast<long>(deadline_ns % 1000000000ull);
            /* Tín hiệu (SIGHUP reload, SIGTERM) làm clock_nanosleep trả EINTR
             * SỚM. Chạy step ngay lúc đó là một tick lệch lưới do tín hiệu chứ
             * không do đồng hồ; chỉ thoát vòng ngủ khi tới mốc hoặc khi được
             * yêu cầu dừng. */
            while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, nullptr) == EINTR &&
                   !shutdown.load()) {
            }
        }
    }
}

void ScanLoop::set_reload_hook(std::atomic<bool>* flag, void (*fn)(void*), void* ctx)
{
    reload_flag_ = flag;
    reload_fn_ = fn;
    reload_ctx_ = ctx;
}

} // namespace core
