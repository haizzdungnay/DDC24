package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"error":      message,
		"code":       status,
		"request_id": requestID(),
	})
}

func requestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("150405.000000")))
	}
	return hex.EncodeToString(b[:])
}

func recoverMiddleware(logger *log.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Printf("ERROR panic method=%s path=%s err=%v", r.Method, r.URL.Path, rec)
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(logger *log.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		logger.Printf("INFO http method=%s path=%s status=%d dur_ms=%d remote=%s",
			r.Method, r.URL.Path, rec.status, time.Since(start).Milliseconds(), r.RemoteAddr)
	})
}

func corsMiddleware(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin, allowedOrigin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isAllowedOrigin(origin, configured string) bool {
	if origin == "" {
		return false
	}
	if configured != "" {
		for _, item := range strings.Split(configured, ",") {
			if strings.TrimSpace(item) == origin {
				return true
			}
		}
		return false
	}
	return strings.HasPrefix(origin, "http://localhost:") ||
		strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasPrefix(origin, "http://[::1]:")
}

func (a *App) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/login", a.handleLogin)
	mux.Handle("POST /api/v1/auth/logout", a.auth.Require(RoleViewer, a.handleLogout))
	mux.Handle("GET /api/v1/system/status", a.auth.Require(RoleViewer, a.handleSystemStatus))
	mux.Handle("GET /api/v1/network", a.auth.Require(RoleViewer, a.handleGetNetworkPage))
	mux.Handle("PUT /api/v1/network", a.auth.Require(RoleAdmin, a.handlePutNetworkPage))
	mux.Handle("GET /api/v1/points", a.auth.Require(RoleViewer, a.handlePoints))
	mux.Handle("GET /api/v1/points/{id}", a.auth.Require(RoleViewer, a.handlePoint))
	mux.Handle("PUT /api/v1/points/{id}", a.auth.Require(RoleOperator, a.handleForcePoint))
	mux.Handle("GET /api/v1/virtual-io", a.auth.Require(RoleViewer, a.handleListVirtualIO))
	mux.Handle("POST /api/v1/virtual-io", a.auth.Require(RoleAdmin, a.handleCreateVirtualIO))
	mux.Handle("PUT /api/v1/virtual-io/{id}", a.auth.Require(RoleAdmin, a.handleUpdateVirtualIO))
	mux.Handle("DELETE /api/v1/virtual-io/{id}", a.auth.Require(RoleAdmin, a.handleDeleteVirtualIO))
	mux.Handle("GET /api/v1/ws/monitor", a.requireWSAuth(a.handleMonitorWS))
	mux.Handle("GET /api/v1/alarms", a.auth.Require(RoleViewer, a.handleAlarms))
	mux.Handle("GET /api/v1/alarm-history", a.auth.Require(RoleViewer, a.handleAlarmHistory))
	mux.Handle("POST /api/v1/alarms/{id}/ack", a.auth.Require(RoleOperator, a.handleAckAlarm))
	mux.Handle("POST /api/v1/alarms/{id}/suppress", a.auth.Require(RoleOperator, a.handleSuppressAlarm))
	mux.Handle("POST /api/v1/alarms/{id}/return", a.auth.Require(RoleOperator, a.handleReturnAlarm))
	mux.Handle("POST /api/v1/commissioning/points/{id}/test", a.auth.Require(RoleOperator, a.handleCommissionTest))
	mux.Handle("GET /api/v1/system/config", a.auth.Require(RoleAdmin, a.handleGetSystemConfig))
	mux.Handle("PUT /api/v1/system/config", a.auth.Require(RoleAdmin, a.handlePutSystemConfig))
	mux.Handle("GET /api/v1/system/config/device", a.auth.Require(RoleAdmin, a.handleGetConfigDevice))
	mux.Handle("PUT /api/v1/system/config/device", a.auth.Require(RoleAdmin, a.handlePutConfigDevice))
	mux.Handle("GET /api/v1/system/config/network", a.auth.Require(RoleAdmin, a.handleGetConfigNetwork))
	mux.Handle("PUT /api/v1/system/config/network", a.auth.Require(RoleAdmin, a.handlePutConfigNetwork))
	mux.Handle("GET /api/v1/system/config/io", a.auth.Require(RoleAdmin, a.handleGetConfigIO))
	mux.Handle("PUT /api/v1/system/config/io", a.auth.Require(RoleAdmin, a.handlePutConfigIO))
	mux.Handle("GET /api/v1/system/config/safe-state", a.auth.Require(RoleAdmin, a.handleGetConfigSafeState))
	mux.Handle("PUT /api/v1/system/config/safe-state", a.auth.Require(RoleAdmin, a.handlePutConfigSafeState))
	mux.Handle("GET /api/v1/system/config/virtual-io", a.auth.Require(RoleAdmin, a.handleGetConfigVirtualIO))
	mux.Handle("PUT /api/v1/system/config/virtual-io", a.auth.Require(RoleAdmin, a.handlePutConfigVirtualIO))
	mux.Handle("GET /api/v1/system/config/bacnet", a.auth.Require(RoleAdmin, a.handleGetConfigBacnet))
	mux.Handle("PUT /api/v1/system/config/bacnet", a.auth.Require(RoleAdmin, a.handlePutConfigBacnet))
	mux.Handle("GET /api/v1/system/config/fieldbus", a.auth.Require(RoleAdmin, a.handleGetConfigFieldbus))
	mux.Handle("PUT /api/v1/system/config/fieldbus", a.auth.Require(RoleAdmin, a.handlePutConfigFieldbus))
	mux.Handle("GET /api/v1/system/config/time", a.auth.Require(RoleAdmin, a.handleGetConfigTime))
	mux.Handle("PUT /api/v1/system/config/time", a.auth.Require(RoleAdmin, a.handlePutConfigTime))
	mux.Handle("GET /api/v1/users", a.auth.Require(RoleAdmin, a.handleListUsers))
	mux.Handle("POST /api/v1/users", a.auth.Require(RoleAdmin, a.handleCreateUser))
	mux.Handle("PUT /api/v1/users/{username}", a.auth.Require(RoleAdmin, a.handleUpdateUser))
	mux.Handle("DELETE /api/v1/users/{username}", a.auth.Require(RoleAdmin, a.handleDeleteUser))
	mux.Handle("POST /api/v1/users/{username}/reset-password", a.auth.Require(RoleAdmin, a.handleResetPassword))
	mux.Handle("GET /api/v1/me", a.auth.Require(RoleViewer, a.handleGetMe))
	mux.Handle("POST /api/v1/me/change-password", a.auth.Require(RoleViewer, a.handleChangePassword))
	mux.Handle("GET /api/v1/history", a.auth.Require(RoleViewer, a.handleHistory))
	mux.Handle("GET /api/v1/trends/config", a.auth.Require(RoleAdmin, a.handleGetTrendConfig))
	mux.Handle("PUT /api/v1/trends/config", a.auth.Require(RoleAdmin, a.handlePutTrendConfig))
	mux.Handle("GET /api/v1/schedules", a.auth.Require(RoleViewer, a.handleGetSchedules))
	mux.Handle("PUT /api/v1/schedules", a.auth.Require(RoleAdmin, a.handlePutSchedules))
	mux.Handle("GET /api/v1/alarm-settings", a.auth.Require(RoleViewer, a.handleGetAlarmSettings))
	mux.Handle("PUT /api/v1/alarm-settings", a.auth.Require(RoleAdmin, a.handlePutAlarmSettings))
	mux.HandleFunc("/", a.handleStatic)

	var handler http.Handler = mux
	handler = corsMiddleware(a.cfg.CORSOrigin, handler)
	handler = recoverMiddleware(a.logger, handler)
	handler = loggingMiddleware(a.logger, handler)
	return handler
}

func (a *App) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.NotFound(w, r)
		return
	}
	dir := strings.TrimSpace(a.cfg.StaticDir)
	if dir == "" {
		http.NotFound(w, r)
		return
	}
	index := filepath.Join(dir, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.NotFound(w, r)
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	name := strings.TrimPrefix(clean, "/")
	if name == "" {
		name = "index.html"
	}
	target := filepath.Join(dir, filepath.FromSlash(name))
	if info, err := os.Stat(target); err == nil && !info.IsDir() {
		http.ServeFile(w, r, target)
		return
	}
	http.ServeFile(w, r, index)
}
