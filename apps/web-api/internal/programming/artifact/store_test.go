package artifact

import (
	"crypto/sha256"
	"os"
	"path/filepath"
	"testing"
)

func TestContentAddressedPutReadBackDedupAndSymlinkReject(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	value := []byte("deterministic-mkddc-artifact")
	digest := sha256.Sum256(value)
	first, err := store.Put(digest, value)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Put(digest, value)
	if err != nil || first != second {
		t.Fatalf("dedup=%q/%q err=%v", first, second, err)
	}
	if err := store.Verify(first, digest, int64(len(value))); err != nil {
		t.Fatal(err)
	}
	if err := store.Verify("../escape", digest, int64(len(value))); err == nil {
		t.Fatal("path traversal không bị chặn")
	}

	target := t.TempDir()
	link := filepath.Join(t.TempDir(), "artifact-link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(link); err == nil {
		t.Fatal("artifact root symlink không bị chặn")
	}
}

func TestMaterializedStagingCanBeReclaimedWithoutRecursiveDelete(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(filepath.Join(root, "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	value := []byte("candidate-for-idempotency-race")
	digest := sha256.Sum256(value)
	relative, err := store.Put(digest, value)
	if err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(root, "staging")
	operationID := "44444444-4444-4444-8444-444444444444"
	locator, err := store.MaterializeStaging(staging, operationID, relative, digest, int64(len(value)))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RemoveStaging(staging, operationID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(locator); !os.IsNotExist(err) {
		t.Fatalf("candidate staging chưa được thu hồi: %v", err)
	}
	if err := store.Verify(relative, digest, int64(len(value))); err != nil {
		t.Fatalf("thu hồi staging làm hỏng content-addressed artifact: %v", err)
	}
	target := filepath.Join(root, "outside")
	if err := os.Mkdir(target, 0o750); err != nil {
		t.Fatal(err)
	}
	targetCandidate := filepath.Join(target, "candidate.mkddcir")
	if err := os.WriteFile(targetCandidate, []byte("must-survive"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(staging, "symlink-operation")); err != nil {
		t.Fatal(err)
	}
	if err := store.RemoveStaging(staging, "symlink-operation"); err == nil {
		t.Fatal("cleanup staging đã follow symlink directory")
	}
	if _, err := os.Stat(targetCandidate); err != nil {
		t.Fatalf("cleanup staging đã đụng file ngoài root: %v", err)
	}
}
