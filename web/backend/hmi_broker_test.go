package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type fakeHMICore struct {
	commands     int
	acks         int
	lastID       string
	lastTTL      uint32
	lastUser     string
	release      bool
	priority     string
	afterCommand func()
}

type fakeNetcfgAuthority struct {
	calls         int
	lastAction    string
	lastTx        string
	lastCandidate *NetcfgCandidate
	response      NetcfgResponse
	err           error
}

func requireLinuxHMIIPC(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("HMI IPC integration requires Linux AF_UNIX peer credentials")
	}
}

func (f *fakeNetcfgAuthority) Request(_ context.Context, _ string, action string, transactionID string, candidate *NetcfgCandidate) (NetcfgResponse, error) {
	f.calls++
	f.lastAction, f.lastTx, f.lastCandidate = action, transactionID, candidate
	return f.response, f.err
}

func (f *fakeHMICore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true, IobusPresent: true, IOP: IOPStatus{Status: "normal"}}, nil
}

func (f *fakeHMICore) ReadPoints(context.Context) ([]PointDTO, error) {
	return []PointDTO{{ID: "AO-01", Value: 4.2, Quality: "good"}}, nil
}

func (f *fakeHMICore) CommandPoint(_ context.Context, id string, _ any, release bool, ttl uint32, user string) (PointDTO, error) {
	f.commands++
	f.lastID, f.lastTTL, f.lastUser, f.release = id, ttl, user, release
	if f.afterCommand != nil {
		f.afterCommand()
	}
	priority := f.priority
	if priority == "" {
		priority = "manual"
	}
	return PointDTO{ID: id, Value: 7.5, Quality: "good", Priority: priority}, nil
}

func (f *fakeHMICore) QueryPoint(_ context.Context, id, _ string) (PointDTO, error) {
	return PointDTO{ID: id, Value: 7.5, Quality: "good", Priority: "manual"}, nil
}

func (f *fakeHMICore) ReadAlarms(context.Context) ([]AlarmDTO, error) {
	return []AlarmDTO{{ID: "ALM-1", Status: "active", Severity: "high"}}, nil
}

func (f *fakeHMICore) AckAlarmAs(context.Context, string, AlarmActionRequest, string) error {
	f.acks++
	return nil
}

func newTestHMIBroker(t *testing.T, role Role, core hmiCore, output *bytes.Buffer) *HMIBroker {
	t.Helper()
	users := writeTestUsers(t, "admin123", role)
	cfg := testConfig(t, users)
	cfg.HMISock = filepath.Join(t.TempDir(), "hmi.sock")
	cfg.HMIAuditPath = filepath.Join(t.TempDir(), "hmi-audit.jsonl")
	auditLogger := log.New(output, "", 0)
	auth, err := NewAuthService(cfg, NewAuditLogger(auditLogger))
	if err != nil {
		t.Fatal(err)
	}
	return NewHMIBroker(cfg, auth, core, auditLogger, NewAuditLogger(auditLogger))
}

func callHMI(t *testing.T, broker *HMIBroker, req map[string]any) hmiResponse {
	t.Helper()
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var resp hmiResponse
	if err := json.Unmarshal(broker.handleFrame(context.Background(), raw, uint32(os.Getuid())), &resp); err != nil {
		t.Fatal(err)
	}
	return resp
}

func loginHMI(t *testing.T, broker *HMIBroker, requestID string) hmiResponse {
	t.Helper()
	return callHMI(t, broker, map[string]any{
		"version": 1, "requestId": requestID, "action": "login",
		"username": "admin", "password": "admin123",
	})
}

func TestHMIBrokerNetworkChangeRequiresAdminAndForwardsTransaction(t *testing.T) {
	broker := newTestHMIBroker(t, RoleAdmin, &fakeHMICore{}, &bytes.Buffer{})
	fake := &fakeNetcfgAuthority{response: NetcfgResponse{
		Version: 1, RequestID: "net-stage", Result: "accepted", ReasonCode: "OK",
		State: "staged", TransactionID: "tx-1",
	}}
	broker.netcfg = fake
	login := loginHMI(t, broker, "login-net")
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "net-stage", "action": "network_stage", "token": login.Token,
		"candidate": map[string]any{"interface": "eth0", "mode": "static", "ipv4": "192.168.10.20", "netmask": "255.255.255.0", "gateway": "192.168.10.1"},
	})
	if resp.Result != "accepted" || resp.Network == nil || resp.Network.TransactionID != "tx-1" {
		t.Fatalf("response = %+v", resp)
	}
	if fake.calls != 1 || fake.lastAction != "stage" || fake.lastCandidate == nil || fake.lastCandidate.Interface != "eth0" {
		t.Fatalf("forwarded call = %+v", fake)
	}
}

func TestHMIBrokerNetworkMutationRejectsOperator(t *testing.T) {
	broker := newTestHMIBroker(t, RoleOperator, &fakeHMICore{}, &bytes.Buffer{})
	fake := &fakeNetcfgAuthority{}
	broker.netcfg = fake
	login := loginHMI(t, broker, "login-net-operator")
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "net-apply", "action": "network_apply", "token": login.Token,
		"transactionId": "tx-1",
	})
	if resp.ReasonCode != "FORBIDDEN" || fake.calls != 0 {
		t.Fatalf("response=%+v calls=%d", resp, fake.calls)
	}
}

func callHMIOverSocket(t *testing.T, path string, req map[string]any) hmiResponse {
	t.Helper()
	conn, err := net.DialTimeout("unix", path, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := json.NewEncoder(conn).Encode(req); err != nil {
		t.Fatal(err)
	}
	var resp hmiResponse
	if err := json.NewDecoder(conn).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	return resp
}

func startTestHMIBroker(t *testing.T, broker *HMIBroker) (context.CancelFunc, <-chan error) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- broker.Serve(ctx) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(broker.cfg.HMISock); err == nil {
			return cancel, done
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("broker socket was not created")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func stopTestHMIBroker(t *testing.T, cancel context.CancelFunc, done <-chan error) {
	t.Helper()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("broker did not stop")
	}
}

type hmiCoreSocketStub struct {
	listener net.Listener
	requests chan map[string]any
	done     chan struct{}
}

func startFakeCoreSocket(t *testing.T, path string) *hmiCoreSocketStub {
	t.Helper()
	_ = os.Remove(path)
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	server := &hmiCoreSocketStub{
		listener: listener,
		requests: make(chan map[string]any, 16),
		done:     make(chan struct{}),
	}
	go func() {
		defer close(server.done)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			var req map[string]any
			if json.NewDecoder(conn).Decode(&req) == nil {
				server.requests <- req
				value, source := 7.5, "manual"
				if req["op"] == "release" {
					value, source = 0, "default"
				}
				resp := map[string]any{
					"id": req["id"], "result": "accepted", "applied_value": value,
					"active_source": source,
				}
				if req["ttlS"] != nil {
					resp["remaining_ttl_s"] = req["ttlS"]
				}
				_ = json.NewEncoder(conn).Encode(resp)
			}
			_ = conn.Close()
		}
	}()
	return server
}

func (s *hmiCoreSocketStub) stop(t *testing.T) {
	t.Helper()
	if s == nil || s.listener == nil {
		return
	}
	_ = s.listener.Close()
	select {
	case <-s.done:
	case <-time.After(2 * time.Second):
		t.Fatal("fake core socket did not stop")
	}
}

func newSocketIntegratedHMIBroker(t *testing.T, role Role, coreSock string, output *bytes.Buffer) *HMIBroker {
	t.Helper()
	users := writeTestUsers(t, "admin123", role)
	cfg := testConfig(t, users)
	cfg.CoreSock = coreSock
	cfg.HMISock = filepath.Join(t.TempDir(), "hmi.sock")
	cfg.HMIAuditPath = filepath.Join(t.TempDir(), "hmi-audit.jsonl")
	auditLogger := log.New(output, "", 0)
	auth, err := NewAuthService(cfg, NewAuditLogger(auditLogger))
	if err != nil {
		t.Fatal(err)
	}
	return NewHMIBroker(cfg, auth, NewCoreClient(cfg), auditLogger, NewAuditLogger(auditLogger))
}

func TestHMIBrokerSessionExpiresAfterIdleLimit(t *testing.T) {
	broker := newTestHMIBroker(t, RoleOperator, &fakeHMICore{}, &bytes.Buffer{})
	now := time.Unix(1000, 0)
	broker.now = func() time.Time { return now }
	login := loginHMI(t, broker, "login-1")
	if login.Result != "accepted" || login.Token == "" || login.ExpiresInS != 900 {
		t.Fatalf("login = %+v", login)
	}
	now = now.Add(hmiSessionIdle)
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "policy-1", "action": "policy", "token": login.Token,
	})
	if resp.ReasonCode != "SESSION_EXPIRED" {
		t.Fatalf("response = %+v", resp)
	}
}

func TestHMIBrokerViewerCannotMutate(t *testing.T) {
	core := &fakeHMICore{}
	broker := newTestHMIBroker(t, RoleViewer, core, &bytes.Buffer{})
	login := loginHMI(t, broker, "login-viewer")
	value := 1.0
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "cmd-1", "action": "override", "token": login.Token,
		"pointId": "DO-01", "value": value, "ttlS": 300, "reason": "service test",
	})
	if resp.ReasonCode != "FORBIDDEN" || core.commands != 0 {
		t.Fatalf("response/core calls = %+v/%d", resp, core.commands)
	}
}

func TestHMIBrokerDoesNotProjectWebEngineerIntoLocalOperator(t *testing.T) {
	core := &fakeHMICore{}
	broker := newTestHMIBroker(t, RoleEngineer, core, &bytes.Buffer{})
	login := loginHMI(t, broker, "login-engineer")
	if login.Result != "accepted" || login.Token == "" {
		t.Fatalf("login = %+v", login)
	}
	value := 1.0
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "engineer-override", "action": "override",
		"token": login.Token, "pointId": "DO-01", "value": value,
		"reason": "web role isolation", "ttlS": 60,
	})
	if resp.ReasonCode != "FORBIDDEN" {
		t.Fatalf("response = %+v", resp)
	}
	if core.commands != 0 {
		t.Fatalf("Web Engineer reached local-HMI control path: %d calls", core.commands)
	}
}

func TestHMIBrokerOverrideIsBoundedAuditedAndIdempotent(t *testing.T) {
	var logs bytes.Buffer
	core := &fakeHMICore{}
	broker := newTestHMIBroker(t, RoleOperator, core, &logs)
	login := loginHMI(t, broker, "login-op")
	req := map[string]any{
		"version": 1, "requestId": "override-1", "action": "override", "token": login.Token,
		"pointId": "AO-01", "value": 7.5, "ttlS": 300, "reason": "temporary checkout",
	}
	first := callHMI(t, broker, req)
	second := callHMI(t, broker, req)
	if first.Result != "accepted" || second.Result != "accepted" || core.commands != 1 {
		t.Fatalf("responses/calls = %+v / %+v / %d", first, second, core.commands)
	}
	if core.lastTTL != 300 || core.lastID != "AO-01" || core.lastUser != "hmi:admin" {
		t.Fatalf("core command = id:%s ttl:%d user:%s", core.lastID, core.lastTTL, core.lastUser)
	}
	req["value"] = 8.0
	conflict := callHMI(t, broker, req)
	if conflict.ReasonCode != "REQUEST_ID_CONFLICT" || core.commands != 1 {
		t.Fatalf("conflict/calls = %+v/%d", conflict, core.commands)
	}
	logText := logs.String()
	if !strings.Contains(logText, "request_id=override-1") || strings.Contains(logText, login.Token) || strings.Contains(logText, "admin123") {
		t.Fatalf("unsafe or incomplete logs: %s", logText)
	}
	auditData, err := os.ReadFile(broker.cfg.HMIAuditPath)
	if err != nil || !bytes.Contains(auditData, []byte(`"requestId":"override-1"`)) ||
		bytes.Contains(auditData, []byte(login.Token)) || bytes.Contains(auditData, []byte("admin123")) {
		t.Fatalf("unsafe or incomplete durable audit: %s / %v", auditData, err)
	}
}

func TestHMIBrokerRejectsMissingReasonAndLongTTL(t *testing.T) {
	core := &fakeHMICore{}
	broker := newTestHMIBroker(t, RoleOperator, core, &bytes.Buffer{})
	login := loginHMI(t, broker, "login-policy")
	base := map[string]any{
		"version": 1, "requestId": "override-policy", "action": "override", "token": login.Token,
		"pointId": "DO-01", "value": 1, "ttlS": 300,
	}
	if got := callHMI(t, broker, base); got.ReasonCode != "REASON_REQUIRED" {
		t.Fatalf("missing reason = %+v", got)
	}
	base["requestId"], base["reason"], base["ttlS"] = "override-policy-2", "maintenance", 3601
	if got := callHMI(t, broker, base); got.ReasonCode != "TTL_OUT_OF_RANGE" {
		t.Fatalf("long ttl = %+v", got)
	}
	if core.commands != 0 {
		t.Fatalf("invalid policy reached core %d times", core.commands)
	}
}

func TestHMIBrokerAuditFailurePreventsCoreMutation(t *testing.T) {
	core := &fakeHMICore{}
	broker := newTestHMIBroker(t, RoleOperator, core, &bytes.Buffer{})
	login := loginHMI(t, broker, "login-audit")
	broker.auditLog.path = t.TempDir()
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "override-audit", "action": "override", "token": login.Token,
		"pointId": "DO-01", "value": 1, "ttlS": 300, "reason": "maintenance",
	})
	if resp.ReasonCode != "AUDIT_UNAVAILABLE" || core.commands != 0 {
		t.Fatalf("response/core calls = %+v/%d", resp, core.commands)
	}
}

func TestHMIBrokerPreservesAppliedResultWhenResultAuditFails(t *testing.T) {
	var logs bytes.Buffer
	core := &fakeHMICore{}
	broker := newTestHMIBroker(t, RoleOperator, core, &logs)
	login := loginHMI(t, broker, "login-audit-result")
	core.afterCommand = func() {
		if err := os.Truncate(broker.cfg.HMIAuditPath, hmiAuditMaxBytes); err != nil {
			t.Fatalf("fill audit: %v", err)
		}
	}
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "override-audit-result", "action": "override", "token": login.Token,
		"pointId": "DO-01", "value": 1, "ttlS": 300, "reason": "maintenance",
	})
	if resp.Result != "accepted" || resp.ReasonCode != "OK" || core.commands != 1 {
		t.Fatalf("response/core calls = %+v/%d", resp, core.commands)
	}
	if !strings.Contains(resp.Message, "audit result persistence unavailable") ||
		!strings.Contains(logs.String(), "result_persist_failed") {
		t.Fatalf("missing audit failure disclosure: %+v / %s", resp, logs.String())
	}
}

func TestHMIBrokerReportsHigherPriorityOverride(t *testing.T) {
	core := &fakeHMICore{priority: "safety"}
	broker := newTestHMIBroker(t, RoleOperator, core, &bytes.Buffer{})
	login := loginHMI(t, broker, "login-priority")
	resp := callHMI(t, broker, map[string]any{
		"version": 1, "requestId": "mode-1", "action": "mode", "token": login.Token,
		"pointId": "DO-01", "mode": "manual", "value": 1,
	})
	if resp.Result != "overridden" || resp.ReasonCode != "HIGHER_PRIORITY_ACTIVE" {
		t.Fatalf("response = %+v", resp)
	}
}

func TestHMIBrokerProtocolRejectsUnknownField(t *testing.T) {
	broker := newTestHMIBroker(t, RoleOperator, &fakeHMICore{}, &bytes.Buffer{})
	resp := broker.handleFrame(context.Background(), []byte(`{"version":1,"requestId":"x","action":"ping","passwordLeak":"x"}`), uint32(os.Getuid()))
	if !strings.Contains(string(resp), "INVALID_REQUEST") {
		t.Fatalf("response = %s", resp)
	}
}

func TestHMIPeerCredentialsComeFromKernel(t *testing.T) {
	requireLinuxHMIIPC(t)
	path := filepath.Join(t.TempDir(), "peer.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := net.Dial("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	uid, ok := hmiPeerUID(server)
	if !ok || uid != uint32(os.Getuid()) {
		t.Fatalf("peer uid = %d/%v, want %d", uid, ok, os.Getuid())
	}
}

func TestHMIBrokerRejectsOversizedFrame(t *testing.T) {
	broker := newTestHMIBroker(t, RoleOperator, &fakeHMICore{}, &bytes.Buffer{})
	resp := broker.handleFrame(context.Background(), bytes.Repeat([]byte{'x'}, hmiMaxFrameBytes+1), uint32(os.Getuid()))
	if !strings.Contains(string(resp), "INVALID_REQUEST") {
		t.Fatalf("response = %s", resp)
	}
}

func TestHMIBrokerSocketRunsLoginControlQueryReleaseLifecycle(t *testing.T) {
	requireLinuxHMIIPC(t)
	corePath := filepath.Join(t.TempDir(), "core.sock")
	core := startFakeCoreSocket(t, corePath)
	defer core.stop(t)
	broker := newSocketIntegratedHMIBroker(t, RoleOperator, corePath, &bytes.Buffer{})
	cancel, done := startTestHMIBroker(t, broker)
	defer stopTestHMIBroker(t, cancel, done)

	login := callHMIOverSocket(t, broker.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "socket-login", "action": "login",
		"username": "admin", "password": "admin123",
	})
	if login.Result != "accepted" || login.Token == "" {
		t.Fatalf("login = %+v", login)
	}
	policy := callHMIOverSocket(t, broker.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "socket-policy", "action": "policy", "token": login.Token,
	})
	if policy.Result != "accepted" || len(policy.Policy) != kxNAO+kxNDO {
		t.Fatalf("policy = %+v", policy)
	}
	override := callHMIOverSocket(t, broker.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "socket-override", "action": "override", "token": login.Token,
		"pointId": "AO-01", "value": 7.5, "ttlS": 300, "reason": "commissioning",
	})
	if override.Result != "accepted" || override.Point == nil {
		t.Fatalf("override = %+v", override)
	}
	query := callHMIOverSocket(t, broker.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "socket-query", "action": "query", "token": login.Token,
		"pointId": "AO-01",
	})
	if query.Result != "accepted" || query.Point == nil || query.Point.Priority != "manual" {
		t.Fatalf("query = %+v", query)
	}
	release := callHMIOverSocket(t, broker.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "socket-release", "action": "release", "token": login.Token,
		"pointId": "AO-01",
	})
	if release.Result != "accepted" {
		t.Fatalf("release = %+v", release)
	}
	ops := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		select {
		case req := <-core.requests:
			ops = append(ops, req["op"].(string))
		case <-time.After(time.Second):
			t.Fatal("missing Core IPC request")
		}
	}
	if strings.Join(ops, ",") != "write,query,release" {
		t.Fatalf("Core IPC operations = %v", ops)
	}
}

func TestHMIBrokerCoreLossDoesNotReplayRejectedCommand(t *testing.T) {
	requireLinuxHMIIPC(t)
	corePath := filepath.Join(t.TempDir(), "core.sock")
	core := startFakeCoreSocket(t, corePath)
	broker := newSocketIntegratedHMIBroker(t, RoleOperator, corePath, &bytes.Buffer{})
	cancel, done := startTestHMIBroker(t, broker)
	defer stopTestHMIBroker(t, cancel, done)
	login := callHMIOverSocket(t, broker.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "loss-login", "action": "login",
		"username": "admin", "password": "admin123",
	})
	req := map[string]any{
		"version": 1, "requestId": "loss-command", "action": "override", "token": login.Token,
		"pointId": "DO-01", "value": 1, "ttlS": 300, "reason": "process loss test",
	}
	core.stop(t)
	failed := callHMIOverSocket(t, broker.cfg.HMISock, req)
	recoveredCore := startFakeCoreSocket(t, corePath)
	defer recoveredCore.stop(t)
	cached := callHMIOverSocket(t, broker.cfg.HMISock, req)
	if failed.ReasonCode != "CORE_UNAVAILABLE" || cached.ReasonCode != "CORE_UNAVAILABLE" || len(recoveredCore.requests) != 0 {
		t.Fatalf("failed/cached/core = %+v / %+v / queued=%d", failed, cached, len(recoveredCore.requests))
	}
	req["requestId"] = "loss-command-explicit-retry"
	retried := callHMIOverSocket(t, broker.cfg.HMISock, req)
	if retried.Result != "accepted" {
		t.Fatalf("explicit retry = %+v", retried)
	}
	select {
	case applied := <-recoveredCore.requests:
		if applied["op"] != "write" {
			t.Fatalf("explicit retry op = %v", applied["op"])
		}
	case <-time.After(time.Second):
		t.Fatal("explicit retry did not reach recovered Core IPC")
	}
}

func TestHMIBrokerRestartInvalidatesSession(t *testing.T) {
	requireLinuxHMIIPC(t)
	core := &fakeHMICore{}
	first := newTestHMIBroker(t, RoleOperator, core, &bytes.Buffer{})
	cancel, done := startTestHMIBroker(t, first)
	login := callHMIOverSocket(t, first.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "restart-login", "action": "login",
		"username": "admin", "password": "admin123",
	})
	stopTestHMIBroker(t, cancel, done)

	second := NewHMIBroker(first.cfg, first.auth, core, first.logger, first.audit)
	cancel2, done2 := startTestHMIBroker(t, second)
	defer stopTestHMIBroker(t, cancel2, done2)
	resp := callHMIOverSocket(t, second.cfg.HMISock, map[string]any{
		"version": 1, "requestId": "restart-old-token", "action": "query",
		"token": login.Token, "pointId": "AO-01",
	})
	if resp.ReasonCode != "AUTH_REQUIRED" {
		t.Fatalf("response = %+v", resp)
	}
}

func TestHMIBrokerServesVersionedFrameOverUnixSocket(t *testing.T) {
	requireLinuxHMIIPC(t)
	broker := newTestHMIBroker(t, RoleOperator, &fakeHMICore{}, &bytes.Buffer{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- broker.Serve(ctx) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(broker.cfg.HMISock); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("broker socket was not created")
		}
		time.Sleep(5 * time.Millisecond)
	}
	conn, err := net.Dial("unix", broker.cfg.HMISock)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte(`{"version":1,"requestId":"ping-1","action":"ping"}` + "\n")); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	_ = conn.Close()
	if err != nil || !strings.Contains(string(line), `"reasonCode":"OK"`) {
		t.Fatalf("response = %s / %v", line, err)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("broker did not stop")
	}
}
