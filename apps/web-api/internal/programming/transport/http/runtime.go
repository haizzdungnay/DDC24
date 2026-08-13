package programminghttp

import (
	"encoding/json"
	"net/http"
	"strconv"

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
	return false
}

func writeRuntimeJSON(w http.ResponseWriter, status int, correlationID string, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(correlationHeader, correlationID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
