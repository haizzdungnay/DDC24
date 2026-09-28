package application

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
U-06 (REC-DDC-FIELD-USE-20260927) — POU ST gọi khối của Thư viện PROJECT phải có
entry đó trong `objects[].dependencies`, nếu không Check báo `ST-LIB-001`. Chỉ
trình soạn khối thư viện ghi mảng này; chèn khối vào POU ST (Quick Library) và
mọi client API chỉ sửa chữ, nên người dùng buộc phải chép khối vào Cây POU và mất
quản lý phiên bản.

Lưu Draft nay tự thêm dependency cho mọi lời gọi/khai báo instance trỏ tới một
entry FUNCTION/FUNCTION_BLOCK của Thư viện PROJECT. Chỉ THÊM, không gỡ: một
dependency thừa chỉ là một bản ghi usage, còn gỡ nhầm thì Check hỏng. Version
không ghi ở đây — Seal vẫn ghim theo revision thư viện do service resolve, đúng
như dependency khai tay.
*/

// Op có thể đổi mã nguồn của một POU. Chỉ các lần lưu này mới chạy phép suy,
// để một PATCH không liên quan (đặt tag, sửa binding) không lặng lẽ đổi POU.
var sourceChangingDraftOps = []string{"replaceProgramSource", "upsertObject", "upsertProgram", "duplicateObject"}

var (
	stBlockComment  = regexp.MustCompile(`(?s)\(\*.*?\*\)`)
	stLineComment   = regexp.MustCompile(`//[^\n]*`)
	stStringLiteral = regexp.MustCompile(`'[^']*'|"[^"]*"`)
	stCallName      = regexp.MustCompile(`\b([A-Za-z_][A-Za-z0-9_]*)\s*\(`)
	stInstanceType  = regexp.MustCompile(`:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|:=)`)
)

type projectLibraryEntryRef struct {
	EntryID string
	Name    string
}

// stReferencedNames trả tên (viết hoa) mọi lời gọi `Name(` và mọi kiểu instance
// `x : Name;` trong mã ST, sau khi bỏ chú thích và chuỗi.
func stReferencedNames(source string) map[string]struct{} {
	cleaned := stBlockComment.ReplaceAllString(source, " ")
	cleaned = stLineComment.ReplaceAllString(cleaned, " ")
	cleaned = stStringLiteral.ReplaceAllString(cleaned, " ")
	names := map[string]struct{}{}
	for _, pattern := range []*regexp.Regexp{stCallName, stInstanceType} {
		for _, match := range pattern.FindAllStringSubmatch(cleaned, -1) {
			names[strings.ToUpper(match[1])] = struct{}{}
		}
	}
	return names
}

// inferProjectLibraryDependencies thêm vào `objects[].dependencies` của mỗi POU
// ST các entry Thư viện PROJECT mà mã của nó tham chiếu. Tên trùng một POU trong
// Draft thì POU thắng (đó là thứ compiler phân giải), nên không thêm. Trả true
// khi có object đổi.
func inferProjectLibraryDependencies(document map[string]any, entries []projectLibraryEntryRef) bool {
	if len(entries) == 0 {
		return false
	}
	byName := make(map[string]string, len(entries))
	for _, entry := range entries {
		byName[strings.ToUpper(entry.Name)] = entry.EntryID
	}
	objects := collectionOf(document, "objects")
	draftNames := make(map[string]struct{}, len(objects))
	for _, object := range objects {
		if name, ok := object["name"].(string); ok {
			draftNames[strings.ToUpper(name)] = struct{}{}
		}
	}
	changed := false
	for _, object := range objects {
		language, _ := object["language"].(string)
		source, _ := object["source"].(string)
		if language != "ST" || source == "" {
			continue
		}
		existing := map[string]struct{}{}
		current, _ := object["dependencies"].([]any)
		for _, item := range current {
			if id, ok := item.(string); ok {
				existing[strings.ToLower(id)] = struct{}{}
			}
		}
		added := make([]string, 0)
		for name := range stReferencedNames(source) {
			entryID, found := byName[name]
			if !found {
				continue
			}
			if _, shadowed := draftNames[name]; shadowed {
				continue
			}
			if _, present := existing[strings.ToLower(entryID)]; present {
				continue
			}
			existing[strings.ToLower(entryID)] = struct{}{}
			added = append(added, entryID)
		}
		if len(added) == 0 {
			continue
		}
		sort.Strings(added)
		next := append([]any(nil), current...)
		for _, id := range added {
			next = append(next, id)
		}
		object["dependencies"] = next
		changed = true
	}
	return changed
}

// projectLibraryEntriesForDraft — entry FUNCTION/FUNCTION_BLOCK của Thư viện
// PROJECT mà Seal sẽ ghim: bản DRAFT nếu có, nếu không thì bản PUBLISHED mới
// nhất (cùng thứ tự với `SealRevision`). Project chưa có thư viện ⇒ rỗng.
func (s *ProjectService) projectLibraryEntriesForDraft(ctx context.Context, projectID string) ([]projectLibraryEntryRef, error) {
	libraryRevisionID := ""
	if draft, err := s.store.FindProjectLibraryDraft(ctx, projectID); err == nil {
		libraryRevisionID = draft.LibraryRevisionID
	} else if !errors.Is(err, programmingstore.ErrNotFound) {
		return nil, err
	} else {
		revisions, listErr := s.store.ListLibraryRevisions(ctx, projectID, programmingstore.LibraryScopeProject)
		if listErr != nil {
			return nil, listErr
		}
		for _, candidate := range revisions {
			if candidate.State == programmingstore.LibraryStatePublished {
				libraryRevisionID = candidate.LibraryRevisionID
				break
			}
		}
	}
	if libraryRevisionID == "" {
		return nil, nil
	}
	entries, err := s.store.ListLibraryEntries(ctx, libraryRevisionID)
	if err != nil {
		return nil, err
	}
	refs := make([]projectLibraryEntryRef, 0, len(entries))
	for _, entry := range entries {
		if entry.Kind != programmingstore.LibraryKindFunction && entry.Kind != programmingstore.LibraryKindFunctionBlock {
			continue
		}
		refs = append(refs, projectLibraryEntryRef{EntryID: entry.EntryID, Name: entry.Name})
	}
	return refs, nil
}

// withInferredLibraryDependencies chạy phép suy trên Draft vừa áp operation, chỉ
// khi batch có op đổi mã nguồn.
func (s *ProjectService) withInferredLibraryDependencies(ctx context.Context, projectID string, content []byte,
	operations []json.RawMessage) ([]byte, error) {
	touchesSource := false
	for _, op := range sourceChangingDraftOps {
		if draftOperationsContain(operations, op) {
			touchesSource = true
			break
		}
	}
	if !touchesSource {
		return content, nil
	}
	entries, err := s.projectLibraryEntriesForDraft(ctx, projectID)
	if err != nil || len(entries) == 0 {
		return content, err
	}
	var document map[string]any
	if err := json.Unmarshal(content, &document); err != nil {
		return nil, err
	}
	if !inferProjectLibraryDependencies(document, entries) {
		return content, nil
	}
	return json.Marshal(document)
}
