/**
 * @file  poll_loop_timing.hpp
 * @brief T63-004 (PERF-SYS-05/07) — tách thời gian vòng poll IOP thành các
 *        thành phần đo được, công bố một dòng log phút `iobus.loop_timing`.
 *
 *        Vì sao cần: dòng `iobus.jitter` cũ trộn ba thứ khác nhau vào một số.
 *        `max_us` gộp độ trễ đánh thức của kernel với phần "nợ" do chạy bù, còn
 *        `overruns` tăng ở MỖI vòng chạy bù có lệch > 1 chu kỳ — một lần kẹt
 *        16 ms ở chu kỳ 2 ms bị đếm thành nhiều "overrun" (audit 28/09 đo
 *        `overruns=26344` trong một phút). Không tách thì không biết kẹt do
 *        scheduler, do giao dịch UART hay do chính chính sách chạy bù, và cổng
 *        G-D1 (chính sách tick IOBus) không có số để quyết.
 *
 *        Các khoá của dòng log phút (µs làm tròn LÊN, cửa sổ = một phút):
 *          - `wake_late_max_us`: độ trễ đánh thức lớn nhất = lúc thức dậy − mốc
 *            đã hẹn, CHỈ tính vòng thật sự đã ngủ. Vòng chạy bù không ngủ nên
 *            "trễ" của nó là nợ tồn, không phải độ trễ scheduler — đếm riêng ở
 *            `catchup_iterations`.
 *          - `work_max_us`: thời gian làm việc lớn nhất của một vòng (từ lúc thức
 *            dậy tới ngay trước khi ngủ) — gồm giao dịch GET_IO, lệnh output và
 *            reconnect/handshake nếu có.
 *          - `io_resp_gap_max_us`: khoảng lớn nhất giữa hai IO_RESP hợp lệ liên
 *            tiếp (cùng định nghĩa `max_iop_poll_gap_us` của T59-702 nhưng theo
 *            phút). Khoảng đang mở lúc in log cũng được tính, để một phút MCU im
 *            lặng hoàn toàn không hiện thành 0.
 *          - `late_events`: số SỰ KIỆN trễ. Một sự kiện bắt đầu khi một vòng
 *            làm xong SAU mốc lưới kế tiếp (lỡ >= 1 mốc) và kéo dài tới vòng đầu
 *            tiên làm xong kịp mốc kế tiếp. Một lần kẹt 16 ms là MỘT sự kiện dù
 *            sau đó có bao nhiêu vòng chạy bù.
 *          - `catchup_iterations`: số vòng bắt đầu mà KHÔNG ngủ vì mốc của nó
 *            đã qua trước khi vòng trước làm xong (vòng chạy bù/chạy dồn).
 *          - `iterations`, `io_resp_count`, `period_us`: ngữ cảnh để đọc các số
 *            trên (chu kỳ đổi được qua SIGHUP; `io_resp_count=0` nghĩa là cả
 *            phút không có IO_RESP hợp lệ nào).
 *
 *        Định nghĩa không phụ thuộc chính sách tick: `late_events` dựa trên mốc
 *        LƯỚI kế tiếp (mốc hiện tại + chu kỳ), còn `catchup_iterations` dựa trên
 *        mốc mà vòng lặp THẬT SỰ ngủ tới. Khi T63-201 đổi sang "lỡ thì bỏ",
 *        `late_events` giữ nguyên nghĩa và `catchup_iterations` phải về 0.
 *
 *        Luồng RT: không cấp phát, không khoá, không I/O. Mọi trạng thái là số
 *        nguyên cố định; `format_line` chỉ `snprintf` vào buffer do caller cấp.
 *        Chỉ luồng poll IOP gọi (một luồng, không cần atomic).
 */
#ifndef IOBUS_POLL_LOOP_TIMING_HPP
#define IOBUS_POLL_LOOP_TIMING_HPP

#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace iobus {

/* Thống kê giữa hai lần log phút — mọi trường tính bằng ns hoặc số lần. */
struct PollLoopMinute {
    uint64_t iterations = 0;
    uint64_t wake_late_max_ns = 0;
    uint64_t work_max_ns = 0;
    uint64_t io_resp_count = 0;
    uint64_t io_resp_gap_max_ns = 0;
    uint64_t late_events = 0;
    uint64_t catchup_iterations = 0;
};

class PollLoopTiming {
public:
    /* Tên sự kiện trong log phút; probe `scripts/forlinx_perf_probe.py` tách
     * theo `<LEVEL>  <event> k=v ...`. */
    static constexpr const char* kEventName = "iobus.loop_timing";
    /* Đủ cho dòng xấu nhất (mọi trường = UINT64_MAX, 287 ký tự + NUL) — test
     * `WorstCaseLineFitsLineCapacity` khoá con số này. */
    static constexpr std::size_t kLineCapacity = 320;

    /* Gọi NGAY khi thức dậy (đầu vòng) cho mốc `deadline_ns`. */
    void on_wake(uint64_t deadline_ns, uint64_t wake_ns) noexcept
    {
        ++minute_.iterations;
        deadline_ns_ = deadline_ns;
        wake_ns_ = wake_ns;
        in_iteration_ = true;
        /* Mốc đã qua trước khi vòng trước làm xong ⇒ `clock_nanosleep` trả về
         * ngay, vòng này là vòng chạy bù. `<=`: mốc đúng bằng lúc làm xong cũng
         * không ngủ (TIMER_ABSTIME với mốc không ở tương lai). */
        if (has_work_end_ && deadline_ns <= last_work_end_ns_) {
            ++minute_.catchup_iterations;
            return;
        }
        const uint64_t late_ns = wake_ns > deadline_ns ? wake_ns - deadline_ns : 0;
        if (late_ns > minute_.wake_late_max_ns) minute_.wake_late_max_ns = late_ns;
    }

    /* Gọi sau mỗi IO_RESP hợp lệ, với dấu thời gian của response
     * (`IopClient::last_io_resp_ns()`). */
    void on_io_resp(uint64_t response_ns) noexcept
    {
        ++minute_.io_resp_count;
        if (last_io_resp_ns_ != 0 && response_ns > last_io_resp_ns_) {
            const uint64_t gap_ns = response_ns - last_io_resp_ns_;
            if (gap_ns > minute_.io_resp_gap_max_ns) minute_.io_resp_gap_max_ns = gap_ns;
        }
        if (response_ns > last_io_resp_ns_) last_io_resp_ns_ = response_ns;
    }

    /* Gọi NGAY TRƯỚC khi ngủ tới mốc kế tiếp. `period_ns` là chu kỳ lưới hiện
     * hành; mốc lưới kế tiếp = mốc của vòng này + `period_ns`, KHÔNG phải mốc
     * đã điều chỉnh theo chính sách bỏ mốc (xem chú thích đầu file). */
    void on_work_end(uint64_t end_ns, uint64_t period_ns) noexcept
    {
        if (!in_iteration_) return;
        in_iteration_ = false;
        const uint64_t work_ns = end_ns > wake_ns_ ? end_ns - wake_ns_ : 0;
        if (work_ns > minute_.work_max_ns) minute_.work_max_ns = work_ns;
        last_work_end_ns_ = end_ns;
        has_work_end_ = true;
        const bool behind = period_ns != 0 && end_ns >= deadline_ns_ + period_ns;
        if (behind && !behind_) ++minute_.late_events;
        behind_ = behind;
    }

    /* Ảnh chụp phút tại `now_ns`: cộng khoảng IO_RESP đang mở (chưa có
     * response kế tiếp) vào `io_resp_gap_max_ns`. */
    PollLoopMinute minute_at(uint64_t now_ns) const noexcept
    {
        PollLoopMinute out = minute_;
        if (last_io_resp_ns_ != 0 && now_ns > last_io_resp_ns_) {
            const uint64_t open_gap_ns = now_ns - last_io_resp_ns_;
            if (open_gap_ns > out.io_resp_gap_max_ns) out.io_resp_gap_max_ns = open_gap_ns;
        }
        return out;
    }

    const PollLoopMinute& minute() const noexcept { return minute_; }

    /* Chỉ xoá bộ đếm phút; trạng thái nối giữa các vòng (vòng trước làm xong
     * lúc nào, đang trễ hay không, IO_RESP gần nhất) giữ nguyên để một sự kiện
     * vắt qua ranh giới phút không bị đếm hai lần. */
    void reset_minute() noexcept { minute_ = PollLoopMinute{}; }

    static uint64_t ceil_us(uint64_t ns) noexcept { return ns / 1000u + (ns % 1000u != 0 ? 1u : 0u); }

    /* Ghi `iobus.loop_timing k=v ...` (không có tiền tố mức log, không có
     * xuống dòng) vào `buf` (nên cấp `kLineCapacity` byte). Trả giá trị của
     * `snprintf`. */
    static int format_line(char* buf, std::size_t size, const PollLoopMinute& m,
                           uint64_t period_ns) noexcept
    {
        return std::snprintf(
            buf, size,
            "%s wake_late_max_us=%llu work_max_us=%llu io_resp_gap_max_us=%llu"
            " late_events=%llu catchup_iterations=%llu iterations=%llu"
            " io_resp_count=%llu period_us=%llu",
            kEventName,
            static_cast<unsigned long long>(ceil_us(m.wake_late_max_ns)),
            static_cast<unsigned long long>(ceil_us(m.work_max_ns)),
            static_cast<unsigned long long>(ceil_us(m.io_resp_gap_max_ns)),
            static_cast<unsigned long long>(m.late_events),
            static_cast<unsigned long long>(m.catchup_iterations),
            static_cast<unsigned long long>(m.iterations),
            static_cast<unsigned long long>(m.io_resp_count),
            static_cast<unsigned long long>(ceil_us(period_ns)));
    }

private:
    PollLoopMinute minute_{};
    uint64_t deadline_ns_ = 0;
    uint64_t wake_ns_ = 0;
    uint64_t last_work_end_ns_ = 0;
    uint64_t last_io_resp_ns_ = 0;
    bool     in_iteration_ = false;
    bool     has_work_end_ = false;
    bool     behind_ = false;
};

} // namespace iobus

#endif /* IOBUS_POLL_LOOP_TIMING_HPP */
