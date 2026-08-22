package application

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	programmingstore "mkddc-web/internal/programming/store"
)

type operationHeader struct {
	Op string `json:"op"`
}

func applyDraftOperations(content []byte, operations []json.RawMessage) ([]byte, error) {
	var document map[string]any
	if err := json.Unmarshal(content, &document); err != nil {
		return nil, fmt.Errorf("decode Draft: %w", err)
	}
	// Draft cũ được nâng lên v2 NGAY ở lần ghi đầu tiên, không phải khi seal.
	// Migrate muộn nghĩa là mọi thao tác trung gian vẫn chạy trên hai đời model
	// cùng lúc — đúng lối để hai bộ luật trôi khỏi nhau.
	if err := migrateDraftToV2(document); err != nil {
		return nil, err
	}
	for _, raw := range operations {
		var header operationHeader
		if err := json.Unmarshal(raw, &header); err != nil || header.Op == "" {
			return nil, ErrInvalidRequest
		}
		handled, err := applyDraftOperationV2(document, header.Op, raw)
		if err != nil {
			return nil, err
		}
		if handled {
			continue
		}
		if err := applyDraftOperation(document, header.Op, raw); err != nil {
			return nil, err
		}
	}
	if err := validateDraftDocumentV2(document); err != nil {
		return nil, err
	}
	return json.Marshal(document)
}

func applyDraftOperation(document map[string]any, operation string, raw []byte) error {
	switch operation {
	case "setFunctionalTags":
		var value struct {
			Op   string   `json:"op"`
			Tags []string `json:"tags"`
		}
		if err := decodeStrict(raw, &value); err != nil || len(value.Tags) > 64 {
			return ErrInvalidRequest
		}
		project, ok := document["project"].(map[string]any)
		if !ok {
			return ErrInvalidRequest
		}
		seen := make(map[string]struct{}, len(value.Tags))
		tags := make([]any, 0, len(value.Tags))
		for _, tag := range value.Tags {
			tag = strings.TrimSpace(tag)
			if !validText(tag, 1, 64) {
				return ErrInvalidRequest
			}
			key := strings.ToLower(tag)
			if _, duplicate := seen[key]; duplicate {
				return ErrInvalidRequest
			}
			seen[key] = struct{}{}
			tags = append(tags, tag)
		}
		project["functionalTags"] = tags
		return nil
	case "replaceProgramSource":
		var value struct {
			Op        string `json:"op"`
			ProgramID string `json:"programId"`
			Language  string `json:"language"`
			Source    string `json:"source"`
		}
		if err := decodeStrict(raw, &value); err != nil || !isUUID(value.ProgramID) || (value.Language != "ST" && value.Language != "FBD") || len(value.Source) > 65536 {
			return ErrInvalidRequest
		}
		// v2: nguồn nằm ở POU (`objects`), không nằm ở cấu hình Program. Tham số
		// vẫn tên `programId` để client cũ không phải đổi, nhưng nó phân giải
		// theo `objectId` — cùng một identity sau migration.
		object, found := objectByID(document, "objects", "objectId", value.ProgramID)
		if !found {
			return ErrInvalidRequest
		}
		object["language"] = value.Language
		object["source"] = value.Source
		return nil
	default:
		return fmt.Errorf("%w: operation %q", ErrInvalidRequest, operation)
	}
}

func upsertObjectOperation(document map[string]any, collection, idField, payloadField string, raw []byte, limit int) error {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil || len(envelope) != 2 {
		return ErrInvalidRequest
	}
	if string(envelope["op"]) == "" || envelope[payloadField] == nil {
		return ErrInvalidRequest
	}
	var object map[string]any
	if err := json.Unmarshal(envelope[payloadField], &object); err != nil {
		return ErrInvalidRequest
	}
	id, ok := object[idField].(string)
	if !ok || !isUUID(id) {
		return ErrInvalidRequest
	}
	items, ok := document[collection].([]any)
	if !ok {
		return ErrInvalidRequest
	}
	for index, item := range items {
		candidate, ok := item.(map[string]any)
		if ok && candidate[idField] == id {
			items[index] = object
			document[collection] = items
			return nil
		}
	}
	if len(items) >= limit {
		return ErrInvalidRequest
	}
	document[collection] = append(items, object)
	return nil
}

func removeObjectOperation(document map[string]any, collection, idField string, raw []byte) error {
	var value struct {
		Op string `json:"op"`
		ID string `json:"id"`
	}
	var generic map[string]json.RawMessage
	if err := json.Unmarshal(raw, &generic); err != nil || len(generic) != 2 {
		return ErrInvalidRequest
	}
	idRaw, ok := generic[idField]
	if !ok || json.Unmarshal(idRaw, &value.ID) != nil || !isUUID(value.ID) {
		return ErrInvalidRequest
	}
	items, ok := document[collection].([]any)
	if !ok {
		return ErrInvalidRequest
	}
	for index, item := range items {
		candidate, ok := item.(map[string]any)
		if ok && candidate[idField] == value.ID {
			document[collection] = append(items[:index:index], items[index+1:]...)
			return nil
		}
	}
	return ErrInvalidRequest
}

func validateDraftDocument(document map[string]any) error {
	version, ok := document["schemaVersion"].(float64)
	if !ok || version != 1 {
		return ErrInvalidRequest
	}
	project, ok := document["project"].(map[string]any)
	if !ok || !stringUUID(project["projectId"]) {
		return ErrInvalidRequest
	}
	programs, programIDs, err := validateCollection(document, "programs", "programId", 64)
	if err != nil {
		return err
	}
	for _, program := range programs {
		language, ok := program["language"].(string)
		if !ok || (language != "ST" && language != "FBD") {
			return ErrInvalidRequest
		}
		if source, ok := program["document"].(string); ok && language == "ST" && len(source) > 65536 {
			return ErrInvalidRequest
		}
	}
	variables, variableIDs, err := validateCollection(document, "variables", "variableId", 512)
	if err != nil {
		return err
	}
	for _, variable := range variables {
		programID, ok := variable["programId"].(string)
		if !ok {
			return ErrInvalidRequest
		}
		if _, exists := programIDs[programID]; !exists {
			return ErrInvalidRequest
		}
	}
	bindings, bindingIDs, err := validateCollection(document, "bindings", "bindingId", 256)
	if err != nil {
		return err
	}
	for _, binding := range bindings {
		variableID, ok := binding["variableId"].(string)
		if !ok {
			return ErrInvalidRequest
		}
		if _, exists := variableIDs[variableID]; !exists {
			return ErrInvalidRequest
		}
	}
	task, ok := document["task"].(map[string]any)
	if !ok || !stringUUID(task["taskId"]) {
		return ErrInvalidRequest
	}
	allIDs := map[string]struct{}{project["projectId"].(string): {}}
	for _, ids := range []map[string]struct{}{programIDs, variableIDs} {
		for id := range ids {
			if _, duplicate := allIDs[id]; duplicate {
				return ErrInvalidRequest
			}
			allIDs[id] = struct{}{}
		}
	}
	for id := range bindingIDs {
		if _, duplicate := allIDs[id]; duplicate {
			return ErrInvalidRequest
		}
		allIDs[id] = struct{}{}
	}
	taskID := task["taskId"].(string)
	if _, duplicate := allIDs[taskID]; duplicate {
		return ErrInvalidRequest
	}
	period, ok := task["periodMs"].(float64)
	if !ok || (period != 1000 && period != 5000 && period != 30000) {
		return ErrInvalidRequest
	}
	order, ok := task["programOrder"].([]any)
	if !ok || len(order) != len(programIDs) {
		return ErrInvalidRequest
	}
	ordered := make(map[string]struct{}, len(order))
	for _, item := range order {
		id, ok := item.(string)
		if !ok || !isUUID(id) {
			return ErrInvalidRequest
		}
		if _, exists := programIDs[id]; !exists {
			return ErrInvalidRequest
		}
		if _, duplicate := ordered[id]; duplicate {
			return ErrInvalidRequest
		}
		ordered[id] = struct{}{}
	}
	return nil
}

func validateCollection(document map[string]any, field, idField string, limit int) ([]map[string]any, map[string]struct{}, error) {
	raw, ok := document[field].([]any)
	if !ok || len(raw) > limit {
		return nil, nil, ErrInvalidRequest
	}
	items := make([]map[string]any, 0, len(raw))
	ids := make(map[string]struct{}, len(raw))
	for _, rawItem := range raw {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil, nil, ErrInvalidRequest
		}
		id, ok := item[idField].(string)
		if !ok || !isUUID(id) {
			return nil, nil, ErrInvalidRequest
		}
		if _, duplicate := ids[id]; duplicate {
			return nil, nil, ErrInvalidRequest
		}
		ids[id] = struct{}{}
		items = append(items, item)
	}
	return items, ids, nil
}

func stringUUID(value any) bool {
	text, ok := value.(string)
	return ok && isUUID(text)
}

func objectByID(document map[string]any, collection, idField, id string) (map[string]any, bool) {
	items, ok := document[collection].([]any)
	if !ok {
		return nil, false
	}
	for _, item := range items {
		candidate, ok := item.(map[string]any)
		if ok && candidate[idField] == id {
			return candidate, true
		}
	}
	return nil, false
}

// revisionPayload dựng object + manifest cho Revision v2. POU đi CẢ HAI đường:
// `RevisionObjectInput` (ảnh chụp tài liệu, giữ tương thích bundle/diff) và
// `POUObjectInput` (bảng POU chuẩn hoá mà T59-201 seal cùng library usage).
// Không phải nhân bản thừa: đường thứ nhất là tài liệu người dùng, đường thứ hai
// là dữ liệu compiler/Check đọc — trộn chúng lại sẽ buộc một bên đọc định dạng
// của bên kia.
func revisionPayload(content []byte, projectID, label, comment string) ([]programmingstore.RevisionObjectInput,
	[]programmingstore.POUObjectInput, []byte, error) {
	var document map[string]any
	if err := json.Unmarshal(content, &document); err != nil {
		return nil, nil, nil, ErrInvalidRequest
	}
	if err := migrateDraftToV2(document); err != nil {
		return nil, nil, nil, err
	}
	if err := validateDraftDocumentV2(document); err != nil {
		return nil, nil, nil, err
	}
	type objectDescriptor struct {
		ObjectID string `json:"objectId"`
		Kind     string `json:"kind"`
		SHA256   string `json:"sha256"`
	}
	objects := make([]programmingstore.RevisionObjectInput, 0)
	descriptors := make([]objectDescriptor, 0)
	appendObject := func(id, kind string, value any) error {
		payload, err := json.Marshal(value)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(payload)
		objects = append(objects, programmingstore.RevisionObjectInput{ObjectID: id, Kind: kind, PayloadJSON: payload})
		descriptors = append(descriptors, objectDescriptor{ObjectID: id, Kind: kind, SHA256: hex.EncodeToString(digest[:])})
		return nil
	}
	metadata := map[string]any{"project": document["project"], "library": document["library"],
		"execution": document["execution"]}
	if err := appendObject(projectID, "METADATA", metadata); err != nil {
		return nil, nil, nil, err
	}

	// Cấu hình Program đi CÙNG payload của POU kind PROGRAM thay vì thành một
	// Revision object riêng: `revision_objects` khoá theo `object_id` duy nhất,
	// và Program là quan hệ 1:1 với đúng một PROGRAM POU (validate đã ép). Tách
	// thành hai object sẽ buộc phải bịa một UUID thứ hai cho cùng một thứ.
	configByObject := make(map[string]map[string]any, len(collectionOf(document, "programs")))
	for _, program := range collectionOf(document, "programs") {
		objectID, _ := program["objectId"].(string)
		configByObject[objectID] = program
	}
	pous := make([]programmingstore.POUObjectInput, 0, len(collectionOf(document, "objects")))
	for _, object := range collectionOf(document, "objects") {
		objectID, _ := object["objectId"].(string)
		kind, _ := object["kind"].(string)
		name, _ := object["name"].(string)
		language, _ := object["language"].(string)
		source, _ := object["source"].(string)
		payload := object
		if config, ok := configByObject[objectID]; ok {
			payload = make(map[string]any, len(object)+1)
			for key, value := range object {
				payload[key] = value
			}
			payload["programConfig"] = config
		}
		if err := appendObject(objectID, kind, payload); err != nil {
			return nil, nil, nil, err
		}
		interfaceJSON := []byte(`{"ports":[]}`)
		if declared, ok := object["interface"]; ok {
			encoded, err := json.Marshal(declared)
			if err != nil {
				return nil, nil, nil, err
			}
			interfaceJSON = encoded
		}
		// POU rỗng không seal được: bảng `pou_objects` bắt source 1..65536 byte.
		// Một dòng chú thích là ít nhất có thật, còn chuỗi rỗng thì không.
		if source == "" {
			source = "(* " + name + " *)\n"
		}
		dependencies := make([]programmingstore.LibraryDependency, 0)
		if declared, ok := object["dependencies"].([]any); ok {
			for _, item := range declared {
				id, ok := item.(string)
				if !ok {
					return nil, nil, nil, ErrInvalidRequest
				}
				dependencies = append(dependencies, programmingstore.LibraryDependency{EntryID: id})
			}
		}
		pous = append(pous, programmingstore.POUObjectInput{
			ObjectID: objectID, Kind: kind, Name: name, Language: language,
			InterfaceJSON: interfaceJSON, SourceBlob: []byte(source), Dependencies: dependencies,
		})
	}
	for _, field := range []struct{ collection, id, kind string }{
		{"signals", "signalId", "SIGNAL"},
		{"bindings", "bindingId", "BINDING"},
	} {
		for _, item := range collectionOf(document, field.collection) {
			id, _ := item[field.id].(string)
			if err := appendObject(id, field.kind, item); err != nil {
				return nil, nil, nil, err
			}
		}
	}

	documentDigest := sha256.Sum256(content)
	manifest := map[string]any{"schemaVersion": 1, "targetProfile": targetProfile, "projectId": projectID,
		"label": label, "comment": comment, "draftContentSha256": hex.EncodeToString(documentDigest[:]), "objects": descriptors}
	manifestJSON, err := json.Marshal(manifest)
	return objects, pous, manifestJSON, err
}

// sealProgramCount đọc số Program cấu hình trong Draft. Trả 0 khi tài liệu chưa
// migrate được hoặc chưa có Program nào — caller giữ giá trị mặc định thay vì
// đoán.
func sealProgramCount(content []byte) int {
	var document map[string]any
	if err := json.Unmarshal(content, &document); err != nil {
		return 0
	}
	if err := migrateDraftToV2(document); err != nil {
		return 0
	}
	return len(collectionOf(document, "programs"))
}
