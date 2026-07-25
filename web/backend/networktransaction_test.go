package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type netcfgAuthorityStub struct {
	response  NetcfgResponse
	err       error
	action    string
	txID      string
	candidate *NetcfgCandidate
}

func (s *netcfgAuthorityStub) Request(_ context.Context, _ string, action, transactionID string, candidate *NetcfgCandidate) (NetcfgResponse, error) {
	s.action = action
	s.txID = transactionID
	s.candidate = candidate
	return s.response, s.err
}

func TestNetworkTransactionStatusReturnsAuthorityState(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	stub := &netcfgAuthorityStub{response: NetcfgResponse{
		Version: 1, Result: "accepted", ReasonCode: "OK", State: "awaiting_confirmation",
		TransactionID: "tx-7", RollbackRemainingS: 83,
		Active: &NetcfgActive{Interface: "eth0", Link: "up", Mode: "static", IPv4: "10.1.2.3", PrefixLength: 24, Gateway: "10.1.2.1"},
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
	if stub.action != "status" || response.RollbackRemainingS != 83 || response.Active == nil || response.Active.IPv4 != "10.1.2.3" {
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
		{Interface: "end1", Mode: "static", IPv4: "192.168.1.20", Netmask: "255.255.255.0", Gateway: "192.168.1.1"},
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
		req := newAuthRequest(http.MethodPost, test.path, test.body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest && w.Code != http.StatusNotFound {
			t.Errorf("%s status=%d body=%s", test.path, w.Code, w.Body.String())
		}
	}
	if stub.action != "" {
		t.Fatalf("authority called for invalid request: %q", stub.action)
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

func TestNetworkTransactionRequiresAdmin(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleViewer, nil)
	stub := &netcfgAuthorityStub{}
	app.netcfg = stub
	requests := []*http.Request{
		newAuthRequest(http.MethodGet, "/api/v1/network/transaction", "", token),
		newAuthRequest(http.MethodPost, "/api/v1/network/transaction/stage", `{"candidate":{"interface":"eth0","mode":"dhcp"}}`, token),
	}
	for _, req := range requests {
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s %s status=%d body=%s", req.Method, req.URL.Path, w.Code, w.Body.String())
		}
	}
	if stub.action != "" {
		t.Fatalf("authority called for forbidden request: %q", stub.action)
	}
}
