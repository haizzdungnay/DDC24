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
	points = a.overlayVirtualIO(points)
	writeJSON(w, http.StatusOK, points)
}

// overlayVirtualIO replaces raw backing points (AV1, BV3, …) with configured
// VI/VO identities so the frontend only sees user-created virtual points.
// Backing points not mapped to any VI/VO are hidden from the response.
func (a *App) overlayVirtualIO(points []PointDTO) []PointDTO {
	cfg, err := readConfig(a, configGroupVirtualIO, defaultVirtualIOConfig())
	if err != nil || len(cfg.Items) == 0 {
		return points
	}
	// Build backing→VI/VO map (only enabled items).
	type overlay struct {
		id    string
		name  string
		unit  string
	}
	backingToVI := make(map[string]overlay, len(cfg.Items))
	allBacking := make(map[string]bool, len(cfg.Items))
	for _, item := range cfg.Items {
		item = normalizeVirtualIOPoint(item)
		canon := canonicalVirtualBackingPoint(item.BackingPoint)
		allBacking[canon] = true
		if item.Enabled {
			backingToVI[canon] = overlay{id: item.ID, name: item.Label, unit: item.Unit}
		}
	}
	out := make([]PointDTO, 0, len(points))
	for _, p := range points {
		canon := canonicalPointID(p.ID)
		if ov, ok := backingToVI[canon]; ok {
			p.ID = ov.id
			p.Name = ov.name
			p.Kind = "virtual"
			if ov.unit != "" {
				p.Unit = ov.unit
			}
			out = append(out, p)
		} else if allBacking[canon] {
			// Backing point mapped to a disabled VI/VO — hide it.
			continue
		} else if p.Kind == "virtual" {
			// Raw AV/BV/MSV not mapped to any VI/VO — hide.
			continue
		} else {
			out = append(out, p)
		}
	}
	return out
}

func (a *App) handlePoint(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	targetID := canonicalPointID(id)
	// Translate VI/VO to backing point for lookup.
	backingID, viOverlay := a.resolveVirtualID(targetID)
	if backingID != "" {
		targetID = backingID
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
		if canonicalPointID(point.ID) == targetID {
			if viOverlay != nil {
				point.ID = viOverlay.ID
				point.Name = viOverlay.Label
				point.Kind = "virtual"
				if viOverlay.Unit != "" {
					point.Unit = viOverlay.Unit
				}
			}
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
	// Translate VI/VO to backing point for force command.
	forceID := id
	if backing, _ := a.resolveVirtualID(canonicalPointID(id)); backing != "" {
		forceID = backing
	}
	forcer, ok := a.core.(pointForcer)
	if !ok {
		a.audit.PointForce(principal, id, body.release, "unsupported", r.RemoteAddr)
		writeError(w, http.StatusConflict, "point force unsupported")
		return
	}
	point, err := forcer.ForcePoint(r.Context(), forceID, body.value, body.release)
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
	if !validPointCommandValue(value) {
		return forcePointBody{}, fmt.Errorf("value must be number or boolean")
	}
	return forcePointBody{value: value}, nil
}

// resolveVirtualID translates a VI/VO id (e.g. "VI-01") to its backing point
// id (e.g. "AV1") and returns the config entry. Returns ("", nil) when the id
// is not a virtual point.
func (a *App) resolveVirtualID(id string) (string, *VirtualIOPoint) {
	prefix, _, ok := parsePointID(id)
	if !ok || (prefix != "VI" && prefix != "VO") {
		return "", nil
	}
	cfg, err := readConfig(a, configGroupVirtualIO, defaultVirtualIOConfig())
	if err != nil {
		return "", nil
	}
	norm := normalizeVirtualIOID(id)
	for _, item := range cfg.Items {
		item = normalizeVirtualIOPoint(item)
		if item.ID == norm {
			backing := canonicalVirtualBackingPoint(item.BackingPoint)
			return backing, &item
		}
	}
	return "", nil
}

func validPointCommandValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return true
	case json.Number:
		_, err := typed.Float64()
		return err == nil
	default:
		return false
	}
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
