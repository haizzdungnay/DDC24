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

import (
	"encoding/binary"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	// Layout header dùng chung của kx_io_shm_t và kx_plc_shm_t
	// (contracts/shm/mkddc_shm.h): uint32 magic; volatile uint32 seq;
	shmOffMagic  = 0
	shmOffSeq    = 4
	shmHeaderLen = 8

	// Số lần thử lại khi writer đang ghi. Khớp con số 5 mà cả hai hiện thực C++
	// dùng. Retry hết lượt = ĐỌC THẤT BẠI, caller phải xử lý fail-safe.
	shmSeqlockMaxRetry = 5
)

// shmSegment giữ một mmap read-only của một segment SHM, kèm đường đọc seqlock.
// Không an toàn để copy (chứa Mutex) — luôn dùng qua con trỏ.
type shmSegment struct {
	mu     sync.Mutex
	path   string // path đã attach; khác path yêu cầu → re-attach
	data   []byte // mmap read-only, MAP_SHARED
	inode  uint64 // phát hiện segment bị tạo lại (core restart)
	device uint64
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
// seqlock suốt cả shmSeqlockMaxRetry lần thử. Caller PHẢI xử lý lỗi fail-safe —
// dùng lại dữ liệu cũ ở đường quyết định là đúng loại lỗi mà F-03 đã chỉ ra ở
// phía HMI.
func (s *shmSegment) read(path string, minLen int) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.attachLocked(path, minLen); err != nil {
		return nil, err
	}
	dst := make([]byte, len(s.data))
	if !seqlockCopy(s.data, dst) {
		return nil, fmt.Errorf("shm %s: không đọc được snapshot nhất quán", path)
	}
	return dst, nil
}

// seqlockCopy hiện thực đúng pattern reader mà contracts/shm/mkddc_shm.h bắt buộc.
//
// atomic.LoadUint32 dùng để đọc `seq`: mô hình bộ nhớ của Go cho atomic là
// sequentially consistent, nên hai lần đọc seq không thể bị đổi chỗ với phép copy
// ở giữa — đúng vai trò của __ATOMIC_ACQUIRE ở bản C++. Con trỏ vào mmap luôn
// thẳng hàng 4 byte vì mmap trả về địa chỉ thẳng hàng trang.
func seqlockCopy(mm []byte, dst []byte) bool {
	if len(mm) < shmHeaderLen || len(dst) < shmHeaderLen || len(dst) > len(mm) {
		return false
	}
	seq := (*uint32)(unsafe.Pointer(&mm[shmOffSeq]))
	for i := 0; i < shmSeqlockMaxRetry; i++ {
		before := atomic.LoadUint32(seq)
		if before&1 != 0 {
			continue // lẻ = writer đang ở giữa KX_WRITE_BEGIN/KX_WRITE_END
		}
		copy(dst, mm[:len(dst)])
		if atomic.LoadUint32(seq) != before {
			continue // writer đã ghi trong lúc ta copy → snapshot có thể bị xé
		}
		// Chỉ kiểm magic SAU khi seq đã xác nhận nhất quán: magic không bị writer
		// chạm nên tự nó không nói được gì về tính nhất quán (đó là lỗi F-02).
		m := binary.LittleEndian.Uint32(dst[shmOffMagic : shmOffMagic+4])
		return m == kxShmMagic || m == 0x4B584407
	}
	return false
}
