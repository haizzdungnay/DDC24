package hmi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mkddc-web/internal/auth"
)

func TestAuditStorePersistsAndFailsClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hmi-audit.jsonl")
	store := NewAuditStore(path)
	if err := store.Append(AuditRecord{RequestID: "req-1", Actor: "operator", Role: auth.RoleOperator, Action: "override", Result: "accepted", ReasonCode: "OK"}); err != nil {
		t.Fatalf("Append: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), `"requestId":"req-1"`) {
		t.Fatalf("audit = %q/%v", data, err)
	}
	store.Path = "/proc/mkddc-hmi-audit-denied.jsonl"
	if err := store.Append(AuditRecord{}); err == nil {
		t.Fatal("audit store không fail-closed khi persistence lỗi")
	}
}
