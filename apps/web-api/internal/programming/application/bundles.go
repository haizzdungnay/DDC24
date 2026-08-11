package application

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	programmingstore "mkddc-web/internal/programming/store"
)

const (
	bundleSchemaVersion = "1.0"
	bundleType          = "MKDDC_PROGRAMMING_SOURCE_ONLY"
	maxBundleBytes      = 4 * 1024 * 1024
	maxBundleFiles      = 1024
	maxBundleFileBytes  = 256 * 1024
	maxBundleRevisions  = 100
	fixedBundleUnixTime = int64(315532800)
)

var (
	ErrInvalidBundle  = errors.New("Programming source bundle không hợp lệ")
	ErrBundleTooLarge = errors.New("Programming source bundle vượt giới hạn")
)

type BundleExportCommand struct {
	SchemaVersion  string
	RevisionIDs    []string
	IdempotencyKey string
	CorrelationID  string
}

type BundleExportResult struct {
	SchemaVersion      string
	BundleSHA256       string
	ByteSize           int64
	RevisionIDs        []string
	SelectedRevisionID string
	Bundle             []byte
	AuditID            string
	Replay             bool
}

type BundleImportCommand struct {
	SchemaVersion  string
	Name           string
	Description    string
	Bundle         []byte
	ExpectedSHA256 string
	IdempotencyKey string
	CorrelationID  string
}

type bundleFileDescriptor struct {
	Path       string `json:"path"`
	SHA256     string `json:"sha256"`
	ByteSize   int    `json:"byteSize"`
	Kind       string `json:"kind"`
	RevisionID string `json:"revisionId"`
	ObjectID   string `json:"objectId,omitempty"`
}

type sourceProjectDescriptor struct {
	ProjectID   string `json:"projectId"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type bundleManifest struct {
	SchemaVersion      string                  `json:"schemaVersion"`
	BundleType         string                  `json:"bundleType"`
	TargetProfile      string                  `json:"targetProfile"`
	SourceProject      sourceProjectDescriptor `json:"sourceProject"`
	RevisionIDs        []string                `json:"revisionIds"`
	SelectedRevisionID string                  `json:"selectedRevisionId"`
	Files              []bundleFileDescriptor  `json:"files"`
}

type bundleEntry struct {
	name string
	data []byte
}

type revisionManifestDocument struct {
	SchemaVersion      int    `json:"schemaVersion"`
	TargetProfile      string `json:"targetProfile"`
	ProjectID          string `json:"projectId"`
	Label              string `json:"label"`
	Comment            string `json:"comment"`
	DraftContentSHA256 string `json:"draftContentSha256"`
	Objects            []struct {
		ObjectID string `json:"objectId"`
		Kind     string `json:"kind"`
		SHA256   string `json:"sha256"`
	} `json:"objects"`
}

func (s *ProjectService) ExportBundle(ctx context.Context, actor Actor, command BundleExportCommand) (BundleExportResult, error) {
	if command.SchemaVersion != bundleSchemaVersion || len(command.RevisionIDs) < 1 || len(command.RevisionIDs) > maxBundleRevisions {
		return BundleExportResult{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return BundleExportResult{}, err
	}
	seen := make(map[string]struct{}, len(command.RevisionIDs))
	snapshots := make([]programmingstore.RevisionSnapshot, 0, len(command.RevisionIDs))
	for _, revisionID := range command.RevisionIDs {
		if !isUUID(revisionID) {
			return BundleExportResult{}, ErrInvalidRequest
		}
		if _, duplicate := seen[revisionID]; duplicate {
			return BundleExportResult{}, ErrInvalidRequest
		}
		seen[revisionID] = struct{}{}
		snapshot, err := s.store.GetRevision(ctx, revisionID)
		if err != nil {
			return BundleExportResult{}, err
		}
		snapshots = append(snapshots, snapshot)
	}
	sort.Slice(snapshots, func(left, right int) bool {
		if snapshots[left].Revision.Sequence != snapshots[right].Revision.Sequence {
			return snapshots[left].Revision.Sequence < snapshots[right].Revision.Sequence
		}
		return snapshots[left].Revision.RevisionID < snapshots[right].Revision.RevisionID
	})
	projectID := snapshots[0].Revision.ProjectID
	for _, snapshot := range snapshots[1:] {
		if snapshot.Revision.ProjectID != projectID {
			return BundleExportResult{}, ErrInvalidRequest
		}
	}
	project, err := s.store.GetProject(ctx, projectID)
	if err != nil {
		return BundleExportResult{}, err
	}
	bundle, manifest, err := buildSourceBundle(project.Project, snapshots)
	if err != nil {
		return BundleExportResult{}, err
	}
	digest := sha256.Sum256(bundle)
	digestText := hex.EncodeToString(digest[:])
	requestHash, err := semanticHash(map[string]any{"schemaVersion": command.SchemaVersion, "revisionIds": manifest.RevisionIDs})
	if err != nil {
		return BundleExportResult{}, err
	}
	auditID := s.newID()
	receipt, err := s.store.RecordBundleExport(ctx, programmingstore.RecordBundleExportParams{
		BundleSHA256: digestText, RevisionIDs: manifest.RevisionIDs, ByteSize: int64(len(bundle)), ActorID: actor.ID,
		Role: actor.Role, AuditID: auditID, CorrelationID: command.CorrelationID, At: s.now(),
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	})
	if err != nil {
		return BundleExportResult{}, err
	}
	return BundleExportResult{SchemaVersion: bundleSchemaVersion, BundleSHA256: digestText, ByteSize: int64(len(bundle)),
		RevisionIDs: manifest.RevisionIDs, SelectedRevisionID: manifest.SelectedRevisionID, Bundle: bundle,
		AuditID: receipt.AuditID, Replay: receipt.AuditID != auditID}, nil
}

func buildSourceBundle(project programmingstore.Project, snapshots []programmingstore.RevisionSnapshot) ([]byte, bundleManifest, error) {
	manifest := bundleManifest{SchemaVersion: bundleSchemaVersion, BundleType: bundleType, TargetProfile: targetProfile,
		SourceProject: sourceProjectDescriptor{ProjectID: project.ProjectID, Name: project.Name, Description: project.Description},
		RevisionIDs:   make([]string, 0, len(snapshots)), Files: make([]bundleFileDescriptor, 0)}
	entries := make([]bundleEntry, 0)
	for _, snapshot := range snapshots {
		revisionID := snapshot.Revision.RevisionID
		manifest.RevisionIDs = append(manifest.RevisionIDs, revisionID)
		manifest.SelectedRevisionID = revisionID
		manifestPath := "revisions/" + revisionID + "/manifest.json"
		entries = append(entries, bundleEntry{name: manifestPath, data: snapshot.Revision.ManifestJSON})
		manifest.Files = append(manifest.Files, describeBundleFile(manifestPath, snapshot.Revision.ManifestJSON, "REVISION_MANIFEST", revisionID, ""))
		for _, object := range snapshot.Objects {
			objectPath := "revisions/" + revisionID + "/objects/" + strings.ToLower(object.Kind) + "/" + object.ObjectID + ".json"
			entries = append(entries, bundleEntry{name: objectPath, data: object.PayloadJSON})
			manifest.Files = append(manifest.Files, describeBundleFile(objectPath, object.PayloadJSON, object.Kind, revisionID, object.ObjectID))
		}
	}
	if len(entries) > maxBundleFiles {
		return nil, bundleManifest{}, ErrBundleTooLarge
	}
	for _, entry := range entries {
		if len(entry.data) < 2 || len(entry.data) > maxBundleFileBytes {
			return nil, bundleManifest{}, ErrBundleTooLarge
		}
	}
	sort.Slice(manifest.Files, func(left, right int) bool { return manifest.Files[left].Path < manifest.Files[right].Path })
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return nil, bundleManifest{}, err
	}
	if len(manifestJSON) > maxBundleFileBytes {
		return nil, bundleManifest{}, ErrBundleTooLarge
	}
	entries = append(entries, bundleEntry{name: "manifest.json", data: manifestJSON})
	sort.Slice(entries, func(left, right int) bool { return entries[left].name < entries[right].name })
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	fixedTime := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Store, Modified: fixedTime}
		header.SetMode(0o640)
		file, err := writer.CreateHeader(header)
		if err != nil {
			return nil, bundleManifest{}, err
		}
		if _, err := file.Write(entry.data); err != nil {
			return nil, bundleManifest{}, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, bundleManifest{}, err
	}
	if output.Len() > maxBundleBytes {
		return nil, bundleManifest{}, ErrBundleTooLarge
	}
	return output.Bytes(), manifest, nil
}

func describeBundleFile(name string, data []byte, kind, revisionID, objectID string) bundleFileDescriptor {
	digest := sha256.Sum256(data)
	return bundleFileDescriptor{Path: name, SHA256: hex.EncodeToString(digest[:]), ByteSize: len(data), Kind: kind,
		RevisionID: revisionID, ObjectID: objectID}
}

func (s *ProjectService) ImportBundle(ctx context.Context, actor Actor, command BundleImportCommand) (MutationResult, error) {
	if command.SchemaVersion != bundleSchemaVersion || !validText(command.Name, 1, 120) || !validText(command.Description, 0, 1000) {
		return MutationResult{}, ErrInvalidRequest
	}
	if len(command.Bundle) == 0 || len(command.Bundle) > maxBundleBytes {
		return MutationResult{}, ErrBundleTooLarge
	}
	if len(command.ExpectedSHA256) != sha256.Size*2 || strings.ToLower(command.ExpectedSHA256) != command.ExpectedSHA256 {
		return MutationResult{}, ErrInvalidBundle
	}
	expected, err := hex.DecodeString(command.ExpectedSHA256)
	if err != nil {
		return MutationResult{}, ErrInvalidBundle
	}
	actual := sha256.Sum256(command.Bundle)
	if !bytes.Equal(expected, actual[:]) {
		return MutationResult{}, ErrInvalidBundle
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return MutationResult{}, err
	}
	requestHash, err := semanticHash(map[string]any{"schemaVersion": command.SchemaVersion, "name": command.Name,
		"description": command.Description, "bundleSha256": command.ExpectedSHA256})
	if err != nil {
		return MutationResult{}, err
	}
	if replay, found, err := s.store.LookupMutation(ctx, actor.ID, "BUNDLE_IMPORT", "", keyHash, requestHash); err != nil {
		return MutationResult{}, err
	} else if found {
		return MutationResult{Resource: importedBundleResource(replay.ProjectID, replay.DraftID, replay.RevisionID, command.ExpectedSHA256),
			ETag: FormatDraftETag(replay.DraftID, replay.ETag), AuditID: replay.AuditID, Replay: true}, nil
	}
	manifest, content, err := inspectSourceBundle(command.Bundle, s.newID(), norm.NFC.String(command.Name))
	if err != nil {
		return MutationResult{}, err
	}
	projectID, draftID, auditID := extractProjectID(content), s.newID(), s.newID()
	if projectID == "" {
		return MutationResult{}, ErrInvalidBundle
	}
	project, draft, err := s.store.ImportProject(ctx, programmingstore.ImportProjectParams{
		ProjectID: projectID, DraftID: draftID, Name: norm.NFC.String(command.Name), Description: norm.NFC.String(command.Description),
		ContentJSON: content, BundleSHA256: command.ExpectedSHA256, SourceProjectID: manifest.SourceProject.ProjectID,
		SourceRevisionID: manifest.SelectedRevisionID, ActorID: actor.ID, Role: actor.Role, AuditID: auditID,
		CorrelationID: command.CorrelationID, At: s.now(), IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	})
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{Resource: importedBundleResource(project.ProjectID, draft.DraftID, manifest.SelectedRevisionID, command.ExpectedSHA256),
		ETag: FormatDraftETag(draft.DraftID, draft.ETag), AuditID: draft.AuditID, Replay: draft.Replay}, nil
}

func importedBundleResource(projectID, draftID, sourceRevisionID, bundleSHA256 string) map[string]any {
	return map[string]any{"projectId": projectID, "draftRevisionId": draftID,
		"importedFromRevisionId": sourceRevisionID, "bundleSha256": bundleSHA256,
		"state": "DRAFT", "checkCreated": false, "artifactImported": false, "commissionStarted": false}
}

func inspectSourceBundle(raw []byte, newProjectID, newProjectName string) (bundleManifest, []byte, error) {
	if len(raw) == 0 || len(raw) > maxBundleBytes {
		return bundleManifest{}, nil, ErrBundleTooLarge
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return bundleManifest{}, nil, fmt.Errorf("%w: zip header", ErrInvalidBundle)
	}
	if len(reader.File) < 2 || len(reader.File) > maxBundleFiles+1 {
		return bundleManifest{}, nil, fmt.Errorf("%w: số file", ErrInvalidBundle)
	}
	files := make(map[string][]byte, len(reader.File))
	total := 0
	for _, file := range reader.File {
		if !safeBundlePath(file.Name) || !safeBundleZIPMetadata(file) || file.Method != zip.Store ||
			file.FileInfo().IsDir() || file.UncompressedSize64 > maxBundleFileBytes {
			return bundleManifest{}, nil, fmt.Errorf("%w: file ZIP %q", ErrInvalidBundle, file.Name)
		}
		if _, duplicate := files[file.Name]; duplicate {
			return bundleManifest{}, nil, fmt.Errorf("%w: trùng path %q", ErrInvalidBundle, file.Name)
		}
		stream, err := file.Open()
		if err != nil {
			return bundleManifest{}, nil, fmt.Errorf("%w: mở file %q", ErrInvalidBundle, file.Name)
		}
		content, readErr := io.ReadAll(io.LimitReader(stream, maxBundleFileBytes+1))
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil || len(content) > maxBundleFileBytes || uint64(len(content)) != file.UncompressedSize64 {
			return bundleManifest{}, nil, fmt.Errorf("%w: đọc file %q", ErrInvalidBundle, file.Name)
		}
		total += len(content)
		if total > maxBundleBytes {
			return bundleManifest{}, nil, ErrBundleTooLarge
		}
		files[file.Name] = content
	}
	manifestRaw, ok := files["manifest.json"]
	if !ok {
		return bundleManifest{}, nil, fmt.Errorf("%w: thiếu manifest", ErrInvalidBundle)
	}
	var manifest bundleManifest
	if err := decodeBundleJSON(manifestRaw, &manifest); err != nil || !validBundleManifest(manifest) {
		return bundleManifest{}, nil, fmt.Errorf("%w: manifest root", ErrInvalidBundle)
	}
	if len(manifest.Files)+1 != len(files) {
		return bundleManifest{}, nil, fmt.Errorf("%w: file set", ErrInvalidBundle)
	}
	descriptors := make(map[string]bundleFileDescriptor, len(manifest.Files))
	revisionSet := make(map[string]struct{}, len(manifest.RevisionIDs))
	for _, revisionID := range manifest.RevisionIDs {
		revisionSet[revisionID] = struct{}{}
	}
	for index, descriptor := range manifest.Files {
		if index > 0 && manifest.Files[index-1].Path >= descriptor.Path {
			return bundleManifest{}, nil, fmt.Errorf("%w: thứ tự descriptor", ErrInvalidBundle)
		}
		content, exists := files[descriptor.Path]
		_, revisionExists := revisionSet[descriptor.RevisionID]
		if !exists || !revisionExists || !validBundleDescriptor(descriptor) || descriptor.ByteSize != len(content) {
			return bundleManifest{}, nil, fmt.Errorf("%w: descriptor %q", ErrInvalidBundle, descriptor.Path)
		}
		digest := sha256.Sum256(content)
		if descriptor.SHA256 != hex.EncodeToString(digest[:]) {
			return bundleManifest{}, nil, fmt.Errorf("%w: hash %q", ErrInvalidBundle, descriptor.Path)
		}
		descriptors[descriptor.Path] = descriptor
	}
	if err := validateRevisionManifests(manifest, files, descriptors); err != nil {
		return bundleManifest{}, nil, fmt.Errorf("%w: revision manifest", err)
	}
	content, err := selectedRevisionDraft(manifest, files, newProjectID, newProjectName)
	if err != nil {
		return bundleManifest{}, nil, fmt.Errorf("%w: selected Draft", err)
	}
	return manifest, content, nil
}

func validBundleManifest(manifest bundleManifest) bool {
	if manifest.SchemaVersion != bundleSchemaVersion || manifest.BundleType != bundleType || manifest.TargetProfile != targetProfile ||
		!isUUID(manifest.SourceProject.ProjectID) || !validText(manifest.SourceProject.Name, 1, 128) ||
		!validText(manifest.SourceProject.Description, 0, 2048) || len(manifest.RevisionIDs) < 1 || len(manifest.RevisionIDs) > maxBundleRevisions ||
		len(manifest.Files) < 2 || len(manifest.Files) > maxBundleFiles {
		return false
	}
	seen := make(map[string]struct{}, len(manifest.RevisionIDs))
	selected := false
	for _, revisionID := range manifest.RevisionIDs {
		if !isUUID(revisionID) {
			return false
		}
		if _, duplicate := seen[revisionID]; duplicate {
			return false
		}
		seen[revisionID] = struct{}{}
		selected = selected || revisionID == manifest.SelectedRevisionID
	}
	return selected
}

func validBundleDescriptor(descriptor bundleFileDescriptor) bool {
	if !isUUID(descriptor.RevisionID) || len(descriptor.SHA256) != sha256.Size*2 || descriptor.ByteSize < 2 || descriptor.ByteSize > maxBundleFileBytes {
		return false
	}
	if _, err := hex.DecodeString(descriptor.SHA256); err != nil || strings.ToLower(descriptor.SHA256) != descriptor.SHA256 {
		return false
	}
	if descriptor.Kind == "REVISION_MANIFEST" {
		return descriptor.ObjectID == "" && descriptor.Path == "revisions/"+descriptor.RevisionID+"/manifest.json"
	}
	if !validBundleObjectKind(descriptor.Kind) || !isUUID(descriptor.ObjectID) {
		return false
	}
	expected := "revisions/" + descriptor.RevisionID + "/objects/" + strings.ToLower(descriptor.Kind) + "/" + descriptor.ObjectID + ".json"
	return descriptor.Path == expected
}

func validBundleObjectKind(kind string) bool {
	switch kind {
	case "METADATA", "PROGRAM", "FUNCTION", "FUNCTION_BLOCK", "VARIABLE", "BINDING", "TASK":
		return true
	default:
		return false
	}
}

func validateRevisionManifests(manifest bundleManifest, files map[string][]byte, descriptors map[string]bundleFileDescriptor) error {
	for _, revisionID := range manifest.RevisionIDs {
		manifestPath := "revisions/" + revisionID + "/manifest.json"
		descriptor, exists := descriptors[manifestPath]
		if !exists || descriptor.Kind != "REVISION_MANIFEST" {
			return ErrInvalidBundle
		}
		var revision revisionManifestDocument
		if err := decodeBundleJSON(files[manifestPath], &revision); err != nil || revision.SchemaVersion != 1 ||
			revision.TargetProfile != targetProfile || revision.ProjectID != manifest.SourceProject.ProjectID || len(revision.Objects) < 2 {
			return ErrInvalidBundle
		}
		seen := make(map[string]struct{}, len(revision.Objects))
		for _, object := range revision.Objects {
			key := object.Kind + "\x00" + object.ObjectID
			if !isUUID(object.ObjectID) || !validBundleObjectKind(object.Kind) || len(object.SHA256) != sha256.Size*2 {
				return ErrInvalidBundle
			}
			if _, duplicate := seen[key]; duplicate {
				return ErrInvalidBundle
			}
			seen[key] = struct{}{}
			objectPath := "revisions/" + revisionID + "/objects/" + strings.ToLower(object.Kind) + "/" + object.ObjectID + ".json"
			objectDescriptor, exists := descriptors[objectPath]
			if !exists || objectDescriptor.SHA256 != object.SHA256 {
				return ErrInvalidBundle
			}
		}
		descriptorCount := 0
		for _, descriptor := range descriptors {
			if descriptor.RevisionID == revisionID {
				descriptorCount++
			}
		}
		if descriptorCount != len(revision.Objects)+1 {
			return ErrInvalidBundle
		}
	}
	return nil
}

func selectedRevisionDraft(manifest bundleManifest, files map[string][]byte, newProjectID, newProjectName string) ([]byte, error) {
	prefix := "revisions/" + manifest.SelectedRevisionID + "/objects/"
	programs, variables, bindings := make([]any, 0), make([]any, 0), make([]any, 0)
	var projectValue, libraryValue, taskValue any
	metadataCount, taskCount := 0, 0
	for _, descriptor := range manifest.Files {
		name := descriptor.Path
		if descriptor.RevisionID != manifest.SelectedRevisionID || !strings.HasPrefix(name, prefix) {
			continue
		}
		raw := files[name]
		var value any
		if err := decodeBundleJSON(raw, &value); err != nil {
			return nil, fmt.Errorf("%w: JSON object %q", ErrInvalidBundle, name)
		}
		relative := strings.TrimPrefix(name, prefix)
		kind := strings.SplitN(relative, "/", 2)[0]
		switch kind {
		case "metadata":
			metadata, ok := value.(map[string]any)
			if !ok || len(metadata) != 2 {
				return nil, fmt.Errorf("%w: metadata shape", ErrInvalidBundle)
			}
			projectValue, libraryValue = metadata["project"], metadata["library"]
			metadataCount++
		case "program", "function", "function_block":
			programs = append(programs, value)
		case "variable":
			variables = append(variables, value)
		case "binding":
			bindings = append(bindings, value)
		case "task":
			taskValue = value
			taskCount++
		default:
			return nil, fmt.Errorf("%w: object kind %q", ErrInvalidBundle, kind)
		}
	}
	if metadataCount != 1 || taskCount != 1 {
		return nil, fmt.Errorf("%w: metadata=%d task=%d", ErrInvalidBundle, metadataCount, taskCount)
	}
	projectMap, ok := projectValue.(map[string]any)
	if !ok || projectMap["projectId"] != manifest.SourceProject.ProjectID {
		return nil, fmt.Errorf("%w: source project metadata", ErrInvalidBundle)
	}
	projectMap["projectId"] = newProjectID
	projectMap["name"] = newProjectName
	document := map[string]any{"schemaVersion": float64(1), "project": projectMap, "programs": programs,
		"variables": variables, "bindings": bindings, "task": taskValue, "library": libraryValue}
	if err := validateDraftDocument(document); err != nil {
		return nil, fmt.Errorf("%w: Draft contract: %v", ErrInvalidBundle, err)
	}
	content, err := json.Marshal(document)
	if err != nil {
		return nil, ErrInvalidBundle
	}
	return content, nil
}

func extractProjectID(content []byte) string {
	var document struct {
		Project struct {
			ProjectID string `json:"projectId"`
		} `json:"project"`
	}
	if json.Unmarshal(content, &document) != nil {
		return ""
	}
	return document.Project.ProjectID
}

func safeBundlePath(name string) bool {
	if name == "" || len(name) > 240 || !utf8.ValidString(name) || norm.NFC.String(name) != name ||
		strings.Contains(name, "\\") || strings.HasPrefix(name, "/") || path.Clean(name) != name {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.IndexFunc(part, func(candidate rune) bool { return candidate < 0x20 || candidate == 0x7f }) >= 0 {
			return false
		}
	}
	return true
}

// safeBundleZIPMetadata chỉ nhận metadata mà exporter deterministic của MK-DDC
// tạo ra. Ngoài việc chặn encryption/symlink, kiểm tra này còn chặn executable,
// comment và extra field dùng để smuggle hardlink/metadata ngoài manifest.
func safeBundleZIPMetadata(file *zip.File) bool {
	if file == nil || file.Comment != "" || file.NonUTF8 || file.Flags&^uint16(0x0808) != 0 {
		return false
	}
	mode := file.Mode()
	if mode != 0 && (!mode.IsRegular() || mode.Perm()&0o111 != 0) {
		return false
	}
	if !file.Modified.IsZero() && file.Modified.UTC().Unix() != fixedBundleUnixTime {
		return false
	}
	if len(file.Extra) == 0 {
		return true
	}
	// Go archive/zip sinh đúng một extended timestamp field 0x5455, length 5,
	// flags=mtime cho mốc 1980-01-01. Mọi extra field khác đều fail-closed.
	return len(file.Extra) == 9 && binary.LittleEndian.Uint16(file.Extra[0:2]) == 0x5455 &&
		binary.LittleEndian.Uint16(file.Extra[2:4]) == 5 && file.Extra[4] == 1 &&
		int64(binary.LittleEndian.Uint32(file.Extra[5:9])) == fixedBundleUnixTime
}

func decodeBundleJSON(raw []byte, destination any) error {
	if len(raw) < 2 || len(raw) > maxBundleFileBytes || !utf8.Valid(raw) || norm.NFC.String(string(raw)) != string(raw) {
		return ErrInvalidBundle
	}
	if err := rejectDuplicateKeys(raw); err != nil {
		return ErrInvalidBundle
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return ErrInvalidBundle
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return ErrInvalidBundle
	}
	return nil
}

func rejectDuplicateKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := walkBundleJSON(decoder); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return ErrInvalidBundle
	}
	return nil
}

func walkBundleJSON(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, compound := token.(json.Delim)
	if !compound {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return ErrInvalidBundle
			}
			if _, duplicate := seen[key]; duplicate {
				return ErrInvalidBundle
			}
			seen[key] = struct{}{}
			if err := walkBundleJSON(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	case '[':
		for decoder.More() {
			if err := walkBundleJSON(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	default:
		return ErrInvalidBundle
	}
}
