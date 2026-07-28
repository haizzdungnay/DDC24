package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
)

const networkTransactionMaxBodyBytes = 4096

var netcfgTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)
var netcfgInterfacePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,15}$`)

type networkTransactionRequest struct {
	TransactionID string           `json:"transactionId,omitempty"`
	Candidate     *NetcfgCandidate `json:"candidate,omitempty"`
}

func (a *App) handleGetNetworkTransaction(w http.ResponseWriter, r *http.Request) {
	a.forwardNetworkTransaction(w, r, "status", "", nil, false)
}

func (a *App) handlePostNetworkTransaction(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	if !isNetworkTransactionAction(action) {
		a.auditNetworkTransaction(r, action, "", "invalid_action")
		writeError(w, http.StatusNotFound, "network transaction action not found")
		return
	}

	var payload networkTransactionRequest
	if err := decodeNetworkTransactionBody(w, r, &payload); err != nil {
		a.auditNetworkTransaction(r, action, "", "invalid_body")
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if details := validateNetworkTransactionRequest(action, payload); len(details) > 0 {
		a.auditNetworkTransaction(r, action, payload.TransactionID, "invalid_candidate")
		writeValidationErrors(w, details)
		return
	}
	if payload.Candidate != nil && payload.Candidate.DNS != nil && !a.requireNetworkCapability(w, r, action, "dns") {
		return
	}
	a.forwardNetworkTransaction(w, r, action, payload.TransactionID, payload.Candidate, true)
}

func (a *App) forwardNetworkTransaction(w http.ResponseWriter, r *http.Request, action, transactionID string, candidate *NetcfgCandidate, auditMutation bool) {
	reqID := requestID()
	if a.netcfg == nil {
		if auditMutation {
			a.auditNetworkTransaction(r, action, transactionID, "unavailable")
		}
		writeError(w, http.StatusServiceUnavailable, "network configuration service unavailable")
		return
	}
	response, err := a.netcfg.Request(r.Context(), reqID, action, transactionID, candidate)
	if err != nil {
		result, status, message := networkAuthorityError(err)
		if auditMutation {
			a.auditNetworkTransaction(r, action, transactionID, result)
		}
		writeError(w, status, message)
		return
	}
	if auditMutation && candidate != nil && candidate.DNS != nil {
		if err := validateNetcfgDNSMutationResponse(action, *candidate.DNS, response); err != nil {
			a.auditNetworkTransaction(r, action, firstNonEmpty(response.TransactionID, transactionID), "error")
			writeError(w, http.StatusBadGateway, "invalid network configuration service response")
			return
		}
	}
	if auditMutation {
		a.auditNetworkTransaction(r, action, firstNonEmpty(response.TransactionID, transactionID), response.Result+":"+response.ReasonCode)
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) requireNetworkCapability(w http.ResponseWriter, r *http.Request, action, capability string) bool {
	if a.netcfg == nil {
		return true
	}
	response, err := a.netcfg.Request(r.Context(), requestID(), "status", "", nil)
	if err != nil {
		result, status, message := networkAuthorityError(err)
		a.auditNetworkTransaction(r, action, "", result)
		writeError(w, status, message)
		return false
	}
	if response.Result != "accepted" || !hasNetcfgCapability(response.Capabilities, capability) {
		a.auditNetworkTransaction(r, action, "", "unsupported:"+capability)
		writeError(w, http.StatusServiceUnavailable, "network configuration service does not support "+capability+" transactions")
		return false
	}
	return true
}

func networkAuthorityError(err error) (result string, status int, message string) {
	if errors.Is(err, errNetcfgUnavailable) {
		return "unavailable", http.StatusServiceUnavailable, "network configuration service unavailable"
	}
	if errors.Is(err, errNetcfgInvalidResponse) {
		return "error", http.StatusBadGateway, "invalid network configuration service response"
	}
	return "error", http.StatusBadGateway, "network configuration service failed"
}

func validateNetcfgDNSMutationResponse(action string, candidateDNS NetcfgDNS, response NetcfgResponse) error {
	if !hasExactNetcfgCapabilities(response.Capabilities) {
		return errNetcfgInvalidResponse
	}
	if action != "stage" || response.Result != "accepted" {
		return nil
	}
	if response.State != "staged" || !netcfgTokenPattern.MatchString(response.TransactionID) || response.Pending == nil || response.Pending.DNS == nil {
		return errNetcfgInvalidResponse
	}
	if response.Pending.DNS.Mode != candidateDNS.Mode || len(response.Pending.DNS.Servers) != len(candidateDNS.Servers) {
		return errNetcfgInvalidResponse
	}
	for i := range candidateDNS.Servers {
		if response.Pending.DNS.Servers[i] != candidateDNS.Servers[i] {
			return errNetcfgInvalidResponse
		}
	}
	return nil
}

func hasNetcfgCapability(capabilities []string, expected string) bool {
	for _, capability := range capabilities {
		if capability == expected {
			return true
		}
	}
	return false
}

func (a *App) auditNetworkTransaction(r *http.Request, action, transactionID, result string) {
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	target := "netcfg"
	if transactionID != "" {
		target = "netcfg:" + transactionID
	}
	a.audit.Change(user, "network."+action, target, result, r.RemoteAddr)
}

func decodeNetworkTransactionBody(w http.ResponseWriter, r *http.Request, dst *networkTransactionRequest) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, networkTransactionMaxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("invalid json")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("invalid json")
	}
	return nil
}

func isNetworkTransactionAction(action string) bool {
	switch action {
	case "validate", "stage", "apply", "confirm", "rollback":
		return true
	default:
		return false
	}
}

func validateNetworkTransactionRequest(action string, payload networkTransactionRequest) []configValidationError {
	var details []configValidationError
	if action == "validate" || action == "stage" {
		if payload.Candidate == nil {
			addConfigErr(&details, "candidate", "is required")
		} else {
			details = append(details, validateNetcfgCandidate(*payload.Candidate)...)
		}
		if payload.TransactionID != "" {
			addConfigErr(&details, "transactionId", "is not allowed for this action")
		}
		return details
	}

	if payload.Candidate != nil {
		addConfigErr(&details, "candidate", "is not allowed for this action")
	}
	if !netcfgTokenPattern.MatchString(payload.TransactionID) {
		addConfigErr(&details, "transactionId", "must match ^[A-Za-z0-9_.:-]{1,64}$")
	}
	return details
}

func validateNetcfgCandidate(candidate NetcfgCandidate) []configValidationError {
	var details []configValidationError
	if !netcfgInterfacePattern.MatchString(candidate.Interface) || candidate.Interface == "lo" {
		addConfigErr(&details, "candidate.interface", "must be a non-loopback interface matching ^[A-Za-z0-9_.-]{1,15}$")
	}
	if candidate.Mode != "static" && candidate.Mode != "dhcp" {
		addConfigErr(&details, "candidate.mode", "must be static or dhcp")
		return details
	}
	details = append(details, validateNetcfgDNS(candidate.Mode, candidate.DNS)...)
	if candidate.Mode == "dhcp" {
		if candidate.IPv4 != "" {
			addConfigErr(&details, "candidate.ipv4", "must be empty for dhcp mode")
		}
		if candidate.Netmask != "" {
			addConfigErr(&details, "candidate.netmask", "must be empty for dhcp mode")
		}
		if candidate.Gateway != "" {
			addConfigErr(&details, "candidate.gateway", "must be empty for dhcp mode")
		}
		return details
	}

	ip, ipOK := parseNetcfgIPv4(&details, "candidate.ipv4", candidate.IPv4, true)
	prefix, maskOK := netcfgNetmaskPrefix(candidate.Netmask)
	if !maskOK || prefix < 1 || prefix > 30 {
		addConfigErr(&details, "candidate.netmask", "must be a contiguous IPv4 netmask with prefix length 1..30")
	}
	if ipOK && maskOK && prefix >= 1 && prefix <= 30 {
		firstOctet := ip >> 24
		if firstOctet == 0 || firstOctet == 127 || ip>>28 == 0xe || ip == 0xffffffff {
			addConfigErr(&details, "candidate.ipv4", "must be a usable unicast IPv4 address")
		} else {
			mask := uint32(0xffffffff) << (32 - prefix)
			host := ip & ^mask
			if host == 0 || host == ^mask {
				addConfigErr(&details, "candidate.ipv4", "must not be the network or broadcast address")
			}
			if candidate.Gateway != "" {
				gateway, gatewayOK := parseNetcfgIPv4(&details, "candidate.gateway", candidate.Gateway, false)
				if gatewayOK {
					gatewayHost := gateway & ^mask
					if gateway == ip || gateway&mask != ip&mask || gatewayHost == 0 || gatewayHost == ^mask {
						addConfigErr(&details, "candidate.gateway", "must be a usable address in the candidate subnet and differ from candidate.ipv4")
					}
				}
			}
		}
	} else if candidate.Gateway != "" {
		parseNetcfgIPv4(&details, "candidate.gateway", candidate.Gateway, false)
	}
	return details
}

func validateNetcfgDNS(candidateMode string, dns *NetcfgDNS) []configValidationError {
	if dns == nil {
		return nil
	}
	var details []configValidationError
	switch dns.Mode {
	case "auto":
		if candidateMode != "dhcp" {
			addConfigErr(&details, "candidate.dns.mode", "auto is only allowed for dhcp mode")
		}
		if len(dns.Servers) != 0 {
			addConfigErr(&details, "candidate.dns.servers", "must be empty for auto mode")
		}
	case "manual":
		if len(dns.Servers) < 1 || len(dns.Servers) > 4 {
			addConfigErr(&details, "candidate.dns.servers", "must contain 1..4 IPv4 addresses for manual mode")
		}
		seen := make(map[string]struct{}, len(dns.Servers))
		for i, server := range dns.Servers {
			path := fmt.Sprintf("candidate.dns.servers[%d]", i)
			if !isCanonicalNetcfgIPv4(server) {
				addConfigErr(&details, path, "must be a canonical IPv4 address")
				continue
			}
			if _, duplicate := seen[server]; duplicate {
				addConfigErr(&details, path, "must be unique")
				continue
			}
			seen[server] = struct{}{}
		}
	default:
		addConfigErr(&details, "candidate.dns.mode", "must be auto or manual")
	}
	return details
}

func parseNetcfgIPv4(details *[]configValidationError, path, value string, required bool) (uint32, bool) {
	if value == "" {
		if required {
			addConfigErr(details, path, "is required for static mode")
		}
		return 0, false
	}
	parsed := net.ParseIP(value)
	if parsed == nil || parsed.To4() == nil || strings.Contains(value, ":") {
		addConfigErr(details, path, "must be a valid IPv4 address")
		return 0, false
	}
	ip := parsed.To4()
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3]), true
}

func netcfgNetmaskPrefix(value string) (int, bool) {
	parsed := net.ParseIP(value)
	if parsed == nil || parsed.To4() == nil || strings.Contains(value, ":") {
		return 0, false
	}
	mask := net.IPMask(parsed.To4())
	ones, bits := mask.Size()
	return ones, bits == 32 && ones >= 0
}
