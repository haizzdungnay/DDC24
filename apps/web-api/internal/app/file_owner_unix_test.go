//go:build !windows

package app

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestAtomicConfigReplacementPreservesServiceOwnershipWhenRunAsRoot(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("ownership replacement regression requires root")
	}
	path := filepath.Join(t.TempDir(), "historian.conf")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	const serviceID = 65534
	if err := os.Chown(path, serviceID, serviceID); err != nil {
		t.Skipf("test environment cannot chown fixture: %v", err)
	}
	if err := writeConfigFileAtomicStrict(path, []byte("new\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatal("file ownership metadata is unavailable")
	}
	if stat.Uid != serviceID || stat.Gid != serviceID {
		t.Fatalf("replacement owner uid=%d gid=%d, want %d:%d", stat.Uid, stat.Gid, serviceID, serviceID)
	}
}
