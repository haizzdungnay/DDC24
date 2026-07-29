package main

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	historianHistoryMaxPointsDefault = 5000
	historianHistoryMaxPointsCap     = 5000
)

// HistorianHistoryQueryer is deliberately small so the endpoint can be wrapped
// by the existing RBAC middleware without coupling it to App or the router.
type HistorianHistoryQueryer interface {
	Query(context.Context, HistorianQueryRequest) (HistorianQueryResult, error)
}

// HistoryResponse is the OpenAPI wire representation of a unified query.
type HistoryResponse struct {
	From      string                   `json:"from"`
	To        string                   `json:"to"`
	Complete  bool                     `json:"complete"`
	Series    []HistorianHistorySeries `json:"series"`
	Gaps      []HistorianHistoryGap    `json:"gaps"`
	TiersUsed []HistorianTier          `json:"tiersUsed"`
}

type HistorianHistorySeries struct {
	PointID             string                   `json:"pointId"`
	Generation          uint64                   `json:"generation"`
	EffectiveResolution string                   `json:"effectiveResolution"`
	Samples             []HistorianHistorySample `json:"samples"`
}

type HistorianHistorySample struct {
	Time       string        `json:"time"`
	Value      float64       `json:"value"`
	Min        float64       `json:"min"`
	Max        float64       `json:"max"`
	Sum        float64       `json:"sum"`
	Count      int           `json:"count"`
	Quality    string        `json:"quality"`
	Source     string        `json:"source"`
	Tier       HistorianTier `json:"tier"`
	Generation uint64        `json:"generation"`
}

type HistorianHistoryGap struct {
	PointID    string `json:"pointId"`
	Generation uint64 `json:"generation"`
	FromUTC    string `json:"fromUtc"`
	ToUTC      string `json:"toUtc"`
	Reason     string `json:"reason"`
	Detail     string `json:"detail,omitempty"`
}

type historianHistoryHTTPRequest struct {
	HistorianQueryRequest
	Format string
}

// NewHistorianHistoryHTTPHandler creates the unified /history endpoint. The
// optional middleware hook is intended for a.auth.RequirePermission(PermissionRead, ...).
func NewHistorianHistoryHTTPHandler(query HistorianHistoryQueryer, middleware func(http.HandlerFunc) http.Handler) http.Handler {
	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveHistorianHistory(w, r, query)
	})
	if middleware != nil {
		return middleware(base)
	}
	return base
}

func serveHistorianHistory(w http.ResponseWriter, r *http.Request, query HistorianHistoryQueryer) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if query == nil {
		writeError(w, http.StatusServiceUnavailable, "historian unavailable")
		return
	}
	request, err := parseHistorianHistoryHTTPRequest(r.URL.Query(), r.Header.Get("Accept"))
	if err != nil {
		writeError(w, historianHistoryParseStatus(err), err.Error())
		return
	}
	result, err := query.Query(r.Context(), request.HistorianQueryRequest)
	if err != nil {
		writeError(w, historianHistoryQueryStatus(err), err.Error())
		return
	}
	if strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/export.csv") {
		request.Format = "csv"
	}
	response := materializeHistorianHistoryResponse(result)
	w.Header().Set("X-History-Partial", strconv.FormatBool(!response.Complete))
	w.Header().Set("X-History-Gaps", strconv.Itoa(len(response.Gaps)))
	if request.Format == "csv" {
		writeHistorianHistoryCSV(w, result)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func parseHistorianHistoryRequest(values url.Values) (HistorianQueryRequest, error) {
	request, err := parseHistorianHistoryHTTPRequest(values, "")
	return request.HistorianQueryRequest, err
}

func parseHistorianHistoryHTTPRequest(values url.Values, accept string) (historianHistoryHTTPRequest, error) {
	points := make([]string, 0, 8)
	for _, raw := range values["point"] {
		for _, item := range strings.Split(raw, ",") {
			item = strings.TrimSpace(item)
			if item != "" {
				points = append(points, item)
			}
		}
	}
	if len(points) == 0 {
		return historianHistoryHTTPRequest{}, fmt.Errorf("point is required")
	}
	if len(points) > 8 {
		return historianHistoryHTTPRequest{}, fmt.Errorf("point supports at most 8 points")
	}
	from, err := parseHistorianUTC(values.Get("from"), "from")
	if err != nil {
		return historianHistoryHTTPRequest{}, err
	}
	to, err := parseHistorianUTC(values.Get("to"), "to")
	if err != nil {
		return historianHistoryHTTPRequest{}, err
	}
	if from >= to {
		return historianHistoryHTTPRequest{}, fmt.Errorf("from must be before to")
	}
	resolution, err := parseHistorianResolution(values.Get("resolution"))
	if err != nil {
		return historianHistoryHTTPRequest{}, err
	}
	source := strings.ToLower(strings.TrimSpace(values.Get("source")))
	if source != "" && source != "cache" && source != "database" {
		return historianHistoryHTTPRequest{}, fmt.Errorf("source must be cache or database")
	}
	maxPoints := historianHistoryMaxPointsDefault
	if raw := strings.TrimSpace(values.Get("maxPoints")); raw != "" {
		maxPoints, err = strconv.Atoi(raw)
		if err != nil || maxPoints <= 0 {
			return historianHistoryHTTPRequest{}, fmt.Errorf("maxPoints must be a positive integer")
		}
		if maxPoints > historianHistoryMaxPointsCap {
			return historianHistoryHTTPRequest{}, fmt.Errorf("maxPoints must be in 1..%d", historianHistoryMaxPointsCap)
		}
	}
	format := strings.ToLower(strings.TrimSpace(values.Get("format")))
	if format == "" && strings.Contains(strings.ToLower(accept), "text/csv") {
		format = "csv"
	}
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "csv" {
		return historianHistoryHTTPRequest{}, fmt.Errorf("format must be json or csv")
	}
	return historianHistoryHTTPRequest{HistorianQueryRequest: HistorianQueryRequest{PointIDs: points, FromUTCMS: from, ToUTCMS: to, Resolution: resolution, MaxPoints: maxPoints, Source: source}, Format: format}, nil
}

func parseHistorianUTC(raw, name string) (int64, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, fmt.Errorf("%s is required as an RFC3339 UTC timestamp", name)
	}
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an RFC3339 UTC timestamp", name)
	}
	_, offset := t.Zone()
	if offset != 0 {
		return 0, fmt.Errorf("%s must use UTC", name)
	}
	return t.UnixMilli(), nil
}

func parseHistorianResolution(raw string) (string, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return "auto", nil
	}
	allowed := map[string]struct{}{"auto": {}, "1s": {}, "3s": {}, "5s": {}, "15s": {}, "30s": {}, "1m": {}, "3m": {}, "5m": {}, "15m": {}, "30m": {}, "60m": {}}
	if _, ok := allowed[raw]; !ok {
		return "", fmt.Errorf("resolution must be auto or one of 1s, 3s, 5s, 15s, 30s, 1m, 3m, 5m, 15m, 30m, 60m")
	}
	return raw, nil
}

func historianHistoryParseStatus(err error) int {
	return http.StatusBadRequest
}

func historianHistoryQueryStatus(err error) int {
	var queryErr *HistorianQueryError
	if errors.As(err, &queryErr) {
		switch queryErr.Code {
		case "output_budget_exceeded":
			return http.StatusRequestEntityTooLarge
		case "invalid_request", "resolution_unavailable":
			return http.StatusBadRequest
		case "historian_unavailable":
			return http.StatusServiceUnavailable
		}
	}
	return http.StatusServiceUnavailable
}

func materializeHistorianHistoryResponse(result HistorianQueryResult) HistoryResponse {
	response := HistoryResponse{From: formatHistorianUTC(result.FromUTCMS), To: formatHistorianUTC(result.ToUTCMS), Complete: result.Complete, TiersUsed: append([]HistorianTier(nil), result.TiersUsed...)}
	if response.TiersUsed == nil {
		response.TiersUsed = []HistorianTier{}
	}
	response.Series = make([]HistorianHistorySeries, len(result.Series))
	for i := range result.Series {
		series := result.Series[i]
		response.Series[i] = HistorianHistorySeries{PointID: series.PointID, Generation: series.Generation, EffectiveResolution: series.EffectiveResolution, Samples: []HistorianHistorySample{}}
	}
	it := newHistorianHistoryIterator(result)
	for it.Next() {
		row := it.Row()
		switch row.Kind {
		case historianHistoryGapRow:
			response.Gaps = append(response.Gaps, wireHistorianHistoryGap(row.Gap))
		case historianHistorySampleRow:
			response.Series[row.SeriesIndex].Samples = append(response.Series[row.SeriesIndex].Samples, wireHistorianHistorySample(row.Sample))
		}
	}
	if response.Gaps == nil {
		response.Gaps = []HistorianHistoryGap{}
	}
	return response
}

type historianHistoryRowKind uint8

const (
	historianHistoryMetadataRow historianHistoryRowKind = iota
	historianHistoryGapRow
	historianHistorySampleRow
)

type historianHistoryRow struct {
	Kind        historianHistoryRowKind
	SeriesIndex int
	PointID     string
	Generation  uint64
	Resolution  string
	Sample      HistorianQuerySample
	Gap         HistorianQueryGap
}

// historianHistoryIterator is shared by JSON materialization and CSV output.
type historianHistoryIterator struct {
	result HistorianQueryResult
	phase  historianHistoryRowKind
	gap    int
	series int
	sample int
	row    historianHistoryRow
}

func newHistorianHistoryIterator(result HistorianQueryResult) *historianHistoryIterator {
	return &historianHistoryIterator{result: result, phase: historianHistoryMetadataRow, series: -1}
}

func (it *historianHistoryIterator) Next() bool {
	if it.phase == historianHistoryMetadataRow {
		it.row = historianHistoryRow{Kind: historianHistoryMetadataRow}
		it.phase = historianHistoryGapRow
		return true
	}
	if it.phase == historianHistoryGapRow {
		if it.gap < len(it.result.Gaps) {
			it.row = historianHistoryRow{Kind: historianHistoryGapRow, Gap: it.result.Gaps[it.gap]}
			it.gap++
			return true
		}
		it.phase = historianHistorySampleRow
	}
	for it.series < len(it.result.Series) {
		if it.series >= 0 && it.sample < len(it.result.Series[it.series].Samples) {
			series := it.result.Series[it.series]
			it.row = historianHistoryRow{Kind: historianHistorySampleRow, SeriesIndex: it.series, PointID: series.PointID, Generation: series.Generation, Resolution: series.EffectiveResolution, Sample: series.Samples[it.sample]}
			it.sample++
			return true
		}
		it.series++
		it.sample = 0
	}
	return false
}

func (it *historianHistoryIterator) Row() historianHistoryRow { return it.row }

func writeHistorianHistoryCSV(w http.ResponseWriter, result HistorianQueryResult) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="history.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	writer.UseCRLF = true
	headerWritten := false
	it := newHistorianHistoryIterator(result)
	for it.Next() {
		row := it.Row()
		switch row.Kind {
		case historianHistoryMetadataRow:
			_ = writer.Write([]string{"# metadata", "from", formatHistorianUTC(result.FromUTCMS), "to", formatHistorianUTC(result.ToUTCMS), "complete", strconv.FormatBool(result.Complete), "tiersUsed", joinHistorianTiers(result.TiersUsed)})
		case historianHistoryGapRow:
			gap := row.Gap
			_ = writer.Write([]string{"# gap", gap.PointID, strconv.FormatUint(gap.Generation, 10), formatHistorianUTC(gap.FromUTCMS), formatHistorianUTC(gap.ToUTCMS), gap.Reason, gap.Detail})
		case historianHistorySampleRow:
			if !headerWritten {
				_ = writer.Write([]string{"pointId", "generation", "time", "value", "min", "max", "sum", "count", "quality", "source", "tier"})
				headerWritten = true
			}
			sample := row.Sample
			_ = writer.Write([]string{row.PointID, strconv.FormatUint(row.Generation, 10), formatHistorianUTC(sample.TimeUTCMS), strconv.FormatFloat(sample.Value, 'g', -1, 64), strconv.FormatFloat(sample.Min, 'g', -1, 64), strconv.FormatFloat(sample.Max, 'g', -1, 64), strconv.FormatFloat(sample.Sum, 'g', -1, 64), strconv.Itoa(sample.Count), strings.ToUpper(sample.Quality), sample.Source, string(sample.Tier)})
		}
	}
	if !headerWritten {
		_ = writer.Write([]string{"pointId", "generation", "time", "value", "min", "max", "sum", "count", "quality", "source", "tier"})
	}
	writer.Flush()
}

func wireHistorianHistorySample(sample HistorianQuerySample) HistorianHistorySample {
	return HistorianHistorySample{Time: formatHistorianUTC(sample.TimeUTCMS), Value: sample.Value, Min: sample.Min, Max: sample.Max, Sum: sample.Sum, Count: sample.Count, Quality: strings.ToUpper(sample.Quality), Source: sample.Source, Tier: sample.Tier, Generation: sample.Generation}
}

func wireHistorianHistoryGap(gap HistorianQueryGap) HistorianHistoryGap {
	return HistorianHistoryGap{PointID: gap.PointID, Generation: gap.Generation, FromUTC: formatHistorianUTC(gap.FromUTCMS), ToUTC: formatHistorianUTC(gap.ToUTCMS), Reason: gap.Reason, Detail: gap.Detail}
}

func formatHistorianUTC(utcMS int64) string {
	return time.UnixMilli(utcMS).UTC().Format(time.RFC3339Nano)
}

func joinHistorianTiers(tiers []HistorianTier) string {
	values := make([]string, len(tiers))
	for i := range tiers {
		values[i] = string(tiers[i])
	}
	return strings.Join(values, "|")
}
