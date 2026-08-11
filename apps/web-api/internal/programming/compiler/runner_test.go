package compiler

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestProcessRunnerKillsWholeProcessGroupOnTimeout(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "child.pid")
	script := filepath.Join(dir, "compiler-timeout")
	body := fmt.Sprintf("#!/bin/sh\n/usr/bin/sleep 30 &\necho $! > %s\nwait\n", pidPath)
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: filepath.Join(dir, "scratch"), Timeout: time.Second}
	_, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111", Language: "ST", Source: []byte("PROGRAM P END_PROGRAM")})
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("timeout err=%v", err)
	}
	raw, err := os.ReadFile(pidPath)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		err = syscall.Kill(pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("process con %d chưa được reap/kill: %v", pid, err)
}

func TestProcessRunnerFailsClosedOnOOMLikeSignalAndCleansScratch(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "compiler-oom-signal")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nkill -KILL $$\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	scratch := filepath.Join(dir, "scratch")
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: scratch, Timeout: 2 * time.Second}
	_, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111",
		Language: "ST", Source: []byte("PROGRAM P END_PROGRAM")})
	if !errors.Is(err, ErrCrashed) {
		t.Fatalf("OOM-like signal err=%v", err)
	}
	entries, readErr := os.ReadDir(scratch)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("scratch còn dữ liệu sau crash: %v", entries)
	}
}

func TestProcessRunnerBoundsOutputAndDoesNotLeakStderr(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "compiler-output-abuse")
	body := "#!/bin/sh\nprintf 'AUDIT_SECRET_SENTINEL' >&2\nhead -c 2097153 /dev/zero\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: filepath.Join(dir, "scratch"), Timeout: 2 * time.Second}
	_, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111",
		Language: "ST", Source: []byte("PROGRAM P END_PROGRAM")})
	if !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("stdout one-over err=%v", err)
	}
	if strings.Contains(err.Error(), "AUDIT_SECRET_SENTINEL") {
		t.Fatalf("compiler error làm lộ stderr: %v", err)
	}
}

func TestProcessRunnerRejectsSourceOneOverBeforeSpawn(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "spawned")
	script := filepath.Join(dir, "compiler-marker")
	if err := os.WriteFile(script, []byte("#!/bin/sh\ntouch "+marker+"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: filepath.Join(dir, "scratch"), Timeout: 2 * time.Second}
	_, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111",
		Language: "ST", Source: []byte(strings.Repeat("x", 65537))})
	if err == nil {
		t.Fatal("source one-over đã được chấp nhận")
	}
	if _, statErr := os.Stat(marker); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("compiler đã bị spawn trước khi reject: %v", statErr)
	}
}

func TestProcessRunnerWithOfficialCompiler(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("sandbox compiler chỉ hỗ trợ Linux")
	}
	_, current, _, _ := runtime.Caller(0)
	repo := filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", "..", ".."))
	binary := filepath.Join(repo, "build", "fw", "core", "mkddc-st-compile")
	if _, err := os.Stat(binary); err != nil {
		t.Skip("hãy build CMake gate trước Go integration")
	}
	runner := ProcessRunner{BinaryPath: binary, ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
	result, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111", Language: "ST",
		Source: []byte("PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n")})
	if err != nil || !result.OK || len(result.Artifact) == 0 || len(result.Manifest) == 0 || result.TargetABI != 3841 {
		t.Fatalf("official compile=%+v err=%v", result, err)
	}
}
