// Command mkddc-programming-e2e-seed chỉ dựng fixture Draft v1 cho lane
// Playwright real-backend. Public API luôn tạo Draft v2 nên không có cách hợp
// lệ nào khác để tái hiện upgrade của dữ liệu đã tồn tại từ bản cũ.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	programmingapplication "mkddc-web/internal/programming/application"
	programmingstore "mkddc-web/internal/programming/store"
)

func main() {
	databasePath := flag.String("db", "", "đường dẫn Programming DB tạm")
	backupDir := flag.String("backup-dir", "", "thư mục backup tạm")
	flag.Parse()
	if *databasePath == "" {
		fmt.Fprintln(os.Stderr, "--db là bắt buộc")
		os.Exit(2)
	}
	if err := seed(context.Background(), *databasePath, *backupDir); err != nil {
		fmt.Fprintf(os.Stderr, "seed Draft v1: %v\n", err)
		os.Exit(1)
	}
}

func seed(ctx context.Context, databasePath, backupDir string) error {
	store, err := programmingstore.OpenProgrammingStore(ctx, programmingstore.Options{
		Path: databasePath, BackupDir: backupDir,
	})
	if err != nil {
		return err
	}
	defer store.Close()
	service, err := programmingapplication.NewProjectService(store, []byte("iss-pgm03-07-e2e-cursor-secret"))
	if err != nil {
		return err
	}
	actor := programmingapplication.Actor{ID: "70111111-1111-4111-8111-111111111111", Role: "admin"}
	created, err := service.CreateProject(ctx, actor, programmingapplication.CreateProjectCommand{
		SchemaVersion: "1.0", Name: "ISS-PGM03-07 legacy migration",
		Description:    "Fixture v1 cho Playwright real-backend",
		IdempotencyKey: "70222222-2222-4222-8222-222222222222",
		CorrelationID:  "70333333-3333-4333-8333-333333333333",
	})
	if err != nil {
		return err
	}
	projectID, okProject := created.Resource["projectId"].(string)
	draftID, okDraft := created.Resource["draftRevisionId"].(string)
	if !okProject || !okDraft {
		return fmt.Errorf("CreateProject không trả identity")
	}
	content := map[string]any{
		"schemaVersion": 1,
		"project":       map[string]any{"projectId": projectID, "name": "ISS-PGM03-07 legacy migration", "functionalTags": []string{}},
		"programs": []any{map[string]any{
			"programId": "70444444-4444-4444-8444-444444444444", "name": "LEGACY_MAP_SOURCE",
			"kind": "PROGRAM", "language": "ST",
			"document": "PROGRAM LEGACY_MAP_SOURCE\nVAR_INPUT\n  SupplyTemp : REAL;\n  PumpReady : BOOL;\nEND_VAR\nEND_PROGRAM\n",
		}},
		"variables": []any{
			map[string]any{
				"variableId": "70555555-5555-4555-8555-555555555555", "programId": "70444444-4444-4444-8444-444444444444",
				"name": "SupplyTemp", "type": "REAL", "class": "INPUT", "initialValue": nil, "retain": false,
			},
			map[string]any{
				"variableId": "70555555-5555-4555-8555-555555555556", "programId": "70444444-4444-4444-8444-444444444444",
				"name": "PumpReady", "type": "BOOL", "class": "INPUT", "initialValue": nil, "retain": false,
			},
		},
		"bindings": []any{
			map[string]any{
				"bindingId": "70666666-6666-4666-8666-666666666666", "variableId": "70555555-5555-4555-8555-555555555555",
				"point":     map[string]any{"category": "LOCAL", "pointId": "UI-01"},
				"direction": "READ", "dataType": "REAL", "unit": "V", "writable": false, "qualityPolicy": "REQUIRE_GOOD",
			},
			map[string]any{
				"bindingId": "70666666-6666-4666-8666-666666666667", "variableId": "70555555-5555-4555-8555-555555555556",
				"point":     map[string]any{"category": "MB_RTU", "deviceId": "bus-1-slave-4", "pointId": "PUMP_CMD"},
				"direction": "READ", "dataType": "BOOL", "writable": false, "qualityPolicy": "REQUIRE_GOOD",
			},
		},
		"task": map[string]any{
			"taskId": "70777777-7777-4777-8777-777777777777", "periodMs": 1000,
			"programOrder": []string{"70444444-4444-4444-8444-444444444444"},
		},
		"library": map[string]any{"profile": "CORE_REVA", "version": "1"},
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return err
	}
	key := sha256.Sum256([]byte("iss-pgm03-07-seed-key"))
	request := sha256.Sum256([]byte("iss-pgm03-07-seed-request"))
	_, err = store.SaveDraft(ctx, programmingstore.SaveDraftParams{
		DraftID: draftID, ExpectedETag: 1, ContentJSON: raw,
		ActorID: actor.ID, Role: actor.Role, AuditID: "70888888-8888-4888-8888-888888888888",
		CorrelationID: "70999999-9999-4999-8999-999999999999", At: time.Now().UTC(),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	return err
}
