package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T61-401` / `ISS-PGM04-11` — bước Check của wizard Create/Edit PROJECT Library.

Triệu chứng: wizard không có cách nào biết một entry sẽ được nhận hay bị từ
chối trước khi bấm Lưu. Đường ghi trả `ErrInvalidRequest` trần — một `400` không
nói TRƯỜNG nào sai — còn vòng phụ thuộc thì không bị chặn ở đường ghi chút nào:
`domain.ValidateLibraryDependencies` chỉ chạy lúc dựng manifest (Seal/Publish),
nên `A -> B` rồi sửa `B -> A` ghi vào Draft trót lọt và chỉ nổ ở lần Seal sau
đó, cách chỗ gây lỗi hàng chục thao tác.

Nguyên nhân gốc: không có MỘT nơi phát biểu "entry này hợp lệ chưa". Mỗi tầng
phát biểu một mẩu (regexp ở store, trần ký tự ở application, chu trình ở
domain), và không tầng nào trả lời được câu hỏi của người dùng.

Cách sửa: gom cả ba mẩu vào `DiagnoseEntry`, và bắt CẢ hai đường — Check (dry
run, không ghi) lẫn Upsert (ghi thật) — đi qua đúng hàm đó. Đây là điều làm cho
Check là authoritative chứ không phải một bản sao lạc quan ở client: nếu Check
nói sạch mà Save vẫn 400 thì đó là một lỗi thấy được ngay bằng test, chứ không
phải hai bộ luật lặng lẽ trôi khỏi nhau.
*/

// LibraryEntryDiagnostic gắn một phát hiện vào ĐÚNG một trường của form. `Field`
// dùng đúng tên field trên dây (`name`, `source`, `dependencies`, ...) để wizard
// đặt được thông báo cạnh ô nhập thay vì dồn tất cả vào một dải lỗi chung.
type LibraryEntryDiagnostic struct {
	Field   string
	Code    string
	Message string
	// Blocking = false vẫn hiện lên màn hình nhưng không chặn Lưu. Trường này
	// tồn tại để cảnh báo không bị âm thầm nâng thành lỗi chặn: một cảnh báo
	// chặn được Lưu thì người dùng không có đường đi tiếp.
	Blocking bool
}

const (
	LibraryDiagSchema           = "LIB_SCHEMA_INVALID"
	LibraryDiagProject          = "LIB_PROJECT_INVALID"
	LibraryDiagEntryID          = "LIB_ENTRY_ID_INVALID"
	LibraryDiagName             = "LIB_NAME_INVALID"
	LibraryDiagNameTaken        = "LIB_NAME_TAKEN"
	LibraryDiagKind             = "LIB_KIND_INVALID"
	LibraryDiagLanguage         = "LIB_LANGUAGE_INVALID"
	LibraryDiagFeatureState     = "LIB_FEATURE_STATE_DENIED"
	LibraryDiagSource           = "LIB_SOURCE_INVALID"
	LibraryDiagSourceJSON       = "LIB_SOURCE_NOT_JSON"
	LibraryDiagInterface        = "LIB_INTERFACE_INVALID"
	LibraryDiagCategory         = "LIB_CATEGORY_INVALID"
	LibraryDiagDescription      = "LIB_DESCRIPTION_INVALID"
	LibraryDiagTags             = "LIB_TAGS_INVALID"
	LibraryDiagStateLayout      = "LIB_STATE_LAYOUT_INVALID"
	LibraryDiagDependencyID     = "LIB_DEPENDENCY_ID_INVALID"
	LibraryDiagDependencySelf   = "LIB_DEPENDENCY_SELF"
	LibraryDiagDependencyDup    = "LIB_DEPENDENCY_DUPLICATE"
	LibraryDiagDependencyUnknwn = "LIB_DEPENDENCY_UNKNOWN"
	LibraryDiagDependencyCycle  = "LIB_DEPENDENCY_CYCLE"
)

// LibraryEntryCheckResult là câu trả lời của một lần Check. `Blocking` được TÍNH
// từ danh sách chứ không do caller tự suy: một client đọc mảng rỗng thành "sạch"
// nhưng quên xét severity sẽ cho Lưu đúng lúc không được phép.
type LibraryEntryCheckResult struct {
	Diagnostics []LibraryEntryDiagnostic
	Blocking    bool
	// LibraryRevisionID là Draft library SẼ nhận thay đổi. Rỗng nghĩa là Project
	// chưa mở Draft library nào — lần ghi đầu tiên sẽ tự mở, và bước Review phải
	// nói ra điều đó thay vì hiện một ô trống.
	LibraryRevisionID string
	LibraryVersion    string
}

// CheckEntry là DRY RUN: cùng luật, không ghi gì. Nó không nhận `IfMatch` và
// không sinh audit — một lần bấm "Kiểm tra" không được tiêu ETag của Draft, nếu
// không người dùng phải tải lại trang giữa chừng wizard.
func (s *LibraryService) CheckEntry(ctx context.Context, actor Actor,
	command UpsertLibraryEntryCommand) (LibraryEntryCheckResult, error) {
	if !validText(actor.ID, 1, 128) || !validText(actor.Role, 1, 32) {
		return LibraryEntryCheckResult{}, ErrInvalidRequest
	}
	if !isUUID(command.ProjectID) {
		return LibraryEntryCheckResult{}, ErrInvalidRequest
	}
	if _, err := s.store.GetProject(ctx, command.ProjectID); err != nil {
		return LibraryEntryCheckResult{}, err
	}
	diagnostics, _, target, err := s.DiagnoseEntry(ctx, command)
	if err != nil {
		return LibraryEntryCheckResult{}, err
	}
	result := LibraryEntryCheckResult{Diagnostics: diagnostics,
		LibraryRevisionID: target.DraftRevisionID, LibraryVersion: target.Version}
	for _, diagnostic := range diagnostics {
		if diagnostic.Blocking {
			result.Blocking = true
			break
		}
	}
	return result, nil
}

/*
DiagnoseEntry trả (chẩn đoán, thẻ đã chuẩn hoá, Draft library đích).

Thẻ đi ra ngoài vì đường ghi phải dùng ĐÚNG bản đã chuẩn hoá ở đây: hash ngữ
nghĩa của idempotency băm payload, nên chuẩn hoá hai lần ở hai chỗ khác nhau sẽ
làm hai lần gửi cùng ý định ra hai hash và biến một replay thành xung đột.

Lỗi trả về (khác nil) chỉ dành cho sự cố hạ tầng. Dữ liệu người dùng sai KHÔNG
phải lỗi ở đây — nó là một phần tử trong danh sách chẩn đoán, vì bước Check cần
liệt kê MỌI chỗ sai một lượt chứ không dừng ở chỗ đầu tiên.
*/
func (s *LibraryService) DiagnoseEntry(ctx context.Context, command UpsertLibraryEntryCommand) (
	[]LibraryEntryDiagnostic, []string, libraryWriteTarget, error) {
	diagnostics := make([]LibraryEntryDiagnostic, 0, 4)
	add := func(field, code, message string) {
		diagnostics = append(diagnostics, LibraryEntryDiagnostic{Field: field, Code: code, Message: message, Blocking: true})
	}

	if command.SchemaVersion != "1.0" {
		add("schemaVersion", LibraryDiagSchema, "schemaVersion phải là \"1.0\".")
	}
	if !isUUID(command.ProjectID) {
		add("projectId", LibraryDiagProject, "projectId phải là UUID v4.")
	}
	if !isUUID(command.EntryID) {
		add("entryId", LibraryDiagEntryID, "entryId phải là UUID v4.")
	}
	if !validText(command.Name, 1, 64) || !programmingstore.ValidLibraryEntryName(command.Name) {
		add("name", LibraryDiagName,
			"Tên phải bắt đầu bằng chữ cái và chỉ gồm chữ, số hoặc gạch dưới, tối đa 64 ký tự.")
	}
	if command.Kind != programmingstore.LibraryKindFunction && command.Kind != programmingstore.LibraryKindFunctionBlock {
		add("kind", LibraryDiagKind, "kind phải là FUNCTION hoặc FUNCTION_BLOCK.")
	}
	if command.Language != "ST" && command.Language != "FBD" {
		add("language", LibraryDiagLanguage, "language phải là ST hoặc FBD.")
	}
	if command.FeatureState != "" && command.FeatureState != "AVAILABLE" {
		add("featureState", LibraryDiagFeatureState,
			"featureState của entry PROJECT chỉ được là AVAILABLE; REVIEW_REQUIRED là cờ của registry SYSTEM.")
	}
	if !validLibrarySource(command.Source) {
		add("source", LibraryDiagSource,
			"Mã nguồn phải là UTF-8 dài 1..65536 byte và không chứa ký tự điều khiển ngoài xuống dòng/tab.")
	} else if command.Language == "FBD" && !isJSONObject([]byte(command.Source)) {
		/* Nhánh FBD phải nói riêng: store ép `canonicalJSONObject` trên
		   `source_blob`, nên một sơ đồ FBD dán nhầm dạng văn bản bị từ chối ở
		   tầng dưới bằng một lỗi SQL/JSON mà lớp HTTP dịch thành 503 "thử lại
		   đi" — bảo người dùng thử lại một thứ không bao giờ thành công. */
		add("source", LibraryDiagSourceJSON, "Nội dung FBD phải là một object JSON.")
	}
	if len(command.InterfaceJSON) > 0 && !isJSONObject(command.InterfaceJSON) {
		add("interface", LibraryDiagInterface, "interface phải là một object JSON.")
	}
	if command.Category != nil && *command.Category != "" && !validText(*command.Category, 1, 32) {
		add("category", LibraryDiagCategory, "Phân loại tối đa 32 ký tự và không chứa ký tự điều khiển.")
	}
	if command.Description != nil && *command.Description != "" && !validText(*command.Description, 1, 512) {
		add("description", LibraryDiagDescription, "Mô tả tối đa 512 ký tự và không chứa ký tự điều khiển.")
	}
	tags, tagErr := normalizeLibraryTags(command.Tags)
	if tagErr != nil {
		add("tags", LibraryDiagTags, "Tối đa 8 thẻ, mỗi thẻ tối đa 24 ký tự và không chứa ký tự điều khiển.")
		tags = nil
	}
	if _, err := libraryStateLayoutFromCommand(command.Kind, command.StateLayout); err != nil {
		add("stateLayout", LibraryDiagStateLayout,
			"stateLayout chỉ hợp lệ với FUNCTION_BLOCK và phải có version khác 0 cùng sha256 32 byte.")
	}

	if !isUUID(command.ProjectID) {
		/* Không hỏi store bằng một `projectId` đã biết là sai: store trả một lỗi
		   không mang sentinel, và lớp HTTP dịch nó thành 503 "thử lại đi" — đúng
		   cái câu trả lời vô nghĩa mà bảng chẩn đoán này sinh ra để thay thế. */
		return diagnostics, tags, libraryWriteTarget{}, nil
	}
	target, err := s.libraryWriteTarget(ctx, command.ProjectID)
	if err != nil {
		return nil, nil, libraryWriteTarget{}, err
	}
	dependencyDiagnostics, err := s.diagnoseDependencies(ctx, command, target)
	if err != nil {
		return nil, nil, libraryWriteTarget{}, err
	}
	diagnostics = append(diagnostics, dependencyDiagnostics...)
	return diagnostics, tags, target, nil
}

/*
libraryWriteTarget trả về revision mà lần GHI kế tiếp sẽ tác động tới.

Không đơn giản là "Draft đang mở". Khi Project vừa Publish xong, nó KHÔNG còn
Draft library nào: lần upsert kế tiếp tự mở một Draft mới bằng cách CLONE bản
PUBLISHED/DEPRECATED gần nhất rồi nâng minor version. Nếu bước Check chỉ nhìn
Draft, nó sẽ nói mọi phụ thuộc "không có trong PROJECT Library" đúng ở trạng
thái phổ biến nhất sau một lần Publish — một lời từ chối sai, cho một entry mà
đường ghi vẫn nhận.

Vì vậy target gồm ba mẩu tách bạch:
  - `EntriesRevisionID` — revision đang MANG entry để dựng đồ thị phụ thuộc;
  - `DraftRevisionID`   — Draft đang mở, rỗng khi lần ghi kế tiếp sẽ tự mở;
  - `Version`           — version mà lần ghi kế tiếp sẽ pin dependency vào.

Thứ tự chọn parent dùng ĐÚNG thứ tự của `ensureProjectLibraryDraftTx`
(`ORDER BY created_at DESC, library_revision_id`), lấy qua `ListLibraryRevisions`
để không có bản SQL thứ hai trôi khỏi bản gốc.
*/
type libraryWriteTarget struct {
	EntriesRevisionID string
	DraftRevisionID   string
	Version           string
}

func (s *LibraryService) libraryWriteTarget(ctx context.Context, projectID string) (libraryWriteTarget, error) {
	draft, err := s.store.FindProjectLibraryDraft(ctx, projectID)
	if err == nil {
		return libraryWriteTarget{EntriesRevisionID: draft.LibraryRevisionID,
			DraftRevisionID: draft.LibraryRevisionID, Version: draft.Version}, nil
	}
	if !errors.Is(err, programmingstore.ErrNotFound) {
		return libraryWriteTarget{}, err
	}
	revisions, err := s.store.ListLibraryRevisions(ctx, projectID, programmingstore.LibraryScopeProject)
	if err != nil {
		return libraryWriteTarget{}, err
	}
	for _, revision := range revisions {
		if revision.State != programmingstore.LibraryStatePublished &&
			revision.State != programmingstore.LibraryStateDeprecated {
			continue
		}
		next, err := domain.NextProjectLibraryMinorVersion(revision.Version)
		if err != nil {
			return libraryWriteTarget{}, err
		}
		return libraryWriteTarget{EntriesRevisionID: revision.LibraryRevisionID, Version: next}, nil
	}
	// Project chưa có PROJECT Library nào. Lần ghi đầu tiên mở Draft `1.0.0`
	// rỗng — không phải sự cố, nên không trả lỗi.
	return libraryWriteTarget{Version: "1.0.0"}, nil
}

/*
diagnoseDependencies dựng bộ entry GIẢ ĐỊNH — Draft hiện tại với entry đang soạn
đã thay vào — rồi gọi đúng `domain.ValidateLibraryDependencies` mà Seal dùng.

Chạy lại chính hàm của Seal là điểm mấu chốt. Viết một phép dò chu trình thứ hai
ở đây sẽ cho hai câu trả lời khác nhau trên cùng một đồ thị ngay lần đầu một
trong hai đổi luật, và bên thua là bên nói "được" — tức là người dùng lưu xong
mới biết Revision không Seal được.

Version của dependency được PIN LẠI theo revision trước khi kiểm, giống hệt việc
`UpsertProjectLibraryEntry` làm trong transaction: client chỉ có snapshot cũ nên
version nó gửi có thể lệch, và bắt lỗi ở đó là bắt một lỗi máy chủ tự sửa.
*/
func (s *LibraryService) diagnoseDependencies(ctx context.Context, command UpsertLibraryEntryCommand,
	target libraryWriteTarget) ([]LibraryEntryDiagnostic, error) {
	diagnostics := make([]LibraryEntryDiagnostic, 0, 2)
	seen := make(map[string]struct{}, len(command.Dependencies))
	wanted := make([]string, 0, len(command.Dependencies))
	for _, dependency := range command.Dependencies {
		if !isUUID(dependency.EntryID) {
			diagnostics = append(diagnostics, LibraryEntryDiagnostic{Field: "dependencies",
				Code: LibraryDiagDependencyID, Blocking: true,
				Message: fmt.Sprintf("Phụ thuộc %q không phải UUID v4.", dependency.EntryID)})
			continue
		}
		key := strings.ToUpper(dependency.EntryID)
		if _, duplicate := seen[key]; duplicate {
			diagnostics = append(diagnostics, LibraryEntryDiagnostic{Field: "dependencies",
				Code: LibraryDiagDependencyDup, Blocking: true,
				Message: fmt.Sprintf("Phụ thuộc %s được khai hai lần.", dependency.EntryID)})
			continue
		}
		seen[key] = struct{}{}
		if strings.EqualFold(dependency.EntryID, command.EntryID) {
			diagnostics = append(diagnostics, LibraryEntryDiagnostic{Field: "dependencies",
				Code: LibraryDiagDependencySelf, Blocking: true,
				Message: "Một khối không thể phụ thuộc vào chính nó."})
			continue
		}
		wanted = append(wanted, dependency.EntryID)
	}
	if target.EntriesRevisionID == "" {
		for _, entryID := range wanted {
			diagnostics = append(diagnostics, LibraryEntryDiagnostic{Field: "dependencies",
				Code: LibraryDiagDependencyUnknwn, Blocking: true,
				Message: fmt.Sprintf("Phụ thuộc %s không có trong PROJECT Library của Project này.", entryID)})
		}
		return diagnostics, nil
	}
	stored, err := s.store.ListLibraryEntries(ctx, target.EntriesRevisionID)
	if err != nil {
		return nil, err
	}
	present := make(map[string]struct{}, len(stored))
	for _, entry := range stored {
		present[strings.ToUpper(entry.EntryID)] = struct{}{}
	}
	resolved := make([]domain.LibraryDependency, 0, len(wanted))
	for _, entryID := range wanted {
		if _, exists := present[strings.ToUpper(entryID)]; !exists {
			diagnostics = append(diagnostics, LibraryEntryDiagnostic{Field: "dependencies",
				Code: LibraryDiagDependencyUnknwn, Blocking: true,
				Message: fmt.Sprintf("Phụ thuộc %s không có trong PROJECT Library của Project này.", entryID)})
			continue
		}
		resolved = append(resolved, domain.LibraryDependency{EntryID: entryID, Version: target.Version})
	}
	if len(diagnostics) > 0 {
		// Đồ thị còn cạnh treo thì phép dò chu trình chỉ báo lại đúng cạnh đó
		// dưới một cái tên khác. Trả về sớm để người dùng sửa một lỗi thay vì
		// đọc hai câu nói về cùng một dòng.
		return diagnostics, nil
	}
	graph := make([]domain.LibraryEntry, 0, len(stored)+1)
	for _, entry := range stored {
		if strings.EqualFold(entry.EntryID, command.EntryID) {
			continue
		}
		dependencies := make([]domain.LibraryDependency, 0, len(entry.Dependencies))
		for _, dependency := range entry.Dependencies {
			dependencies = append(dependencies, domain.LibraryDependency{
				EntryID: dependency.EntryID, Version: target.Version})
		}
		graph = append(graph, domain.LibraryEntry{EntryID: entry.EntryID, Name: entry.Name, Dependencies: dependencies})
	}
	graph = append(graph, domain.LibraryEntry{EntryID: command.EntryID, Name: command.Name, Dependencies: resolved})
	sort.Slice(graph, func(left, right int) bool { return graph[left].EntryID < graph[right].EntryID })
	if err := domain.ValidateLibraryDependencies(target.Version, graph); err != nil {
		var resolution *domain.LibraryResolutionError
		if errors.As(err, &resolution) && errors.Is(resolution.Cause, domain.ErrLibraryDependencyCycle) {
			diagnostics = append(diagnostics, LibraryEntryDiagnostic{Field: "dependencies",
				Code: LibraryDiagDependencyCycle, Blocking: true,
				Message: fmt.Sprintf("Phụ thuộc tạo thành vòng: %s.", strings.Join(resolution.Cycle, " → "))})
			return diagnostics, nil
		}
		return nil, err
	}
	return diagnostics, nil
}

// isJSONObject nói "có phải một object JSON không", không nói "có parse được
// không": `[]`, `"x"` và `3` đều là JSON hợp lệ nhưng store chỉ nhận object, nên
// nhận chúng ở đây là đẩy một lỗi 400 xuống thành một lỗi 503 ở tầng dưới.
func isJSONObject(raw []byte) bool {
	trimmed := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(trimmed, "{") {
		return false
	}
	var document map[string]json.RawMessage
	return json.Unmarshal([]byte(trimmed), &document) == nil
}
