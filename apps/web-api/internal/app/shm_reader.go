package app

// Reader seqlock cho hai segment shared memory của SOM.
//
// F-02 (review 2026-07-30): trước file này, backend đọc SHM bằng os.ReadFile +
// validSHM(), mà validSHM chỉ kiểm `magic` và độ dài. `magic` KHÔNG bị writer
// chạm trong lúc ghi nên check đó luôn pass và không phát hiện được gì. Trong khi
// đó shmfs dùng chung page với writer, nên một lần đọc cả segment có thể trộn
// byte trước và sau một lần update — snapshot bị XÉ mà không có dấu hiệu nào để
// nhận ra. Snapshot xé đó đi thẳng ra WS monitor và được historian sampler ghi
// vào DB, tạo bản ghi lịch sử sai không thể phát hiện về sau.
//
// contracts/shm/mkddc_shm.h quy định BẮT BUỘC pattern seqlock cho mọi reader, và nói rõ
// đọc bằng read()/os.ReadFile() là không hợp lệ. Hai hiện thực C++ làm hình mẫu:
// apps/hmi/data/shm_reader.cpp và apps/iobus/fieldbus/modbus_master.cpp
// (drain_ext_writes). File này là bản Go tương đương:
//
//	mmap(PROT_READ, MAP_SHARED) → đọc seq (atomic) → bỏ nếu LẺ → copy →
//	đọc lại seq → bằng nhau thì hợp lệ → kiểm magic → retry có GIỚI HẠN.
//
// T63-101 (PERF-API-01, Plan 63 §4.2): giới hạn retry nay tính theo THỜI GIAN
// (shmSeqlockDeadline) chứ không theo số vòng, và reader NHƯỜNG CPU giữa hai lần
// thử. Bản cũ thử 5 vòng liền không nhường: cả 5 vòng xong trong chưa tới một
// micro giây, tức gọn trong đúng một lần writer đang ghi, nên chỉ cần request rơi
// vào lúc đó là `/api/v1/points` trả 503 dù Core hoàn toàn khoẻ.

import (
	"encoding/binary"
	"fmt"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const (
	// Layout header dùng chung của kx_io_shm_t và kx_plc_shm_t
	// (contracts/shm/mkddc_shm.h): uint32 magic; volatile uint32 seq;
	shmOffMagic  = 0
	shmOffSeq    = 4
	shmHeaderLen = 8

	// shmSeqlockDeadline là tổng thời gian tối đa MỘT lần đọc được chờ writer nhả
	// seqlock. Hết hạn = ĐỌC THẤT BẠI, caller xử lý fail-safe như cũ (`/points`
	// trả 503, không bao giờ trả dữ liệu cũ gắn GOOD).
	//
	// Vì sao 1 ms:
	//   - Writer giữ seq lẻ trong đúng một đoạn ghi ngắn (io_cache.cpp của iobus,
	//     scan_loop.cpp của Core): cỡ micro giây. 1 ms dư hàng trăm lần cho một
	//     lần ghi bình thường, kể cả khi writer bị ngắt giữa chừng.
	//   - 1 ms vẫn chỉ bằng 1/10 base step Core (10 ms, ADR-061) và 1/20 ngưỡng
	//     p95 server của `/points` (20 ms, Plan 63 T63-101). Writer giữ lẻ lâu hơn
	//     thế là sự cố thật (chết giữa KX_WRITE_BEGIN/KX_WRITE_END), không phải
	//     nhịp ghi, và lỗi được trả mà request không chậm đi thấy được.
	//   - Cả lần đọc chạy dưới shmSegment.mu, nên đây cũng là trần thời gian một
	//     caller chặn caller khác trên cùng segment.
	shmSeqlockDeadline = time.Millisecond
	// shmSeqlockSpinYields: số lần thử đầu chỉ nhường goroutine
	// (runtime.Gosched). Rẻ, và đủ khi writer chạy ở CPU khác: Core ghi plc_shm
	// từ CPU3.
	shmSeqlockSpinYields = 8
	// shmSeqlockBackoff: hết lượt nhường goroutine thì ngủ ngắn để nhả luôn OS
	// thread. Cần khi writer chạy CÙNG CPU với web: iobus và mkddc-web-pi cùng
	// CPUAffinity=0-2, và một reader quay vòng không nhả CPU chỉ kéo dài đúng
	// đoạn ghi nó đang chờ.
	//
	// Ngủ bằng nanosleep(2), KHÔNG bằng time.Sleep: đo trên host go1.26.4,
	// time.Sleep(50µs) mất 0,94 ms ở p50 (timer runtime), tức MỘT lần ngủ đã vượt
	// cả deadline. nanosleep(50µs) mất 116 µs p50, 245 µs max.
	shmSeqlockBackoff = 50 * time.Microsecond
	// shmSeqlockSleepSlack là phần dư cho độ vượt của nanosleep (timer slack của
	// kernel, số đo ở trên). Chỉ ngủ khi hạn còn lại ≥ backoff + slack; phần đuôi
	// chỉ nhường goroutine, nên lần đọc thất bại trả lỗi ĐÚNG tại deadline chứ
	// không trễ thêm một nhịp ngủ.
	shmSeqlockSleepSlack = 250 * time.Microsecond
)

// seqlockPolicy gom thông số và đồng hồ của đường đọc seqlock. Production luôn
// dùng defaultSeqlockPolicy(); test thay đồng hồ để kiểm "không ngủ quá hạn" mà
// không phụ thuộc lịch của máy chạy test.
type seqlockPolicy struct {
	deadline   time.Duration
	spinYields int
	backoff    time.Duration
	sleepSlack time.Duration
	now        func() time.Time
	sleep      func(time.Duration)
	yield      func()
}

func defaultSeqlockPolicy() seqlockPolicy {
	return seqlockPolicy{
		deadline:   shmSeqlockDeadline,
		spinYields: shmSeqlockSpinYields,
		backoff:    shmSeqlockBackoff,
		sleepSlack: shmSeqlockSleepSlack,
		now:        time.Now,
		sleep:      nanosleep,
		yield:      runtime.Gosched,
	}
}

// nanosleep ngủ bằng syscall, nhả OS thread cho writer cùng CPU. EINTR (runtime
// Go gửi SIGURG để preempt) thì ngủ nốt phần còn lại chứ không ngủ lại từ đầu.
func nanosleep(d time.Duration) {
	ts := syscall.NsecToTimespec(int64(d))
	for syscall.Nanosleep(&ts, &ts) == syscall.EINTR {
	}
}

type seqlockOutcome int

const (
	seqlockOK        seqlockOutcome = iota
	seqlockBadBuffer                // mm/dst ngắn hơn header hoặc dst dài hơn mm
	seqlockBadMagic                 // snapshot nhất quán nhưng magic sai
	seqlockDeadline                 // writer giữ seqlock suốt deadline
)

type seqlockResult struct {
	outcome seqlockOutcome
	retries uint64        // số lần phải thử lại vì seq lẻ hoặc seq đổi trong lúc copy
	waited  time.Duration // từ lần đọc seq đầu tới khi có kết quả
}

// shmReadStats là bộ đếm tích luỹ của một segment, công bố ở
// `GET /api/v1/system/status` → `shm_reader` (T63-101). Atomic để đọc metric
// không phải chờ shmSegment.mu.
type shmReadStats struct {
	reads     atomic.Uint64 // lần đọc đi tới bước seqlock (đã attach được segment)
	retries   atomic.Uint64 // tổng số lần thử lại
	failures  atomic.Uint64 // lần hết shmSeqlockDeadline mà không có snapshot nhất quán
	maxWaitNs atomic.Uint64 // lần chờ lâu nhất, kể cả lần thất bại
}

func (st *shmReadStats) observe(res seqlockResult) {
	st.reads.Add(1)
	st.retries.Add(res.retries)
	if res.outcome == seqlockDeadline {
		st.failures.Add(1)
	}
	waited := uint64(res.waited)
	for {
		prev := st.maxWaitNs.Load()
		if waited <= prev || st.maxWaitNs.CompareAndSwap(prev, waited) {
			return
		}
	}
}

// SHMSegmentMetrics là ảnh chụp shmReadStats của một segment.
type SHMSegmentMetrics struct {
	Reads     uint64 `json:"reads"`
	Retries   uint64 `json:"retries"`
	Failures  uint64 `json:"failures"`
	MaxWaitUS uint64 `json:"max_wait_us"`
}

func (st *shmReadStats) snapshot() SHMSegmentMetrics {
	return SHMSegmentMetrics{
		Reads:     st.reads.Load(),
		Retries:   st.retries.Load(),
		Failures:  st.failures.Load(),
		MaxWaitUS: st.maxWaitNs.Load() / uint64(time.Microsecond),
	}
}

// shmSegment giữ một mmap read-only của một segment SHM, kèm đường đọc seqlock.
// Không an toàn để copy (chứa Mutex) — luôn dùng qua con trỏ.
type shmSegment struct {
	mu     sync.Mutex
	path   string // path đã attach; khác path yêu cầu → re-attach
	data   []byte // mmap read-only, MAP_SHARED
	inode  uint64 // phát hiện segment bị tạo lại (core restart)
	device uint64
	stats  shmReadStats
}

// attachLocked bảo đảm segment đang được mmap từ đúng `path` với ít nhất
// `minLen` byte. Gọi với s.mu đã giữ.
func (s *shmSegment) attachLocked(path string, minLen int) error {
	if path == "" {
		return fmt.Errorf("shm path rỗng")
	}
	info, err := os.Stat(path)
	if err != nil {
		s.detachLocked()
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		s.detachLocked()
		return fmt.Errorf("stat %s: không lấy được inode", path)
	}
	if info.Size() < int64(minLen) {
		// mmap dài hơn kích thước file sẽ gây SIGBUS khi truy cập, nên chặn ở đây.
		s.detachLocked()
		return fmt.Errorf("shm %s ngắn hơn hợp đồng: %d < %d", path, info.Size(), minLen)
	}

	// Segment còn hợp lệ và cùng inode → dùng lại mmap hiện có.
	//
	// Kiểm inode là bắt buộc, không phải tối ưu hoá: khi mkddc-core restart nó
	// shm_unlink + tạo lại segment, tạo ra inode mới. mmap cũ vẫn trỏ vào inode
	// đã xoá và nội dung cũ VẪN có magic hợp lệ — nếu không so inode thì backend
	// sẽ đọc mãi dữ liệu đóng băng của một segment đã chết mà không hề biết.
	if s.data != nil && s.path == path &&
		s.inode == stat.Ino && s.device == uint64(stat.Dev) &&
		len(s.data) == int(info.Size()) && len(s.data) >= minLen {
		return nil
	}
	s.detachLocked()

	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	mm, err := syscall.Mmap(int(f.Fd()), 0, int(info.Size()),
		syscall.PROT_READ, syscall.MAP_SHARED)
	if err != nil {
		return fmt.Errorf("mmap %s: %w", path, err)
	}
	s.data = mm
	s.path = path
	s.inode = stat.Ino
	s.device = uint64(stat.Dev)
	return nil
}

func (s *shmSegment) detachLocked() {
	if s.data != nil {
		_ = syscall.Munmap(s.data)
		s.data = nil
	}
	s.path = ""
	s.inode = 0
	s.device = 0
}

// close nhả mmap. An toàn khi gọi nhiều lần.
func (s *shmSegment) close() {
	s.mu.Lock()
	s.detachLocked()
	s.mu.Unlock()
}

// read trả về toàn bộ snapshot NHẤT QUÁN hiện có của segment tại `path`, sau
// khi xác nhận nó dài ít nhất `minLen`. Trả toàn bộ phần nối đuôi là bắt buộc để
// consumer mới đọc được telemetry optional mà vẫn tương thích producer cũ.
//
// Trả lỗi khi: segment chưa tồn tại / ngắn hơn hợp đồng / magic sai / writer giữ
// seqlock suốt shmSeqlockDeadline. Caller PHẢI xử lý lỗi fail-safe — dùng lại dữ
// liệu cũ ở đường quyết định là đúng loại lỗi mà F-03 đã chỉ ra ở phía HMI.
func (s *shmSegment) read(path string, minLen int) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.attachLocked(path, minLen); err != nil {
		return nil, err
	}
	policy := defaultSeqlockPolicy()
	dst := make([]byte, len(s.data))
	res := seqlockCopyWithin(s.data, dst, policy)
	s.stats.observe(res)
	switch res.outcome {
	case seqlockOK:
		return dst, nil
	case seqlockDeadline:
		return nil, fmt.Errorf("shm %s: không đọc được snapshot nhất quán (writer giữ seqlock quá %v, %d lần thử lại)",
			path, policy.deadline, res.retries)
	default:
		return nil, fmt.Errorf("shm %s: không đọc được snapshot nhất quán", path)
	}
}

// metrics trả bộ đếm tích luỹ của segment (không chờ mu).
func (s *shmSegment) metrics() SHMSegmentMetrics {
	return s.stats.snapshot()
}

// seqlockCopy hiện thực đúng pattern reader mà contracts/shm/mkddc_shm.h bắt buộc.
//
// atomic.LoadUint32 dùng để đọc `seq`: mô hình bộ nhớ của Go cho atomic là
// sequentially consistent, nên hai lần đọc seq không thể bị đổi chỗ với phép copy
// ở giữa — đúng vai trò của __ATOMIC_ACQUIRE ở bản C++. Con trỏ vào mmap luôn
// thẳng hàng 4 byte vì mmap trả về địa chỉ thẳng hàng trang.
func seqlockCopy(mm []byte, dst []byte) bool {
	return seqlockCopyWithin(mm, dst, defaultSeqlockPolicy()).outcome == seqlockOK
}

// seqlockCopyWithin thử lại cho tới khi có snapshot nhất quán hoặc hết
// p.deadline (T63-101). Giữa hai lần thử: p.spinYields lần đầu chỉ nhường
// goroutine; sau đó ngủ p.backoff khi hạn còn lại đủ chứa cả độ vượt của lần ngủ
// (p.sleepSlack), còn không thì chỉ nhường goroutine — nên lần đọc thất bại kết
// thúc tại deadline chứ không trễ thêm một nhịp ngủ. Không có vòng nào không
// giới hạn: hết hạn là trả seqlockDeadline.
func seqlockCopyWithin(mm []byte, dst []byte, p seqlockPolicy) seqlockResult {
	if len(mm) < shmHeaderLen || len(dst) < shmHeaderLen || len(dst) > len(mm) {
		return seqlockResult{outcome: seqlockBadBuffer}
	}
	seq := (*uint32)(unsafe.Pointer(&mm[shmOffSeq]))
	start := p.now()
	var retries uint64
	for attempt := 0; ; attempt++ {
		before := atomic.LoadUint32(seq)
		// lẻ = writer đang ở giữa KX_WRITE_BEGIN/KX_WRITE_END
		if before&1 == 0 {
			copy(dst, mm[:len(dst)])
			// seq đổi = writer đã ghi trong lúc ta copy → snapshot có thể bị xé
			if atomic.LoadUint32(seq) == before {
				// Chỉ kiểm magic SAU khi seq đã xác nhận nhất quán: magic không bị
				// writer chạm nên tự nó không nói được gì về tính nhất quán (F-02).
				m := binary.LittleEndian.Uint32(dst[shmOffMagic : shmOffMagic+4])
				outcome := seqlockOK
				if m != kxShmMagic {
					outcome = seqlockBadMagic
				}
				return seqlockResult{outcome: outcome, retries: retries, waited: p.now().Sub(start)}
			}
		}
		elapsed := p.now().Sub(start)
		remaining := p.deadline - elapsed
		if remaining <= 0 {
			return seqlockResult{outcome: seqlockDeadline, retries: retries, waited: elapsed}
		}
		retries++
		if attempt < p.spinYields || remaining < p.backoff+p.sleepSlack {
			p.yield()
			continue
		}
		p.sleep(p.backoff)
	}
}
