package app

// T63-101 (PERF-API-01, Plan 63 §4.2) — reader phải CHỜ writer nhả seqlock trong
// giới hạn thời gian, và phải nhường CPU trong lúc chờ.
//
// File này cố ý chỉ dùng API đã có trước T63-101 (`readPLCShm`, `mapWritableSHM`,
// `seqPointer`): nhờ vậy chạy được trên reader cũ để chứng minh test ĐỎ khi bỏ
// bản sửa. Reader cũ thử 5 vòng liền trong chưa tới 1 µs nên thua cả hai kịch bản.

import (
	"encoding/binary"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

// startWriterHolding mô phỏng writer đang ở giữa KX_WRITE_BEGIN/KX_WRITE_END:
// seq lẻ ngay khi hàm trả về, giữ `hold` (quay vòng, không nhả CPU), rồi ghi
// `value` vào scan_count và KX_WRITE_END.
func startWriterHolding(mm []byte, hold time.Duration, value uint32) <-chan struct{} {
	seq := seqPointer(mm)
	atomic.StoreUint32(seq, atomic.LoadUint32(seq)|1)
	release := time.Now().Add(hold)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for time.Now().Before(release) {
		}
		binary.LittleEndian.PutUint32(mm[offPLCScanCount:], value)
		atomic.AddUint32(seq, 1)
	}()
	return done
}

// attachedPLCClient trả client đã mmap sẵn segment (seq chẵn) để lần đọc được đo
// không tính chi phí attach.
func attachedPLCClient(t *testing.T) (*CoreClient, []byte) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mkddc_plc_shm")
	mm := mapWritableSHM(t, path, kxPlcShmMinLen)
	atomic.StoreUint32(seqPointer(mm), 2)
	client := &CoreClient{PLCShm: path}
	t.Cleanup(client.Close)
	if _, err := client.readPLCShm(); err != nil {
		t.Fatalf("attach: %v", err)
	}
	return client, mm
}

// AC T63-101: writer giả giữ seq lẻ 50 µs / 200 µs ⇒ đọc thành công, và thấy
// đúng bản SAU khi writer nhả (không phải bản trước, không phải bản xé).
func TestShmReadWaitsForWriterHoldingSeqlock(t *testing.T) {
	for _, hold := range []time.Duration{50 * time.Microsecond, 200 * time.Microsecond} {
		t.Run(hold.String(), func(t *testing.T) {
			client, mm := attachedPLCClient(t)
			done := startWriterHolding(mm, hold, 777)
			start := time.Now()
			data, err := client.readPLCShm()
			elapsed := time.Since(start)
			<-done
			if err != nil {
				t.Fatalf("writer giữ seq lẻ %v: err = %v; want đọc được sau khi writer nhả", hold, err)
			}
			if got := binary.LittleEndian.Uint32(data[offPLCScanCount:]); got != 777 {
				t.Fatalf("scan_count = %d; want 777 (bản sau khi writer nhả)", got)
			}
			t.Logf("writer giữ %v → đọc được sau %v", hold, elapsed)
		})
	}
}

// Nhường CPU là điều kiện cần, không phải tối ưu: với writer chạy cùng CPU
// (iobus và mkddc-web-pi cùng CPUAffinity=0-2), reader quay vòng không nhả CPU
// chỉ kéo dài đúng đoạn ghi nó đang chờ. GOMAXPROCS=1 dựng lại đúng tình huống
// đó: goroutine writer CHỈ chạy được khi reader nhường.
func TestShmReadYieldsCPUToWriterOnSameProcessor(t *testing.T) {
	prev := runtime.GOMAXPROCS(1)
	t.Cleanup(func() { runtime.GOMAXPROCS(prev) })

	client, mm := attachedPLCClient(t)
	done := startWriterHolding(mm, 50*time.Microsecond, 888)
	data, err := client.readPLCShm()
	<-done
	if err != nil {
		t.Fatalf("writer cùng CPU: err = %v; want reader nhường CPU cho writer ghi xong", err)
	}
	if got := binary.LittleEndian.Uint32(data[offPLCScanCount:]); got != 888 {
		t.Fatalf("scan_count = %d; want 888", got)
	}
}
