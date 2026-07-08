package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	virtualIODirectionInput  = "input"
	virtualIODirectionOutput = "output"
	virtualIOTypeAnalog      = "analog"
	virtualIOTypeBinary      = "binary"
	virtualIOTypeMultistate  = "multistate"
)

func (item *VirtualIOPoint) UnmarshalJSON(data []byte) error {
	type virtualIOPointJSON VirtualIOPoint
	next := virtualIOPointJSON(*item)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if _, ok := raw["enabled"]; !ok && !next.Enabled {
		next.Enabled = true
	}
	if err := json.Unmarshal(data, &next); err != nil {
		return err
	}
	*item = VirtualIOPoint(next)
	return nil
}

func (a *App) handleListVirtualIO(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(a, configGroupVirtualIO, defaultVirtualIOConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, normalizeVirtualIOConfig(cfg).Items)
}

func (a *App) handleCreateVirtualIO(w http.ResponseWriter, r *http.Request) {
	a.virtualIOMu.Lock()
	defer a.virtualIOMu.Unlock()

	cfg, err := readConfig(a, configGroupVirtualIO, defaultVirtualIOConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	item := defaultVirtualIOPoint()
	if err := decodeConfigBody(w, r, &item); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	item.Direction = strings.ToLower(strings.TrimSpace(item.Direction))
	item.ValueType = strings.ToLower(strings.TrimSpace(item.ValueType))
	if item.ID == "" {
		item.ID = nextVirtualIOID(cfg.Items, item.Direction)
	}
	if item.BackingPoint == "" {
		item.BackingPoint = allocateVirtualBackingPoint(cfg.Items, item.Direction, item.ValueType)
	}
	item = normalizeVirtualIOPoint(item)
	next := ConfigVirtualIO{Items: append(cfg.Items, item)}
	if errs := validateConfigVirtualIO(next); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	if err := a.writeVirtualIOConfig(r, next, "create"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (a *App) handleUpdateVirtualIO(w http.ResponseWriter, r *http.Request) {
	a.virtualIOMu.Lock()
	defer a.virtualIOMu.Unlock()

	id := normalizeVirtualIOID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing virtual io id")
		return
	}
	cfg, err := readConfig(a, configGroupVirtualIO, defaultVirtualIOConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	index := virtualIOIndex(cfg.Items, id)
	if index < 0 {
		writeError(w, http.StatusNotFound, "virtual io not found")
		return
	}
	item := cfg.Items[index]
	if err := decodeConfigBody(w, r, &item); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	item.ID = id
	item = normalizeVirtualIOPoint(item)
	cfg.Items[index] = item
	if errs := validateConfigVirtualIO(cfg); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	if err := a.writeVirtualIOConfig(r, cfg, "update"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *App) handleDeleteVirtualIO(w http.ResponseWriter, r *http.Request) {
	a.virtualIOMu.Lock()
	defer a.virtualIOMu.Unlock()

	id := normalizeVirtualIOID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing virtual io id")
		return
	}
	cfg, err := readConfig(a, configGroupVirtualIO, defaultVirtualIOConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	index := virtualIOIndex(cfg.Items, id)
	if index < 0 {
		writeError(w, http.StatusNotFound, "virtual io not found")
		return
	}
	cfg.Items = append(cfg.Items[:index], cfg.Items[index+1:]...)
	if err := a.writeVirtualIOConfig(r, cfg, "delete"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "success", Applied: true, Reload: reloadNone, Warnings: []string{}})
}

func (a *App) writeVirtualIOConfig(r *http.Request, cfg ConfigVirtualIO, op string) error {
	cfg = normalizeVirtualIOConfig(cfg)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode virtual io config: %w", err)
	}
	data = append(data, '\n')
	path := a.configPath(configGroupVirtualIO.file)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("prepare config dir: %w", err)
	}
	if err := writeConfigFileAtomic(path, data, 0o644); err != nil {
		return err
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "virtual-io."+op, configGroupVirtualIO.file, "applied", r.RemoteAddr)
	return nil
}

func validateConfigVirtualIO(cfg ConfigVirtualIO) []configValidationError {
	var errs []configValidationError
	ids := map[string]bool{}
	backing := map[string]bool{}
	for i, item := range cfg.Items {
		base := fmt.Sprintf("items[%d]", i)
		item = normalizeVirtualIOPoint(item)
		if item.ID == "" {
			addConfigErr(&errs, base+".id", "is required")
		} else if !validVirtualIOID(item.ID) {
			addConfigErr(&errs, base+".id", "must use VI-01 or VO-01 format")
		} else if ids[item.ID] {
			addConfigErr(&errs, base+".id", "must be unique")
		} else if !virtualIOIDMatchesDirection(item.ID, item.Direction) {
			addConfigErr(&errs, base+".id", "VI ids must be input and VO ids must be output")
		}
		ids[item.ID] = true
		if item.Direction != virtualIODirectionInput && item.Direction != virtualIODirectionOutput {
			addConfigErr(&errs, base+".direction", "must be input or output")
		}
		if item.ValueType != virtualIOTypeAnalog && item.ValueType != virtualIOTypeBinary && item.ValueType != virtualIOTypeMultistate {
			addConfigErr(&errs, base+".valueType", "must be analog, binary, or multistate")
		}
		if !validVirtualSignalType(item.ValueType, item.SignalType) {
			addConfigErr(&errs, base+".signalType", "must match virtual valueType")
		}
		if strings.TrimSpace(item.Label) == "" {
			addConfigErr(&errs, base+".label", "is required")
		} else if len(item.Label) > 64 {
			addConfigErr(&errs, base+".label", "must be at most 64 bytes")
		}
		if item.BackingPoint == "" {
			addConfigErr(&errs, base+".backingPoint", "is required")
		} else if !validVirtualBackingPoint(item.Direction, item.ValueType, item.BackingPoint) {
			addConfigErr(&errs, base+".backingPoint", "must match virtual type and reserved pool")
		} else if backing[item.BackingPoint] {
			addConfigErr(&errs, base+".backingPoint", "must be unique")
		}
		backing[item.BackingPoint] = true
		if item.DisplayMax <= item.DisplayMin {
			addConfigErr(&errs, base+".displayMax", "must be greater than displayMin")
		}
		if item.RangeMultiplier < 0 || item.RangeMultiplier > 5 {
			addConfigErr(&errs, base+".rangeMultiplier", "must be integer in range 0..5")
		}
		if item.SensorCal < -12.7 || item.SensorCal > 12.8 {
			addConfigErr(&errs, base+".sensorCal", "must be number in range -12.7..12.8")
		}
		if item.MathFunction < 0 || item.MathFunction > 3 {
			addConfigErr(&errs, base+".mathFunction", "must be integer in range 0..3")
		}
		if item.ConnectionTimeoutS < 0 || item.ConnectionTimeoutS > 54000 {
			addConfigErr(&errs, base+".connectionTimeoutS", "must be integer in range 0..54000")
		}
		validateVirtualManualValue(&errs, base+".manualValue", item)
	}
	return errs
}

func validateVirtualManualValue(errs *[]configValidationError, path string, item VirtualIOPoint) {
	if item.ManualValue == nil {
		return
	}
	switch item.ValueType {
	case virtualIOTypeAnalog:
		switch value := item.ManualValue.(type) {
		case json.Number:
			if _, err := value.Float64(); err != nil {
				addConfigErr(errs, path, "must be number")
			}
		case float64, float32, int, int64, int32:
		default:
			addConfigErr(errs, path, "must be number")
		}
	case virtualIOTypeBinary:
		if _, ok := item.ManualValue.(bool); !ok {
			addConfigErr(errs, path, "must be boolean")
		}
	case virtualIOTypeMultistate:
		n, ok := virtualIONumber(item.ManualValue)
		if !ok || n < 0 || n > 7 || n != float64(int(n)) {
			addConfigErr(errs, path, "must be integer in range 0..7")
		}
	}
}

func defaultVirtualIOPoint() VirtualIOPoint {
	return VirtualIOPoint{
		Direction:          virtualIODirectionInput,
		ValueType:          virtualIOTypeAnalog,
		Label:              "Virtual Input",
		Enabled:            true,
		SignalType:         0,
		DisplayMin:         0,
		DisplayMax:         100,
		RangeMultiplier:    0,
		SensorCal:          0,
		MathFunction:       0,
		ConnectionTimeoutS: 60,
	}
}

func defaultVirtualIOConfig() ConfigVirtualIO {
	return ConfigVirtualIO{Items: []VirtualIOPoint{}}
}

func normalizeVirtualIOConfig(cfg ConfigVirtualIO) ConfigVirtualIO {
	if cfg.Items == nil {
		cfg.Items = []VirtualIOPoint{}
	}
	for i, item := range cfg.Items {
		cfg.Items[i] = normalizeVirtualIOPoint(item)
	}
	return cfg
}

func normalizeVirtualIOPoint(item VirtualIOPoint) VirtualIOPoint {
	item.ID = normalizeVirtualIOID(item.ID)
	item.Direction = strings.ToLower(strings.TrimSpace(item.Direction))
	item.ValueType = strings.ToLower(strings.TrimSpace(item.ValueType))
	item.BackingPoint = canonicalVirtualBackingPoint(item.BackingPoint)
	item.Label = strings.TrimSpace(item.Label)
	item.Unit = strings.TrimSpace(item.Unit)
	return item
}

func normalizeVirtualIOID(id string) string {
	raw := strings.ToUpper(strings.TrimSpace(id))
	prefix, channel, ok := parsePointID(raw)
	if !ok || (prefix != "VI" && prefix != "VO") {
		return raw
	}
	return fmt.Sprintf("%s-%02d", prefix, channel)
}

func validVirtualIOID(id string) bool {
	prefix, channel, ok := parsePointID(id)
	return ok && (prefix == "VI" || prefix == "VO") && channel >= 1 && channel <= 99
}

func validVirtualSignalType(valueType string, signalType int) bool {
	switch valueType {
	case virtualIOTypeAnalog:
		return signalType >= 0 && signalType <= 3
	case virtualIOTypeBinary:
		return signalType == 0 || signalType == 4 || signalType == 5
	case virtualIOTypeMultistate:
		return signalType == 0 || signalType == 3
	default:
		return false
	}
}

func virtualIOIDMatchesDirection(id string, direction string) bool {
	prefix, _, ok := parsePointID(id)
	if !ok {
		return false
	}
	return (prefix == "VI" && direction == virtualIODirectionInput) || (prefix == "VO" && direction == virtualIODirectionOutput)
}

func canonicalVirtualBackingPoint(point string) string {
	prefix, channel, ok := parsePointID(point)
	if !ok {
		return strings.ToUpper(strings.TrimSpace(point))
	}
	return fmt.Sprintf("%s%d", prefix, channel)
}

func validVirtualBackingPoint(direction string, valueType string, point string) bool {
	prefix, channel, ok := parsePointID(point)
	if !ok {
		return false
	}
	switch valueType {
	case virtualIOTypeAnalog:
		if prefix != "AV" {
			return false
		}
		if direction == virtualIODirectionInput {
			return channel >= 1 && channel <= 16
		}
		return channel >= 17 && channel <= 32
	case virtualIOTypeBinary:
		if prefix != "BV" {
			return false
		}
		if direction == virtualIODirectionInput {
			return channel >= 1 && channel <= 8
		}
		return channel >= 9 && channel <= 16
	case virtualIOTypeMultistate:
		return prefix == "MSV" && channel >= 2 && channel <= 8
	default:
		return false
	}
}

func allocateVirtualBackingPoint(items []VirtualIOPoint, direction string, valueType string) string {
	used := map[string]bool{}
	for _, item := range items {
		used[canonicalVirtualBackingPoint(item.BackingPoint)] = true
	}
	for _, point := range virtualBackingPool(direction, valueType) {
		if !used[point] {
			return point
		}
	}
	return ""
}

func virtualBackingPool(direction string, valueType string) []string {
	var prefix string
	var start, end int
	switch valueType {
	case virtualIOTypeBinary:
		prefix = "BV"
		start, end = 1, 8
		if direction == virtualIODirectionOutput {
			start, end = 9, 16
		}
	case virtualIOTypeMultistate:
		prefix = "MSV"
		start, end = 2, 8
	default:
		prefix = "AV"
		start, end = 1, 16
		if direction == virtualIODirectionOutput {
			start, end = 17, 32
		}
	}
	points := make([]string, 0, end-start+1)
	for i := start; i <= end; i++ {
		points = append(points, fmt.Sprintf("%s%d", prefix, i))
	}
	return points
}

func nextVirtualIOID(items []VirtualIOPoint, direction string) string {
	prefix := "VI"
	if direction == virtualIODirectionOutput {
		prefix = "VO"
	}
	maxChannel := 0
	for _, item := range items {
		itemPrefix, channel, ok := parsePointID(item.ID)
		if ok && itemPrefix == prefix && channel > maxChannel {
			maxChannel = channel
		}
	}
	return fmt.Sprintf("%s-%02d", prefix, maxChannel+1)
}

func virtualIOIndex(items []VirtualIOPoint, id string) int {
	for i, item := range items {
		if normalizeVirtualIOID(item.ID) == id {
			return i
		}
	}
	return -1
}

func virtualIONumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		n, err := typed.Float64()
		return n, err == nil
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	default:
		return 0, false
	}
}
