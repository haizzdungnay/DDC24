#include "scan_loop.hpp"

#include <cstdio>
#include <ctime>

namespace core {

static uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

void ScanLoop::step()
{
    const uint64_t t0 = now_ns();

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
        if (d_.reader->attached()) {
            kx_io_shm_t* shm = d_.reader->shm();
            if (shm && __atomic_load_n(&shm->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) {
                std::fprintf(stderr, "WARN  iobus_reader.magic_invalid -> detaching (will retry attach)\n");
                d_.reader->detach();
            }
        }
    }

    /* 2. Update point table + quality (kể cả stale check ts_ns) */
    d_.table->update_inputs(last_io_);
    d_.quality->evaluate(*d_.table, last_io_);

    /* 3. Read Modbus ext snapshot từ fieldbus.sock (MOD-009).
     * SOCK_DGRAM MSG_DONTWAIT — nếu không có datagram: dùng ext[] cũ (stale theo ts_ns). */
    d_.bacnet->read_ext(d_.fieldbus_sockfd);

    /* 4. Read web/BACnet command queue.
     * source=manual → PRIO_LOCAL_MANUAL (mức 2); source=bacnet → PRIO_BACNET (mức 3).
     * Response trả SAU resolve + safe-state (bước 7b): applied_value/active_source
     * là giá trị THẬT sau khi mọi nguồn tranh chấp xong (07 §8, BAC-CONFLICT-001). */
    pending_.clear();
    for (const WebCommand& cmd : d_.web->drain()) {
        const int prio = cmd.prio;   /* 2=manual, 3=bacnet */
        bool ok = true;
        if (cmd.point.kind == PointKind::AO) {
            if (cmd.is_write) ok = d_.resolver->set_ao(prio, cmd.point.idx, cmd.value);
            else              ok = d_.resolver->release_ao(prio, cmd.point.idx);
        } else if (cmd.point.kind == PointKind::BO) {
            if (cmd.is_write) ok = d_.resolver->set_do(prio, cmd.point.idx, cmd.value != 0.0f);
            else              ok = d_.resolver->release_do(prio, cmd.point.idx);
        } else {
            /* AV/BV/MSV: ghi thẳng point table (không phải output vật lý);
             * release GIỮ value, chỉ nhả source — KHÔNG ghi cmd.value */
            if (cmd.is_write) ok = d_.table->set_virtual(cmd.point, cmd.value, PointSource::WEB);
            else              ok = d_.table->release_virtual(cmd.point);
        }
        pending_.push_back({cmd, ok});
    }

    /* 5. Execute graph */
    d_.graph->execute(*d_.table, *d_.resolver);

    /* 6. Resolve priority */
    OutputCmd out = d_.resolver->resolve();

    /* 7. Safe-state có thể ghi đè */
    d_.safe->apply(last_io_, *d_.table, &out);

    /* 7b. Respond web/BACnet command theo output THẬT.
     * Overridden khi: safe-state active OR nguồn cao hơn cmd.prio đang thắng (07 §8). */
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
            if (d_.safe->active()) {
                if (cmd.is_write)
                    d_.web->respond_overridden(cmd, applied, "safety");
                else
                    d_.web->respond_accepted(cmd, applied, "safety");
            } else {
                const int lv = is_ao ? d_.resolver->winning_ao_level(cmd.point.idx)
                                     : d_.resolver->winning_do_level(cmd.point.idx);
                if (cmd.is_write && lv != cmd.prio)
                    d_.web->respond_overridden(cmd, applied, prio_source_name(lv));
                else
                    d_.web->respond_accepted(cmd, applied, prio_source_name(lv));
            }
        } else {
            /* virtual point: không có nguồn vật lý tranh chấp */
            const char* vsrc = prio_source_name(cmd.prio);
            d_.web->respond_accepted(cmd, d_.table->get(cmd.point).value, vsrc);
        }
    }

    /* 8. Write output command (atomic, 2 field core sở hữu) */
    d_.writer->write(out);

    /* 9. Publish BACnet object table — value/quality/reliability (BAC-004) */
    d_.bacnet->publish(*d_.table, d_.metrics->scan_count(), d_.metrics->scan_overrun(),
                       last_io_.fault_flags, last_io_.iop_status);

    /* 10. Metrics */
    d_.metrics->end_scan(now_ns() - t0, budget_ns_);
}

void ScanLoop::run(const std::atomic<bool>& shutdown, uint64_t period_ns,
                   void (*after_scan)(void*), void* ctx)
{
    budget_ns_ = period_ns;
    /* 1 nguồn sự thật cho dt: graph PID/logic tính theo chu kỳ scan THẬT,
     * không theo device.scan_ms khai báo (lệch → graph tự WARN).
     * Làm tròn + sàn 1ms: period sub-ms không được truncate về 0 (0 = silent skip). */
    uint32_t actual_ms = static_cast<uint32_t>((period_ns + 500000ull) / 1000000ull);
    if (actual_ms == 0) actual_ms = 1;
    d_.graph->sync_actual_scan_ms(actual_ms);
    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);
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
        step();
        if (after_scan) after_scan(ctx);

        /* 11. Sleep tới scan kế — mốc TUYỆT ĐỐI, không drift */
        next.tv_nsec += static_cast<long>(period_ns % 1000000000ull);
        next.tv_sec += static_cast<time_t>(period_ns / 1000000000ull);
        if (next.tv_nsec >= 1000000000L) {
            next.tv_nsec -= 1000000000L;
            next.tv_sec += 1;
        }
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
