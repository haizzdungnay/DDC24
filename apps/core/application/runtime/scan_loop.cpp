#include "runtime/scan_loop.hpp"

#include "graph/point_writer.hpp"

#include <cstdio>
#include <ctime>

namespace core {

static uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
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
    const ClockSnapshot clock = capture_clock_snapshot();

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

    /* 2. Update point table + quality (kể cả stale check ts_ns) */
    d_.table->update_inputs(last_io_);
    d_.quality->evaluate(*d_.table, last_io_);

    /* Đồng bộ mode thực tế MCU đã ACK trước khi nhận lệnh hoặc chạy graph.
     * Từ đây trở xuống AO luôn là giá trị vật lý V/mA, không phải phần trăm. */
    d_.resolver->set_ao_modes(last_io_.ao_mode);
    d_.graph->set_ao_modes(last_io_.ao_mode);

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

    if (d_.schedules) {
        PointWriter schedule_writer(*d_.table, d_.bacnet ? d_.bacnet->shm() : nullptr);
        d_.schedules->evaluate(clock, last_io_, schedule_writer, *d_.resolver);
    }

    /* 5. Execute graph */
    d_.graph->execute(*d_.table, *d_.resolver);

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
    if (d_.st_sched) {
        st_io_stats_ = StIoBridgeStats{};
        /* Activation phải được áp dụng trước capture: candidate mới không
         * được chạy chu kỳ đầu bằng slot init hoặc process image của bản cũ. */
        d_.st_sched->apply_pending_activations_at_boundary();
        st_capture_due_inputs(d_.st_sched, *d_.table, clock.monotonic_ns,
                              &st_io_stats_);
        st_tick_ = d_.st_sched->on_base_step(clock.monotonic_ns);
        PointWriter program_writer(*d_.table, d_.bacnet ? d_.bacnet->shm() : nullptr);
        st_apply_all_outputs(d_.st_sched, d_.resolver, &program_writer, &st_io_stats_);
    }

    if (d_.alarms)
        d_.alarms->evaluate(*d_.table, clock);

    /* 5a. COR-011: apply Modbus write node setpoints → plc_shm.ext[].dirty.
     * iobus fieldbus thread đọc dirty flag ở chu kỳ poll kế. */
    d_.graph->apply_ext_writes(d_.bacnet->shm());

    /* 6. Resolve priority */
    OutputCmd out = d_.resolver->resolve();

    /* 7. Safe-state có thể ghi đè */
    d_.safe->apply(last_io_, *d_.table, &out);

    /* Physical output is realtime-critical. Publish/serialization is nonessential. */
    d_.writer->write(out);

    d_.web->publish_point_snapshot(snapshot_publisher_.build(
        next_snapshot_id_++, static_cast<uint64_t>(clock.utc_epoch_ms), clock.monotonic_ns, *d_.table,
        last_io_, out, *d_.resolver, d_.safe->active()));

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

    /* 10. Metrics */
    d_.metrics->end_scan(now_ns() - t0, budget_ns_);
}

void ScanLoop::run(const std::atomic<bool>& shutdown, uint64_t base_step_ns,
                   void (*after_scan)(void*), void* ctx)
{
    budget_ns_ = base_step_ns;
    /* 1 nguồn sự thật cho dt: graph PID/logic tính theo chu kỳ scan THẬT,
     * không theo device.scan_ms khai báo (lệch → graph tự WARN).
     * Làm tròn + sàn 1ms: base step sub-ms không được truncate về 0 (0 = silent skip). */
    uint32_t actual_ms = static_cast<uint32_t>((base_step_ns + 500000ull) / 1000000ull);
    if (actual_ms == 0) actual_ms = 1;
    d_.graph->sync_actual_scan_ms(actual_ms);
    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);

    uint64_t expected_ns = static_cast<uint64_t>(next.tv_sec) * 1000000000ull + next.tv_nsec;
    uint64_t jitter_count = 0;
    int64_t max_jitter_ns = 0;
    int64_t min_jitter_ns = -1;
    int64_t sum_jitter_ns = 0;
    uint64_t last_stats_print = expected_ns;

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

        uint64_t actual_ns = now_ns();
        int64_t jitter_ns = static_cast<int64_t>(actual_ns) - static_cast<int64_t>(expected_ns);
        int64_t abs_jitter_ns = jitter_ns < 0 ? -jitter_ns : jitter_ns;

        if (abs_jitter_ns > max_jitter_ns) max_jitter_ns = abs_jitter_ns;
        if (min_jitter_ns < 0 || abs_jitter_ns < min_jitter_ns) min_jitter_ns = abs_jitter_ns;
        sum_jitter_ns += abs_jitter_ns;
        jitter_count++;

        if (actual_ns - last_stats_print > 60000000000ull) {
            std::fprintf(stderr, "INFO  core.jitter min_us=%.2f max_us=%.2f avg_us=%.2f overruns=%u count=%lu\n",
                         min_jitter_ns / 1000.0, max_jitter_ns / 1000.0,
                         (sum_jitter_ns / (double)jitter_count) / 1000.0,
                         d_.metrics->scan_overrun(), jitter_count);
            last_stats_print = actual_ns;
            max_jitter_ns = 0;
            min_jitter_ns = -1;
            sum_jitter_ns = 0;
            jitter_count = 0;
        }

        step();
        if (after_scan) after_scan(ctx);

        /* 11. Sleep tới scan kế — mốc TUYỆT ĐỐI, không drift */
        next.tv_nsec += static_cast<long>(base_step_ns % 1000000000ull);
        next.tv_sec += static_cast<time_t>(base_step_ns / 1000000000ull);
        if (next.tv_nsec >= 1000000000L) {
            next.tv_nsec -= 1000000000L;
            next.tv_sec += 1;
        }
        expected_ns = static_cast<uint64_t>(next.tv_sec) * 1000000000ull + next.tv_nsec;
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, nullptr);
    }
}

void ScanLoop::set_reload_hook(std::atomic<bool>* flag, void (*fn)(void*), void* ctx)
{
    reload_flag_ = flag;
    reload_fn_ = fn;
    reload_ctx_ = ctx;
}

} // namespace core
