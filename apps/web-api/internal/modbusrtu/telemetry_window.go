package modbusrtu

import (
	"errors"
	"fmt"
)

// T63-003 (PERF-SYS-04, PERF-API-04) — nhãn cửa sổ và epoch cho telemetry bus.
//
// Audit 28/09 ghi hai lỗ hổng quan sát: latency bus là một cửa sổ 128 mẫu TRỘN
// đọc lẫn ghi (một lệnh ghi có readback kéo p95 của cả dây), và counter tích
// luỹ không có nhãn epoch/cửa sổ — sau `apply_config` counter bus về 0 trong
// khi `producer_boot_id` giữ nguyên, nên consumer tính delta ra số âm và không
// phân biệt được "reset" với "giảm".
//
// Kiểu ở đây là HÌNH DẠNG API (snake_case như `/api/v1/modbus/buses`), dựng từ
// op `status` của kênh điều khiển iobus. Chỉ THÊM: mọi trường cũ của
// `StatusReply`/`StatusBusInfo` giữ nguyên nghĩa.

// LatencyWindowView — latency một chiều kèm nhãn cửa sổ. p50/p95/max là nil khi
// cửa sổ chưa có mẫu nào: "chưa đo" không được hiện thành 0 µs (D-07).
type LatencyWindowView struct {
	P50US       *uint32 `json:"p50_us"`
	P95US       *uint32 `json:"p95_us"`
	MaxUS       *uint32 `json:"max_us"`
	SampleCount uint32  `json:"sample_count"`
	WindowSize  uint32  `json:"window_size"`
	Total       uint64  `json:"total"`
}

// CounterEpoch trả lời "counter này đếm từ bao giờ". Hai lần đọc chỉ trừ được
// cho nhau khi epoch GIỐNG hệt.
//   - ProducerBootID đổi mỗi lần iobus khởi động lại;
//   - Epoch: với bus là `bus_counters_epoch` (tăng mỗi lần nạp cấu hình bus);
//     với IOP luôn là 0 vì counter IOP chỉ reset khi tiến trình restart;
//   - SinceMonotonicMS: mốc CLOCK_MONOTONIC (ms) trên SOM lúc counter về 0 — chỉ
//     để hiển thị/đối chiếu, không dùng để so epoch.
//
// ProducerBootID ra JSON dạng CHUỖI: iobus dựng nó bằng (pid << 32) ^ time, nên
// với PID lớn giá trị vượt 2^53 và `number` của JavaScript làm tròn mất bit
// thấp — hai lần khởi động gần nhau có thể trông như cùng một boot.
type CounterEpoch struct {
	ProducerBootID   uint64 `json:"producer_boot_id,string"`
	Epoch            uint64 `json:"epoch"`
	SinceMonotonicMS uint64 `json:"since_monotonic_ms"`
}

// Same báo hai epoch là cùng một đợt đếm.
func (e CounterEpoch) Same(other CounterEpoch) bool {
	return e.ProducerBootID == other.ProducerBootID && e.Epoch == other.Epoch
}

// BusTelemetryView — telemetry có nhãn của một bus.
type BusTelemetryView struct {
	ReadLatency       LatencyWindowView `json:"read_latency"`
	WriteLatency      LatencyWindowView `json:"write_latency"`
	TotalTransactions uint64            `json:"total_transactions"`
	TotalErrors       uint64            `json:"total_errors"`
	SinceEpoch        CounterEpoch      `json:"since_epoch"`
}

// IOPCountersView — counter IOP 64 bit kèm epoch tiến trình.
type IOPCountersView struct {
	RX         uint64       `json:"rx"`
	TX         uint64       `json:"tx"`
	CRCErrors  uint64       `json:"crc_errors"`
	SeqErrors  uint64       `json:"seq_errors"`
	Timeouts   uint64       `json:"timeouts"`
	Retries    uint64       `json:"retries"`
	NACKs      uint64       `json:"nacks"`
	SinceEpoch CounterEpoch `json:"since_epoch"`
}

func latencyView(w StatusLatencyWindow) LatencyWindowView {
	view := LatencyWindowView{SampleCount: w.SampleCount, WindowSize: w.WindowSize, Total: w.Total}
	if w.SampleCount > 0 {
		p50, p95, maxUS := w.P50US, w.P95US, w.MaxUS
		view.P50US, view.P95US, view.MaxUS = &p50, &p95, &maxUS
	}
	return view
}

// BusTelemetryByID dựng telemetry có nhãn theo id bus. Bus mà iobus không gửi
// đủ trường T63-003 (iobus cũ, hoặc chưa biết epoch) KHÔNG có mặt trong map —
// caller trả `null` thay vì bịa số 0.
func BusTelemetryByID(status StatusReply) map[int]BusTelemetryView {
	out := map[int]BusTelemetryView{}
	if status.BusCountersEpoch == 0 {
		return out
	}
	epoch := CounterEpoch{
		ProducerBootID:   status.ProducerBootID,
		Epoch:            status.BusCountersEpoch,
		SinceMonotonicMS: status.BusCountersSinceMS,
	}
	for _, bus := range status.Buses {
		if bus.LatencyRead == nil || bus.LatencyWrite == nil {
			continue
		}
		out[bus.ID] = BusTelemetryView{
			ReadLatency:       latencyView(*bus.LatencyRead),
			WriteLatency:      latencyView(*bus.LatencyWrite),
			TotalTransactions: bus.TotalTransactions,
			TotalErrors:       bus.TotalErrors,
			SinceEpoch:        epoch,
		}
	}
	return out
}

// IOPCountersFrom trả counter IOP có nhãn; ok=false khi iobus không gửi khối
// `iop` (bản trước T63-003).
func IOPCountersFrom(status StatusReply) (IOPCountersView, bool) {
	if status.IOP == nil {
		return IOPCountersView{}, false
	}
	return IOPCountersView{
		RX: status.IOP.RX, TX: status.IOP.TX, CRCErrors: status.IOP.CRCErrors,
		SeqErrors: status.IOP.SeqErrors, Timeouts: status.IOP.Timeouts,
		Retries: status.IOP.Retries, NACKs: status.IOP.NACKs,
		SinceEpoch: CounterEpoch{
			ProducerBootID:   status.ProducerBootID,
			SinceMonotonicMS: status.CountersSinceMS,
		},
	}, true
}

// ErrCounterDecreased: cùng epoch mà counter giảm — không phải reset hợp lệ nào.
// Trả lỗi thay vì một delta âm/khổng lồ để caller hiện "không tin được".
var ErrCounterDecreased = errors.New("counter giảm trong cùng epoch")

// CounterDelta tính số tăng giữa hai lần đọc một counter tích luỹ.
//   - khác epoch ⇒ reset=true, delta = giá trị hiện tại (đếm từ epoch mới);
//   - cùng epoch, không giảm ⇒ delta = cur − prev;
//   - cùng epoch mà giảm ⇒ ErrCounterDecreased.
func CounterDelta(prevEpoch CounterEpoch, prev uint64, curEpoch CounterEpoch, cur uint64) (delta uint64, reset bool, err error) {
	if !prevEpoch.Same(curEpoch) {
		return cur, true, nil
	}
	if cur < prev {
		return 0, false, fmt.Errorf("%w: %d → %d (boot %d, epoch %d)", ErrCounterDecreased,
			prev, cur, curEpoch.ProducerBootID, curEpoch.Epoch)
	}
	return cur - prev, false, nil
}
