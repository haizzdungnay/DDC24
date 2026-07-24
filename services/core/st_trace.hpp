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

} // namespace core

#endif /* CORE_ST_TRACE_HPP */
