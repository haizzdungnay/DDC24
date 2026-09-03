package programminghttp

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"mkddc-web/internal/auth"
	programmingapplication "mkddc-web/internal/programming/application"
)

// handleRuntimeRequest phục vụ hai route đọc chỉ-đọc, không mutation:
// GET /capabilities và GET /runtime. Cả hai luôn trả 200 với authority thật
// (kể cả khi Core UNAVAILABLE) — không bao giờ suy trạng thái từ DB Web.
func handleRuntimeRequest(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.RuntimeService) bool {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/capabilities":
		capabilities, err := service.GetCapabilities(r.Context())
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, capabilities)
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/runtime":
		runtime, err := service.GetRuntime(r.Context())
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, runtime)
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/runtime/monitor":
		monitor, err := service.GetMonitor(r.Context())
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, monitor)
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/runtime/signals":
		signals, err := service.GetSignals(r.Context())
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, signals)
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/programming/runtime/traces":
		var request programmingapplication.TraceRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
			return true
		}
		principal := auth.PrincipalFromContext(r.Context())
		if principal == nil {
			writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
			return true
		}
		accepted, err := service.CreateTrace(r.Context(), request,
			programmingapplication.Actor{ID: principal.Username, Role: string(principal.Role)},
			r.Header.Get("X-Idempotency-Key"), correlationID)
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusAccepted, correlationID, accepted)
		return true
	case strings.HasPrefix(r.URL.Path, "/api/v1/programming/runtime/traces/"):
		traceID := strings.TrimPrefix(r.URL.Path, "/api/v1/programming/runtime/traces/")
		if strings.Contains(traceID, "/") || traceID == "" {
			return false
		}
		if r.Method == http.MethodGet {
			trace, err := service.GetTrace(traceID)
			if err != nil {
				writeMappedError(w, err, correlationID)
				return true
			}
			writeRuntimeJSON(w, http.StatusOK, correlationID, trace)
			return true
		}
		if r.Method == http.MethodDelete {
			principal := auth.PrincipalFromContext(r.Context())
			if principal == nil {
				writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
				return true
			}
			err := service.StopTrace(r.Context(), traceID,
				programmingapplication.Actor{ID: principal.Username, Role: string(principal.Role)}, correlationID)
			if err != nil {
				writeMappedError(w, err, correlationID)
				return true
			}
			w.Header().Set(correlationHeader, correlationID)
			w.WriteHeader(http.StatusNoContent)
			return true
		}
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/point-catalog":
		limit := 500
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				limit = parsed
			}
		}
		/* `ISS-PIO-04` — cursor đi vào từ query, cùng khuôn với các endpoint
		 * phân trang khác. Không có nó thì `nextCursor` server trả về không ai
		 * dùng được, và bảng vẫn dừng ở trang đầu. */
		page, err := service.ListPointCatalog(r.Context(), r.URL.Query().Get("cursor"), limit)
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, page)
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/overrides":
		limit := 100
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				limit = parsed
			}
		}
		page, err := service.ListOverrides(r.Context(), limit)
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, page)
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/operations":
		limit := 50
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				limit = parsed
			}
		}
		page, err := service.ListOperations(r.Context(), r.URL.Query().Get("cursor"), limit)
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, page)
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/audit":
		limit := 50
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				limit = parsed
			}
		}
		page, err := service.ListAudit(r.Context(), r.URL.Query().Get("cursor"), limit)
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, page)
		return true
	}
	// T60-013 — GET /projects/{projectId}/programs.
	//
	// Nối ở ĐÂY chứ không ở `router.go` là có chủ đích. `handleProgrammingRequest`
	// gọi `handleRuntimeRequest` TRƯỚC `handleProgramIntentRequest`, nên bắt
	// request tại cuối hàm này cho đúng thứ tự cần thiết: nhánh `GET .../programs`
	// cũ trong `runtime_intent.go` (chỉ trả ý định lưu trong DB, không có
	// read-back sống) không bao giờ còn chạy tới. Đặt vào `router.go` sẽ cho cùng
	// kết quả nhưng phải sửa một file đang mang thay đổi chưa commit của luồng
	// khác — xem ghi chú Plan 60 §6 P0-B.
	//
	// Handler tự khớp đường dẫn tường minh dựng từ `projectId` và trả `false` khi
	// không phải route của nó, nên nó không nuốt request của module khác.
	if handleProgramsRequest(w, r, correlationID, service) {
		return true
	}
	return false
}

func writeRuntimeJSON(w http.ResponseWriter, status int, correlationID string, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(correlationHeader, correlationID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
