package main

import "net/http"

// handleUnavailableFeature keeps approved API surfaces fail-closed until their
// owning service exists. Permission middleware always runs before this handler.
func (a *App) handleUnavailableFeature(feature string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor := "-"
		if principal := principalFromContext(r.Context()); principal != nil {
			actor = principal.Username
		}
		if a.audit != nil {
			a.audit.Change(actor, "endpoint.unavailable", feature, "not_implemented", r.RemoteAddr)
		}
		writeError(w, http.StatusNotImplemented, "feature not implemented")
	}
}
