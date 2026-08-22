package application

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"

	programmingstore "mkddc-web/internal/programming/store"
)

type RevisionChange struct {
	ObjectID     string  `json:"objectId"`
	Kind         string  `json:"kind"`
	ChangeType   string  `json:"changeType"`
	Category     string  `json:"category"`
	BeforeSHA256 *string `json:"beforeSha256"`
	AfterSHA256  *string `json:"afterSha256"`
}

type RevisionImpactGroup struct {
	Status string   `json:"status"`
	Items  []string `json:"items"`
}

type RevisionImpact struct {
	ImpactRef            string              `json:"impactRef"`
	Retain               RevisionImpactGroup `json:"retain"`
	ActiveOverrides      RevisionImpactGroup `json:"activeOverrides"`
	Cutover              RevisionImpactGroup `json:"cutover"`
	OutputMappingChanges RevisionImpactGroup `json:"outputMappingChanges"`
	// T59-502 — bốn nhóm cho mô hình đa Program. Bốn nhóm trên chỉ phủ Rev A
	// một Program, nên trước bản vá một Revision đổi Published Signal, đổi
	// Control Library, thêm/bớt Program, hay chạm đúng Program đang Enabled đều
	// đi qua Commission mà KHÔNG hỏi acknowledgement nào.
	PublishedSignals RevisionImpactGroup `json:"publishedSignals"`
	ControlLibrary   RevisionImpactGroup `json:"controlLibrary"`
	ProgramSet       RevisionImpactGroup `json:"programSet"`
	EnableIntent     RevisionImpactGroup `json:"enableIntent"`
}

type RevisionChangesView struct {
	FromRevisionID string           `json:"fromRevisionId"`
	ToRevisionID   string           `json:"toRevisionId"`
	Impact         RevisionImpact   `json:"impact"`
	Changes        []RevisionChange `json:"changes"`
}

func (s *ProjectService) GetRevisionChanges(ctx context.Context, fromRevisionID, toRevisionID string) (RevisionChangesView, error) {
	if (fromRevisionID != "none" && !isUUID(fromRevisionID)) || !isUUID(toRevisionID) || fromRevisionID == toRevisionID {
		return RevisionChangesView{}, ErrInvalidRequest
	}
	after, err := s.store.GetRevision(ctx, toRevisionID)
	if err != nil {
		return RevisionChangesView{}, err
	}
	var beforeObjects []programmingstore.RevisionObject
	if fromRevisionID != "none" {
		before, readErr := s.store.GetRevision(ctx, fromRevisionID)
		if readErr != nil {
			return RevisionChangesView{}, readErr
		}
		if before.Revision.ProjectID != after.Revision.ProjectID {
			return RevisionChangesView{}, ErrInvalidRequest
		}
		beforeObjects = before.Objects
	}
	changes := compareRevisionObjects(beforeObjects, after.Objects)
	byCategory := map[string][]string{}
	for _, change := range changes {
		byCategory[change.Category] = append(byCategory[change.Category], change.ObjectID)
	}
	retainItems := byCategory["RETAIN"]
	outputItems := byCategory["OUTPUT_MAPPING"]
	if retainItems == nil {
		retainItems = make([]string, 0)
	}
	if outputItems == nil {
		outputItems = make([]string, 0)
	}
	// Program đang Enabled mà Revision này chạm tới. Đọc intent bền vững ở
	// store, không suy từ diff: "đang chạy" là trạng thái của thiết bị, không
	// phải thuộc tính của một Revision.
	enableItems := s.enabledProgramsTouched(ctx, after.Revision.ProjectID, changes)
	impact := RevisionImpact{
		Retain:               impactFromItems(retainItems),
		OutputMappingChanges: impactFromItems(outputItems),
		PublishedSignals:     impactFromItems(sortedItems(byCategory["PUBLISHED_SIGNAL"])),
		ControlLibrary:       impactFromItems(sortedItems(byCategory["LIBRARY"])),
		ProgramSet:           impactFromItems(sortedItems(byCategory["PROGRAM_SET"])),
		EnableIntent:         impactFromItems(enableItems),
		ActiveOverrides: RevisionImpactGroup{Status: "UNAVAILABLE", Items: []string{
			"Core read-back override chưa được nối; Commission phải fail-closed",
		}},
		Cutover: RevisionImpactGroup{Status: "UNAVAILABLE", Items: []string{
			"Core cutover estimator chưa được nối; Commission phải fail-closed",
		}},
	}
	if s.runtimeImpact != nil {
		if current, readErr := s.runtimeImpact.CurrentRuntimeImpact(ctx); readErr == nil {
			impact.ActiveOverrides = impactFromItems(append([]string(nil), current.ActiveOverrideIDs...))
			cutoverItems := []string{}
			if current.ProducerMode != "PROGRAM_ONLY" {
				cutoverItems = append(cutoverItems, current.ProducerMode+"→PROGRAM_ONLY")
			}
			impact.Cutover = impactFromItems(cutoverItems)
		}
	}
	digestInput := struct {
		From    string           `json:"from"`
		To      string           `json:"to"`
		Changes []RevisionChange `json:"changes"`
		Impact  RevisionImpact   `json:"impact"`
	}{From: fromRevisionID, To: toRevisionID, Changes: changes, Impact: impact}
	digest, _ := semanticHash(digestInput)
	impact.ImpactRef = hex.EncodeToString(digest[:])
	return RevisionChangesView{FromRevisionID: fromRevisionID, ToRevisionID: toRevisionID, Impact: impact, Changes: changes}, nil
}

// sortedItems trả một slice KHÁC nil và sắp xếp — `impactRef` băm cả nội dung
// nhóm, nên thứ tự đọc DB lọt vào đó sẽ làm hai lần gọi trên cùng một Revision
// cho hai `impactRef` khác nhau, và mọi ack đều thành stale.
func sortedItems(items []string) []string {
	out := append([]string(nil), items...)
	if out == nil {
		out = make([]string, 0)
	}
	sort.Strings(out)
	return out
}

// enabledProgramsTouched trả các Program ĐANG có intent Enabled mà Revision này
// chạm tới. Không có store intent (đường test/Rev A cũ) thì trả rỗng — nhóm khi
// đó là `NONE`, không phải `UNAVAILABLE`: không có Program nào được bật thì
// thật sự không có gì để cảnh báo.
func (s *ProjectService) enabledProgramsTouched(ctx context.Context, projectID string,
	changes []RevisionChange) []string {
	if s.store == nil || projectID == "" {
		return make([]string, 0)
	}
	intents, err := s.store.ListProgramRuntimeIntents(ctx, projectID)
	if err != nil || len(intents) == 0 {
		return make([]string, 0)
	}
	enabled := make(map[string]struct{}, len(intents))
	for _, intent := range intents {
		if intent.DesiredEnabled {
			enabled[intent.ProgramID] = struct{}{}
		}
	}
	touched := make([]string, 0)
	seen := make(map[string]struct{}, len(enabled))
	for _, change := range changes {
		if _, ok := enabled[change.ObjectID]; !ok {
			continue
		}
		if _, dup := seen[change.ObjectID]; dup {
			continue
		}
		seen[change.ObjectID] = struct{}{}
		touched = append(touched, change.ObjectID)
	}
	sort.Strings(touched)
	return touched
}

func compareRevisionObjects(before, after []programmingstore.RevisionObject) []RevisionChange {
	type objectPair struct {
		before *programmingstore.RevisionObject
		after  *programmingstore.RevisionObject
	}
	pairs := make(map[string]objectPair, len(before)+len(after))
	for index := range before {
		object := &before[index]
		key := object.Kind + "\x00" + object.ObjectID
		pair := pairs[key]
		pair.before = object
		pairs[key] = pair
	}
	for index := range after {
		object := &after[index]
		key := object.Kind + "\x00" + object.ObjectID
		pair := pairs[key]
		pair.after = object
		pairs[key] = pair
	}
	changes := make([]RevisionChange, 0)
	for _, pair := range pairs {
		if pair.before != nil && pair.after != nil && pair.before.PayloadSHA256 == pair.after.PayloadSHA256 {
			continue
		}
		change := RevisionChange{}
		sample := pair.after
		if sample == nil {
			sample = pair.before
		}
		change.ObjectID, change.Kind = sample.ObjectID, sample.Kind
		switch {
		case pair.before == nil:
			change.ChangeType = "ADDED"
		case pair.after == nil:
			change.ChangeType = "REMOVED"
		default:
			change.ChangeType = "MODIFIED"
		}
		change.Category = revisionChangeCategory(pair.before, pair.after)
		if pair.before != nil {
			value := hex.EncodeToString(pair.before.PayloadSHA256[:])
			change.BeforeSHA256 = &value
		}
		if pair.after != nil {
			value := hex.EncodeToString(pair.after.PayloadSHA256[:])
			change.AfterSHA256 = &value
		}
		changes = append(changes, change)
	}
	sort.Slice(changes, func(left, right int) bool {
		if changes[left].Category != changes[right].Category {
			return changes[left].Category < changes[right].Category
		}
		if changes[left].Kind != changes[right].Kind {
			return changes[left].Kind < changes[right].Kind
		}
		return changes[left].ObjectID < changes[right].ObjectID
	})
	return changes
}

func revisionChangeCategory(before, after *programmingstore.RevisionObject) string {
	sample := after
	if sample == nil {
		sample = before
	}
	switch sample.Kind {
	case "METADATA":
		return "LIBRARY"
	case "TASK":
		return "TASK"
	case "BINDING":
		if bindingWritesOutput(before) || bindingWritesOutput(after) {
			return "OUTPUT_MAPPING"
		}
		return "MAPPING"
	case "VARIABLE":
		if retainedVariable(before) || retainedVariable(after) {
			return "RETAIN"
		}
		return "SOURCE"
	case "SIGNAL":
		// Trước T59-502, SIGNAL rơi vào nhánh mặc định `SOURCE`: đổi freshness,
		// đổi chính sách stale, hay đổi publisher của một Published Signal hiện
		// ra như một thay đổi mã nguồn bình thường và Commission không hỏi gì.
		// Nhưng đó là thứ đổi hành vi của MỌI consumer khi mất dữ liệu — và
		// không nhìn thấy được trong diff mã nguồn.
		return "PUBLISHED_SIGNAL"
	case "LIBRARY_ENTRY":
		return "LIBRARY"
	case "PROGRAM", "FUNCTION", "FUNCTION_BLOCK":
		// Thêm/bớt một PROGRAM đổi TẬP chương trình chạy trên thiết bị — khác
		// hẳn sửa thân một Program đã có. Người vận hành cần biết mình sắp thêm
		// hay bớt một chương trình, không phải suy ra từ một dòng "SOURCE".
		if sample.Kind == "PROGRAM" && (before == nil || after == nil) {
			return "PROGRAM_SET"
		}
		// v2 đặt biến vào `locals` của POU, nên một thay đổi RETAIN đến dưới
		// dạng thay đổi POU. Bỏ nhánh này thì impact RETAIN im lặng biến mất —
		// và Commission sẽ không còn hỏi acknowledgement RETAIN nữa.
		if retainedLocalsChanged(before, after) {
			return "RETAIN"
		}
		return "SOURCE"
	default:
		return "SOURCE"
	}
}

// retainedLocalsChanged so TẬP biến RETAIN của POU hai bên. So cả payload sẽ
// báo RETAIN cho mọi lần sửa mã; chỉ so `retain=true` mới đúng thứ ảnh hưởng
// tới state đang chạy.
func retainedLocalsChanged(before, after *programmingstore.RevisionObject) bool {
	return retainedLocalsSignature(before) != retainedLocalsSignature(after)
}

func retainedLocalsSignature(object *programmingstore.RevisionObject) string {
	if object == nil {
		return ""
	}
	var payload struct {
		Locals []struct {
			VariableID string `json:"variableId"`
			Name       string `json:"name"`
			Type       string `json:"type"`
			Retain     bool   `json:"retain"`
		} `json:"locals"`
	}
	if json.Unmarshal(object.PayloadJSON, &payload) != nil {
		return ""
	}
	parts := make([]string, 0, len(payload.Locals))
	for _, local := range payload.Locals {
		if !local.Retain {
			continue
		}
		parts = append(parts, local.VariableID+"|"+local.Name+"|"+local.Type)
	}
	sort.Strings(parts)
	return strings.Join(parts, ";")
}

func retainedVariable(object *programmingstore.RevisionObject) bool {
	if object == nil {
		return false
	}
	var payload struct {
		Retain bool `json:"retain"`
	}
	return json.Unmarshal(object.PayloadJSON, &payload) == nil && payload.Retain
}

func bindingWritesOutput(object *programmingstore.RevisionObject) bool {
	if object == nil {
		return false
	}
	var payload struct {
		Direction string `json:"direction"`
	}
	return json.Unmarshal(object.PayloadJSON, &payload) == nil && (payload.Direction == "WRITE" || payload.Direction == "READ_WRITE")
}

func impactFromItems(items []string) RevisionImpactGroup {
	sort.Strings(items)
	items = uniqueStrings(items)
	if len(items) == 0 {
		return RevisionImpactGroup{Status: "NONE", Items: []string{}}
	}
	return RevisionImpactGroup{Status: "PRESENT", Items: items}
}

func uniqueStrings(items []string) []string {
	result := items[:0]
	for _, item := range items {
		if len(result) == 0 || result[len(result)-1] != item {
			result = append(result, item)
		}
	}
	return result
}
