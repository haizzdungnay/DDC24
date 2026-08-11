package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestErrorCatalogGeneratedSurface(t *testing.T) {
	if len(errorMetadataByCode) != 19 {
		t.Fatalf("public error count = %d; want 19", len(errorMetadataByCode))
	}
	if got := MapComponentError("artifact-loader", "IR-E-004"); got != ErrTarget {
		t.Fatalf("IR-E-004 = %s; want %s", got, ErrTarget)
	}
	if got := MapComponentError("compiler", "ST-IOMAP-003"); got != ErrMapType {
		t.Fatalf("ST-IOMAP-003 = %s; want %s", got, ErrMapType)
	}
	if got := MapComponentError("core-ipc", "IPC-REQUEST-ID-CONFLICT"); got != ErrOperation {
		t.Fatalf("IPC conflict = %s; want %s", got, ErrOperation)
	}
	if got := MapComponentError("core-ipc", "UNKNOWN-DETAIL"); got != ErrUnavailable {
		t.Fatalf("unknown detail = %s; want fail-safe %s", got, ErrUnavailable)
	}
	if !IsRetryable(ErrUnavailable) || IsRetryable(ErrCommission) {
		t.Fatal("retryable metadata mismatch")
	}
}

func TestErrorCatalogHashMatchesContract(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	catalogPath := filepath.Join(filepath.Dir(currentFile), "../../../../../contracts/programming/error_catalog_v1.json")
	raw, err := os.ReadFile(catalogPath)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if got := hex.EncodeToString(digest[:]); got != ErrorCatalogSHA256 {
		t.Fatalf("catalog SHA-256 = %s; generated = %s", got, ErrorCatalogSHA256)
	}
}

func TestNormalizePublicErrorDropsSensitiveAndUnknownData(t *testing.T) {
	public := PublicError{
		Code:       ErrRequest,
		MessageKey: "attacker.controlled.message",
		Args: map[string]any{
			"actual":   "2.0",
			"secret":   "token-value",
			"path":     "/etc/shadow",
			"maxBytes": math.Inf(1),
		},
		Field:     "/etc/shadow",
		Retryable: true,
	}
	normalized := NormalizePublicError(public)
	if normalized.MessageKey != "programming.error.request" || normalized.Retryable {
		t.Fatalf("metadata not canonical: %+v", normalized)
	}
	if normalized.Field != "" {
		t.Fatalf("sensitive field leaked: %q", normalized.Field)
	}
	if len(normalized.Args) != 1 || normalized.Args["actual"] != "2.0" {
		t.Fatalf("args not allowlisted: %#v", normalized.Args)
	}

	unknown := NormalizePublicError(PublicError{Code: "PRG-ERR-UNKNOWN-999"})
	if unknown.Code != ErrUnavailable || unknown.MessageKey != MessageKeyFor(ErrUnavailable) {
		t.Fatalf("unknown public code did not fail safe: %+v", unknown)
	}
	if unknown.KeepsRunningRevision {
		t.Fatal("unknown public code must not claim the running revision is preserved")
	}
}
