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
	/* `T61-101` — metadata TRÌNH BÀY, tất cả `omitempty` vì hợp đồng là
	   ADDITIVE: client cũ bỏ qua field lạ và vẫn chạy. Con trỏ chứ không phải
	   chuỗi để `nil` ("chưa ai điền") tới FE dưới dạng field VẮNG, và màn hình
	   render `—` thay vì một ô trống trông như đã điền rỗng. */
	Category    *string `json:"category,omitempty"`
	Description *string `json:"description,omitempty"`
	/* `tags` cũng `omitempty`: mảng `nil` là "chưa ai gắn thẻ" và tới FE dưới
	   dạng field VẮNG. Không có trạng thái thứ ba cho mảng rỗng — đường ghi quy
	   `[]` về `nil`, vì "không thẻ nào" và "chưa gắn thẻ" là cùng một câu. */
	Tags               []string `json:"tags,omitempty"`
	PresentationSHA256 string   `json:"presentationSha256,omitempty"`
	/* `compatibility` KHÔNG `omitempty`: nó luôn có mặt, và mặc định fail-closed
	   là `UNKNOWN`. Cho nó vắng được nghĩa là một client sẽ đọc "vắng" thành
	   "không sao" — đúng cái kết luận `UNKNOWN` sinh ra để chặn. */
	Compatibility libraryCompatibilityResponse `json:"compatibility"`
}

/*
libraryCompatibilityResponse — `LOCK-PGM04-CONTRACT-001` §4.

Ba trường sau là con trỏ và KHÔNG `omitempty`, nên chúng luôn xuất hiện trên
dây, có thể là `null`. `null` nghĩa là "máy chủ đã xét và chưa đo được"; một
trường VẮNG thì client không phân biệt được với "máy chủ cũ chưa biết trường
này". Với một read model mà cả mục đích là nói ra chỗ mình chưa biết, khác biệt
ấy chính là nội dung.

`reason` chỉ khác `null` khi `state` khác `COMPATIBLE`.
*/
type libraryCompatibilityResponse struct {
	State            string  `json:"state"`
	RequiredVersion  *string `json:"requiredVersion"`
	AvailableVersion *string `json:"availableVersion"`
	Reason           *string `json:"reason"`
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
	/* `T61-401` — metadata TRÌNH BÀY trên đường GHI.
	 *
	 * Con trỏ chứ không phải chuỗi để phân biệt field VẮNG với chuỗi RỖNG:
	 * upsert ghi đè toàn phần, nên vắng nghĩa là "entry này không có metadata"
	 * và rỗng nghĩa là "đã điền rồi, nội dung rỗng". Cột store cũng phân biệt
	 * hai thứ đó (`NULL` khác `''`), và đọc lên PGM-04 render `NULL` thành `—`
	 * kèm lý do chứ không thành ô trống. Dùng `string` ở đây sẽ làm mọi entry
	 * chưa phân loại trông như đã phân loại vào một nhóm tên rỗng. */
	Category    *string `json:"category,omitempty"`
	Description *string `json:"description,omitempty"`
	/* `T61-101` — thẻ trên đường GHI. Máy chủ CHUẨN HOÁ (trim, chữ thường, khử
	   trùng lặp, sắp tăng dần) rồi mới lưu, nên read-back có thể khác payload
	   về hình thức nhưng không khác về nội dung. Vượt trần thì TỪ CHỐI, không
	   cắt bớt. */
	Tags []string `json:"tags,omitempty"`
}

/*
`T61-401` — hình dạng câu trả lời của bước Check.

	`diagnostics` KHÔNG `omitempty`: mảng rỗng là câu trả lời "đã kiểm, sạch", và
	để nó vắng thì client không phân biệt được với "máy chủ cũ chưa kiểm gì".
*/
/*
`T61-404` — hình dạng câu trả lời của đường đọc mã nguồn.

`source` là con trỏ và `omitempty`: field VẮNG nghĩa là KHÔNG CÓ mã nguồn để
đọc, còn một chuỗi rỗng sẽ đọc như "khối này có mã nguồn, và nó rỗng" — câu thứ
hai là câu dẫn tới một lần ghi đè mất mã.

`availability` KHÔNG `omitempty`: nó luôn có mặt và là thứ client phải xét trước
khi hiển thị bất cứ gì. Cho nó vắng được nghĩa là một client sẽ đọc "vắng" thành
"không sao" — đúng kết luận mà `HASH_MISMATCH` sinh ra để chặn.
*/
type libraryEntrySourceResponse struct {
	Scope             string          `json:"scope"`
	LibraryRevisionID string          `json:"libraryRevisionId"`
	LibraryVersion    string          `json:"libraryVersion"`
	LibraryState      string          `json:"libraryState"`
	EntryID           string          `json:"entryId"`
	Name              string          `json:"name"`
	Kind              string          `json:"kind"`
	Language          string          `json:"language,omitempty"`
	ContentSHA256     string          `json:"contentSha256"`
	Availability      string          `json:"availability"`
	Source            *string         `json:"source,omitempty"`
	Interface         json.RawMessage `json:"interface,omitempty"`
	// Chỉ khác rỗng khi `availability` khác `AVAILABLE`.
	Reason string `json:"reason,omitempty"`
}

type libraryEntryDiagnosticResponse struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
	/* `severity` là chuỗi chứ không phải cờ boolean: thêm một mức thứ ba sau này
	   không được làm client cũ đọc nó thành "không chặn". */
	Severity string `json:"severity"`
}

type libraryEntryCheckResponse struct {
	Blocking    bool                             `json:"blocking"`
	Diagnostics []libraryEntryDiagnosticResponse `json:"diagnostics"`
	/* Draft library SẼ nhận thay đổi. Rỗng nghĩa là Project chưa mở Draft
	   library nào và lần ghi đầu tiên sẽ tự mở — bước Review phải nói ra điều
	   đó thay vì hiện một ô trống trông như dữ liệu thiếu. */
	LibraryRevisionID string `json:"libraryRevisionId,omitempty"`
	LibraryVersion    string `json:"libraryVersion,omitempty"`
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
	case r.Method == http.MethodGet && path == "/api/v1/programming/library-usages":
		handleLibraryUsage(w, r, correlationID, service)
	case r.Method == http.MethodGet && path == "/api/v1/programming/library-entry-source":
		handleLibraryEntrySource(w, r, correlationID, service)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/library/entries/check") && r.PathValue("projectId") != "":
		/* Nhánh Check đứng TRƯỚC nhánh upsert và so hậu tố đầy đủ. Đảo thứ tự
		   hoặc so `Contains` sẽ làm một lần bấm "Kiểm tra" rơi vào đường ghi —
		   đúng thứ mà dry run sinh ra để tránh. */
		handleCheckLibraryEntry(w, r, correlationID, service)
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
		Category: r.URL.Query().Get("category"),
		Cursor:   r.URL.Query().Get("cursor"), Limit: limit,
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

/*
`T61-404` — đọc mã nguồn của MỘT entry, theo đúng một cặp (revision, entry).

Đường dẫn PHẲNG với hai định danh ở query, cùng lý do đã ghi ở
`handleLibraryUsage`: định danh revision của SYSTEM là một chuỗi có dấu hai chấm
(`PROGRAMMING-POU-LIBRARY-REGISTRY-V1:rev-a.3:<hash>`), nhét nó vào path segment
sẽ đẻ ra một lớp lỗi encoding không cần thiết.

Route này là ĐỌC: quyền `read`, mọi vai đã đăng nhập đều gọi được. Đọc được mã
nguồn của khối mình sắp chèn là điều kiện để quyết định có chèn hay không; chặn
nó lại làm người vận hành phải đoán.

Cả hai tham số đều BẮT BUỘC, và không có nhánh "lấy bản mới nhất". Một Preview
lặng lẽ hiển thị bản mới nhất khi người dùng mở một bản cũ là cách họ đọc sai thứ
thiết bị đang chạy mà không có dấu hiệu nào.
*/
func handleLibraryEntrySource(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.LibraryService) {
	view, err := service.EntrySource(r.Context(), programmingapplication.LibraryEntrySourceCommand{
		LibraryRevisionID: r.URL.Query().Get("libraryRevisionId"),
		EntryID:           r.URL.Query().Get("entryId"),
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	response := libraryEntrySourceResponse{
		Scope: view.Scope, LibraryRevisionID: view.LibraryRevisionID, LibraryVersion: view.LibraryVersion,
		LibraryState: view.LibraryState, EntryID: view.EntryID, Name: view.Name, Kind: view.Kind,
		Language: view.Language, ContentSHA256: view.ContentSHA256, Availability: view.Availability,
		Source: view.Source, Reason: view.Reason,
		Interface: programmingapplication.LibraryEntrySourceInterface(view.InterfaceJSON),
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
		StateLayout: request.StateLayout, Category: request.Category, Description: request.Description,
		Tags:           request.Tags,
		IfMatch:        r.Header.Get("If-Match"),
		IdempotencyKey: r.Header.Get("X-Idempotency-Key"), CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeMutation(w, http.StatusOK, correlationID, result)
}

/*
`T61-401` — bước Check của wizard Create/Edit PROJECT Library.

Đây là DRY RUN: cùng payload với upsert, không `If-Match`, không idempotency key,
không ghi gì. Bắt nó mang `If-Match` sẽ tiêu ETag Draft cho một lần bấm "Kiểm
tra" và buộc người dùng tải lại trang giữa chừng wizard.

Trả `200` kể cả khi có lỗi chặn. Chẩn đoán là NỘI DUNG của câu trả lời, không
phải một sự cố: trả `400` ở đây sẽ khiến client coi bảng chẩn đoán là thân lỗi
và mất đúng danh sách trường mà người dùng cần đọc.
*/
func handleCheckLibraryEntry(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.LibraryService) {
	var request upsertLibraryEntryRequest
	if err := decodeStrictRequest(r, &request); err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	result, err := service.CheckEntry(r.Context(), requestActor(r), programmingapplication.UpsertLibraryEntryCommand{
		ProjectID: r.PathValue("projectId"), SchemaVersion: request.SchemaVersion, EntryID: request.EntryID,
		Kind: request.Kind, Name: request.Name, Language: request.Language, FeatureState: request.FeatureState,
		Source: request.Source, InterfaceJSON: request.Interface, Dependencies: request.Dependencies,
		StateLayout: request.StateLayout, Category: request.Category, Description: request.Description,
		Tags: request.Tags, CorrelationID: correlationID,
	})
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	response := libraryEntryCheckResponse{Blocking: result.Blocking,
		LibraryRevisionID: result.LibraryRevisionID, LibraryVersion: result.LibraryVersion,
		Diagnostics: make([]libraryEntryDiagnosticResponse, 0, len(result.Diagnostics))}
	for _, diagnostic := range result.Diagnostics {
		response.Diagnostics = append(response.Diagnostics, libraryEntryDiagnosticResponse{
			Field: diagnostic.Field, Code: diagnostic.Code, Message: diagnostic.Message,
			Severity: libraryDiagnosticSeverity(diagnostic.Blocking)})
	}
	writeJSON(w, http.StatusOK, correlationID, response)
}

func libraryDiagnosticSeverity(blocking bool) string {
	if blocking {
		return "BLOCKING"
	}
	return "WARNING"
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
		Category: item.Category, Description: item.Description, Tags: item.Tags,
		PresentationSHA256: item.PresentationSHA256,
		Compatibility: libraryCompatibilityResponse{
			State: item.Compatibility.State, RequiredVersion: item.Compatibility.RequiredVersion,
			AvailableVersion: item.Compatibility.AvailableVersion, Reason: item.Compatibility.Reason,
		},
	}
	/* Hàng rào fail-closed CUỐI của đường đọc.
	 *
	 * Mọi chỗ dựng `LibraryEntryView` hôm nay đều gán `Compatibility`, nhưng
	 * `LibraryCompatibility{}` zero-value có `State` là chuỗi RỖNG — không phải
	 * `UNKNOWN`. Một chỗ dựng mới quên gán sẽ gửi `state: ""` ra dây, và client
	 * so `state !== 'COMPATIBLE'` thì đúng, còn client so `state === 'UNKNOWN'`
	 * thì trượt và im lặng coi như không có cảnh báo. Quy chuỗi rỗng về
	 * `UNKNOWN` ở đây làm mặc định của Go trùng với mặc định của hợp đồng. */
	if response.Compatibility.State == "" {
		response.Compatibility.State = programmingapplication.LibraryCompatibleUnknown
	}
	if len(item.InterfaceJSON) > 0 {
		response.Interface = json.RawMessage(item.InterfaceJSON)
		response.Signature = parseLibrarySignature(item.InterfaceJSON)
	}
	/* SYSTEM entry mang chữ ký ở `SignatureJSON`, KHÔNG ở `InterfaceJSON`
	 * (`domain.SystemLibraryEntries()`). Thiếu nhánh này thì cả 46 entry SYSTEM
	 * ra khỏi API mà không có cổng lẫn category, và Thư viện nhanh hiện "Thiếu
	 * chữ ký từ thiết bị" cho mọi mục — một câu ĐÚNG về dữ liệu nó nhận được,
	 * nhưng SAI về thiết bị: chữ ký vẫn nằm nguyên trong binary.
	 *
	 * `interface` cố ý KHÔNG được điền từ đây. `interface` là chữ ký THÔ của
	 * PROJECT entry do người dùng nạp; `signature` là chữ ký ĐÃ PHÂN GIẢI. Trộn
	 * hai khái niệm sẽ làm client không phân biệt được nguồn nào tự khai và
	 * nguồn nào máy chủ bảo chứng. */
	if response.Signature == nil && len(item.SignatureJSON) > 0 {
		response.Signature = parseLibrarySignature(item.SignatureJSON)
	}
	return response
}

/*
`T61-105` — `GET /api/v1/programming/library-usages`.

Đường dẫn phẳng với `libraryRevisionId` ở query chứ không ở path: định danh
revision của SYSTEM là một chuỗi có dấu hai chấm
(`PROGRAMMING-POU-LIBRARY-REGISTRY-V1:rev-a.3:<hash>`), và nhét nó vào path
segment sẽ đẻ ra một lớp lỗi encoding không cần thiết.

Route này là ĐỌC: quyền `read`, mọi vai đã đăng nhập đều gọi được. Used-In là
thứ người ta cần trước khi quyết định có sửa hay không — chặn nó lại làm người
vận hành phải đoán.
*/
func handleLibraryUsage(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.LibraryService) {

	view, err := service.Usage(r.Context(), programmingapplication.LibraryUsageCommand{
		LibraryRevisionID: r.URL.Query().Get("libraryRevisionId"),
		EntryID:           r.URL.Query().Get("entryId"),
		Scope:             r.URL.Query().Get("scope"),
		SealedCursor:      r.URL.Query().Get("sealedCursor"),
		DraftCursor:       r.URL.Query().Get("draftCursor"),
	})
	/* Dịch lỗi THẬT, không quy tất cả về 400.
	 *
	 * Bản trước ghi `writeMappedError(w, ErrInvalidRequest, ...)` bất kể `err`
	 * là gì, nên store hỏng cũng ra 400 "request không hợp lệ" — bảo người dùng
	 * sửa một request vốn đúng, và giấu mất sự cố hạ tầng khỏi cả log lẫn mắt
	 * người vận hành. Lớp application giờ trả sentinel (`ErrInvalidRequest`,
	 * `ErrInvalidCursor`) cho lỗi request, nên `writeMappedError` phân biệt
	 * được 400 với 503. */
	if err != nil {
		writeMappedError(w, err, correlationID)
		return
	}
	writeJSON(w, http.StatusOK, correlationID, view)
}
