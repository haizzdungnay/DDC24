package simworker

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// Lỗi có ý nghĩa cho lớp application. Mỗi lỗi mang theo mã chi tiết để audit và
// public error được suy ra từ MỘT nguồn, không phải từ chuỗi văn bản.
var (
	ErrWorkerUnavailable = errors.New("worker mô phỏng không khả dụng")
	ErrHandshake         = errors.New("bắt tay worker thất bại")
	ErrTimeout           = errors.New("worker quá hạn trả lời")
	ErrProtocol          = errors.New("worker trả lời sai giao thức")
	ErrBroken            = errors.New("phiên worker đã hỏng")
)

// CommandError là lỗi worker TỰ báo (`SIM-E-*`). Khác hẳn lỗi vận chuyển: ở đây
// worker vẫn sống, vẫn đúng giao thức, và câu trả lời "không" của nó là một kết
// quả hợp lệ chứ không phải sự cố.
type CommandError struct {
	DetailCode string
	Detail     string
}

func (e *CommandError) Error() string {
	return fmt.Sprintf("worker từ chối lệnh: %s (%s)", e.DetailCode, e.Detail)
}

type Options struct {
	BinaryPath     string
	CommandTimeout time.Duration
	// TrustedKeyPaths — tập khoá công khai worker được phép tin, PHẢI trùng tập
	// Core đang dùng. Rỗng nghĩa là chỉ tin khoá nhúng lúc build, và trên một bo
	// thật (artifact ký bằng khoá thiết bị) điều đó làm mọi phiên hỏng ở bước
	// nạp artifact với `SIM-E-002`.
	TrustedKeyPaths []string
	// Env cho phép test chèn biến môi trường; production để nil.
	Env []string
}

// Manifest là thứ worker công bố sau `PREPARE`. Allowlist input đến TỪ ĐÂY, tức
// từ artifact đã seal — không phải từ request của client.
type Manifest struct {
	BaseTickMS       int64             `json:"baseTickMs"`
	Programs         []ManifestProgram `json:"programs"`
	SimulationInputs []InputDescriptor `json:"simulationInputs"`
	Observations     []Observation     `json:"observations"`
}

type ManifestProgram struct {
	ProgramID string `json:"programId"`
	PeriodMS  int64  `json:"periodMs"`
	Order     int    `json:"order"`
}

type InputDescriptor struct {
	ObservationID      string   `json:"observationId"`
	ProgramID          string   `json:"programId"`
	Variable           string   `json:"variable"`
	SourceKind         string   `json:"sourceKind"`
	DataType           string   `json:"dataType"`
	Unit               *string  `json:"unit"`
	Min                *float64 `json:"min"`
	Max                *float64 `json:"max"`
	SimulationWritable bool     `json:"simulationWritable"`
}

type Observation struct {
	ObservationID string `json:"observationId"`
	ProgramID     string `json:"programId"`
	Variable      string `json:"variable"`
	Kind          string `json:"kind"`
	DataType      string `json:"dataType"`
	Quality       string `json:"quality"`
	Value         any    `json:"value"`
}

// Frame là ảnh chụp sau một lệnh đã commit.
type Frame struct {
	VirtualTimeMS    int64         `json:"virtualTimeMs"`
	SnapshotSequence int64         `json:"snapshotSequence"`
	ResetEpoch       int64         `json:"resetEpoch"`
	Observations     []Observation `json:"observations"`
}

type TraceSample struct {
	VirtualTimeMS    int64 `json:"virtualTimeMs"`
	SnapshotSequence int64 `json:"snapshotSequence"`
	Values           []any `json:"values"`
}

type TracePage struct {
	Samples    []TraceSample `json:"samples"`
	NextCursor int64         `json:"nextCursor"`
	Total      int64         `json:"total"`
	Dropped    int64         `json:"dropped"`
}

type lineResult struct {
	payload []byte
	err     error
}

// Client sở hữu ĐÚNG một tiến trình worker.
//
// Không có kết nối lại, không có attach: nếu client này chết thì phiên chết
// theo. Đó là điểm của một worker ephemeral — một tiến trình còn sống mà không
// ai giữ handle là một tiến trình nằm ngoài quota và TTL.
type Client struct {
	options Options
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	lines   chan lineResult

	mu            sync.Mutex
	broken        bool
	brokenDetail  string
	workerVersion string
	commandSeq    int
}

// Spawn sinh worker và bắt tay. Trả về client đã sẵn sàng nhận lệnh, hoặc lỗi
// kèm mã chi tiết; khi lỗi, tiến trình (nếu đã sinh) đã được kill và reap.
func Spawn(ctx context.Context, options Options) (*Client, string, string, error) {
	if options.BinaryPath == "" {
		return nil, "", DetailCapability, ErrWorkerUnavailable
	}
	if _, err := os.Stat(options.BinaryPath); err != nil {
		return nil, "", DetailCapability, ErrWorkerUnavailable
	}
	if options.CommandTimeout <= 0 {
		options.CommandTimeout = 2 * time.Second
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, "", DetailSpawn, fmt.Errorf("%w: không sinh được token phiên", ErrWorkerUnavailable)
	}
	token := hex.EncodeToString(tokenBytes)

	arguments := make([]string, 0, len(options.TrustedKeyPaths)*2)
	for _, path := range options.TrustedKeyPaths {
		if path == "" {
			continue
		}
		arguments = append(arguments, "--st-trusted-key", path)
	}
	command := exec.Command(options.BinaryPath, arguments...)
	environment := options.Env
	if environment == nil {
		// Môi trường TỐI THIỂU: worker không cần PATH, HOME hay bất cứ thứ gì
		// khác. Truyền cả môi trường của `mkddc-web` xuống là cách rẻ nhất để rò
		// một biến cấu hình chứa đường dẫn hoặc bí mật vào tiến trình sandbox.
		environment = []string{}
	}
	command.Env = append(append([]string{}, environment...), "MKDDC_SIM_SESSION_TOKEN="+token)
	command.Stderr = nil

	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, "", DetailSpawn, fmt.Errorf("%w: %v", ErrWorkerUnavailable, err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, "", DetailSpawn, fmt.Errorf("%w: %v", ErrWorkerUnavailable, err)
	}
	if err := command.Start(); err != nil {
		return nil, "", DetailSpawn, fmt.Errorf("%w: %v", ErrWorkerUnavailable, err)
	}

	client := &Client{options: options, cmd: command, stdin: stdin, lines: make(chan lineResult, 4)}
	go client.readLoop(stdout)

	handshake, err := client.call(ctx, map[string]any{
		"cmd": "HELLO", "token": token, "protocolVersion": ProtocolVersion,
	}, nil)
	if err != nil {
		client.Kill()
		if errors.Is(err, ErrTimeout) {
			return nil, "", DetailTimeout, err
		}
		return nil, "", DetailHandshake, fmt.Errorf("%w: %v", ErrHandshake, err)
	}
	version, _ := handshake["workerVersion"].(string)
	if version == "" {
		client.Kill()
		return nil, "", DetailHandshake, ErrHandshake
	}
	if declared, ok := handshake["protocolVersion"].(float64); !ok || int(declared) != ProtocolVersion {
		client.Kill()
		return nil, "", DetailHandshake, fmt.Errorf("%w: protocol version lệch", ErrHandshake)
	}
	client.workerVersion = version
	return client, version, "", nil
}

func (c *Client) readLoop(stdout io.ReadCloser) {
	reader := bufio.NewReaderSize(stdout, 64*1024)
	defer close(c.lines)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			if len(line) > MaxResponseLineBytes {
				c.lines <- lineResult{err: ErrProtocol}
				return
			}
			c.lines <- lineResult{payload: line}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				c.lines <- lineResult{err: err}
			}
			return
		}
	}
}

func (c *Client) WorkerVersion() string { return c.workerVersion }

// call gửi một lệnh và chờ ĐÚNG một dòng trả lời.
//
// Quá hạn KHÔNG được coi là thất bại của lệnh: worker có thể đã commit xong mà
// chỉ trả lời chậm. Client vì vậy tự đánh dấu hỏng và buộc lớp trên đi đường
// reconcile, thay vì đoán kết quả.
func (c *Client) call(ctx context.Context, payload map[string]any, blob []byte) (map[string]any, error) {
	c.mu.Lock()
	if c.broken {
		c.mu.Unlock()
		return nil, ErrBroken
	}
	c.commandSeq++
	commandID := fmt.Sprintf("c%d", c.commandSeq)
	c.mu.Unlock()

	payload["commandId"] = commandID
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if _, err := c.stdin.Write(append(encoded, '\n')); err != nil {
		c.markBroken(DetailCrash)
		return nil, fmt.Errorf("%w: %v", ErrWorkerUnavailable, err)
	}
	if len(blob) > 0 {
		if _, err := c.stdin.Write(blob); err != nil {
			c.markBroken(DetailCrash)
			return nil, fmt.Errorf("%w: %v", ErrWorkerUnavailable, err)
		}
	}

	timer := time.NewTimer(c.options.CommandTimeout)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		c.markBroken(DetailTimeout)
		return nil, ctx.Err()
	case <-timer.C:
		c.markBroken(DetailTimeout)
		return nil, ErrTimeout
	case result, ok := <-c.lines:
		if !ok {
			c.markBroken(DetailCrash)
			return nil, fmt.Errorf("%w: worker đóng ống", ErrWorkerUnavailable)
		}
		if result.err != nil {
			c.markBroken(DetailProtocol)
			return nil, fmt.Errorf("%w: %v", ErrProtocol, result.err)
		}
		var response map[string]any
		if err := json.Unmarshal(result.payload, &response); err != nil {
			c.markBroken(DetailProtocol)
			return nil, ErrProtocol
		}
		// commandId phải khớp: một câu trả lời lạc nhịp làm mọi read-back sau đó
		// nói về một lệnh khác lệnh vừa gửi.
		if echoed, _ := response["commandId"].(string); echoed != commandID {
			c.markBroken(DetailProtocol)
			return nil, ErrProtocol
		}
		if ok, _ := response["ok"].(bool); !ok {
			detailCode, _ := response["errorCode"].(string)
			detail, _ := response["detail"].(string)
			return nil, &CommandError{DetailCode: detailCode, Detail: detail}
		}
		return response, nil
	}
}

func (c *Client) markBroken(detail string) {
	c.mu.Lock()
	if !c.broken {
		c.broken = true
		c.brokenDetail = detail
	}
	c.mu.Unlock()
}

// BrokenDetail trả mã chi tiết đã làm client hỏng, hoặc rỗng nếu còn lành.
func (c *Client) BrokenDetail() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.brokenDetail
}

func (c *Client) Prepare(ctx context.Context, artifact []byte) (Manifest, error) {
	if len(artifact) == 0 || len(artifact) > MaxArtifactBytes {
		return Manifest{}, fmt.Errorf("%w: artifact ngoài biên", ErrProtocol)
	}
	response, err := c.call(ctx, map[string]any{
		"cmd": "PREPARE", "artifactBytes": len(artifact),
	}, artifact)
	if err != nil {
		return Manifest{}, err
	}
	return decodeInto[Manifest](response)
}

func (c *Client) SetInput(ctx context.Context, observationID, dataType string, value any) error {
	_, err := c.call(ctx, map[string]any{
		"cmd": "SET_INPUT", "observationId": observationID, "dataType": dataType, "value": value,
	}, nil)
	return err
}

func (c *Client) Step(ctx context.Context) (Frame, error) {
	response, err := c.call(ctx, map[string]any{"cmd": "STEP"}, nil)
	if err != nil {
		return Frame{}, err
	}
	return decodeInto[Frame](response)
}

func (c *Client) Reset(ctx context.Context) (Frame, error) {
	response, err := c.call(ctx, map[string]any{"cmd": "RESET"}, nil)
	if err != nil {
		return Frame{}, err
	}
	return decodeInto[Frame](response)
}

func (c *Client) Read(ctx context.Context) (Frame, error) {
	response, err := c.call(ctx, map[string]any{"cmd": "READ"}, nil)
	if err != nil {
		return Frame{}, err
	}
	return decodeInto[Frame](response)
}

func (c *Client) Trace(ctx context.Context, cursor, limit int64) (TracePage, error) {
	if limit <= 0 || limit > MaxTraceLimit {
		limit = MaxTraceLimit
	}
	response, err := c.call(ctx, map[string]any{"cmd": "TRACE", "cursor": cursor, "limit": limit}, nil)
	if err != nil {
		return TracePage{}, err
	}
	return decodeInto[TracePage](response)
}

// Stop yêu cầu worker tự kết thúc, rồi ĐẢM BẢO nó chết.
//
// Không tin vào lời chào tạm biệt: nếu worker treo sau khi trả lời STOP thì nó
// vẫn là một tiến trình chiếm quota. `Kill()` luôn chạy.
func (c *Client) Stop(ctx context.Context) error {
	_, err := c.call(ctx, map[string]any{"cmd": "STOP"}, nil)
	c.Kill()
	if err != nil && !errors.Is(err, ErrBroken) {
		return err
	}
	return nil
}

// Kill giết và THU HỒI tiến trình. An toàn khi gọi nhiều lần.
//
// `Wait()` là phần không được quên: một tiến trình đã chết mà chưa reap vẫn là
// một zombie chiếm slot trong bảng tiến trình, và đó đúng là kiểu rò rỉ mà
// `ADR-053` bắt phải chứng minh không xảy ra.
func (c *Client) Kill() {
	c.markBroken(DetailCrash)
	if c.cmd == nil || c.cmd.Process == nil {
		return
	}
	_ = c.stdin.Close()
	_ = c.cmd.Process.Signal(syscall.SIGKILL)
	_ = c.cmd.Wait()
}

// PID chỉ dùng cho log nội bộ và test; nó KHÔNG phải danh tính công khai và
// không bao giờ được persist hay trả cho FE.
func (c *Client) PID() int {
	if c.cmd == nil || c.cmd.Process == nil {
		return 0
	}
	return c.cmd.Process.Pid
}

func decodeInto[T any](response map[string]any) (T, error) {
	var out T
	encoded, err := json.Marshal(response)
	if err != nil {
		return out, ErrProtocol
	}
	if err := json.Unmarshal(encoded, &out); err != nil {
		return out, ErrProtocol
	}
	return out, nil
}
