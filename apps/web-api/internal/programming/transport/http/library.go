package programminghttp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	programmingapplication "mkddc-web/internal/programming/application"
)

type libraryEntryResponse struct {
	Scope             string          `json:"scope"`
	LibraryRevisionID string          `json:"libraryRevisionId"`
	LibraryVersion    string          `json:"libraryVersion"`
	LibraryState      string          `json:"libraryState"`
	EntryID           string          `json:"entryId"`
	Kind              string          `json:"kind"`
	Name              string          `json:"name"`
	Language          string          `json:"language,omitempty"`
	FeatureState      string          `json:"featureState"`
	ContentSHA256     string          `json:"contentSha256"`
	Interface         json.RawMessage `json:"interface,omitempty"`
	/* `T59-804`: chữ ký ĐÃ PHÂN GIẢI. Vắng field nghĩa là chữ ký thô không khớp
	 * hình dạng canonical — một câu trả lời rõ ràng, khác hẳn để mỗi client tự
	 * parse rồi mỗi nơi kết luận một kiểu. */
	Signature        *librarySignatureResponse   `json:"signature,omitempty"`
	Dependencies     []libraryDependencyResponse `json:"dependencies"`
	StateLayoutKnown bool                        `json:"stateLayoutKnown"`
	StateSizeBytes   uint32                      `json:"stateSizeBytes"`
}

type librarySignaturePortResponse struct {
	Name      string `json:"name"`
	Direction string `json:"direction"`
	DataType  string `json:"dataType"`
}

type librarySignatureResponse struct {
	Category       string                         `json:"category"`
	LabelVi        string                         `json:"labelVi,omitempty"`
	LabelEn        string                         `json:"labelEn,omitempty"`
	Dispatch       string                         `json:"dispatch"`
	Polymorphic    bool                           `json:"polymorphic"`
	AllowedTypes   []string                       `json:"allowedTypes"`
	DefaultType    string                         `json:"defaultType,omitempty"`
	TypedPortNames []string                       `json:"typedPortNames"`
	Ports          []librarySignaturePortResponse `json:"ports"`
}

/* Hình dạng canonical của chữ ký SYSTEM (sinh từ
 * `contracts/programming/pou_library_registry_v1.json`). PROJECT entry do người
 * dùng nạp nên chữ ký của chúng có thể KHÁC; khi đó parse thất bại và `signature`
 * vắng mặt thay vì bịa ra một chữ ký rỗng trông như thật. */
type librarySignatureDocument struct {
	Category       string   `json:"category"`
	LabelVi        string   `json:"labelVi"`
	LabelEn        string   `json:"labelEn"`
	Dispatch       string   `json:"dispatch"`
	Polymorphic    bool     `json:"polymorphic"`
	AllowedTypes   []string `json:"allowedTypes"`
	DefaultType    string   `json:"defaultType"`
	TypedPortNames []string `json:"typedPortNames"`
	Ports          []struct {
		Name      string `json:"name"`
		Direction string `json:"direction"`
		DataType  string `json:"dataType"`
	} `json:"ports"`
}

var librarySignatureDispatches = map[string]struct{}{
	"OPERATOR": {}, "FUNC_TABLE": {}, "FB_TYPE": {}, "EXPANSION": {},
}

var librarySignatureDataTypes = map[string]struct{}{
	"BOOL": {}, "INT": {}, "DINT": {}, "UINT": {}, "REAL": {}, "TIME": {},
}

// parseLibrarySignature trả `nil` khi chữ ký thô không khớp hình dạng canonical.
// KHÔNG sửa chữa dữ liệu: một cổng thiếu kiểu hay dispatch lạ nghĩa là chữ ký
// này chưa dùng được, và nói "chưa đọc được" đúng hơn là đoán phần còn thiếu.
func parseLibrarySignature(raw []byte) *librarySignatureResponse {
	if len(raw) == 0 {
		return nil
	}
	var document librarySignatureDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&document); err != nil {
		return nil
	}
	if document.Category == "" || len(document.Ports) == 0 {
		return nil
	}
	if _, ok := librarySignatureDispatches[document.Dispatch]; !ok {
		return nil
	}
	ports := make([]librarySignaturePortResponse, 0, len(document.Ports))
	for _, port := range document.Ports {
		if port.Name == "" || (port.Direction != "INPUT" && port.Direction != "OUTPUT") {
			return nil
		}
		if _, ok := librarySignatureDataTypes[port.DataType]; !ok {
			return nil
		}
		ports = append(ports, librarySignaturePortResponse{
			Name: port.Name, Direction: port.Direction, DataType: port.DataType})
	}
	for _, dataType := range document.AllowedTypes {
		if _, ok := librarySignatureDataTypes[dataType]; !ok {
			return nil
		}
	}
	if document.DefaultType != "" {
		if _, ok := librarySignatureDataTypes[document.DefaultType]; !ok {
			return nil
		}
	}
	allowed := document.AllowedTypes
	if allowed == nil {
		allowed = []string{}
	}
	typed := document.TypedPortNames
	if typed == nil {
		typed = []string{}
	}
	return &librarySignatureResponse{
		Category: document.Category, LabelVi: document.LabelVi, LabelEn: document.LabelEn,
		Dispatch: document.Dispatch, Polymorphic: document.Polymorphic,
		AllowedTypes: allowed, DefaultType: document.DefaultType,
		TypedPortNames: typed, Ports: ports,
	}
}

type libraryDependencyResponse struct {
	EntryID string `json:"entryId"`
	Version string `json:"version"`
}

type libraryPageResponse struct {
	Items      []libraryEntryResponse `json:"items"`
	NextCursor *string                `json:"nextCursor,omitempty"`
}

type upsertLibraryEntryRequest struct {
	SchemaVersion string                                            `json:"schemaVersion"`
	EntryID       string                                            `json:"entryId"`
	Kind          string                                            `json:"kind"`
	Name          string                                            `json:"name"`
	Language      string                                            `json:"language"`
	FeatureState  string                                            `json:"featureState,omitempty"`
	Source        string                                            `json:"source"`
	Interface     json.RawMessage                                   `json:"interface"`
	Dependencies  []programmingapplication.LibraryDependencyView    `json:"dependencies,omitempty"`
	StateLayout   *programmingapplication.LibraryStateLayoutCommand `json:"stateLayout,omitempty"`
}

type deprecateLibraryRevisionRequest struct {
	SchemaVersion string `json:"schemaVersion"`
}

// handleLibraryRequest phải khớp theo ĐƯỜNG DẪN, không chỉ theo sự có mặt của
// `projectId`. Nhiều route Project khác cũng mang `{projectId}` (ví dụ
// `POST /projects/{id}/draft/revisions`); nhận diện bằng PathValue sẽ nuốt luôn
// chúng và làm seal Revision trả lỗi request thay vì chạy.
func handleLibraryRequest(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.LibraryService) bool {
	path := r.URL.Path
	switch {
	case r.Method == http.MethodGet && path == "/api/v1/programming/libraries":
		handleSearchLibraries(w, r, correlationID, service)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/library/entries") && r.PathValue("projectId") != "":
		handleUpsertLibraryEntry(w, r, correlationID, service)
	case r.Method == http.MethodDelete && strings.Contains(path, "/library/entries/") &&
		r.PathValue("projectId") != "" && r.PathValue("entryId") != "":
		handleDeleteLibraryEntry(w, r, correlationID, service)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/deprecate") &&
		r.PathValue("projectId") != "" && r.PathValue("libraryRevisionId") != "":
		handleDeprecateLibraryRevision(w, r, correlationID, service)
	default:
		return false
	}
	return true
}

func handleSearchLibraries(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.LibraryService) {
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeMappedError(w, programmingapplication.ErrInvalidRequest, correlationID)
			return
		}
		limit = parsed
	}
	page, err := service.SearchLibraries(r.Context(), programmingapplication.SearchLibrariesCommand{
		ProjectID: r.URL.Query().Get("projectId"), Scope: r.URL.Query().Get("scope"),
		Kind: r.URL.Query().Get("kind"), Query: r.URL.Query().Get("q"),
		Cursor: r.URL.Query().Get("cursor"), Limit: limit,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	response := libraryPageResponse{Items: make([]libraryEntryResponse, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, item := range page.Items {
		response.Items = append(response.Items, toLibraryEntryResponse(item))
	}
	writeJSON(w, http.StatusOK, correlationID, response)
}

func handleUpsertLibraryEntry(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.LibraryService) {
	var request upsertLibraryEntryRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	result, err := service.UpsertEntry(r.Context(), requestActor(r), programmingapplication.UpsertLibraryEntryCommand{
		ProjectID: r.PathValue("projectId"), SchemaVersion: request.SchemaVersion, EntryID: request.EntryID,
		Kind: request.Kind, Name: request.Name, Language: request.Language, FeatureState: request.FeatureState,
		Source: request.Source, InterfaceJSON: request.Interface, Dependencies: request.Dependencies,
		StateLayout: request.StateLayout, IfMatch: r.Header.Get("If-Match"),
		IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusOK, correlationID, result)
}

func handleDeleteLibraryEntry(w http.ResponseWriter, r *http.Request, correlationID string, service *programmingapplication.LibraryService) {
	result, err := service.DeleteEntry(r.Context(), requestActor(r), programmingapplication.DeleteLibraryEntryCommand{
		ProjectID: r.PathValue("projectId"), EntryID: r.PathValue("entryId"),
		IfMatch: r.Header.Get("If-Match"), IdempotencyKey: r.Header.Get("X-Idempotency-Key"),
		CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusOK, correlationID, result)
}

func handleDeprecateLibraryRevision(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.LibraryService) {
	var request deprecateLibraryRevisionRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	result, err := service.DeprecateRevision(r.Context(), requestActor(r),
		programmingapplication.DeprecateLibraryRevisionCommand{
			ProjectID: r.PathValue("projectId"), LibraryRevisionID: r.PathValue("libraryRevisionId"),
			SchemaVersion: request.SchemaVersion, IfMatch: r.Header.Get("If-Match"),
			IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
		})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusOK, correlationID, result)
}

func toLibraryEntryResponse(item programmingapplication.LibraryEntryView) libraryEntryResponse {
	dependencies := make([]libraryDependencyResponse, 0, len(item.Dependencies))
	for _, dependency := range item.Dependencies {
		dependencies = append(dependencies, libraryDependencyResponse{EntryID: dependency.EntryID, Version: dependency.Version})
	}
	response := libraryEntryResponse{
		Scope: item.Scope, LibraryRevisionID: item.LibraryRevisionID, LibraryVersion: item.LibraryVersion,
		LibraryState: item.LibraryState, EntryID: item.EntryID, Kind: item.Kind, Name: item.Name,
		Language: item.Language, FeatureState: item.FeatureState, ContentSHA256: item.ContentSHA256,
		Dependencies: dependencies, StateLayoutKnown: item.StateLayoutKnown, StateSizeBytes: item.StateSizeBytes,
	}
	if len(item.InterfaceJSON) > 0 {
		response.Interface = json.RawMessage(item.InterfaceJSON)
		response.Signature = parseLibrarySignature(item.InterfaceJSON)
	}
	return response
}
