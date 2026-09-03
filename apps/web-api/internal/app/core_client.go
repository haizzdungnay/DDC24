package app

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"mkddc-web/internal/capabilities"
)

const (
	kxShmMagic    = 0x4B584406
	defaultIOShm  = "/dev/shm/mkddc_io_shm"
	defaultPLCShm = "/dev/shm/mkddc_plc_shm"
)

// Stay below JSON's exact integer range while avoiding collisions after a Web restart.
var webCommandID = uint64(time.Now().UnixNano()) & ((1 << 52) - 1)

var errCoreUnavailable = errors.New("core unavailable")

type CoreStatusClient interface {
	ReadStatus(ctx context.Context) (CoreStatus, error)
}

type CoreClient struct {
	SockPath string
	IOShm    string
	PLCShm   string

	// F-02: hai segment SHM được mmap và đọc theo pattern seqlock mà
	// contracts/shm/mkddc_shm.h bắt buộc (xem shm_reader.go). Attach là lazy nên struct
	// literal `&CoreClient{IOShm: ..., PLCShm: ...}` vẫn dùng được như trước.
	ioSeg  shmSegment
	plcSeg shmSegment

	// snapshotMu/snapshotInFlight dồn (coalesce) mọi lệnh gọi ReadPointSnapshot
	// đồng thời thành MỘT round-trip `point_snapshot` duy nhất tới Core. Core
	// (`WebIpc::drain`) chỉ chấp nhận đúng MỘT `point_snapshot` mỗi scan cycle
	// (periodMs=1000 trên Foxlinx) — request thứ hai trong cùng cycle bị từ
	// chối "busy". Không dồn thì hai nguồn độc lập trong chính web-api này
	// (HistorianShadowScheduler tick 100ms + Programming Runtime Monitor poll
	// ~1 Hz từ FE) tự đụng nhau, và 40% request `/programming/runtime/monitor`
	// nhận 503 dù Core hoàn toàn khoẻ mạnh — quan sát thật trên board Foxlinx
	// 2026-08-14 (journal `mkddc-web`, xen kẽ status=200/503 dur_ms~650-720).
	snapshotMu       sync.Mutex
	snapshotInFlight *coreSnapshotCall

	// webIPCGate giới hạn số kết nối web_ipc ĐỒNG THỜI. Xem
	// `coreWebIPCMaxInFlight` để biết vì sao con số là 3 chứ không phải "bao
	// nhiêu cũng được". Khởi tạo lazy để mọi struct literal `&CoreClient{...}`
	// đang có vẫn dùng được, giống cách `ioSeg`/`plcSeg` attach lazy.
	webIPCGateOnce sync.Once
	webIPCGate     chan struct{}
}

/* Ba hằng dưới đây được rút ra từ CHÍNH cấu hình server, không phải chọn cho
 * "trông hợp lý". `apps/core/adapters/ipc/web_ipc.cpp`:
 *
 *   ::listen(fd_, 4)                  → backlog 4
 *   max_clients          = 4          → tối đa 4 client cùng lúc
 *   max_accept_attempts  = 4          → nhận tối đa 4 kết nối MỖI LẦN poll
 *
 * và `WebIpc::poll()` chạy đúng MỘT LẦN mỗi scan cycle — trên Foxlinx
 * `core.base_step_ms=1000`, tức **một giây một lần**.
 *
 * CƠ CHẾ HỎNG (đo ra, không phải suy đoán — giả thuyết đầu tiên "timeout dial
 * 100 ms quá ngắn" đã bị chính test bác bỏ). Với Unix socket, `connect()` KHÔNG
 * chờ server gọi `accept()`: nó thành công ngay khi hàng đợi accept còn chỗ, và
 * **hỏng NGAY bằng ECONNREFUSED khi hàng đợi đầy** — khác TCP, không có SYN
 * retry. Thứ quyết định vì thế KHÔNG phải timeout, mà là SỐ CÚ DIAL ĐỒNG THỜI
 * so với độ sâu hàng đợi (4).
 *
 * `sendWebIPC` mở một kết nối MỚI cho mỗi request, và trước bản vá không có hạn
 * mức nào. Một trang UI poll alarms + overview + runtime + point-catalog cùng
 * lúc vượt 4 cú dial trong một chu kỳ rất dễ ⇒ ECONNREFUSED ⇒
 * `errCoreUnavailable` ⇒ `WARN alarms_read degraded`, trong khi core hoàn toàn
 * khoẻ mạnh.
 *
 * Đo trên bo 2026-09-03, cùng mức tải ~90–105 request/phút: binary 30-08 hỏng
 * 15,7%, binary 03-09 hỏng ~32%; ở mức 1,1 request/phút chỉ 2,2%. Tỉ lệ đi theo
 * TẦN SUẤT DIAL, không theo phiên bản mã. `TestWebIPCConcurrentReadsDoNot-
 * ExhaustCoreBacklog` dựng lại đúng mô hình accept ấy — backlog 4 đặt bằng
 * syscall, vì `net.Listen` dùng somaxconn và che mất hẳn lỗi: không hạn mức thì
 * 19/24 request hỏng, có hạn mức thì 0/24.
 *
 * KHÔNG sửa bằng cách giữ kết nối thường trực: `web_ipc.cpp` không có eviction
 * idle, nên một pool 3 kết nối sẽ chiếm chết 3 trong 4 slot của core và bỏ đói
 * mọi client khác. Giữ mô hình one-shot, chỉ chặn số cú dial đồng thời. */
const (
	// coreWebIPCMaxInFlight ≤ max_clients-1 của core: vượt quá thì core
	// `::accept4` rồi `::close` ngay, và phía client thấy dial THÀNH CÔNG
	// nhưng write/read hỏng — một kiểu lỗi khó lần hơn hẳn ECONNREFUSED.
	// Chừa 1 slot cho HMI/công cụ khác.
	coreWebIPCMaxInFlight = 3
	// Timeout dial KHÔNG phải thứ sửa lỗi (xem cơ chế trên). Vẫn nới từ 100 ms
	// vì 100 ms không có cơ sở nào so với nhịp 1 s của server; nó chỉ còn tác
	// dụng ở ca socket tồn tại mà peer chậm hoàn tất.
	coreWebIPCDialTimeout = 2500 * time.Millisecond
	// Cái này thì đo được tác dụng: kết nối nằm trong hàng đợi cho tới khi core
	// `poll()` ở biên chu kỳ kế, nên round-trip thực tế trên bo là 800–1600 ms.
	// Deadline 2 s cũ vừa đúng một chu kỳ — không còn dư địa cho jitter.
	coreWebIPCDeadline = 5 * time.Second
	// Giữ nhanh cho thăm dò readiness (`/api/v1/system`): ở đó câu hỏi là
	// "socket có tồn tại không", không phải "core trả lời được không".
	coreWebIPCProbeTimeout = 300 * time.Millisecond
)

// acquireWebIPCSlot chặn cho tới khi còn chỗ trong hạn mức đồng thời, hoặc tới
// khi ctx hết hạn. Tôn trọng ctx là bắt buộc: nếu không, một core treo sẽ dồn
// toàn bộ handler HTTP vào hàng đợi này thay vì để chúng hết hạn bình thường.
func (c *CoreClient) acquireWebIPCSlot(ctx context.Context) (func(), error) {
	c.webIPCGateOnce.Do(func() {
		c.webIPCGate = make(chan struct{}, coreWebIPCMaxInFlight)
	})
	select {
	case c.webIPCGate <- struct{}{}:
		return func() { <-c.webIPCGate }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type coreSnapshotCall struct {
	done   chan struct{}
	result RuntimePointSnapshot
	err    error
}

// Close nhả mmap của hai segment SHM. An toàn khi gọi nhiều lần.
func (c *CoreClient) Close() {
	c.ioSeg.close()
	c.plcSeg.close()
}

// readIOShm / readPLCShm là ĐƯỜNG DUY NHẤT được phép đọc SHM trong backend.
// Không dùng os.ReadFile cho hai segment này — xem F-02 trong shm_reader.go.
func (c *CoreClient) readIOShm() ([]byte, error) {
	return c.ioSeg.read(c.IOShm, kxIOShmMinLen)
}

// decodeBoardCap đọc `BOARD_CAP_MAP` mà iobus chở vào `io_shm` (`ISS-PIO-11`).
//
// Segment ngắn hơn ABI v6 nghĩa là producer đời cũ: nó KHÔNG BAO GIỜ điền hai
// trường này, nên đọc padding ra 0 rồi coi là "bo không có năng lực nào" sẽ là
// một lời khẳng định bịa. Cả ca đó lẫn ca `valid = 0` đều trả về `Known: false`
// — "chưa hỏi được" — và mọi consumer fail-closed từ đó.
func decodeBoardCap(data []byte) capabilities.BoardCap {
	if len(data) < kxIOShmBoardCapLen || data[offIOBoardCapValid] != 1 {
		return capabilities.BoardCap{}
	}
	return capabilities.BoardCap{
		Map:   binary.LittleEndian.Uint16(data[offIOBoardCapMap : offIOBoardCapMap+2]),
		Known: true,
	}
}

func (c *CoreClient) readPLCShm() ([]byte, error) {
	return c.plcSeg.read(c.PLCShm, kxPlcShmMinLen)
}

type CoreStatus struct {
	CoreAvailable bool
	IobusPresent  bool
	Versions      VersionStatus
	IOP           IOPStatus
	Scan          ScanStatus
	// BoardCap là bản đồ năng lực bo đọc từ `io_shm`. Zero value nghĩa là CHƯA
	// HỎI ĐƯỢC, không phải "bo không có năng lực nào" — mọi CoreStatusClient
	// giả lập vì thế mặc định rơi vào ca fail-closed đúng.
	BoardCap capabilities.BoardCap
}

type VersionStatus struct {
	MCUFW string `json:"mcu_fw,omitempty"`
	Iobus string `json:"iobus,omitempty"`
	Core  string `json:"core,omitempty"`
	Web   string `json:"web"`
}

type IOPStatus struct {
	Status       string   `json:"status"`
	CRCErrors    uint32   `json:"crc_errors"`
	Timeouts     uint32   `json:"timeouts"`
	SeqErrors    uint32   `json:"seq_errors"`
	LastIORespMS *uint32  `json:"last_io_resp_ms,omitempty"`
	MaxPollGapMS *float64 `json:"max_poll_gap_ms,omitempty"`
}

type ScanStatus struct {
	Count   uint32 `json:"count"`
	Overrun uint32 `json:"overrun"`
}

type webIPCResponse struct {
	ID                    uint64           `json:"id"`
	Result                string           `json:"result"`
	AppliedValue          any              `json:"applied_value,omitempty"`
	ActiveSource          string           `json:"active_source,omitempty"`
	RemainingTTLS         uint32           `json:"remaining_ttl_s,omitempty"`
	Error                 string           `json:"error,omitempty"`
	AlarmID               string           `json:"alarmId,omitempty"`
	Alarms                []coreAlarmState `json:"alarms,omitempty"`
	SnapshotID            uint64           `json:"snapshotId,omitempty"`
	SnapshotObservedAtUTC string           `json:"snapshotObservedAtUtc,omitempty"`
	CapturedMonotonicNs   uint64           `json:"capturedMonotonicNs,omitempty"`
	SafeState             bool             `json:"safeState,omitempty"`
	// SafeStateNoControllerOnly: true CHỈ KHI safe-state đến từ trigger T7
	// (no_controller) đơn độc — không có iop_fault/stale/graph_input_bad/
	// overrun đi kèm. Xem apps/core/domain/safety/safe_state.hpp §5.2 và
	// runtime_point_snapshot.hpp. Dùng để không chặn Commission khi lý do
	// duy nhất là "chưa có Program nào đang thật sự điều khiển output" —
	// đúng điều Commission sẽ giải quyết.
	SafeStateNoControllerOnly bool                 `json:"safeStateNoControllerOnly,omitempty"`
	Task                      *RuntimeTaskSnapshot `json:"task,omitempty"`
	// T60-011 — `programs` KHÔNG có `omitempty` và không được thêm vào: struct
	// này chỉ dùng để DECODE, và điều cần giữ là sự khác nhau giữa "khoá vắng"
	// (nil ⇒ Core đời cũ ⇒ UNAVAILABLE) và "mảng rỗng" ([] ⇒ Core sống, hệ
	// không có Program nào). `encoding/json` giữ đúng sự phân biệt đó khi
	// unmarshal vào `[]T`; đặt `omitempty` ở đây chỉ làm người đọc sau này
	// tưởng hai thứ ấy là một.
	Programs          []RuntimeProgramSnapshot `json:"programs"`
	ProgramsTruncated bool                     `json:"programsTruncated"`
	Points            []RuntimePoint           `json:"points,omitempty"`
	Schedules         []coreScheduleState      `json:"schedules,omitempty"`
}

// coreScheduleState là trạng thái runtime lịch do controller trả về
// (SCHD-152). Đây là SỰ THẬT; cấu hình backend giữ chỉ là ý định.
type coreScheduleState struct {
	ScheduleID               string                    `json:"scheduleId"`
	Active                   bool                      `json:"active"`
	EffectiveValue           float64                   `json:"effectiveValue"`
	ValueSource              string                    `json:"valueSource"`
	SourceExceptionID        string                    `json:"sourceExceptionId"`
	NextTransitionWeekSecond int                       `json:"nextTransitionWeekSecond"`
	ErrorCode                string                    `json:"errorCode"`
	Targets                  []coreScheduleTargetState `json:"targets"`
}

type coreScheduleTargetState struct {
	TargetID     string  `json:"targetId"`
	Written      bool    `json:"written"`
	WrittenValue float64 `json:"writtenValue"`
	ErrorCode    string  `json:"errorCode"`
	OverriddenBy string  `json:"overriddenBy"`
}

// ReadScheduleStates hỏi controller trạng thái runtime của mọi lịch.
// Core không trả lời ⇒ trả errCoreUnavailable, và backend hiển thị gạch ngang
// chứ KHÔNG tự tính giá trị hiệu lực ở phía mình.
func (c *CoreClient) ReadScheduleStates(ctx context.Context) ([]coreScheduleState, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	resp, err := c.sendWebIPC(ctx, map[string]any{
		"id":   atomic.AddUint64(&webCommandID, 1),
		"op":   "schedule_state",
		"user": "web",
	})
	if err != nil {
		return nil, err
	}
	if resp.Result == "rejected" {
		return nil, fmt.Errorf("core rejected schedule_state: %s", resp.Error)
	}
	return resp.Schedules, nil
}

type coreAlarmState struct {
	ID             string   `json:"id"`
	AlarmSettingID string   `json:"alarmSettingId"`
	Time           string   `json:"time"`
	Status         string   `json:"status"`
	SourcePointID  string   `json:"sourcePointId"`
	Value          any      `json:"value"`
	TriggerLevel   string   `json:"triggerLevel"`
	Threshold      *float64 `json:"threshold"`
	Priority       string   `json:"priority"`
	Label          string   `json:"label"`
	AlarmType      int      `json:"alarmType"`
	Occurrence     uint64   `json:"occurrence"`
	Active         bool     `json:"active"`
}

func NewCoreClient(cfg Config) *CoreClient {
	return &CoreClient{SockPath: cfg.CoreSock, IOShm: defaultIOShm, PLCShm: defaultPLCShm}
}

func (c *CoreClient) ReadStatus(ctx context.Context) (CoreStatus, error) {
	status := CoreStatus{
		Versions: VersionStatus{},
		IOP:      IOPStatus{Status: "fault"},
		Scan:     ScanStatus{},
	}
	var firstErr error
	scan, scanErr := c.readPLCStatus()
	if scanErr == nil {
		status.Scan = scan
		status.CoreAvailable = true
	} else if c.coreSocketReady(ctx) {
		status.CoreAvailable = true
	} else {
		firstErr = fmt.Errorf("core socket unavailable")
	}
	// MỘT lần đọc `io_shm` cho cả trạng thái IOP lẫn bản đồ năng lực. Đọc hai
	// lần sẽ lấy về hai ảnh chụp seqlock khác nhau, và khi đó `IOP` và
	// `BoardCap` trong cùng một `CoreStatus` có thể mô tả hai thời điểm khác
	// nhau — một sự không nhất quán không ai nhìn thấy cho tới khi nó quan
	// trọng.
	if data, err := c.readIOShm(); err == nil {
		status.IOP = decodeIOStatus(data)
		status.BoardCap = decodeBoardCap(data)
		status.IobusPresent = true
	} else if firstErr == nil {
		firstErr = err
	}
	if scanErr != nil && firstErr == nil {
		firstErr = scanErr
	}
	return status, firstErr
}

func (c *CoreClient) ReadPoints(ctx context.Context) ([]PointDTO, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	plcData, err := c.readPLCShm()
	if err != nil {
		// REV-BE-07: nuốt lỗi ở đây làm "core chết" trông giống hệt "thiết bị
		// không có point nào". `GET /api/v1/points` đáp 200 với `[]`, WS đẩy một
		// bản cập nhật rỗng thay vì khung 503 mà nó đã có sẵn mã để phát, và
		// historian ghi sự cố thành "không có point nào" thay vì bỏ qua mẫu —
		// giao diện hiện bảng rỗng kèm huy hiệu kết nối màu khoẻ. Mọi nơi gọi
		// đều đã xử lý `err != nil` đúng; chỉ hàm này là chưa nói ra.
		return nil, err
	}
	// Read io_shm for AI unit strings (best-effort; nil on failure = empty units)
	ioData, _ := c.readIOShm()
	return decodePoints(plcData, ioData), nil
}

// ReadPointSnapshot dồn mọi caller đồng thời vào một leader duy nhất — xem
// giải thích ở field `snapshotMu`/`snapshotInFlight`. Caller theo sau chỉ chờ
// kết quả của leader (hoặc bỏ cuộc theo ctx của chính mình); leader luôn chạy
// round-trip thật với context riêng để một caller huỷ ngang không làm hỏng
// kết quả mà các caller khác đang chờ chung.
func (c *CoreClient) ReadPointSnapshot(ctx context.Context) (RuntimePointSnapshot, error) {
	c.snapshotMu.Lock()
	if call := c.snapshotInFlight; call != nil {
		c.snapshotMu.Unlock()
		select {
		case <-call.done:
			return call.result, call.err
		case <-ctx.Done():
			return RuntimePointSnapshot{}, ctx.Err()
		}
	}
	call := &coreSnapshotCall{done: make(chan struct{})}
	c.snapshotInFlight = call
	c.snapshotMu.Unlock()

	call.result, call.err = c.readPointSnapshotOnce(context.Background())
	close(call.done)

	c.snapshotMu.Lock()
	if c.snapshotInFlight == call {
		c.snapshotInFlight = nil
	}
	c.snapshotMu.Unlock()

	return call.result, call.err
}

func (c *CoreClient) readPointSnapshotOnce(ctx context.Context) (RuntimePointSnapshot, error) {
	id := atomic.AddUint64(&webCommandID, 1)
	resp, err := c.sendWebIPC(ctx, map[string]any{"id": id, "op": "point_snapshot", "user": "web"})
	if err != nil {
		return RuntimePointSnapshot{}, err
	}
	if resp.ID != id {
		return RuntimePointSnapshot{}, fmt.Errorf("point snapshot response id mismatch: got %d want %d", resp.ID, id)
	}
	if resp.Result != "accepted" {
		return RuntimePointSnapshot{}, fmt.Errorf("core rejected point snapshot: %s", resp.Error)
	}
	return RuntimePointSnapshot{
		SnapshotID:                resp.SnapshotID,
		SnapshotObservedAtUTC:     resp.SnapshotObservedAtUTC,
		CapturedMonotonicNs:       resp.CapturedMonotonicNs,
		SafeState:                 resp.SafeState,
		SafeStateNoControllerOnly: resp.SafeStateNoControllerOnly,
		Task:                      resp.Task,
		// Gán thẳng, KHÔNG `append(make(...), ...)`: một lần "chuẩn hoá" như
		// vậy sẽ biến nil thành slice rỗng và xoá mất đúng thông tin phân biệt
		// Core-đời-cũ với Core-không-có-Program.
		Programs:          resp.Programs,
		ProgramsTruncated: resp.ProgramsTruncated,
		Points:            resp.Points,
	}, nil
}

func (c *CoreClient) ForcePoint(ctx context.Context, id string, value any, release bool) (PointDTO, error) {
	return c.ForcePointTTL(ctx, id, value, release, 0, "web")
}

// ForcePointTTL là đường ghi có thời hạn: `ttlS` được chuyển NGUYÊN VẸN xuống
// Core, nơi `scan_loop` tự nhả lệnh khi hết hạn (PA3-107).
//
// Không có bất kỳ hẹn giờ nào ở tầng này. Một `time.AfterFunc` trong web-api sẽ
// biến "restart mkddc-web" thành "output kẹt ép tay vĩnh viễn" — đúng lớp lỗi
// mà PA3-F05 phải loại bỏ.
func (c *CoreClient) ForcePointTTL(ctx context.Context, id string, value any, release bool, ttlS uint32, user string) (PointDTO, error) {
	if strings.TrimSpace(user) == "" {
		user = "web"
	}
	point, err := c.CommandPoint(ctx, id, value, release, ttlS, user)
	if errors.Is(err, errCoreUnavailable) {
		return degradedPoint(id, value, "core_unavailable"), nil
	}
	return point, err
}

// CommandPoint is the single Core mutation path used by both Web and local HMI.
// ttlS is enforced by Core for a manual override; zero means no automatic release.
func (c *CoreClient) CommandPoint(ctx context.Context, id string, value any, release bool, ttlS uint32, user string) (PointDTO, error) {
	/* Đường ghi cũng đi qua cùng một hạn mức: không thì một loạt lệnh ghi
	 * đồng thời vẫn vượt `max_clients` của core và làm hỏng cả đường đọc. */
	releaseSlot, err := c.acquireWebIPCSlot(ctx)
	if err != nil {
		return PointDTO{}, err
	}
	defer releaseSlot()

	conn, err := c.dialCore(ctx)
	if err != nil {
		return PointDTO{}, errCoreUnavailable
	}
	defer conn.Close()
	deadline := time.Now().Add(coreWebIPCDeadline)
	_ = conn.SetDeadline(deadline)

	op := "write"
	if release {
		op = "release"
	}
	cmd := map[string]any{
		"id":     atomic.AddUint64(&webCommandID, 1),
		"op":     op,
		"point":  coreCommandPointID(id),
		"source": "manual",
		"user":   user,
	}
	if ttlS > 0 {
		cmd["ttlS"] = ttlS
	}
	if !release {
		if b, ok := value.(bool); ok {
			if b {
				cmd["value"] = 1
			} else {
				cmd["value"] = 0
			}
		} else {
			cmd["value"] = value
		}
	}
	line, err := json.Marshal(cmd)
	if err != nil {
		return PointDTO{}, fmt.Errorf("marshal web ipc command: %w", err)
	}
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return PointDTO{}, errCoreUnavailable
	}
	respLine, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return PointDTO{}, errCoreUnavailable
	}
	var resp webIPCResponse
	if err := json.Unmarshal(respLine, &resp); err != nil {
		return PointDTO{}, fmt.Errorf("parse web ipc response: %w", err)
	}
	if resp.Result == "rejected" {
		return degradedPoint(id, value, "rejected:"+resp.Error), fmt.Errorf("core rejected %s: %s", id, resp.Error)
	}
	point := PointDTO{
		ID:        id,
		Name:      id,
		Kind:      pointKindFromID(id),
		Value:     resp.AppliedValue,
		Quality:   "good",
		Source:    "core",
		Priority:  resp.ActiveSource,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Forced:    !release,
	}
	if resp.RemainingTTLS > 0 {
		point.OverrideExpiresInS = &resp.RemainingTTLS
	}
	return point, nil
}

// QueryPoint obtains the authoritative effective value/source without mutating a slot.
func (c *CoreClient) QueryPoint(ctx context.Context, id, user string) (PointDTO, error) {
	cmd := map[string]any{
		"id":     atomic.AddUint64(&webCommandID, 1),
		"op":     "query",
		"point":  coreCommandPointID(id),
		"source": "manual",
		"user":   user,
	}
	resp, err := c.sendWebIPC(ctx, cmd)
	if err != nil {
		return PointDTO{}, err
	}
	if resp.Result == "rejected" {
		return PointDTO{}, fmt.Errorf("core rejected %s: %s", id, resp.Error)
	}
	point := PointDTO{
		ID:        canonicalPointID(id),
		Name:      canonicalPointID(id),
		Kind:      pointKindFromID(id),
		Value:     resp.AppliedValue,
		Quality:   "good",
		Source:    "core",
		Priority:  resp.ActiveSource,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Forced:    resp.ActiveSource == "manual",
	}
	if resp.RemainingTTLS > 0 {
		point.OverrideExpiresInS = &resp.RemainingTTLS
	}
	return point, nil
}

func (c *CoreClient) sendWebIPC(ctx context.Context, cmd map[string]any) (webIPCResponse, error) {
	release, err := c.acquireWebIPCSlot(ctx)
	if err != nil {
		return webIPCResponse{}, err
	}
	defer release()

	conn, err := c.dialCore(ctx)
	if err != nil {
		return webIPCResponse{}, errCoreUnavailable
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(coreWebIPCDeadline))

	line, err := json.Marshal(cmd)
	if err != nil {
		return webIPCResponse{}, fmt.Errorf("marshal web ipc command: %w", err)
	}
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return webIPCResponse{}, errCoreUnavailable
	}
	respLine, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return webIPCResponse{}, errCoreUnavailable
	}
	var resp webIPCResponse
	if err := json.Unmarshal(respLine, &resp); err != nil {
		return webIPCResponse{}, fmt.Errorf("parse web ipc response: %w", err)
	}
	return resp, nil
}

func (c *CoreClient) coreSocketReady(ctx context.Context) bool {
	conn, err := c.dialCoreTimeout(ctx, coreWebIPCProbeTimeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func (c *CoreClient) dialCore(ctx context.Context) (net.Conn, error) {
	return c.dialCoreTimeout(ctx, coreWebIPCDialTimeout)
}

func (c *CoreClient) dialCoreTimeout(ctx context.Context, timeout time.Duration) (net.Conn, error) {
	if c.SockPath == "" {
		return nil, fmt.Errorf("core socket path empty")
	}
	dialer := net.Dialer{Timeout: timeout}
	return dialer.DialContext(ctx, "unix", c.SockPath)
}

func (c *CoreClient) readIOStatus() (IOPStatus, error) {
	data, err := c.readIOShm()
	if err != nil {
		// Fail-safe: không đọc được io_shm nghĩa là KHÔNG biết trạng thái IOP,
		// và "fault" là mặc định an toàn (khớp KX_IOP_FAULT ở phía HMI).
		return IOPStatus{Status: "fault"}, err
	}
	return decodeIOStatus(data), nil
}

func decodeIOStatus(data []byte) IOPStatus {
	status := IOPStatus{
		Status:    mapIOPStatus(data[offIOPStatus]),
		CRCErrors: binary.LittleEndian.Uint32(data[offIOCRCErrors : offIOCRCErrors+4]),
		Timeouts:  binary.LittleEndian.Uint32(data[offIOTimeouts : offIOTimeouts+4]),
		SeqErrors: binary.LittleEndian.Uint32(data[offIOSeqErrors : offIOSeqErrors+4]),
	}
	if len(data) >= kxIOShmIOPGapLen {
		gap := float64(binary.LittleEndian.Uint32(data[offIOMaxPollGapUS:offIOMaxPollGapUS+4])) / 1000.0
		status.MaxPollGapMS = &gap
	}
	return status
}

// SlaveTelemetry là số đo THẬT của một slave Modbus, do iobus đếm và publish.
// Không có trường nào ở đây được suy diễn hay gán mặc định.
type SlaveTelemetry struct {
	Addr              uint8
	BusID             uint8
	Online            bool
	TotalPolls        uint64
	TotalErrors       uint64
	LastSeenMS        uint64
	TimeoutErrors     uint64
	CRCErrors         uint64
	RetryAttempts     uint64
	WriteFailed       uint64
	WriteDropped      uint64
	ConsecutiveErrors uint8
	LastException     uint8
}

// BusTelemetry là số đo THẬT của một sợi dây RS-485, do BusWorker ghi.
// Không có nó, tầng API phải bịa p50/p95/utilization (MBR-B305).
type BusTelemetry struct {
	ID                 uint8
	Name               string
	Device             string
	State              string
	Baud               uint32
	Parity             string
	StopBits           uint8
	TotalTransactions  uint64
	TotalErrors        uint64
	PortReopens        uint64
	LatencyP50US       uint32
	LatencyP95US       uint32
	LatencyMaxUS       uint32
	UtilizationPctX100 uint16
}

// FieldbusTelemetry gộp trạng thái bind BACnet/IP và số đo per-slave.
// `Published=false` nghĩa là iobus chưa publish lần nào — caller PHẢI coi đó là
// "không biết" chứ không được quy về 0 hay offline.
type FieldbusTelemetry struct {
	Published   bool
	BacnetBound bool
	BacnetPort  uint16
	Slaves      []SlaveTelemetry
	Buses       []BusTelemetry
	// MBR-B110: consumer PHẢI so ProducerBootID giữa hai lần đọc trước khi tính
	// delta counter. Lệch ⇒ iobus đã restart và delta cũ vô nghĩa.
	ProducerBootID  uint64
	CountersSinceMS uint64
}

// ReadFieldbusTelemetry đọc khối telemetry nối thêm ở cuối io_shm.
//
// Trả lỗi khi iobus còn là bản cũ (segment 528 byte) hoặc không đọc được snapshot
// nhất quán. Đó là lý do vì sao hàm này KHÔNG trả về zero-value "coi như offline":
// finding F-03/F-04 chính là hậu quả của việc đoán trạng thái khi thiếu dữ liệu.
func (c *CoreClient) ReadFieldbusTelemetry(ctx context.Context) (FieldbusTelemetry, error) {
	select {
	case <-ctx.Done():
		return FieldbusTelemetry{}, ctx.Err()
	default:
	}
	data, err := c.ioSeg.read(c.IOShm, kxIOShmBusLen)
	if err != nil {
		return FieldbusTelemetry{}, err
	}
	out := FieldbusTelemetry{
		Published:       binary.LittleEndian.Uint32(data[offIOFbPublishSeq:offIOFbPublishSeq+4]) > 0,
		BacnetBound:     data[offIOBacnetBound] == 1,
		BacnetPort:      binary.LittleEndian.Uint16(data[offIOBacnetPort : offIOBacnetPort+2]),
		ProducerBootID:  binary.LittleEndian.Uint64(data[offIOProducerBootID : offIOProducerBootID+8]),
		CountersSinceMS: binary.LittleEndian.Uint64(data[offIOCountersSince : offIOCountersSince+8]),
	}
	count := int(data[offIOFbSlaveCount])
	if count > kxNFbSlave {
		count = kxNFbSlave
	}
	out.Slaves = make([]SlaveTelemetry, 0, count)
	for i := 0; i < count; i++ {
		base := offIOFbSlaves + i*kxFbSlaveStride
		diagBase := offIOModbusDiag + i*kxModbusDiagStride
		out.Slaves = append(out.Slaves, SlaveTelemetry{
			LastSeenMS:        binary.LittleEndian.Uint64(data[base+offFbLastSeen : base+offFbLastSeen+8]),
			TotalPolls:        binary.LittleEndian.Uint64(data[base+offFbTotalPolls : base+offFbTotalPolls+8]),
			TotalErrors:       binary.LittleEndian.Uint64(data[base+offFbTotalErrors : base+offFbTotalErrors+8]),
			Addr:              data[base+offFbAddr],
			Online:            data[base+offFbOnline] == 1,
			BusID:             data[base+offFbBusID],
			TimeoutErrors:     binary.LittleEndian.Uint64(data[diagBase+offDiagTimeout : diagBase+offDiagTimeout+8]),
			CRCErrors:         binary.LittleEndian.Uint64(data[diagBase+offDiagCRC : diagBase+offDiagCRC+8]),
			RetryAttempts:     binary.LittleEndian.Uint64(data[diagBase+offDiagRetry : diagBase+offDiagRetry+8]),
			WriteFailed:       binary.LittleEndian.Uint64(data[diagBase+offDiagWriteFailed : diagBase+offDiagWriteFailed+8]),
			WriteDropped:      binary.LittleEndian.Uint64(data[diagBase+offDiagWriteDropped : diagBase+offDiagWriteDropped+8]),
			ConsecutiveErrors: data[diagBase+offDiagConsecutive],
			LastException:     data[diagBase+offDiagLastExc],
		})
	}

	busCount := int(data[offIOFbBusCount])
	if busCount > kxNFbBus {
		busCount = kxNFbBus
	}
	out.Buses = make([]BusTelemetry, 0, busCount)
	for i := 0; i < busCount; i++ {
		base := offIOFbBus + i*kxBusStride
		out.Buses = append(out.Buses, BusTelemetry{
			ID:                 data[base+offBusID],
			Name:               cString(data[base+offBusName : base+offBusName+16]),
			Device:             cString(data[base+offBusDevice : base+offBusDevice+32]),
			State:              cString(data[base+offBusState : base+offBusState+16]),
			Baud:               binary.LittleEndian.Uint32(data[base+offBusBaud : base+offBusBaud+4]),
			Parity:             string(data[base+offBusParity]),
			StopBits:           data[base+offBusStopBits],
			TotalTransactions:  binary.LittleEndian.Uint64(data[base+offBusTotalTx : base+offBusTotalTx+8]),
			TotalErrors:        binary.LittleEndian.Uint64(data[base+offBusTotalErrors : base+offBusTotalErrors+8]),
			PortReopens:        binary.LittleEndian.Uint64(data[base+offBusPortReopens : base+offBusPortReopens+8]),
			LatencyP50US:       binary.LittleEndian.Uint32(data[base+offBusLatencyP50 : base+offBusLatencyP50+4]),
			LatencyP95US:       binary.LittleEndian.Uint32(data[base+offBusLatencyP95 : base+offBusLatencyP95+4]),
			LatencyMaxUS:       binary.LittleEndian.Uint32(data[base+offBusLatencyMax : base+offBusLatencyMax+4]),
			UtilizationPctX100: binary.LittleEndian.Uint16(data[base+offBusUtilX100 : base+offBusUtilX100+2]),
		})
	}
	return out, nil
}

// cString cắt chuỗi C cố định độ dài tại NUL đầu tiên.
func cString(raw []byte) string {
	for i, b := range raw {
		if b == 0 {
			return string(raw[:i])
		}
	}
	return string(raw)
}

func (c *CoreClient) readPLCStatus() (ScanStatus, error) {
	data, err := c.readPLCShm()
	if err != nil {
		return ScanStatus{}, err
	}
	return ScanStatus{
		Count:   binary.LittleEndian.Uint32(data[offPLCScanCount : offPLCScanCount+4]),
		Overrun: binary.LittleEndian.Uint32(data[offPLCScanOverrun : offPLCScanOverrun+4]),
	}, nil
}

// validSHM chỉ kiểm độ dài và magic — KHÔNG đủ để bảo đảm snapshot nhất quán
// (đó chính là lỗi F-02). Giữ lại vì decodePoints và các đường xử lý buffer đã có
// sẵn dùng nó như một sanity check trên buffer ĐÃ được seqlockCopy xác nhận.
// Tuyệt đối không dùng nó thay cho shmSegment.read().
func validSHM(data []byte, minLen int) bool {
	return len(data) >= minLen && binary.LittleEndian.Uint32(data[0:4]) == kxShmMagic
}

func degradedPoint(id string, value any, source string) PointDTO {
	return PointDTO{
		ID:        id,
		Name:      id,
		Kind:      pointKindFromID(id),
		Value:     value,
		Quality:   "bad",
		Source:    source,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Fault:     true,
	}
}

func pointKindFromID(id string) string {
	upper := strings.ToUpper(id)
	switch {
	case strings.HasPrefix(upper, "UI"), strings.HasPrefix(upper, "AI"):
		return "UI"
	case strings.HasPrefix(upper, "AO"):
		return "AO"
	case strings.HasPrefix(upper, "DI"), strings.HasPrefix(upper, "BI"):
		return "UI"
	case strings.HasPrefix(upper, "DO"), strings.HasPrefix(upper, "BO"):
		return "DO"
	default:
		return "virtual"
	}
}

func parsePointID(id string) (string, int, bool) {
	raw := strings.ToUpper(strings.TrimSpace(id))
	i := 0
	for i < len(raw) && raw[i] >= 'A' && raw[i] <= 'Z' {
		i++
	}
	if i == 0 || i >= len(raw) {
		return "", 0, false
	}
	digits := raw[i:]
	if strings.HasPrefix(digits, "-") || strings.HasPrefix(digits, "_") {
		digits = digits[1:]
	}
	channel, err := strconv.Atoi(digits)
	return raw[:i], channel, err == nil && channel > 0
}

func formatPointID(prefix string, channel int) string {
	return fmt.Sprintf("%s-%02d", prefix, channel)
}

func canonicalPointID(id string) string {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return strings.TrimSpace(id)
	}
	switch prefix {
	case "UI", "AI":
		return formatPointID("UI", channel)
	case "DI", "BI":
		return formatPointID("UI", kxNUI+channel)
	case "AO", "DO":
		return formatPointID(prefix, channel)
	case "AV", "BV", "MSV":
		return fmt.Sprintf("%s%d", prefix, channel)
	case "VP":
		return fmt.Sprintf("VP%d", channel)
	default:
		return strings.TrimSpace(id)
	}
}

func legacyPointIDAliases(id string) []string {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return nil
	}
	switch prefix {
	case "UI":
		if channel <= kxNUI {
			return []string{fmt.Sprintf("AI%d", channel), formatPointID("AI", channel)}
		}
		if channel <= kxNUI+kxNDI {
			diChannel := channel - kxNUI
			return []string{fmt.Sprintf("DI%d", diChannel), formatPointID("DI", diChannel)}
		}
	case "AO", "DO":
		return []string{fmt.Sprintf("%s%d", prefix, channel)}
	case "AV", "BV", "MSV":
		return []string{fmt.Sprintf("%s-%02d", prefix, channel)}
	case "VP":
		return []string{fmt.Sprintf("VP-%02d", channel), fmt.Sprintf("AV%d", channel), fmt.Sprintf("AV-%02d", channel)}
	}
	return nil
}

func coreCommandPointID(id string) string {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return strings.TrimSpace(id)
	}
	switch prefix {
	case "UI":
		if channel <= kxNUI {
			return fmt.Sprintf("AI%d", channel)
		}
		if channel <= kxNUI+kxNDI {
			return fmt.Sprintf("DI%d", channel-kxNUI)
		}
	case "AO", "DO", "AI", "DI", "AV", "BV", "MSV":
		return fmt.Sprintf("%s%d", prefix, channel)
	}
	return strings.TrimSpace(id)
}

func mapIOPStatus(raw byte) string {
	switch raw {
	case 0:
		return "normal"
	case 2:
		return "safe"
	default:
		return "fault"
	}
}

// ---- kx_plc_shm point table offsets ----

const (
	// `F-PIO-008`: bốn con số này TỪNG là một trong bốn nguồn sự thật độc lập
	// về "bo có bao nhiêu kênh". Chúng không phải thế — chúng là SỨC CHỨA của
	// bảng point trong ABI SHM, và mọi offset bên dưới được tính từ chúng nên
	// chúng buộc phải là hằng biên dịch. Khai báo gốc nay nằm ở gói
	// `capabilities`; "bo THỰC SỰ có gì" là câu hỏi khác, do `BOARD_CAP_MAP`
	// trả lời.
	kxNUI  = capabilities.ABIUniversalInputs
	kxNDI  = capabilities.ABIDigitalInputs
	kxNAO  = capabilities.ABIAnalogOutputs
	kxNDO  = capabilities.ABIDigitalOutputs
	kxNAV  = 32
	kxNBV  = 16
	kxNMSV = 8

	// kx_point_t layout (24 bytes, no padding between fields):
	//   float value(4) + float[16] priority(64) + float relinquish_default(4)
	//   + uint8 quality(1) + uint8 reliability(1) + padding(2) = 76
	kxPointSize = 76

	// kx_plc_shm_t header + point arrays:
	//   header: magic(4)+seq(4)+ts_ns(8) = 16
	//   ai[16]  at offset 16
	//   bi[8]   at offset 1232
	//   ao[4]   at offset 1840
	//   bo[4]   at offset 2144
	//   av[32]  at offset 2448
	//   bv[16]  at offset 4880
	//   msv[8]  at offset 6096
	//   ext[256] at offset 6704 (kx_ext_point_t=64b, contract v2): 256*64=16384
	//   scan_count at 23092; scan_overrun at 23096; sizeof(kx_plc_shm_t)=23104.
	//
	// MBR-B001/Đ-03: kx_ext_point_t đổi từ 40 lên 64 byte (value/setpoint sang
	// double, thêm quality_reason/exception_code/bus_id và mốc sample). Magic
	// lên v5 nên binary cũ FAIL RÕ thay vì đọc lệch trường trong im lặng.
	offAI               = 16
	offBI               = offAI + kxNUI*kxPointSize
	offAO               = offBI + kxNDI*kxPointSize
	offBO               = offAO + kxNAO*kxPointSize
	offAV               = offBO + kxNDO*kxPointSize
	offBV               = offAV + kxNAV*kxPointSize
	offMSV              = offBV + kxNBV*kxPointSize
	offExt              = offMSV + kxNMSV*kxPointSize
	kxExtPointSize      = 64
	offExtValue         = 24 // float64
	offExtSetpoint      = 32 // float64
	offExtSampleUTCMS   = 40 // int64
	offExtSampleMonoNS  = 48 // int64
	offExtQuality       = 56
	offExtQualityReason = 57
	offExtException     = 58
	offExtSlave         = 59
	offExtBusID         = 60
	offExtOnline        = 61
	offExtWritable      = 62
	offExtCount         = offExt + 256*kxExtPointSize

	// kx_point_t field offsets within a point (76 bytes):
	offValue      = 0  // float32
	offPriority   = 4  // float32[16] — not read for now
	offRelinquish = 68 // float32
	offQuality    = 72 // uint8
	offReliab     = 73 // uint8

	offPLCScanCount   = 23092
	offPLCScanOverrun = 23096
	kxPlcShmMinLen    = 23104

	// kx_io_shm_t v4 offsets used by web:
	//   header16 + ui_value[16]*4 + ui_raw[16]*4 + ui_quality[16]
	//   + ui_reliability[16] + ui_unit[16][8] + ui_raw_unit[16][8]
	//   + DI state/counter + ao_setpoint[4] + ao_mode[4] + rest = 528 bytes.
	offIORaw        = 80
	offIOUnit       = 176
	offIORawUnit    = 304
	offIOAOSetpoint = 472
	offIOAOMode     = 488
	kxIOUnitSize    = 8
	offIOPStatus    = 502
	offIOCRCErrors  = 512
	offIOTimeouts   = 516
	offIOSeqErrors  = 520

	// Telemetry northbound/southbound nối thêm 2026-07-31 (finding F-03/F-04).
	// Offset được chốt hai chiều bằng static_assert trong
	// apps/iobus/tests/test_io_cache.cpp và ShmLayout test.
	//
	// kxIOShmMinLen GIỮ NGUYÊN 528: iobus cũ vẫn đọc được như trước. Khối mới chỉ
	// được đọc khi segment dài đủ kxIOShmFullLen — segment ngắn hơn nghĩa là iobus
	// chưa nâng cấp, và điều đó phải hiện ra là KHÔNG BIẾT chứ không phải 0/offline.
	offIOBacnetPort   = 524
	offIOBacnetBound  = 526
	offIOFbSlaveCount = 527
	offIOFbPublishSeq = 528
	offIOFbSlaves     = 536
	kxNFbSlave        = 32
	// MBR-B110: counter lên uint64 nên stride 24 → 32. uint32 tràn sau ~2,7 năm
	// ở nhịp poll thực tế, và khi tràn thì mọi phép delta của FE/historian cho ra
	// số âm khổng lồ hoặc "vừa reset" — cả hai đều sai.
	kxFbSlaveStride = 32
	// kx_slave_metrics_t: last_seen_ms(8) + total_polls(8) + total_errors(8) + addr(1) + online(1) + bus_id(1) + pad(5)
	offFbLastSeen      = 0
	offFbTotalPolls    = 8
	offFbTotalErrors   = 16
	offFbAddr          = 24
	offFbOnline        = 25
	offFbBusID         = 26
	kxIOShmFullLen     = offIOFbSlaves + kxNFbSlave*kxFbSlaveStride // 1560
	offIOModbusDiag    = kxIOShmFullLen
	kxModbusDiagStride = 48
	// kx_modbus_diag_t: timeout(8) + crc(8) + retry(8) + write_failed(8) + write_dropped(8)
	//                   + consecutive(1) + last_exception(1) + pad(6)
	offDiagTimeout      = 0
	offDiagCRC          = 8
	offDiagRetry        = 16
	offDiagWriteFailed  = 24
	offDiagWriteDropped = 32
	offDiagConsecutive  = 40
	offDiagLastExc      = 41
	kxIOShmDiagLen      = offIOModbusDiag + kxNFbSlave*kxModbusDiagStride // 3096

	// MBR-B305: bus metrics đo THẬT. Trước khi có khối này, handler Go phải điền
	// hằng số cho p50/p95/utilization và trang Overview hiển thị số không do
	// thiết bị nào sinh ra — đúng lỗi mà D-07 đã cấm ở tầng FE.
	offIOProducerBootID = 3096
	offIOCountersSince  = 3104
	offIOFbBusCount     = 3112
	offIOFbBus          = 3120
	kxNFbBus            = 4
	kxBusStride         = 112
	offBusTotalTx       = 0
	offBusTotalErrors   = 8
	offBusPortReopens   = 16
	offBusLatencyP50    = 24
	offBusLatencyP95    = 28
	offBusLatencyMax    = 32
	offBusBaud          = 36
	offBusUtilX100      = 40
	offBusID            = 42
	offBusParity        = 43
	offBusStopBits      = 44
	offBusName          = 48
	offBusDevice        = 64
	offBusState         = 96
	kxIOShmBusLen       = offIOFbBus + kxNFbBus*kxBusStride // 3568
	offIOMaxPollGapUS   = kxIOShmBusLen
	kxIOShmIOPGapLen    = offIOMaxPollGapUS + 4 // 3572

	// `ISS-PIO-11`/#388: bản đồ năng lực bo, ghi bởi iobus ngay sau handshake
	// IOP. Hai trường rơi trọn vào padding đuôi ĐÃ CÓ nên `sizeof` giữ nguyên
	// 3576 và mọi offset trên không dịch — ShmLayout test khoá đúng ba con số
	// đó. Magic lên v6 vì nếu không, `board_cap_valid = 0` gộp mất hai nghĩa
	// "producer đời cũ không bao giờ điền" và "producer mới chưa handshake".
	offIOBoardCapMap   = 3572
	offIOBoardCapValid = 3574
	kxIOShmBoardCapLen = 3576

	kxIOShmMinLen = 528
)

// kx_quality_t ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ DTO quality string
// kx_ext_quality_t → chuỗi cho API. Năm mức, không gộp (DATA_MODEL §6.2):
// người vận hành phải phân biệt "thiết bị trả dữ liệu sai" (BAD) với "cấu hình
// sai nên chưa từng hỏi thiết bị" (CONFIG_ERROR) ngay trên bảng Point.
func mapExtQuality(raw uint8) string {
	switch raw {
	case 0:
		return "GOOD"
	case 1:
		return "STALE"
	case 2:
		return "BAD"
	case 3:
		return "OFFLINE"
	case 4:
		return "CONFIG_ERROR"
	}
	// Giá trị lạ = producer mới hơn consumer. Trả "UNKNOWN" chứ không đoán bừa
	// về GOOD — đoán ở đây là bịa trạng thái thiết bị hiện trường.
	return "UNKNOWN"
}

// kx_ext_quality_reason_t → chuỗi cho API.
func mapExtQualityReason(raw uint8) string {
	switch raw {
	case 0:
		return ""
	case 1:
		return "NOT_INITIALIZED"
	case 2:
		return "CONFIG_ERROR"
	case 3:
		return "DECODE_ERROR"
	case 4:
		return "OUT_OF_RANGE"
	case 5:
		return "TIMEOUT"
	case 6:
		return "CRC_ERROR"
	case 7:
		return "PORT_DOWN"
	case 8:
		return "DEVICE_EXCEPTION"
	case 9:
		return "WRITE_FAILED"
	case 10:
		return "BUS_OVERLOAD"
	}
	return "UNKNOWN"
}

func mapQuality(raw uint8) string {
	switch raw {
	case 0:
		return "good"
	case 1:
		return "uncertain"
	default:
		return "bad"
	}
}

func decodePoint(data []byte, offset int, id, name string) PointDTO {
	if offset < 0 || offset+kxPointSize > len(data) {
		return PointDTO{ID: id, Name: name, Quality: "bad", Source: "core", Fault: true}
	}
	v := math.Float32frombits(binary.LittleEndian.Uint32(data[offset+offValue:]))
	q := mapQuality(data[offset+offQuality])
	return PointDTO{
		ID:        id,
		Name:      name,
		Kind:      pointKindFromID(id),
		Value:     v,
		Quality:   q,
		Source:    "core",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Fault:     q == "bad",
	}
}

func ioString(ioData []byte, base int, ch int) string {
	if ioData == nil || ch < 0 || ch >= kxNUI {
		return ""
	}
	start := base + ch*kxIOUnitSize
	if start+kxIOUnitSize > len(ioData) {
		return ""
	}
	b := ioData[start : start+kxIOUnitSize]
	n := 0
	for n < len(b) && b[n] != 0 {
		n++
	}
	return string(b[:n])
}

func ioUnit(ioData []byte, ch int) string {
	return ioString(ioData, offIOUnit, ch)
}

func ioRawUnit(ioData []byte, ch int) string {
	return ioString(ioData, offIORawUnit, ch)
}

func ioRaw(ioData []byte, ch int) (float32, bool) {
	if ioRawUnit(ioData, ch) == "" {
		return 0, false
	}
	start := offIORaw + ch*4
	if ioData == nil || start+4 > len(ioData) {
		return 0, false
	}
	return math.Float32frombits(binary.LittleEndian.Uint32(ioData[start : start+4])), true
}

func ioAORaw(ioData []byte, ch int) (float32, string, bool) {
	if ioData == nil || ch < 0 || ch >= kxNAO || offIOAOSetpoint+(ch+1)*4 > len(ioData) || offIOAOMode+ch >= len(ioData) {
		return 0, "", false
	}
	unit := "V"
	if ioData[offIOAOMode+ch] == 1 {
		unit = "mA"
	}
	start := offIOAOSetpoint + ch*4
	return math.Float32frombits(binary.LittleEndian.Uint32(ioData[start : start+4])), unit, true
}

func pointFloat(value any) (float32, bool) {
	switch v := value.(type) {
	case float32:
		return v, true
	case float64:
		return float32(v), true
	case int:
		return float32(v), true
	default:
		return 0, false
	}
}

// ExtSlotRef là một slot `ext` NHƯ RUNTIME ĐANG THẤY: chỉ số 1-based mà Core
// dùng trong tên điểm `EXT<n>`, cùng cờ `writable` do chính `iobus` đặt.
type ExtSlotRef struct {
	// ExtIndex 1-based, khớp `parse_point_name` của `web_ipc.cpp`
	// (`out->idx = num - 1`) và `shm_->ext[idx]` của `PointWriter`.
	ExtIndex int
	PointID  string
	Writable bool
	Online   bool
}

// ReadExtCatalog trả bản đồ slot `ext` ĐANG chạy, đọc thẳng từ `plc_shm`.
//
// Vì sao đọc SHM chứ không tính lại từ file cấu hình: slot `ext` được `iobus`
// cấp phát TUẦN TỰ trên tập thiết bị/điểm đang bật, nên sửa cấu hình (đổi
// `point_id`, tắt một điểm, tắt một thiết bị) là mọi điểm phía sau dịch chỗ —
// xem `internal/modbusrtu/extlayout.go` để biết kịch bản hỏng đầy đủ. Giữa lúc
// người dùng bấm Lưu và lúc `iobus` nạp lại profile, cấu hình trên đĩa và bố
// cục đang chạy KHÁC nhau. Một lệnh ghi tính theo cấu hình sẽ trúng slot của
// điểm khác, mà mọi phép kiểm hiện có đều nói "hợp lệ" vì chỉ số vẫn nằm trong
// `1…256`. Tên trong SHM do `iobus` ghi lúc bind (`bus_worker.cpp`
// `ext_point_name`) chính là `point_id`, nên đây là chỗ duy nhất trả lời được
// "điểm này ĐANG nằm ở slot nào".
func (c *CoreClient) ReadExtCatalog() ([]ExtSlotRef, error) {
	data, err := c.readPLCShm()
	if err != nil {
		return nil, err
	}
	if len(data) < kxPlcShmMinLen {
		return nil, fmt.Errorf("plc shm ngắn hơn hợp đồng: %d byte", len(data))
	}
	count := int(binary.LittleEndian.Uint16(data[offExtCount : offExtCount+2]))
	if count > 256 {
		count = 256
	}
	out := make([]ExtSlotRef, 0, count)
	for i := 0; i < count; i++ {
		base := offExt + i*kxExtPointSize
		nameBytes := data[base : base+24]
		end := 0
		for end < len(nameBytes) && nameBytes[end] != 0 {
			end++
		}
		out = append(out, ExtSlotRef{
			ExtIndex: i + 1,
			PointID:  string(nameBytes[:end]),
			Writable: data[base+offExtWritable] == 1,
			Online:   data[base+offExtOnline] == 1,
		})
	}
	return out, nil
}

func decodePoints(data []byte, ioData []byte) []PointDTO {
	if len(data) < kxPlcShmMinLen {
		return nil
	}
	pts := make([]PointDTO, 0, kxNUI+kxNAO+kxNDO+kxNAV+kxNBV+kxNMSV+256)

	// UI[0..15]
	for i := 0; i < kxNUI; i++ {
		id := formatPointID("UI", i+1)
		dto := decodePoint(data, offAI+i*kxPointSize, id, id)
		dto.Unit = ioUnit(ioData, i)
		if strings.EqualFold(dto.Unit, "bool") {
			if v, ok := pointFloat(dto.Value); ok {
				dto.Value = v > 0.5
			}
		}
		if raw, ok := ioRaw(ioData, i); ok {
			dto.Raw = &raw
			dto.RawUnit = ioRawUnit(ioData, i)
		}
		pts = append(pts, dto)
	}
	// AO[0..3] analog output (commandable)
	for i := 0; i < kxNAO; i++ {
		id := formatPointID("AO", i+1)
		dto := decodePoint(data, offAO+i*kxPointSize, id, id)
		if raw, unit, ok := ioAORaw(ioData, i); ok {
			dto.Raw = &raw
			dto.RawUnit = unit
		}
		pts = append(pts, dto)
	}
	// DO[0..3] digital output feedback (bo[] array)
	for i := 0; i < kxNDO; i++ {
		id := formatPointID("DO", i+1)
		dto := decodePoint(data, offBO+i*kxPointSize, id, id)
		if v, ok := dto.Value.(float32); ok {
			dto.Value = v > 0.5
		}
		pts = append(pts, dto)
	}
	// AV[0..31]
	for i := 0; i < kxNAV; i++ {
		id := fmt.Sprintf("AV%d", i+1)
		pts = append(pts, decodePoint(data, offAV+i*kxPointSize, id, id))
	}
	// BV[0..15]
	for i := 0; i < kxNBV; i++ {
		id := fmt.Sprintf("BV%d", i+1)
		dto := decodePoint(data, offBV+i*kxPointSize, id, id)
		if v, ok := dto.Value.(float32); ok {
			dto.Value = v > 0.5
		}
		pts = append(pts, dto)
	}
	// MSV[0..7]
	for i := 0; i < kxNMSV; i++ {
		id := fmt.Sprintf("MSV%d", i+1)
		pts = append(pts, decodePoint(data, offMSV+i*kxPointSize, id, id))
	}
	// Modbus RTU ext[] — Point ID do backend cấu hình và iobus giữ ổn định.
	extCount := int(binary.LittleEndian.Uint16(data[offExtCount : offExtCount+2]))
	if extCount > 256 {
		extCount = 256
	}
	for i := 0; i < extCount; i++ {
		base := offExt + i*kxExtPointSize
		nameBytes := data[base : base+24]
		end := 0
		for end < len(nameBytes) && nameBytes[end] != 0 {
			end++
		}
		id := string(nameBytes[:end])
		if id == "" {
			id = fmt.Sprintf("EXT-%02d", i+1)
		}
		value := math.Float64frombits(binary.LittleEndian.Uint64(data[base+offExtValue : base+offExtValue+8]))
		online := data[base+offExtOnline] == 1

		// D-07 / MBR-B103: quality đến TỪ producer, không suy diễn ở đây.
		//
		// Bản trước phải ghép `online` với quality 3 mức để đoán ra OFFLINE/STALE,
		// và phép đoán đó sai ở hai chỗ: điểm CHƯA TỪNG có mẫu bị gán "OFFLINE"
		// (nghe như mất liên lạc, thật ra là chưa khai báo xong), còn lỗi cấu
		// hình không phân biệt được với lỗi thiết bị. Contract v2 chở đủ 5 mức
		// nên tầng này chỉ còn việc dịch tên.
		quality := mapExtQuality(data[base+offExtQuality])
		reason := mapExtQualityReason(data[base+offExtQualityReason])

		// Mốc hiển thị là thời điểm SAMPLE thật, không phải "lúc web đọc SHM".
		// Dùng time.Now() ở đây làm mọi điểm trông như vừa cập nhật kể cả khi
		// thiết bị đã im lặng nhiều giờ.
		updatedAt := time.Now().UTC().Format(time.RFC3339Nano)
		sampleUTCMS := int64(binary.LittleEndian.Uint64(data[base+offExtSampleUTCMS : base+offExtSampleUTCMS+8]))
		if sampleUTCMS > 0 {
			updatedAt = time.UnixMilli(sampleUTCMS).UTC().Format(time.RFC3339Nano)
		}

		pts = append(pts, PointDTO{ID: id, Name: id, Kind: "modbus_rtu", Value: value,
			Quality: quality, QualityReason: reason, Source: "modbus_rtu", UpdatedAt: updatedAt,
			Fault:    quality == "BAD" || quality == "OFFLINE" || quality == "CONFIG_ERROR",
			Writable: data[base+offExtWritable] == 1,
			BusID:    data[base+offExtBusID], SlaveAddr: data[base+offExtSlave],
			ExceptionCode: data[base+offExtException], Online: online})
	}
	return pts
}

// ---- B3 seam: alarms + commissioning (impl by agent B) ----

type alarmReader interface {
	ReadAlarms(ctx context.Context) ([]AlarmDTO, error)
}

type alarmAcker interface {
	AckAlarm(ctx context.Context, id string, action AlarmActionRequest) error
}

type alarmSuppressor interface {
	SuppressAlarm(ctx context.Context, id string, action AlarmActionRequest) error
}

type alarmReturner interface {
	ReturnAlarm(ctx context.Context, id string) error
}

type commissionTester interface {
	CommissionTest(ctx context.Context, id string, value any) (CommissioningTestResult, error)
}

// ReadAlarms returns the current active/unacked alarm list from core.
func (c *CoreClient) ReadAlarms(ctx context.Context) ([]AlarmDTO, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	resp, err := c.sendWebIPC(ctx, map[string]any{
		"id":   atomic.AddUint64(&webCommandID, 1),
		"op":   "alarm_list",
		"user": "web",
	})
	if errors.Is(err, errCoreUnavailable) {
		return nil, errCoreUnavailable
	}
	if err != nil {
		return nil, err
	}
	if resp.Result == "rejected" {
		return []AlarmDTO{}, fmt.Errorf("core rejected alarm_list: %s", resp.Error)
	}
	receivedAt := time.Now().UTC().Format(time.RFC3339Nano)
	alarms := make([]AlarmDTO, 0, len(resp.Alarms))
	for _, alarm := range resp.Alarms {
		alarms = append(alarms, mapCoreAlarm(alarm, receivedAt))
	}
	return alarms, nil
}

// AckAlarm sends an acknowledge command for alarm id to core.
func (c *CoreClient) AckAlarm(ctx context.Context, id string, action AlarmActionRequest) error {
	return c.AckAlarmAs(ctx, id, action, "web")
}

func (c *CoreClient) AckAlarmAs(ctx context.Context, id string, action AlarmActionRequest, user string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	id = strings.TrimSpace(id)
	if !validAlarmID(id) {
		return fmt.Errorf("invalid alarm id")
	}
	cmd := alarmActionCommand("alarm_ack", id, action)
	cmd["user"] = user
	resp, err := c.sendWebIPC(ctx, cmd)
	if errors.Is(err, errCoreUnavailable) {
		return errCoreUnavailable
	}
	if err != nil {
		return err
	}
	if resp.Result == "rejected" {
		if resp.Error == "unknown_alarm" {
			return fmt.Errorf("unknown alarm")
		}
		return fmt.Errorf("core rejected alarm ack %s: %s", id, resp.Error)
	}
	return nil
}

// SuppressAlarm sends an off/suppress command for alarm id to core.
func (c *CoreClient) SuppressAlarm(ctx context.Context, id string, action AlarmActionRequest) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	id = strings.TrimSpace(id)
	if !validAlarmID(id) {
		return fmt.Errorf("invalid alarm id")
	}
	resp, err := c.sendWebIPC(ctx, alarmActionCommand("alarm_suppress", id, action))
	if errors.Is(err, errCoreUnavailable) {
		return errCoreUnavailable
	}
	if err != nil {
		return err
	}
	if resp.Result == "rejected" {
		if resp.Error == "unknown_alarm" {
			return fmt.Errorf("unknown alarm")
		}
		return fmt.Errorf("core rejected alarm suppress %s: %s", id, resp.Error)
	}
	return nil
}

func alarmActionCommand(op string, id string, action AlarmActionRequest) map[string]any {
	cmd := map[string]any{
		"id":      atomic.AddUint64(&webCommandID, 1),
		"op":      op,
		"alarmId": id,
		"user":    "web",
	}
	if action.DurationS != nil {
		cmd["durationS"] = *action.DurationS
	}
	if action.Permanent != nil {
		cmd["permanent"] = *action.Permanent
	}
	return cmd
}

// ReturnAlarm clears an acknowledge for a still-active alarm.
func (c *CoreClient) ReturnAlarm(ctx context.Context, id string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	id = strings.TrimSpace(id)
	if !validAlarmID(id) {
		return fmt.Errorf("invalid alarm id")
	}
	resp, err := c.sendWebIPC(ctx, map[string]any{
		"id":      atomic.AddUint64(&webCommandID, 1),
		"op":      "alarm_return",
		"alarmId": id,
		"user":    "web",
	})
	if errors.Is(err, errCoreUnavailable) {
		return errCoreUnavailable
	}
	if err != nil {
		return err
	}
	if resp.Result == "rejected" {
		if resp.Error == "unknown_alarm" {
			return fmt.Errorf("unknown alarm")
		}
		return fmt.Errorf("core rejected alarm return %s: %s", id, resp.Error)
	}
	return nil
}

func mapCoreAlarm(alarm coreAlarmState, fallbackTime string) AlarmDTO {
	id := alarm.ID
	if id == "" {
		id = alarm.AlarmSettingID
	}
	timestamp := alarm.Time
	if timestamp == "" {
		timestamp = fallbackTime
	}
	status := alarmStatus(alarm.Status)
	source := alarm.SourcePointID
	if source == "" {
		source = "SYSTEM"
	}
	message := alarm.Label
	if message == "" {
		message = "Alarm " + id
	}
	value := formatAlarmValue(alarm.Value)
	triggerLevel := normalizeTriggerLevel(alarm.TriggerLevel)
	threshold := formatAlarmThreshold(alarm.Threshold)
	return AlarmDTO{
		ID:           id,
		Time:         timestamp,
		Severity:     alarmSeverity(alarm.Priority),
		Status:       status,
		Message:      message,
		Source:       source,
		Value:        value,
		Detail:       formatAlarmDetail(alarm, source, status, value, triggerLevel, threshold),
		TriggerLevel: triggerLevel,
		Threshold:    threshold,
		Active:       alarm.Active,
		Returnable:   boolPtr(true),
	}
}

func formatAlarmDetail(alarm coreAlarmState, source, status, value, triggerLevel, threshold string) string {
	if triggerLevel == "" {
		return fmt.Sprintf("type=%d source=%s status=%s occurrence=%d",
			alarm.AlarmType, source, status, alarm.Occurrence)
	}
	if threshold != "" {
		return fmt.Sprintf("trip=%s threshold=%s current=%s (%s); occurrence=%d",
			triggerLevel, threshold, value, triggerLabel(triggerLevel), alarm.Occurrence)
	}
	return fmt.Sprintf("trip=%s current=%s (%s); occurrence=%d",
		triggerLevel, value, triggerLabel(triggerLevel), alarm.Occurrence)
}

func normalizeTriggerLevel(level string) string {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "HH", "H", "L", "LL", "RUNTIME":
		return strings.ToUpper(strings.TrimSpace(level))
	default:
		return ""
	}
}

func triggerLabel(level string) string {
	switch level {
	case "HH":
		return "High-high"
	case "H":
		return "High"
	case "L":
		return "Low"
	case "LL":
		return "Low-low"
	case "RUNTIME":
		return "Runtime"
	default:
		return "Alarm"
	}
}

func formatAlarmThreshold(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
}

func alarmSeverity(priority string) string {
	switch strings.ToLower(priority) {
	case "critical", "high", "medium", "low":
		return strings.ToLower(priority)
	default:
		return "info"
	}
}

func alarmStatus(status string) string {
	switch strings.ToLower(status) {
	case "active", "unack", "acked", "shelved":
		return strings.ToLower(status)
	default:
		return "active"
	}
}

func formatAlarmValue(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32)
	case int:
		return strconv.Itoa(v)
	case string:
		return v
	case bool:
		if v {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(v)
	}
}

// CommissionTest sends a commissioning test command for point id with the given value
// via core web_ipc (Local manual level 2, per 07 §8 + openapi.yaml).
// Implemented as ForcePoint(write) mapped to CommissioningTestResult.
// Core unavailable -> degraded result, no hard error.
func (c *CoreClient) CommissionTest(ctx context.Context, id string, value any) (CommissioningTestResult, error) {
	select {
	case <-ctx.Done():
		return CommissioningTestResult{}, ctx.Err()
	default:
	}
	start := time.Now()
	pt, err := c.ForcePoint(ctx, id, value, false)
	if err != nil {
		return CommissioningTestResult{
			Result:  "failed",
			PointID: id,
			Message: "core rejected: " + err.Error(),
		}, nil
	}
	elapsed := int(time.Since(start).Milliseconds())
	result := "passed"
	msg := "accepted"
	switch {
	case pt.Source == "core_unavailable":
		result = "failed"
		msg = "core unavailable"
	case pt.Fault || pt.Quality == "bad":
		result = "failed"
		msg = "point fault or bad quality"
	}
	return CommissioningTestResult{
		Result:       result,
		PointID:      id,
		AppliedValue: pt.Value,
		Message:      msg,
		ScanMs:       &elapsed,
	}, nil
}
