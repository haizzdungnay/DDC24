package app

// T63-101 (PERF-API-01, Plan 63 §4.2) — deadline, fail-safe và bộ đếm của
// reader seqlock.

import (
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// AC T63-101: writer giữ seq lẻ vô hạn (chết giữa KX_WRITE_BEGIN/KX_WRITE_END)
// ⇒ lỗi, không treo, và trong khoảng deadline. Trần chặt "không ngủ quá hạn"
// được khoá bằng đồng hồ giả ở TestSeqlockCopyWithinNeverSleepsPastDeadline;
// ở đây là đồng hồ thật nên có dung sai lịch của máy chạy test.
//
// Thời gian đo bằng đồng hồ thật cộng cả lúc goroutine bị hệ điều hành hoãn:
// trên máy 4 lõi tải trung bình 10,9 (build C++ song song), 3/30 lần đo ra
// 2,2 / 3,1 / 8,7 ms trong khi thuật toán tự dừng ở 1,04–1,19 ms. Vì vậy trần
// "deadline + 1 ms" áp lên lần NHANH NHẤT trong tối đa shmDeadlineAttempts lần
// (lần nào đạt trần thì dừng); MỌI lần vẫn phải lỗi fail-safe, không bỏ cuộc
// trước deadline, và dừng dưới shmDeadlineHangLimit — trần bắt lỗi treo/thiếu
// deadline, không phụ thuộc lịch.
const (
	shmDeadlineAttempts  = 5
	shmDeadlineHangLimit = 50 * time.Millisecond
)

func TestShmReadFailsWithinDeadlineWhenWriterNeverReleases(t *testing.T) {
	client, mm := attachedPLCClient(t)
	before := client.plcSeg.metrics()
	atomic.StoreUint32(seqPointer(mm), 5)

	limit := shmSeqlockDeadline + time.Millisecond
	best, runs := time.Duration(1<<62), 0
	for runs < shmDeadlineAttempts && best > limit {
		runs++
		start := time.Now()
		_, err := client.readPLCShm()
		elapsed := time.Since(start)
		if err == nil {
			t.Fatal("seq lẻ vô hạn: err = nil; want lỗi fail-safe")
		}
		if !strings.Contains(err.Error(), "không đọc được snapshot nhất quán") {
			t.Fatalf("err = %v; want thông điệp snapshot không nhất quán", err)
		}
		if elapsed < shmSeqlockDeadline {
			t.Fatalf("bỏ cuộc sau %v, trước deadline %v", elapsed, shmSeqlockDeadline)
		}
		if elapsed > shmDeadlineHangLimit {
			t.Fatalf("lỗi sau %v; want < %v (reader không dừng ở deadline)", elapsed, shmDeadlineHangLimit)
		}
		if elapsed < best {
			best = elapsed
		}
	}
	// Dung sai 1 ms chỉ cho lịch của máy chạy test (goroutine bị hoãn); thuật toán
	// tự nó kết thúc tại deadline (đo trên host: xem t.Logf bên dưới).
	if best > limit {
		t.Fatalf("lần nhanh nhất trong %d lần lỗi sau %v; want ≤ %v (deadline + dung sai lịch)", runs, best, limit)
	}

	after := client.plcSeg.metrics()
	if after.Reads != before.Reads+uint64(runs) || after.Failures != before.Failures+uint64(runs) {
		t.Fatalf("metrics = %+v (trước %+v); want reads+%d, failures+%d", after, before, runs, runs)
	}
	if after.Retries <= before.Retries {
		t.Fatalf("retries = %d; want > %d", after.Retries, before.Retries)
	}
	if after.MaxWaitUS < uint64(shmSeqlockDeadline/time.Microsecond) {
		t.Fatalf("max_wait_us = %d; want ≥ deadline", after.MaxWaitUS)
	}
	t.Logf("lần nhanh nhất lỗi sau %v (%d lần đo), %d lần thử lại", best, runs, after.Retries-before.Retries)
}

type fakeSeqlockClock struct {
	now    time.Time
	yields int
	sleeps []time.Duration
	// sleepStarts ghi thời điểm (tính từ lần gọi policy) bắt đầu mỗi lần ngủ.
	sleepStarts []time.Time
	// onSleep chạy sau mỗi lần ngủ (writer giả nhả seqlock ở lần thứ n).
	onSleep func(n int)
}

func (c *fakeSeqlockClock) policy(deadline, backoff, slack time.Duration, spin int) seqlockPolicy {
	return seqlockPolicy{
		deadline:   deadline,
		spinYields: spin,
		backoff:    backoff,
		sleepSlack: slack,
		now:        func() time.Time { return c.now },
		sleep: func(d time.Duration) {
			c.sleeps = append(c.sleeps, d)
			c.sleepStarts = append(c.sleepStarts, c.now)
			c.now = c.now.Add(d)
			if c.onSleep != nil {
				c.onSleep(len(c.sleeps))
			}
		},
		yield: func() {
			c.yields++
			c.now = c.now.Add(time.Microsecond)
		},
	}
}

func fakeSegment(seq uint32) []byte {
	mm := make([]byte, 64)
	binary.LittleEndian.PutUint32(mm[shmOffMagic:], kxShmMagic)
	binary.LittleEndian.PutUint32(mm[shmOffSeq:], seq)
	return mm
}

// Không vòng nào vô hạn, và không lần ngủ nào được BẮT ĐẦU khi hạn còn lại không
// chứa nổi cả lần ngủ lẫn độ vượt của nó: lần đọc thất bại kết thúc ĐÚNG tại
// deadline. Deadline 1 ms, backoff 300 µs, slack 100 µs: 3 lần nhường (3 µs) →
// ngủ ở 3 µs và 303 µs → từ 603 µs hạn còn 397 µs < 400 µs nên chỉ nhường tới hết.
func TestSeqlockCopyWithinNeverSleepsPastDeadline(t *testing.T) {
	const deadline, backoff, slack = time.Millisecond, 300 * time.Microsecond, 100 * time.Microsecond
	clock := &fakeSeqlockClock{now: time.Unix(1_790_000_000, 0)}
	start := clock.now
	mm := fakeSegment(1) // writer không bao giờ nhả
	res := seqlockCopyWithin(mm, make([]byte, len(mm)), clock.policy(deadline, backoff, slack, 3))

	if res.outcome != seqlockDeadline {
		t.Fatalf("outcome = %v; want seqlockDeadline", res.outcome)
	}
	if got := clock.now.Sub(start); got != deadline || res.waited != deadline {
		t.Fatalf("thời gian đã trôi = %v, waited = %v; want đúng %v", got, res.waited, deadline)
	}
	if len(clock.sleeps) != 2 {
		t.Fatalf("sleeps = %v; want 2 lần ngủ %v", clock.sleeps, backoff)
	}
	for i, at := range clock.sleepStarts {
		if remaining := deadline - at.Sub(start); remaining < backoff+slack {
			t.Fatalf("lần ngủ %d bắt đầu khi hạn còn %v < backoff+slack %v", i, remaining, backoff+slack)
		}
	}
	if clock.yields != 3+397 {
		t.Fatalf("yields = %d; want 3 lần đầu + 397 lần ở phần đuôi", clock.yields)
	}
	if res.retries != uint64(clock.yields+len(clock.sleeps)) {
		t.Fatalf("retries = %d; want %d", res.retries, clock.yields+len(clock.sleeps))
	}
}

func TestSeqlockCopyWithinSucceedsOnceWriterReleases(t *testing.T) {
	clock := &fakeSeqlockClock{now: time.Unix(1_790_000_000, 0)}
	mm := fakeSegment(1)
	clock.onSleep = func(n int) {
		if n == 2 {
			binary.LittleEndian.PutUint32(mm[shmOffSeq:], 2) // KX_WRITE_END
		}
	}
	res := seqlockCopyWithin(mm, make([]byte, len(mm)), clock.policy(time.Millisecond, 50*time.Microsecond, 100*time.Microsecond, 2))
	if res.outcome != seqlockOK {
		t.Fatalf("outcome = %v; want seqlockOK", res.outcome)
	}
	if res.retries != 4 || res.waited != 102*time.Microsecond {
		t.Fatalf("retries = %d waited = %v; want 4 lần thử lại, 102µs", res.retries, res.waited)
	}
}

// Magic sai là lỗi hợp đồng, không phải writer đang ghi: trả ngay, không thử lại,
// và không tính vào failures (bộ đếm dành cho hết deadline).
func TestSeqlockCopyWithinBadMagicDoesNotRetry(t *testing.T) {
	clock := &fakeSeqlockClock{now: time.Unix(1_790_000_000, 0)}
	mm := fakeSegment(2)
	binary.LittleEndian.PutUint32(mm[shmOffMagic:], 0xDEADBEEF)
	res := seqlockCopyWithin(mm, make([]byte, len(mm)), clock.policy(time.Millisecond, 50*time.Microsecond, 100*time.Microsecond, 2))
	if res.outcome != seqlockBadMagic || res.retries != 0 {
		t.Fatalf("res = %+v; want seqlockBadMagic, 0 lần thử lại", res)
	}
	var stats shmReadStats
	stats.observe(res)
	if got := stats.snapshot(); got.Reads != 1 || got.Failures != 0 {
		t.Fatalf("metrics = %+v; want reads=1 failures=0", got)
	}
}

func coreClientTestApp(t *testing.T) (*App, string, *CoreClient, []byte) {
	t.Helper()
	dir := t.TempDir()
	plcPath := filepath.Join(dir, "mkddc_plc_shm")
	plc := mapWritableSHM(t, plcPath, kxPlcShmMinLen)
	atomic.StoreUint32(seqPointer(plc), 2)
	ioPath := filepath.Join(dir, "mkddc_io_shm")
	io := mapWritableSHM(t, ioPath, kxIOShmMinLen)
	atomic.StoreUint32(seqPointer(io), 2)
	client := &CoreClient{SockPath: filepath.Join(dir, "core.sock"), IOShm: ioPath, PLCShm: plcPath}
	t.Cleanup(client.Close)
	app, token := newTestAppWithRole(t, RoleAdmin, client)
	return app, token, client, plc
}

func shmGetJSON(t *testing.T, app *App, token, path string) (int, []byte) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	return w.Code, w.Body.Bytes()
}

// Fail-safe giữ nguyên: writer kẹt ⇒ `/points` vẫn 503, KHÔNG 200 với dữ liệu cũ.
func TestPointsStays503WhenWriterNeverReleasesSeqlock(t *testing.T) {
	app, token, _, plc := coreClientTestApp(t)
	if code, body := shmGetJSON(t, app, token, "/api/v1/points"); code != http.StatusOK {
		t.Fatalf("seq chẵn: status = %d body=%s; want 200", code, body)
	}
	atomic.StoreUint32(seqPointer(plc), 7)
	code, body := shmGetJSON(t, app, token, "/api/v1/points")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("seq lẻ vô hạn: status = %d body=%s; want 503", code, body)
	}
	if !strings.Contains(string(body), "không đọc được snapshot nhất quán") {
		t.Fatalf("body = %s; want lý do snapshot không nhất quán", body)
	}
}

// AC T63-101: counter retry/fail đọc được qua endpoint metric sẵn có.
func TestSystemStatusExposesSHMReaderCounters(t *testing.T) {
	app, token, _, plc := coreClientTestApp(t)
	atomic.StoreUint32(seqPointer(plc), 9)
	if code, _ := shmGetJSON(t, app, token, "/api/v1/points"); code != http.StatusServiceUnavailable {
		t.Fatalf("points status = %d; want 503", code)
	}
	atomic.StoreUint32(seqPointer(plc), 10)

	code, body := shmGetJSON(t, app, token, "/api/v1/system/status")
	if code != http.StatusOK {
		t.Fatalf("status = %d body=%s", code, body)
	}
	var resp struct {
		SHMReader *SHMReaderMetrics `json:"shm_reader"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	m := resp.SHMReader
	if m == nil {
		t.Fatalf("thiếu shm_reader trong %s", body)
	}
	if m.DeadlineUS != 1000 {
		t.Fatalf("deadline_us = %d; want 1000", m.DeadlineUS)
	}
	if _, err := time.Parse(time.RFC3339, m.Since); err != nil {
		t.Fatalf("since = %q; want RFC3339 lúc web khởi động", m.Since)
	}
	// system/status tự đọc plc lần nữa (seq đã chẵn) ⇒ ít nhất 2 lần đọc, 1 lần hỏng.
	if m.PLC.Failures < 1 || m.PLC.Retries < 1 || m.PLC.Reads < 2 {
		t.Fatalf("plc = %+v; want failures ≥ 1, retries ≥ 1, reads ≥ 2", m.PLC)
	}
	if m.IO.Failures != 0 || m.IO.Reads < 1 {
		t.Fatalf("io = %+v; want đọc được, 0 lỗi", m.IO)
	}
}

// Core client giả (không phải CoreClient thật) không có nguồn bộ đếm: trường
// vắng hẳn chứ không phải một khối số 0 trông như "không lỗi".
func TestSystemStatusOmitsSHMReaderWithoutRealCoreClient(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleAdmin, fakeCore{})
	code, body := shmGetJSON(t, app, token, "/api/v1/system/status")
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if strings.Contains(string(body), "shm_reader") {
		t.Fatalf("body có shm_reader dù không có reader thật: %s", body)
	}
}
