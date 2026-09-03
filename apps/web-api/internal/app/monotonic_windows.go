//go:build windows

package app

// Windows không có `CLOCK_MONOTONIC` cùng trục với producer Linux, và bản
// Windows chỉ dùng cho công cụ phát triển — không có `plc_shm` thật để so.
// Trả `false` để nơi gọi rơi vào nhánh "không biết mốc mẫu", đúng nguyên tắc
// thiếu bằng chứng thì không bịa (`PA3-F04`).
func monotonicNowNS() (uint64, bool) { return 0, false }
