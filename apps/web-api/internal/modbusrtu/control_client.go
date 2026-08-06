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
}

var ErrControlUnavailable = errors.New("iobus không mở kênh điều khiển fieldbus")

func (c ControlClient) timeout() time.Duration {
	if c.Timeout > 0 {
		return c.Timeout
	}
	return 5 * time.Second
}

func (c ControlClient) request(payload any, out any) error {
	if c.SocketPath == "" {
		return ErrControlUnavailable
	}
	conn, err := net.DialTimeout("unix", c.SocketPath, c.timeout())
	if err != nil {
		return fmt.Errorf("%w: %v", ErrControlUnavailable, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(c.timeout()))

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
