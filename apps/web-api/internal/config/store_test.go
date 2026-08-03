package config

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileAtomicAndReadJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "device.conf")
	if err := WriteFileAtomicStrict(path, []byte("{\"revision\":4}\n"), 0o600); err != nil {
		t.Fatalf("WriteFileAtomicStrict: %v", err)
	}
	var got struct {
		Revision int `json:"revision"`
	}
	if err := ReadJSON(path, &got); err != nil {
		t.Fatalf("ReadJSON: %v", err)
	}
	if got.Revision != 4 {
		t.Fatalf("revision = %d", got.Revision)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("perm = %o", info.Mode().Perm())
	}
}

func TestReadJSONMissing(t *testing.T) {
	var value any
	if err := ReadJSON(filepath.Join(t.TempDir(), "missing.conf"), &value); !errors.Is(err, ErrMissing) {
		t.Fatalf("err = %v", err)
	}
}
