package main

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
	now := time.Now().UTC().Unix()
	samples, err := a.trends.Query(r.Context(), pointIDs, now-rangeSeconds, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, wideTrendSamples(samples))
}

func (a *App) handleGetTrendConfig(w http.ResponseWriter, r *http.Request) {
	if a.trends == nil {
		writeError(w, http.StatusServiceUnavailable, "trend store unavailable")
		return
	}
	cfg, err := a.trends.GetConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (a *App) handlePutTrendConfig(w http.ResponseWriter, r *http.Request) {
	if a.trends == nil {
		writeError(w, http.StatusServiceUnavailable, "trend store unavailable")
		return
	}
	cfg, err := decodeTrendConfig(w, r)
	if err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if errs := validateTrendConfig(cfg); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	saved, err := a.trends.SaveConfig(r.Context(), cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a.sampler != nil {
		a.sampler.UpdateConfig(saved)
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "trends.config", "trend.sqlite", "applied", r.RemoteAddr)
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "applied", Applied: true, Reload: reloadNone, Warnings: []string{}})
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

func validateTrendConfig(cfg TrendConfig) []configValidationError {
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
	case "30m":
		return int64((30 * time.Minute).Seconds()), nil
	case "1h":
		return int64(time.Hour.Seconds()), nil
	case "6h":
		return int64((6 * time.Hour).Seconds()), nil
	case "24h":
		return int64((24 * time.Hour).Seconds()), nil
	default:
		return 0, fmt.Errorf("range must be one of 30m, 1h, 6h, 24h")
	}
}

func wideTrendSamples(samples []Sample) []TrendSample {
	if len(samples) == 0 {
		return []TrendSample{}
	}
	byTS := make(map[int64]TrendSample)
	keys := make([]int64, 0)
	for _, sample := range samples {
		row, ok := byTS[sample.TS]
		if !ok {
			row = TrendSample{"time": time.Unix(sample.TS, 0).UTC().Format(time.RFC3339)}
			byTS[sample.TS] = row
			keys = append(keys, sample.TS)
		}
		row[sample.PointID] = sample.Value
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	out := make([]TrendSample, 0, len(keys))
	for _, ts := range keys {
		out = append(out, byTS[ts])
	}
	return out
}
