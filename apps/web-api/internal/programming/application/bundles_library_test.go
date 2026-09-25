package application

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

const (
	bundleLibraryRevisionID = "6a111111-1111-4111-8111-111111111111"
	bundleLibraryEntryID    = "6a222222-2222-4222-8222-222222222222"
	bundleLibraryFBEntryID  = "6a333333-3333-4333-8333-333333333333"
)

// seedRevisionWithLibrary dựng Project + PROJECT Library đã publish + một
// Revision pin đúng library đó. Đường seal đa Program thuộc T59-301, nên ở đây
// gọi thẳng store — test này kiểm bundle, không kiểm đường seal.
func seedRevisionWithLibrary(t *testing.T, service *ProjectService, store *programmingstore.Store) (string, string) {
	t.Helper()
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(ctx, actor, CreateProjectCommand{SchemaVersion: "1.0", Name: "AHU library bundle",
		Description: "fixture", IdempotencyKey: "61000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)

	at := service.now()
	identity := func(label string, etag int64) programmingstore.LibraryMutationIdentity {
		key, request := sha256.Sum256([]byte("key:"+label)), sha256.Sum256([]byte("request:"+label))
		return programmingstore.LibraryMutationIdentity{
			ProjectID: projectID, ExpectedDraftETag: etag, ActorID: testActorID, Role: "admin",
			AuditID: "cccccccc-cccc-4ccc-8ccc-" + label, CorrelationID: testCorrelationID, At: at,
			IdempotencyKeySHA256: key, RequestSHA256: request,
		}
	}
	// Entry đầu tiên KHÔNG nêu `LibraryRevisionID`: đó là đường thật mà route
	// entry đi qua — Draft library được mở ngay tại lần ghi đầu.
	first, err := store.UpsertProjectLibraryEntry(ctx, programmingstore.UpsertProjectLibraryEntryParams{
		EntryID: bundleLibraryEntryID, Kind: "FUNCTION",
		Name: "SCALE_LIN", Language: "ST", FeatureState: "AVAILABLE",
		Source:               []byte("FUNCTION SCALE_LIN : REAL\nVAR_INPUT X : REAL; END_VAR\nSCALE_LIN := X;\nEND_FUNCTION\n"),
		InterfaceJSON:        []byte(`{"inputs":[{"name":"X","type":"REAL"}],"returnType":"REAL"}`),
		StateLayout:          programmingstore.LibraryStateLayout{Authoritative: true},
		NewLibraryRevisionID: bundleLibraryRevisionID, Identity: identity("000000000001", 1),
	})
	if err != nil {
		t.Fatal(err)
	}
	layout := programmingstore.LibraryStateLayout{Authoritative: true, Version: 1, StateSizeBytes: 24,
		SHA256: sha256.Sum256([]byte("fb-layout"))}
	second, err := store.UpsertProjectLibraryEntry(ctx, programmingstore.UpsertProjectLibraryEntryParams{
		LibraryRevisionID: bundleLibraryRevisionID, EntryID: bundleLibraryFBEntryID, Kind: "FUNCTION_BLOCK",
		Name: "FILTER_T1", Language: "ST", FeatureState: "AVAILABLE",
		Source:        []byte("FUNCTION_BLOCK FILTER_T1\nVAR_INPUT X : REAL; END_VAR\nEND_FUNCTION_BLOCK\n"),
		InterfaceJSON: []byte(`{"inputs":[{"name":"X","type":"REAL"}]}`),
		Dependencies:  []programmingstore.LibraryDependency{{EntryID: bundleLibraryEntryID, Version: "1.0.0"}},
		StateLayout:   layout, Identity: identity("000000000002", first.DraftETag),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Đi qua ĐÚNG đường sản phẩm: SaveDraft rồi SealRevision. Seal đóng băng
	// library Draft cùng transaction, nên bundle export ra là bundle thật.
	programID := "6a666666-6666-4666-8666-666666666666"
	taskID := "6a777777-7777-4777-8777-777777777777"
	objectID := "6a888888-8888-4888-8888-888888888888"
	object := op(map[string]any{"op": "upsertObject", "object": map[string]any{
		"objectId": objectID, "kind": "PROGRAM", "name": "AHU", "language": "ST",
		"source":       "PROGRAM AHU\nVAR_OUTPUT Fan : REAL; END_VAR\nFan := SCALE_LIN(1.0);\nEND_PROGRAM\n",
		"dependencies": []string{bundleLibraryEntryID},
	}})
	program := programOp(programID, objectID, 1000)
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{
		"taskId": taskID, "periodMs": 1000, "programOrder": []string{programID}}})
	saved, err := service.SaveDraft(ctx, actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: draftID, Operations: []json.RawMessage{object, program, task},
		IfMatch:        FormatDraftETag(draftID, second.DraftETag),
		IdempotencyKey: "61000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(ctx, actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: draftID, Label: "R1", IfMatch: saved.ETag,
		IdempotencyKey: "61000000-0000-4000-8000-000000000003", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return projectID, sealed.Resource["revisionId"].(string)
}

func exportLibraryBundle(t *testing.T, service *ProjectService, revisionID, key string) BundleExportResult {
	t.Helper()
	result, err := service.ExportBundle(context.Background(), Actor{ID: testActorID, Role: "admin"},
		BundleExportCommand{SchemaVersion: "1.0", RevisionIDs: []string{revisionID},
			IdempotencyKey: key, CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func unzipBundle(t *testing.T, raw []byte) map[string][]byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	files := make(map[string][]byte, len(reader.File))
	for _, file := range reader.File {
		stream, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		content := new(bytes.Buffer)
		if _, err := content.ReadFrom(stream); err != nil {
			t.Fatal(err)
		}
		_ = stream.Close()
		files[file.Name] = content.Bytes()
	}
	return files
}

// rezip dựng lại bundle từ map file, giữ đúng thuộc tính deterministic của
// writer thật. Nhờ vậy corpus thù địch chỉ khác đúng thứ đang được test.
func rezip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	fixed := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, name := range names {
		header := &zip.FileHeader{Name: name, Method: zip.Store, Modified: fixed}
		header.SetMode(0o640)
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(files[name]); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func importBundle(service *ProjectService, raw []byte, name, key string) (MutationResult, error) {
	digest := sha256.Sum256(raw)
	return service.ImportBundle(context.Background(), Actor{ID: testActorID, Role: "admin"}, BundleImportCommand{
		SchemaVersion: "1.0", Name: name, Description: "import", Bundle: raw,
		ExpectedSHA256: hex.EncodeToString(digest[:]), IdempotencyKey: key, CorrelationID: testCorrelationID,
	})
}

// Bundle là NGUỒN: nó mang source/interface/dependency, và tuyệt đối không mang
// artifact, IR hay cache. Export hai lần cùng nội dung phải cho đúng cùng byte.
func TestExportBundleCarriesProjectLibrarySourceOnlyAndIsDeterministic(t *testing.T) {
	service, store := openBundleService(t)
	_, revisionID := seedRevisionWithLibrary(t, service, store)

	first := exportLibraryBundle(t, service, revisionID, "62000000-0000-4000-8000-000000000001")
	second := exportLibraryBundle(t, service, revisionID, "62000000-0000-4000-8000-000000000002")
	if !bytes.Equal(first.Bundle, second.Bundle) || first.BundleSHA256 != second.BundleSHA256 {
		t.Fatal("export không tất định giữa hai lần chạy")
	}

	files := unzipBundle(t, first.Bundle)
	var manifest bundleManifest
	if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Library == nil || manifest.Library.EntryCount != 2 || manifest.Library.Version != "1.0.0" {
		t.Fatalf("manifest library=%+v", manifest.Library)
	}
	if manifest.SystemLibraryVersion == "" {
		t.Fatal("manifest thiếu systemLibraryVersion")
	}
	for _, path := range []string{
		"library/entries/" + bundleLibraryEntryID + ".json",
		"library/entries/" + bundleLibraryFBEntryID + ".json",
	} {
		if _, ok := files[path]; !ok {
			t.Fatalf("bundle thiếu %s", path)
		}
	}
	// Không một byte artifact/IR/cache nào được lọt vào bundle nguồn.
	for name, content := range files {
		if strings.Contains(name, "artifact") || strings.HasSuffix(name, ".mkir") ||
			strings.Contains(name, "cache") || bytes.Contains(content, []byte("MKDDCIR")) {
			t.Fatalf("bundle nguồn mang nội dung không phải nguồn: %s", name)
		}
	}
	// FUNCTION không mang stateLayout; FUNCTION_BLOCK có layout authoritative thì có.
	var function, block bundleLibraryEntryDocument
	if err := json.Unmarshal(files["library/entries/"+bundleLibraryEntryID+".json"], &function); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(files["library/entries/"+bundleLibraryFBEntryID+".json"], &block); err != nil {
		t.Fatal(err)
	}
	if function.StateLayout != nil {
		t.Fatal("FUNCTION không được mang stateLayout trong bundle")
	}
	if block.StateLayout == nil || block.StateLayout.StateSizeBytes != 24 {
		t.Fatalf("FUNCTION_BLOCK layout=%+v", block.StateLayout)
	}
}

// Import dựng lại library ở DRAFT với identity MỚI, nhưng nội dung phải khớp
// từng entry. Giữ nguyên identity của bên gửi sẽ làm hai controller có hai nội
// dung khác nhau dưới cùng một identity.
func TestImportBundleRebuildsProjectLibraryAsDraftWithNewIdentity(t *testing.T) {
	service, store := openBundleService(t)
	_, revisionID := seedRevisionWithLibrary(t, service, store)
	exported := exportLibraryBundle(t, service, revisionID, "62000000-0000-4000-8000-000000000010")

	result, err := importBundle(service, exported.Bundle, "AHU nhập về", "62000000-0000-4000-8000-000000000011")
	if err != nil {
		t.Fatal(err)
	}
	importedProjectID := result.Resource["projectId"].(string)
	ctx := context.Background()
	revisions, err := store.ListLibraryRevisions(ctx, importedProjectID, "PROJECT")
	if err != nil {
		t.Fatal(err)
	}
	if len(revisions) != 1 {
		t.Fatalf("số PROJECT library sau import=%d", len(revisions))
	}
	imported := revisions[0]
	if imported.State != "DRAFT" {
		t.Fatalf("library nhập về phải là DRAFT, thực tế %s", imported.State)
	}
	if imported.LibraryRevisionID == bundleLibraryRevisionID {
		t.Fatal("library nhập về giữ nguyên identity của bên gửi")
	}
	if imported.Version != "1.0.0" {
		t.Fatalf("version=%s", imported.Version)
	}

	source, err := store.ListLibraryEntries(ctx, bundleLibraryRevisionID)
	if err != nil {
		t.Fatal(err)
	}
	target, err := store.ListLibraryEntries(ctx, imported.LibraryRevisionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(target) != len(source) {
		t.Fatalf("số entry lệch: %d/%d", len(target), len(source))
	}
	for index := range source {
		if source[index].ContentSHA256 != target[index].ContentSHA256 {
			t.Fatalf("entry %s đổi nội dung qua bundle", source[index].Name)
		}
	}

	// Import KHÔNG được tạo Revision hay Active state nào: Project nhập về chỉ
	// có Draft, đúng như `importedBundleResource` tuyên bố.
	view, err := service.GetProject(ctx, importedProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if view.ActiveRevisionID != nil || view.LatestCheck != nil {
		t.Fatalf("import tạo state ngoài Draft: %+v", view)
	}
}

// Version registry SYSTEM lệch là lỗi RIÊNG: bundle không hỏng, nó chỉ được xuất
// trên một registry khác. Người vận hành cần biết phải xuất lại, không phải đi
// tìm file hỏng.
func TestImportBundleRejectsSystemLibraryVersionDrift(t *testing.T) {
	service, store := openBundleService(t)
	_, revisionID := seedRevisionWithLibrary(t, service, store)
	exported := exportLibraryBundle(t, service, revisionID, "62000000-0000-4000-8000-000000000020")

	files := unzipBundle(t, exported.Bundle)
	var manifest map[string]any
	if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["systemLibraryVersion"] = "rev-z.9"
	tampered, _ := json.Marshal(manifest)
	files["manifest.json"] = tampered

	_, err := importBundle(service, rezip(t, files), "drift", "62000000-0000-4000-8000-000000000021")
	if !errors.Is(err, ErrBundleLibraryVersion) {
		t.Fatalf("version drift err=%v", err)
	}
	if errors.Is(err, ErrInvalidBundle) {
		t.Fatal("version drift không được gộp vào lỗi bundle hỏng")
	}
}

// Corpus thù địch: mỗi biến thể phải bị TỪ CHỐI và KHÔNG để lại mutation nào.
func TestImportBundleHostileLibraryCorpusMakesNoMutation(t *testing.T) {
	service, store := openBundleService(t)
	sourceProjectID, revisionID := seedRevisionWithLibrary(t, service, store)
	exported := exportLibraryBundle(t, service, revisionID, "62000000-0000-4000-8000-000000000030")
	entryPath := "library/entries/" + bundleLibraryEntryID + ".json"

	mutate := func(change func(files map[string][]byte)) []byte {
		files := unzipBundle(t, exported.Bundle)
		change(files)
		return rezip(t, files)
	}
	patchEntry := func(files map[string][]byte, apply func(document map[string]any)) {
		var document map[string]any
		if err := json.Unmarshal(files[entryPath], &document); err != nil {
			t.Fatal(err)
		}
		apply(document)
		raw, _ := json.Marshal(document)
		files[entryPath] = raw
	}
	patchManifest := func(files map[string][]byte, apply func(manifest map[string]any)) {
		var manifest map[string]any
		if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
			t.Fatal(err)
		}
		apply(manifest)
		raw, _ := json.Marshal(manifest)
		files["manifest.json"] = raw
	}

	corpus := map[string][]byte{
		"path traversal": mutate(func(files map[string][]byte) {
			files["../../etc/passwd"] = []byte("root:x:0:0")
		}),
		"đường dẫn tuyệt đối": mutate(func(files map[string][]byte) {
			files["/etc/shadow"] = []byte("secret")
		}),
		"file thực thi": mutate(func(files map[string][]byte) {
			files["library/entries/run.sh"] = []byte("#!/bin/sh\nrm -rf /\n")
		}),
		"entry không có trong manifest": mutate(func(files map[string][]byte) {
			files["library/entries/6a999999-9999-4999-8999-999999999999.json"] = []byte(`{"schemaVersion":1}`)
		}),
		"đổi nội dung nhưng giữ hash cũ": mutate(func(files map[string][]byte) {
			patchEntry(files, func(document map[string]any) {
				document["source"] = "FUNCTION SCALE_LIN : REAL\nSCALE_LIN := 99.0;\nEND_FUNCTION\n"
			})
		}),
		"khai featureState REVIEW_REQUIRED": mutate(func(files map[string][]byte) {
			patchEntry(files, func(document map[string]any) { document["featureState"] = "REVIEW_REQUIRED" })
			patchManifestHash(t, files, entryPath)
		}),
		"FUNCTION mang stateLayout": mutate(func(files map[string][]byte) {
			patchEntry(files, func(document map[string]any) {
				document["stateLayout"] = map[string]any{"version": 1, "stateSizeBytes": 8,
					"sha256": strings.Repeat("ab", 32)}
			})
			patchManifestHash(t, files, entryPath)
		}),
		"entryCount lệch số file": mutate(func(files map[string][]byte) {
			patchManifest(files, func(manifest map[string]any) {
				manifest["library"].(map[string]any)["entryCount"] = float64(5)
			})
		}),
		"manifest không khai library nhưng vẫn có file": mutate(func(files map[string][]byte) {
			patchManifest(files, func(manifest map[string]any) { delete(manifest, "library") })
		}),
		"dependency trỏ version khác": mutate(func(files map[string][]byte) {
			blockPath := "library/entries/" + bundleLibraryFBEntryID + ".json"
			var document map[string]any
			if err := json.Unmarshal(files[blockPath], &document); err != nil {
				t.Fatal(err)
			}
			document["dependencies"] = []any{map[string]any{"entryId": bundleLibraryEntryID, "version": "9.9.9"}}
			raw, _ := json.Marshal(document)
			files[blockPath] = raw
			patchManifestHash(t, files, blockPath)
		}),
	}

	index := 0
	for name, raw := range corpus {
		index++
		before := countProjects(t, service)
		_, err := importBundle(service, raw, "hostile", hostileKey(index))
		if err == nil {
			t.Fatalf("%s: bundle độc hại được chấp nhận", name)
		}
		if after := countProjects(t, service); after != before {
			t.Fatalf("%s: import thất bại vẫn tạo Project (%d -> %d)", name, before, after)
		}
		libraries, err := store.ListLibraryRevisions(context.Background(), sourceProjectID, "PROJECT")
		if err != nil {
			t.Fatal(err)
		}
		if len(libraries) != 1 {
			t.Fatalf("%s: import thất bại vẫn đụng library nguồn (%d)", name, len(libraries))
		}
	}
}

// patchManifestHash cập nhật lại descriptor cho một file vừa bị sửa, để corpus
// kiểm ĐÚNG luật đang nhắm tới chứ không dừng sớm ở phép so hash.
func patchManifestHash(t *testing.T, files map[string][]byte, path string) {
	t.Helper()
	var manifest map[string]any
	if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(files[path])
	for _, item := range manifest["files"].([]any) {
		descriptor := item.(map[string]any)
		if descriptor["path"] == path {
			descriptor["sha256"] = hex.EncodeToString(digest[:])
			descriptor["byteSize"] = float64(len(files[path]))
		}
	}
	raw, _ := json.Marshal(manifest)
	files["manifest.json"] = raw
}

func countProjects(t *testing.T, service *ProjectService) int {
	t.Helper()
	page, err := service.ListProjects(context.Background(), "", 100)
	if err != nil {
		t.Fatal(err)
	}
	return len(page.Items)
}

func hostileKey(index int) string {
	return "63000000-0000-4000-8000-0000000000" + string(rune('a'+index%26)) + string(rune('a'+index/26%26))
}
