package coreipc

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"os"
	"time"

	"golang.org/x/sys/unix"
)

const defaultCallTimeout = 3 * time.Second

type Client struct {
	SocketPath     string
	AllowedPeerUID uint32
	CallTimeout    time.Duration
}

func NewClient(socketPath string, allowedPeerUID uint32) *Client {
	return &Client{SocketPath: socketPath, AllowedPeerUID: allowedPeerUID, CallTimeout: defaultCallTimeout}
}

func (client *Client) Call(ctx context.Context, request Request) (Response, error) {
	if err := ValidateRequest(request); err != nil {
		return Response{}, err
	}
	now, err := MonotonicNowNS()
	if err != nil {
		return Response{}, err
	}
	if request.DeadlineMonoNS <= now {
		return Response{}, protocolError(ErrDeadlineExceeded, "deadlineMonoNs", nil)
	}
	frame, err := EncodeRequestFrame(request)
	if err != nil {
		return Response{}, err
	}
	timeout := client.CallTimeout
	if timeout <= 0 {
		timeout = defaultCallTimeout
	}
	dialer := net.Dialer{Timeout: timeout}
	connection, err := dialer.DialContext(ctx, "unix", client.SocketPath)
	if err != nil {
		return Response{}, fmt.Errorf("%w: %v", ErrCoreUnavailable, err)
	}
	defer connection.Close()
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		return Response{}, protocolError(ErrCoreUnavailable, "transport", nil)
	}
	if err := verifyPeerUID(unixConnection, client.AllowedPeerUID); err != nil {
		return Response{}, err
	}
	deadline := time.Now().Add(timeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := connection.SetDeadline(deadline); err != nil {
		return Response{}, err
	}
	if err := writeAll(connection, frame); err != nil {
		return Response{}, fmt.Errorf("%w: write: %v", ErrCoreUnavailable, err)
	}
	responseFrame, err := readFrame(connection)
	if err != nil {
		return Response{}, err
	}
	response, err := DecodeResponseFrame(responseFrame)
	if err != nil {
		return Response{}, err
	}
	if !equalBytes(response.RequestID, request.RequestID) || response.CorrelationID != request.CorrelationID {
		return Response{}, protocolError(ErrInvalidEnvelope, "response.correlation", nil)
	}
	return response, nil
}

func writeAll(writer io.Writer, frame []byte) error {
	for len(frame) > 0 {
		written, err := writer.Write(frame)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		frame = frame[written:]
	}
	return nil
}

// Reconcile chỉ query OPERATION_STATUS; không replay mutation khi Call timeout.
func (client *Client) Reconcile(ctx context.Context, request Request) (Response, error) {
	if len(request.OperationID) != 16 {
		return Response{}, protocolError(ErrOperationRequired, "operationId", nil)
	}
	request.Action = ActionOperationStatus
	request.ActorID = ""
	request.Payload = EmptyPayload()
	hash := sha256Bytes(request.Payload)
	request.PayloadHash = hash
	return client.Call(ctx, request)
}

func readFrame(reader io.Reader) ([]byte, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(reader, header); err != nil {
		return nil, fmt.Errorf("%w: header: %v", ErrFrameTruncated, err)
	}
	length := binary.LittleEndian.Uint32(header)
	if length == 0 {
		return nil, protocolError(ErrInvalidEnvelope, "frame.length", nil)
	}
	if length > MaxFramePayload {
		return nil, protocolError(ErrFrameTooLarge, "frame.length", nil)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, fmt.Errorf("%w: payload: %v", ErrFrameTruncated, err)
	}
	frame := append(header, payload...)
	return frame, nil
}

func verifyPeerUID(connection *net.UnixConn, allowed uint32) error {
	raw, err := connection.SyscallConn()
	if err != nil {
		return protocolError(ErrPeerCredential, "SO_PEERCRED", err)
	}
	var credential *unix.Ucred
	var socketErr error
	if err := raw.Control(func(fd uintptr) {
		credential, socketErr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil {
		return protocolError(ErrPeerCredential, "SO_PEERCRED", err)
	}
	if socketErr != nil || credential == nil {
		return protocolError(ErrPeerCredential, "SO_PEERCRED", socketErr)
	}
	if credential.Uid != allowed {
		return protocolError(ErrPeerCredential, "peer.uid", fmt.Errorf("expected %d, got %d", allowed, credential.Uid))
	}
	return nil
}

func MonotonicNowNS() (uint64, error) {
	var timestamp unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &timestamp); err != nil {
		return 0, err
	}
	return uint64(timestamp.Sec)*uint64(time.Second) + uint64(timestamp.Nsec), nil
}

func FutureDeadline(duration time.Duration) uint64 {
	now, err := MonotonicNowNS()
	if err != nil {
		return 0
	}
	return now + uint64(duration)
}

func CurrentUID() uint32 { return uint32(os.Getuid()) }

func sha256Bytes(payload []byte) []byte {
	hash := sha256.Sum256(payload)
	return append([]byte(nil), hash[:]...)
}
