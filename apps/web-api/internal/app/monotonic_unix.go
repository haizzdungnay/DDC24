//go:build !windows

package app

import "golang.org/x/sys/unix"

/* `ISS-PIO-08`/`F-PIO-007` — đọc CÙNG đồng hồ mà Core dùng để đóng dấu snapshot.
 *
 * `plc_shm.ts_ns` là `CLOCK_MONOTONIC`, và trên Linux đồng hồ đó dùng chung
 * TOÀN HỆ THỐNG: `mkddc-core` và `mkddc-web` chạy trên cùng một board nên đọc
 * ra cùng một trục thời gian. Nhờ vậy tuổi của snapshot tính được chính xác mà
 * không cần producer phải chở thêm mốc treo tường nào.
 *
 * `time.Now()` của Go CÓ mang một số đọc monotonic, nhưng nó không phơi ra giá
 * trị tuyệt đối và chỉ so được giữa hai `time.Time` của cùng tiến trình — không
 * so được với một `ts_ns` do tiến trình khác ghi. Vì thế phải gọi thẳng
 * `clock_gettime`. */
func monotonicNowNS() (uint64, bool) {
	var ts unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &ts); err != nil {
		return 0, false
	}
	return uint64(ts.Sec)*1_000_000_000 + uint64(ts.Nsec), true
}
