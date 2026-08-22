package application

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"mkddc-web/internal/programming/domain"
)

// Document v2 theo DDD-SW-PROG-UNIFIED-001 §4.1. Khác v1 ở ba điểm bản chất:
//
//  1. POU tách khỏi cấu hình Program. `objects` giữ *mã nguồn và interface*
//     (PROGRAM/FUNCTION/FUNCTION_BLOCK); `programs` chỉ giữ *cấu hình chạy*
//     (chu kỳ) và trỏ tới một object kind PROGRAM. Trộn hai thứ như v1 làm
//     "đổi chu kỳ" và "sửa mã" đụng cùng một bản ghi.
//  2. Không còn `task.programOrder`. DDD §4.1 cấm expose Task order và §7.1 quy
//     định mỗi Program tự release theo deadline riêng — giữ một mảng thứ tự sẽ
//     hứa một ngữ nghĩa mà runtime không thực hiện.
//  3. `signals` là công dân hạng nhất, không phải biến toàn cục ẩn.
const draftDocumentVersion = 2

var reservedPouNames = map[string]struct{}{
	"PROGRAM": {}, "FUNCTION": {}, "FUNCTION_BLOCK": {}, "VAR": {}, "END_VAR": {},
	"IF": {}, "THEN": {}, "ELSE": {}, "END_IF": {}, "TRUE": {}, "FALSE": {},
	"AND": {}, "OR": {}, "XOR": {}, "NOT": {}, "MOD": {},
}

var pouKinds = map[string]struct{}{"PROGRAM": {}, "FUNCTION": {}, "FUNCTION_BLOCK": {}}

var signalPolicies = map[string]struct{}{
	"USE_FALLBACK": {}, "HOLD_LAST": {}, "WAIT": {}, "FAIL_CLOSED": {},
}

// migrateDraftToV2 là phép biến đổi TẤT ĐỊNH và không mất dữ liệu: chạy hai lần
// trên cùng một document v1 cho đúng cùng một document v2. Nó không sinh UUID
// mới — mọi identity cũ được giữ nguyên, vì đổi identity khi migrate sẽ làm mọi
// Revision cũ trỏ vào hư không.
func migrateDraftToV2(document map[string]any) error {
	version, ok := document["schemaVersion"].(float64)
	if !ok {
		return ErrInvalidRequest
	}
	if int(version) == draftDocumentVersion {
		return nil
	}
	if int(version) != 1 {
		return fmt.Errorf("%w: schemaVersion %v không migrate được", ErrInvalidRequest, version)
	}

	legacyPrograms, _ := document["programs"].([]any)
	legacyVariables, _ := document["variables"].([]any)
	legacyBindings, _ := document["bindings"].([]any)
	task, _ := document["task"].(map[string]any)
	periodMs := float64(1000)
	if task != nil {
		if value, ok := task["periodMs"].(float64); ok {
			periodMs = value
		}
	}

	// Biến v1 gom theo Program: chúng trở thành `locals` của POU tương ứng, giữ
	// nguyên thứ tự theo variableId để kết quả không phụ thuộc thứ tự mảng gốc.
	localsByProgram := make(map[string][]any, len(legacyPrograms))
	variableByID := make(map[string]map[string]any, len(legacyVariables))
	for _, item := range legacyVariables {
		variable, ok := item.(map[string]any)
		if !ok {
			return ErrInvalidRequest
		}
		id, _ := variable["variableId"].(string)
		programID, _ := variable["programId"].(string)
		variableByID[id] = variable
		localsByProgram[programID] = append(localsByProgram[programID], variable)
	}
	for programID := range localsByProgram {
		items := localsByProgram[programID]
		sort.SliceStable(items, func(left, right int) bool {
			leftID, _ := items[left].(map[string]any)["variableId"].(string)
			rightID, _ := items[right].(map[string]any)["variableId"].(string)
			return leftID < rightID
		})
	}

	objects := make([]any, 0, len(legacyPrograms))
	programs := make([]any, 0, len(legacyPrograms))
	ordered := append([]any(nil), legacyPrograms...)
	sort.SliceStable(ordered, func(left, right int) bool {
		leftID, _ := ordered[left].(map[string]any)["programId"].(string)
		rightID, _ := ordered[right].(map[string]any)["programId"].(string)
		return leftID < rightID
	})
	for _, item := range ordered {
		legacy, ok := item.(map[string]any)
		if !ok {
			return ErrInvalidRequest
		}
		objectID, _ := legacy["programId"].(string)
		kind, _ := legacy["kind"].(string)
		if _, valid := pouKinds[kind]; !valid {
			kind = "PROGRAM"
		}
		object := map[string]any{
			"objectId": objectID,
			"kind":     kind,
			"name":     legacy["name"],
			"language": legacy["language"],
			"source":   legacy["document"],
			"locals":   append([]any{}, localsByProgram[objectID]...),
		}
		if object["source"] == nil {
			object["source"] = ""
		}
		objects = append(objects, object)
		// Chỉ PROGRAM mới có cấu hình chạy. FUNCTION/FUNCTION_BLOCK trong v1 là
		// POU dùng chung, không phải đơn vị lập lịch.
		if kind == "PROGRAM" {
			programs = append(programs, map[string]any{
				"programId": objectID, "objectId": objectID, "periodMs": periodMs,
			})
		}
	}

	bindings := make([]any, 0, len(legacyBindings))
	for _, item := range legacyBindings {
		legacy, ok := item.(map[string]any)
		if !ok {
			return ErrInvalidRequest
		}
		variableID, _ := legacy["variableId"].(string)
		variable := variableByID[variableID]
		binding := map[string]any{
			"bindingId": legacy["bindingId"],
			"pointId":   legacy["pointId"],
			"direction": legacy["direction"],
		}
		if variable != nil {
			binding["programId"] = variable["programId"]
			binding["variable"] = variable["name"]
		}
		bindings = append(bindings, binding)
	}
	sort.SliceStable(bindings, func(left, right int) bool {
		leftID, _ := bindings[left].(map[string]any)["bindingId"].(string)
		rightID, _ := bindings[right].(map[string]any)["bindingId"].(string)
		return leftID < rightID
	})

	document["schemaVersion"] = float64(draftDocumentVersion)
	document["objects"] = objects
	document["programs"] = programs
	document["bindings"] = bindings
	document["signals"] = []any{}
	document["execution"] = map[string]any{
		"profileId":          domain.ProfileID,
		"maxProgramsEnabled": float64(domain.MaxProgramsEnabled),
	}
	if _, ok := document["library"].(map[string]any); !ok {
		document["library"] = map[string]any{}
	}
	library := document["library"].(map[string]any)
	library["systemProfile"] = domain.ProfileID
	library["systemVersion"] = domain.SystemLibraryVersion
	if _, ok := library["projectLibraryRevisionId"]; !ok {
		library["projectLibraryRevisionId"] = nil
	}
	delete(library, "profile")
	delete(library, "version")
	delete(document, "variables")
	delete(document, "task")
	return nil
}

func newDraftDocumentV2(projectID, name string) map[string]any {
	return map[string]any{
		"schemaVersion": float64(draftDocumentVersion),
		"project":       map[string]any{"projectId": projectID, "name": name, "functionalTags": []any{}},
		"objects":       []any{},
		"programs":      []any{},
		"signals":       []any{},
		"bindings":      []any{},
		"library": map[string]any{
			"systemProfile": domain.ProfileID, "systemVersion": domain.SystemLibraryVersion,
			"projectLibraryRevisionId": nil,
		},
		"execution": map[string]any{
			"profileId": domain.ProfileID, "maxProgramsEnabled": float64(domain.MaxProgramsEnabled),
		},
	}
}

func applyDraftOperationV2(document map[string]any, operation string, raw []byte) (bool, error) {
	switch operation {
	case "upsertObject":
		return true, upsertPouObject(document, raw)
	case "removeObject":
		return true, removePouObject(document, raw)
	case "renameObject":
		return true, renamePouObject(document, raw)
	case "duplicateObject":
		return true, duplicatePouObject(document, raw)
	case "upsertProgram":
		return true, upsertProgramCompat(document, raw)
	case "removeProgram":
		return true, removeCollectionItem(document, "programs", "programId", raw)
	case "upsertSignal":
		return true, upsertSignalDefinition(document, raw)
	case "removeSignal":
		return true, removeCollectionItem(document, "signals", "signalId", raw)
	case "upsertBinding":
		return true, upsertBindingCompat(document, raw)
	case "upsertVariable":
		return true, upsertLocalVariable(document, raw)
	case "removeVariable":
		return true, removeLocalVariable(document, raw)
	case "setTask":
		return true, setTaskCompat(document, raw)
	case "removeBinding":
		return true, removeCollectionItem(document, "bindings", "bindingId", raw)
	default:
		return false, nil
	}
}

type pouObjectPayload struct {
	Op     string `json:"op"`
	Object struct {
		ObjectID     string          `json:"objectId"`
		Kind         string          `json:"kind"`
		Name         string          `json:"name"`
		Language     string          `json:"language"`
		Source       string          `json:"source"`
		Interface    json.RawMessage `json:"interface,omitempty"`
		Locals       []any           `json:"locals,omitempty"`
		Dependencies []string        `json:"dependencies,omitempty"`
	} `json:"object"`
}

func upsertPouObject(document map[string]any, raw []byte) error {
	var payload pouObjectPayload
	if err := decodeStrict(raw, &payload); err != nil {
		return ErrInvalidRequest
	}
	value := payload.Object
	if !isUUID(value.ObjectID) || !validPouName(value.Name) {
		return ErrInvalidRequest
	}
	if _, ok := pouKinds[value.Kind]; !ok {
		return ErrInvalidRequest
	}
	if value.Language != "ST" && value.Language != "FBD" {
		return ErrInvalidRequest
	}
	if len(value.Source) > domain.MaxSourceBytes || len(value.Locals) > domain.MaxVariables {
		return ErrInvalidRequest
	}
	object := map[string]any{
		"objectId": value.ObjectID, "kind": value.Kind, "name": value.Name,
		"language": value.Language, "source": value.Source,
		"locals": normalizeAnySlice(value.Locals),
	}
	if len(value.Interface) > 0 {
		var decoded any
		if err := json.Unmarshal(value.Interface, &decoded); err != nil {
			return ErrInvalidRequest
		}
		object["interface"] = decoded
	}
	if len(value.Dependencies) > 0 {
		dependencies := make([]any, 0, len(value.Dependencies))
		for _, id := range value.Dependencies {
			if !isUUID(id) {
				return ErrInvalidRequest
			}
			dependencies = append(dependencies, id)
		}
		object["dependencies"] = dependencies
	}
	return replaceOrAppend(document, "objects", "objectId", value.ObjectID, object, domain.MaxObjects)
}

func removePouObject(document map[string]any, raw []byte) error {
	var payload struct {
		Op       string `json:"op"`
		ObjectID string `json:"objectId"`
	}
	if err := decodeStrict(raw, &payload); err != nil || !isUUID(payload.ObjectID) {
		return ErrInvalidRequest
	}
	// Không cascade ngầm. Một Program đang trỏ tới object này phải được gỡ
	// trước — xoá kèm sẽ làm người dùng mất cấu hình chạy mà không ai báo.
	for _, program := range collectionOf(document, "programs") {
		if program["objectId"] == payload.ObjectID {
			return fmt.Errorf("%w: object đang được Program tham chiếu", ErrInvalidRequest)
		}
	}
	return removeByID(document, "objects", "objectId", payload.ObjectID)
}

func renamePouObject(document map[string]any, raw []byte) error {
	var payload struct {
		Op       string `json:"op"`
		ObjectID string `json:"objectId"`
		Name     string `json:"name"`
	}
	if err := decodeStrict(raw, &payload); err != nil || !isUUID(payload.ObjectID) || !validPouName(payload.Name) {
		return ErrInvalidRequest
	}
	for _, object := range collectionOf(document, "objects") {
		if object["objectId"] == payload.ObjectID {
			object["name"] = payload.Name
			return nil
		}
	}
	return ErrInvalidRequest
}

// duplicatePouObject nhân bản NỘI DUNG nhưng cấp identity mới. Client cấp
// `newObjectId` chứ service không tự sinh: cùng một request retry phải cho cùng
// một identity, nếu không idempotency mất nghĩa ngay tại thao tác này.
func duplicatePouObject(document map[string]any, raw []byte) error {
	var payload struct {
		Op          string `json:"op"`
		ObjectID    string `json:"objectId"`
		NewObjectID string `json:"newObjectId"`
		Name        string `json:"name"`
	}
	if err := decodeStrict(raw, &payload); err != nil || !isUUID(payload.ObjectID) ||
		!isUUID(payload.NewObjectID) || !validPouName(payload.Name) ||
		payload.ObjectID == payload.NewObjectID {
		return ErrInvalidRequest
	}
	for _, object := range collectionOf(document, "objects") {
		if object["objectId"] != payload.ObjectID {
			continue
		}
		clone := make(map[string]any, len(object))
		for key, value := range object {
			clone[key] = value
		}
		clone["objectId"] = payload.NewObjectID
		clone["name"] = payload.Name
		return replaceOrAppend(document, "objects", "objectId", payload.NewObjectID, clone, domain.MaxObjects)
	}
	return ErrInvalidRequest
}

func upsertProgramConfig(document map[string]any, raw []byte) error {
	var payload struct {
		Op      string `json:"op"`
		Program struct {
			ProgramID string  `json:"programId"`
			ObjectID  string  `json:"objectId"`
			PeriodMs  float64 `json:"periodMs"`
		} `json:"program"`
	}
	if err := decodeStrict(raw, &payload); err != nil {
		return ErrInvalidRequest
	}
	value := payload.Program
	if !isUUID(value.ProgramID) || !isUUID(value.ObjectID) || !allowedPeriodMs(value.PeriodMs) {
		return ErrInvalidRequest
	}
	// Program phải trỏ tới một object kind PROGRAM. Cho phép trỏ FUNCTION nghĩa
	// là lập lịch một thứ không có điểm vào.
	target := findByID(document, "objects", "objectId", value.ObjectID)
	if target == nil || target["kind"] != "PROGRAM" {
		return ErrInvalidRequest
	}
	for _, program := range collectionOf(document, "programs") {
		if program["programId"] != value.ProgramID && program["objectId"] == value.ObjectID {
			return fmt.Errorf("%w: object đã có Program khác", ErrInvalidRequest)
		}
	}
	program := map[string]any{"programId": value.ProgramID, "objectId": value.ObjectID, "periodMs": value.PeriodMs}
	return replaceOrAppend(document, "programs", "programId", value.ProgramID, program, domain.MaxProgramsTotal)
}

func upsertSignalDefinition(document map[string]any, raw []byte) error {
	var payload struct {
		Op     string `json:"op"`
		Signal struct {
			SignalID           string   `json:"signalId"`
			Name               string   `json:"name"`
			Type               string   `json:"type"`
			Unit               string   `json:"unit,omitempty"`
			PublisherProgramID string   `json:"publisherProgramId"`
			FreshnessMs        float64  `json:"freshnessMs"`
			StalePolicy        string   `json:"stalePolicy"`
			FallbackValue      *float64 `json:"fallbackValue,omitempty"`
		} `json:"signal"`
	}
	if err := decodeStrict(raw, &payload); err != nil {
		return ErrInvalidRequest
	}
	value := payload.Signal
	if !isUUID(value.SignalID) || !validPouName(value.Name) || !isUUID(value.PublisherProgramID) {
		return ErrInvalidRequest
	}
	if !validSignalType(value.Type) || !validText(value.Unit, 0, 32) {
		return ErrInvalidRequest
	}
	// Cùng dải mà schema store ép (`freshness_ms BETWEEN 1000 AND 90000`): hai
	// lớp phải nói cùng một con số, nếu không lớp trên nhận rồi lớp dưới chối.
	if value.FreshnessMs < 1000 || value.FreshnessMs > 90000 {
		return ErrInvalidRequest
	}
	if _, ok := signalPolicies[value.StalePolicy]; !ok {
		return ErrInvalidRequest
	}
	// `USE_FALLBACK` bắt buộc có giá trị dự phòng; ba chính sách còn lại KHÔNG
	// được mang — đây đúng lối "im lặng thay bằng 0" mà DDD §10 cấm.
	if (value.StalePolicy == "USE_FALLBACK") != (value.FallbackValue != nil) {
		return ErrInvalidRequest
	}
	if findByID(document, "programs", "programId", value.PublisherProgramID) == nil {
		return ErrInvalidRequest
	}
	signal := map[string]any{
		"signalId": value.SignalID, "name": value.Name, "type": value.Type,
		"publisherProgramId": value.PublisherProgramID, "freshnessMs": value.FreshnessMs,
		"stalePolicy": value.StalePolicy,
	}
	if value.Unit != "" {
		signal["unit"] = value.Unit
	}
	if value.FallbackValue != nil {
		signal["fallbackValue"] = *value.FallbackValue
	}
	return replaceOrAppend(document, "signals", "signalId", value.SignalID, signal, domain.MaxSignals)
}

func upsertBindingV2(document map[string]any, raw []byte) error {
	var payload struct {
		Op      string `json:"op"`
		Binding struct {
			BindingID string `json:"bindingId"`
			ProgramID string `json:"programId"`
			Variable  string `json:"variable"`
			PointID   string `json:"pointId"`
			Direction string `json:"direction"`
		} `json:"binding"`
	}
	if err := decodeStrict(raw, &payload); err != nil {
		return ErrInvalidRequest
	}
	value := payload.Binding
	if !isUUID(value.BindingID) || !isUUID(value.ProgramID) || !validPouName(value.Variable) ||
		!validText(value.PointID, 1, 64) || (value.Direction != "READ" && value.Direction != "WRITE") {
		return ErrInvalidRequest
	}
	if findByID(document, "programs", "programId", value.ProgramID) == nil {
		return ErrInvalidRequest
	}
	binding := map[string]any{"bindingId": value.BindingID, "programId": value.ProgramID,
		"variable": value.Variable, "pointId": value.PointID, "direction": value.Direction}
	return replaceOrAppend(document, "bindings", "bindingId", value.BindingID, binding, domain.MaxPackageBindings)
}

func validateDraftDocumentV2(document map[string]any) error {
	version, ok := document["schemaVersion"].(float64)
	if !ok || int(version) != draftDocumentVersion {
		return ErrInvalidRequest
	}
	project, ok := document["project"].(map[string]any)
	if !ok || !stringUUID(project["projectId"]) {
		return ErrInvalidRequest
	}
	objects := collectionOf(document, "objects")
	if len(objects) > domain.MaxObjects {
		return ErrInvalidRequest
	}
	objectIDs := make(map[string]string, len(objects))
	names := make(map[string]struct{}, len(objects))
	userPou := 0
	for _, object := range objects {
		id, ok := object["objectId"].(string)
		kind, kindOK := object["kind"].(string)
		name, nameOK := object["name"].(string)
		if !ok || !isUUID(id) || !kindOK || !nameOK || !validPouName(name) {
			return ErrInvalidRequest
		}
		if _, valid := pouKinds[kind]; !valid {
			return ErrInvalidRequest
		}
		if _, duplicate := objectIDs[id]; duplicate {
			return ErrInvalidRequest
		}
		// Name unique CASE-FOLDED trong Project (DDD §4.2). Không fold thì
		// `Ahu` và `AHU` là hai POU khác nhau ở FE nhưng cùng một ở compiler.
		folded := strings.ToUpper(name)
		if _, duplicate := names[folded]; duplicate {
			return fmt.Errorf("%w: tên POU trùng case-folded: %s", ErrInvalidRequest, name)
		}
		objectIDs[id], names[folded] = kind, struct{}{}
		if kind != "PROGRAM" {
			userPou++
		}
	}
	if userPou > domain.MaxUserPou {
		return ErrInvalidRequest
	}

	programs := collectionOf(document, "programs")
	if len(programs) > domain.MaxProgramsTotal {
		return fmt.Errorf("%w: vượt trần %d Program", ErrInvalidRequest, domain.MaxProgramsTotal)
	}
	programIDs := make(map[string]struct{}, len(programs))
	usedObjects := make(map[string]struct{}, len(programs))
	for _, program := range programs {
		id, ok := program["programId"].(string)
		objectID, objectOK := program["objectId"].(string)
		period, periodOK := program["periodMs"].(float64)
		if !ok || !isUUID(id) || !objectOK || !periodOK || !allowedPeriodMs(period) {
			return ErrInvalidRequest
		}
		if kind, exists := objectIDs[objectID]; !exists || kind != "PROGRAM" {
			return ErrInvalidRequest
		}
		if _, duplicate := programIDs[id]; duplicate {
			return ErrInvalidRequest
		}
		if _, duplicate := usedObjects[objectID]; duplicate {
			return ErrInvalidRequest
		}
		programIDs[id], usedObjects[objectID] = struct{}{}, struct{}{}
	}

	signals := collectionOf(document, "signals")
	if len(signals) > domain.MaxSignals {
		return ErrInvalidRequest
	}
	signalIDs := make(map[string]struct{}, len(signals))
	signalNames := make(map[string]struct{}, len(signals))
	for _, signal := range signals {
		id, ok := signal["signalId"].(string)
		name, nameOK := signal["name"].(string)
		publisher, publisherOK := signal["publisherProgramId"].(string)
		if !ok || !isUUID(id) || !nameOK || !validPouName(name) || !publisherOK {
			return ErrInvalidRequest
		}
		if _, exists := programIDs[publisher]; !exists {
			return ErrInvalidRequest
		}
		if _, duplicate := signalIDs[id]; duplicate {
			return ErrInvalidRequest
		}
		// Một signal có ĐÚNG MỘT publisher (DDD §4.5) — bất biến này cũng nằm
		// trong schema store; giữ nó ở Draft để người dùng biết ngay, không phải
		// đợi tới lúc seal.
		if _, duplicate := signalNames[strings.ToUpper(name)]; duplicate {
			return fmt.Errorf("%w: signal trùng tên: %s", ErrInvalidRequest, name)
		}
		signalIDs[id], signalNames[strings.ToUpper(name)] = struct{}{}, struct{}{}
	}

	bindings := collectionOf(document, "bindings")
	if len(bindings) > domain.MaxPackageBindings {
		return ErrInvalidRequest
	}
	bindingIDs := make(map[string]struct{}, len(bindings))
	for _, binding := range bindings {
		id, ok := binding["bindingId"].(string)
		if !ok || !isUUID(id) {
			return ErrInvalidRequest
		}
		if _, duplicate := bindingIDs[id]; duplicate {
			return ErrInvalidRequest
		}
		bindingIDs[id] = struct{}{}
		// `programId` chỉ có khi resolve được biến; binding v1 ghi trước lúc khai
		// biến vẫn hợp lệ ở Draft và sẽ chết ở Check với mã đúng nghĩa.
		if programID, exists := binding["programId"].(string); exists {
			if _, known := programIDs[programID]; !known {
				return ErrInvalidRequest
			}
		}
	}

	if _, ok := document["library"].(map[string]any); !ok {
		return ErrInvalidRequest
	}
	execution, ok := document["execution"].(map[string]any)
	if !ok {
		return ErrInvalidRequest
	}
	enabled, ok := execution["maxProgramsEnabled"].(float64)
	if !ok || int(enabled) != domain.MaxProgramsEnabled {
		return ErrInvalidRequest
	}
	return nil
}

func collectionOf(document map[string]any, field string) []map[string]any {
	raw, _ := document[field].([]any)
	items := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if object, ok := item.(map[string]any); ok {
			items = append(items, object)
		}
	}
	return items
}

func findByID(document map[string]any, field, idField, id string) map[string]any {
	for _, item := range collectionOf(document, field) {
		if item[idField] == id {
			return item
		}
	}
	return nil
}

func replaceOrAppend(document map[string]any, field, idField, id string, value map[string]any, limit int) error {
	items, ok := document[field].([]any)
	if !ok {
		return ErrInvalidRequest
	}
	for index, item := range items {
		if candidate, ok := item.(map[string]any); ok && candidate[idField] == id {
			items[index] = value
			document[field] = items
			return nil
		}
	}
	if len(items) >= limit {
		return fmt.Errorf("%w: %s vượt trần %d", ErrInvalidRequest, field, limit)
	}
	document[field] = append(items, value)
	return nil
}

func removeByID(document map[string]any, field, idField, id string) error {
	items, ok := document[field].([]any)
	if !ok {
		return ErrInvalidRequest
	}
	for index, item := range items {
		if candidate, ok := item.(map[string]any); ok && candidate[idField] == id {
			document[field] = append(items[:index:index], items[index+1:]...)
			return nil
		}
	}
	return ErrInvalidRequest
}

func removeCollectionItem(document map[string]any, field, idField string, raw []byte) error {
	var generic map[string]json.RawMessage
	if err := json.Unmarshal(raw, &generic); err != nil || len(generic) != 2 {
		return ErrInvalidRequest
	}
	idRaw, ok := generic[idField]
	if !ok {
		return ErrInvalidRequest
	}
	var id string
	if json.Unmarshal(idRaw, &id) != nil || !isUUID(id) {
		return ErrInvalidRequest
	}
	if field == "programs" {
		// Signal mất publisher là signal không ai ghi. Từ chối thẳng thay vì
		// xoá kèm: xoá kèm làm người dùng mất định nghĩa mà không ai báo.
		for _, signal := range collectionOf(document, "signals") {
			if signal["publisherProgramId"] == id {
				return fmt.Errorf("%w: Program đang publish signal", ErrInvalidRequest)
			}
		}
	}
	return removeByID(document, field, idField, id)
}

func normalizeAnySlice(items []any) []any {
	if items == nil {
		return []any{}
	}
	return items
}

func validPouName(name string) bool {
	if !validText(name, 1, 64) {
		return false
	}
	if _, reserved := reservedPouNames[strings.ToUpper(name)]; reserved {
		return false
	}
	first := name[0]
	if !(first >= 'A' && first <= 'Z') && !(first >= 'a' && first <= 'z') {
		return false
	}
	for index := 0; index < len(name); index++ {
		char := name[index]
		if char == '_' || (char >= '0' && char <= '9') ||
			(char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') {
			continue
		}
		return false
	}
	return true
}

func validSignalType(value string) bool {
	for _, item := range []string{"BOOL", "INT", "DINT", "UINT", "REAL", "TIME"} {
		if value == item {
			return true
		}
	}
	return false
}

func allowedPeriodMs(value float64) bool {
	for _, period := range domain.AllowedPeriodMs {
		if int64(value) == period && value == float64(int64(value)) {
			return true
		}
	}
	return false
}

// --- Lớp tương thích op v1 -------------------------------------------------
//
// FE đang chạy và mọi bundle/test hiện có nói ngôn ngữ v1. Giữ NGUYÊN tên op và
// dịch chúng sang model v2 tại đây là cách duy nhất nâng model mà không bắt mọi
// consumer đổi cùng lúc — đổi cùng lúc là cách chắc chắn để một consumer bị bỏ
// quên rồi hỏng lặng lẽ.
//
// Phân biệt v1/v2 theo HÌNH DẠNG payload, không theo cờ: `program.objectId` chỉ
// có ở v2, còn `program.document` chỉ có ở v1.

func upsertProgramCompat(document map[string]any, raw []byte) error {
	var probe struct {
		Program map[string]json.RawMessage `json:"program"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil || probe.Program == nil {
		return ErrInvalidRequest
	}
	if _, isV2 := probe.Program["objectId"]; isV2 {
		return upsertProgramConfig(document, raw)
	}

	var payload struct {
		Op      string `json:"op"`
		Program struct {
			ProgramID string          `json:"programId"`
			Name      string          `json:"name"`
			Kind      string          `json:"kind"`
			Language  string          `json:"language"`
			Document  string          `json:"document"`
			Interface json.RawMessage `json:"interface,omitempty"`
		} `json:"program"`
	}
	if err := decodeStrict(raw, &payload); err != nil {
		return ErrInvalidRequest
	}
	value := payload.Program
	kind := value.Kind
	if kind == "" {
		kind = "PROGRAM"
	}
	if _, valid := pouKinds[kind]; !valid || !isUUID(value.ProgramID) || !validPouName(value.Name) {
		return ErrInvalidRequest
	}
	if value.Language != "ST" && value.Language != "FBD" {
		return ErrInvalidRequest
	}
	if len(value.Document) > domain.MaxSourceBytes {
		return ErrInvalidRequest
	}
	object := map[string]any{"objectId": value.ProgramID, "kind": kind, "name": value.Name,
		"language": value.Language, "source": value.Document, "locals": []any{}}
	if existing := findByID(document, "objects", "objectId", value.ProgramID); existing != nil {
		object["locals"] = existing["locals"]
		if declared, ok := existing["interface"]; ok {
			object["interface"] = declared
		}
	}
	if len(value.Interface) > 0 {
		var decoded any
		if err := json.Unmarshal(value.Interface, &decoded); err != nil {
			return ErrInvalidRequest
		}
		object["interface"] = decoded
	}
	if err := replaceOrAppend(document, "objects", "objectId", value.ProgramID, object, domain.MaxObjects); err != nil {
		return err
	}
	if kind != "PROGRAM" {
		// POU dùng chung không phải đơn vị lập lịch: nếu trước đó nó từng là
		// PROGRAM thì cấu hình chạy phải biến mất theo.
		_ = removeByID(document, "programs", "programId", value.ProgramID)
		return nil
	}
	period := currentTaskPeriod(document)
	program := map[string]any{"programId": value.ProgramID, "objectId": value.ProgramID, "periodMs": period}
	return replaceOrAppend(document, "programs", "programId", value.ProgramID, program, domain.MaxProgramsTotal)
}

func upsertLocalVariable(document map[string]any, raw []byte) error {
	var payload struct {
		Op       string         `json:"op"`
		Variable map[string]any `json:"variable"`
	}
	if err := decodeStrict(raw, &payload); err != nil || payload.Variable == nil {
		return ErrInvalidRequest
	}
	variableID, _ := payload.Variable["variableId"].(string)
	programID, _ := payload.Variable["programId"].(string)
	if !isUUID(variableID) || !isUUID(programID) {
		return ErrInvalidRequest
	}
	object := findByID(document, "objects", "objectId", programID)
	if object == nil {
		return ErrInvalidRequest
	}
	locals, _ := object["locals"].([]any)
	for index, item := range locals {
		if candidate, ok := item.(map[string]any); ok && candidate["variableId"] == variableID {
			locals[index] = payload.Variable
			object["locals"] = locals
			return nil
		}
	}
	if len(locals) >= domain.MaxVariables {
		return ErrInvalidRequest
	}
	object["locals"] = append(locals, payload.Variable)
	return nil
}

func removeLocalVariable(document map[string]any, raw []byte) error {
	var generic map[string]json.RawMessage
	if err := json.Unmarshal(raw, &generic); err != nil || len(generic) != 2 {
		return ErrInvalidRequest
	}
	var variableID string
	if json.Unmarshal(generic["variableId"], &variableID) != nil || !isUUID(variableID) {
		return ErrInvalidRequest
	}
	for _, object := range collectionOf(document, "objects") {
		locals, _ := object["locals"].([]any)
		for index, item := range locals {
			if candidate, ok := item.(map[string]any); ok && candidate["variableId"] == variableID {
				object["locals"] = append(locals[:index:index], locals[index+1:]...)
				return nil
			}
		}
	}
	return ErrInvalidRequest
}

func upsertBindingCompat(document map[string]any, raw []byte) error {
	var envelope struct {
		Op      string         `json:"op"`
		Binding map[string]any `json:"binding"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || envelope.Binding == nil {
		return ErrInvalidRequest
	}
	variableID, isV1 := envelope.Binding["variableId"].(string)
	if !isV1 {
		return upsertBindingV2(document, raw)
	}
	// Binding v1 có hình dạng MỞ (Mapping tab ghi thêm `point`, `dataType`,
	// `unit`, `writable`…). Giải mã chặt ở đây sẽ từ chối đúng dữ liệu mà lớp
	// Check đang đọc, nên giữ nguyên object và chỉ BỔ SUNG hai trường v2.
	bindingID, ok := envelope.Binding["bindingId"].(string)
	if !ok || !isUUID(bindingID) || !isUUID(variableID) {
		return ErrInvalidRequest
	}
	binding := make(map[string]any, len(envelope.Binding)+2)
	for key, value := range envelope.Binding {
		binding[key] = value
	}
	if programID, variableName := resolveLocalVariable(document, variableID); programID != "" {
		binding["programId"] = programID
		binding["variable"] = variableName
	}
	return replaceOrAppend(document, "bindings", "bindingId", bindingID, binding, domain.MaxPackageBindings)
}

func resolveLocalVariable(document map[string]any, variableID string) (string, string) {
	for _, object := range collectionOf(document, "objects") {
		locals, _ := object["locals"].([]any)
		for _, item := range locals {
			candidate, ok := item.(map[string]any)
			if !ok || candidate["variableId"] != variableID {
				continue
			}
			objectID, _ := object["objectId"].(string)
			name, _ := candidate["name"].(string)
			// Binding gắn với PROGRAM đang chạy, nên phải tồn tại cấu hình
			// Program cho object đó — bind vào một POU không được lập lịch là
			// bind vào thứ không bao giờ chạy.
			for _, program := range collectionOf(document, "programs") {
				if program["objectId"] == objectID {
					programID, _ := program["programId"].(string)
					return programID, name
				}
			}
			return "", ""
		}
	}
	return "", ""
}

// setTaskCompat: v2 KHÔNG có Task object và không expose thứ tự Program (DDD
// §4.1). Op cũ vì vậy chỉ còn một nghĩa dùng được — đặt chu kỳ cho mọi Program.
// `programOrder` bị bỏ qua có chủ ý: giữ lại nó sẽ hứa một ngữ nghĩa mà runtime
// không thực hiện.
func setTaskCompat(document map[string]any, raw []byte) error {
	var payload struct {
		Op   string `json:"op"`
		Task struct {
			TaskID       string   `json:"taskId"`
			PeriodMs     float64  `json:"periodMs"`
			ProgramOrder []string `json:"programOrder"`
		} `json:"task"`
	}
	if err := decodeStrict(raw, &payload); err != nil {
		return ErrInvalidRequest
	}
	if !allowedPeriodMs(payload.Task.PeriodMs) {
		return ErrInvalidRequest
	}
	for _, program := range collectionOf(document, "programs") {
		program["periodMs"] = payload.Task.PeriodMs
	}
	return nil
}

func currentTaskPeriod(document map[string]any) float64 {
	for _, program := range collectionOf(document, "programs") {
		if period, ok := program["periodMs"].(float64); ok {
			return period
		}
	}
	return float64(domain.AllowedPeriodMs[0])
}
