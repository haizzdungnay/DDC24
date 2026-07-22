package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

type historianHTTPQueryStub struct {
	result HistorianQueryResult
	err    error
	got    HistorianQueryRequest
}

func (s *historianHTTPQueryStub) Query(_ context.Context, req HistorianQueryRequest) (HistorianQueryResult, error) {
	s.got = req
	return s.result, s.err
}

func TestParseHistorianHistoryRequest(t *testing.T) {
	q, err := parseHistorianHistoryRequest(map[string][]string{
		"point":      {"AI-1,AI-2", "AO-3"},
		"from":       {"2026-01-01T00:00:00Z"},
		"to":         {"2026-01-01T00:01:00Z"},
		"resolution": {"15s"},
		"maxPoints":  {"123"},
		"source":     {"cache"},
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if want := []string{"AI-1", "AI-2", "AO-3"}; !reflect.DeepEqual(q.PointIDs, want) {
		t.Fatalf("points=%v want %v", q.PointIDs, want)
	}
	if q.FromUTCMS != 1767225600000 || q.ToUTCMS != 1767225660000 || q.Resolution != "15s" || q.MaxPoints != 123 || q.Source != "cache" {
		t.Fatalf("request=%+v", q)
	}
}

func TestParseHistorianHistoryRequestRejectsInvalidBounds(t *testing.T) {
	cases := []struct {
		name string
		q    map[string][]string
	}{
		{"missing from", map[string][]string{"point": {"AI-1"}, "to": {"2026-01-01T00:01:00Z"}}},
		{"non utc", map[string][]string{"point": {"AI-1"}, "from": {"2026-01-01T00:00:00+07:00"}, "to": {"2026-01-01T00:01:00Z"}}},
		{"reversed", map[string][]string{"point": {"AI-1"}, "from": {"2026-01-01T00:01:00Z"}, "to": {"2026-01-01T00:00:00Z"}}},
		{"nine points", map[string][]string{"point": {"1,2,3,4,5,6,7,8,9"}, "from": {"2026-01-01T00:00:00Z"}, "to": {"2026-01-01T00:01:00Z"}}},
		{"resolution", map[string][]string{"point": {"AI-1"}, "from": {"2026-01-01T00:00:00Z"}, "to": {"2026-01-01T00:01:00Z"}, "resolution": {"2m"}}},
		{"max points", map[string][]string{"point": {"AI-1"}, "from": {"2026-01-01T00:00:00Z"}, "to": {"2026-01-01T00:01:00Z"}, "maxPoints": {"5001"}}},
		{"source", map[string][]string{"point": {"AI-1"}, "from": {"2026-01-01T00:00:00Z"}, "to": {"2026-01-01T00:01:00Z"}, "source": {"memory"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parseHistorianHistoryRequest(tc.q); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func sampleHistorianHTTPResult() HistorianQueryResult {
	return HistorianQueryResult{
		FromUTCMS: 1000, ToUTCMS: 4000, Resolution: "1s", Complete: false,
		TiersUsed: []HistorianTier{"ram", "hot"},
		Gaps:      []HistorianQueryGap{{PointID: "AI,1", Generation: 2, FromUTCMS: 2000, ToUTCMS: 3000, Reason: "storage", Detail: "offline"}},
		Series: []HistorianQuerySeries{{PointID: "AI,1", Generation: 2, EffectiveResolution: "1s", Samples: []HistorianQuerySample{
			{TimeUTCMS: 1000, Value: 1.5, Min: 1.5, Max: 1.5, Sum: 1.5, Count: 1, Quality: "GOOD", Source: "sensor,primary", Tier: HistorianTier("ram"), Generation: 2},
			{TimeUTCMS: 3000, Value: 2.5, Min: 2, Max: 3, Sum: 5, Count: 2, Quality: "UNCERTAIN", Source: "sensor", Tier: HistorianTier("hot"), Generation: 2},
		}}},
	}
}

func TestHistorianHistoryHTTPJSONAndPartialMetadata(t *testing.T) {
	stub := &historianHTTPQueryStub{result: sampleHistorianHTTPResult()}
	h := NewHistorianHistoryHTTPHandler(stub, nil)
	r := httptest.NewRequest(http.MethodGet, "/history?point=AI-1&from=1970-01-01T00:00:01Z&to=1970-01-01T00:00:04Z&resolution=1s", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got HistoryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("json: %v", err)
	}
	if got.Complete || len(got.Gaps) != 1 || len(got.Series) != 1 {
		t.Fatalf("response=%+v", got)
	}
	if stub.got.FromUTCMS != 1000 || stub.got.ToUTCMS != 4000 || len(stub.got.PointIDs) != 1 {
		t.Fatalf("query=%+v", stub.got)
	}
}

func TestHistorianHistoryHTTPCSVJSONParity(t *testing.T) {
	stub := &historianHTTPQueryStub{result: sampleHistorianHTTPResult()}
	h := NewHistorianHistoryHTTPHandler(stub, nil)
	base := "?point=AI-1&from=1970-01-01T00:00:01Z&to=1970-01-01T00:00:04Z&resolution=1s"
	jsonReq := httptest.NewRequest(http.MethodGet, "/history"+base, nil)
	jsonW := httptest.NewRecorder()
	h.ServeHTTP(jsonW, jsonReq)
	var response HistoryResponse
	if err := json.Unmarshal(jsonW.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	csvReq := httptest.NewRequest(http.MethodGet, "/history"+base+"&format=csv", nil)
	csvW := httptest.NewRecorder()
	h.ServeHTTP(csvW, csvReq)
	if csvW.Code != http.StatusOK || !strings.HasPrefix(csvW.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("csv status=%d headers=%v", csvW.Code, csvW.Header())
	}
	reader := csv.NewReader(strings.NewReader(csvW.Body.String()))
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 5 || rows[0][0] != "# metadata" || rows[1][0] != "# gap" || rows[2][0] != "pointId" || rows[3][0] != "AI,1" || rows[3][9] != "sensor,primary" {
		t.Fatalf("csv rows=%v", rows)
	}
	if rows[4][0] != response.Series[0].PointID || rows[4][1] != "2" || rows[3][8] != "GOOD" {
		t.Fatalf("csv/json mismatch rows=%v response=%+v", rows, response)
	}
}

func TestHistorianHistoryHTTPErrorMappingAndRBACHook(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"budget", &HistorianQueryError{Code: "output_budget_exceeded", Message: "too many samples"}, http.StatusRequestEntityTooLarge},
		{"unavailable", &HistorianQueryError{Code: "historian_unavailable", Message: "offline"}, http.StatusServiceUnavailable},
		{"generic", errors.New("disk failure"), http.StatusServiceUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &historianHTTPQueryStub{err: tc.err}
			called := false
			h := NewHistorianHistoryHTTPHandler(stub, func(next http.HandlerFunc) http.Handler {
				called = true
				return http.HandlerFunc(next)
			})
			r := httptest.NewRequest(http.MethodGet, "/history?point=AI-1&from=1970-01-01T00:00:01Z&to=1970-01-01T00:00:04Z", nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want || !called {
				t.Fatalf("status=%d hook=%v body=%s", w.Code, called, w.Body.String())
			}
		})
	}
}

func TestHistorianHistoryHTTPRejectsOversizedQuery(t *testing.T) {
	stub := &historianHTTPQueryStub{result: sampleHistorianHTTPResult()}
	h := NewHistorianHistoryHTTPHandler(stub, nil)
	r := httptest.NewRequest(http.MethodGet, "/history?point=AI-1&from=1970-01-01T00:00:01Z&to=1970-01-01T00:00:04Z&maxPoints=5001", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
