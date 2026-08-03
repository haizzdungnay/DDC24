package app

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// mapWritableSHM tạo một file cỡ size rồi mmap ghi được, mô phỏng vai writer
// (mkddc-core) trên shmfs.
func mapWritableSHM(t *testing.T, path string, size int) []byte {
	t.Helper()
	if err := os.WriteFile(path, make([]byte, size), 0o600); err != nil {
		t.Fatalf("write shm: %v", err)
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0o600)
	if err != nil {
		t.Fatalf("open shm: %v", err)
	}
	defer f.Close()
	mm, err := syscall.Mmap(int(f.Fd()), 0, size,
		syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
	if err != nil {
		t.Fatalf("mmap shm: %v", err)
	}
	t.Cleanup(func() { _ = syscall.Munmap(mm) })
	binary.LittleEndian.PutUint32(mm[shmOffMagic:], kxShmMagic)
	return mm
}

func seqPointer(mm []byte) *uint32 {
	return (*uint32)(unsafe.Pointer(&mm[shmOffSeq]))
}

// F-02: seq LẺ nghĩa là writer đang ở giữa KX_WRITE_BEGIN/KX_WRITE_END. Đường đọc
// cũ (os.ReadFile + validSHM) trả về snapshot đó vì magic vẫn hợp lệ — magic không
// bị writer chạm trong lúc ghi nên check magic luôn pass.
func TestShmReadRejectsSnapshotWhileWriterHoldsSeqlock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mkddc_plc_shm")
	mm := mapWritableSHM(t, path, kxPlcShmMinLen)
	client := &CoreClient{PLCShm: path}
	t.Cleanup(client.Close)

	// seq chẵn → đọc được
	atomic.StoreUint32(seqPointer(mm), 2)
	if _, err := client.readPLCShm(); err != nil {
		t.Fatalf("seq chẵn: readPLCShm err = %v; want nil", err)
	}

	// seq lẻ → PHẢI thất bại, dù magic vẫn đúng
	atomic.StoreUint32(seqPointer(mm), 3)
	if _, err := client.readPLCShm(); err == nil {
		t.Fatal("seq lẻ: readPLCShm err = nil; want lỗi (writer đang giữ seqlock)")
	}
	if !validSHM(mm[:kxPlcShmMinLen], kxPlcShmMinLen) {
		t.Fatal("magic phải vẫn hợp lệ — đó chính là lý do check magic không đủ")
	}
}

func TestShmReadRejectsMissingAndTooShortSegment(t *testing.T) {
	dir := t.TempDir()
	client := &CoreClient{PLCShm: filepath.Join(dir, "khong-ton-tai")}
	t.Cleanup(client.Close)
	if _, err := client.readPLCShm(); err == nil {
		t.Fatal("segment không tồn tại: err = nil; want lỗi")
	}

	short := filepath.Join(dir, "ngan")
	if err := os.WriteFile(short, make([]byte, kxPlcShmMinLen-1), 0o600); err != nil {
		t.Fatal(err)
	}
	client.PLCShm = short
	if _, err := client.readPLCShm(); err == nil {
		t.Fatal("segment ngắn hơn hợp đồng: err = nil; want lỗi")
	}
}

// Segment bị tạo lại (mkddc-core restart: shm_unlink + tạo mới) sinh inode mới.
// mmap cũ vẫn trỏ vào inode đã xoá và nội dung cũ VẪN có magic hợp lệ, nên nếu
// không so inode thì backend đọc mãi dữ liệu đóng băng của một segment đã chết.
func TestShmReadFollowsRecreatedSegment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mkddc_plc_shm")
	mm := mapWritableSHM(t, path, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(mm[offPLCScanCount:], 111)

	client := &CoreClient{PLCShm: path}
	t.Cleanup(client.Close)
	data, err := client.readPLCShm()
	if err != nil {
		t.Fatalf("lần đọc đầu: %v", err)
	}
	if got := binary.LittleEndian.Uint32(data[offPLCScanCount:]); got != 111 {
		t.Fatalf("scan_count = %d; want 111", got)
	}

	// Tạo lại segment với inode khác và nội dung khác
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	mm2 := mapWritableSHM(t, path, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(mm2[offPLCScanCount:], 222)

	data, err = client.readPLCShm()
	if err != nil {
		t.Fatalf("sau khi tạo lại: %v", err)
	}
	if got := binary.LittleEndian.Uint32(data[offPLCScanCount:]); got != 222 {
		t.Fatalf("scan_count = %d; want 222 (đang đọc segment đã chết?)", got)
	}
}

// Kịch bản thật của F-02: writer cập nhật nhiều field trong một lần giữ seqlock.
// Reader hợp lệ chỉ được thấy trạng thái TRƯỚC hoặc SAU, không bao giờ thấy trộn.
// Test đặt scan_count và scan_overrun luôn bằng nhau ở mọi trạng thái ổn định, nên
// một lần đọc bị xé sẽ lộ ra ngay bằng hai giá trị khác nhau.
func TestShmReadNeverObservesTornSnapshotUnderConcurrentWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mkddc_plc_shm")
	mm := mapWritableSHM(t, path, kxPlcShmMinLen)
	client := &CoreClient{PLCShm: path}
	t.Cleanup(client.Close)

	seq := seqPointer(mm)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := uint32(1); ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			atomic.AddUint32(seq, 1) // KX_WRITE_BEGIN → seq lẻ
			binary.LittleEndian.PutUint32(mm[offPLCScanCount:], i)
			// Cửa sổ ghi rộng ra để reader thực sự có cơ hội chen vào giữa hai field.
			for spin := 0; spin < 200; spin++ {
				_ = spin
			}
			binary.LittleEndian.PutUint32(mm[offPLCScanOverrun:], i)
			atomic.AddUint32(seq, 1) // KX_WRITE_END → seq chẵn
		}
	}()

	deadline := time.Now().Add(2 * time.Second)
	reads, torn, rejected := 0, 0, 0
	for time.Now().Before(deadline) {
		data, err := client.readPLCShm()
		if err != nil {
			rejected++
			continue
		}
		reads++
		count := binary.LittleEndian.Uint32(data[offPLCScanCount:])
		overrun := binary.LittleEndian.Uint32(data[offPLCScanOverrun:])
		if count != overrun {
			torn++
		}
	}
	close(stop)
	wg.Wait()

	if reads == 0 {
		t.Fatal("không có lần đọc nào thành công — test không chứng minh được gì")
	}
	if torn != 0 {
		t.Fatalf("thấy %d/%d snapshot BỊ XÉ — pattern seqlock không hoạt động", torn, reads)
	}
	t.Logf("đọc hợp lệ=%d, bị từ chối (writer đang ghi)=%d, bị xé=0", reads, rejected)
}

// Kiểm chứng ngược: chính kịch bản trên, đọc bằng os.ReadFile như đường cũ của
// F-02, DOES thấy snapshot bị xé. Đây là bằng chứng lỗi cũ là thật, không phải
// suy đoán lý thuyết. Test không fail nếu không bắt được (phụ thuộc scheduling),
// nhưng ghi lại số đo để lần sau còn đối chiếu.
func TestReadFileSnapshotCanTearProvingSeqlockIsRequired(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mkddc_plc_shm")
	mm := mapWritableSHM(t, path, kxPlcShmMinLen)

	seq := seqPointer(mm)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := uint32(1); ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			atomic.AddUint32(seq, 1)
			binary.LittleEndian.PutUint32(mm[offPLCScanCount:], i)
			for spin := 0; spin < 200; spin++ {
				_ = spin
			}
			binary.LittleEndian.PutUint32(mm[offPLCScanOverrun:], i)
			atomic.AddUint32(seq, 1)
		}
	}()

	deadline := time.Now().Add(2 * time.Second)
	reads, torn := 0, 0
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err != nil || !validSHM(data, kxPlcShmMinLen) {
			continue
		}
		reads++
		if binary.LittleEndian.Uint32(data[offPLCScanCount:]) !=
			binary.LittleEndian.Uint32(data[offPLCScanOverrun:]) {
			torn++
		}
	}
	close(stop)
	wg.Wait()

	t.Logf("đường cũ os.ReadFile + validSHM: %d/%d snapshot BỊ XÉ vẫn qua được check magic",
		torn, reads)
	if torn == 0 {
		t.Log("lần chạy này không bắt được tearing (phụ thuộc scheduling); " +
			"TestShmReadNeverObservesTornSnapshotUnderConcurrentWriter mới là gate")
	}
}

func TestSeqlockCopyRejectsUndersizedBuffers(t *testing.T) {
	mm := make([]byte, 4)
	if seqlockCopy(mm, make([]byte, 4)) {
		t.Fatal("mm ngắn hơn header: want false")
	}
	mm = make([]byte, 64)
	binary.LittleEndian.PutUint32(mm[shmOffMagic:], kxShmMagic)
	if seqlockCopy(mm, make([]byte, 4)) {
		t.Fatal("dst ngắn hơn header: want false")
	}
	if seqlockCopy(mm, make([]byte, 128)) {
		t.Fatal("dst dài hơn mm: want false")
	}
	if !seqlockCopy(mm, make([]byte, 64)) {
		t.Fatal("dst = mm, seq chẵn, magic đúng: want true")
	}
}
