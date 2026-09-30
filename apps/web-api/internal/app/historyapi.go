package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (a *App) handleHistory(w http.ResponseWriter, r *http.Request) {
	if a.trends == nil {
		writeError(w, http.StatusServiceUnavailable, "trend store unavailable")
		return
	}
	pointIDs, err := parsePointQuery(r.URL.Query().Get("point"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rangeSeconds, err := parseHistoryRange(r.URL.Query().Get("range"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	pointIDs = a.visibleHistoryPointIDs(pointIDs)
	if len(pointIDs) == 0 {
		writeJSON(w, http.StatusOK, []TrendSample{})
		return
	}
	now := time.Now().UTC().UnixMilli()
	from := now - rangeSeconds*1000
	samples, err := a.trends.Query(r.Context(), pointIDs, from, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	legacySamples, err := a.trends.Query(r.Context(), pointIDs, now/1000-rangeSeconds, now/1000)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, sample := range legacySamples {
		if sample.TS > 0 && sample.TS < 1_000_000_000_000 {
			sample.TS *= 1000
			samples = append(samples, sample)
		}
	}
	samples = append(samples, a.virtualPointRing.Query(pointIDs, from, now)...)
	writeJSON(w, http.StatusOK, wideTrendSamples(samples))
}

func (a *App) visibleHistoryPointIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		canonical := canonicalHistoryPointID(id)
		if prefix, _, ok := parsePointID(canonical); ok && (virtualPointIDPrefix(prefix) || prefix == "BV" || prefix == "MSV") {
			if !virtualPointIDPrefix(prefix) {
				continue
			}
			item, ok := a.findVirtualPoint(canonical)
			if !ok || !virtualPointTrendVisible(item) {
				continue
			}
			canonical = item.ID
		}
		if _, ok := seen[canonical]; ok {
			continue
		}
		seen[canonical] = struct{}{}
		out = append(out, canonical)
	}
	return out
}

func (a *App) handleGetTrendConfig(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()
	if a.historian == nil {
		writeError(w, http.StatusServiceUnavailable, "historian policy unavailable")
		return
	}
	cfg, err := a.historian.Get()
	if err != nil {
		writeError(w, historianErrorStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (a *App) handlePutTrendConfig(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()
	if a.historian == nil {
		writeError(w, http.StatusServiceUnavailable, "historian policy unavailable")
		return
	}
	update, err := decodeHistorianConfigUpdate(w, r)
	if err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	saved, err := a.historian.Update(update)
	if err != nil {
		if policyErr, ok := err.(historianPolicyError); ok {
			writeJSON(w, policyErr.status, map[string]any{"error": policyErr.msg, "code": policyErr.status, "request_id": requestID(), "details": []configValidationError{{Path: "$", Reason: policyErr.reason, Message: policyErr.msg}}})
		} else {
			writeError(w, historianErrorStatus(err), err.Error())
		}
		return
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "trends.config", "historian.conf", "applied", r.RemoteAddr)
	writeJSON(w, http.StatusOK, saved)
}

func decodeHistorianConfigUpdate(w http.ResponseWriter, r *http.Request) (HistorianConfigUpdate, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	var raw struct {
		BaseRevision          *uint64 `json:"baseRevision"`
		BaseNamespaceRevision *uint64 `json:"baseNamespaceRevision"`
		Points                *[]struct {
			PointID          *string `json:"pointId"`
			Generation       *uint64 `json:"generation"`
			DBLoggingEnabled *bool   `json:"dbLoggingEnabled"`
			DBInterval       string  `json:"dbInterval"`
			RetentionDays    *int    `json:"retentionDays"`
			StartAtUTC       *string `json:"startAtUtc"`
		} `json:"points"`
	}
	if err := dec.Decode(&raw); err != nil {
		return HistorianConfigUpdate{}, fmt.Errorf("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return HistorianConfigUpdate{}, fmt.Errorf("invalid json")
	}
	if raw.BaseRevision == nil || raw.BaseNamespaceRevision == nil || raw.Points == nil {
		return HistorianConfigUpdate{}, fmt.Errorf("baseRevision, baseNamespaceRevision, and points are required")
	}
	update := HistorianConfigUpdate{BaseRevision: *raw.BaseRevision, BaseNamespaceRevision: *raw.BaseNamespaceRevision, Points: make([]HistorianPolicyPatch, len(*raw.Points))}
	for i, point := range *raw.Points {
		if point.PointID == nil || point.Generation == nil || point.DBLoggingEnabled == nil {
			return HistorianConfigUpdate{}, fmt.Errorf("points[%d] requires pointId, generation, and dbLoggingEnabled", i)
		}
		patch := HistorianPolicyPatch{PointID: *point.PointID, Generation: *point.Generation, DBLoggingEnabled: *point.DBLoggingEnabled, DBInterval: point.DBInterval, StartAtUTC: point.StartAtUTC}
		if point.RetentionDays != nil {
			patch.RetentionDays = *point.RetentionDays
			patch.retentionDaysSet = true
		}
		update.Points[i] = patch
	}
	return update, nil
}

func decodeTrendConfig(w http.ResponseWriter, r *http.Request) (TrendConfig, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	cfg := defaultTrendConfig()
	if err := dec.Decode(&cfg); err != nil {
		return TrendConfig{}, fmt.Errorf("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return TrendConfig{}, fmt.Errorf("invalid json")
	}
	return cfg, nil
}

func (a *App) validateTrendConfig(cfg TrendConfig) []configValidationError {
	var errs []configValidationError
	if cfg.IntervalS < 10 || cfg.IntervalS > 300 {
		addConfigErr(&errs, "intervalS", "must be integer in range 10..300")
	}
	if cfg.RetentionRecords < 1000 {
		addConfigErr(&errs, "retentionRecords", "must be at least 1000")
	}
	for i, id := range cfg.PointIDs {
		if strings.TrimSpace(id) == "" {
			addConfigErr(&errs, fmt.Sprintf("pointIds[%d]", i), "must not be empty")
			continue
		}
		canonical := canonicalHistoryPointID(id)
		if prefix, _, ok := parsePointID(canonical); ok && (virtualPointIDPrefix(prefix) || prefix == "BV" || prefix == "MSV") {
			if !virtualPointIDPrefix(prefix) {
				addConfigErr(&errs, fmt.Sprintf("pointIds[%d]", i), "must not reference raw BV/MSV virtual slots")
				continue
			}
			item, ok := a.findVirtualPoint(canonical)
			if !ok || !virtualPointTrendVisible(item) {
				addConfigErr(&errs, fmt.Sprintf("pointIds[%d]", i), "must reference a created logged numeric Virtual Point")
			}
		}
	}
	return errs
}

func parsePointQuery(raw string) ([]string, error) {
	ids := normalizePointIDs(strings.Split(raw, ","))
	if len(ids) == 0 {
		return nil, fmt.Errorf("point is required")
	}
	return ids, nil
}

func parseHistoryRange(raw string) (int64, error) {
	switch raw {
	case "5m":
		return int64((5 * time.Minute).Seconds()), nil
	case "15m":
		return int64((15 * time.Minute).Seconds()), nil
	case "30m":
		return int64((30 * time.Minute).Seconds()), nil
	case "1h":
		return int64(time.Hour.Seconds()), nil
	case "6h":
		return int64((6 * time.Hour).Seconds()), nil
	case "24h":
		return int64((24 * time.Hour).Seconds()), nil
	default:
		return 0, fmt.Errorf("range must be one of 5m, 15m, 30m, 1h, 6h, 24h")
	}
}

func wideTrendSamples(samples []Sample) []TrendSample {
	return wideTrendSamplesWithOverlay(samples, nil)
}

// wideTrendSamplesWithOverlay pivots row-per-point samples into wide-format
// TrendSample maps. overlay is kept for legacy tests and should be nil in
// current VP-only virtual point flows.
func wideTrendSamplesWithOverlay(samples []Sample, overlay map[string]string) []TrendSample {
	if len(samples) == 0 {
		return []TrendSample{}
	}
	byTS := make(map[int64]TrendSample)
	keys := make([]int64, 0)
	for _, sample := range samples {
		row, ok := byTS[sample.TS]
		if !ok {
			row = TrendSample{"time": time.UnixMilli(sample.TS).UTC().Format(time.RFC3339Nano)}
			byTS[sample.TS] = row
			keys = append(keys, sample.TS)
		}
		key := canonicalHistoryPointID(sample.PointID)
		if alias, ok2 := overlay[key]; ok2 {
			key = alias
		}
		row[key] = sample.Value
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	out := make([]TrendSample, 0, len(keys))
	for _, ts := range keys {
		out = append(out, byTS[ts])
	}
	return out
}

func canonicalHistoryPointID(id string) string {
	if channel, ok := virtualPointChannel(id); ok {
		return fmt.Sprintf("VP%d", channel)
	}
	return canonicalPointID(id)
}
