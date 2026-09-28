package application

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
)

func TestStReferencedNamesIgnoresCommentsAndStrings(t *testing.T) {
	source := "PROGRAM P\nVAR t : FB_RELAY; u:FB_STAGE := x; END_VAR\n" +
		"(* FN_IN_COMMENT(1) *)\n// FN_IN_LINE(2)\nmsg := 'FN_IN_STRING(3)';\n" +
		"y := fn_scale (1.0);\nt(IN := TRUE);\nEND_PROGRAM\n"
	names := stReferencedNames(source)
	for _, want := range []string{"FB_RELAY", "FB_STAGE", "FN_SCALE", "T"} {
		if _, ok := names[want]; !ok {
			t.Errorf("thiếu %s trong %v", want, names)
		}
	}
	for _, unwanted := range []string{"FN_IN_COMMENT", "FN_IN_LINE", "FN_IN_STRING"} {
		if _, ok := names[unwanted]; ok {
			t.Errorf("không được lấy %s từ chú thích/chuỗi", unwanted)
		}
	}
}

func TestInferProjectLibraryDependenciesAddsOnlyUnshadowedMissingEntries(t *testing.T) {
	const (
		entryScale  = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001"
		entryRelay  = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002"
		entryShadow = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003"
	)
	document := map[string]any{"objects": []any{
		map[string]any{"objectId": objectUUID(1), "name": "PRG_A", "language": "ST",
			"source":       "PROGRAM PRG_A\nVAR r : FB_RELAY; END_VAR\ny := SCALE_LIN(1.0) + FB_LOCAL(2.0);\nEND_PROGRAM\n",
			"dependencies": []any{entryRelay}},
		// POU cùng tên một entry: POU trong Draft thắng, không thêm dependency.
		map[string]any{"objectId": objectUUID(2), "name": "FB_LOCAL", "language": "ST",
			"source": "FUNCTION FB_LOCAL : REAL\nVAR_INPUT X : REAL; END_VAR\nFB_LOCAL := X;\nEND_FUNCTION\n"},
		// FBD không bị đụng tới.
		map[string]any{"objectId": objectUUID(3), "name": "PRG_FBD", "language": "FBD",
			"source": `{"blocks":[{"type":"SCALE_LIN"}]}`},
	}}
	entries := []projectLibraryEntryRef{
		{EntryID: entryScale, Name: "scale_lin"},
		{EntryID: entryRelay, Name: "FB_RELAY"},
		{EntryID: entryShadow, Name: "FB_LOCAL"},
	}
	if !inferProjectLibraryDependencies(document, entries) {
		t.Fatal("phải báo có thay đổi")
	}
	objects := collectionOf(document, "objects")
	got := fmt.Sprint(objects[0]["dependencies"])
	if got != fmt.Sprint([]any{entryRelay, entryScale}) {
		t.Fatalf("dependencies PRG_A = %s", got)
	}
	if _, ok := objects[1]["dependencies"]; ok {
		t.Fatalf("POU FB_LOCAL không gọi entry nào mà vẫn được thêm: %v", objects[1]["dependencies"])
	}
	if _, ok := objects[2]["dependencies"]; ok {
		t.Fatal("FBD không được đụng tới")
	}
	// Chạy lại: không có gì mới, không nhân đôi.
	if inferProjectLibraryDependencies(document, entries) {
		t.Fatal("lần hai không được đổi gì")
	}
}

// Luồng thật: lưu một POU ST gọi khối Thư viện PROJECT mà KHÔNG khai
// `dependencies` (đúng như Quick Library và client API vẫn làm), Draft phải tự
// có dependency và Seal ghim đúng version thư viện.
func TestSaveDraftInfersProjectLibraryDependencyAndSealPinsIt(t *testing.T) {
	library, projects, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	entry := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000061")
	entry.IfMatch = created.ETag
	mutated, err := library.UpsertEntry(ctx, actor, entry)
	if err != nil {
		t.Fatal(err)
	}
	counter := 0
	projects.newID = func() string {
		counter++
		return fmt.Sprintf("dddddddd-dddd-4ddd-8ddd-%012d", counter)
	}
	objectID := "99999999-9999-4999-8999-999999999961"
	programID := "99999999-9999-4999-8999-999999999962"
	saved, err := saveOps(t, projects, libraryProjectID,
		created.Resource["draftRevisionId"].(string), mutated.ETag,
		"20000000-0000-4000-8000-000000000062",
		op(map[string]any{"op": "upsertObject", "object": map[string]any{
			"objectId": objectID, "kind": "PROGRAM", "name": "AHU_MAIN", "language": "ST",
			"source": "PROGRAM AHU_MAIN\nVAR_OUTPUT Y : REAL; END_VAR\nY := SCALE_LIN(1.0);\nEND_PROGRAM\n",
		}}),
		programOp(programID, objectID, 1000))
	if err != nil {
		t.Fatal(err)
	}
	project, err := projects.GetProject(ctx, libraryProjectID)
	if err != nil {
		t.Fatal(err)
	}
	var draft map[string]any
	if err := json.Unmarshal(project.DraftContentJSON, &draft); err != nil {
		t.Fatal(err)
	}
	var dependencies any
	for _, object := range collectionOf(draft, "objects") {
		if object["objectId"] == objectID {
			dependencies = object["dependencies"]
		}
	}
	if fmt.Sprint(dependencies) != fmt.Sprint([]any{libraryEntryA}) {
		t.Fatalf("Draft không tự có dependency cho lời gọi SCALE_LIN: %v", dependencies)
	}
	sealed, err := projects.SealRevision(ctx, actor, SealRevisionCommand{
		ProjectID: libraryProjectID, SchemaVersion: "1.0",
		BaseRevisionID: created.Resource["draftRevisionId"].(string), Label: "U-06",
		IfMatch: saved.ETag, IdempotencyKey: "20000000-0000-4000-8000-000000000063",
		CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := library.store.GetRevision(ctx, sealed.Resource["revisionId"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.POUObjects) != 1 || len(snapshot.POUObjects[0].Dependencies) != 1 ||
		snapshot.POUObjects[0].Dependencies[0].EntryID != libraryEntryA ||
		snapshot.POUObjects[0].Dependencies[0].Version != "1.0.0" {
		t.Fatalf("Seal không ghim dependency suy ra: %+v", snapshot.POUObjects)
	}
}
