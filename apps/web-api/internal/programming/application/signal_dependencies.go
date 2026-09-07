package application

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"

	programmingstore "mkddc-web/internal/programming/store"
)

const signalDependencySchemaVersion = "1.0"

type SignalDependencyLocation struct {
	Line   int `json:"line"`
	Column int `json:"column"`
	Length int `json:"length"`
}

type SignalDependencyReference struct {
	ProgramID string                    `json:"programId"`
	ObjectID  string                    `json:"objectId"`
	Name      string                    `json:"name"`
	Language  string                    `json:"language"`
	Location  *SignalDependencyLocation `json:"location"`
}

type SignalDependency struct {
	SignalID           string                      `json:"signalId"`
	Name               string                      `json:"name"`
	Type               string                      `json:"type"`
	Unit               *string                     `json:"unit"`
	PublisherProgramID string                      `json:"publisherProgramId"`
	FreshnessMs        int64                       `json:"freshnessMs"`
	StalePolicy        string                      `json:"stalePolicy"`
	FallbackValue      *float64                    `json:"fallbackValue"`
	Publisher          SignalDependencyReference   `json:"publisher"`
	Consumers          []SignalDependencyReference `json:"consumers"`
}

type SignalDependenciesView struct {
	SchemaVersion      string             `json:"schemaVersion"`
	Status             string             `json:"status"`
	ReasonCode         string             `json:"reasonCode"`
	ProjectID          string             `json:"projectId"`
	DraftRevisionID    string             `json:"draftRevisionId"`
	DraftSHA256        string             `json:"draftSha256"`
	BaseRevisionID     *string            `json:"baseRevisionId"`
	CheckedDraftSHA256 *string            `json:"checkedDraftSha256"`
	CheckID            *string            `json:"checkId"`
	CheckRevisionID    *string            `json:"checkRevisionId"`
	CheckInputSHA256   *string            `json:"checkInputSha256"`
	Dependencies       []SignalDependency `json:"dependencies"`
}

// GetSignalDependencies chỉ công bố consumer/publisher mà compiler đã ghi vào
// Check PASSED. Mọi thiếu hụt hợp đồng cũ hoặc Draft đổi sau Check đều hạ trạng
// thái tường minh; mảng rỗng chỉ có nghĩa "đã kiểm và không có signal" khi
// Status=AUTHORITATIVE.
func (s *ProjectService) GetSignalDependencies(ctx context.Context, projectID string) (SignalDependenciesView, error) {
	if !isUUID(projectID) {
		return SignalDependenciesView{}, ErrInvalidRequest
	}
	snapshot, err := s.store.GetProject(ctx, projectID)
	if err != nil {
		return SignalDependenciesView{}, err
	}
	view := SignalDependenciesView{
		SchemaVersion: signalDependencySchemaVersion, Status: "PENDING_CHECK", ReasonCode: "NO_SEALED_REVISION",
		ProjectID: projectID, DraftRevisionID: snapshot.Draft.DraftID,
		DraftSHA256: hex.EncodeToString(snapshot.Draft.ContentSHA256[:]), Dependencies: nil,
	}
	if snapshot.Draft.BaseRevisionID == "" {
		return view, nil
	}
	base := snapshot.Draft.BaseRevisionID
	view.BaseRevisionID = &base
	revision, err := s.store.GetRevisionHeader(ctx, base)
	if err != nil {
		return SignalDependenciesView{}, err
	}
	if revision.ProjectID != projectID {
		return SignalDependenciesView{}, programmingstore.ErrNotFound
	}
	sealed, sealedOK := sealedDraftContentSHA256(revision.ManifestJSON)
	if sealedOK {
		value := hex.EncodeToString(sealed[:])
		view.CheckedDraftSHA256 = &value
	}
	check, err := s.store.GetLatestCheckForRevision(ctx, base)
	if errors.Is(err, programmingstore.ErrNotFound) {
		view.ReasonCode = "NO_CHECK"
		return view, nil
	}
	if err != nil {
		return SignalDependenciesView{}, err
	}
	checkID, checkRevisionID := check.CheckID, check.RevisionID
	view.CheckID = &checkID
	view.CheckRevisionID = &checkRevisionID
	inputHash := hex.EncodeToString(check.InputSHA256[:])
	view.CheckInputSHA256 = &inputHash
	switch check.State {
	case "QUEUED", "RUNNING":
		view.ReasonCode = "CHECK_IN_PROGRESS"
		return view, nil
	case "FAILED":
		view.Status, view.ReasonCode = "UNAVAILABLE", "CHECK_FAILED"
		return view, nil
	case "TIMED_OUT":
		view.Status, view.ReasonCode = "UNAVAILABLE", "CHECK_TIMED_OUT"
		return view, nil
	case "PASSED":
	default:
		view.Status, view.ReasonCode = "UNAVAILABLE", "CHECK_RESULT_UNAVAILABLE"
		return view, nil
	}
	var result checkResultDocument
	if len(check.ResultJSON) == 0 || decodeStrict(check.ResultJSON, &result) != nil || result.SchemaVersion != "1.0" || len(result.Manifest) == 0 {
		view.Status, view.ReasonCode = "UNAVAILABLE", "CHECK_RESULT_UNAVAILABLE"
		return view, nil
	}
	if err := validatePackageCheckManifest(result.Manifest); err != nil {
		view.Status, view.ReasonCode = "UNAVAILABLE", "DEPENDENCY_CONTRACT_UNAVAILABLE"
		return view, nil
	}
	var manifest packageCheckManifest
	if err := json.Unmarshal(result.Manifest, &manifest); err != nil {
		view.Status, view.ReasonCode = "UNAVAILABLE", "DEPENDENCY_CONTRACT_UNAVAILABLE"
		return view, nil
	}
	view.Dependencies = make([]SignalDependency, 0, len(manifest.Signals))
	for _, signal := range manifest.Signals {
		view.Dependencies = append(view.Dependencies, publicSignalDependency(signal))
	}
	if !sealedOK {
		view.Status, view.ReasonCode, view.Dependencies = "UNAVAILABLE", "DEPENDENCY_CONTRACT_UNAVAILABLE", nil
		return view, nil
	}
	if sealed != snapshot.Draft.ContentSHA256 {
		view.Status, view.ReasonCode = "STALE", "DRAFT_CHANGED"
		return view, nil
	}
	view.Status, view.ReasonCode = "AUTHORITATIVE", "VERIFIED"
	return view, nil
}

func publicSignalDependency(signal packageManifestSignal) SignalDependency {
	consumers := make([]SignalDependencyReference, 0, len(signal.Consumers))
	for _, item := range signal.Consumers {
		consumers = append(consumers, publicSignalReference(item))
	}
	return SignalDependency{SignalID: signal.SignalID, Name: signal.Name, Type: signal.Type, Unit: signal.Unit,
		PublisherProgramID: signal.PublisherProgramID, FreshnessMs: signal.FreshnessMs,
		StalePolicy: signal.StalePolicy, FallbackValue: signal.FallbackValue,
		Publisher: publicSignalReference(signal.Publisher), Consumers: consumers}
}

func publicSignalReference(item packageSignalReference) SignalDependencyReference {
	var location *SignalDependencyLocation
	if item.Location != nil {
		location = &SignalDependencyLocation{Line: item.Location.Line, Column: item.Location.Column, Length: item.Location.Length}
	}
	return SignalDependencyReference{ProgramID: item.ProgramID, ObjectID: item.ObjectID,
		Name: item.Name, Language: item.Language, Location: location}
}
