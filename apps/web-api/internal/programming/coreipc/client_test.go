package coreipc

import (
	"context"
	"errors"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type fakeCore struct {
	listener *net.UnixListener
	requests chan Request
	done     chan struct{}
	once     sync.Once
}

func startFakeCore(t *testing.T, calls int) *fakeCore {
	t.Helper()
	socket := filepath.Join(t.TempDir(), "programming-v1.sock")
	address, err := net.ResolveUnixAddr("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.ListenUnix("unix", address)
	if err != nil {
		t.Fatal(err)
	}
	server := &fakeCore{
		listener: listener,
		requests: make(chan Request, calls),
		done:     make(chan struct{}),
	}
	t.Cleanup(server.close)
	go func() {
		defer close(server.done)
		for index := 0; index < calls; index++ {
			connection, acceptErr := listener.AcceptUnix()
			if acceptErr != nil {
				return
			}
			frame, readErr := readFrame(connection)
			if readErr != nil {
				_ = connection.Close()
				return
			}
			request, decodeErr := DecodeRequestFrame(frame)
			if decodeErr != nil {
				_ = connection.Close()
				return
			}
			server.requests <- request
			response := ResponseFor(request, ResultOK, "", "core.programming.ipc", EmptyPayload())
			encoded, encodeErr := EncodeResponseFrame(response)
			if encodeErr == nil {
				_ = writeAll(connection, encoded)
			}
			_ = connection.Close()
		}
	}()
	return server
}

func (server *fakeCore) close() {
	server.once.Do(func() {
		_ = server.listener.Close()
		select {
		case <-server.done:
		case <-time.After(time.Second):
		}
	})
}

func (server *fakeCore) socketPath() string { return server.listener.Addr().String() }

func runtimeRequest(action Action) Request {
	request := deterministicRequest(action)
	request.DeadlineMonoNS = FutureDeadline(2 * time.Second)
	return request
}

func TestClientCallReconnectsAndChecksCorrelation(t *testing.T) {
	server := startFakeCore(t, 2)
	client := NewClient(server.socketPath(), CurrentUID())
	for index := 0; index < 2; index++ {
		request := runtimeRequest(ActionCapabilities)
		request.RequestID[0] = byte(index)
		response, err := client.Call(context.Background(), request)
		if err != nil {
			t.Fatalf("Call lần %d lỗi: %v", index+1, err)
		}
		if response.Result != ResultOK || !equalBytes(response.RequestID, request.RequestID) {
			t.Fatalf("response lần %d sai correlation: %+v", index+1, response)
		}
	}
}

func TestClientReconcileNeverReplaysMutation(t *testing.T) {
	server := startFakeCore(t, 1)
	client := NewClient(server.socketPath(), CurrentUID())
	request := runtimeRequest(ActionStage)
	if _, err := client.Reconcile(context.Background(), request); err != nil {
		t.Fatalf("Reconcile() lỗi: %v", err)
	}
	observed := <-server.requests
	if observed.Action != ActionOperationStatus {
		t.Fatalf("Reconcile replay %s thay vì OPERATION_STATUS", observed.Action)
	}
	if observed.ActorID != "" || string(observed.Payload) != string(EmptyPayload()) {
		t.Fatalf("Reconcile giữ mutation payload/actor: %+v", observed)
	}
}

func TestClientFailsClosedForPeerDeadlineAndUnavailable(t *testing.T) {
	server := startFakeCore(t, 1)
	wrongPeer := NewClient(server.socketPath(), CurrentUID()+1)
	if _, err := wrongPeer.Call(context.Background(), runtimeRequest(ActionCapabilities)); !errors.Is(err, ErrPeerCredential) {
		t.Fatalf("peer UID sai không bị chặn: %v", err)
	}

	expired := runtimeRequest(ActionCapabilities)
	expired.DeadlineMonoNS = 1
	client := NewClient(filepath.Join(t.TempDir(), "missing.sock"), CurrentUID())
	if _, err := client.Call(context.Background(), expired); !errors.Is(err, ErrDeadlineExceeded) {
		t.Fatalf("deadline hết không bị chặn trước dial: %v", err)
	}

	fresh := runtimeRequest(ActionCapabilities)
	if _, err := client.Call(context.Background(), fresh); !errors.Is(err, ErrCoreUnavailable) {
		t.Fatalf("Core không sẵn sàng không được phân loại đúng: %v", err)
	}
}
