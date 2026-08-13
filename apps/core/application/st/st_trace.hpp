/**
 * @file  st_trace.hpp
 * @brief FW SOM IEC programming foundation: event schema cho runtime
 *        trace/audit. FW SOM chỉ tạo event ĐÚNG SCHEMA và giữ 1 cửa sổ gần
 *        nhất trong bộ nhớ process (`StTraceLog`, bounded ring buffer) — CHƯA
 *        có audit log bền vững/BE gom log (đó là việc của
 *        `mkddc-program-service` khi có storage layer thật, xem C8).
 */
#ifndef CORE_ST_TRACE_HPP
#define CORE_ST_TRACE_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>

namespace core {

enum class StTraceEventKind {
    VALIDATE_RESULT,    /* compile/validate (parse+typecheck) ok/fail — hiện do CLI gateway
                          * (item 2) sinh ra dưới dạng JSON độc lập; kind này có sẵn cho
                          * component nào chạy dài (giữ StTraceLog) muốn log lại. */
    ACTIVATION_RESULT,  /* activation áp dụng tại ranh giới cycle: ok/fail */
    RUNTIME_FAULT,       /* execute() trả về !ok trong lúc package đang active */
    OVERRUN,             /* 1 cycle vượt budget */
    ROLLBACK,            /* activation fail -> package cũ (last-known-good) tiếp tục */
};

struct StTraceEvent {
    StTraceEventKind kind = StTraceEventKind::VALIDATE_RESULT;
    uint64_t         timestamp_ns = 0;   /* do caller cung cấp — event schema không tự gọi clock */
    bool             ok = false;
    std::string      artifact_hash;      /* rỗng nếu không áp dụng */
    std::string      code;               /* stable diagnostic code nếu có lỗi, rỗng nếu ok */
    std::string      message;
};

class StTraceLog {
public:
    explicit StTraceLog(std::size_t capacity = 256) : capacity_(capacity) {}

    /* Đầy -> drop event CŨ NHẤT (sliding window), dropped_count() tăng. */
    void push(StTraceEvent event);

    const std::deque<StTraceEvent>& events() const { return events_; }
    std::size_t dropped_count() const { return dropped_; }
    void clear() { events_.clear(); dropped_ = 0; }

private:
    std::size_t capacity_;
    std::deque<StTraceEvent> events_;
    std::size_t dropped_ = 0;
};

/* Event bounded cho StScheduler (TASK-PROG-305, DDD-CTRL-PROG-001 §11).
 * KHÁC StTraceEvent: chỉ giữ con trỏ tới string TĨNH (hằng số, không sở
 * hữu) — không có field nào cần cấp phát động, nên an toàn push ngay trong
 * run_task() (đường RT). StTraceLog/std::deque phía trên cấp/giải phóng
 * chunk nội bộ mỗi lần push_back/pop_front dù kích thước logic không đổi —
 * phù hợp cho StCyclicRuntime (không chạy trong đường RT chặt của
 * StScheduler) nhưng KHÔNG an toàn cho scan path mới. */
struct StRuntimeTraceEvent {
    StTraceEventKind kind = StTraceEventKind::VALIDATE_RESULT;
    uint64_t         timestamp_ns = 0;
    bool             ok = false;
    const char*      task_id = nullptr;     /* trỏ vào StTaskConfig::id, sống cùng Task */
    const char*      instance_id = nullptr; /* trỏ vào StProgramInstance::instance_id */
    const char*      code = nullptr;        /* hằng tĩnh st_diag_code::*, nullptr nếu ok */
};

/* Ring buffer cấp phát TĨNH, không std::deque/vector — kích thước logic
 * luôn <= Capacity, đầy thì ghi đè phần tử CŨ NHẤT và tăng dropped_count()
 * (Control Semantics §11: "overflow trace drop sample + counter"). */
template <std::size_t Capacity>
class StBoundedRuntimeTrace {
public:
    static_assert(Capacity > 0, "capacity phải > 0");

    void push(const StRuntimeTraceEvent& event)
    {
        if (count_ < Capacity) {
            ring_[(head_ + count_) % Capacity] = event;
            count_++;
        } else {
            ring_[head_] = event;
            head_ = (head_ + 1) % Capacity;
            dropped_++;
        }
    }

    std::size_t size() const { return count_; }
    std::size_t capacity() const { return Capacity; }
    std::size_t dropped_count() const { return dropped_; }
    /* 0 = event cũ nhất còn giữ, size()-1 = mới nhất. */
    const StRuntimeTraceEvent& at(std::size_t logical_index) const
    {
        return ring_[(head_ + logical_index) % Capacity];
    }
    void clear() { head_ = 0; count_ = 0; dropped_ = 0; }

private:
    std::array<StRuntimeTraceEvent, Capacity> ring_{};
    std::size_t head_ = 0;
    std::size_t count_ = 0;
    std::size_t dropped_ = 0;
};

/* Capacity mặc định cho trace runtime của StScheduler. Đây là bounded event
 * trace (fault/overrun/rollback/activation) — KHÁC value-sampling historian
 * "10.000 sample/10 phút" của OD-PROG-011, thứ đó cần selector/session theo
 * biến còn mở (`GET/POST /runtime/traces`), chưa làm ở TASK-PROG-305. */
constexpr std::size_t kSchedulerTraceCapacity = 128;
using StSchedulerTrace = StBoundedRuntimeTrace<kSchedulerTraceCapacity>;

} // namespace core

#endif /* CORE_ST_TRACE_HPP */
