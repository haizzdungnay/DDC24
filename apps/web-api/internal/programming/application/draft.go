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
	for _, raw := range operations {
		var header operationHeader
		if err := json.Unmarshal(raw, &header); err != nil || header.Op == "" {
			return nil, ErrInvalidRequest
		}
		if err := applyDraftOperation(document, header.Op, raw); err != nil {
			return nil, err
		}
	}
	if err := validateDraftDocument(document); err != nil {
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
		program, found := objectByID(document, "programs", "programId", value.ProgramID)
		if !found {
			return ErrInvalidRequest
		}
		program["language"] = value.Language
		program["document"] = value.Source
		return nil
	case "upsertProgram":
		return upsertObjectOperation(document, "programs", "programId", "program", raw, 64)
	case "removeProgram":
		return removeObjectOperation(document, "programs", "programId", raw)
	case "upsertVariable":
		return upsertObjectOperation(document, "variables", "variableId", "variable", raw, 512)
	case "removeVariable":
		return removeObjectOperation(document, "variables", "variableId", raw)
	case "upsertBinding":
		return upsertObjectOperation(document, "bindings", "bindingId", "binding", raw, 256)
	case "removeBinding":
		return removeObjectOperation(document, "bindings", "bindingId", raw)
	case "setTask":
		var value struct {
			Op   string         `json:"op"`
			Task map[string]any `json:"task"`
		}
		if err := decodeStrict(raw, &value); err != nil || value.Task == nil {
			return ErrInvalidRequest
		}
		document["task"] = value.Task
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

func revisionPayload(content []byte, projectID, label, comment string) ([]programmingstore.RevisionObjectInput, []byte, error) {
	var document map[string]any
	if err := json.Unmarshal(content, &document); err != nil {
		return nil, nil, ErrInvalidRequest
	}
	if err := validateDraftDocument(document); err != nil {
		return nil, nil, err
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
	metadata := map[string]any{"project": document["project"], "library": document["library"]}
	if err := appendObject(projectID, "METADATA", metadata); err != nil {
		return nil, nil, err
	}
	for _, definition := range []struct {
		field, id, kind string
	}{{"programs", "programId", "PROGRAM"}, {"variables", "variableId", "VARIABLE"}, {"bindings", "bindingId", "BINDING"}} {
		items, _ := document[definition.field].([]any)
		for _, item := range items {
			object := item.(map[string]any)
			kind := definition.kind
			if definition.field == "programs" {
				if declared, ok := object["kind"].(string); ok && (declared == "PROGRAM" || declared == "FUNCTION" || declared == "FUNCTION_BLOCK") {
					kind = declared
				}
			}
			if err := appendObject(object[definition.id].(string), kind, object); err != nil {
				return nil, nil, err
			}
		}
	}
	task := document["task"].(map[string]any)
	if err := appendObject(task["taskId"].(string), "TASK", task); err != nil {
		return nil, nil, err
	}
	documentDigest := sha256.Sum256(content)
	manifest := map[string]any{"schemaVersion": 1, "targetProfile": targetProfile, "projectId": projectID,
		"label": label, "comment": comment, "draftContentSha256": hex.EncodeToString(documentDigest[:]), "objects": descriptors}
	manifestJSON, err := json.Marshal(manifest)
	return objects, manifestJSON, err
}
