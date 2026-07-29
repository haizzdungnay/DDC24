package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type netcfgAuthorityCall struct {
	action    string
	txID      string
	candidate *NetcfgCandidate
}

type netcfgAuthorityStub struct {
	response         NetcfgResponse
	err              error
	responseByAction map[string]NetcfgResponse
	errByAction      map[string]error
	action           string
	txID             string
	candidate        *NetcfgCandidate
	calls            []netcfgAuthorityCall
}

func (s *netcfgAuthorityStub) Request(_ context.Context, _ string, action, transactionID string, candidate *NetcfgCandidate) (NetcfgResponse, error) {
	s.action = action
	s.txID = transactionID
	s.candidate = candidate
	s.calls = append(s.calls, netcfgAuthorityCall{action: action, txID: transactionID, candidate: candidate})
	if response, ok := s.responseByAction[action]; ok {
		return response, s.errByAction[action]
	}
	if err, ok := s.errByAction[action]; ok {
		return NetcfgResponse{}, err
	}
	return s.response, s.err
}

func TestNetworkTransactionStatusReturnsAuthorityState(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	stub := &netcfgAuthorityStub{response: NetcfgResponse{
		Version: 1, Result: "accepted", ReasonCode: "OK", State: "awaiting_confirmation",
		TransactionID: "tx-7", RollbackRemainingS: 83, Capabilities: []string{"dns", "management-hostname"},
		Active:     &NetcfgActive{Interface: "eth0", Link: "up", AdminUp: true, Carrier: true, ReasonCode: "OK", Mode: "static", IPv4: "10.1.2.3", PrefixLength: 24, Gateway: "10.1.2.1", DNSServers: []string{}},
		Configured: &NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "10.1.2.3", Netmask: "255.255.255.0", Gateway: "10.1.2.1"},
		Management: &NetcfgManagement{Hostname: "mkddc-24", MDNSName: "mkddc-24.local", Stable: true},
	}}
	app.netcfg = stub

	req := newAuthRequest(http.MethodGet, "/api/v1/network/transaction", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var response NetcfgResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if stub.action != "status" || response.RollbackRemainingS != 83 || response.Active == nil || response.Active.IPv4 != "10.1.2.3" ||
		!response.Active.Carrier || response.Active.ReasonCode != "OK" || response.Configured == nil || response.Configured.Mode != "static" {
		t.Fatalf("request action=%q response=%+v", stub.action, response)
	}
}

func TestNetworkTransactionStageForwardsStrictCandidate(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	stub := &netcfgAuthorityStub{response: NetcfgResponse{Version: 1, Result: "accepted", ReasonCode: "OK", State: "staged", TransactionID: "tx-8"}}
	app.netcfg = stub
	body := `{"candidate":{"interface":"eth0","mode":"static","ipv4":"192.168.1.20","netmask":"255.255.255.0","gateway":"192.168.1.1"}}`

	req := newAuthRequest(http.MethodPost, "/api/v1/network/transaction/stage", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK || stub.action != "stage" || stub.candidate == nil || stub.candidate.IPv4 != "192.168.1.20" {
		t.Fatalf("status=%d action=%q candidate=%+v body=%s", w.Code, stub.action, stub.candidate, w.Body.String())
	}
}

func TestValidateNetcfgCandidateMatchesCppAuthorityPolicy(t *testing.T) {
	tests := []struct {
		name      string
		candidate NetcfgCandidate
		path      string
	}{
		{"loopback interface", NetcfgCandidate{Interface: "lo", Mode: "dhcp"}, "candidate.interface"},
		{"dhcp ipv4", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", IPv4: "192.168.1.20"}, "candidate.ipv4"},
		{"dhcp netmask", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", Netmask: "255.255.255.0"}, "candidate.netmask"},
		{"dhcp gateway", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", Gateway: "192.168.1.1"}, "candidate.gateway"},
		{"prefix zero", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "0.0.0.0"}, "candidate.netmask"},
		{"prefix 31", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.254"}, "candidate.netmask"},
		{"prefix 32", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.255"}, "candidate.netmask"},
		{"zero network", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "0.1.2.3", Netmask: "255.0.0.0"}, "candidate.ipv4"},
		{"loopback address", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "127.0.0.2", Netmask: "255.0.0.0"}, "candidate.ipv4"},
		{"multicast address", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "224.0.0.2", Netmask: "255.255.255.0"}, "candidate.ipv4"},
		{"network address", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.0", Netmask: "255.255.255.0"}, "candidate.ipv4"},
		{"broadcast address", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.255", Netmask: "255.255.255.0"}, "candidate.ipv4"},
		{"gateway equals ipv4", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", Gateway: "192.168.1.20"}, "candidate.gateway"},
		{"off-subnet gateway", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", Gateway: "192.168.2.1"}, "candidate.gateway"},
		{"network gateway", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", Gateway: "192.168.1.0"}, "candidate.gateway"},
		{"broadcast gateway", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", Gateway: "192.168.1.255"}, "candidate.gateway"},
		{"static auto dns", NetcfgCandidate{Interface: "eth0", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", DNS: &NetcfgDNS{Mode: "auto"}}, "candidate.dns.mode"},
		{"auto dns servers", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "auto", Servers: []string{"192.168.1.1"}}}, "candidate.dns.servers"},
		{"manual dns empty", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual"}}, "candidate.dns.servers"},
		{"manual dns too many", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"1.1.1.1", "8.8.8.8", "9.9.9.9", "208.67.222.222", "208.67.220.220"}}}, "candidate.dns.servers"},
		{"manual dns noncanonical", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"192.168.001.1"}}}, "candidate.dns.servers[0]"},
		{"manual dns duplicate", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"1.1.1.1", "1.1.1.1"}}}, "candidate.dns.servers[1]"},
		{"manual dns ipv6", NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"2001:4860:4860::8888"}}}, "candidate.dns.servers[0]"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			errs := validateNetcfgCandidate(test.candidate)
			if !hasConfigErrorPath(errs, test.path) {
				t.Fatalf("validateNetcfgCandidate() errors = %+v; want path %q", errs, test.path)
			}
		})
	}
}

func TestValidateNetcfgCandidateAcceptsAuthorityValidCandidates(t *testing.T) {
	tests := []NetcfgCandidate{
		{Interface: "eth0", Mode: "dhcp"},
		{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "auto", Servers: []string{}}},
		{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"1.1.1.1", "8.8.8.8"}}},
		{Interface: "end1", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", Gateway: "192.168.1.1"},
		{Interface: "end1", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", Gateway: "192.168.1.1", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"192.168.1.2"}}},
	}
	for _, candidate := range tests {
		if errs := validateNetcfgCandidate(candidate); len(errs) != 0 {
			t.Fatalf("validateNetcfgCandidate(%+v) errors = %+v; want none", candidate, errs)
		}
	}
}

func TestNetworkTransactionRejectsInvalidActionShape(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	stub := &netcfgAuthorityStub{}
	app.netcfg = stub
	var audit bytes.Buffer
	app.audit = NewAuditLogger(log.New(&audit, "", 0))
	tests := []struct {
		path string
		body string
	}{
		{"/api/v1/network/transaction/stage", `{}`},
		{"/api/v1/network/transaction/apply", `{"transactionId":"bad id"}`},
		{"/api/v1/network/transaction/confirm", `{"transactionId":"tx-1","extra":true}`},
		{"/api/v1/network/transaction/delete", `{}`},
	}
	for _, test := range tests {
		audit.Reset()
		req := newAuthRequest(http.MethodPost, test.path, test.body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest && w.Code != http.StatusNotFound {
			t.Errorf("%s status=%d body=%s", test.path, w.Code, w.Body.String())
		}
		if strings.Count(audit.String(), "AUDIT change") != 1 {
			t.Errorf("%s audit=%q; want exactly one change event", test.path, audit.String())
		}
	}
	if stub.action != "" {
		t.Fatalf("authority called for invalid request: %q", stub.action)
	}
}

func TestNetworkTransactionRejectsMalformedDNSJSONAndAuditsOnce(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	stub := &netcfgAuthorityStub{}
	app.netcfg = stub
	var audit bytes.Buffer
	app.audit = NewAuditLogger(log.New(&audit, "", 0))
	bodies := []string{
		`{"candidate":{"interface":"eth0","mode":"dhcp","dns":null}}`,
		`{"candidate":{"interface":"eth0","mode":"dhcp","dns":{"mode":"auto"}}}`,
		`{"candidate":{"interface":"eth0","mode":"dhcp","dns":{"mode":"auto","servers":null}}}`,
		`{"candidate":{"interface":"eth0","mode":"dhcp","dns":{"mode":"manual","servers":"1.1.1.1"}}}`,
		`{"candidate":{"interface":"eth0","mode":"dhcp","dns":{"mode":"auto","servers":[],"extra":true}}}`,
	}
	for _, body := range bodies {
		audit.Reset()
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, newAuthRequest(http.MethodPost, "/api/v1/network/transaction/stage", body, token))
		if w.Code != http.StatusBadRequest {
			t.Errorf("body=%s status=%d response=%s", body, w.Code, w.Body.String())
		}
		if strings.Count(audit.String(), "AUDIT change") != 1 {
			t.Errorf("body=%s audit=%q; want exactly one change event", body, audit.String())
		}
	}
	if len(stub.calls) != 0 {
		t.Fatalf("authority called for malformed DNS: %+v", stub.calls)
	}
}

func TestNetworkTransactionUnavailableReturns503(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.netcfg = &netcfgAuthorityStub{err: errors.Join(errNetcfgUnavailable, errors.New("socket missing"))}
	req := newAuthRequest(http.MethodGet, "/api/v1/network/transaction", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestNetworkTransactionViewerCanReadButCannotMutate(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleViewer, nil)
	stub := &netcfgAuthorityStub{response: NetcfgResponse{Version: 1, Result: "accepted", ReasonCode: "OK", State: "idle"}}
	app.netcfg = stub
	read := httptest.NewRecorder()
	app.Router().ServeHTTP(read, newAuthRequest(http.MethodGet, "/api/v1/network/transaction", "", token))
	if read.Code != http.StatusOK || stub.action != "status" {
		t.Fatalf("GET status=%d action=%q body=%s", read.Code, stub.action, read.Body.String())
	}
	stub.action = ""
	stub.calls = nil
	write := httptest.NewRecorder()
	app.Router().ServeHTTP(write, newAuthRequest(http.MethodPost, "/api/v1/network/transaction/stage", `{"candidate":{"interface":"eth0","mode":"dhcp"}}`, token))
	if write.Code != http.StatusForbidden {
		t.Fatalf("POST status=%d body=%s", write.Code, write.Body.String())
	}
	if stub.action != "" || len(stub.calls) != 0 {
		t.Fatalf("authority called for forbidden request: %q", stub.action)
	}
}

func TestNetworkTransactionDNSRequiresCapabilityBeforeForwarding(t *testing.T) {
	body := `{"candidate":{"interface":"eth0","mode":"dhcp","dns":{"mode":"manual","servers":["1.1.1.1"]}}}`
	tests := []struct {
		name         string
		capabilities []string
		wantStatus   int
		wantCalls    []string
	}{
		{"supported", []string{"dns"}, http.StatusOK, []string{"status", "stage"}},
		{"legacy helper", nil, http.StatusServiceUnavailable, []string{"status"}},
		{"unrelated capability", []string{"hostname"}, http.StatusServiceUnavailable, []string{"status"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			app, token := newTestAppWithAdmin(t)
			pending := &NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"1.1.1.1"}}}
			stub := &netcfgAuthorityStub{responseByAction: map[string]NetcfgResponse{
				"status": {Version: 1, Result: "accepted", ReasonCode: "OK", State: "idle", Capabilities: test.capabilities},
				"stage": {
					Version: 1, Result: "accepted", ReasonCode: "OK", State: "staged", TransactionID: "tx-dns",
					Capabilities: []string{"dns", "management-hostname"}, Pending: pending,
				},
			}}
			app.netcfg = stub
			w := httptest.NewRecorder()
			app.Router().ServeHTTP(w, newAuthRequest(http.MethodPost, "/api/v1/network/transaction/stage", body, token))
			if w.Code != test.wantStatus {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if len(stub.calls) != len(test.wantCalls) {
				t.Fatalf("calls=%+v want=%v", stub.calls, test.wantCalls)
			}
			for i, action := range test.wantCalls {
				if stub.calls[i].action != action {
					t.Fatalf("calls[%d]=%q want=%q", i, stub.calls[i].action, action)
				}
			}
		})
	}
}

func TestNetworkTransactionDNSMutationFailsClosedOnMixedAuthorityResponse(t *testing.T) {
	candidate := &NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"1.1.1.1"}}}
	validStage := NetcfgResponse{
		Version: 1, Result: "accepted", ReasonCode: "OK", State: "staged", TransactionID: "tx-dns",
		Capabilities: []string{"dns", "management-hostname"}, Pending: candidate,
	}
	tests := []struct {
		name       string
		action     string
		response   NetcfgResponse
		wantStatus int
	}{
		{"validate missing dns capability", "validate", NetcfgResponse{Version: 1, Result: "accepted", ReasonCode: "OK", State: "idle"}, http.StatusBadGateway},
		{"validate keeps dns capability", "validate", NetcfgResponse{Version: 1, Result: "accepted", ReasonCode: "OK", State: "idle", Capabilities: []string{"dns", "management-hostname"}}, http.StatusOK},
		{"stage missing dns capability", "stage", NetcfgResponse{Version: 1, Result: "accepted", ReasonCode: "OK", State: "staged", TransactionID: "tx-dns", Pending: candidate}, http.StatusBadGateway},
		{"stage invalid state", "stage", func() NetcfgResponse { response := validStage; response.State = "idle"; return response }(), http.StatusBadGateway},
		{"stage missing transaction id", "stage", func() NetcfgResponse { response := validStage; response.TransactionID = ""; return response }(), http.StatusBadGateway},
		{"stage missing pending", "stage", func() NetcfgResponse { response := validStage; response.Pending = nil; return response }(), http.StatusBadGateway},
		{"stage mismatched pending dns", "stage", func() NetcfgResponse {
			response := validStage
			response.Pending = &NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"8.8.8.8"}}}
			return response
		}(), http.StatusBadGateway},
		{"stage valid echo", "stage", validStage, http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			app, token := newTestAppWithAdmin(t)
			stub := &netcfgAuthorityStub{responseByAction: map[string]NetcfgResponse{
				"status":    {Version: 1, Result: "accepted", ReasonCode: "OK", State: "idle", Capabilities: []string{"dns", "management-hostname"}},
				test.action: test.response,
			}}
			app.netcfg = stub
			var audit bytes.Buffer
			app.audit = NewAuditLogger(log.New(&audit, "", 0))
			body := `{"candidate":{"interface":"eth0","mode":"dhcp","dns":{"mode":"manual","servers":["1.1.1.1"]}}}`
			w := httptest.NewRecorder()
			app.Router().ServeHTTP(w, newAuthRequest(http.MethodPost, "/api/v1/network/transaction/"+test.action, body, token))
			if w.Code != test.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", w.Code, test.wantStatus, w.Body.String())
			}
			logs := audit.String()
			if strings.Count(logs, "AUDIT change") != 1 {
				t.Fatalf("audit=%q; want exactly one change event", logs)
			}
			if test.wantStatus == http.StatusBadGateway && !strings.Contains(logs, "result=error") {
				t.Fatalf("audit=%q; want result=error", logs)
			}
		})
	}
}

func TestNetworkTransactionAuditSkipsStatusAndRecordsDNSMutationOnce(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	stub := &netcfgAuthorityStub{responseByAction: map[string]NetcfgResponse{
		"status": {Version: 1, Result: "accepted", ReasonCode: "OK", State: "idle", Capabilities: []string{"dns"}},
		"stage": {
			Version: 1, Result: "accepted", ReasonCode: "OK", State: "staged", TransactionID: "tx-audit",
			Capabilities: []string{"dns", "management-hostname"},
			Pending:      &NetcfgCandidate{Interface: "eth0", Mode: "dhcp", DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"10.22.33.44"}}},
		},
	}}
	app.netcfg = stub
	var audit bytes.Buffer
	app.audit = NewAuditLogger(log.New(&audit, "", 0))

	status := httptest.NewRecorder()
	app.Router().ServeHTTP(status, newAuthRequest(http.MethodGet, "/api/v1/network/transaction", "", token))
	if status.Code != http.StatusOK || strings.Contains(audit.String(), "AUDIT change") {
		t.Fatalf("status=%d audit=%q", status.Code, audit.String())
	}

	audit.Reset()
	body := `{"candidate":{"interface":"eth0","mode":"dhcp","dns":{"mode":"manual","servers":["10.22.33.44"]}}}`
	mutation := httptest.NewRecorder()
	app.Router().ServeHTTP(mutation, newAuthRequest(http.MethodPost, "/api/v1/network/transaction/stage", body, token))
	logs := audit.String()
	if mutation.Code != http.StatusOK || strings.Count(logs, "AUDIT change") != 1 {
		t.Fatalf("status=%d audit=%q", mutation.Code, logs)
	}
	if strings.Contains(logs, "10.22.33.44") || strings.Contains(logs, token) {
		t.Fatalf("audit leaked candidate DNS or token: %q", logs)
	}
}
