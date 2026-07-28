package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

const (
	netcfgProtocolVersion = 1
	netcfgMaxFrameBytes   = 8192
)

var errNetcfgUnavailable = errors.New("network configuration service unavailable")
var errNetcfgInvalidResponse = errors.New("invalid network configuration service response")

type NetcfgDNS struct {
	Mode    string   `json:"mode"`
	Servers []string `json:"servers"`
}

func (dns *NetcfgDNS) UnmarshalJSON(data []byte) error {
	var wire struct {
		Mode    *string         `json:"mode"`
		Servers json.RawMessage `json:"servers"`
	}
	if err := decodeStrictNetcfgJSON(data, &wire); err != nil {
		return err
	}
	if wire.Mode == nil || len(wire.Servers) == 0 || bytes.Equal(bytes.TrimSpace(wire.Servers), []byte("null")) {
		return errors.New("dns mode and servers array are required")
	}
	var rawServers []json.RawMessage
	if err := json.Unmarshal(wire.Servers, &rawServers); err != nil {
		return errors.New("dns servers must be an array")
	}
	servers := make([]string, len(rawServers))
	for i, rawServer := range rawServers {
		if bytes.Equal(bytes.TrimSpace(rawServer), []byte("null")) || json.Unmarshal(rawServer, &servers[i]) != nil {
			return errors.New("dns servers must contain strings")
		}
	}
	*dns = NetcfgDNS{Mode: *wire.Mode, Servers: servers}
	return nil
}

type NetcfgCandidate struct {
	Interface string     `json:"interface"`
	Mode      string     `json:"mode"`
	IPv4      string     `json:"ipv4,omitempty"`
	Netmask   string     `json:"netmask,omitempty"`
	Gateway   string     `json:"gateway,omitempty"`
	DNS       *NetcfgDNS `json:"dns,omitempty"`
}

func (candidate *NetcfgCandidate) UnmarshalJSON(data []byte) error {
	var wire struct {
		Interface *string         `json:"interface"`
		Mode      *string         `json:"mode"`
		IPv4      json.RawMessage `json:"ipv4"`
		Netmask   json.RawMessage `json:"netmask"`
		Gateway   json.RawMessage `json:"gateway"`
		DNS       json.RawMessage `json:"dns"`
	}
	if err := decodeStrictNetcfgJSON(data, &wire); err != nil {
		return err
	}
	if wire.Interface == nil || wire.Mode == nil {
		return errors.New("candidate interface and mode are required")
	}
	ipv4, hasIPv4, err := decodeOptionalNetcfgString(wire.IPv4)
	if err != nil {
		return err
	}
	netmask, hasNetmask, err := decodeOptionalNetcfgString(wire.Netmask)
	if err != nil {
		return err
	}
	gateway, hasGateway, err := decodeOptionalNetcfgString(wire.Gateway)
	if err != nil {
		return err
	}
	if *wire.Mode == "static" && (!hasIPv4 || !hasNetmask) {
		return errors.New("static candidate requires ipv4 and netmask")
	}
	if *wire.Mode == "dhcp" && (hasIPv4 || hasNetmask || hasGateway) {
		return errors.New("dhcp candidate forbids ipv4, netmask, and gateway")
	}

	decoded := NetcfgCandidate{Interface: *wire.Interface, Mode: *wire.Mode, IPv4: ipv4, Netmask: netmask, Gateway: gateway}
	if len(wire.DNS) > 0 {
		if bytes.Equal(bytes.TrimSpace(wire.DNS), []byte("null")) {
			return errors.New("candidate dns must be an object")
		}
		var dns NetcfgDNS
		if err := json.Unmarshal(wire.DNS, &dns); err != nil {
			return err
		}
		decoded.DNS = &dns
	}
	*candidate = decoded
	return nil
}

type NetcfgActive struct {
	Interface    string   `json:"interface"`
	Link         string   `json:"link"`
	AdminUp      bool     `json:"adminUp"`
	Carrier      bool     `json:"carrier"`
	ReasonCode   string   `json:"reasonCode"`
	Mode         string   `json:"mode"`
	IPv4         string   `json:"ipv4"`
	PrefixLength int      `json:"prefixLength"`
	Gateway      string   `json:"gateway"`
	DNSServers   []string `json:"dnsServers"`
}

func (active *NetcfgActive) UnmarshalJSON(data []byte) error {
	var wire struct {
		Interface    *string         `json:"interface"`
		Link         *string         `json:"link"`
		AdminUp      *bool           `json:"adminUp"`
		Carrier      *bool           `json:"carrier"`
		ReasonCode   *string         `json:"reasonCode"`
		Mode         *string         `json:"mode"`
		IPv4         *string         `json:"ipv4"`
		PrefixLength *int            `json:"prefixLength"`
		Gateway      *string         `json:"gateway"`
		DNSServers   json.RawMessage `json:"dnsServers"`
	}
	if err := decodeStrictNetcfgJSON(data, &wire); err != nil {
		return err
	}
	if wire.Interface == nil || wire.Link == nil || wire.AdminUp == nil || wire.Carrier == nil ||
		wire.ReasonCode == nil || wire.Mode == nil || wire.IPv4 == nil || wire.PrefixLength == nil ||
		wire.Gateway == nil || len(wire.DNSServers) == 0 || bytes.Equal(bytes.TrimSpace(wire.DNSServers), []byte("null")) {
		return errors.New("active state fields are required")
	}
	var rawServers []json.RawMessage
	if err := json.Unmarshal(wire.DNSServers, &rawServers); err != nil {
		return errors.New("active dnsServers must be an array")
	}
	servers := make([]string, len(rawServers))
	for i, rawServer := range rawServers {
		if bytes.Equal(bytes.TrimSpace(rawServer), []byte("null")) || json.Unmarshal(rawServer, &servers[i]) != nil {
			return errors.New("active dnsServers must contain strings")
		}
	}
	*active = NetcfgActive{
		Interface: *wire.Interface, Link: *wire.Link, AdminUp: *wire.AdminUp, Carrier: *wire.Carrier,
		ReasonCode: *wire.ReasonCode, Mode: *wire.Mode, IPv4: *wire.IPv4, PrefixLength: *wire.PrefixLength,
		Gateway: *wire.Gateway, DNSServers: servers,
	}
	return nil
}

type NetcfgManagement struct {
	Hostname string `json:"hostname"`
	MDNSName string `json:"mdnsName"`
	Stable   bool   `json:"stable"`
}

func (management *NetcfgManagement) UnmarshalJSON(data []byte) error {
	var wire struct {
		Hostname *string `json:"hostname"`
		MDNSName *string `json:"mdnsName"`
		Stable   *bool   `json:"stable"`
	}
	if err := decodeStrictNetcfgJSON(data, &wire); err != nil {
		return err
	}
	if wire.Hostname == nil || wire.MDNSName == nil || wire.Stable == nil {
		return errors.New("management hostname, mdnsName, and stable are required")
	}
	*management = NetcfgManagement{Hostname: *wire.Hostname, MDNSName: *wire.MDNSName, Stable: *wire.Stable}
	return nil
}

type NetcfgResponse struct {
	Version            int               `json:"version"`
	RequestID          string            `json:"requestId"`
	Result             string            `json:"result"`
	ReasonCode         string            `json:"reasonCode"`
	Message            string            `json:"message,omitempty"`
	TransactionID      string            `json:"transactionId,omitempty"`
	State              string            `json:"state"`
	RollbackRemainingS uint32            `json:"rollbackRemainingS,omitempty"`
	Capabilities       []string          `json:"capabilities,omitempty"`
	Active             *NetcfgActive     `json:"active,omitempty"`
	Configured         *NetcfgCandidate  `json:"configured,omitempty"`
	Pending            *NetcfgCandidate  `json:"pending,omitempty"`
	Management         *NetcfgManagement `json:"management,omitempty"`
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
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&resp); err != nil {
		return NetcfgResponse{}, fmt.Errorf("%w: decode", errNetcfgInvalidResponse)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) || !validNetcfgResponse(resp, requestID) {
		return NetcfgResponse{}, errNetcfgInvalidResponse
	}
	return resp, nil
}

func validNetcfgResponse(response NetcfgResponse, requestID string) bool {
	if response.Version != netcfgProtocolVersion || response.RequestID != requestID || response.ReasonCode == "" {
		return false
	}
	if response.Result != "accepted" && response.Result != "rejected" {
		return false
	}
	switch response.State {
	case "idle", "staged", "applying", "awaiting_confirmation", "confirmed", "rolling_back", "rolled_back", "failed":
	default:
		return false
	}
	if response.RollbackRemainingS > 120 || (response.TransactionID != "" && !netcfgTokenPattern.MatchString(response.TransactionID)) {
		return false
	}
	if !hasExactNetcfgCapabilities(response.Capabilities) || response.Management == nil {
		return false
	}
	if response.Active != nil && !validNetcfgActive(*response.Active) {
		return false
	}
	if response.Configured != nil && !validNetcfgResponseCandidate(*response.Configured) {
		return false
	}
	if response.Pending != nil && !validNetcfgResponseCandidate(*response.Pending) {
		return false
	}
	if !validHostname(response.Management.Hostname) || !validHostname(response.Management.MDNSName) {
		return false
	}
	return true
}

func hasExactNetcfgCapabilities(capabilities []string) bool {
	return len(capabilities) == 2 && capabilities[0] == "dns" && capabilities[1] == "management-hostname"
}

func validNetcfgActive(active NetcfgActive) bool {
	if active.Interface != "" && (!netcfgInterfacePattern.MatchString(active.Interface) || active.Interface == "lo") {
		return false
	}
	if active.Link != "up" && active.Link != "down" && active.Link != "unknown" {
		return false
	}
	if active.Mode != "static" && active.Mode != "dhcp" && active.Mode != "unknown" {
		return false
	}
	switch active.ReasonCode {
	case "OK", "INTERFACE_NOT_FOUND", "KERNEL_STATE_UNAVAILABLE", "ADMIN_DOWN", "NO_CARRIER", "NO_ACTIVE_ADDRESS":
	default:
		return false
	}
	if active.PrefixLength < 0 || active.PrefixLength > 32 {
		return false
	}
	if active.IPv4 != "" && !isCanonicalNetcfgIPv4(active.IPv4) {
		return false
	}
	if active.Gateway != "" && !isCanonicalNetcfgIPv4(active.Gateway) {
		return false
	}
	return len(active.DNSServers) <= 4 && validCanonicalNetcfgIPv4List(active.DNSServers)
}

func validNetcfgResponseCandidate(candidate NetcfgCandidate) bool {
	return len(validateNetcfgCandidate(candidate)) == 0
}

func validNetcfgDNS(candidateMode string, dns *NetcfgDNS) bool {
	if dns == nil {
		return true
	}
	switch dns.Mode {
	case "auto":
		return candidateMode == "dhcp" && len(dns.Servers) == 0
	case "manual":
		return len(dns.Servers) >= 1 && len(dns.Servers) <= 4 && validCanonicalNetcfgIPv4List(dns.Servers)
	default:
		return false
	}
}

func validCanonicalNetcfgIPv4List(values []string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !isCanonicalNetcfgIPv4(value) {
			return false
		}
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

func isCanonicalNetcfgIPv4(value string) bool {
	parsed := net.ParseIP(value)
	return parsed != nil && parsed.To4() != nil && !strings.Contains(value, ":") && parsed.To4().String() == value
}

func decodeStrictNetcfgJSON(data []byte, dst any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("invalid trailing json")
	}
	return nil
}

func decodeOptionalNetcfgString(raw json.RawMessage) (string, bool, error) {
	if len(raw) == 0 {
		return "", false, nil
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", true, errors.New("candidate string fields cannot be null")
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", true, errors.New("candidate string fields must be strings")
	}
	return value, true, nil
}
