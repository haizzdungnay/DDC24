package application

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

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
	legacyBindings, bindingsOK := document["bindings"].([]any)
	if !bindingsOK {
		return fmt.Errorf("%w: bindings v1 phải là mảng", ErrInvalidRequest)
	}
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
	for index, item := range legacyBindings {
		legacy, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%w: bindings[%d] không phải object", ErrInvalidRequest, index)
		}
		binding, err := migrateBindingV1(legacy, variableByID)
		if err != nil {
			return fmt.Errorf("%w: bindings[%d]: %v", ErrInvalidRequest, index, err)
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

// migrateBindingV1 có hai nhánh tương thích tường minh:
//
//   - canonical: hình dạng typed mà FE/API hiện hành dùng, với `point` lồng;
//     clone nguyên object rồi chỉ bổ sung owner đã resolve từ Variable;
//   - flat legacy: hình dạng đời đầu chỉ có `pointId` cấp gốc. Nhánh này giữ
//     đúng dữ liệu đã có, không tự bịa category/deviceId/type/unit/writable.
//
// Một object trộn cả hai hình dạng bị từ chối. Chọn một nửa sẽ tạo Binding có
// vẻ hợp lệ nhưng mang hai identity khác nhau, nguy hiểm hơn việc dừng migration.
func migrateBindingV1(legacy map[string]any, variableByID map[string]map[string]any) (map[string]any, error) {
	if bindingCarriesRuntimeSlotHandle(legacy) {
		return nil, fmt.Errorf("binding chứa runtime handle extIndex")
	}
	bindingID, bindingIDOK := legacy["bindingId"].(string)
	variableID, variableIDOK := legacy["variableId"].(string)
	variable := variableByID[variableID]
	if !bindingIDOK || !isUUID(bindingID) || !variableIDOK || !isUUID(variableID) || variable == nil {
		return nil, fmt.Errorf("bindingId/variableId không hợp lệ hoặc Variable không tồn tại")
	}

	_, hasPoint := legacy["point"]
	_, hasFlatPointID := legacy["pointId"]
	if hasPoint == hasFlatPointID {
		return nil, fmt.Errorf("binding phải có đúng một identity point canonical hoặc flat legacy")
	}

	binding := make(map[string]any, len(legacy)+2)
	for key, value := range legacy {
		binding[key] = value
	}
	binding["programId"] = variable["programId"]
	binding["variable"] = variable["name"]

	if hasPoint {
		if err := validateCanonicalStoredBinding(binding); err != nil {
			return nil, err
		}
		return binding, nil
	}
	if err := validateFlatLegacyStoredBinding(binding); err != nil {
		return nil, err
	}
	return binding, nil
}

var canonicalStoredBindingFields = map[string]struct{}{
	"bindingId": {}, "variableId": {}, "point": {}, "direction": {}, "dataType": {},
	"unit": {}, "writable": {}, "qualityPolicy": {}, "programId": {}, "variable": {},
}

var flatLegacyStoredBindingFields = map[string]struct{}{
	"bindingId": {}, "variableId": {}, "pointId": {}, "direction": {}, "programId": {}, "variable": {},
}

var canonicalStoredPointFields = map[string]struct{}{
	"category": {}, "deviceId": {}, "pointId": {},
}

func exactObjectFields(value map[string]any, allowed map[string]struct{}) bool {
	for key := range value {
		if _, ok := allowed[key]; !ok {
			return false
		}
	}
	return true
}

func validStoredBindingDirection(value string, allowReadWrite bool) bool {
	return value == "READ" || value == "WRITE" || (allowReadWrite && value == "READ_WRITE")
}

func validateCanonicalStoredBinding(binding map[string]any) error {
	if !exactObjectFields(binding, canonicalStoredBindingFields) || bindingCarriesRuntimeSlotHandle(binding) {
		return fmt.Errorf("binding canonical có field ngoài hợp đồng")
	}
	for _, required := range []string{"bindingId", "variableId", "point", "direction", "dataType", "writable", "qualityPolicy", "programId", "variable"} {
		if _, ok := binding[required]; !ok {
			return fmt.Errorf("binding canonical thiếu %s", required)
		}
	}
	bindingID, _ := binding["bindingId"].(string)
	variableID, _ := binding["variableId"].(string)
	programID, _ := binding["programId"].(string)
	variable, _ := binding["variable"].(string)
	direction, _ := binding["direction"].(string)
	dataType, _ := binding["dataType"].(string)
	_, writableOK := binding["writable"].(bool)
	qualityPolicy, _ := binding["qualityPolicy"].(string)
	if !isUUID(bindingID) || !isUUID(variableID) || !isUUID(programID) || !validPouName(variable) ||
		!validStoredBindingDirection(direction, true) || !validSignalType(dataType) || !writableOK ||
		(qualityPolicy != "REQUIRE_GOOD" && qualityPolicy != "ALLOW_UNCERTAIN" && qualityPolicy != "FAIL_POLICY") {
		return fmt.Errorf("binding canonical có metadata không hợp lệ")
	}
	if unit, present := binding["unit"]; present {
		text, ok := unit.(string)
		if !ok || !validText(text, 0, 32) {
			return fmt.Errorf("binding canonical có unit không hợp lệ")
		}
	}
	point, ok := binding["point"].(map[string]any)
	if !ok || !exactObjectFields(point, canonicalStoredPointFields) {
		return fmt.Errorf("binding canonical có point không hợp lệ")
	}
	category, _ := point["category"].(string)
	pointID, _ := point["pointId"].(string)
	deviceID, hasDeviceID := point["deviceId"].(string)
	if !validText(pointID, 1, 64) || (category != "LOCAL" && category != "VP" && category != "MB_RTU") {
		return fmt.Errorf("binding canonical có point identity không hợp lệ")
	}
	if category == "MB_RTU" {
		if !hasDeviceID || !validText(deviceID, 1, 64) {
			return fmt.Errorf("binding MB_RTU thiếu deviceId")
		}
	} else if _, present := point["deviceId"]; present {
		return fmt.Errorf("binding %s không được mang deviceId", category)
	}
	return nil
}

func validateFlatLegacyStoredBinding(binding map[string]any) error {
	if !exactObjectFields(binding, flatLegacyStoredBindingFields) || bindingCarriesRuntimeSlotHandle(binding) {
		return fmt.Errorf("binding flat legacy có field ngoài hợp đồng")
	}
	bindingID, _ := binding["bindingId"].(string)
	pointID, _ := binding["pointId"].(string)
	direction, _ := binding["direction"].(string)
	programID, _ := binding["programId"].(string)
	variable, _ := binding["variable"].(string)
	if !isUUID(bindingID) || !validText(pointID, 1, 64) || !validStoredBindingDirection(direction, true) ||
		!isUUID(programID) || !validPouName(variable) {
		return fmt.Errorf("binding flat legacy không hợp lệ")
	}
	if variableID, present := binding["variableId"]; present {
		text, ok := variableID.(string)
		if !ok || !isUUID(text) {
			return fmt.Errorf("binding flat legacy có variableId không hợp lệ")
		}
	}
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
	case "annotateObject":
		return true, annotatePouObject(document, raw)
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

// annotatePouObject ghi chú thích của POU (`DEV-PROG-004`): mô tả nhiều dòng và
// một dòng ghi chú truy cập. Nó VÁ TẠI CHỖ thay vì đi qua `upsertObject`, và đó
// là điểm mấu chốt: `upsertObject` thay TOÀN BỘ object, nên sửa một dòng mô tả
// bằng đường đó buộc client phải gửi kèm cả `source`. Nếu buffer mã nguồn trong
// trình duyệt đang cũ hơn Draft (một phiên khác vừa lưu), thao tác "sửa mô tả"
// sẽ âm thầm ghi đè mã nguồn của người khác.
//
// Chuỗi rỗng nghĩa là XOÁ chú thích, không phải "giữ nguyên": người dùng phải
// gỡ được thứ họ đã viết, và một khoá không tồn tại đọc ra `undefined` ở FE —
// khác hẳn chuỗi rỗng, nên `omitempty` ở đây là ngữ nghĩa chứ không phải để
// tiết kiệm byte.
func annotatePouObject(document map[string]any, raw []byte) error {
	var payload struct {
		Op          string  `json:"op"`
		ObjectID    string  `json:"objectId"`
		Description *string `json:"description,omitempty"`
		Access      *string `json:"access,omitempty"`
	}
	if err := decodeStrict(raw, &payload); err != nil || !isUUID(payload.ObjectID) {
		return ErrInvalidRequest
	}
	if payload.Description == nil && payload.Access == nil {
		return ErrInvalidRequest
	}
	if payload.Description != nil && !validMultilineText(*payload.Description, maxPouDescriptionRunes) {
		return ErrInvalidRequest
	}
	// `access` là MỘT dòng: nó đứng cạnh `Ngôn ngữ`/`Loại` trên một hàng của
	// Inspector, nên cho xuống dòng ở đây chỉ tạo ra một giá trị không hiển thị
	// đúng ở chính nơi nó được đọc.
	if payload.Access != nil && !validText(*payload.Access, 0, maxPouAccessRunes) {
		return ErrInvalidRequest
	}
	for _, object := range collectionOf(document, "objects") {
		if object["objectId"] != payload.ObjectID {
			continue
		}
		applyAnnotation(object, "description", payload.Description)
		applyAnnotation(object, "access", payload.Access)
		return nil
	}
	return ErrInvalidRequest
}

func applyAnnotation(object map[string]any, key string, value *string) {
	if value == nil {
		return
	}
	if *value == "" {
		delete(object, key)
		return
	}
	object[key] = norm.NFC.String(*value)
}

// validMultilineText là `validText` có CHO PHÉP xuống dòng.
//
// `validText` chặn mọi ký tự điều khiển (`< 0x20`), trong đó có `\n` — đúng cho
// tên và nhãn một dòng, nhưng một ô mô tả nhiều dòng đi qua nó thì mọi lần
// người dùng bấm Enter đều nhận 400 mà không hiểu vì sao. `\r` vẫn bị từ chối:
// trình duyệt luôn trả `\n` trong `textarea.value`, nên `\r` tới được đây là dấu
// hiệu một client khác đang gửi thứ khác — nhận nó vào sẽ làm mọi phép so dòng
// của Draft lệch về sau.
func validMultilineText(value string, maximum int) bool {
	if !utf8.ValidString(value) || norm.NFC.String(value) != value {
		return false
	}
	if strings.IndexFunc(value, func(candidate rune) bool {
		return (candidate < 0x20 && candidate != '\n' && candidate != '\t') || candidate == 0x7f
	}) >= 0 {
		return false
	}
	return utf8.RuneCountInString(value) <= maximum
}

const (
	maxPouDescriptionRunes = 2048
	maxPouAccessRunes      = 120
)

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
	if !isUUID(value.ProgramID) || !isUUID(value.ObjectID) {
		return ErrInvalidRequest
	}
	// C1 (ADR-061): ĐẶT một chu kỳ mới chỉ được chọn trong tập của profile —
	// kể cả 30000 ms của profile cũ. Lỗi mang `ST-SCHED-001` để client nói được
	// VÌ SAO, không chỉ "request sai".
	if !allowedPeriodMs(value.PeriodMs) {
		return &PeriodNotAllowedError{PeriodMs: value.PeriodMs}
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
	// Cùng dải mà schema store ép (`freshness_ms BETWEEN 10 AND 150000`,
	// migration `0016`, ADR-061 mục 4.5): hai lớp phải nói cùng một con số, nếu
	// không lớp trên nhận rồi lớp dưới chối. Luật "≥ chu kỳ publisher" thuộc
	// Check: ở Draft người dùng có thể đặt freshness trước rồi mới đổi chu kỳ,
	// và bắt buộc đúng thứ tự thao tác là bắt người dùng đoán thứ tự đó.
	if value.FreshnessMs < signalFreshnessMinMs || value.FreshnessMs > signalFreshnessMaxMs ||
		value.FreshnessMs != float64(int64(value.FreshnessMs)) {
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
		// `storedPeriodMs`, KHÔNG phải `allowedPeriodMs`: Draft đã lưu trước
		// ADR-061 có thể mang 30000 ms. Từ chối nó ở đây làm MỌI mutation của
		// Draft đó hỏng (kể cả sửa một dòng ST ở POU khác) và người dùng không
		// còn đường tự sửa. Draft vẫn đọc/sửa được; Check từ chối bằng
		// `ST-SCHED-001`, còn thao tác ĐẶT chu kỳ chỉ nhận tập mới.
		if !ok || !isUUID(id) || !objectOK || !periodOK || !storedPeriodMs(period) {
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

	rawBindings, ok := document["bindings"].([]any)
	if !ok || len(rawBindings) > domain.MaxPackageBindings {
		return ErrInvalidRequest
	}
	bindingIDs := make(map[string]struct{}, len(rawBindings))
	for _, rawBinding := range rawBindings {
		binding, ok := rawBinding.(map[string]any)
		if !ok {
			return ErrInvalidRequest
		}
		id, ok := binding["bindingId"].(string)
		if !ok || !isUUID(id) {
			return ErrInvalidRequest
		}
		if _, duplicate := bindingIDs[id]; duplicate {
			return ErrInvalidRequest
		}
		bindingIDs[id] = struct{}{}
		if _, canonical := binding["point"]; canonical {
			if err := validateCanonicalStoredBinding(binding); err != nil {
				return fmt.Errorf("%w: binding canonical: %v", ErrInvalidRequest, err)
			}
		} else if err := validateFlatLegacyStoredBinding(binding); err != nil {
			return fmt.Errorf("%w: binding flat legacy: %v", ErrInvalidRequest, err)
		}
		programID, _ := binding["programId"].(string)
		if _, known := programIDs[programID]; !known {
			return ErrInvalidRequest
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

// allowedPeriodMs: chu kỳ thuộc ĐÚNG tập của profile hiện hành (ADR-061 C1).
// Mọi thao tác ĐẶT chu kỳ và mọi Check dùng hàm này.
func allowedPeriodMs(value float64) bool {
	return value == float64(int64(value)) && allowedPeriodClass(int64(value))
}

// legacyRevAPeriodMs là chu kỳ của profile 2.1 KHÔNG còn trong tập 2.2
// (ADR-061). Active Revision trên bo đang chạy Program 30000 ms; Draft và
// Revision cũ mang giá trị này phải còn đọc được để người dùng thấy và sửa.
var legacyRevAPeriodMs = [...]int64{30000}

// storedPeriodMs: chu kỳ được phép NẰM trong một tài liệu đã lưu — tập hiện
// hành cộng tập legacy. Chỉ dùng cho phép kiểm cấu trúc của Draft; không bao giờ
// dùng để cho phép ĐẶT chu kỳ hay cho Check qua.
func storedPeriodMs(value float64) bool {
	if allowedPeriodMs(value) {
		return true
	}
	for _, period := range legacyRevAPeriodMs {
		if value == float64(period) {
			return true
		}
	}
	return false
}

// defaultProgramPeriodMs là chu kỳ gán cho Program mới khi Draft chưa có chu
// kỳ hợp lệ nào để kế thừa. Cố ý KHÔNG lấy `AllowedPeriodMs[0]`: phần tử đầu
// của tập mới là 10 ms, và một Program mới tự chạy ở nhịp nhanh nhất là một
// quyết định tải CPU mà người dùng không hề đưa ra.
const defaultProgramPeriodMs = 1000

// PeriodNotAllowedError: thao tác Draft đặt chu kỳ ngoài tập (C1). Nó vẫn LÀ
// `ErrInvalidRequest` (400) để mọi caller cũ giữ nguyên hành vi, nhưng lớp HTTP
// gắn thêm `detailCode=ST-SCHED-001` và giá trị bị từ chối.
type PeriodNotAllowedError struct {
	PeriodMs float64
}

func (e *PeriodNotAllowedError) Error() string {
	return fmt.Sprintf("%s: periodMs=%v ngoài tập %v", detailCodeScheduleOutOfSet, e.PeriodMs, domain.AllowedPeriodMs)
}

func (e *PeriodNotAllowedError) Unwrap() error { return ErrInvalidRequest }

// DetailCode trả mã chẩn đoán C1 cho lớp HTTP.
func (e *PeriodNotAllowedError) DetailCode() string { return detailCodeScheduleOutOfSet }

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
	// `AC-PIO-ID-01` (`ISS-PIO-31`/`ISS-PIO-01`): `extIndex` là HANDLE RUNTIME,
	// không phải danh tính. Hình dạng mở ở trên nghĩa là mọi khoá client gửi
	// đều được chép nguyên vào tài liệu bền — nên nếu không chặn ở đây, một
	// `extIndex` lọt vào sẽ NẰM LẠI trong binding đã seal, và người đọc sau này
	// hoàn toàn có thể tin nó. Đó đúng là hạt giống của lỗi mà cả chuỗi
	// `ISS-PIO-31` sinh ra để dẹp: slot `14` bị coi là danh tính lâu dài của
	// một điểm, rồi cấu hình dịch chỗ và lệnh bơm đi sai thanh ghi.
	//
	// TỪ CHỐI chứ không âm thầm gỡ bỏ: gỡ bỏ sẽ khiến client tưởng nó đã lưu
	// được thứ nó gửi. Không client nào hôm nay gửi trường này —
	// `ProgrammingPointIdentity` của FE chỉ có `(category, pointId, deviceId)`
	// — nên từ chối không phá ai, mà giữ cửa đóng cho mai sau.
	if bindingCarriesRuntimeSlotHandle(envelope.Binding) {
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

// bindingCarriesRuntimeSlotHandle bắt `extIndex` ở cả thân binding lẫn trong
// `point`, và không phân biệt hoa thường: ba tầng sinh JSON này độc lập nhau,
// nên một phép so khớp chính xác từng chữ sẽ để lọt đúng biến thể mà ai đó gõ
// khác đi.
func bindingCarriesRuntimeSlotHandle(binding map[string]any) bool {
	if hasRuntimeSlotKey(binding) {
		return true
	}
	point, _ := binding["point"].(map[string]any)
	return hasRuntimeSlotKey(point)
}

// removePersistedBindingRuntimeHandlesV2 là cầu nâng cấp cho Draft v2 đã lưu
// trước AC-PIO-ID-01. `extIndex` chỉ là handle của lần nạp cấu hình trước; danh
// tính bền `(category, deviceId, pointId)` vẫn nguyên vẹn và Check sẽ phân giải
// lại slot từ Point Catalog đang chạy.
//
// Hàm này PHẢI chạy trước khi áp operation mới. Nhờ vậy dữ liệu tồn dư được
// sửa, còn `upsertBindingCompat` vẫn từ chối request mới cố ghi `extIndex`.
func removePersistedBindingRuntimeHandlesV2(document map[string]any) {
	for _, binding := range collectionOf(document, "bindings") {
		removeRuntimeSlotKeys(binding)
		point, _ := binding["point"].(map[string]any)
		removeRuntimeSlotKeys(point)
	}
}

func removeRuntimeSlotKeys(object map[string]any) {
	for key := range object {
		if strings.EqualFold(key, "extIndex") || strings.EqualFold(key, "ext_index") {
			delete(object, key)
		}
	}
}

func hasRuntimeSlotKey(object map[string]any) bool {
	for key := range object {
		if strings.EqualFold(key, "extIndex") || strings.EqualFold(key, "ext_index") {
			return true
		}
	}
	return false
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
		return &PeriodNotAllowedError{PeriodMs: payload.Task.PeriodMs}
	}
	// T59-702 — `programOrder` phải THẬT SỰ chọn Program, không phải trang trí.
	//
	// Profile cho nhiều lớp chu kỳ (ADR-061: 10…50000 ms), packager đã nhận
	// `--period <program>=<ms>` theo từng Program, và `packageTopology` đã đếm
	// Program theo từng chu kỳ. Nhưng tầng draft lại áp một `periodMs` cho MỌI
	// Program, nên không có đường nào dựng một package nhiều chu kỳ — tức
	// `VS-PROG-U05` ("10 Program / 3 period") không thể chạy bằng API sản phẩm,
	// dù mọi tầng dưới đã sẵn sàng.
	//
	// Danh sách rỗng giữ nguyên nghĩa cũ (áp cho tất cả) để Project một chu kỳ
	// không phải sửa gì.
	programs := collectionOf(document, "programs")
	if len(payload.Task.ProgramOrder) == 0 {
		for _, program := range programs {
			program["periodMs"] = payload.Task.PeriodMs
			delete(program, "taskId")
		}
		return nil
	}
	selected := make(map[string]bool, len(payload.Task.ProgramOrder))
	for _, id := range payload.Task.ProgramOrder {
		selected[id] = true
	}
	matched := 0
	for _, program := range programs {
		id, _ := program["programId"].(string)
		if !selected[id] {
			continue
		}
		program["periodMs"] = payload.Task.PeriodMs
		if payload.Task.TaskID != "" {
			program["taskId"] = payload.Task.TaskID
		}
		matched++
	}
	// Một `programOrder` trỏ tới Program không tồn tại là lỗi người gọi, không
	// phải một lệnh không-làm-gì: im lặng bỏ qua sẽ để lại một Task rỗng mà
	// người dùng tưởng đã cấu hình xong.
	if matched != len(selected) {
		return ErrInvalidRequest
	}
	return nil
}

// currentTaskPeriod chọn chu kỳ cho Program mới tạo qua op v1: kế thừa chu kỳ
// HỢP LỆ đầu tiên của Draft, nếu không có thì 1000 ms. Không kế thừa chu kỳ
// legacy (30000 ms) — làm vậy là tự tạo thêm một Program mà Check chắc chắn từ
// chối.
func currentTaskPeriod(document map[string]any) float64 {
	for _, program := range collectionOf(document, "programs") {
		if period, ok := program["periodMs"].(float64); ok && allowedPeriodMs(period) {
			return period
		}
	}
	return defaultProgramPeriodMs
}
