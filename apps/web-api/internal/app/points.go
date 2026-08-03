package app

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
	points, err := a.ReadPoints(r.Context())
	if err != nil && a.logger != nil {
		a.logger.Printf("WARN points_read degraded err=%v", err)
	}
	writeJSON(w, http.StatusOK, points)
}

func (a *App) ReadPoints(ctx context.Context) ([]PointDTO, error) {
	reader, ok := a.core.(pointReader)
	points := []PointDTO{}
	if !ok {
		return a.overlayPointMetadata(a.overlayVirtualPoints(points)), nil
	}
	corePoints, err := reader.ReadPoints(ctx)
	if err == nil && corePoints != nil {
		points = corePoints
	} else {
		points = []PointDTO{}
	}
	return a.overlayPointMetadata(a.overlayVirtualPoints(points)), err
}

// overlayVirtualPoints makes backend-created VP points the only visible
// virtual points. Raw core AV/BV/MSV slots are hidden until represented by
// virtual_points.conf.
func (a *App) overlayVirtualPoints(points []PointDTO) []PointDTO {
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		cfg = defaultVirtualPointsConfig()
	}
	cfg = normalizeVirtualPointsConfig(cfg)
	out := make([]PointDTO, 0, len(points)+len(cfg.Items))
	for _, p := range points {
		if p.Kind == "virtual" {
			continue
		}
		if prefix, _, ok := parsePointID(p.ID); ok && (prefix == "AV" || prefix == "BV" || prefix == "MSV") {
			continue
		}
		out = append(out, p)
	}
	for _, item := range cfg.Items {
		if item.Enabled {
			out = append(out, virtualPointDTO(item))
		}
	}
	return out
}

func (a *App) overlayPointMetadata(points []PointDTO) []PointDTO {
	ioCfg, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		ioCfg = ConfigIO{}
	}
	metadata := map[string]struct {
		tag, name, unit string
		trend           bool
	}{}
	addRows := func(rows []map[string]any, prefix string) {
		for _, row := range rows {
			channel, _, good := intField(row, "ch")
			if !good {
				continue
			}
			id := formatPointID(prefix, channel)
			tag, _, _ := stringField(row, "tag")
			name, _, _ := stringField(row, "name")
			unit, _, _ := stringField(row, "display_unit")
			trend, _, _ := boolField(row, "trend_enabled")
			metadata[id] = struct {
				tag, name, unit string
				trend           bool
			}{fallbackPointTag(tag, id), strings.TrimSpace(name), strings.TrimSpace(unit), trend}
		}
	}
	addRows(ioCfg.UI, "UI")
	addRows(ioCfg.AO, "AO")
	addRows(ioCfg.DO, "DO")
	fieldbus, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	modbusMetadata := make(map[string]ModbusRTUPoint, len(fieldbus.Points))
	for _, point := range fieldbus.Points {
		modbusMetadata[point.PointID] = point
	}
	safeCfg, _ := readConfig(a, configGroupSafeState, ConfigSafeState{})
	safeValues := map[string]any{}
	for _, row := range safeCfg.AO {
		if ch, _, good := intField(row, "ch"); good {
			safeValues[formatPointID("AO", ch)] = row["safe"]
		}
	}
	for _, row := range safeCfg.DO {
		if ch, _, good := intField(row, "ch"); good {
			safeValues[formatPointID("DO", ch)] = row["safe"]
		}
	}
	out := make([]PointDTO, len(points))
	for i, point := range points {
		id := canonicalPointID(point.ID)
		point.ID = id
		point.Channel, _ = globalPointChannel(id)
		if point.Tag == "" {
			point.Tag = id
		}
		if meta, ok := metadata[id]; ok {
			point.Tag = meta.tag
			if meta.name != "" {
				point.Name = meta.name
			}
			if meta.unit != "" {
				point.Unit = meta.unit
			}
			point.LogEnabled = meta.trend
		}
		if point.Name == "" {
			point.Name = id
		}
		if meta, ok := modbusMetadata[id]; ok {
			point.Tag = meta.TagName
			point.Name = meta.DisplayName
			point.Unit = meta.Unit
			point.DataType = meta.DataType
			point.ReadWrite = meta.ReadWrite
			point.DefaultValue = meta.DefaultValue
			point.SafeValue = meta.SafeValue
			point.Writable = meta.ReadWrite == "read_write"
		}
		point.PointID = point.ID
		point.TagName = point.Tag
		point.DisplayName = point.Name
		if point.DataType == "" {
			if _, ok := point.Value.(bool); ok {
				point.DataType = "bool"
			} else {
				point.DataType = "float32"
			}
		}
		point.Timestamp = point.UpdatedAt
		if point.ReadWrite == "" {
			if point.Writable || point.Kind == "AO" || point.Kind == "DO" || point.Kind == "virtual" {
				point.ReadWrite = "read_write"
			} else {
				point.ReadWrite = "read"
			}
		}
		if point.DefaultValue == nil {
			if _, ok := point.Value.(bool); ok {
				point.DefaultValue = false
			} else {
				point.DefaultValue = float64(0)
			}
		}
		if point.SafeValue == nil {
			if configured, ok := safeValues[id]; ok {
				point.SafeValue = configured
			} else if _, ok := point.Value.(bool); ok {
				point.SafeValue = false
			} else {
				point.SafeValue = float64(0)
			}
		}
		switch point.Kind {
		case "modbus_rtu":
			point.Source = "modbus_rtu"
		case "virtual":
			point.Source = "virtual_point"
		default:
			point.Source = "local_physical_io"
		}
		out[i] = point
	}
	return out
}

func (a *App) handlePoint(w http.ResponseWriter, r *http.Request) {
	id := pointIDOrGlobalChannel(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	if item, ok := a.findVirtualPoint(id); ok {
		writeJSON(w, http.StatusOK, virtualPointDTO(item))
		return
	}
	if prefix, _, ok := parsePointID(id); ok && (virtualPointIDPrefix(prefix) || prefix == "BV" || prefix == "MSV") {
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	targetID := canonicalPointID(id)
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
			projected := a.overlayPointMetadata([]PointDTO{point})
			writeJSON(w, http.StatusOK, projected[0])
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
	id := pointIDOrGlobalChannel(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	body, err := decodeForcePointBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if item, ok := a.findVirtualPoint(id); ok {
		point, err := a.writeVirtualPointValue(r, item.ID, body.value, body.release)
		if err != nil {
			a.audit.PointForce(principal, id, body.release, "rejected", r.RemoteAddr)
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		a.audit.PointForce(principal, id, body.release, "accepted", r.RemoteAddr)
		writeJSON(w, http.StatusOK, point)
		return
	}
	if prefix, _, ok := parsePointID(id); ok && (virtualPointIDPrefix(prefix) || prefix == "BV" || prefix == "MSV") {
		a.audit.PointForce(principal, id, body.release, "not_found", r.RemoteAddr)
		writeError(w, http.StatusNotFound, "point not found")
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
	projected := a.overlayPointMetadata([]PointDTO{point})
	writeJSON(w, http.StatusOK, projected[0])
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

func (a *App) findVirtualPoint(id string) (VirtualPoint, bool) {
	target := canonicalVirtualPointID(id)
	if !validVirtualPointID(target) {
		return VirtualPoint{}, false
	}
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return VirtualPoint{}, false
	}
	for _, item := range cfg.Items {
		item = normalizeVirtualPoint(item)
		if item.ID == target {
			return item, true
		}
	}
	return VirtualPoint{}, false
}

func (a *App) writeVirtualPointValue(r *http.Request, id string, value any, release bool) (PointDTO, error) {
	if release {
		return PointDTO{}, fmt.Errorf("virtual point release unsupported")
	}
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return PointDTO{}, err
	}
	target := canonicalVirtualPointID(id)
	index := virtualPointIndex(cfg.Items, target)
	if index < 0 {
		return PointDTO{}, fmt.Errorf("virtual point not found")
	}
	item := normalizeVirtualPoint(cfg.Items[index])
	if !item.Writable {
		return PointDTO{}, fmt.Errorf("virtual point is read-only")
	}
	nextValue, ok := normalizeVirtualPointValue(item.SignalType, value)
	if !ok {
		return PointDTO{}, fmt.Errorf("value must match signalType")
	}
	item.Value = nextValue
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	cfg.Items[index] = item
	if err := a.writeVirtualPointsConfig(r, cfg, "write"); err != nil {
		return PointDTO{}, err
	}
	a.virtualPointRuntime.Update(RuntimePoint{ID: item.ID, Kind: "VP", Value: item.Value, Quality: "GOOD", Source: "web", Role: "runtime_value", Unit: item.Unit, SignalType: item.SignalType, Generation: item.Generation})
	return virtualPointDTO(item), nil
}

func validPointCommandValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return true
	case string:
		return true
	case json.Number:
		_, err := typed.Float64()
		return err == nil
	default:
		return false
	}
}
