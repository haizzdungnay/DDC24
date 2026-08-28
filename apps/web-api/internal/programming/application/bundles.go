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

	"mkddc-web/internal/programming/domain"
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
	// ErrBundleLibraryVersion tách riêng khỏi ErrInvalidBundle vì cách sửa khác
	// hẳn: bundle không hỏng, nó chỉ được xuất trên một registry SYSTEM khác.
	// Người vận hành cần biết là phải xuất lại, không phải đi tìm file hỏng.
	ErrBundleLibraryVersion = errors.New("Programming bundle lệch version Control Library SYSTEM")
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
	SchemaVersion string                  `json:"schemaVersion"`
	BundleType    string                  `json:"bundleType"`
	TargetProfile string                  `json:"targetProfile"`
	SourceProject sourceProjectDescriptor `json:"sourceProject"`
	// SystemLibraryVersion là version registry SYSTEM mà bundle được xuất trên
	// đó. Nó KHÔNG phải metadata trang trí: entry SYSTEM có thể đổi semantics
	// giữa hai version, nên nhập một bundle xuất trên registry khác là chạy
	// nguồn cũ trên ngữ nghĩa mới — sai lệch không báo lỗi.
	SystemLibraryVersion string                   `json:"systemLibraryVersion"`
	Library              *bundleLibraryDescriptor `json:"library,omitempty"`
	RevisionIDs          []string                 `json:"revisionIds"`
	SelectedRevisionID   string                   `json:"selectedRevisionId"`
	Files                []bundleFileDescriptor   `json:"files"`
}

type bundleLibraryDescriptor struct {
	LibraryRevisionID string `json:"libraryRevisionId"`
	Version           string `json:"version"`
	EntryCount        int    `json:"entryCount"`
}

// bundleLibraryEntryDocument là dạng NGUỒN của một entry: source, interface và
// dependency. Nó cố ý KHÔNG mang `contentSha256` của bên gửi — hash được tính
// lại từ nội dung canonical ở phía nhận, nên một bundle khai hash sai không thể
// hợp thức hoá nội dung của chính nó. Cũng không mang artifact, IR hay cache.
type bundleLibraryEntryDocument struct {
	SchemaVersion int                       `json:"schemaVersion"`
	EntryID       string                    `json:"entryId"`
	Kind          string                    `json:"kind"`
	Name          string                    `json:"name"`
	Language      string                    `json:"language"`
	FeatureState  string                    `json:"featureState"`
	Source        string                    `json:"source"`
	Interface     json.RawMessage           `json:"interface"`
	Dependencies  []bundleLibraryDependency `json:"dependencies"`
	StateLayout   *bundleLibraryStateLayout `json:"stateLayout,omitempty"`
}

type bundleLibraryDependency struct {
	EntryID string `json:"entryId"`
	Version string `json:"version"`
}

type bundleLibraryStateLayout struct {
	Version        uint32 `json:"version"`
	StateSizeBytes uint32 `json:"stateSizeBytes"`
	SHA256         string `json:"sha256"`
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
	library, libraryEntries, err := s.exportLibrarySnapshot(ctx, snapshots)
	if err != nil {
		return BundleExportResult{}, err
	}
	bundle, manifest, err := buildSourceBundle(project.Project, snapshots, library, libraryEntries)
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

// exportLibrarySnapshot lấy PROJECT Library mà Revision ĐƯỢC CHỌN đang pin.
// Không gom library của mọi Revision trong bundle: một bundle nhiều Revision có
// thể pin nhiều version library, và trộn chúng lại sẽ tạo một tập entry chưa
// từng tồn tại ở bất kỳ Revision nào.
func (s *ProjectService) exportLibrarySnapshot(ctx context.Context, snapshots []programmingstore.RevisionSnapshot) (
	*bundleLibraryDescriptor, []programmingstore.LibraryEntry, error) {
	selected := snapshots[len(snapshots)-1].Revision
	if selected.LibraryRevisionID == "" {
		return nil, nil, nil
	}
	revision, err := s.store.GetLibraryRevision(ctx, selected.LibraryRevisionID)
	if err != nil {
		return nil, nil, err
	}
	entries, err := s.store.ListLibraryEntries(ctx, selected.LibraryRevisionID)
	if err != nil {
		return nil, nil, err
	}
	if len(entries) == 0 {
		return nil, nil, ErrInvalidBundle
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].EntryID < entries[right].EntryID })
	return &bundleLibraryDescriptor{LibraryRevisionID: revision.LibraryRevisionID,
		Version: revision.Version, EntryCount: len(entries)}, entries, nil
}

func buildSourceBundle(project programmingstore.Project, snapshots []programmingstore.RevisionSnapshot,
	library *bundleLibraryDescriptor, libraryEntries []programmingstore.LibraryEntry) ([]byte, bundleManifest, error) {
	manifest := bundleManifest{SchemaVersion: bundleSchemaVersion, BundleType: bundleType, TargetProfile: targetProfile,
		SourceProject:        sourceProjectDescriptor{ProjectID: project.ProjectID, Name: project.Name, Description: project.Description},
		SystemLibraryVersion: domain.SystemLibraryVersion, Library: library,
		RevisionIDs: make([]string, 0, len(snapshots)), Files: make([]bundleFileDescriptor, 0)}
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
	if library != nil {
		for _, entry := range libraryEntries {
			document, err := libraryEntryDocument(entry)
			if err != nil {
				return nil, bundleManifest{}, err
			}
			path := "library/entries/" + entry.EntryID + ".json"
			entries = append(entries, bundleEntry{name: path, data: document})
			manifest.Files = append(manifest.Files,
				describeBundleFile(path, document, "LIBRARY_ENTRY", manifest.SelectedRevisionID, entry.EntryID))
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
	manifest, content, bundleFiles, err := inspectSourceBundle(command.Bundle, s.newID(), norm.NFC.String(command.Name))
	if err != nil {
		return MutationResult{}, err
	}
	projectID, draftID, auditID := extractProjectID(content), s.newID(), s.newID()
	if projectID == "" {
		return MutationResult{}, ErrInvalidBundle
	}
	libraryEntries, err := libraryImportsFromBundle(manifest, bundleFiles)
	if err != nil {
		return MutationResult{}, err
	}
	libraryRevisionID, libraryVersion := "", ""
	if manifest.Library != nil {
		// Library nhập vào nhận identity MỚI. Giữ nguyên `libraryRevisionId` của
		// bên gửi sẽ làm hai controller khác nhau có hai nội dung khác nhau dưới
		// cùng một identity — và mọi pin sau đó trỏ mập mờ.
		libraryRevisionID, libraryVersion = s.newID(), manifest.Library.Version
	}
	project, draft, err := s.store.ImportProject(ctx, programmingstore.ImportProjectParams{
		LibraryRevisionID: libraryRevisionID, LibraryVersion: libraryVersion, LibraryEntries: libraryEntries,
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

func inspectSourceBundle(raw []byte, newProjectID, newProjectName string) (bundleManifest, []byte, map[string][]byte, error) {
	if len(raw) == 0 || len(raw) > maxBundleBytes {
		return bundleManifest{}, nil, nil, ErrBundleTooLarge
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: zip header", ErrInvalidBundle)
	}
	if len(reader.File) < 2 || len(reader.File) > maxBundleFiles+1 {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: số file", ErrInvalidBundle)
	}
	files := make(map[string][]byte, len(reader.File))
	total := 0
	for _, file := range reader.File {
		if !safeBundlePath(file.Name) || !safeBundleZIPMetadata(file) || file.Method != zip.Store ||
			file.FileInfo().IsDir() || file.UncompressedSize64 > maxBundleFileBytes {
			return bundleManifest{}, nil, nil, fmt.Errorf("%w: file ZIP %q", ErrInvalidBundle, file.Name)
		}
		if _, duplicate := files[file.Name]; duplicate {
			return bundleManifest{}, nil, nil, fmt.Errorf("%w: trùng path %q", ErrInvalidBundle, file.Name)
		}
		stream, err := file.Open()
		if err != nil {
			return bundleManifest{}, nil, nil, fmt.Errorf("%w: mở file %q", ErrInvalidBundle, file.Name)
		}
		content, readErr := io.ReadAll(io.LimitReader(stream, maxBundleFileBytes+1))
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil || len(content) > maxBundleFileBytes || uint64(len(content)) != file.UncompressedSize64 {
			return bundleManifest{}, nil, nil, fmt.Errorf("%w: đọc file %q", ErrInvalidBundle, file.Name)
		}
		total += len(content)
		if total > maxBundleBytes {
			return bundleManifest{}, nil, nil, ErrBundleTooLarge
		}
		files[file.Name] = content
	}
	manifestRaw, ok := files["manifest.json"]
	if !ok {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: thiếu manifest", ErrInvalidBundle)
	}
	var manifest bundleManifest
	if err := decodeBundleJSON(manifestRaw, &manifest); err != nil || !validBundleManifest(manifest) {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: manifest root", ErrInvalidBundle)
	}
	if len(manifest.Files)+1 != len(files) {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: file set", ErrInvalidBundle)
	}
	descriptors := make(map[string]bundleFileDescriptor, len(manifest.Files))
	revisionSet := make(map[string]struct{}, len(manifest.RevisionIDs))
	for _, revisionID := range manifest.RevisionIDs {
		revisionSet[revisionID] = struct{}{}
	}
	for index, descriptor := range manifest.Files {
		if index > 0 && manifest.Files[index-1].Path >= descriptor.Path {
			return bundleManifest{}, nil, nil, fmt.Errorf("%w: thứ tự descriptor", ErrInvalidBundle)
		}
		content, exists := files[descriptor.Path]
		_, revisionExists := revisionSet[descriptor.RevisionID]
		if !exists || !revisionExists || !validBundleDescriptor(descriptor) || descriptor.ByteSize != len(content) {
			return bundleManifest{}, nil, nil, fmt.Errorf("%w: descriptor %q", ErrInvalidBundle, descriptor.Path)
		}
		digest := sha256.Sum256(content)
		if descriptor.SHA256 != hex.EncodeToString(digest[:]) {
			return bundleManifest{}, nil, nil, fmt.Errorf("%w: hash %q", ErrInvalidBundle, descriptor.Path)
		}
		descriptors[descriptor.Path] = descriptor
	}
	if err := validateRevisionManifests(manifest, files, descriptors); err != nil {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: revision manifest", err)
	}
	// Version registry SYSTEM phải khớp CHÍNH XÁC. "Gần đúng" nghĩa là chạy
	// nguồn cũ trên ngữ nghĩa mới của entry SYSTEM — sai lệch không báo lỗi.
	if manifest.SystemLibraryVersion != domain.SystemLibraryVersion {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: bundle=%s controller=%s",
			ErrBundleLibraryVersion, manifest.SystemLibraryVersion, domain.SystemLibraryVersion)
	}
	if err := validateBundleLibraryFiles(manifest, descriptors); err != nil {
		return bundleManifest{}, nil, nil, err
	}
	content, err := selectedRevisionDraft(manifest, files, newProjectID, newProjectName)
	if err != nil {
		return bundleManifest{}, nil, nil, fmt.Errorf("%w: selected Draft", err)
	}
	return manifest, content, files, nil
}

// validateBundleLibraryFiles ép hai chiều giữa manifest và file set: có
// `library` thì phải có đúng số file library, và KHÔNG có `library` thì không
// được có file library nào. Bỏ chiều thứ hai nghĩa là một bundle có thể chở
// theo entry mà manifest không khai — đúng lối giấu nội dung.
func validateBundleLibraryFiles(manifest bundleManifest, descriptors map[string]bundleFileDescriptor) error {
	count := 0
	for _, descriptor := range descriptors {
		if descriptor.Kind != "LIBRARY_ENTRY" {
			continue
		}
		count++
		if descriptor.RevisionID != manifest.SelectedRevisionID {
			return fmt.Errorf("%w: library entry không thuộc Revision được chọn", ErrInvalidBundle)
		}
	}
	if manifest.Library == nil {
		if count != 0 {
			return fmt.Errorf("%w: có file library nhưng manifest không khai", ErrInvalidBundle)
		}
		return nil
	}
	if count != manifest.Library.EntryCount {
		return fmt.Errorf("%w: entryCount=%d nhưng có %d file library",
			ErrInvalidBundle, manifest.Library.EntryCount, count)
	}
	return nil
}

func validBundleManifest(manifest bundleManifest) bool {
	if manifest.Library != nil {
		if !isUUID(manifest.Library.LibraryRevisionID) ||
			domain.ValidateProjectLibraryVersion(manifest.Library.Version) != nil ||
			manifest.Library.EntryCount < 1 || manifest.Library.EntryCount > maxBundleFiles {
			return false
		}
	}
	if manifest.SystemLibraryVersion == "" || len(manifest.SystemLibraryVersion) > 64 {
		return false
	}
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
	if descriptor.Kind == "LIBRARY_ENTRY" {
		return isUUID(descriptor.ObjectID) &&
			descriptor.Path == "library/entries/"+descriptor.ObjectID+".json"
	}
	if !validBundleObjectKind(descriptor.Kind) || !isUUID(descriptor.ObjectID) {
		return false
	}
	expected := "revisions/" + descriptor.RevisionID + "/objects/" + strings.ToLower(descriptor.Kind) + "/" + descriptor.ObjectID + ".json"
	return descriptor.Path == expected
}

func validBundleObjectKind(kind string) bool {
	switch kind {
	case "METADATA", "PROGRAM", "FUNCTION", "FUNCTION_BLOCK", "VARIABLE", "BINDING", "TASK", "SIGNAL":
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
			revision.TargetProfile != targetProfile || revision.ProjectID != manifest.SourceProject.ProjectID ||
			len(revision.Objects) < 1 {
			// Trần dưới là 1, không phải 2. Document v2 bỏ object TASK, nên một
			// Project chưa có POU nào seal ra đúng MỘT object METADATA — và đó
			// là trạng thái hợp lệ, không phải bundle hỏng.
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
		// Đếm CHỈ descriptor thuộc Revision đó. File library cũng mang
		// `revisionId` của Revision được chọn nhưng không phải object của
		// Revision manifest, nên gộp chúng vào sẽ làm phép đếm luôn lệch.
		descriptorCount := 0
		for _, descriptor := range descriptors {
			if descriptor.RevisionID == revisionID && descriptor.Kind != "LIBRARY_ENTRY" {
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
	objects, programs := make([]any, 0), make([]any, 0)
	signals, bindings := make([]any, 0), make([]any, 0)
	var projectValue, libraryValue, executionValue any
	metadataCount := 0
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
			if !ok || len(metadata) < 2 || len(metadata) > 3 {
				return nil, fmt.Errorf("%w: metadata shape", ErrInvalidBundle)
			}
			projectValue, libraryValue = metadata["project"], metadata["library"]
			executionValue = metadata["execution"]
			metadataCount++
		case "program", "function", "function_block":
			object, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%w: POU shape %q", ErrInvalidBundle, name)
			}
			// Cấu hình Program đi kèm payload POU (xem `revisionPayload`), nên
			// tách nó ra lại ở đây thay vì bịa một object thứ hai.
			if config, ok := object["programConfig"].(map[string]any); ok {
				programs = append(programs, config)
				delete(object, "programConfig")
			}
			objects = append(objects, object)
		case "signal":
			signals = append(signals, value)
		case "binding":
			bindings = append(bindings, value)
		default:
			return nil, fmt.Errorf("%w: object kind %q", ErrInvalidBundle, kind)
		}
	}
	if metadataCount != 1 {
		return nil, fmt.Errorf("%w: metadata=%d", ErrInvalidBundle, metadataCount)
	}
	projectMap, ok := projectValue.(map[string]any)
	if !ok || projectMap["projectId"] != manifest.SourceProject.ProjectID {
		return nil, fmt.Errorf("%w: source project metadata", ErrInvalidBundle)
	}
	projectMap["projectId"] = newProjectID
	projectMap["name"] = newProjectName
	if executionValue == nil {
		executionValue = map[string]any{"profileId": domain.ProfileID,
			"maxProgramsEnabled": float64(domain.MaxProgramsEnabled)}
	}
	// Library nhập về là library MỚI của Project mới; pin cũ không còn nghĩa.
	if libraryMap, ok := libraryValue.(map[string]any); ok {
		libraryMap["projectLibraryRevisionId"] = nil
	}
	document := map[string]any{"schemaVersion": float64(draftDocumentVersion), "project": projectMap,
		"objects": objects, "programs": programs, "signals": signals, "bindings": bindings,
		"library": libraryValue, "execution": executionValue}
	if err := validateDraftDocumentV2(document); err != nil {
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

// libraryEntryDocument serialize entry ở dạng NGUỒN, tất định. Thứ tự field cố
// định theo struct và dependency đã sắp ở store, nên hai lần export cùng nội
// dung cho đúng cùng byte — điều kiện để hash bundle có nghĩa.
func libraryEntryDocument(entry programmingstore.LibraryEntry) ([]byte, error) {
	document := bundleLibraryEntryDocument{
		SchemaVersion: 1, EntryID: entry.EntryID, Kind: entry.Kind, Name: entry.Name,
		Language: entry.Language, FeatureState: entry.FeatureState, Source: string(entry.Source),
		Interface: json.RawMessage(entry.InterfaceJSON), Dependencies: make([]bundleLibraryDependency, 0, len(entry.Dependencies)),
	}
	for _, dependency := range entry.Dependencies {
		document.Dependencies = append(document.Dependencies,
			bundleLibraryDependency{EntryID: dependency.EntryID, Version: dependency.Version})
	}
	// Chỉ FUNCTION_BLOCK có layout authoritative mới mang khối này. FUNCTION có
	// state 0 authoritative — khai lại nó ở đây sẽ biến "0 vì đúng là 0" thành
	// một con số do bundle cung cấp.
	if entry.Kind == programmingstore.LibraryKindFunctionBlock && entry.StateLayout.Authoritative {
		document.StateLayout = &bundleLibraryStateLayout{
			Version: entry.StateLayout.Version, StateSizeBytes: entry.StateLayout.StateSizeBytes,
			SHA256: hex.EncodeToString(entry.StateLayout.SHA256[:]),
		}
	}
	return json.Marshal(document)
}

// libraryImportsFromBundle dịch tài liệu nguồn thành input store. Mọi trường
// được validate lại ở đây và ở store; bundle không được tin về bất cứ điều gì.
func libraryImportsFromBundle(manifest bundleManifest, files map[string][]byte) ([]programmingstore.LibraryEntryImport, error) {
	if manifest.Library == nil {
		return nil, nil
	}
	imports := make([]programmingstore.LibraryEntryImport, 0, manifest.Library.EntryCount)
	seenID := make(map[string]struct{}, manifest.Library.EntryCount)
	seenName := make(map[string]struct{}, manifest.Library.EntryCount)
	for _, descriptor := range manifest.Files {
		if descriptor.Kind != "LIBRARY_ENTRY" {
			continue
		}
		var document bundleLibraryEntryDocument
		if err := decodeBundleJSON(files[descriptor.Path], &document); err != nil || document.SchemaVersion != 1 {
			return nil, fmt.Errorf("%w: library entry %q", ErrInvalidBundle, descriptor.Path)
		}
		if document.EntryID != descriptor.ObjectID || !isUUID(document.EntryID) ||
			(document.Kind != "FUNCTION" && document.Kind != "FUNCTION_BLOCK") ||
			(document.Language != "ST" && document.Language != "FBD") ||
			document.FeatureState != "AVAILABLE" || !validText(document.Name, 1, 64) ||
			!validLibrarySource(document.Source) || len(document.Interface) < 2 {
			return nil, fmt.Errorf("%w: library entry %q", ErrInvalidBundle, descriptor.Path)
		}
		if _, duplicate := seenID[strings.ToUpper(document.EntryID)]; duplicate {
			return nil, fmt.Errorf("%w: entryId trùng %q", ErrInvalidBundle, document.EntryID)
		}
		if _, duplicate := seenName[strings.ToUpper(document.Name)]; duplicate {
			return nil, fmt.Errorf("%w: tên entry trùng %q", ErrInvalidBundle, document.Name)
		}
		seenID[strings.ToUpper(document.EntryID)] = struct{}{}
		seenName[strings.ToUpper(document.Name)] = struct{}{}

		layout, err := bundleStateLayout(document)
		if err != nil {
			return nil, err
		}
		dependencies := make([]programmingstore.LibraryDependency, 0, len(document.Dependencies))
		for _, dependency := range document.Dependencies {
			if !isUUID(dependency.EntryID) || dependency.Version != manifest.Library.Version {
				return nil, fmt.Errorf("%w: dependency của %q", ErrInvalidBundle, document.EntryID)
			}
			dependencies = append(dependencies,
				programmingstore.LibraryDependency{EntryID: dependency.EntryID, Version: dependency.Version})
		}
		imports = append(imports, programmingstore.LibraryEntryImport{
			EntryID: document.EntryID, Kind: document.Kind, Name: document.Name, Language: document.Language,
			FeatureState: document.FeatureState, Source: []byte(document.Source),
			InterfaceJSON: append([]byte(nil), document.Interface...), Dependencies: dependencies, StateLayout: layout,
		})
	}
	if len(imports) != manifest.Library.EntryCount {
		return nil, fmt.Errorf("%w: entryCount lệch số file library", ErrInvalidBundle)
	}
	return imports, nil
}

func bundleStateLayout(document bundleLibraryEntryDocument) (programmingstore.LibraryStateLayout, error) {
	if document.Kind == "FUNCTION" {
		if document.StateLayout != nil {
			return programmingstore.LibraryStateLayout{}, fmt.Errorf("%w: FUNCTION mang stateLayout", ErrInvalidBundle)
		}
		return programmingstore.LibraryStateLayout{Authoritative: true}, nil
	}
	if document.StateLayout == nil {
		return programmingstore.LibraryStateLayout{}, nil
	}
	digest, err := hex.DecodeString(document.StateLayout.SHA256)
	if err != nil || len(digest) != sha256.Size || document.StateLayout.Version == 0 {
		return programmingstore.LibraryStateLayout{}, fmt.Errorf("%w: stateLayout của %q", ErrInvalidBundle, document.EntryID)
	}
	layout := programmingstore.LibraryStateLayout{Authoritative: true,
		Version: document.StateLayout.Version, StateSizeBytes: document.StateLayout.StateSizeBytes}
	copy(layout.SHA256[:], digest)
	return layout, nil
}
