package app

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const (
	hmiProtocolVersion = 1
	hmiMaxFrameBytes   = 8192
	hmiSessionIdle     = 15 * time.Minute
	hmiOverrideMaxS    = 3600
)

type hmiCore interface {
	CoreStatusClient
	ReadPoints(context.Context) ([]PointDTO, error)
	CommandPoint(context.Context, string, any, bool, uint32, string) (PointDTO, error)
	QueryPoint(context.Context, string, string) (PointDTO, error)
	ReadAlarms(context.Context) ([]AlarmDTO, error)
	AckAlarmAs(context.Context, string, AlarmActionRequest, string) error
}

type hmiRequest struct {
	Version       int              `json:"version"`
	RequestID     string           `json:"requestId"`
	Action        string           `json:"action"`
	Token         string           `json:"token,omitempty"`
	Username      string           `json:"username,omitempty"`
	Password      string           `json:"password,omitempty"`
	PointID       string           `json:"pointId,omitempty"`
	AlarmID       string           `json:"alarmId,omitempty"`
	Mode          string           `json:"mode,omitempty"`
	Reason        string           `json:"reason,omitempty"`
	Value         *float64         `json:"value,omitempty"`
	TTLS          uint32           `json:"ttlS,omitempty"`
	TransactionID string           `json:"transactionId,omitempty"`
	Candidate     *NetcfgCandidate `json:"candidate,omitempty"`
}

type hmiPolicyPoint struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Min        float64  `json:"min"`
	Max        float64  `json:"max"`
	Actions    []string `json:"actions"`
	MaxTTLS    uint32   `json:"maxTtlS"`
	ReasonNeed bool     `json:"reasonRequired"`
}

type hmiResponse struct {
	Version    int              `json:"version"`
	RequestID  string           `json:"requestId"`
	Result     string           `json:"result"`
	ReasonCode string           `json:"reasonCode"`
	Message    string           `json:"message,omitempty"`
	Token      string           `json:"token,omitempty"`
	Role       Role             `json:"role,omitempty"`
	ExpiresInS uint32           `json:"expiresInS,omitempty"`
	Policy     []hmiPolicyPoint `json:"policy,omitempty"`
	Point      *PointDTO        `json:"point,omitempty"`
	Points     []PointDTO       `json:"points,omitempty"`
	Alarms     []AlarmDTO       `json:"alarms,omitempty"`
	CoreStatus *CoreStatus      `json:"coreStatus,omitempty"`
	Network    *NetcfgResponse  `json:"network,omitempty"`
}

type hmiSession struct {
	username string
	role     Role
	lastSeen time.Time
}

type hmiCachedResponse struct {
	hash [32]byte
	body []byte
}

type hmiLoginWindow struct {
	start time.Time
	count int
}

type HMIBroker struct {
	cfg      Config
	auth     *AuthService
	core     hmiCore
	netcfg   netcfgAuthority
	logger   *log.Logger
	audit    *AuditLogger
	auditLog *hmiAuditStore
	now      func() time.Time
	listener net.Listener

	mu         sync.Mutex
	sessions   map[string]hmiSession
	loginRate  map[uint32]hmiLoginWindow
	cache      map[string]hmiCachedResponse
	cacheOrder []string
	connSlots  chan struct{}
}

func NewHMIBroker(cfg Config, auth *AuthService, core hmiCore, logger *log.Logger, audit *AuditLogger) *HMIBroker {
	if logger == nil {
		logger = log.Default()
	}
	return &HMIBroker{
		cfg: cfg, auth: auth, core: core, netcfg: NewNetcfgClient(cfg.NetcfgSock), logger: logger, audit: audit,
		auditLog: &hmiAuditStore{path: cfg.HMIAuditPath},
		now:      time.Now, sessions: make(map[string]hmiSession),
		loginRate: make(map[uint32]hmiLoginWindow), cache: make(map[string]hmiCachedResponse),
		connSlots: make(chan struct{}, 8),
	}
}

func (b *HMIBroker) Serve(ctx context.Context) error {
	if b == nil || b.auth == nil || b.core == nil || b.cfg.HMISock == "" {
		return errors.New("hmi broker configuration incomplete")
	}
	if err := os.MkdirAll(filepath.Dir(b.cfg.HMISock), 0o750); err != nil {
		return fmt.Errorf("create hmi socket directory: %w", err)
	}
	_ = os.Remove(b.cfg.HMISock)
	listener, err := net.Listen("unix", b.cfg.HMISock)
	if err != nil {
		return fmt.Errorf("listen hmi socket: %w", err)
	}
	b.listener = listener
	if err := os.Chmod(b.cfg.HMISock, 0o660); err != nil {
		_ = listener.Close()
		return fmt.Errorf("chmod hmi socket: %w", err)
	}
	b.logger.Printf("INFO hmi_ipc_listen path=%s protocol=%d", b.cfg.HMISock, hmiProtocolVersion)
	go func() {
		<-ctx.Done()
		_ = b.Close()
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return nil
			}
			b.logger.Printf("WARN hmi_ipc_accept reason=accept_failed")
			continue
		}
		uid, ok := hmiPeerUID(conn)
		if !ok || !b.peerAllowed(uid) {
			b.logger.Printf("WARN hmi_ipc_peer result=rejected uid=%d", uid)
			_ = conn.Close()
			continue
		}
		select {
		case b.connSlots <- struct{}{}:
			go func() {
				defer func() { <-b.connSlots }()
				b.serveConn(ctx, conn, uid)
			}()
		default:
			b.logger.Printf("WARN hmi_ipc_peer result=rejected uid=%d reason=busy", uid)
			_ = conn.Close()
		}
	}
}

func (b *HMIBroker) Close() error {
	if b == nil || b.listener == nil {
		return nil
	}
	err := b.listener.Close()
	_ = os.Remove(b.cfg.HMISock)
	return err
}

func (b *HMIBroker) peerAllowed(uid uint32) bool {
	raw := strings.TrimSpace(b.cfg.HMIAllowedUID)
	if raw == "" {
		return true // AF_UNIX mode/group remains the deployment allowlist.
	}
	want, err := strconv.ParseUint(raw, 10, 32)
	return err == nil && uid == uint32(want)
}

func hmiPeerUID(conn net.Conn) (uint32, bool) {
	sc, ok := conn.(syscall.Conn)
	if !ok {
		return 0, false
	}
	raw, err := sc.SyscallConn()
	if err != nil {
		return 0, false
	}
	var uid uint32
	var controlErr error
	if err := raw.Control(func(fd uintptr) {
		cred, err := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
		if err != nil {
			controlErr = err
			return
		}
		uid = cred.Uid
	}); err != nil || controlErr != nil {
		return 0, false
	}
	return uid, true
}

func (b *HMIBroker) serveConn(ctx context.Context, conn net.Conn, uid uint32) {
	defer conn.Close()
	scanner := bufio.NewScanner(io.LimitReader(conn, 4*hmiMaxFrameBytes))
	scanner.Buffer(make([]byte, 1024), hmiMaxFrameBytes)
	for {
		_ = conn.SetDeadline(time.Now().Add(4 * time.Second))
		if !scanner.Scan() {
			break
		}
		body := b.handleFrame(ctx, append([]byte(nil), scanner.Bytes()...), uid)
		if _, err := conn.Write(append(body, '\n')); err != nil {
			return
		}
	}
	if err := scanner.Err(); err != nil {
		b.logger.Printf("WARN hmi_ipc_frame result=rejected uid=%d reason=frame_too_large", uid)
	}
}

func (b *HMIBroker) handleFrame(ctx context.Context, raw []byte, uid uint32) []byte {
	var req hmiRequest
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if len(raw) == 0 || len(raw) > hmiMaxFrameBytes || decoder.Decode(&req) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return b.encode(hmiResponse{Version: hmiProtocolVersion, Result: "rejected", ReasonCode: "INVALID_REQUEST"})
	}
	base := hmiResponse{Version: hmiProtocolVersion, RequestID: req.RequestID, Result: "rejected"}
	if req.Version != hmiProtocolVersion {
		base.ReasonCode = "UNSUPPORTED_VERSION"
		return b.encode(base)
	}
	if !validHMIRequestID(req.RequestID) || req.Action == "" {
		base.ReasonCode = "INVALID_REQUEST"
		return b.encode(base)
	}
	remote := fmt.Sprintf("hmi:uid:%d", uid)
	if req.Action == "ping" {
		base.Result, base.ReasonCode = "accepted", "OK"
		return b.encode(base)
	}
	if req.Action == "login" {
		if !b.allowLogin(uid) {
			base.ReasonCode = "RATE_LIMITED"
			_ = b.appendAudit(hmiSession{username: req.Username}, req, "result", base)
			return b.encode(base)
		}
		_, role, err := b.auth.Authenticate(req.Username, req.Password, remote)
		if err != nil {
			base.ReasonCode = "INVALID_CREDENTIALS"
			if b.appendAudit(hmiSession{username: req.Username}, req, "result", base) != nil {
				base.ReasonCode = "AUDIT_UNAVAILABLE"
			}
			return b.encode(base)
		}
		token, err := randomHMIToken()
		if err != nil {
			base.ReasonCode = "INTERNAL_ERROR"
			return b.encode(base)
		}
		base.Result, base.ReasonCode, base.Token, base.Role = "accepted", "OK", token, role
		base.ExpiresInS = uint32(hmiSessionIdle / time.Second)
		session := hmiSession{username: req.Username, role: role, lastSeen: b.now()}
		if b.appendAudit(session, req, "result", base) != nil {
			base.Result, base.ReasonCode, base.Token = "rejected", "AUDIT_UNAVAILABLE", ""
			return b.encode(base)
		}
		b.mu.Lock()
		b.sessions[token] = session
		delete(b.loginRate, uid)
		b.mu.Unlock()
		return b.encode(base)
	}

	session, status := b.session(req.Token)
	if status != "OK" {
		base.ReasonCode = status
		_ = b.appendAudit(hmiSession{}, req, "result", base)
		return b.encode(base)
	}
	base.Role = session.role
	if req.Action == "logout" {
		base.Result, base.ReasonCode = "accepted", "OK"
		if b.appendAudit(session, req, "result", base) != nil {
			base.Result, base.ReasonCode = "rejected", "AUDIT_UNAVAILABLE"
			return b.encode(base)
		}
		b.mu.Lock()
		delete(b.sessions, req.Token)
		b.mu.Unlock()
		b.auditHMI(session, req, "session", base, remote)
		return b.encode(base)
	}

	isMutation := req.Action == "setpoint" || req.Action == "mode" || req.Action == "override" ||
		req.Action == "release" || req.Action == "alarm_ack" || req.Action == "network_stage" ||
		req.Action == "network_apply" || req.Action == "network_confirm" || req.Action == "network_rollback"
	if isMutation {
		if cached, conflict := b.cached(req.Token, req.RequestID, raw); cached != nil || conflict {
			if conflict {
				base.ReasonCode = "REQUEST_ID_CONFLICT"
				_ = b.appendAudit(session, req, "result", base)
				return b.encode(base)
			}
			return cached
		}
		if b.appendAudit(session, req, "attempt", hmiResponse{Result: "pending", ReasonCode: "PENDING"}) != nil {
			base.ReasonCode = "AUDIT_UNAVAILABLE"
			b.auditHMI(session, req, mutationTarget(req), base, remote)
			return b.encode(base)
		}
	}

	resp := b.authorizedAction(ctx, req, session, base)
	if isMutation {
		if err := b.appendAudit(session, req, "result", resp); err != nil {
			// The durable attempt record was fsynced before mutation. Once Core has
			// acted, never report a false rejection: preserve the authoritative
			// outcome and raise an operational fault for the missing result record.
			b.logger.Printf("ERROR hmi_audit request_id=%s action=%s reason=result_persist_failed",
				sanitizeAudit(req.RequestID, 64), sanitizeAudit(req.Action, 24))
			resp.Message = "audit result persistence unavailable"
		}
		b.auditHMI(session, req, mutationTarget(req), resp, remote)
	}
	body := b.encode(resp)
	if isMutation {
		b.remember(req.Token, req.RequestID, raw, body)
	}
	return body
}

func (b *HMIBroker) authorizedAction(ctx context.Context, req hmiRequest, session hmiSession, base hmiResponse) hmiResponse {
	user := "hmi:" + session.username
	switch req.Action {
	case "policy":
		base.Result, base.ReasonCode, base.Policy = "accepted", "OK", hmiPolicy(session.role)
		return base
	case "points":
		points, err := b.core.ReadPoints(ctx)
		if err != nil {
			base.ReasonCode = "CORE_UNAVAILABLE"
			return base
		}
		base.Result, base.ReasonCode, base.Points = "accepted", "OK", points
		return base
	case "status":
		status, err := b.core.ReadStatus(ctx)
		if err != nil {
			base.ReasonCode = "CORE_UNAVAILABLE"
			return base
		}
		base.Result, base.ReasonCode, base.CoreStatus = "accepted", "OK", &status
		return base
	case "alarms":
		alarms, err := b.core.ReadAlarms(ctx)
		if err != nil {
			base.ReasonCode = "CORE_UNAVAILABLE"
			return base
		}
		base.Result, base.ReasonCode, base.Alarms = "accepted", "OK", alarms
		return base
	case "query":
		point, err := b.core.QueryPoint(ctx, req.PointID, user)
		if err != nil {
			base.ReasonCode = coreReason(err)
			return base
		}
		base.Result, base.ReasonCode, base.Point = "accepted", "OK", &point
		return base
	case "alarm_ack":
		if !RoleAllows(session.role, RoleOperator) {
			base.ReasonCode = "FORBIDDEN"
			return base
		}
		err := b.core.AckAlarmAs(ctx, req.AlarmID, AlarmActionRequest{}, user)
		base.ReasonCode = coreReason(err)
		if err == nil {
			base.Result = "accepted"
		}
		return base
	case "setpoint", "mode", "override", "release":
		return b.controlAction(ctx, req, session, base)
	case "network_status", "network_validate", "network_stage", "network_apply", "network_confirm", "network_rollback":
		return b.networkAction(ctx, req, session, base)
	default:
		base.ReasonCode = "UNKNOWN_ACTION"
		return base
	}
}

func (b *HMIBroker) networkAction(ctx context.Context, req hmiRequest, session hmiSession, base hmiResponse) hmiResponse {
	if req.Action != "network_status" && session.role != RoleAdmin {
		base.ReasonCode = "FORBIDDEN"
		return base
	}
	if b.netcfg == nil {
		base.ReasonCode = "NETCFG_UNAVAILABLE"
		return base
	}
	action := strings.TrimPrefix(req.Action, "network_")
	response, err := b.netcfg.Request(ctx, req.RequestID, action, req.TransactionID, req.Candidate)
	if err != nil {
		base.ReasonCode = "NETCFG_UNAVAILABLE"
		return base
	}
	base.Result = response.Result
	base.ReasonCode = response.ReasonCode
	base.Message = response.Message
	base.Network = &response
	return base
}

func (b *HMIBroker) controlAction(ctx context.Context, req hmiRequest, session hmiSession, base hmiResponse) hmiResponse {
	if !RoleAllows(session.role, RoleOperator) {
		base.ReasonCode = "FORBIDDEN"
		return base
	}
	policy, ok := policyPoint(req.PointID)
	if !ok || !contains(policy.Actions, req.Action) {
		base.ReasonCode = "POLICY_DENIED"
		return base
	}
	release, ttl := req.Action == "release", uint32(0)
	if req.Action == "mode" {
		switch strings.ToLower(req.Mode) {
		case "auto":
			release = true
		case "manual":
		default:
			base.ReasonCode = "INVALID_MODE"
			return base
		}
	}
	if req.Action == "override" {
		if len(strings.TrimSpace(req.Reason)) < 3 || len(req.Reason) > 80 {
			base.ReasonCode = "REASON_REQUIRED"
			return base
		}
		if req.TTLS < 60 || req.TTLS > policy.MaxTTLS {
			base.ReasonCode = "TTL_OUT_OF_RANGE"
			return base
		}
		ttl = req.TTLS
	}
	if !release {
		if req.Value == nil || *req.Value < policy.Min || *req.Value > policy.Max {
			base.ReasonCode = "VALUE_OUT_OF_RANGE"
			return base
		}
	}
	var value any
	if req.Value != nil {
		value = *req.Value
	}
	point, err := b.core.CommandPoint(ctx, policy.ID, value, release, ttl, "hmi:"+session.username)
	base.ReasonCode = coreReason(err)
	if err == nil {
		base.Result, base.Point = "accepted", &point
		if point.Priority != "" && point.Priority != "manual" && !release {
			base.Result, base.ReasonCode = "overridden", "HIGHER_PRIORITY_ACTIVE"
		}
	}
	return base
}

func hmiPolicy(role Role) []hmiPolicyPoint {
	if !RoleAllows(role, RoleOperator) {
		return []hmiPolicyPoint{}
	}
	points := make([]hmiPolicyPoint, 0, kxNAO+kxNDO)
	for i := 1; i <= kxNAO; i++ {
		points = append(points, hmiPolicyPoint{ID: formatPointID("AO", i), Kind: "analog", Min: 0, Max: 20,
			Actions: []string{"query", "setpoint", "mode", "override", "release"}, MaxTTLS: hmiOverrideMaxS, ReasonNeed: true})
	}
	for i := 1; i <= kxNDO; i++ {
		points = append(points, hmiPolicyPoint{ID: formatPointID("DO", i), Kind: "binary", Min: 0, Max: 1,
			Actions: []string{"query", "mode", "override", "release"}, MaxTTLS: hmiOverrideMaxS, ReasonNeed: true})
	}
	return points
}

func policyPoint(id string) (hmiPolicyPoint, bool) {
	want := canonicalPointID(id)
	for _, point := range hmiPolicy(RoleOperator) {
		if point.ID == want {
			return point, true
		}
	}
	return hmiPolicyPoint{}, false
}

func (b *HMIBroker) session(token string) (hmiSession, string) {
	if token == "" {
		return hmiSession{}, "AUTH_REQUIRED"
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	session, ok := b.sessions[token]
	if !ok {
		return hmiSession{}, "AUTH_REQUIRED"
	}
	now := b.now()
	if now.Sub(session.lastSeen) >= hmiSessionIdle {
		delete(b.sessions, token)
		return hmiSession{}, "SESSION_EXPIRED"
	}
	session.lastSeen = now
	b.sessions[token] = session
	return session, "OK"
}

func (b *HMIBroker) allowLogin(uid uint32) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	window := b.loginRate[uid]
	if window.start.IsZero() || now.Sub(window.start) >= time.Minute {
		window = hmiLoginWindow{start: now}
	}
	window.count++
	b.loginRate[uid] = window
	return window.count <= 5
}

func (b *HMIBroker) cached(token, requestID string, raw []byte) ([]byte, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	entry, ok := b.cache[token+":"+requestID]
	if !ok {
		return nil, false
	}
	if entry.hash != sha256.Sum256(raw) {
		return nil, true
	}
	return append([]byte(nil), entry.body...), false
}

func (b *HMIBroker) remember(token, requestID string, raw, body []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := token + ":" + requestID
	if _, exists := b.cache[key]; !exists {
		if len(b.cacheOrder) >= 128 {
			delete(b.cache, b.cacheOrder[0])
			b.cacheOrder = b.cacheOrder[1:]
		}
		b.cacheOrder = append(b.cacheOrder, key)
	}
	b.cache[key] = hmiCachedResponse{hash: sha256.Sum256(raw), body: append([]byte(nil), body...)}
}

func (b *HMIBroker) auditHMI(session hmiSession, req hmiRequest, target string, resp hmiResponse, remote string) {
	if b.audit != nil {
		b.audit.HMI(session.username, session.role, req.RequestID, req.Action, target, req.Reason, resp.Result, resp.ReasonCode, remote)
	}
	if b.logger != nil {
		b.logger.Printf("INFO hmi_command request_id=%s action=%s result=%s reason_code=%s",
			sanitizeAudit(req.RequestID, 64), sanitizeAudit(req.Action, 24), resp.Result, resp.ReasonCode)
	}
}

func mutationTarget(req hmiRequest) string {
	if req.Action == "alarm_ack" {
		return req.AlarmID
	}
	if strings.HasPrefix(req.Action, "network_") {
		if req.TransactionID != "" {
			return "network:" + req.TransactionID
		}
		if req.Candidate != nil {
			return "network:" + req.Candidate.Interface
		}
		return "network"
	}
	return canonicalPointID(req.PointID)
}

func (b *HMIBroker) appendAudit(session hmiSession, req hmiRequest, phase string, resp hmiResponse) error {
	var effective any
	var source string
	if resp.Point != nil {
		effective = resp.Point.Value
		source = resp.Point.Priority
	}
	return b.auditLog.append(hmiAuditRecord{
		Phase: phase, RequestID: req.RequestID, Actor: session.username, Role: session.role,
		Action: req.Action, Target: mutationTarget(req), Value: req.Value, Effective: effective,
		Source: source, Mode: req.Mode,
		Reason: req.Reason, TTLS: req.TTLS, Result: resp.Result, ReasonCode: resp.ReasonCode,
	})
}

func coreReason(err error) string {
	if err == nil {
		return "OK"
	}
	if errors.Is(err, errCoreUnavailable) || strings.Contains(err.Error(), "core unavailable") {
		return "CORE_UNAVAILABLE"
	}
	return "CORE_REJECTED"
}

func randomHMIToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func validHMIRequestID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func (b *HMIBroker) encode(resp hmiResponse) []byte {
	body, err := json.Marshal(resp)
	if err == nil {
		return body
	}
	return []byte(`{"version":1,"result":"rejected","reasonCode":"INTERNAL_ERROR"}`)
}
