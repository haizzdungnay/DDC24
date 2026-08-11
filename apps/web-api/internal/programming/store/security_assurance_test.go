package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestAuditRejectsSecretAliasesWithoutPartialRecord(t *testing.T) {
	keys := []string{
		"password", "passphrase", "token", "api_token", "access-token", "refresh.token",
		"Authorization", "Cookie", "credential", "credentials", "client_secret", "secretValue",
		"private_key", "source", "sourceCode", "document", "payload", "bundleBase64",
		"stack", "artifact", "artifact_bytes", "binary", "host_path",
	}
	for index, key := range keys {
		t.Run(key, func(t *testing.T) {
			store := openTestStore(t)
			details, err := json.Marshal(map[string]any{"safe": map[string]any{key: "sentinel-do-not-persist"}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = store.CommitAudit(context.Background(), AuditInput{
				AuditID:         "80000000-0000-4000-8000-" + fmt.Sprintf("%012d", index+1),
				ActorID:         actorID,
				Role:            role,
				Action:          "SECURITY_ASSURANCE",
				TargetType:      "CONTROLLER",
				TargetID:        "local",
				OccurredAtUTCMS: fixedNow.UnixMilli(),
				ResultCode:      "REJECTED",
				CorrelationID:   correlationID,
				DetailsJSON:     details,
			})
			if err == nil {
				t.Fatalf("audit đã nhận field nhạy cảm %q", key)
			}
			var count int
			if queryErr := store.db.QueryRow(`SELECT count(*) FROM audit_records`).Scan(&count); queryErr != nil || count != 0 {
				t.Fatalf("reject để lại audit count=%d err=%v", count, queryErr)
			}
		})
	}
}

func TestBundleImportAuditStoresOnlyProvenanceMetadata(t *testing.T) {
	store := openTestStore(t)
	keyHash, requestHash := mutationIdentity("security-bundle-import")
	bundleDigest := sha256.Sum256([]byte("bounded-bundle-fixture"))
	const sourceSentinel = "PROGRAM SECRET_SENTINEL PASSWORD_TOKEN END_PROGRAM"
	_, _, err := store.ImportProject(context.Background(), ImportProjectParams{
		ProjectID:        projectID,
		DraftID:          draftID,
		Name:             "Bundle security fixture",
		Description:      "Không đưa source vào audit",
		ContentJSON:      []byte(`{"schemaVersion":1,"programs":[{"document":"` + sourceSentinel + `"}]}`),
		BundleSHA256:     hex.EncodeToString(bundleDigest[:]),
		SourceProjectID:  "55555555-5555-4555-8555-555555555555",
		SourceRevisionID: "66666666-6666-4666-8666-666666666666",
		ActorID:          actorID, Role: role, AuditID: "88888888-8888-4888-8888-888888888888",
		CorrelationID: correlationID, At: fixedNow,
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	var details []byte
	if err := store.db.QueryRow(`SELECT details_json FROM audit_records WHERE action='BUNDLE_IMPORT'`).Scan(&details); err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(details))
	if strings.Contains(lower, strings.ToLower(sourceSentinel)) || strings.Contains(lower, "document") || strings.Contains(lower, "program") {
		t.Fatalf("audit làm lộ source: %s", details)
	}
	for _, expected := range []string{"bundleSha256", "byteSize", "draftId", "sourceProjectId", "sourceRevisionId"} {
		if !strings.Contains(string(details), expected) {
			t.Fatalf("audit thiếu provenance %q: %s", expected, details)
		}
	}
	if err := store.VerifyAuditChain(context.Background()); err != nil {
		t.Fatal(err)
	}
}
