package app

import (
	"fmt"
	"net/http"
)

func (a *App) handleHistoryRoute(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if query.Get("from") == "" && query.Get("to") == "" && query.Get("range") != "" {
		a.handleHistory(w, r)
		return
	}
	a.handleUnifiedHistory(w, r)
}

func (a *App) handleHistoryExport(w http.ResponseWriter, r *http.Request) {
	a.handleUnifiedHistory(w, r)
}

func (a *App) handleUnifiedHistory(w http.ResponseWriter, r *http.Request) {
	engine, err := a.newHistorianQueryEngine()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	NewHistorianHistoryHTTPHandler(engine, nil).ServeHTTP(w, r)
}

func (a *App) newHistorianQueryEngine() (*HistorianQueryEngine, error) {
	if a == nil || a.historianV2 == nil || !a.historianV2Ready || !a.historianAuthority.QueryV2 {
		return nil, fmt.Errorf("historian v2 query unavailable")
	}
	a.historianShadowMu.RLock()
	shadow := a.historianShadow
	a.historianShadowMu.RUnlock()
	var ram *HistorianRAMCache
	if shadow != nil {
		ram = shadow.cache
	}
	backend, err := NewHistorianQueryStoreBackend(a.historianV2, ram, a.cfg.HistorianV2ArchiveDir)
	if err != nil {
		return nil, err
	}
	backend.trendCache = a.historianTrendCache
	return NewHistorianQueryEngine(backend), nil
}
