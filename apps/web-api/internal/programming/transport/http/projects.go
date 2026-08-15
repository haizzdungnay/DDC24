package programminghttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"mkddc-web/internal/auth"
	programmingapplication "mkddc-web/internal/programming/application"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

type createProjectRequest struct {
	SchemaVersion string `json:"schemaVersion"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
}

type draftMutationRequest struct {
	SchemaVersion  string            `json:"schemaVersion"`
	BaseRevisionID string            `json:"baseRevisionId"`
	Operations     []json.RawMessage `json:"operations"`
}

type createRevisionRequest struct {
	SchemaVersion  string `json:"schemaVersion"`
	BaseRevisionID string `json:"baseRevisionId"`
	Label          string `json:"label"`
	Comment        string `json:"comment,omitempty"`
}

type mutationResponse struct {
	Resource      map[string]any `json:"resource"`
	ETag          string         `json:"etag"`
	AuditID       string         `json:"auditId"`
	CorrelationID string         `json:"correlationId"`
}

type projectResponse struct {
	ProjectID        string  `json:"projectId"`
	Name             string  `json:"name"`
	ETag             string  `json:"etag"`
	ActiveRevisionID *string `json:"activeRevisionId"`
	DraftRevisionID  string  `json:"draftRevisionId"`
	BaseRevisionID   string  `json:"baseRevisionId"`
	UpdatedAt        string  `json:"updatedAt"`
	// Draft chỉ có ở `GET /projects/{projectId}` (đọc một Project), không có
	// ở item của `GET /projects` (danh sách) — xem lý do ở
	// `application.ProjectView.DraftContentJSON`.
	Draft json.RawMessage `json:"draft,omitempty"`
	// LatestCheck — WP-01 (Overview state model). `nil` khi Draft chưa từng
	// niêm phong hoặc chưa từng Check.
	LatestCheck *projectLatestCheckResponse `json:"latestCheck,omitempty"`
}

type projectLatestCheckResponse struct {
	CheckID     string  `json:"checkId"`
	RevisionID  string  `json:"revisionId"`
	State       string  `json:"state"`
	CreatedAt   string  `json:"createdAt"`
	CompletedAt *string `json:"completedAt,omitempty"`
}

type projectPageResponse struct {
	Items      []projectResponse `json:"items"`
	NextCursor *string           `json:"nextCursor,omitempty"`
}

func handleProjectRequest(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) bool {
	switch {
	case r.Method == http.MethodGet && r.PathValue("from") != "" && r.PathValue("to") != "":
		handleGetRevisionChanges(w, r, correlationID, service)
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/programming/projects":
		handleListProjects(w, r, correlationID, service)
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/programming/projects":
		handleCreateProject(w, r, correlationID, service)
	case r.Method == http.MethodGet && r.PathValue("projectId") != "" && r.URL.Path != "/api/v1/programming/projects":
		handleGetProject(w, r, correlationID, service)
	case r.Method == http.MethodPatch && r.PathValue("projectId") != "":
		handleSaveDraft(w, r, correlationID, service)
	case r.Method == http.MethodPost && r.PathValue("projectId") != "":
		handleSealRevision(w, r, correlationID, service)
	case r.Method == http.MethodGet && r.PathValue("revisionId") != "":
		handleGetRevision(w, r, correlationID, service)
	default:
		return false
	}
	return true
}

func handleGetRevisionChanges(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	changes, err := service.GetRevisionChanges(r.Context(), r.PathValue("from"), r.PathValue("to"))
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeJSON(w, http.StatusOK, correlationID, changes)
}

func handleCreateProject(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	var request createProjectRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	result, err := service.CreateProject(r.Context(), requestActor(r), programmingapplication.CreateProjectCommand{
		SchemaVersion: request.SchemaVersion, Name: request.Name, Description: request.Description,
		IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusCreated, correlationID, result)
}

func handleSaveDraft(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	var request draftMutationRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	result, err := service.SaveDraft(r.Context(), requestActor(r), programmingapplication.SaveDraftCommand{
		ProjectID: r.PathValue("projectId"), SchemaVersion: request.SchemaVersion, BaseRevisionID: request.BaseRevisionID,
		Operations: request.Operations, IfMatch: r.Header.Get("If-Match"), IdempotencyKey: r.Header.Get("X-Idempotency-Key"),
		CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusOK, correlationID, result)
}

func handleSealRevision(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	var request createRevisionRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	result, err := service.SealRevision(r.Context(), requestActor(r), programmingapplication.SealRevisionCommand{
		ProjectID: r.PathValue("projectId"), SchemaVersion: request.SchemaVersion, BaseRevisionID: request.BaseRevisionID,
		Label: request.Label, Comment: request.Comment, IfMatch: r.Header.Get("If-Match"),
		IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusCreated, correlationID, result)
}

func handleGetProject(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	project, err := service.GetProject(r.Context(), r.PathValue("projectId"))
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	response := toProjectResponse(project)
	w.Header().Set("ETag", project.ETag)
	writeJSON(w, http.StatusOK, correlationID, response)
}

func handleListProjects(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	for key, values := range r.URL.Query() {
		if (key != "cursor" && key != "limit") || len(values) != 1 {
			writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
			return
		}
	}
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
			return
		}
		limit = parsed
	}
	page, err := service.ListProjects(r.Context(), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	response := projectPageResponse{Items: make([]projectResponse, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, item := range page.Items {
		response.Items = append(response.Items, toProjectResponse(item))
	}
	writeJSON(w, http.StatusOK, correlationID, response)
}

func handleGetRevision(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	revision, err := service.GetRevision(r.Context(), r.PathValue("revisionId"))
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeJSON(w, http.StatusOK, correlationID, map[string]any{"revisionId": revision.RevisionID, "projectId": revision.ProjectID,
		"state": revision.State, "contentHash": revision.ContentHash, "createdAt": revision.CreatedAt, "snapshot": revision.Snapshot})
}

func requestActor(r *http.Request) programmingapplication.Actor {
	principal := auth.PrincipalFromContext(r.Context())
	if principal == nil {
		return programmingapplication.Actor{}
	}
	return programmingapplication.Actor{ID: principal.Username, Role: string(principal.Role)}
}

func decodeStrictRequest(r *http.Request, destination any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return programmingapplication.ErrInvalidRequest
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return programmingapplication.ErrInvalidRequest
	}
	return nil
}

func writeMutation(w http.ResponseWriter, status int, correlationID string, result programmingapplication.MutationResult) {
	w.Header().Set("ETag", result.ETag)
	if result.Replay {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	writeJSON(w, status, correlationID, mutationResponse{Resource: result.Resource, ETag: result.ETag,
		AuditID: result.AuditID, CorrelationID: correlationID})
}

func writeJSON(w http.ResponseWriter, status int, correlationID string, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(correlationHeader, correlationID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeMappedError(w http.ResponseWriter, err error, correlationID string) {
	status := http.StatusServiceUnavailable
	public := domain.NewPublicError(domain.ErrUnavailable)
	var operationError *programmingapplication.OperationPublicError
	switch {
	case errors.As(err, &operationError):
		public = operationError.Public
		status = domain.DefaultHTTPStatus(public.Code)
	case errors.Is(err, programmingstore.ErrNotFound):
		status, public = http.StatusNotFound, domain.NewPublicError(domain.ErrNotFound)
	case errors.Is(err, programmingstore.ErrETagConflict):
		status, public = http.StatusConflict, domain.NewPublicError(domain.ErrConflict)
	case errors.Is(err, programmingstore.ErrIdempotencyConflict):
		status, public = http.StatusConflict, domain.NewPublicError(domain.ErrOperation)
	case errors.Is(err, programmingstore.ErrAlreadyExists):
		status, public = http.StatusConflict, domain.NewPublicError(domain.ErrConflict)
	case errors.Is(err, programmingapplication.ErrInvalidRequest), errors.Is(err, programmingapplication.ErrInvalidCursor):
		status, public = http.StatusBadRequest, domain.NewPublicError(domain.ErrRequest)
	case errors.Is(err, programmingapplication.ErrBundleTooLarge):
		status, public = http.StatusRequestEntityTooLarge, domain.NewPublicError(domain.ErrImport)
	case errors.Is(err, programmingapplication.ErrInvalidBundle):
		status, public = http.StatusUnprocessableEntity, domain.NewPublicError(domain.ErrImport)
	}
	if operationError == nil {
		public.KeepsRunningRevision = true
	}
	WriteProgrammingError(w, status, public, correlationID)
}

func toProjectResponse(project programmingapplication.ProjectView) projectResponse {
	response := projectResponse{ProjectID: project.ProjectID, Name: project.Name, ETag: project.ETag,
		ActiveRevisionID: project.ActiveRevisionID, DraftRevisionID: project.DraftRevisionID,
		BaseRevisionID: project.BaseRevisionID, UpdatedAt: project.UpdatedAt}
	if len(project.DraftContentJSON) > 0 {
		response.Draft = json.RawMessage(project.DraftContentJSON)
	}
	if project.LatestCheck != nil {
		response.LatestCheck = &projectLatestCheckResponse{CheckID: project.LatestCheck.CheckID,
			RevisionID: project.LatestCheck.RevisionID, State: project.LatestCheck.State,
			CreatedAt: project.LatestCheck.CreatedAt, CompletedAt: project.LatestCheck.CompletedAt}
	}
	return response
}
