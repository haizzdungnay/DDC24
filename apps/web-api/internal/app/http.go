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

	programminghttp "mkddc-web/internal/programming/transport/http"
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

// logCORSMode nói ra chế độ biên đang chạy ngay lúc khởi động.
//
// Rủi ro R-02 của Plan 51: bật fail-closed mà quên đặt `CORS_ORIGIN` làm giao
// diện không mở được từ một origin khác, và triệu chứng ở trình duyệt (request
// bị chặn im lặng) không chỉ về nguyên nhân. Một dòng log lúc khởi động biến
// nửa giờ dò tìm thành một lần `journalctl`.
func (a *App) logCORSMode() {
	if a.logger == nil {
		return
	}
	switch {
	case a.cfg.CORSOrigin != "":
		a.logger.Printf("INFO cors_mode=allowlist origins=%q — chỉ các origin này và same-origin được phép", a.cfg.CORSOrigin)
	case a.cfg.CORSAllowLoopback:
		a.logger.Printf("WARN cors_mode=dev_loopback — CORS_ALLOW_LOOPBACK đang bật, MỌI cổng loopback được phép; không dùng cho bo production")
	default:
		a.logger.Printf("INFO cors_mode=same_origin — CORS_ORIGIN chưa đặt nên mọi request cross-origin bị từ chối; đặt CORS_ORIGIN nếu FE chạy khác origin")
	}
}

func corsMiddleware(allowedOrigin string, allowLoopback bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin, allowedOrigin, allowLoopback) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Idempotency-Key, X-Correlation-ID, If-Match")
			w.Header().Set("Access-Control-Expose-Headers", "ETag, Location, X-Correlation-ID, Idempotency-Replayed")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isAllowedOrigin quyết định một Origin cross-origin có được cấp CORS header không.
//
// REV-PLT-01: `configured` rỗng trước đây tự động mở cho MỌI cổng loopback, và
// vì không đường triển khai nào đặt `CORS_ORIGIN` nên bo production chạy đúng
// bằng allowlist của chế độ dev — bất kỳ trang nào người vận hành mở trên một
// cổng loopback của máy đang nói chuyện với DDC đều gửi được request đã xác
// thực. Nay rỗng = chỉ same-origin (trình duyệt không gửi CORS cho same-origin,
// nên giao diện do chính mkddc-web phục vụ không bị ảnh hưởng); nhánh loopback
// chỉ mở khi `CORS_ALLOW_LOOPBACK` được bật tường minh.
func isAllowedOrigin(origin, configured string, allowLoopback bool) bool {
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
	if !allowLoopback {
		return false
	}
	return strings.HasPrefix(origin, "http://localhost:") ||
		strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasPrefix(origin, "http://[::1]:")
}

func (a *App) Router() http.Handler {
	mux, err := webRouter.New(a.auth, a.routeTable(), http.HandlerFunc(a.handleStatic))
	if err != nil {
		panic(err)
	}

	a.logCORSMode()
	var handler http.Handler = mux
	handler = corsMiddleware(a.cfg.CORSOrigin, a.cfg.CORSAllowLoopback, handler)
	handler = recoverMiddleware(a.logger, handler)
	handler = loggingMiddleware(a.logger, handler)
	return handler
}

// routeTable là NGUỒN CHÂN LÝ DUY NHẤT về bề mặt HTTP của Rev A.
//
// Tách khỏi `Router()` để `TestRouteTableMatchesOpenAPI` liệt kê được bề mặt
// thật mà không phải chép lại danh sách. Một bản chép sẽ trôi cùng lúc với thứ
// nó phải canh gác — đúng lỗi đã để `/modbus/frames` và `/modbus/templates` vào
// code mà không có trong `openapi.yaml`, và để bảy endpoint chỉ tồn tại trong
// spec (`/ota/*`, `/graph/*`, `/bacnet/objects`, `/logs/download`) suốt nhiều
// tháng mà không cổng nào bắt được.
//
// Hàm này CHỈ được đọc `a.cfg`; mọi handler là method value nên không
// dereference receiver. Nhờ vậy test dựng được bảng route từ một `App` rỗng.
func (a *App) routeTable() []webRouter.Route {
	routes := []webRouter.Route{
		webRouter.PublicFunc("GET /health", a.handleHealth),
		webRouter.PublicFunc("GET /api/v1/health", a.handleHealth),
		webRouter.PublicFunc("POST /api/v1/auth/login", a.handleLogin),
		webRouter.Protected("POST /api/v1/auth/logout", RoleViewer, a.handleLogout),
		webRouter.Protected("GET /api/v1/system/status", RoleViewer, a.handleSystemStatus),
		// `T57-3.4`: lịch sử 60 phút của CPU/RAM/nhiệt độ. Đọc ⇒ `viewer`.
		webRouter.Protected("GET /api/v1/system/history", RoleViewer, a.handleSystemHistory),
		// PA3-D02/D03: read model duy nhất của Landing và nhật ký vận hành.
		// Cả hai ở `viewer`: quan sát không phải là đặc quyền, và mọi mutation
		// vẫn nằm ở các endpoint riêng có role cao hơn.
		webRouter.Protected("GET /api/v1/overview", RoleViewer, a.handleOverview),
		webRouter.Protected("GET /api/v1/activity", RoleViewer, a.handleGetActivity),
		webRouter.Protected("GET /api/v1/network", RoleViewer, a.handleGetNetworkPage),
		webRouter.Protected("PUT /api/v1/network", RoleAdmin, a.handlePutNetworkPage),
		webRouter.Protected("GET /api/v1/network/transaction", RoleViewer, a.handleGetNetworkTransaction),
		webRouter.Protected("POST /api/v1/network/transaction/{action}", RoleAdmin, a.handlePostNetworkTransaction),
		// `T57-3.18`: kiểm gateway/DNS trong cửa sổ đếm ngược rollback. Đây là
		// ĐỌC (ping/phân giải tên), không đổi cấu hình, nên `operator` là đủ —
		// chính người đang trực mới cần bấm nó.
		webRouter.Protected("POST /api/v1/network/connectivity-check", RoleOperator, a.handleNetworkConnectivityCheck),
		webRouter.Protected("GET /api/v1/points", RoleViewer, a.handlePoints),
		webRouter.Protected("GET /api/v1/points/{id}", RoleViewer, a.handlePoint),
		webRouter.Protected("PUT /api/v1/points/{id}", RoleOperator, a.handleForcePoint),
		webRouter.Protected("PUT /api/v1/points/{id}/config", RoleAdmin, a.handlePutPointConfig),
		webRouter.Protected("GET /api/v1/virtual-points", RoleViewer, a.handleListVirtualPoints),
		webRouter.Protected("POST /api/v1/virtual-points", RoleAdmin, a.handleCreateVirtualPoint),
		webRouter.Protected("PUT /api/v1/virtual-points/{id}", RoleAdmin, a.handleUpdateVirtualPoint),
		webRouter.Protected("DELETE /api/v1/virtual-points/{id}", RoleAdmin, a.handleDeleteVirtualPoint),
		// `T57-3.12`: "ai đang dùng điểm ảo này" — đọc, nên `viewer`. Nó không
		// chặn xoá, chỉ cấp dữ kiện mà người vận hành đang thiếu.
		webRouter.Protected("GET /api/v1/virtual-points/{id}/usage", RoleViewer, a.handleVirtualPointUsage),
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
		webRouter.Protected("PUT /api/v1/modbus/buses/{bus_id}", RoleAdmin, a.handleUpdateModbusBus),
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
		// `T57-3.11`: mẫu thiết bị dựng sẵn. ĐỌC ⇒ `viewer`; mẫu chỉ điền sẵn
		// form, người dùng vẫn phải xác nhận và lưu như bình thường.
		webRouter.Protected("GET /api/v1/modbus/templates", RoleViewer, a.handleListModbusTemplates),
		// `T57-3.9` (`ADR-046` bản sửa 2026-08-19): đọc vòng nhớ giao dịch của
		// iobus. CHỈ ĐỌC, không phát gì ra bus ⇒ `viewer`.
		webRouter.Protected("GET /api/v1/modbus/frames", RoleViewer, a.handleModbusFrames),
		webRouter.Protected("GET /api/v1/modbus/export", RoleViewer, a.handleModbusExport),
		webRouter.Protected("POST /api/v1/modbus/import", RoleAdmin, a.handleModbusImport),
		webRouter.Protected("PUT /api/v1/modbus/devices/{id}/enabled", RoleAdmin, a.handleModbusDeviceEnabled),
		webRouter.Protected("POST /api/v1/modbus/devices/{id}/test-connection", RoleOperator, a.handleModbusTestConnection),
		webRouter.Protected("POST /api/v1/modbus/read-test", RoleOperator, a.handleModbusReadTest),
		webRouter.Public("GET /api/v1/ws/monitor", a.requireWSAuth(a.handleMonitorWS)),
		webRouter.Protected("GET /api/v1/alarms", RoleViewer, a.handleAlarms),
		webRouter.Protected("GET /api/v1/alarm-history", RoleViewer, a.handleAlarmHistory),
		// `T57-3.3` (`ADR-044`): chỉ số hệ alarm ISA-18.2 §16, tính tại thời
		// điểm hỏi từ chính nhật ký cảnh báo.
		webRouter.Protected("GET /api/v1/alarms/metrics", RoleViewer, a.handleAlarmMetrics),
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
		// Plan 57 Wave 3.
		// `T57-3.2` (`ADR-043`): tuỳ chọn của CHÍNH phiên đang gọi, nên `viewer`
		// là đúng mức — không có đường đọc tuỳ chọn người khác qua đây.
		webRouter.Protected("GET /api/v1/me/preferences", RoleViewer, a.handleGetPreferences),
		webRouter.Protected("PUT /api/v1/me/preferences", RoleViewer, a.handlePutPreferences),
		// `T57-3.16`: ai đăng nhập lần cuối, ai đang mở phiên. Là dữ liệu soát
		// tài khoản nên ở `admin`, cùng mức với danh sách người dùng.
		webRouter.Protected("GET /api/v1/users/access", RoleAdmin, a.handleGetUserAccess),
		webRouter.Protected("GET /api/v1/history", RoleViewer, a.handleHistoryRoute),
		webRouter.Protected("GET /api/v1/history/export.csv", RoleViewer, a.handleHistoryExport),
		webRouter.Protected("GET /api/v1/trends/config", RoleViewer, a.handleGetTrendConfig),
		webRouter.Protected("PUT /api/v1/trends/config", RoleAdmin, a.handlePutTrendConfig),
		// Scheduler Engine v3.1 — 14 endpoint đặc tả §15. Bốn thao tác nguy
		// hiểm (publish/rollback/delete/priority) còn qua một lớp quyền riêng
		// bên trong handler (ADR-023 QĐ-5), vai trò ở đây chỉ là cửa đầu tiên.
		webRouter.Protected("GET /api/v1/schedules", RoleViewer, a.handleGetSchedules),
		// `T57-3.5`/`T57-3.6` (`ADR-045`): hiệu lực thực tế trên MỘT điểm khi
		// nhiều lịch cùng tác động; cảnh báo xung đột dùng chính dữ liệu này.
		webRouter.Protected("GET /api/v1/schedules/effective", RoleViewer, a.handleScheduleEffective),
		webRouter.Protected("POST /api/v1/schedules", RoleAdmin, a.handleCreateSchedule),
		webRouter.Protected("GET /api/v1/schedules/{id}", RoleViewer, a.handleGetSchedule),
		webRouter.Protected("PUT /api/v1/schedules/{id}", RoleAdmin, a.handleUpdateSchedule),
		webRouter.Protected("DELETE /api/v1/schedules/{id}", RoleAdmin, a.handleDeleteSchedule),
		webRouter.Protected("POST /api/v1/schedules/{id}/validate", RoleAdmin, a.handleValidateSchedule),
		webRouter.Protected("POST /api/v1/schedules/{id}/simulate", RoleViewer, a.handleSimulateSchedule),
		webRouter.Protected("POST /api/v1/schedules/{id}/publish", RoleAdmin, a.handlePublishSchedule),
		webRouter.Protected("POST /api/v1/schedules/{id}/enable", RoleOperator, a.handleEnableSchedule),
		webRouter.Protected("POST /api/v1/schedules/{id}/disable", RoleOperator, a.handleDisableSchedule),
		webRouter.Protected("GET /api/v1/schedules/{id}/revisions", RoleViewer, a.handleGetScheduleRevisions),
		webRouter.Protected("POST /api/v1/schedules/{id}/rollback", RoleAdmin, a.handleRollbackSchedule),
		webRouter.Protected("GET /api/v1/schedules/{id}/runtime", RoleViewer, a.handleGetScheduleRuntime),
		webRouter.Protected("GET /api/v1/schedules/{id}/audit", RoleViewer, a.handleGetScheduleAudit),
		webRouter.Protected("GET /api/v1/alarm-settings", RoleViewer, a.handleGetAlarmSettings),
		webRouter.Protected("PUT /api/v1/alarm-settings", RoleAdmin, a.handlePutAlarmSettings),
		// `T57-2.13` (`ADR-048`): mô phỏng luật cảnh báo, là VỎ gọi
		// `mkddc-alarm-sim`. Không chạm cấu hình đang lưu nên `viewer` là đủ.
		webRouter.Protected("POST /api/v1/alarm-settings/simulate", RoleViewer, a.handleSimulateAlarmSetting),
		// `T57-3.13`: ước lượng tần suất từ lịch sử THẬT của điểm, cùng engine.
		webRouter.Protected("POST /api/v1/alarm-settings/estimate", RoleViewer, a.handleEstimateAlarmSetting),
	}
	programminghttp.RegisterProgrammingRoutes(&routes, a.cfg.ProgrammingRevA, programminghttp.Services{
		Library: a.programmingLibrary, Projects: a.programmingProjects,
		Checks: a.programmingChecks, Operations: a.programmingOperations,
		Runtime: a.programmingRuntime, Intents: a.programmingIntents,
		Simulation: a.programmingSimulation})
	return routes
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
		setStaticCacheHeaders(w, name)
		http.ServeFile(w, r, target)
		return
	}
	// Mọi đường dẫn không khớp file đều rơi về index.html (SPA), nên nó phải
	// mang header của HTML chứ không phải của đường dẫn được yêu cầu.
	setStaticCacheHeaders(w, "index.html")
	http.ServeFile(w, r, index)
}

// setStaticCacheHeaders quyết định trình duyệt được giữ file tĩnh bao lâu.
//
// # VÌ SAO CẦN
//
// Bản trước không đặt `Cache-Control` gì cả, nên trình duyệt tự suy từ
// `Last-Modified` (heuristic caching) và giữ `index.html` lại. Hậu quả quan sát
// được trên bo Foxlinx 2026-08-06: sau khi deploy bản có trang "Cổng RS-485",
// người dùng mở tab đang có sẵn và **không thấy tab mới**, vì trình duyệt vẫn
// nạp `index.html` cũ trỏ vào bundle cũ.
//
// Đây là kiểu hỏng tệ: máy chủ phục vụ đúng bản mới, log không có gì bất
// thường, kiểm bằng công cụ tự động (tải mới mỗi lần) cũng thấy đúng — chỉ
// người dùng thật là thấy sai. Không có tín hiệu nào cho họ biết mình đang xem
// bản cũ, nên kết luận tự nhiên là "tính năng không có".
//
// LUẬT
//
//   - `index.html` và mọi HTML: `no-cache`. Không phải "không cache" mà là
//     "phải hỏi lại máy chủ trước khi dùng"; file ~1 KB nên chi phí không đáng
//     kể, đổi lại deploy có hiệu lực ngay.
//   - `assets/*`: tên đã chứa hash nội dung (`index-DnwvEcoc.js`). Nội dung đổi
//     ⇒ tên đổi, nên bản cũ không bao giờ bị phục vụ nhầm. Cache một năm +
//     `immutable` để trình duyệt khỏi hỏi lại.
//   - Còn lại (favicon, ảnh…): cache ngắn, có `must-revalidate`.
func setStaticCacheHeaders(w http.ResponseWriter, name string) {
	switch {
	case strings.HasSuffix(name, ".html"):
		w.Header().Set("Cache-Control", "no-cache")
	case strings.HasPrefix(name, "assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	default:
		w.Header().Set("Cache-Control", "public, max-age=300, must-revalidate")
	}
}
