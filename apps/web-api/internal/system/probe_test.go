package system

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestProcessAlive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.pid")
	if err := os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatal(err)
	}
	if !ProcessAlive(path) {
		t.Fatal("process hiện tại không được nhận diện")
	}
	if ProcessAlive(filepath.Join(t.TempDir(), "missing.pid")) {
		t.Fatal("PID file thiếu được nhận diện là alive")
	}
}
