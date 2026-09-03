package app

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

/* `WebIpc` của core (`apps/core/adapters/ipc/web_ipc.cpp`):
 *
 *   ::listen(fd_, 4)                → hàng đợi accept sâu 4
 *   max_accept_attempts  = 4        → nhận tối đa 4 kết nối MỖI LẦN poll
 *   max_clients          = 4        → giữ tối đa 4 client
 *
 * và `poll()` chạy đúng MỘT LẦN mỗi scan cycle — `core.base_step_ms=1000` trên
 * Foxlinx, tức một giây một lần.
 *
 * CƠ CHẾ HỎNG (đo lại mới ra, khác với phỏng đoán ban đầu): với Unix socket,
 * `connect()` KHÔNG chờ server gọi `accept()` — nó thành công ngay khi hàng đợi
 * còn chỗ, và **thất bại NGAY LẬP TỨC bằng ECONNREFUSED khi hàng đợi đầy**
 * (khác TCP, không có SYN retry). Nên timeout dial không phải cái cứu được:
 * thứ quyết định là SỐ CÚ DIAL ĐỒNG THỜI so với độ sâu hàng đợi.
 *
 * `sendWebIPC` mở một kết nối MỚI cho mỗi request và trước bản vá không có hạn
 * mức nào, nên một trang UI poll alarms/overview/runtime cùng lúc dễ dàng vượt
 * 4 cú dial trong một chu kỳ ⇒ ECONNREFUSED ⇒ `WARN alarms_read degraded`. */

// backloggedServer dựng listener Unix với backlog ĐÚNG 4 như core, và chỉ
// accept theo từng đợt ở biên chu kỳ — mô hình `poll()` mỗi scan cycle.
type backloggedServer struct {
	listener net.Listener
	stop     chan struct{}
	wg       sync.WaitGroup
}

func newBackloggedServer(t *testing.T, backlog int, cycle time.Duration, perCycle int) *backloggedServer {
	t.Helper()
	sock := filepath.Join(t.TempDir(), "core.sock")

	fd, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		t.Fatalf("socket: %v", err)
	}
	if err := syscall.Bind(fd, &syscall.SockaddrUnix{Name: sock}); err != nil {
		syscall.Close(fd)
		t.Fatalf("bind: %v", err)
	}
	// Đây là điểm mấu chốt: net.Listen dùng backlog = somaxconn (hàng nghìn),
	// che mất hẳn lỗi. Phải đặt đúng 4 như core.
	if err := syscall.Listen(fd, backlog); err != nil {
		syscall.Close(fd)
		t.Fatalf("listen: %v", err)
	}
	file := os.NewFile(uintptr(fd), sock)
	listener, err := net.FileListener(file)
	_ = file.Close()
	if err != nil {
		t.Fatalf("FileListener: %v", err)
	}

	server := &backloggedServer{listener: listener, stop: make(chan struct{})}
	server.wg.Add(1)
	go server.serve(cycle, perCycle)
	t.Cleanup(func() {
		close(server.stop)
		_ = listener.Close()
		server.wg.Wait()
	})
	return server
}

func (s *backloggedServer) path() string { return s.listener.Addr().String() }

func (s *backloggedServer) serve(cycle time.Duration, perCycle int) {
	defer s.wg.Done()
	for {
		select {
		case <-s.stop:
			return
		default:
		}
		time.Sleep(cycle)
		for taken := 0; taken < perCycle; taken++ {
			_ = s.listener.(*net.UnixListener).SetDeadline(time.Now().Add(5 * time.Millisecond))
			conn, err := s.listener.Accept()
			if err != nil {
				break
			}
			s.wg.Add(1)
			go func(c net.Conn) {
				defer s.wg.Done()
				defer c.Close()
				line, err := bufio.NewReader(c).ReadBytes('\n')
				if err != nil {
					return
				}
				var cmd map[string]any
				_ = json.Unmarshal(line, &cmd)
				resp, _ := json.Marshal(map[string]any{
					"id": cmd["id"], "result": "accepted", "alarms": []any{}})
				_, _ = c.Write(append(resp, '\n'))
			}(conn)
		}
	}
}

/* Bất biến chính: dưới đúng mô hình accept của core, một loạt request đồng thời
 * KHÔNG được sinh ra `core unavailable`.
 *
 * Không có hạn mức (bản trước bản vá) thì 24 cú dial cùng lúc làm tràn hàng đợi
 * sâu 4 và phần lớn bị ECONNREFUSED ngay. */
func TestWebIPCConcurrentReadsDoNotExhaustCoreBacklog(t *testing.T) {
	server := newBackloggedServer(t, 4, 40*time.Millisecond, 4)
	client := &CoreClient{SockPath: server.path()}

	var failures int64
	var wg sync.WaitGroup
	for index := 0; index < 24; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if _, err := client.ReadAlarms(ctx); err != nil {
				atomic.AddInt64(&failures, 1)
			}
		}()
	}
	wg.Wait()

	if failures > 0 {
		t.Fatalf("%d/24 request hỏng vì tràn hàng đợi accept của core (backlog 4)", failures)
	}
}

/* Hàng đợi phía web phải tôn trọng ctx: một core treo không được giữ handler
 * HTTP lại quá deadline của chính request. */
func TestWebIPCSlotAcquireRespectsContext(t *testing.T) {
	client := &CoreClient{SockPath: filepath.Join(t.TempDir(), "absent.sock")}
	for index := 0; index < coreWebIPCMaxInFlight; index++ {
		if _, err := client.acquireWebIPCSlot(context.Background()); err != nil {
			t.Fatalf("chiếm slot %d: %v", index, err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := client.acquireWebIPCSlot(ctx); err == nil {
		t.Fatal("hết slot mà ctx đã hết hạn thì phải trả lỗi, không được chờ vô hạn")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("chờ %v — không tôn trọng ctx", elapsed)
	}
}

/* Hạn mức phải NHỎ HƠN `max_clients` của core, không bằng: vượt là core
 * `::accept4` rồi `::close` ngay, và client thấy dial thành công nhưng
 * write/read hỏng — kiểu lỗi khó lần hơn hẳn ECONNREFUSED. */
func TestWebIPCLimitLeavesHeadroomUnderCoreMaxClients(t *testing.T) {
	const coreMaxClients = 4 // web_ipc.cpp
	if coreWebIPCMaxInFlight >= coreMaxClients {
		t.Fatalf("hạn mức %d không chừa slot nào dưới max_clients=%d của core",
			coreWebIPCMaxInFlight, coreMaxClients)
	}
}
