package modbusrtu

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"time"
)

// ControlClient nói chuyện với kênh điều khiển UDS của iobus (MBR-B105).
//
// Thay thế cho `dispatchReload(reloadRestartIobus)` (D-09/MBR-B212). Restart
// service để áp một thay đổi cấu hình Modbus là biện pháp nặng tay đến mức
// nguy hiểm: nó cắt luôn IOP 100 Hz, tức là mọi I/O vật lý của tủ ngừng vài
// giây chỉ vì ai đó sửa tên một Point. `ApplyConfig` áp cấu hình tại ranh giới
// giữa hai transaction Modbus và không đụng tới IOP.
type ControlClient struct {
	SocketPath string
	Timeout    time.Duration
}

type ApplyAck struct {
	Result          string `json:"result"`
	AppliedRevision uint64 `json:"applied_revision"`
	Generation      uint64 `json:"generation"`
	Reason          string `json:"reason"`
}

type ProbeReply struct {
	Result        string  `json:"result"`
	Value         float64 `json:"value"`
	Reason        string  `json:"reason"`
	ExceptionCode int     `json:"exception_code"`
	ElapsedUS     int     `json:"elapsed_us"`
}

type StatusReply struct {
	Result          string          `json:"result"`
	Generation      uint64          `json:"generation"`
	ConfigRevision  uint64          `json:"config_revision"`
	ProducerBootID  uint64          `json:"producer_boot_id"`
	CountersSinceMS uint64          `json:"counters_since_ms"`
	ExtCount        int             `json:"ext_count"`
	Sequence        uint64          `json:"sequence"`
	Buses           []StatusBusInfo `json:"buses"`
	// T63-003 (PERF-API-04) — chỉ THÊM. Counter và cửa sổ latency của bus về 0
	// mỗi lần iobus nạp cấu hình bus (kể cả apply_config, khi ProducerBootID
	// KHÔNG đổi); BusCountersEpoch tăng đúng những lần đó. iobus trước T63-003
	// không gửi hai trường này ⇒ 0 = KHÔNG BIẾT, không phải "epoch 0".
	BusCountersEpoch   uint64 `json:"bus_counters_epoch"`
	BusCountersSinceMS uint64 `json:"bus_counters_since_ms"`
	// Counter IOP 64 bit tích luỹ từ lúc tiến trình iobus khởi động. nil =
	// iobus cũ không gửi.
	IOP *StatusIOP `json:"iop,omitempty"`
}

// StatusIOP — counter IOP tích luỹ; epoch là (ProducerBootID, CountersSinceMS).
type StatusIOP struct {
	RX        uint64 `json:"rx"`
	TX        uint64 `json:"tx"`
	CRCErrors uint64 `json:"crc_errors"`
	SeqErrors uint64 `json:"seq_errors"`
	Timeouts  uint64 `json:"timeouts"`
	Retries   uint64 `json:"retries"`
	NACKs     uint64 `json:"nacks"`
}

// StatusLatencyWindow — latency MỘT loại giao dịch (đọc hoặc ghi) trên cửa sổ
// `SampleCount` giao dịch gần nhất (tối đa `WindowSize`). Total đếm tiếp vượt
// cửa sổ, tính từ BusCountersEpoch.
type StatusLatencyWindow struct {
	P50US       uint32 `json:"p50_us"`
	P95US       uint32 `json:"p95_us"`
	MaxUS       uint32 `json:"max_us"`
	SampleCount uint32 `json:"sample_count"`
	WindowSize  uint32 `json:"window_size"`
	Total       uint64 `json:"total"`
}

type StatusBusInfo struct {
	ID                 int    `json:"id"`
	Name               string `json:"name"`
	Device             string `json:"device"`
	State              string `json:"state"`
	LatencyP50US       int    `json:"latency_p50_us"`
	LatencyP95US       int    `json:"latency_p95_us"`
	UtilizationPctX100 int    `json:"utilization_pct_x100"`
	TimeoutErrors      uint64 `json:"timeout_errors"`
	CRCErrors          uint64 `json:"crc_errors"`
	PortReopens        uint64 `json:"port_reopens"`
	// T63-003 — chỉ THÊM; nil/0 khi iobus trước T63-003.
	TotalTransactions uint64               `json:"total_transactions"`
	TotalErrors       uint64               `json:"total_errors"`
	LatencyRead       *StatusLatencyWindow `json:"latency_read,omitempty"`
	LatencyWrite      *StatusLatencyWindow `json:"latency_write,omitempty"`
}

var ErrControlUnavailable = errors.New("iobus không mở kênh điều khiển fieldbus")

func (c ControlClient) timeout() time.Duration {
	if c.Timeout > 0 {
		return c.Timeout
	}
	return 5 * time.Second
}

// request gửi một dòng JSON và đọc một dòng trả lời. `Timeout` là trần cho TOÀN
// BỘ lượt hỏi — kết nối + gửi + nhận — tính từ một mốc duy nhất (T63-003).
// Bản trước đặt hai hạn liền nhau (dial rồi mới tới đọc/ghi) nên một lượt hỏi
// có thể kéo dài gấp đôi `Timeout`; các GET gọi op `status` cần một trần thật.
func (c ControlClient) request(payload any, out any) error {
	if c.SocketPath == "" {
		return ErrControlUnavailable
	}
	deadline := time.Now().Add(c.timeout())
	dialer := net.Dialer{Deadline: deadline}
	conn, err := dialer.Dial("unix", c.SocketPath)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrControlUnavailable, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(deadline)

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := conn.Write(append(body, '\n')); err != nil {
		return err
	}
	reader := bufio.NewReader(conn)
	line, err := reader.ReadBytes('\n')
	if err != nil && len(line) == 0 {
		return err
	}
	return json.Unmarshal(line, out)
}

// ApplyConfig yêu cầu iobus nạp cấu hình mới và CHỜ ACK.
func (c ControlClient) ApplyConfig(revision uint64, checksum, path string) (ApplyAck, error) {
	var ack ApplyAck
	err := c.request(map[string]any{
		"op":       "apply_config",
		"revision": revision,
		// iobus chỉ so tiền tố: datagram snapshot chở 23 ký tự hex đầu, nên gửi
		// trọn 64 ký tự ở đây là dư nhưng vô hại, và giữ được khả năng đối chiếu
		// đầy đủ nếu sau này contract mở rộng.
		"checksum": checksum,
		"path":     path,
	}, &ack)
	return ack, err
}

// ReadTest đọc thử một register phục vụ commissioning (MBR-B108/B208).
func (c ControlClient) ReadTest(busID, slaveAddr, fc, address, count, timeoutMS int) (ProbeReply, error) {
	var reply ProbeReply
	err := c.request(map[string]any{
		"op":         "read_test",
		"bus_id":     busID,
		"slave_addr": slaveAddr,
		"fc":         fc,
		"address":    address,
		"count":      count,
		"timeout_ms": timeoutMS,
	}, &reply)
	return reply, err
}

// TestConnection kiểm tra thiết bị có trả lời không.
func (c ControlClient) TestConnection(busID, slaveAddr, timeoutMS int) (ProbeReply, error) {
	var reply ProbeReply
	err := c.request(map[string]any{
		"op":         "test_connection",
		"bus_id":     busID,
		"slave_addr": slaveAddr,
		"fc":         3,
		"address":    0,
		"count":      1,
		"timeout_ms": timeoutMS,
	}, &reply)
	return reply, err
}

func (c ControlClient) Status() (StatusReply, error) {
	var reply StatusReply
	err := c.request(map[string]any{"op": "status"}, &reply)
	return reply, err
}

// FrameRecord — một giao dịch Modbus đã thực hiện, đọc từ vòng nhớ của iobus.
//
// `T57-3.9` (`ADR-046` bản sửa 2026-08-19): Rev A ghi BẢN GHI GIAO DỊCH, không
// phải byte thô — libmodbus không lộ bộ đệm wire, và thay lớp transport của nó
// là rủi ro không tương xứng với một tính năng chẩn đoán.
type FrameRecord struct {
	At        int64  `json:"at"`
	Bus       int    `json:"bus"`
	Slave     int    `json:"slave"`
	FC        int    `json:"fc"`
	Addr      int    `json:"addr"`
	Count     int    `json:"count"`
	OK        bool   `json:"ok"`
	Reason    string `json:"reason"`
	ElapsedUS int    `json:"elapsedUs"`
	Attempt   int    `json:"attempt"`
	// U-18 (REC-DDC-FIELD-USE-20260927) — giá trị TRÊN DÂY của khung GHI: coil
	// là 0/1 từng bit (FC15 đủ từng bit, phần tử đầu là `addr`), thanh ghi là
	// word 16-bit như đã phát. Khung đọc và iobus bản cũ không có trường này.
	Values []int `json:"values,omitempty"`
}

type FramesReply struct {
	Result string        `json:"result"`
	Reason string        `json:"reason"`
	Code   string        `json:"code"`
	Frames []FrameRecord `json:"frames"`
}

// Frames đọc vòng nhớ giao dịch. CHỈ ĐỌC — không phát gì ra bus.
//
// `busID = 0` nghĩa là mọi bus. iobus bản cũ chưa có op này trả `unsupported`;
// nơi gọi phải phân biệt điều đó với "bus im lặng", vì hai tình trạng đó dẫn
// tới hai kết luận trái ngược khi đứng ở hiện trường.
func (c ControlClient) Frames(busID, limit int) (FramesReply, error) {
	var reply FramesReply
	err := c.request(map[string]any{"op": "frames", "bus": busID, "limit": limit}, &reply)
	return reply, err
}
