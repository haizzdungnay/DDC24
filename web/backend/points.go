package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type pointReader interface {
	ReadPoints(context.Context) ([]PointDTO, error)
}

type pointForcer interface {
	ForcePoint(context.Context, string, any, bool) (PointDTO, error)
}

type forcePointBody struct {
	value   any
	release bool
}

func (a *App) handlePoints(w http.ResponseWriter, r *http.Request) {
	reader, ok := a.core.(pointReader)
	if !ok {
		writeJSON(w, http.StatusOK, []PointDTO{})
		return
	}
	points, err := reader.ReadPoints(r.Context())
	if err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN points_read degraded err=%v", err)
		}
		points = []PointDTO{}
	}
	if points == nil {
		points = []PointDTO{}
	}
	writeJSON(w, http.StatusOK, points)
}

func (a *App) handlePoint(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	reader, ok := a.core.(pointReader)
	if !ok {
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	points, err := reader.ReadPoints(r.Context())
	if err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN point_read degraded id=%s err=%v", id, err)
		}
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	for _, point := range points {
		if point.ID == id {
			writeJSON(w, http.StatusOK, point)
			return
		}
	}
	writeError(w, http.StatusNotFound, "point not found")
}

func (a *App) handleForcePoint(w http.ResponseWriter, r *http.Request) {
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
	body, err := decodeForcePointBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	forcer, ok := a.core.(pointForcer)
	if !ok {
		a.audit.PointForce(principal, id, body.release, "unsupported", r.RemoteAddr)
		writeError(w, http.StatusConflict, "point force unsupported")
		return
	}
	point, err := forcer.ForcePoint(r.Context(), id, body.value, body.release)
	if err != nil {
		a.audit.PointForce(principal, id, body.release, "rejected", r.RemoteAddr)
		writeError(w, http.StatusConflict, "point force rejected")
		return
	}
	result := "accepted"
	if point.Fault {
		result = "degraded"
	}
	a.audit.PointForce(principal, id, body.release, result, r.RemoteAddr)
	writeJSON(w, http.StatusOK, point)
}

func decodeForcePointBody(w http.ResponseWriter, r *http.Request) (forcePointBody, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return forcePointBody{}, fmt.Errorf("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return forcePointBody{}, fmt.Errorf("invalid json")
	}
	for key := range raw {
		if key != "value" && key != "release" {
			return forcePointBody{}, fmt.Errorf("unknown field %q", key)
		}
	}
	releaseRaw, hasRelease := raw["release"]
	valueRaw, hasValue := raw["value"]
	if hasRelease {
		var release bool
		if err := json.Unmarshal(releaseRaw, &release); err != nil {
			return forcePointBody{}, fmt.Errorf("invalid release")
		}
		if release {
			if hasValue {
				return forcePointBody{}, fmt.Errorf("release cannot include value")
			}
			return forcePointBody{release: true}, nil
		}
	}
	if !hasValue {
		return forcePointBody{}, fmt.Errorf("missing value or release")
	}
	var value any
	valueDec := json.NewDecoder(bytes.NewReader(valueRaw))
	valueDec.UseNumber()
	if err := valueDec.Decode(&value); err != nil {
		return forcePointBody{}, fmt.Errorf("invalid value")
	}
	return forcePointBody{value: value}, nil
}

func (a *AuditLogger) PointForce(principal *Principal, id string, release bool, result string, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	username := "-"
	role := "-"
	if principal != nil {
		username = principal.Username
		role = string(principal.Role)
	}
	op := "force"
	if release {
		op = "release"
	}
	a.logger.Printf("AUDIT point_force ts=%s user=%s role=%s point=%s op=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
		sanitizeAudit(id, 64), op, sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}
