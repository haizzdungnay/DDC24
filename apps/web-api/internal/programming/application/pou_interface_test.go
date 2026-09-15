package application

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestExtractPouInterface_ST_Basic(t *testing.T) {
	source := `
VAR_INPUT
    pv : REAL;
END_VAR
VAR_OUTPUT
    out : BOOL;
END_VAR
`
	got := extractPouInterface("FUNCTION_BLOCK", "ST", source)
	want := pouInterface{
		Inputs:  []pouInterfacePin{{Name: "pv", Type: "REAL"}},
		Outputs: []pouInterfacePin{{Name: "out", Type: "BOOL"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}
}

func TestExtractPouInterface_ST_MultipleNames(t *testing.T) {
	source := `
VAR_INPUT
    a, b, c : REAL;
END_VAR
`
	got := extractPouInterface("PROGRAM", "ST", source)
	want := pouInterface{
		Inputs: []pouInterfacePin{
			{Name: "a", Type: "REAL"},
			{Name: "b", Type: "REAL"},
			{Name: "c", Type: "REAL"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}
}

func TestExtractPouInterface_ST_InitialValue(t *testing.T) {
	source := `
VAR_INPUT
    pv : REAL := 0.0;
    threshold : REAL := 100.5;
END_VAR
VAR_OUTPUT
    alarm : BOOL := FALSE;
END_VAR
`
	got := extractPouInterface("FUNCTION_BLOCK", "ST", source)
	want := pouInterface{
		Inputs: []pouInterfacePin{
			{Name: "pv", Type: "REAL"},
			{Name: "threshold", Type: "REAL"},
		},
		Outputs: []pouInterfacePin{
			{Name: "alarm", Type: "BOOL"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}
}

func TestExtractPouInterface_ST_Comments(t *testing.T) {
	source := `
(* Header comment
   spanning multiple lines *)
// Line comment before block
VAR_INPUT
    (* comment inside *)
    pv : REAL; // inline comment
    (* multi
       line
       comment *)
    sp : REAL;
END_VAR
VAR_OUTPUT
    out : BOOL; // comment after
END_VAR
`
	got := extractPouInterface("FUNCTION_BLOCK", "ST", source)
	want := pouInterface{
		Inputs: []pouInterfacePin{
			{Name: "pv", Type: "REAL"},
			{Name: "sp", Type: "REAL"},
		},
		Outputs: []pouInterfacePin{
			{Name: "out", Type: "BOOL"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}
}

func TestExtractPouInterface_ST_FunctionReturnType(t *testing.T) {
	source := `
FUNCTION CalculateFlow : REAL
VAR_INPUT
    diff_press : REAL;
END_VAR
CalculateFlow := diff_press * 2.0;
END_FUNCTION
`
	got := extractPouInterface("FUNCTION", "ST", source)
	want := pouInterface{
		Inputs: []pouInterfacePin{
			{Name: "diff_press", Type: "REAL"},
		},
		ReturnType: "REAL",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}

	gotFB := extractPouInterface("FUNCTION_BLOCK", "ST", source)
	if gotFB.ReturnType != "" {
		t.Fatalf("expected empty returnType for FUNCTION_BLOCK, got %q", gotFB.ReturnType)
	}
}

func TestExtractPouInterface_FBD_Basic(t *testing.T) {
	source := `{
  "schemaVersion": 1,
  "networks": [
    {
      "nodes": [
        {"kind": "INPUT", "typeRef": "BOOL", "parameters": {"variable": "OCCUPIED"}},
        {"kind": "INPUT", "typeRef": "REAL", "parameters": {"variable": "TEMP"}},
        {"kind": "INPUT", "typeRef": "BOOL", "parameters": {"variable": "OCCUPIED"}},
        {"kind": "OUTPUT", "typeRef": "BOOL", "parameters": {"variable": "COOLING_REQ"}},
        {"kind": "OUTPUT", "typeRef": "BOOL", "parameters": {"variable": "COOLING_REQ"}},
        {"kind": "OUTPUT", "typeRef": "REAL", "parameters": {"variable": "VALVE_POS"}}
      ]
    }
  ]
}`
	got := extractPouInterface("PROGRAM", "FBD", source)
	want := pouInterface{
		Inputs: []pouInterfacePin{
			{Name: "OCCUPIED", Type: "BOOL"},
			{Name: "TEMP", Type: "REAL"},
		},
		Outputs: []pouInterfacePin{
			{Name: "COOLING_REQ", Type: "BOOL"},
			{Name: "VALVE_POS", Type: "REAL"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}
}

func TestExtractPouInterface_FBD_MalformedJSON(t *testing.T) {
	source := `{"schemaVersion": 1, networks: [ broken json `
	got := extractPouInterface("PROGRAM", "FBD", source)
	if got.Inputs == nil || len(got.Inputs) != 0 || len(got.Outputs) != 0 || got.ReturnType != "" {
		t.Fatalf("expected empty interface with non-nil inputs, got %+v", got)
	}
}

func TestExtractPouInterface_EmptySource(t *testing.T) {
	got := extractPouInterface("PROGRAM", "ST", "")
	if got.Inputs == nil || len(got.Inputs) != 0 || len(got.Outputs) != 0 || got.ReturnType != "" {
		t.Fatalf("expected empty interface for empty source, got %+v", got)
	}
}

func TestExtractPouInterface_CaseInsensitive(t *testing.T) {
	source := `
function my_calc : real
var_input
    in1 : bool;
end_var
var_output
    out1 : bool;
end_var
end_function
`
	got := extractPouInterface("FUNCTION", "ST", source)
	want := pouInterface{
		Inputs: []pouInterfacePin{
			{Name: "in1", Type: "bool"},
		},
		Outputs: []pouInterfacePin{
			{Name: "out1", Type: "bool"},
		},
		ReturnType: "real",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}
}

func TestExtractPouInterface_ST_IgnoreOtherVars(t *testing.T) {
	source := `
VAR
    internal_cnt : INT;
END_VAR
VAR_TEMP
    tmp : REAL;
END_VAR
VAR_IN_OUT
    inout_var : REAL;
END_VAR
VAR_INPUT
    valid_in : BOOL;
END_VAR
`
	got := extractPouInterface("PROGRAM", "ST", source)
	want := pouInterface{
		Inputs: []pouInterfacePin{
			{Name: "valid_in", Type: "BOOL"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractPouInterface() = %+v, want %+v", got, want)
	}
}

func TestExtractPouInterface_JSONShape(t *testing.T) {
	empty := pouInterface{Inputs: []pouInterfacePin{}}
	rawEmpty, err := json.Marshal(empty)
	if err != nil {
		t.Fatal(err)
	}
	if string(rawEmpty) != `{"inputs":[]}` {
		t.Fatalf("marshal empty = %s, want %s", string(rawEmpty), `{"inputs":[]}`)
	}

	full := pouInterface{
		Inputs:     []pouInterfacePin{{Name: "pv", Type: "REAL"}},
		Outputs:    []pouInterfacePin{{Name: "out", Type: "BOOL"}},
		ReturnType: "REAL",
	}
	rawFull, err := json.Marshal(full)
	if err != nil {
		t.Fatal(err)
	}
	wantFull := `{"inputs":[{"name":"pv","type":"REAL"}],"outputs":[{"name":"out","type":"BOOL"}],"returnType":"REAL"}`
	if string(rawFull) != wantFull {
		t.Fatalf("marshal full = %s, want %s", string(rawFull), wantFull)
	}
}

func TestSaveDraft_EnrichesReturnedDraftInterface_STAndFBD(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	stObjectID := objectUUID(10)
	fbdObjectID := objectUUID(11)

	// 1. Thao tác tạo POU ST có VAR_INPUT và VAR_OUTPUT, KHÔNG gửi kèm interface
	stSource := "FUNCTION_BLOCK FB_Motor\nVAR_INPUT\n    speed : REAL;\nEND_VAR\nVAR_OUTPUT\n    running : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
	opST := op(map[string]any{
		"op": "upsertObject",
		"object": map[string]any{
			"objectId": stObjectID,
			"kind":     "FUNCTION_BLOCK",
			"name":     "FB_Motor",
			"language": "ST",
			"source":   stSource,
		},
	})

	resST, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-000000000101", opST)
	if err != nil {
		t.Fatalf("saveOps ST failed: %v", err)
	}

	// KHẲNG ĐỊNH: Nội dung draft TRẢ VỀ trong phản hồi SaveDraft phải chứa interface đúng
	returnedContentST, ok := resST.Resource["content"].(map[string]any)
	if !ok {
		t.Fatalf("expected content in resST.Resource, got: %T", resST.Resource["content"])
	}
	stObjects := collectionOf(returnedContentST, "objects")
	if len(stObjects) != 1 {
		t.Fatalf("expected 1 object in returned content, got %d", len(stObjects))
	}
	stIface, ok := stObjects[0]["interface"].(map[string]any)
	if !ok {
		t.Fatalf("expected interface in returned ST object, got: %v", stObjects[0]["interface"])
	}
	stInputs, _ := stIface["inputs"].([]any)
	if len(stInputs) != 1 || stInputs[0].(map[string]any)["name"] != "speed" {
		t.Fatalf("expected input speed in returned ST object, got: %+v", stIface["inputs"])
	}
	stOutputs, _ := stIface["outputs"].([]any)
	if len(stOutputs) != 1 || stOutputs[0].(map[string]any)["name"] != "running" {
		t.Fatalf("expected output running in returned ST object, got: %+v", stIface["outputs"])
	}

	// 2. Thao tác tạo POU FBD có node INPUT/OUTPUT, KHÔNG gửi kèm interface
	fbdSource := `{
	  "schemaVersion": 1,
	  "networks": [
	    {
	      "nodes": [
	        {"kind": "INPUT", "typeRef": "BOOL", "parameters": {"variable": "START_CMD"}},
	        {"kind": "OUTPUT", "typeRef": "BOOL", "parameters": {"variable": "PUMP_ON"}}
	      ]
	    }
	  ]
	}`
	opFBD := op(map[string]any{
		"op": "upsertObject",
		"object": map[string]any{
			"objectId": fbdObjectID,
			"kind":     "FUNCTION_BLOCK",
			"name":     "FB_Pump",
			"language": "FBD",
			"source":   fbdSource,
		},
	})

	resFBD, err := saveOps(t, service, projectID, draftID, resST.ETag, "70000000-0000-4000-8000-000000000102", opFBD)
	if err != nil {
		t.Fatalf("saveOps FBD failed: %v", err)
	}

	returnedContentFBD, ok := resFBD.Resource["content"].(map[string]any)
	if !ok {
		t.Fatalf("expected content in resFBD.Resource, got: %T", resFBD.Resource["content"])
	}
	var fbdObj map[string]any
	for _, obj := range collectionOf(returnedContentFBD, "objects") {
		if obj["objectId"] == fbdObjectID {
			fbdObj = obj
			break
		}
	}
	if fbdObj == nil {
		t.Fatalf("FBD object not found in returned content")
	}
	fbdIface, ok := fbdObj["interface"].(map[string]any)
	if !ok {
		t.Fatalf("expected interface in returned FBD object, got: %v", fbdObj["interface"])
	}
	fbdInputs, _ := fbdIface["inputs"].([]any)
	if len(fbdInputs) != 1 || fbdInputs[0].(map[string]any)["name"] != "START_CMD" {
		t.Fatalf("expected input START_CMD in returned FBD object, got: %+v", fbdIface["inputs"])
	}
	fbdOutputs, _ := fbdIface["outputs"].([]any)
	if len(fbdOutputs) != 1 || fbdOutputs[0].(map[string]any)["name"] != "PUMP_ON" {
		t.Fatalf("expected output PUMP_ON in returned FBD object, got: %+v", fbdIface["outputs"])
	}

	// 3. TEST BẢO VỆ 1: Nội dung LƯU XUỐNG ĐĨA (SQLite) TUYỆT ĐỐI KHÔNG có interface
	snapshot, err := service.store.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("store.GetProject failed: %v", err)
	}
	var diskDoc map[string]any
	if err := json.Unmarshal(snapshot.Draft.ContentJSON, &diskDoc); err != nil {
		t.Fatalf("unmarshal disk draft failed: %v", err)
	}
	for _, obj := range collectionOf(diskDoc, "objects") {
		if iface, hasIface := obj["interface"]; hasIface && iface != nil {
			t.Fatalf("VIOLATION: disk draft object %s must NOT have interface, got: %+v", obj["name"], iface)
		}
	}

	// 4. TEST BẢO VỆ 2: Niêm phong Revision -> revisionPayload TUYỆT ĐỐI KHÔNG có interface
	sealRes, err := service.SealRevision(context.Background(), Actor{ID: testActorID, Role: "admin"}, SealRevisionCommand{
		ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: snapshot.Draft.DraftID,
		Label: "v1.0", Comment: "test seal without interface", IfMatch: resFBD.ETag,
		IdempotencyKey: "70000000-0000-4000-8000-000000000103", CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatalf("SealRevision failed: %v", err)
	}
	revID, _ := sealRes.Resource["revisionId"].(string)
	revSnapshot, err := service.store.GetRevision(context.Background(), revID)
	if err != nil {
		t.Fatalf("store.GetRevision failed: %v", err)
	}
	for _, obj := range revSnapshot.Objects {
		var payload map[string]any
		if err := json.Unmarshal(obj.PayloadJSON, &payload); err != nil {
			t.Fatalf("unmarshal revision object payload failed: %v", err)
		}
		if iface, hasIface := payload["interface"]; hasIface && iface != nil {
			t.Fatalf("VIOLATION: revision object payload %s must NOT have interface, got: %+v", obj.ObjectID, iface)
		}
	}
	for _, pou := range revSnapshot.POUObjects {
		if string(pou.InterfaceJSON) != `{"ports":[]}` {
			t.Fatalf("VIOLATION: revision pou object %s must NOT have inferred interface, got: %s", pou.Name, string(pou.InterfaceJSON))
		}
	}
}

func TestGetProject_EnrichesReturnedDraftInterface(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	stObjectID := objectUUID(20)

	stSource := "FUNCTION_BLOCK FB_Sensor\nVAR_INPUT\n    temp : REAL;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
	opST := op(map[string]any{
		"op": "upsertObject",
		"object": map[string]any{
			"objectId": stObjectID,
			"kind":     "FUNCTION_BLOCK",
			"name":     "FB_Sensor",
			"language": "ST",
			"source":   stSource,
		},
	})

	_, err := saveOps(t, service, projectID, draftID, etag, "70000000-0000-4000-8000-000000000201", opST)
	if err != nil {
		t.Fatalf("saveOps failed: %v", err)
	}

	view, err := service.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetProject failed: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(view.DraftContentJSON, &doc); err != nil {
		t.Fatalf("unmarshal DraftContentJSON failed: %v", err)
	}
	objects := collectionOf(doc, "objects")
	if len(objects) != 1 {
		t.Fatalf("expected 1 object, got %d", len(objects))
	}
	iface, ok := objects[0]["interface"].(map[string]any)
	if !ok {
		t.Fatalf("expected interface in GetProject DraftContentJSON, got: %v", objects[0]["interface"])
	}
	inputs, _ := iface["inputs"].([]any)
	if len(inputs) != 1 || inputs[0].(map[string]any)["name"] != "temp" {
		t.Fatalf("expected input temp in GetProject DraftContentJSON, got: %+v", iface)
	}
}
