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
