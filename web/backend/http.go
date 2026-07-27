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

type protectedRoute struct {
	pattern    string
	permission Permission
	handler    http.HandlerFunc
	websocket  bool
}

func (a *App) protectedRoutes() []protectedRoute {
	return []protectedRoute{
		{pattern: "POST /api/v1/auth/logout", permission: PermissionRead, handler: a.handleLogout},
		{pattern: "GET /api/v1/system/status", permission: PermissionRead, handler: a.handleSystemStatus},
		{pattern: "GET /api/v1/network", permission: PermissionRead, handler: a.handleGetNetworkPage},
		{pattern: "PUT /api/v1/network", permission: PermissionSettingsManage, handler: a.handlePutNetworkPage},
		{pattern: "GET /api/v1/network/transaction", permission: PermissionSettingsManage, handler: a.handleGetNetworkTransaction},
		{pattern: "POST /api/v1/network/transaction/{action}", permission: PermissionSettingsManage, handler: a.handlePostNetworkTransaction},
		{pattern: "GET /api/v1/points", permission: PermissionRead, handler: a.handlePoints},
		{pattern: "GET /api/v1/points/{id}", permission: PermissionRead, handler: a.handlePoint},
		{pattern: "PUT /api/v1/points/{id}", permission: PermissionOperate, handler: a.handleForcePoint},
		{pattern: "PUT /api/v1/points/{id}/config", permission: PermissionSettingsManage, handler: a.handlePutPointConfig},
		{pattern: "GET /api/v1/virtual-points", permission: PermissionRead, handler: a.handleListVirtualPoints},
		{pattern: "POST /api/v1/virtual-points", permission: PermissionSettingsManage, handler: a.handleCreateVirtualPoint},
		{pattern: "PUT /api/v1/virtual-points/{id}", permission: PermissionSettingsManage, handler: a.handleUpdateVirtualPoint},
		{pattern: "DELETE /api/v1/virtual-points/{id}", permission: PermissionSettingsManage, handler: a.handleDeleteVirtualPoint},
		{pattern: "GET /api/v1/ws/monitor", permission: PermissionRead, handler: a.handleMonitorWS, websocket: true},
		{pattern: "GET /api/v1/alarms", permission: PermissionRead, handler: a.handleAlarms},
		{pattern: "GET /api/v1/alarm-history", permission: PermissionRead, handler: a.handleAlarmHistory},
		{pattern: "POST /api/v1/alarms/{id}/ack", permission: PermissionOperate, handler: a.handleAckAlarm},
		{pattern: "POST /api/v1/alarms/{id}/suppress", permission: PermissionOperate, handler: a.handleSuppressAlarm},
		{pattern: "POST /api/v1/alarms/{id}/return", permission: PermissionOperate, handler: a.handleReturnAlarm},
		{pattern: "POST /api/v1/commissioning/points/{id}/test", permission: PermissionOperate, handler: a.handleCommissionTest},
		{pattern: "GET /api/v1/bacnet/objects", permission: PermissionRead, handler: a.handleUnavailableFeature("bacnet.objects")},
		{pattern: "POST /api/v1/graph/validate", permission: PermissionProgramEdit, handler: a.handleUnavailableFeature("graph.validate")},
		{pattern: "POST /api/v1/graph/deploy", permission: PermissionProgramActivate, handler: a.handleUnavailableFeature("graph.deploy")},
		{pattern: "POST /api/v1/ota/upload", permission: PermissionSystemRelease, handler: a.handleUnavailableFeature("ota.upload")},
		{pattern: "POST /api/v1/ota/apply", permission: PermissionSystemRelease, handler: a.handleUnavailableFeature("ota.apply")},
		{pattern: "GET /api/v1/ota/status", permission: PermissionSystemRelease, handler: a.handleUnavailableFeature("ota.status")},
		{pattern: "GET /api/v1/logs/download", permission: PermissionSystemRelease, handler: a.handleUnavailableFeature("logs.download")},
		{pattern: "GET /api/v1/system/config", permission: PermissionSettingsManage, handler: a.handleGetSystemConfig},
		{pattern: "GET /api/v1/system/config/device", permission: PermissionSettingsManage, handler: a.handleGetConfigDevice},
		{pattern: "PUT /api/v1/system/config/device", permission: PermissionSettingsManage, handler: a.handlePutConfigDevice},
		{pattern: "GET /api/v1/system/config/network", permission: PermissionSettingsManage, handler: a.handleGetConfigNetwork},
		{pattern: "PUT /api/v1/system/config/network", permission: PermissionSettingsManage, handler: a.handlePutConfigNetwork},
		{pattern: "GET /api/v1/system/config/io", permission: PermissionSettingsManage, handler: a.handleGetConfigIO},
		{pattern: "PUT /api/v1/system/config/io", permission: PermissionSettingsManage, handler: a.handlePutConfigIO},
		{pattern: "GET /api/v1/system/config/safe-state", permission: PermissionSettingsManage, handler: a.handleGetConfigSafeState},
		{pattern: "PUT /api/v1/system/config/safe-state", permission: PermissionSettingsManage, handler: a.handlePutConfigSafeState},
		{pattern: "GET /api/v1/system/config/virtual-points", permission: PermissionSettingsManage, handler: a.handleGetConfigVirtualPoints},
		{pattern: "PUT /api/v1/system/config/virtual-points", permission: PermissionSettingsManage, handler: a.handlePutConfigVirtualPoints},
		{pattern: "GET /api/v1/system/config/bacnet", permission: PermissionSettingsManage, handler: a.handleGetConfigBacnet},
		{pattern: "PUT /api/v1/system/config/bacnet", permission: PermissionSettingsManage, handler: a.handlePutConfigBacnet},
		{pattern: "GET /api/v1/system/config/fieldbus", permission: PermissionSettingsManage, handler: a.handleGetConfigFieldbus},
		{pattern: "PUT /api/v1/system/config/fieldbus", permission: PermissionSettingsManage, handler: a.handlePutConfigFieldbus},
		{pattern: "GET /api/v1/system/config/time", permission: PermissionSettingsManage, handler: a.handleGetConfigTime},
		{pattern: "PUT /api/v1/system/config/time", permission: PermissionSettingsManage, handler: a.handlePutConfigTime},
		{pattern: "GET /api/v1/system/time/status", permission: PermissionRead, handler: a.handleGetTimeStatus},
		{pattern: "GET /api/v1/users", permission: PermissionUsersManage, handler: a.handleListUsers},
		{pattern: "POST /api/v1/users", permission: PermissionUsersManage, handler: a.handleCreateUser},
		{pattern: "PUT /api/v1/users/{username}", permission: PermissionUsersManage, handler: a.handleUpdateUser},
		{pattern: "DELETE /api/v1/users/{username}", permission: PermissionUsersManage, handler: a.handleDeleteUser},
		{pattern: "POST /api/v1/users/{username}/reset-password", permission: PermissionUsersManage, handler: a.handleResetPassword},
		{pattern: "GET /api/v1/me", permission: PermissionRead, handler: a.handleGetMe},
		{pattern: "POST /api/v1/me/change-password", permission: PermissionSelfManage, handler: a.handleChangePassword},
		{pattern: "GET /api/v1/history", permission: PermissionRead, handler: a.handleHistoryRoute},
		{pattern: "GET /api/v1/history/export.csv", permission: PermissionRead, handler: a.handleHistoryExport},
		{pattern: "GET /api/v1/trends/config", permission: PermissionRead, handler: a.handleGetTrendConfig},
		{pattern: "PUT /api/v1/trends/config", permission: PermissionDatabaseManage, handler: a.handlePutTrendConfig},
		{pattern: "GET /api/v1/schedules", permission: PermissionRead, handler: a.handleGetSchedules},
		{pattern: "PUT /api/v1/schedules", permission: PermissionSettingsManage, handler: a.handlePutSchedules},
		{pattern: "GET /api/v1/alarm-settings", permission: PermissionRead, handler: a.handleGetAlarmSettings},
		{pattern: "PUT /api/v1/alarm-settings", permission: PermissionSettingsManage, handler: a.handlePutAlarmSettings},
	}
}

func (a *App) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/login", a.handleLogin)
	for _, route := range a.protectedRoutes() {
		var handler http.Handler
		if route.websocket {
			handler = a.requireWSPermission(route.permission, route.handler)
		} else {
			handler = a.auth.RequirePermission(route.permission, route.handler)
		}
		mux.Handle(route.pattern, handler)
	}
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
