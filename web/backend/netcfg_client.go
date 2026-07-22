package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"time"
)

const (
	netcfgProtocolVersion = 1
	netcfgMaxFrameBytes   = 8192
)

var errNetcfgUnavailable = errors.New("network configuration service unavailable")

type NetcfgCandidate struct {
	Interface string `json:"interface"`
	Mode      string `json:"mode"`
	IPv4      string `json:"ipv4,omitempty"`
	Netmask   string `json:"netmask,omitempty"`
	Gateway   string `json:"gateway,omitempty"`
}

type NetcfgActive struct {
	Interface    string `json:"interface"`
	Link         string `json:"link"`
	Mode         string `json:"mode"`
	IPv4         string `json:"ipv4"`
	PrefixLength int    `json:"prefixLength"`
	Gateway      string `json:"gateway"`
}

type NetcfgResponse struct {
	Version            int              `json:"version"`
	RequestID          string           `json:"requestId"`
	Result             string           `json:"result"`
	ReasonCode         string           `json:"reasonCode"`
	Message            string           `json:"message,omitempty"`
	TransactionID      string           `json:"transactionId,omitempty"`
	State              string           `json:"state"`
	RollbackRemainingS uint32           `json:"rollbackRemainingS,omitempty"`
	Active             *NetcfgActive    `json:"active,omitempty"`
	Pending            *NetcfgCandidate `json:"pending,omitempty"`
}

type netcfgAuthority interface {
	Request(context.Context, string, string, string, *NetcfgCandidate) (NetcfgResponse, error)
}

type NetcfgClient struct {
	socketPath string
}

func NewNetcfgClient(socketPath string) *NetcfgClient {
	return &NetcfgClient{socketPath: socketPath}
}

func (c *NetcfgClient) Request(ctx context.Context, requestID, action, transactionID string, candidate *NetcfgCandidate) (NetcfgResponse, error) {
	if c == nil || c.socketPath == "" {
		return NetcfgResponse{}, errNetcfgUnavailable
	}
	req := struct {
		Version       int              `json:"version"`
		RequestID     string           `json:"requestId"`
		Action        string           `json:"action"`
		TransactionID string           `json:"transactionId,omitempty"`
		Candidate     *NetcfgCandidate `json:"candidate,omitempty"`
	}{netcfgProtocolVersion, requestID, action, transactionID, candidate}

	dialer := net.Dialer{Timeout: 2 * time.Second}
	conn, err := dialer.DialContext(ctx, "unix", c.socketPath)
	if err != nil {
		return NetcfgResponse{}, fmt.Errorf("%w: connect", errNetcfgUnavailable)
	}
	defer conn.Close()
	deadline := time.Now().Add(4 * time.Second)
	if callerDeadline, ok := ctx.Deadline(); ok && callerDeadline.Before(deadline) {
		deadline = callerDeadline
	}
	_ = conn.SetDeadline(deadline)
	if err := json.NewEncoder(conn).Encode(req); err != nil {
		return NetcfgResponse{}, fmt.Errorf("%w: write", errNetcfgUnavailable)
	}

	reader := bufio.NewReader(io.LimitReader(conn, netcfgMaxFrameBytes+1))
	line, err := reader.ReadBytes('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return NetcfgResponse{}, fmt.Errorf("%w: read", errNetcfgUnavailable)
	}
	if len(line) == 0 || len(line) > netcfgMaxFrameBytes {
		return NetcfgResponse{}, fmt.Errorf("%w: invalid frame", errNetcfgUnavailable)
	}
	var resp NetcfgResponse
	if err := json.Unmarshal(line, &resp); err != nil || resp.Version != netcfgProtocolVersion || resp.RequestID != requestID {
		return NetcfgResponse{}, fmt.Errorf("%w: invalid response", errNetcfgUnavailable)
	}
	return resp, nil
}
