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
	// T59-004: 20 -> 26 public code (POU/library/signal/output owner/enable/
	// PID review). Con số là ảnh chụp có chủ ý để catalog không lớn lên lặng lẽ.
	if len(errorMetadataByCode) != 30 {
		t.Fatalf("public error count = %d; want 30", len(errorMetadataByCode))
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

// Sáu miền mới phải ánh xạ về đúng mã riêng, không gộp vào một mã chung.
func TestNewDomainDetailCodesMapToOwnPublicCode(t *testing.T) {
	cases := map[string]struct {
		component string
		detail    string
		want      ErrorCode
	}{
		"pou-kind":      {"compiler", "ST-POU-002", ErrPouKind},
		"pou-recursion": {"compiler", "ST-POU-003", ErrPouRecursion},
		// Vòng phụ thuộc thư viện CHÍNH LÀ đệ quy, không phải chuyện version.
		"library-cycle": {"compiler", "ST-LIB-003", ErrPouRecursion},
		"library-drift": {"compiler", "ST-LIB-002", ErrLibVersion},
		"program-limit": {"compiler", "ST-LIM-009", ErrProgramLimit},
		"signal-dup":    {"compiler", "ST-SIG-001", ErrSignalPublisher},
		"signal-fresh":  {"compiler", "ST-SIG-003", ErrSignalFreshness},
		// Type/unit dùng lại mã sẵn có thay vì mở nhánh công khai thứ hai.
		"signal-type":     {"compiler", "ST-SIG-002", ErrMapType},
		"output-owner":    {"compiler", "ST-OWN-001", ErrOutputOwner},
		"pid-review":      {"compiler", "ST-PID-001", ErrPidReview},
		"enable-not-comm": {"st-control-api", "API-E-008", ErrEnableNotCommissioned},
		"program-state":   {"st-control-api", "API-E-009", ErrProgramState},
	}
	for name, item := range cases {
		if got := MapComponentError(item.component, item.detail); got != item.want {
			t.Fatalf("%s: %s/%s = %s; want %s", name, item.component, item.detail, got, item.want)
		}
	}
	// Mã cùng họ nhưng chưa khai vẫn fail-safe, không đoán sang miền khác.
	for _, detail := range []string{"ST-POU-099", "ST-LIB-099", "ST-SIG-099"} {
		if got := MapComponentError("compiler", detail); got != ErrUnavailable {
			t.Fatalf("%s = %s; want fail-safe %s", detail, got, ErrUnavailable)
		}
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
