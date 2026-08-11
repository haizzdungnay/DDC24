package programminghttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"mkddc-web/internal/auth"
	"mkddc-web/internal/programming/domain"
	webrouter "mkddc-web/internal/router"
)

const maxMutationBodyBytes int64 = 1 << 20

type routeDefinition struct {
	method              string
	path                string
	role                auth.Role
	bodyRequired        bool
	idempotencyRequired bool
	ifMatchRequired     bool
}

var routeDefinitions = []routeDefinition{
	{method: "GET", path: "/api/v1/programming/capabilities", role: auth.RoleViewer},
	{method: "GET", path: "/api/v1/programming/projects", role: auth.RoleViewer},
	{method: "POST", path: "/api/v1/programming/projects", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/projects/{projectId}", role: auth.RoleViewer},
	{method: "PATCH", path: "/api/v1/programming/projects/{projectId}/draft", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	{method: "POST", path: "/api/v1/programming/projects/{projectId}/draft/revisions", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	{method: "GET", path: "/api/v1/programming/revisions/{revisionId}", role: auth.RoleViewer},
	{method: "GET", path: "/api/v1/programming/revisions/{from}/changes/{to}", role: auth.RoleViewer},
	{method: "POST", path: "/api/v1/programming/revisions/{revisionId}/checks", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/checks/{checkId}", role: auth.RoleViewer},
	{method: "GET", path: "/api/v1/programming/point-catalog", role: auth.RoleViewer},
	{method: "GET", path: "/api/v1/programming/runtime", role: auth.RoleViewer},
	{method: "GET", path: "/api/v1/programming/runtime/monitor", role: auth.RoleViewer},
	{method: "POST", path: "/api/v1/programming/runtime/traces", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/runtime/traces/{traceId}", role: auth.RoleViewer},
	{method: "DELETE", path: "/api/v1/programming/runtime/traces/{traceId}", role: auth.RoleAdmin},
	{method: "POST", path: "/api/v1/programming/operations/commission", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "POST", path: "/api/v1/programming/operations/restore", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/operations/{operationId}", role: auth.RoleViewer},
	{method: "GET", path: "/api/v1/programming/operations", role: auth.RoleViewer},
	{method: "GET", path: "/api/v1/programming/overrides", role: auth.RoleViewer},
	{method: "POST", path: "/api/v1/programming/bundles/export", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "POST", path: "/api/v1/programming/bundles/import", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "POST", path: "/api/v1/programming/retain/reset", role: auth.RoleAdmin, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/audit", role: auth.RoleViewer},
}

// RegisterProgrammingRoutes chỉ mount contract khi flag bật. Khi flag tắt,
// fallback API hiện hữu trả 404, nên deploy binary trước không làm lộ capability
// giả hoặc mutation chưa nối Core.
func RegisterProgrammingRoutes(routes *[]webrouter.Route, enabled bool) {
	if !enabled {
		return
	}
	for _, definition := range routeDefinitions {
		definition := definition
		pattern := definition.method + " " + definition.path
		handler := func(w http.ResponseWriter, r *http.Request) {
			handleContractSkeleton(w, r, definition)
		}
		*routes = append(*routes, webrouter.Protected(pattern, definition.role, handler))
	}
}

func handleContractSkeleton(w http.ResponseWriter, r *http.Request, definition routeDefinition) {
	correlationID, correlationErr := correlationIDFromRequest(r)
	if correlationErr != nil {
		WriteProgrammingError(w, http.StatusBadRequest, *correlationErr, correlationID)
		return
	}
	if status, public := validateContractRequest(w, r, definition); public != nil {
		WriteProgrammingError(w, status, *public, correlationID)
		return
	}
	public := domain.NewPublicError(domain.ErrUnavailable)
	// Skeleton chưa gọi Core và chưa có side effect, nên invariant này được biết
	// chắc; lỗi unknown từ Core không được tự đặt true như vậy.
	public.KeepsRunningRevision = true
	WriteProgrammingError(w, http.StatusServiceUnavailable, public, correlationID)
}

var errRequestTooLarge = errors.New("programming request too large")

var idempotencyKeyPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func validateContractRequest(w http.ResponseWriter, r *http.Request, definition routeDefinition) (int, *domain.PublicError) {
	if definition.idempotencyRequired {
		key := r.Header.Get("X-Idempotency-Key")
		if !idempotencyKeyPattern.MatchString(key) {
			public := domain.NewPublicError(domain.ErrRequest)
			public.Field = "X-Idempotency-Key"
			return http.StatusBadRequest, &public
		}
	}
	if definition.ifMatchRequired && strings.TrimSpace(r.Header.Get("If-Match")) == "" {
		public := domain.NewPublicError(domain.ErrConflict)
		public.Field = "If-Match"
		return http.StatusPreconditionRequired, &public
	}
	if !definition.bodyRequired {
		return 0, nil
	}
	if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(strings.ToLower(contentType), "application/json") {
		public := domain.NewPublicError(domain.ErrRequest)
		public.Field = "Content-Type"
		return http.StatusBadRequest, &public
	}
	value, err := validateBoundedJSON(w, r)
	if err != nil {
		public := domain.NewPublicError(domain.ErrRequest)
		status := http.StatusBadRequest
		if errors.Is(err, errRequestTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		return status, &public
	}
	version, ok := value["schemaVersion"].(string)
	if !ok || version == "" {
		public := domain.NewPublicError(domain.ErrRequest)
		public.Field = "schemaVersion"
		return http.StatusBadRequest, &public
	}
	if strings.SplitN(version, ".", 2)[0] != "1" {
		public := domain.NewPublicError(domain.ErrRequest)
		public.Field = "schemaVersion"
		public.Args = map[string]any{"supportedMajor": "1", "actual": version}
		return http.StatusBadRequest, &public
	}
	return 0, nil
}

func validateBoundedJSON(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	if r.ContentLength > maxMutationBodyBytes {
		return nil, errRequestTooLarge
	}
	reader := http.MaxBytesReader(w, r.Body, maxMutationBodyBytes)
	defer reader.Close()
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, errRequestTooLarge
		}
		return nil, err
	}
	if len(value) == 0 {
		return nil, errors.New("empty json object")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("multiple json values")
	}
	return value, nil
}

func RegisteredRouteContracts() []string {
	contracts := make([]string, 0, len(routeDefinitions))
	for _, definition := range routeDefinitions {
		contracts = append(contracts, definition.method+" "+definition.path)
	}
	return contracts
}
