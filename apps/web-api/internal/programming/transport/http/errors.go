package programminghttp

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"

	"mkddc-web/internal/programming/domain"
)

const correlationHeader = "X-Correlation-ID"

var correlationPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{16,64}$`)

type errorEnvelope struct {
	Error domain.PublicError `json:"error"`
}

func WriteProgrammingError(w http.ResponseWriter, status int, public domain.PublicError, correlationID string) {
	public = domain.NormalizePublicError(public)
	if !domain.HTTPStatusAllowed(public.Code, status) {
		status = domain.DefaultHTTPStatus(public.Code)
	}
	public.CorrelationID = correlationID
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(correlationHeader, correlationID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorEnvelope{Error: public})
}

func correlationIDFromRequest(r *http.Request) (string, *domain.PublicError) {
	value := r.Header.Get(correlationHeader)
	if value == "" {
		var raw [16]byte
		if _, err := rand.Read(raw[:]); err == nil {
			return hex.EncodeToString(raw[:]), nil
		}
		return "programming-request-id", nil
	}
	if !correlationPattern.MatchString(value) {
		err := domain.NewPublicError(domain.ErrRequest)
		err.Field = correlationHeader
		return "invalid-correlation-id", &err
	}
	return value, nil
}
