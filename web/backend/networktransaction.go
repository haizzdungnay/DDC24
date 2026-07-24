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
	a.forwardNetworkTransaction(w, r, "status", "", nil)
}

func (a *App) handlePostNetworkTransaction(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	if !isNetworkTransactionAction(action) {
		writeError(w, http.StatusNotFound, "network transaction action not found")
		return
	}

	var payload networkTransactionRequest
	if err := decodeNetworkTransactionBody(w, r, &payload); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if details := validateNetworkTransactionRequest(action, payload); len(details) > 0 {
		writeValidationErrors(w, details)
		return
	}
	a.forwardNetworkTransaction(w, r, action, payload.TransactionID, payload.Candidate)
}

func (a *App) forwardNetworkTransaction(w http.ResponseWriter, r *http.Request, action, transactionID string, candidate *NetcfgCandidate) {
	reqID := requestID()
	if a.netcfg == nil {
		a.auditNetworkTransaction(r, action, transactionID, "unavailable")
		writeError(w, http.StatusServiceUnavailable, "network configuration service unavailable")
		return
	}
	response, err := a.netcfg.Request(r.Context(), reqID, action, transactionID, candidate)
	if err != nil {
		result := "error"
		status := http.StatusBadGateway
		message := "network configuration service failed"
		if errors.Is(err, errNetcfgUnavailable) {
			result = "unavailable"
			status = http.StatusServiceUnavailable
			message = "network configuration service unavailable"
		}
		a.auditNetworkTransaction(r, action, transactionID, result)
		writeError(w, status, message)
		return
	}
	a.auditNetworkTransaction(r, action, firstNonEmpty(response.TransactionID, transactionID), response.Result+":"+response.ReasonCode)
	writeJSON(w, http.StatusOK, response)
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
	if !netcfgInterfacePattern.MatchString(candidate.Interface) {
		addConfigErr(&details, "candidate.interface", "must match ^[A-Za-z0-9_.-]{1,15}$")
	}
	if candidate.Mode != "static" && candidate.Mode != "dhcp" {
		addConfigErr(&details, "candidate.mode", "must be static or dhcp")
	}
	if candidate.Mode == "static" {
		validateNetcfgIPv4(&details, "candidate.ipv4", candidate.IPv4, true)
		if !validIPv4Netmask(candidate.Netmask) {
			addConfigErr(&details, "candidate.netmask", "must be a contiguous IPv4 netmask")
		}
	} else {
		validateNetcfgIPv4(&details, "candidate.ipv4", candidate.IPv4, false)
		if candidate.Netmask != "" && !validIPv4Netmask(candidate.Netmask) {
			addConfigErr(&details, "candidate.netmask", "must be a contiguous IPv4 netmask")
		}
	}
	validateNetcfgIPv4(&details, "candidate.gateway", candidate.Gateway, false)
	return details
}

func validateNetcfgIPv4(details *[]configValidationError, path, value string, required bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		if required {
			addConfigErr(details, path, "is required for static mode")
		}
		return
	}
	parsed := net.ParseIP(value)
	if parsed == nil || parsed.To4() == nil || strings.Contains(value, ":") {
		addConfigErr(details, path, "must be a valid IPv4 address")
	}
}

func validIPv4Netmask(value string) bool {
	parsed := net.ParseIP(strings.TrimSpace(value))
	if parsed == nil || parsed.To4() == nil || strings.Contains(value, ":") {
		return false
	}
	mask := net.IPMask(parsed.To4())
	ones, bits := mask.Size()
	return bits == 32 && ones >= 0
}
