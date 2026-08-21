package programminghttp

import (
	"encoding/json"
	"net/http"
	"strings"

	"mkddc-web/internal/auth"
	programmingapplication "mkddc-web/internal/programming/application"
)

type setProgramIntentRequest struct {
	SchemaVersion  string `json:"schemaVersion"`
	DesiredEnabled *bool  `json:"desiredEnabled"`
}

// handleProgramIntentRequest phục vụ hai route intent Enable/Disable.
//
// Khớp theo ĐƯỜNG DẪN tường minh chứ không theo hậu tố: một handler khớp bằng
// `HasSuffix` sẽ nuốt route của module khác có cùng đuôi, và lỗi đó chỉ lộ ra
// dưới dạng "request không hợp lệ" ở một endpoint chẳng liên quan gì.
func handleProgramIntentRequest(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.RuntimeIntentService) bool {
	projectID := r.PathValue("projectId")
	if projectID == "" {
		return false
	}
	path := r.URL.Path
	switch {
	case r.Method == http.MethodGet &&
		path == "/api/v1/programming/projects/"+projectID+"/programs":
		intents, err := service.ListProgramIntents(r.Context(), projectID)
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, map[string]any{"items": intents})
		return true

	case r.Method == http.MethodPut && strings.HasPrefix(path,
		"/api/v1/programming/projects/"+projectID+"/programs/") &&
		strings.HasSuffix(path, "/runtime-intent"):
		programID := r.PathValue("programId")
		if programID == "" {
			return false
		}
		var request setProgramIntentRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil || request.DesiredEnabled == nil {
			// `desiredEnabled` thiếu KHÁC `desiredEnabled=false`. Mặc định về
			// false sẽ biến một payload hỏng thành một lệnh TẮT chương trình.
			writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
			return true
		}
		principal := auth.PrincipalFromContext(r.Context())
		if principal == nil {
			writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
			return true
		}
		result, err := service.SetProgramEnabled(r.Context(),
			programmingapplication.Actor{ID: principal.Username, Role: string(principal.Role)},
			programmingapplication.SetProgramIntentCommand{
				SchemaVersion: request.SchemaVersion, ProjectID: projectID, ProgramID: programID,
				DesiredEnabled: *request.DesiredEnabled,
				IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID})
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, map[string]any{
			"resource": result.Resource, "auditId": result.AuditID, "replay": result.Replay})
		return true
	}
	return false
}
