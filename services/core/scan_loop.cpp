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
    if (d_.reader->read(&io))
        last_io_ = io;
    else
        d_.metrics->inc_seqlock_fail();

    /* 2. Update point table + quality (kể cả stale check ts_ns) */
    d_.table->update_inputs(last_io_);
    d_.quality->evaluate(*d_.table, last_io_);

    /* 3. Read Modbus cache — Rev A.1, bỏ qua */

    /* 4. Read web command queue → priority mức 2 (manual) */
    for (const WebCommand& cmd : d_.web->drain()) {
        bool ok = true;
        if (cmd.point.kind == PointKind::AO) {
            if (cmd.is_write) d_.resolver->set_ao(PRIO_LOCAL_MANUAL, cmd.point.idx, cmd.value);
            else              d_.resolver->release_ao(PRIO_LOCAL_MANUAL, cmd.point.idx);
        } else if (cmd.point.kind == PointKind::BO) {
            if (cmd.is_write) d_.resolver->set_do(PRIO_LOCAL_MANUAL, cmd.point.idx, cmd.value != 0.0f);
            else              d_.resolver->release_do(PRIO_LOCAL_MANUAL, cmd.point.idx);
        } else {
            /* AV/BV/MSV: ghi thẳng point table (không phải output vật lý);
             * release GIỮ value, chỉ nhả source — KHÔNG ghi cmd.value */
            if (cmd.is_write) ok = d_.table->set_virtual(cmd.point, cmd.value, PointSource::WEB);
            else              ok = d_.table->release_virtual(cmd.point);
        }
        if (ok) {
            /* applied_value = giá trị thực sau xử lý (release ≠ cmd.value) */
            const float applied = cmd.is_write ? cmd.value
                                               : d_.table->get(cmd.point).value;
            d_.web->respond_accepted(cmd, applied);
        } else {
            d_.web->respond_rejected(cmd, "bad_request");
        }
    }

    /* 5. Execute graph (STUB: no-op) */
    d_.graph->execute(*d_.table, *d_.resolver);

    /* 6. Resolve priority */
    OutputCmd out = d_.resolver->resolve();

    /* 7. Safe-state có thể ghi đè */
    d_.safe->apply(last_io_, *d_.table, &out);

    /* 8. Write output command (atomic, 2 field core sở hữu) */
    d_.writer->write(out);

    /* 9. Publish BACnet object table (STUB: value/quality) */
    d_.bacnet->publish(*d_.table, d_.metrics->scan_count(), d_.metrics->scan_overrun());

    /* 10. Metrics */
    d_.metrics->end_scan(now_ns() - t0, budget_ns_);
}

void ScanLoop::run(const std::atomic<bool>& shutdown, uint64_t period_ns,
                   void (*after_scan)(void*), void* ctx)
{
    budget_ns_ = period_ns;
    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);
    while (!shutdown.load()) {
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

} // namespace core
