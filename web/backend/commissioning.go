package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// handleCommissionTest handles POST /api/v1/commissioning/points/{id}/test (RBAC operator+).
// Sends a commissioning test command to core via CommissionTest and returns CommissioningTestResult.
func (a *App) handleCommissionTest(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || !RoleAllows(principal.Role, RoleOperator) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	value, err := decodeCommissionTestBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tester, ok := a.core.(commissionTester)
	if !ok {
		a.audit.CommissioningTest(principal, id, "unsupported", r.RemoteAddr)
		writeError(w, http.StatusConflict, "commissioning test unsupported")
		return
	}
	res, err := tester.CommissionTest(r.Context(), id, value)
	if err != nil {
		a.audit.CommissioningTest(principal, id, "rejected", r.RemoteAddr)
		writeError(w, http.StatusConflict, fmt.Sprintf("commission test error: %v", err))
		return
	}
	a.audit.CommissioningTest(principal, id, res.Result, r.RemoteAddr)
	writeJSON(w, http.StatusOK, res)
}

func decodeCommissionTestBody(w http.ResponseWriter, r *http.Request) (any, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("invalid json")
	}
	for key := range raw {
		if key != "value" {
			return nil, fmt.Errorf("unknown field %q", key)
		}
	}
	valueRaw, ok := raw["value"]
	if !ok {
		return nil, fmt.Errorf("missing value")
	}
	var value any
	vdec := json.NewDecoder(bytes.NewReader(valueRaw))
	vdec.UseNumber()
	if err := vdec.Decode(&value); err != nil {
		return nil, fmt.Errorf("invalid value")
	}
	switch value.(type) {
	case bool, json.Number:
		return value, nil
	default:
		return nil, fmt.Errorf("value must be number or bool")
	}
}

func (a *AuditLogger) CommissioningTest(principal *Principal, id string, result string, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	username := "-"
	role := "-"
	if principal != nil {
		username = principal.Username
		role = string(principal.Role)
	}
	a.logger.Printf("AUDIT commissioning_test ts=%s user=%s role=%s point=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
		sanitizeAudit(id, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}
