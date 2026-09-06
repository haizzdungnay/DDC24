package application

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const BindingValidationSchemaVersion = "1.0"

type BindingPointIdentity struct {
	Category string `json:"category"`
	PointID  string `json:"pointId"`
	DeviceID string `json:"deviceId,omitempty"`
}

type BindingCandidate struct {
	BindingID     string               `json:"bindingId"`
	VariableID    string               `json:"variableId"`
	Point         BindingPointIdentity `json:"point"`
	Direction     string               `json:"direction"`
	DataType      string               `json:"dataType"`
	Unit          string               `json:"unit,omitempty"`
	Writable      bool                 `json:"writable"`
	QualityPolicy string               `json:"qualityPolicy"`
}

type BindingValidationIssue struct {
	Code              string `json:"code"`
	DetailCode        string `json:"detailCode"`
	Severity          string `json:"severity"`
	Field             string `json:"field"`
	BindingID         string `json:"bindingId,omitempty"`
	VariableID        string `json:"variableId,omitempty"`
	ProgramID         string `json:"programId,omitempty"`
	OwnerProgramID    string `json:"ownerProgramId,omitempty"`
	ConflictProgramID string `json:"conflictProgramId,omitempty"`
	Category          string `json:"category,omitempty"`
	DeviceID          string `json:"deviceId,omitempty"`
	PointID           string `json:"pointId,omitempty"`
	Expected          string `json:"expected,omitempty"`
	Actual            string `json:"actual,omitempty"`
}

type BindingValidationResult struct {
	SchemaVersion string                   `json:"schemaVersion"`
	Verdict       string                   `json:"verdict"`
	Issues        []BindingValidationIssue `json:"issues"`
}

type BindingPreviewView struct {
	BindingValidationResult
	ProjectID       string `json:"projectId"`
	DraftRevisionID string `json:"draftRevisionId"`
	BaseRevisionID  string `json:"baseRevisionId"`
	ETag            string `json:"etag"`
}

type bindingVariable struct {
	ID, ProgramID, Name, DataType, Unit, Class string
}

func bindingPointKey(point BindingPointIdentity) string {
	return strings.ToUpper(strings.TrimSpace(point.Category)) + "\x00" +
		strings.TrimSpace(point.DeviceID) + "\x00" + strings.TrimSpace(point.PointID)
}

func catalogPointKey(point PointCatalogEntry) string {
	return bindingPointKey(BindingPointIdentity{Category: point.Category, DeviceID: point.DeviceID, PointID: point.PointID})
}

func bindingIssue(code domain.ErrorCode, detail, severity, field string, candidate BindingCandidate) BindingValidationIssue {
	issue := BindingValidationIssue{Code: string(code), DetailCode: detail, Severity: severity, Field: field,
		DeviceID: candidate.Point.DeviceID, PointID: candidate.Point.PointID}
	// Context trong response cũng phải hợp OpenAPI. Payload xấu không được làm
	// server tự phát ra UUID/category sai schema chỉ vì muốn lặp lại input.
	if isUUID(candidate.BindingID) {
		issue.BindingID = candidate.BindingID
	}
	if isUUID(candidate.VariableID) {
		issue.VariableID = candidate.VariableID
	}
	if candidate.Point.Category == "LOCAL" || candidate.Point.Category == "VP" || candidate.Point.Category == "MB_RTU" {
		issue.Category = candidate.Point.Category
	}
	return issue
}

func bindingVariablesFromDocument(document map[string]any) map[string]bindingVariable {
	result := make(map[string]bindingVariable)
	programByObject := make(map[string]string)
	for _, program := range collectionOf(document, "programs") {
		objectID, _ := program["objectId"].(string)
		programID, _ := program["programId"].(string)
		if objectID == "" {
			objectID = programID
		}
		programByObject[objectID] = programID
	}
	for _, object := range collectionOf(document, "objects") {
		objectID, _ := object["objectId"].(string)
		programID := programByObject[objectID]
		if programID == "" {
			programID = objectID
		}
		for _, item := range collectionOf(object, "locals") {
			id, _ := item["variableId"].(string)
			owner, _ := item["programId"].(string)
			if owner == "" {
				owner = programID
			}
			result[id] = bindingVariable{ID: id, ProgramID: owner, Name: stringValue(item["name"]),
				DataType: stringValue(item["type"]), Unit: stringValue(item["unit"]), Class: strings.ToUpper(stringValue(item["class"]))}
		}
	}
	for _, item := range collectionOf(document, "variables") {
		id := stringValue(item["variableId"])
		result[id] = bindingVariable{ID: id, ProgramID: stringValue(item["programId"]), Name: stringValue(item["name"]),
			DataType: stringValue(item["type"]), Unit: stringValue(item["unit"]), Class: strings.ToUpper(stringValue(item["class"]))}
	}
	return result
}

func stringValue(value any) string { text, _ := value.(string); return text }

func bindingCandidatesFromDocument(document map[string]any) []BindingCandidate {
	result := make([]BindingCandidate, 0)
	for _, item := range collectionOf(document, "bindings") {
		raw, err := json.Marshal(item)
		if err != nil {
			continue
		}
		var candidate BindingCandidate
		if json.Unmarshal(raw, &candidate) == nil && candidate.VariableID != "" && candidate.Point.Category != "" {
			result = append(result, candidate)
		}
	}
	return result
}

func ValidateBindingCandidate(candidate BindingCandidate, variables map[string]bindingVariable,
	existing []BindingCandidate, catalog []PointCatalogEntry) BindingValidationResult {
	issues := make([]BindingValidationIssue, 0)
	if !isUUID(candidate.BindingID) {
		issues = append(issues, bindingIssue(domain.ErrRequest, "PGM-MAP-BINDING-001", "ERROR", "binding.bindingId", candidate))
	}
	variable, found := variables[candidate.VariableID]
	if !found || candidate.VariableID == "" {
		issues = append(issues, bindingIssue(domain.ErrMapIdentity, "PGM-MAP-VARIABLE-001", "ERROR", "binding.variableId", candidate))
		return bindingResult(issues)
	}
	categoryValid := candidate.Point.Category == "LOCAL" || candidate.Point.Category == "VP" || candidate.Point.Category == "MB_RTU"
	pointValid := validText(candidate.Point.PointID, 1, 64)
	deviceValid := (candidate.Point.Category == "MB_RTU" && validText(candidate.Point.DeviceID, 1, 64)) ||
		(candidate.Point.Category != "MB_RTU" && candidate.Point.DeviceID == "")
	if !categoryValid || !pointValid || !deviceValid {
		field := "binding.point"
		if !categoryValid {
			field = "binding.point.category"
		} else if !pointValid {
			field = "binding.point.pointId"
		} else {
			field = "binding.point.deviceId"
		}
		issues = append(issues, bindingIssue(domain.ErrMapIdentity, "PGM-MAP-POINT-001", "ERROR", field, candidate))
		return bindingResult(issues)
	}
	pointByKey := make(map[string]PointCatalogEntry, len(catalog))
	for _, point := range catalog {
		pointByKey[catalogPointKey(point)] = point
	}
	point, pointFound := pointByKey[bindingPointKey(candidate.Point)]
	if !pointFound {
		issues = append(issues, bindingIssue(domain.ErrMapIdentity, "PGM-MAP-POINT-001", "ERROR", "binding.point", candidate))
		return bindingResult(issues)
	}
	direction := candidate.Direction
	expectedDirection := ""
	switch variable.Class {
	case "INPUT":
		expectedDirection = "READ"
	case "OUTPUT":
		expectedDirection = "WRITE"
	default:
		expectedDirection = "UNSUPPORTED"
	}
	if direction != expectedDirection {
		issue := bindingIssue(domain.ErrMapIdentity, "PGM-MAP-DIRECTION-001", "ERROR", "binding.direction", candidate)
		issue.Expected, issue.Actual = expectedDirection, direction
		issues = append(issues, issue)
	}
	decision := point.Mapping.Input
	if expectedDirection == "WRITE" {
		decision = point.Mapping.Output
	}
	if decision.Status != MapEligibilitySupported {
		issue := bindingIssue(domain.ErrMapIdentity, "PGM-MAP-ELIGIBILITY-001", "ERROR", "binding.point", candidate)
		issue.Expected, issue.Actual = MapEligibilitySupported, decision.Status
		issues = append(issues, issue)
	}
	if variable.DataType == "" || candidate.DataType != variable.DataType {
		issue := bindingIssue(domain.ErrMapType, "PGM-MAP-TYPE-001", "ERROR", "binding.dataType", candidate)
		issue.Expected, issue.Actual = variable.DataType, candidate.DataType
		issues = append(issues, issue)
	} else if point.DataType != variable.DataType {
		issue := bindingIssue(domain.ErrMapType, "PGM-MAP-TYPE-001", "ERROR", "binding.point.dataType", candidate)
		issue.Expected, issue.Actual = variable.DataType, point.DataType
		issues = append(issues, issue)
	}
	if (candidate.Writable && !point.Writable) || (expectedDirection == "WRITE" && point.Writable && !candidate.Writable) {
		issue := bindingIssue(domain.ErrMapIdentity, "PGM-MAP-WRITABLE-002", "ERROR", "binding.writable", candidate)
		issue.Expected, issue.Actual = boolText(point.Writable), boolText(candidate.Writable)
		issues = append(issues, issue)
	}
	if expectedDirection == "WRITE" && (!point.Writable || (point.Direction != "WRITE" && point.Direction != "READ_WRITE")) {
		issues = append(issues, bindingIssue(domain.ErrMapIdentity, "PGM-MAP-WRITABLE-001", "ERROR", "binding.point", candidate))
	}
	if expectedDirection == "READ" && point.Direction != "READ" && point.Direction != "READ_WRITE" {
		issues = append(issues, bindingIssue(domain.ErrMapIdentity, "PGM-MAP-READABLE-001", "ERROR", "binding.point", candidate))
	}
	if !validText(candidate.Unit, 0, 32) {
		issues = append(issues, bindingIssue(domain.ErrRequest, "PGM-MAP-BINDING-002", "ERROR", "binding.unit", candidate))
	} else if candidate.Unit != point.Unit {
		issue := bindingIssue(domain.ErrMapType, "PGM-MAP-UNIT-001", "WARNING", "binding.unit", candidate)
		issue.Expected, issue.Actual = point.Unit, candidate.Unit
		issues = append(issues, issue)
	} else if variable.Unit != "" && point.Unit != "" && variable.Unit != point.Unit {
		issue := bindingIssue(domain.ErrMapType, "PGM-MAP-UNIT-001", "WARNING", "binding.point.unit", candidate)
		issue.Expected, issue.Actual = variable.Unit, point.Unit
		issues = append(issues, issue)
	}
	qualityPolicy := candidate.QualityPolicy
	if qualityPolicy != "REQUIRE_GOOD" && qualityPolicy != "ALLOW_UNCERTAIN" && qualityPolicy != "FAIL_POLICY" {
		issues = append(issues, bindingIssue(domain.ErrRequest, "PGM-MAP-QUALITY-POLICY-001", "ERROR", "binding.qualityPolicy", candidate))
	} else if point.Quality != "GOOD" {
		severity := "ERROR"
		if qualityPolicy == "ALLOW_UNCERTAIN" && point.Quality == "UNCERTAIN" {
			severity = "WARNING"
		}
		issue := bindingIssue(domain.ErrMapIdentity, "PGM-MAP-QUALITY-001", severity, "binding.qualityPolicy", candidate)
		issue.Expected, issue.Actual = qualityPolicy, point.Quality
		issues = append(issues, issue)
	}
	if expectedDirection == "WRITE" {
		for _, other := range existing {
			if other.BindingID == candidate.BindingID || strings.ToUpper(other.Direction) != "WRITE" || bindingPointKey(other.Point) != bindingPointKey(candidate.Point) {
				continue
			}
			otherVariable, ok := variables[other.VariableID]
			if ok && otherVariable.ProgramID != "" && otherVariable.ProgramID != variable.ProgramID {
				issue := bindingIssue(domain.ErrOutputOwner, "PGM-MAP-OWNER-001", "ERROR", "binding.point", candidate)
				issue.ProgramID, issue.OwnerProgramID, issue.ConflictProgramID = variable.ProgramID, otherVariable.ProgramID, variable.ProgramID
				issues = append(issues, issue)
			}
		}
	}
	return bindingResult(issues)
}

func boolText(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func bindingResult(issues []BindingValidationIssue) BindingValidationResult {
	sort.SliceStable(issues, func(i, j int) bool {
		if issues[i].DetailCode != issues[j].DetailCode {
			return issues[i].DetailCode < issues[j].DetailCode
		}
		return issues[i].Field < issues[j].Field
	})
	verdict := "ALLOW"
	for _, issue := range issues {
		if issue.Severity == "ERROR" {
			verdict = "BLOCK"
			break
		}
		verdict = "WARN"
	}
	if issues == nil {
		issues = []BindingValidationIssue{}
	}
	return BindingValidationResult{SchemaVersion: BindingValidationSchemaVersion, Verdict: verdict, Issues: issues}
}

func (s *ProjectService) SetPointCatalogProvider(provider PointCatalogProvider) {
	if s != nil {
		s.catalog = provider
	}
}

func bindingUnavailable(field string) error {
	public := domain.NewPublicError(domain.ErrUnavailable)
	public.Field = field
	return &OperationPublicError{Public: public}
}

func bindingBlocked(issue BindingValidationIssue) error {
	public := domain.NewPublicError(domain.ErrorCode(issue.Code))
	public.Field = issue.Field
	public.Args = map[string]any{
		"detailCode": issue.DetailCode, "pointId": issue.PointID, "variable": issue.VariableID,
		"expected": issue.Expected, "actual": issue.Actual, "ownerProgramId": issue.OwnerProgramID,
		"conflictProgramId": issue.ConflictProgramID,
	}
	return &OperationPublicError{Public: public}
}

func pointCatalogSnapshot(ctx context.Context, provider PointCatalogProvider) ([]PointCatalogEntry, error) {
	if provider == nil {
		return nil, bindingUnavailable("pointCatalog")
	}
	catalog, err := provider.ListPointCatalog(ctx)
	if err != nil {
		return nil, bindingUnavailable("pointCatalog")
	}
	for index := range catalog {
		if catalog[index].Mapping.Input.Status == "" && catalog[index].Mapping.Output.Status == "" {
			catalog[index].Mapping = EvaluatePointMapEligibility(catalog[index])
		}
	}
	return catalog, nil
}

func draftOperationsContain(operations []json.RawMessage, wanted string) bool {
	for _, operation := range operations {
		var envelope struct {
			Op string `json:"op"`
		}
		if json.Unmarshal(operation, &envelope) == nil && envelope.Op == wanted {
			return true
		}
	}
	return false
}

func typedBindingOperations(operations []json.RawMessage) ([]BindingCandidate, error) {
	candidates := make([]BindingCandidate, 0)
	for _, operation := range operations {
		var header operationHeader
		if json.Unmarshal(operation, &header) != nil || header.Op != "upsertBinding" {
			continue
		}
		var envelope struct {
			Op      string           `json:"op"`
			Binding BindingCandidate `json:"binding"`
		}
		if decodeStrict(operation, &envelope) != nil {
			return nil, bindingBlocked(BindingValidationIssue{Code: string(domain.ErrRequest), DetailCode: "PGM-MAP-BINDING-002",
				Severity: "ERROR", Field: "binding"})
		}
		candidates = append(candidates, envelope.Binding)
	}
	return candidates, nil
}

func (s *ProjectService) validateDraftBindings(ctx context.Context, content []byte, operations []json.RawMessage) error {
	var document map[string]any
	if json.Unmarshal(content, &document) != nil || migrateDraftToV2(document) != nil {
		return ErrInvalidRequest
	}
	variables := bindingVariablesFromDocument(document)
	candidates := bindingCandidatesFromDocument(document)
	byID := make(map[string]BindingCandidate, len(candidates))
	for _, candidate := range candidates {
		byID[candidate.BindingID] = candidate
	}
	requested, err := typedBindingOperations(operations)
	if err != nil {
		return err
	}
	for _, requestedCandidate := range requested {
		_, found := byID[requestedCandidate.BindingID]
		if !found {
			return bindingBlocked(BindingValidationIssue{Code: string(domain.ErrRequest), DetailCode: "PGM-MAP-BINDING-002",
				Severity: "ERROR", Field: "binding", BindingID: requestedCandidate.BindingID})
		}
	}
	catalog, err := pointCatalogSnapshot(ctx, s.catalog)
	if err != nil {
		return err
	}
	for _, requestedCandidate := range requested {
		candidate := byID[requestedCandidate.BindingID]
		result := ValidateBindingCandidate(candidate, variables, candidates, catalog)
		for _, issue := range result.Issues {
			if issue.Severity == "ERROR" {
				return bindingBlocked(issue)
			}
		}
	}
	return nil
}

func (s *ProjectService) PreviewBinding(ctx context.Context, projectID, baseRevisionID, ifMatch string, candidate BindingCandidate) (BindingPreviewView, error) {
	if !isUUID(projectID) || !isUUID(baseRevisionID) {
		return BindingPreviewView{}, ErrInvalidRequest
	}
	snapshot, err := s.store.GetProject(ctx, projectID)
	if err != nil {
		return BindingPreviewView{}, err
	}
	etag, err := ParseDraftETag(ifMatch, snapshot.Draft.DraftID)
	if err != nil || etag != snapshot.Draft.ETag {
		return BindingPreviewView{}, programmingstore.ErrETagConflict
	}
	expectedBase := snapshot.Draft.BaseRevisionID
	if expectedBase == "" {
		expectedBase = snapshot.Draft.DraftID
	}
	if baseRevisionID != expectedBase {
		return BindingPreviewView{}, programmingstore.ErrETagConflict
	}
	catalog, err := pointCatalogSnapshot(ctx, s.catalog)
	if err != nil {
		return BindingPreviewView{}, err
	}
	var document map[string]any
	if json.Unmarshal(snapshot.Draft.ContentJSON, &document) != nil || migrateDraftToV2(document) != nil {
		return BindingPreviewView{}, ErrInvalidRequest
	}
	result := ValidateBindingCandidate(candidate, bindingVariablesFromDocument(document), bindingCandidatesFromDocument(document), catalog)
	return BindingPreviewView{BindingValidationResult: result, ProjectID: projectID, DraftRevisionID: snapshot.Draft.DraftID,
		BaseRevisionID: expectedBase, ETag: FormatDraftETag(snapshot.Draft.DraftID, snapshot.Draft.ETag)}, nil
}

func bindingInputsFromRevision(objects []revisionObjectView) (map[string]bindingVariable, []BindingCandidate) {
	variables := make(map[string]bindingVariable)
	candidates := make([]BindingCandidate, 0)
	programByObject := make(map[string]string)
	for _, object := range objects {
		if object.Kind != "PROGRAM" && object.Kind != "FUNCTION" && object.Kind != "FUNCTION_BLOCK" {
			continue
		}
		var payload struct {
			ProgramConfig struct {
				ProgramID string `json:"programId"`
			} `json:"programConfig"`
			Locals []struct {
				VariableID string `json:"variableId"`
				ProgramID  string `json:"programId"`
				Name       string `json:"name"`
				Type       string `json:"type"`
				Unit       string `json:"unit"`
				Class      string `json:"class"`
			} `json:"locals"`
		}
		if json.Unmarshal(object.Payload, &payload) != nil {
			continue
		}
		programID := payload.ProgramConfig.ProgramID
		if programID == "" {
			programID = object.ObjectID
		}
		programByObject[object.ObjectID] = programID
		for _, local := range payload.Locals {
			owner := local.ProgramID
			if owner == "" {
				owner = programID
			}
			variables[local.VariableID] = bindingVariable{ID: local.VariableID, ProgramID: owner, Name: local.Name,
				DataType: local.Type, Unit: local.Unit, Class: strings.ToUpper(local.Class)}
		}
	}
	for _, object := range objects {
		switch object.Kind {
		case "VARIABLE":
			var payload struct {
				VariableID string `json:"variableId"`
				ProgramID  string `json:"programId"`
				Name       string `json:"name"`
				Type       string `json:"type"`
				Unit       string `json:"unit"`
				Class      string `json:"class"`
			}
			if json.Unmarshal(object.Payload, &payload) == nil {
				owner := payload.ProgramID
				if mapped := programByObject[owner]; mapped != "" {
					owner = mapped
				}
				variables[payload.VariableID] = bindingVariable{ID: payload.VariableID, ProgramID: owner, Name: payload.Name,
					DataType: payload.Type, Unit: payload.Unit, Class: strings.ToUpper(payload.Class)}
			}
		case "BINDING":
			var candidate BindingCandidate
			if json.Unmarshal(object.Payload, &candidate) == nil && candidate.VariableID != "" && candidate.Point.Category != "" {
				if candidate.BindingID == "" {
					candidate.BindingID = object.ObjectID
				}
				candidates = append(candidates, candidate)
			}
		}
	}
	return variables, candidates
}

func bindingDiagnostic(issue BindingValidationIssue) DiagnosticView {
	public := domain.NewPublicError(domain.ErrorCode(issue.Code))
	location := map[string]any{"field": issue.Field}
	for key, value := range map[string]string{
		"bindingId": issue.BindingID, "variableId": issue.VariableID, "programId": issue.ProgramID,
		"ownerProgramId": issue.OwnerProgramID, "conflictProgramId": issue.ConflictProgramID,
		"category": issue.Category, "deviceId": issue.DeviceID, "pointId": issue.PointID,
	} {
		if value != "" {
			location[key] = value
		}
	}
	return DiagnosticView{Code: issue.Code, DetailCode: issue.DetailCode, Severity: issue.Severity,
		MessageKey: public.MessageKey, Location: location}
}

func bindingCatalogUnavailableDiagnostic() DiagnosticView {
	public := domain.NewPublicError(domain.ErrUnavailable)
	return DiagnosticView{Code: string(public.Code), DetailCode: "PGM-MAP-CATALOG-001", Severity: "ERROR",
		MessageKey: public.MessageKey, Location: map[string]any{"field": "pointCatalog"}}
}

func bindingDiagnosticsForRevision(ctx context.Context, objects []revisionObjectView, provider PointCatalogProvider) []DiagnosticView {
	variables, candidates := bindingInputsFromRevision(objects)
	if len(candidates) == 0 {
		return nil
	}
	catalog, err := pointCatalogSnapshot(ctx, provider)
	if err != nil {
		return []DiagnosticView{bindingCatalogUnavailableDiagnostic()}
	}
	diagnostics := make([]DiagnosticView, 0)
	seen := make(map[string]struct{})
	for _, candidate := range candidates {
		result := ValidateBindingCandidate(candidate, variables, candidates, catalog)
		for _, issue := range result.Issues {
			key := issue.DetailCode + "\x00" + issue.BindingID + "\x00" + issue.PointID
			if issue.DetailCode == "PGM-MAP-OWNER-001" {
				owners := []string{issue.OwnerProgramID, issue.ConflictProgramID}
				sort.Strings(owners)
				key = issue.DetailCode + "\x00" + bindingPointKey(candidate.Point) + "\x00" + strings.Join(owners, "\x00")
			}
			if _, duplicate := seen[key]; duplicate {
				continue
			}
			seen[key] = struct{}{}
			diagnostics = append(diagnostics, bindingDiagnostic(issue))
		}
	}
	return diagnostics
}
