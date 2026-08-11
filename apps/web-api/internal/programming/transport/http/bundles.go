package programminghttp

import (
	"encoding/base64"
	"net/http"

	programmingapplication "mkddc-web/internal/programming/application"
)

type bundleExportRequest struct {
	SchemaVersion string   `json:"schemaVersion"`
	RevisionIDs   []string `json:"revisionIds"`
}

type bundleImportRequest struct {
	SchemaVersion  string `json:"schemaVersion"`
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	BundleBase64   string `json:"bundleBase64"`
	ExpectedSHA256 string `json:"expectedSha256"`
}

type bundleExportResponse struct {
	SchemaVersion      string   `json:"schemaVersion"`
	BundleSHA256       string   `json:"bundleSha256"`
	ByteSize           int64    `json:"byteSize"`
	RevisionIDs        []string `json:"revisionIds"`
	SelectedRevisionID string   `json:"selectedRevisionId"`
	BundleBase64       string   `json:"bundleBase64"`
	AuditID            string   `json:"auditId"`
	CorrelationID      string   `json:"correlationId"`
}

func handleBundleRequest(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) bool {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/programming/bundles/export":
		handleExportBundle(w, r, correlationID, service)
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/programming/bundles/import":
		handleImportBundle(w, r, correlationID, service)
	default:
		return false
	}
	return true
}

func handleExportBundle(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	var request bundleExportRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	result, err := service.ExportBundle(r.Context(), requestActor(r), programmingapplication.BundleExportCommand{
		SchemaVersion: request.SchemaVersion, RevisionIDs: request.RevisionIDs,
		IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	if result.Replay {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	writeJSON(w, http.StatusOK, correlationID, bundleExportResponse{SchemaVersion: result.SchemaVersion,
		BundleSHA256: result.BundleSHA256, ByteSize: result.ByteSize, RevisionIDs: result.RevisionIDs,
		SelectedRevisionID: result.SelectedRevisionID, BundleBase64: base64.StdEncoding.EncodeToString(result.Bundle),
		AuditID: result.AuditID, CorrelationID: correlationID})
}

func handleImportBundle(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.ProjectService) {
	var request bundleImportRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	bundle, err := base64.StdEncoding.Strict().DecodeString(request.BundleBase64)
	if err != nil {
		writeMappedError(w, programmingapplication.ErrInvalidBundle, correlationID)
		return
	}
	result, err := service.ImportBundle(r.Context(), requestActor(r), programmingapplication.BundleImportCommand{
		SchemaVersion: request.SchemaVersion, Name: request.Name, Description: request.Description,
		Bundle: bundle, ExpectedSHA256: request.ExpectedSHA256,
		IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusCreated, correlationID, result)
}
