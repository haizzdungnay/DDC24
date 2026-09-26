package programminghttp

import (
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"mkddc-web/internal/auth"
	programmingapplication "mkddc-web/internal/programming/application"
	"mkddc-web/internal/programming/domain"
)

// Endpoint R3. `SET_INPUT` đi bằng PUT trên resource input và `STOP` đi bằng
// DELETE trên resource session — chúng là hành động sản phẩm nhưng được
// materialize thành resource để có identity và idempotency rõ ràng
// (`DDD-SW-PGM02-WORKSPACE-001` §5.4).
const (
	simulationSessionsPath = "/api/v1/programming/simulation/sessions"
)

type simulationCreateRequest struct {
	SchemaVersion         string `json:"schemaVersion"`
	ControllerID          string `json:"controllerId"`
	ProjectID             string `json:"projectId"`
	SourceDraftRevisionID string `json:"sourceDraftRevisionId"`
	SourceContentSHA256   string `json:"sourceContentSha256"`
}

type simulationActionRequest struct {
	SchemaVersion string `json:"schemaVersion"`
	Action        string `json:"action"`
	Speed         int64  `json:"speed,omitempty"`
	BaseTickMS    int64  `json:"baseTickMs,omitempty"`
}

type simulationInputRequest struct {
	SchemaVersion string `json:"schemaVersion"`
	DataType      string `json:"dataType"`
	Value         any    `json:"value"`
}

// handleSimulationRequest phục vụ toàn bộ họ route R3.
//
// Trả `true` khi đã xử lý. Mọi nhánh mutation đi qua application service, và
// service đó là nơi DUY NHẤT quyết định vai — handler không tự đoán quyền.
func handleSimulationRequest(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.SimulationService) bool {

	path := r.URL.Path
	if !strings.HasPrefix(path, simulationSessionsPath) {
		return false
	}

	principal := auth.PrincipalFromContext(r.Context())
	if principal == nil {
		public := domain.NewPublicError(domain.ErrRequest)
		WriteProgrammingError(w, http.StatusBadRequest, public, correlationID)
		return true
	}
	request := programmingapplication.SimulationRequest{
		ActorID: principal.Username, Role: string(principal.Role),
		CorrelationID: correlationID, IfMatch: strings.TrimSpace(r.Header.Get("If-Match")),
	}
	request.Idempotency = sha256.Sum256([]byte(r.Header.Get("X-Idempotency-Key")))

	rest := strings.TrimPrefix(path, simulationSessionsPath)
	rest = strings.TrimPrefix(rest, "/")

	// POST /sessions
	if rest == "" && r.Method == http.MethodPost {
		body, err := io.ReadAll(io.LimitReader(r.Body, maxMutationBodyBytes))
		if err != nil {
			WriteProgrammingError(w, http.StatusBadRequest, domain.NewPublicError(domain.ErrRequest), correlationID)
			return true
		}
		request.RequestHash = sha256.Sum256(body)
		var payload simulationCreateRequest
		if err := json.Unmarshal(body, &payload); err != nil {
			WriteProgrammingError(w, http.StatusBadRequest, domain.NewPublicError(domain.ErrRequest), correlationID)
			return true
		}
		view, public := service.CreateSession(r.Context(), request,
			programmingapplication.CreateSimulationSessionInput{
				ProjectID:             payload.ProjectID,
				SourceDraftRevisionID: payload.SourceDraftRevisionID,
				SourceContentSHA256:   payload.SourceContentSHA256,
			})
		if public != nil {
			writeSimulationError(w, *public, correlationID)
			return true
		}
		w.Header().Set("ETag", view.ETag)
		writeRuntimeJSON(w, http.StatusCreated, correlationID, view)
		return true
	}

	segments := strings.Split(rest, "/")
	sessionID := segments[0]
	if sessionID == "" {
		return false
	}

	switch {
	// GET /sessions/{id}
	case len(segments) == 1 && r.Method == http.MethodGet:
		view, public := service.GetSession(r.Context(), sessionID)
		if public != nil {
			writeSimulationError(w, *public, correlationID)
			return true
		}
		w.Header().Set("ETag", view.ETag)
		writeRuntimeJSON(w, http.StatusOK, correlationID, view)
		return true

	// DELETE /sessions/{id} — materialize của hành động STOP.
	case len(segments) == 1 && r.Method == http.MethodDelete:
		request.RequestHash = sha256.Sum256([]byte(sessionID))
		view, public := service.StopSession(r.Context(), request, sessionID)
		if public != nil {
			writeSimulationError(w, *public, correlationID)
			return true
		}
		w.Header().Set("ETag", view.ETag)
		writeRuntimeJSON(w, http.StatusOK, correlationID, view)
		return true

	// POST /sessions/{id}/actions
	case len(segments) == 2 && segments[1] == "actions" && r.Method == http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, maxMutationBodyBytes))
		if err != nil {
			WriteProgrammingError(w, http.StatusBadRequest, domain.NewPublicError(domain.ErrRequest), correlationID)
			return true
		}
		request.RequestHash = sha256.Sum256(body)
		var payload simulationActionRequest
		if err := json.Unmarshal(body, &payload); err != nil {
			WriteProgrammingError(w, http.StatusBadRequest, domain.NewPublicError(domain.ErrRequest), correlationID)
			return true
		}
		view, public := service.Action(r.Context(), request, sessionID, payload.Action, payload.Speed, payload.BaseTickMS)
		if public != nil {
			writeSimulationError(w, *public, correlationID)
			return true
		}
		w.Header().Set("ETag", view.ETag)
		writeRuntimeJSON(w, http.StatusOK, correlationID, view)
		return true

	// PUT /sessions/{id}/inputs/{observationId}
	case len(segments) == 3 && segments[1] == "inputs" && r.Method == http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, maxMutationBodyBytes))
		if err != nil {
			WriteProgrammingError(w, http.StatusBadRequest, domain.NewPublicError(domain.ErrRequest), correlationID)
			return true
		}
		request.RequestHash = sha256.Sum256(body)
		var payload simulationInputRequest
		if err := json.Unmarshal(body, &payload); err != nil {
			WriteProgrammingError(w, http.StatusBadRequest, domain.NewPublicError(domain.ErrRequest), correlationID)
			return true
		}
		view, public := service.SetInput(r.Context(), request, sessionID, segments[2],
			payload.DataType, payload.Value)
		if public != nil {
			writeSimulationError(w, *public, correlationID)
			return true
		}
		w.Header().Set("ETag", view.ETag)
		writeRuntimeJSON(w, http.StatusOK, correlationID, view)
		return true

	// GET /sessions/{id}/observations
	case len(segments) == 2 && segments[1] == "observations" && r.Method == http.MethodGet:
		frame, public := service.Observations(r.Context(), sessionID)
		if public != nil {
			writeSimulationError(w, *public, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, frame)
		return true

	// GET /sessions/{id}/trace
	case len(segments) == 2 && segments[1] == "trace" && r.Method == http.MethodGet:
		cursor, _ := strconv.ParseInt(r.URL.Query().Get("cursor"), 10, 64)
		limit, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64)
		page, public := service.Trace(r.Context(), sessionID, cursor, limit)
		if public != nil {
			writeSimulationError(w, *public, correlationID)
			return true
		}
		writeRuntimeJSON(w, http.StatusOK, correlationID, page)
		return true
	}
	return false
}

// writeSimulationError chọn HTTP status TỪ CATALOG, không từ một bảng viết tay
// trong handler. Hai bảng cho một mã lỗi là hai bảng để trôi khỏi nhau.
func writeSimulationError(w http.ResponseWriter, public domain.PublicError, correlationID string) {
	WriteProgrammingError(w, domain.DefaultHTTPStatus(public.Code), public, correlationID)
}
