package programminghttp

import (
	"net/http"

	programmingapplication "mkddc-web/internal/programming/application"
)

func handleOperationRequest(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.OperationService) bool {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/programming/operations/commission":
		var request CommissionRequest
		if err := decodeStrictRequest(r, &request); err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		expected := ""
		if request.ExpectedActiveRevisionID != nil {
			expected = *request.ExpectedActiveRevisionID
		}
		acknowledgements := make([]string, 0, len(request.Acknowledgements))
		for _, item := range request.Acknowledgements {
			acknowledgements = append(acknowledgements, string(item))
		}
		graphBackupID := ""
		if request.Cutover.GraphBackupID != nil {
			graphBackupID = *request.Cutover.GraphBackupID
		}
		accepted, err := service.Commission(r.Context(), requestActor(r), programmingapplication.OperationCommand{
			SchemaVersion: request.SchemaVersion, RevisionID: request.RevisionID,
			ExpectedActiveRevisionID: expected, CheckID: request.CheckID, ImpactRef: request.ImpactRef,
			Acknowledgements: acknowledgements, Cutover: request.Cutover.Requested,
			GraphBackupID: graphBackupID, IdempotencyKey: r.Header.Get("X-Idempotency-Key"),
			CorrelationID: correlationID,
		})
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeOperationAccepted(w, correlationID, accepted)
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/programming/operations/restore":
		var request RestoreRequest
		if err := decodeStrictRequest(r, &request); err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		expected := ""
		if request.ExpectedActiveRevisionID != nil {
			expected = *request.ExpectedActiveRevisionID
		}
		accepted, err := service.Restore(r.Context(), requestActor(r), programmingapplication.OperationCommand{
			SchemaVersion: request.SchemaVersion, RevisionID: request.RevisionID,
			ExpectedActiveRevisionID: expected, Reason: request.Reason, Cutover: "PROGRAM_ONLY",
			IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
		})
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeOperationAccepted(w, correlationID, accepted)
		return true
	case r.Method == http.MethodGet && r.PathValue("operationId") != "":
		operation, err := service.GetOperation(r.Context(), r.PathValue("operationId"))
		if err != nil {
			writeMappedError(w, err, correlationID)
			return true
		}
		writeJSON(w, http.StatusOK, correlationID, operation)
		return true
	}
	return false
}

func writeOperationAccepted(w http.ResponseWriter, correlationID string,
	accepted programmingapplication.OperationAccepted) {
	if accepted.Replay {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	w.Header().Set("Location", accepted.StatusURL)
	writeJSON(w, http.StatusAccepted, correlationID, accepted)
}
