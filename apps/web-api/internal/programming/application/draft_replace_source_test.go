package application

import (
	"encoding/json"
	"errors"
	"testing"
)

// U-15 (REC-DDC-FIELD-USE-20260927) — sửa mã một POU qua API không được kéo
// theo mất biến và binding. `replaceProgramSource` chỉ đổi `language`/`source`;
// định danh là `objectId` theo hợp đồng PGM-02, `programId` là alias cũ.
func replaceSourceFixture(t *testing.T) (document []byte, objectID string) {
	t.Helper()
	objectID = "70000011-0000-4000-8000-000000000011"
	variableID := "70000012-0000-4000-8000-000000000012"
	draft := newDraftDocumentV2("11111111-1111-4111-8111-111111111111", "U15")
	draft["objects"] = []any{map[string]any{
		"objectId": objectID, "kind": "PROGRAM", "name": "PRG_U15",
		"language": "ST", "source": "PROGRAM PRG_U15\nEND_PROGRAM\n",
		"interface": map[string]any{"inputs": []any{}, "outputs": []any{}},
		"locals": []any{map[string]any{
			"variableId": variableID, "programId": objectID, "name": "Relay1",
			"type": "BOOL", "class": "OUTPUT", "retain": false,
		}},
	}}
	draft["programs"] = []any{map[string]any{
		"programId": objectID, "objectId": objectID, "periodMs": float64(1000),
	}}
	raw, err := json.Marshal(draft)
	if err != nil {
		t.Fatal(err)
	}
	return raw, objectID
}

func TestReplaceProgramSourceKeepsLocalsAndInterface(t *testing.T) {
	const newSource = "PROGRAM PRG_U15\nRelay1 := TRUE;\nEND_PROGRAM\n"
	for _, identityField := range []string{"objectId", "programId"} {
		t.Run(identityField, func(t *testing.T) {
			before, objectID := replaceSourceFixture(t)
			result, err := applyDraftOperations(before, []json.RawMessage{op(map[string]any{
				"op": "replaceProgramSource", identityField: objectID, "language": "ST", "source": newSource,
			})})
			if err != nil {
				t.Fatalf("replaceProgramSource theo %s: %v", identityField, err)
			}
			var after map[string]any
			if err := json.Unmarshal(result, &after); err != nil {
				t.Fatal(err)
			}
			object := after["objects"].([]any)[0].(map[string]any)
			if object["source"] != newSource {
				t.Fatalf("source không đổi: %v", object["source"])
			}
			locals, _ := object["locals"].([]any)
			if len(locals) != 1 || locals[0].(map[string]any)["name"] != "Relay1" {
				t.Fatalf("mất biến cục bộ khi chỉ sửa mã: %v", object["locals"])
			}
			if _, ok := object["interface"]; !ok {
				t.Fatal("mất interface khi chỉ sửa mã")
			}
		})
	}
}

func TestReplaceProgramSourceRejectsAmbiguousOrMissingIdentity(t *testing.T) {
	before, objectID := replaceSourceFixture(t)
	cases := map[string]map[string]any{
		"cả objectId lẫn programId": {"op": "replaceProgramSource", "objectId": objectID, "programId": objectID, "language": "ST", "source": "PROGRAM P\nEND_PROGRAM\n"},
		"thiếu định danh":           {"op": "replaceProgramSource", "language": "ST", "source": "PROGRAM P\nEND_PROGRAM\n"},
		"object không tồn tại":      {"op": "replaceProgramSource", "objectId": "70000099-0000-4000-8000-000000000099", "language": "ST", "source": "PROGRAM P\nEND_PROGRAM\n"},
		"ngôn ngữ lạ":               {"op": "replaceProgramSource", "objectId": objectID, "language": "LD", "source": "x"},
	}
	for name, operation := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := applyDraftOperations(before, []json.RawMessage{op(operation)}); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("phải từ chối, nhận %v", err)
			}
		})
	}
}
