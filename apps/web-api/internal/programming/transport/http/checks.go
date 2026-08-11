package programminghttp

import (
	"encoding/json"
	"net/http"

	programmingapplication "mkddc-web/internal/programming/application"
)

type createCheckRequest struct {
	SchemaVersion string `json:"schemaVersion"`
	TargetProfile string `json:"targetProfile"`
}

type checkAcceptedResponse struct {
	CheckID       string `json:"checkId"`
	StatusURL     string `json:"statusUrl"`
	State         string `json:"state"`
	RequestHash   string `json:"requestHash"`
	AcceptedAt    string `json:"acceptedAt"`
	CorrelationID string `json:"correlationId"`
}

func handleCheckRequest(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.CheckService) bool {
	switch {
	case r.Method == http.MethodPost && r.PathValue("revisionId") != "":
		var request createCheckRequest
		if err := decodeStrictRequest(r, &request); err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		accepted, err := service.RequestCheck(r.Context(), requestActor(r), programmingapplication.RequestCheckCommand{
			RevisionID: r.PathValue("revisionId"), SchemaVersion: request.SchemaVersion, TargetProfile: request.TargetProfile,
			IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID})
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Location", accepted.StatusURL)
		w.Header().Set("X-Correlation-ID", correlationID)
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(checkAcceptedResponse{CheckID: accepted.CheckID, StatusURL: accepted.StatusURL, State: accepted.State,
			RequestHash: accepted.RequestHash, AcceptedAt: accepted.AcceptedAt, CorrelationID: accepted.CorrelationID})
		return true
	case r.Method == http.MethodGet && r.PathValue("checkId") != "":
		check, err := service.GetCheck(r.Context(), r.PathValue("checkId"))
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Correlation-ID", correlationID)
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(check)
		return true
	}
	return false
}
