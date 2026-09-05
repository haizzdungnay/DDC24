package programminghttp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"mkddc-web/internal/auth"
	programmingapplication "mkddc-web/internal/programming/application"
	"mkddc-web/internal/programming/domain"
	webrouter "mkddc-web/internal/router"
)

const maxMutationBodyBytes int64 = 1 << 20
const maxBundleMutationBodyBytes int64 = 6 << 20

type routeDefinition struct {
	method string
	path   string
	/*
	   `WEB-RBAC-001` — route khai QUYỀN, không khai ngưỡng vai.

	   Trước lát này mọi mutation của Programming đòi `RoleAdmin`, nên không thể
	   cho một kỹ sư vận hành sửa Draft mà không đồng thời trao cho họ quyền tạo
	   tài khoản. Nay chia làm hai mức:

	     - `program.edit`     sửa Draft, thư viện, phiên mô phỏng, trace —
	                          chưa chạm tới thiết bị đang chạy;
	     - `program.activate` Commission / Restore / reset RETAIN / recovery
	                          reset / intent Enable / import bundle — đây là lúc
	                          chương trình BẮT ĐẦU điều khiển thiết bị thật.

	   Bất biến của `security_matrix_test.go` giữ nguyên: handler KHÔNG được
	   chạy khi thiếu quyền, nên một vai không đủ quyền không tạo ra side effect
	   nào — kể cả một lần đọc làm lộ sự tồn tại của phiên.
	*/
	permission auth.Permission
	/*
	   `T61-401` — POST KHÔNG GHI, khai tường minh.

	   Bất biến cũ của `security_matrix_test.go` là "mọi route khác GET đều là
	   mutation", và nó đúng cho tới khi có một dry run: bước Check của wizard
	   nhận cả một payload entry (không nhét vào query string được) nhưng không
	   ghi gì. Xếp nó vào mutation buộc phải bịa ra `idempotencyRequired` cho
	   một thứ không có gì để lặp, và làm phép ĐẾM bề mặt mutation trong record
	   V&V kể một route ghi không hề tồn tại.

	   Cờ này chỉ được đặt khi handler thật sự không gọi đường ghi nào. Nó không
	   nới lỏng gì: `TestReadOnlyPostsAreEnumeratedAndDoNotWrite` khoá danh sách
	   route mang cờ này bằng tên, nên thêm một cái nữa vẫn phải đỏ trước.
	*/
	readOnly            bool
	bodyRequired        bool
	idempotencyRequired bool
	ifMatchRequired     bool
	maxBodyBytes        int64
}

var routeDefinitions = []routeDefinition{
	{method: "GET", path: "/api/v1/programming/capabilities", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/projects", permission: auth.PermissionRead},
	{method: "POST", path: "/api/v1/programming/projects", permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/projects/{projectId}", permission: auth.PermissionRead},
	{method: "PATCH", path: "/api/v1/programming/projects/{projectId}/draft", permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	{method: "POST", path: "/api/v1/programming/projects/{projectId}/draft/revisions", permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	{method: "GET", path: "/api/v1/programming/revisions/{revisionId}", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/revisions/{from}/changes/{to}", permission: auth.PermissionRead},
	{method: "POST", path: "/api/v1/programming/revisions/{revisionId}/checks", permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/checks/{checkId}", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/libraries", permission: auth.PermissionRead},
	/* `T61-105` — Used-In là đường ĐỌC. Người ta cần biết khối nào đang được
	   dùng TRƯỚC khi quyết định có sửa hay không; chặn nó lại làm người vận
	   hành phải đoán. */
	{method: "GET", path: "/api/v1/programming/library-usages", permission: auth.PermissionRead},
	/* `T61-404` — đọc mã nguồn của một entry theo ĐÚNG một cặp (revision, entry).
	   Đường dẫn phẳng, hai định danh ở query: revision id của SYSTEM là một chuỗi
	   có dấu hai chấm, nhét vào path segment sẽ đẻ ra lỗi encoding. */
	{method: "GET", path: "/api/v1/programming/library-entry-source", permission: auth.PermissionRead},
	{method: "POST", path: "/api/v1/programming/projects/{projectId}/library/entries", permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	/* `T61-401` — Check là DRY RUN của cùng payload: không `If-Match`, không
	   idempotency key, không ghi. Bắt nó mang `If-Match` sẽ tiêu ETag Draft cho
	   một lần bấm "Kiểm tra"; bắt nó mang idempotency key sẽ biến hai lần kiểm
	   giống hệt nhau thành một xung đột. Quyền vẫn là `program.edit` vì nó đọc
	   được cấu trúc Draft library của Project. */
	{method: "POST", path: "/api/v1/programming/projects/{projectId}/library/entries/check",
		permission: auth.PermissionProgramEdit, readOnly: true, bodyRequired: true},
	{method: "DELETE", path: "/api/v1/programming/projects/{projectId}/library/entries/{entryId}", permission: auth.PermissionProgramEdit, idempotencyRequired: true, ifMatchRequired: true},
	{method: "POST", path: "/api/v1/programming/projects/{projectId}/library/revisions/{libraryRevisionId}/deprecate",
		permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	{method: "GET", path: "/api/v1/programming/point-catalog", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/runtime", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/runtime/monitor", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/runtime/signals", permission: auth.PermissionRead},
	{method: "POST", path: "/api/v1/programming/runtime/traces", permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/runtime/traces/{traceId}", permission: auth.PermissionRead},
	{method: "DELETE", path: "/api/v1/programming/runtime/traces/{traceId}", permission: auth.PermissionProgramEdit},
	{method: "POST", path: "/api/v1/programming/operations/commission", permission: auth.PermissionProgramActivate, bodyRequired: true, idempotencyRequired: true},
	{method: "POST", path: "/api/v1/programming/operations/restore", permission: auth.PermissionProgramActivate, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/operations/{operationId}", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/operations", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/overrides", permission: auth.PermissionRead},
	{method: "POST", path: "/api/v1/programming/bundles/export", permission: auth.PermissionProgramEdit, bodyRequired: true, idempotencyRequired: true},
	{method: "POST", path: "/api/v1/programming/bundles/import", permission: auth.PermissionProgramActivate, bodyRequired: true, idempotencyRequired: true, maxBodyBytes: maxBundleMutationBodyBytes},
	{method: "POST", path: "/api/v1/programming/retain/reset", permission: auth.PermissionProgramActivate, bodyRequired: true, idempotencyRequired: true},
	// T59-405 — intent Enable/Disable. `PUT` chứ không phải hai route
	// `enable`/`disable`: intent là một TRẠNG THÁI mong muốn, và hai động từ
	// riêng sẽ làm việc "đặt lại đúng thứ đang có" trở thành hai request khác
	// nhau tuỳ giá trị hiện tại.
	{method: "GET", path: "/api/v1/programming/projects/{projectId}/programs", permission: auth.PermissionRead},
	{method: "PUT", path: "/api/v1/programming/projects/{projectId}/programs/{programId}/runtime-intent",
		permission: auth.PermissionProgramActivate, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/audit", permission: auth.PermissionRead},
	// T59-702 — lối ra tường minh khỏi `RECOVERY_REQUIRED`. Admin, có
	// idempotency key và body bắt buộc: một lệnh gỡ khoá vận hành phải nêu lý do.
	{method: "POST", path: "/api/v1/programming/runtime/recovery-reset",
		permission: auth.PermissionProgramActivate, bodyRequired: true, idempotencyRequired: true},

	// T59-814 / ADR-053 — Simulation R3.
	//
	// Mọi route mutation khai `RoleAdmin` ở ĐÂY, không chỉ ở lớp application:
	// bất biến của repo (xem `security_matrix_test.go`) là handler KHÔNG được
	// chạy khi thiếu quyền. Nhờ vậy một vai không đủ quyền không tạo ra side
	// effect nào, kể cả một lần đọc làm lộ sự tồn tại của phiên.
	//
	// `SET_INPUT` đi bằng PUT trên resource input và `STOP` đi bằng DELETE trên
	// resource session: chúng là hành động sản phẩm nhưng cần identity và
	// idempotency riêng (`DDD-SW-PGM02-WORKSPACE-001` §5.4).
	{method: "POST", path: "/api/v1/programming/simulation/sessions",
		permission: auth.PermissionSimulationRun, bodyRequired: true, idempotencyRequired: true},
	{method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}", permission: auth.PermissionRead},
	{method: "DELETE", path: "/api/v1/programming/simulation/sessions/{sessionId}",
		permission: auth.PermissionSimulationRun, idempotencyRequired: true, ifMatchRequired: true},
	{method: "POST", path: "/api/v1/programming/simulation/sessions/{sessionId}/actions",
		permission: auth.PermissionSimulationRun, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	{method: "PUT", path: "/api/v1/programming/simulation/sessions/{sessionId}/inputs/{observationId}",
		permission: auth.PermissionSimulationRun, bodyRequired: true, idempotencyRequired: true, ifMatchRequired: true},
	{method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}/observations", permission: auth.PermissionRead},
	{method: "GET", path: "/api/v1/programming/simulation/sessions/{sessionId}/trace", permission: auth.PermissionRead},
}

// RegisterProgrammingRoutes chỉ mount contract khi flag bật. Khi flag tắt,
// fallback API hiện hữu trả 404, nên deploy binary trước không làm lộ capability
// giả hoặc mutation chưa nối Core.
type Services struct {
	Library    *programmingapplication.LibraryService
	Projects   *programmingapplication.ProjectService
	Checks     *programmingapplication.CheckService
	Operations *programmingapplication.OperationService
	Runtime    *programmingapplication.RuntimeService
	Intents    *programmingapplication.RuntimeIntentService
	Simulation *programmingapplication.SimulationService
}

func RegisterProgrammingRoutes(routes *[]webrouter.Route, enabled bool, provided ...Services) {
	if !enabled {
		return
	}
	var services Services
	if len(provided) > 0 {
		services = provided[0]
	}
	for _, definition := range routeDefinitions {
		definition := definition
		pattern := definition.method + " " + definition.path
		handler := func(w http.ResponseWriter, r *http.Request) {
			handleProgrammingRequest(w, r, definition, services)
		}
		*routes = append(*routes, webrouter.ProtectedPermission(pattern, definition.permission, handler))
	}
}

func handleProgrammingRequest(w http.ResponseWriter, r *http.Request, definition routeDefinition, services Services) {
	correlationID, correlationErr := correlationIDFromRequest(r)
	if correlationErr != nil {
		WriteProgrammingError(w, http.StatusBadRequest, *correlationErr, correlationID)
		return
	}
	if status, public := validateContractRequest(w, r, definition); public != nil {
		WriteProgrammingError(w, status, *public, correlationID)
		return
	}
	if services.Library != nil && handleLibraryRequest(w, r, correlationID, services.Library) {
		return
	}
	if services.Runtime != nil && handleRuntimeRequest(w, r, correlationID, services.Runtime) {
		return
	}
	if services.Simulation != nil && handleSimulationRequest(w, r, correlationID, services.Simulation) {
		return
	}
	if services.Intents != nil && handleRecoveryResetRequest(w, r, correlationID, services.Intents) {
		return
	}
	if services.Intents != nil && handleProgramIntentRequest(w, r, correlationID, services.Intents) {
		return
	}
	if services.Projects != nil && handleProjectRequest(w, r, correlationID, services.Projects) {
		return
	}
	if services.Checks != nil && handleCheckRequest(w, r, correlationID, services.Checks) {
		return
	}
	if services.Operations != nil && handleOperationRequest(w, r, correlationID, services.Operations) {
		return
	}
	if services.Projects != nil && handleBundleRequest(w, r, correlationID, services.Projects) {
		return
	}
	public := domain.NewPublicError(domain.ErrUnavailable)
	// Skeleton chưa gọi Core và chưa có side effect, nên invariant này được biết
	// chắc; lỗi unknown từ Core không được tự đặt true như vậy.
	public.KeepsRunningRevision = true
	WriteProgrammingError(w, http.StatusServiceUnavailable, public, correlationID)
}

func handleContractSkeleton(w http.ResponseWriter, r *http.Request, definition routeDefinition) {
	handleProgrammingRequest(w, r, definition, Services{})
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
	limit := definition.maxBodyBytes
	if limit == 0 {
		limit = maxMutationBodyBytes
	}
	value, err := validateBoundedJSON(w, r, limit)
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

func validateBoundedJSON(w http.ResponseWriter, r *http.Request, limit int64) (map[string]any, error) {
	if r.ContentLength > limit {
		return nil, errRequestTooLarge
	}
	reader := http.MaxBytesReader(w, r.Body, limit)
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, errRequestTooLarge
		}
		return nil, err
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	if err := rejectDuplicateJSONKeys(raw); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
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

func rejectDuplicateJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := walkJSONValue(decoder); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return errors.New("JSON có dữ liệu thừa")
	}
	return nil
}

func walkJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, compound := token.(json.Delim)
	if !compound {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("JSON key không hợp lệ")
			}
			if _, duplicate := seen[key]; duplicate {
				return errors.New("JSON duplicate key")
			}
			seen[key] = struct{}{}
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	case '[':
		for decoder.More() {
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	default:
		return errors.New("JSON delimiter không hợp lệ")
	}
}

func RegisteredRouteContracts() []string {
	contracts := make([]string, 0, len(routeDefinitions))
	for _, definition := range routeDefinitions {
		contracts = append(contracts, definition.method+" "+definition.path)
	}
	return contracts
}
