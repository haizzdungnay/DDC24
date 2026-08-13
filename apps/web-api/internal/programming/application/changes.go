package application

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"sort"

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
	retainItems := make([]string, 0)
	outputItems := make([]string, 0)
	for _, change := range changes {
		if change.Category == "RETAIN" {
			retainItems = append(retainItems, change.ObjectID)
		}
		if change.Category == "OUTPUT_MAPPING" {
			outputItems = append(outputItems, change.ObjectID)
		}
	}
	impact := RevisionImpact{
		Retain:               impactFromItems(retainItems),
		OutputMappingChanges: impactFromItems(outputItems),
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
	default:
		return "SOURCE"
	}
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
