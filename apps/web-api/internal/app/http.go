package app

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

	webRouter "mkddc-web/internal/router"
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
	routes := []webRouter.Route{
		webRouter.PublicFunc("GET /health", a.handleHealth),
		webRouter.PublicFunc("GET /api/v1/health", a.handleHealth),
		webRouter.PublicFunc("POST /api/v1/auth/login", a.handleLogin),
		webRouter.Protected("POST /api/v1/auth/logout", RoleViewer, a.handleLogout),
		webRouter.Protected("GET /api/v1/system/status", RoleViewer, a.handleSystemStatus),
		webRouter.Protected("GET /api/v1/network", RoleViewer, a.handleGetNetworkPage),
		webRouter.Protected("PUT /api/v1/network", RoleAdmin, a.handlePutNetworkPage),
		webRouter.Protected("GET /api/v1/network/transaction", RoleViewer, a.handleGetNetworkTransaction),
		webRouter.Protected("POST /api/v1/network/transaction/{action}", RoleAdmin, a.handlePostNetworkTransaction),
		webRouter.Protected("GET /api/v1/points", RoleViewer, a.handlePoints),
		webRouter.Protected("GET /api/v1/points/{id}", RoleViewer, a.handlePoint),
		webRouter.Protected("PUT /api/v1/points/{id}", RoleOperator, a.handleForcePoint),
		webRouter.Protected("PUT /api/v1/points/{id}/config", RoleAdmin, a.handlePutPointConfig),
		webRouter.Protected("GET /api/v1/virtual-points", RoleViewer, a.handleListVirtualPoints),
		webRouter.Protected("POST /api/v1/virtual-points", RoleAdmin, a.handleCreateVirtualPoint),
		webRouter.Protected("PUT /api/v1/virtual-points/{id}", RoleAdmin, a.handleUpdateVirtualPoint),
		webRouter.Protected("DELETE /api/v1/virtual-points/{id}", RoleAdmin, a.handleDeleteVirtualPoint),
		webRouter.Protected("GET /api/v1/modbus/devices", RoleViewer, a.handleListModbusDevices),
		webRouter.Protected("POST /api/v1/modbus/devices", RoleAdmin, a.handleCreateModbusDevice),
		webRouter.Protected("PUT /api/v1/modbus/devices/{id}", RoleAdmin, a.handleUpdateModbusDevice),
		webRouter.Protected("DELETE /api/v1/modbus/devices/{id}", RoleAdmin, a.handleDeleteModbusDevice),
		webRouter.Protected("GET /api/v1/modbus/points", RoleViewer, a.handleListModbusPoints),
		webRouter.Protected("POST /api/v1/modbus/points", RoleAdmin, a.handleCreateModbusPoint),
		webRouter.Protected("PUT /api/v1/modbus/points/{id}", RoleAdmin, a.handleUpdateModbusPoint),
		webRouter.Protected("DELETE /api/v1/modbus/points/{id}", RoleAdmin, a.handleDeleteModbusPoint),
		webRouter.Protected("GET /api/v1/modbus/diagnostics", RoleViewer, a.handleModbusDiagnostics),
		webRouter.Protected("GET /api/v1/modbus/overview", RoleViewer, a.handleGetModbusOverview),
		webRouter.Protected("GET /api/v1/modbus/buses", RoleViewer, a.handleGetModbusBuses),
		webRouter.Protected("GET /api/v1/modbus/events", RoleViewer, a.handleGetModbusEvents),
		webRouter.Protected("POST /api/v1/modbus/write-test", RoleAdmin, a.handleModbusWriteTest),
		// MBR-B210 — nhóm endpoint contract v2.
		// Đọc ở `viewer` (PR-MBRTU-001: người giám sát phải xem được), mutation
		// ở `admin` (Đ-04). Export là ĐỌC nên cũng ở viewer: nó chỉ trả đúng dữ
		// liệu mà GET /modbus/points đã lộ (OD-MBRTU-017).
		webRouter.Protected("GET /api/v1/modbus/config/state", RoleViewer, a.handleModbusConfigState),
		webRouter.Protected("GET /api/v1/modbus/config/candidate", RoleViewer, a.handleGetModbusCandidate),
		webRouter.Protected("PUT /api/v1/modbus/config/candidate", RoleAdmin, a.handlePutModbusCandidate),
		webRouter.Protected("DELETE /api/v1/modbus/config/candidate", RoleAdmin, a.handleDeleteModbusCandidate),
		webRouter.Protected("GET /api/v1/modbus/config/diff", RoleViewer, a.handleModbusConfigDiff),
		webRouter.Protected("POST /api/v1/modbus/config/apply", RoleAdmin, a.handleApplyModbusConfig),
		webRouter.Protected("GET /api/v1/modbus/mapping", RoleViewer, a.handleModbusMapping),
		webRouter.Protected("GET /api/v1/modbus/ports", RoleViewer, a.handleModbusPorts),
		webRouter.Protected("GET /api/v1/modbus/export", RoleViewer, a.handleModbusExport),
		webRouter.Protected("POST /api/v1/modbus/import", RoleAdmin, a.handleModbusImport),
		webRouter.Protected("PUT /api/v1/modbus/devices/{id}/enabled", RoleAdmin, a.handleModbusDeviceEnabled),
		webRouter.Protected("POST /api/v1/modbus/devices/{id}/test-connection", RoleOperator, a.handleModbusTestConnection),
		webRouter.Protected("POST /api/v1/modbus/read-test", RoleOperator, a.handleModbusReadTest),
		webRouter.Public("GET /api/v1/ws/monitor", a.requireWSAuth(a.handleMonitorWS)),
		webRouter.Protected("GET /api/v1/alarms", RoleViewer, a.handleAlarms),
		webRouter.Protected("GET /api/v1/alarm-history", RoleViewer, a.handleAlarmHistory),
		webRouter.Protected("POST /api/v1/alarms/{id}/ack", RoleOperator, a.handleAckAlarm),
		webRouter.Protected("POST /api/v1/alarms/{id}/suppress", RoleOperator, a.handleSuppressAlarm),
		webRouter.Protected("POST /api/v1/alarms/{id}/return", RoleOperator, a.handleReturnAlarm),
		webRouter.Protected("POST /api/v1/commissioning/points/{id}/test", RoleOperator, a.handleCommissionTest),
		webRouter.Protected("GET /api/v1/system/config", RoleAdmin, a.handleGetSystemConfig),
		webRouter.Protected("PUT /api/v1/system/config", RoleAdmin, a.handlePutSystemConfig),
		webRouter.Protected("GET /api/v1/system/config/device", RoleAdmin, a.handleGetConfigDevice),
		webRouter.Protected("PUT /api/v1/system/config/device", RoleAdmin, a.handlePutConfigDevice),
		webRouter.Protected("GET /api/v1/system/config/network", RoleAdmin, a.handleGetConfigNetwork),
		webRouter.Protected("PUT /api/v1/system/config/network", RoleAdmin, a.handlePutConfigNetwork),
		webRouter.Protected("GET /api/v1/system/config/io", RoleAdmin, a.handleGetConfigIO),
		webRouter.Protected("PUT /api/v1/system/config/io", RoleAdmin, a.handlePutConfigIO),
		webRouter.Protected("GET /api/v1/system/config/safe-state", RoleAdmin, a.handleGetConfigSafeState),
		webRouter.Protected("PUT /api/v1/system/config/safe-state", RoleAdmin, a.handlePutConfigSafeState),
		webRouter.Protected("GET /api/v1/system/config/io-bundle", RoleAdmin, a.handleGetIOBundle),
		webRouter.Protected("PUT /api/v1/system/config/io-bundle", RoleAdmin, a.handlePutIOBundle),
		webRouter.Protected("GET /api/v1/system/config/virtual-points", RoleAdmin, a.handleGetConfigVirtualPoints),
		webRouter.Protected("PUT /api/v1/system/config/virtual-points", RoleAdmin, a.handlePutConfigVirtualPoints),
		webRouter.Protected("GET /api/v1/system/config/bacnet", RoleAdmin, a.handleGetConfigBacnet),
		webRouter.Protected("PUT /api/v1/system/config/bacnet", RoleAdmin, a.handlePutConfigBacnet),
		webRouter.Protected("GET /api/v1/system/config/fieldbus", RoleAdmin, a.handleGetConfigFieldbus),
		webRouter.Protected("PUT /api/v1/system/config/fieldbus", RoleAdmin, a.handlePutConfigFieldbus),
		webRouter.Protected("GET /api/v1/system/config/time", RoleAdmin, a.handleGetConfigTime),
		webRouter.Protected("PUT /api/v1/system/config/time", RoleAdmin, a.handlePutConfigTime),
		webRouter.Protected("GET /api/v1/system/time/status", RoleViewer, a.handleGetTimeStatus),
		webRouter.Protected("GET /api/v1/users", RoleAdmin, a.handleListUsers),
		webRouter.Protected("POST /api/v1/users", RoleAdmin, a.handleCreateUser),
		webRouter.Protected("PUT /api/v1/users/{username}", RoleAdmin, a.handleUpdateUser),
		webRouter.Protected("DELETE /api/v1/users/{username}", RoleAdmin, a.handleDeleteUser),
		webRouter.Protected("POST /api/v1/users/{username}/reset-password", RoleAdmin, a.handleResetPassword),
		webRouter.Protected("GET /api/v1/me", RoleViewer, a.handleGetMe),
		webRouter.Protected("POST /api/v1/me/change-password", RoleViewer, a.handleChangePassword),
		webRouter.Protected("GET /api/v1/history", RoleViewer, a.handleHistoryRoute),
		webRouter.Protected("GET /api/v1/history/export.csv", RoleViewer, a.handleHistoryExport),
		webRouter.Protected("GET /api/v1/trends/config", RoleViewer, a.handleGetTrendConfig),
		webRouter.Protected("PUT /api/v1/trends/config", RoleAdmin, a.handlePutTrendConfig),
		webRouter.Protected("GET /api/v1/schedules", RoleViewer, a.handleGetSchedules),
		webRouter.Protected("PUT /api/v1/schedules", RoleAdmin, a.handlePutSchedules),
		webRouter.Protected("GET /api/v1/alarm-settings", RoleViewer, a.handleGetAlarmSettings),
		webRouter.Protected("PUT /api/v1/alarm-settings", RoleAdmin, a.handlePutAlarmSettings),
	}
	mux, err := webRouter.New(a.auth, routes, http.HandlerFunc(a.handleStatic))
	if err != nil {
		panic(err)
	}

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
