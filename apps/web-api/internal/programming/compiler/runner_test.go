package compiler

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"mkddc-web/internal/programming/domain"
)

// testSigningKeyPath — T59-607: profile đòi `SIGNATURE_REQUIRED`, nên mọi
// ProcessRunner trong test phải có khoá ký như đường production. Khoá sinh từ
// seed cố định để test tất định, và chỉ sống trong thư mục tạm của test.
func testSigningKeyPath(t *testing.T) string {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(0xC0 + i)
	}
	secret := ed25519.NewKeyFromSeed(seed)
	path := filepath.Join(t.TempDir(), "device.key")
	if err := os.WriteFile(path, []byte(hex.EncodeToString(secret)), 0o600); err != nil {
		t.Fatalf("không ghi được khoá test: %v", err)
	}
	return path
}

// T59-607 — worker không có khoá thì mọi artifact nó sinh ra đều bị Core từ
// chối. Lỗi phải nổ ở BIÊN cấu hình, không phải ở bước Commission xa phía sau.
func TestProcessRunnerFailsClosedWithoutSigningKey(t *testing.T) {
	if domain.ProfileIntegrityMode != "SIGNATURE_REQUIRED" {
		t.Skip("profile hiện không đòi chữ ký")
	}
	runner := ProcessRunner{BinaryPath: "/bin/true", ScratchRoot: t.TempDir(), Timeout: time.Second}
	_, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111",
		Language: "ST", Source: []byte("PROGRAM P\nEND_PROGRAM\n")})
	if err == nil || !strings.Contains(err.Error(), "PROGRAMMING_SIGNING_KEY") {
		t.Fatalf("phải từ chối vì thiếu khoá ký, nhận: %v", err)
	}
}

func TestProcessRunnerKillsWholeProcessGroupOnTimeout(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "child.pid")
	script := filepath.Join(dir, "compiler-timeout")
	body := fmt.Sprintf("#!/bin/sh\n/usr/bin/sleep 30 &\necho $! > %s\nwait\n", pidPath)
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: filepath.Join(dir, "scratch"), Timeout: time.Second, SigningKeyPath: testSigningKeyPath(t)}
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
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		dead, state := processIsDead(pid)
		if dead {
			return
		}
		_ = state
		time.Sleep(10 * time.Millisecond)
	}
	_, state := processIsDead(pid)
	t.Fatalf("process con %d vẫn đang chạy (state %q) — process group chưa bị giết", pid, state)
}

// processIsDead cho biết pid đã NGỪNG CHẠY chưa, và trả kèm state để thông
// điệp lỗi nói được nó đang ở đâu.
//
// Vì sao không dùng `syscall.Kill(pid, 0) == ESRCH` như bản trước: `kill(pid,0)`
// vẫn THÀNH CÔNG trên một zombie, vì ô pid còn tồn tại cho tới khi có ai đó
// reap. Bản trước vì thế đo nhầm "đã được reap" thay vì "đã bị giết" — hai
// việc của hai chủ thể khác nhau. ProcessRunner chịu trách nhiệm GIẾT cả
// process group; REAP một tiến trình mồ côi là việc của init.
//
// Trong container CI, PID 1 không phải một init biết reap, nên process con
// mồ côi nằm lại ở trạng thái `Z` vô thời hạn và test đỏ trong khi sản phẩm
// làm đúng. Đo `/proc/<pid>/stat` phân biệt được `S` (còn sống — hỏng thật)
// với `Z`/không còn (đã chết — đạt), tức đúng thứ ProcessRunner hứa.
func processIsDead(pid int) (bool, string) {
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return true, "gone" // không còn ô /proc: đã bị reap xong
	}
	// Trường `comm` nằm trong ngoặc và có thể chứa cả dấu cách lẫn ')',
	// nên state là token đầu tiên SAU dấu ')' cuối cùng.
	closing := strings.LastIndex(string(raw), ")")
	if closing < 0 || closing+2 >= len(raw) {
		return true, "unparsable"
	}
	fields := strings.Fields(string(raw)[closing+1:])
	if len(fields) == 0 {
		return true, "unparsable"
	}
	state := fields[0]
	return state == "Z" || state == "X" || state == "x", state
}

func TestProcessRunnerFailsClosedOnOOMLikeSignalAndCleansScratch(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "compiler-oom-signal")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nkill -KILL $$\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	scratch := filepath.Join(dir, "scratch")
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: scratch, Timeout: 2 * time.Second, SigningKeyPath: testSigningKeyPath(t)}
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
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: filepath.Join(dir, "scratch"), Timeout: 2 * time.Second, SigningKeyPath: testSigningKeyPath(t)}
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
	runner := ProcessRunner{BinaryPath: script, ScratchRoot: filepath.Join(dir, "scratch"), Timeout: 2 * time.Second, SigningKeyPath: testSigningKeyPath(t)}
	_, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111",
		Language: "ST", Source: []byte(strings.Repeat("x", 65537))})
	if err == nil {
		t.Fatal("source one-over đã được chấp nhận")
	}
	if _, statErr := os.Stat(marker); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("compiler đã bị spawn trước khi reject: %v", statErr)
	}
}

// officialCompilerBinary — T59-607: chọn binary compiler THẬT và từ chối một
// binary đã lạc hậu so với contract.
//
// Cổng đầy đủ luôn truyền MKDDC_ST_COMPILER_BINARY từ chính build cpp-full.
// Khi chạy `go test` độc lập, ưu tiên build/fw vì đó là build canonical theo
// AGENTS.md; build/verify chỉ là fallback. Vẫn so profileSha256 và cổng release
// đặt MKDDC_REQUIRE_PRODUCTION_TOOLS=1 nên không có đường SKIP giả xanh.
func officialCompilerBinary(t *testing.T) string {
	t.Helper()
	_, current, _, _ := runtime.Caller(0)
	repo := filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", "..", ".."))
	candidates := []string{}
	if explicit := os.Getenv("MKDDC_ST_COMPILER_BINARY"); explicit != "" {
		candidates = append(candidates, explicit)
	} else {
		candidates = append(candidates,
			filepath.Join(repo, "build", "fw", "core", "mkddc-st-compile"),
			filepath.Join(repo, "build", "verify", "cpp-full", "core", "mkddc-st-compile"))
	}
	problems := make([]string, 0, len(candidates))
	for _, binary := range candidates {
		if info, err := os.Stat(binary); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", binary, err))
			continue
		} else if info.Mode().Perm()&0o111 == 0 {
			problems = append(problems, fmt.Sprintf("%s: không executable", binary))
			continue
		}
		out, err := exec.Command(binary, "--version").Output()
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: --version: %v", binary, err))
			continue
		}
		if strings.Contains(string(out), "profile_sha256="+domain.ProfileSHA256) {
			return binary
		}
		problems = append(problems, fmt.Sprintf("%s: profile không khớp %s (%s)",
			binary, domain.ProfileSHA256[:12], strings.TrimSpace(string(out))))
	}
	message := "không có compiler production đúng profile: " + strings.Join(problems, "; ")
	if os.Getenv("MKDDC_REQUIRE_PRODUCTION_TOOLS") == "1" {
		t.Fatal(message)
	}
	t.Skip(message + " — chạy cổng cpp trước hoặc đặt MKDDC_ST_COMPILER_BINARY")
	return ""
}

func TestProcessRunnerWithOfficialCompiler(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("sandbox compiler chỉ hỗ trợ Linux")
	}
	binary := officialCompilerBinary(t)
	runner := ProcessRunner{BinaryPath: binary, ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second, SigningKeyPath: testSigningKeyPath(t)}
	result, err := runner.Compile(context.Background(), Input{SourceID: "11111111-1111-4111-8111-111111111111", Language: "ST",
		Source: []byte("PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n")})
	if err != nil || !result.OK || len(result.Artifact) == 0 || len(result.Manifest) == 0 || result.TargetABI != 3841 {
		t.Fatalf("official compile=%+v err=%v", result, err)
	}
	if result.IoBindingCount != 0 {
		t.Fatalf("no io_map sent, IoBindingCount phải =0: %d", result.IoBindingCount)
	}
}

// F-PROG-ASBUILT-013/D-07: kiểm chứng end-to-end với binary thật rằng
// --io-map-in làm artifact THẬT SỰ mang binding (SEC_IO_BINDING không rỗng),
// không chỉ tin request đã gửi IoMap — trước bản vá này resolve_io_bindings()
// chưa từng được compilerInput() gọi tới nên io_bindings luôn rỗng dù Mapping
// tab cấu hình đúng đến đâu.
func TestProcessRunnerWithOfficialCompilerResolvesIoMapIntoArtifact(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("sandbox compiler chỉ hỗ trợ Linux")
	}
	binary := officialCompilerBinary(t)
	runner := ProcessRunner{BinaryPath: binary, ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second, SigningKeyPath: testSigningKeyPath(t)}
	source := []byte("PROGRAM P\nVAR_INPUT SupplyTemp : REAL; END_VAR\nVAR_OUTPUT FanEnable : BOOL; END_VAR\n" +
		"FanEnable := SupplyTemp > 25.0;\nEND_PROGRAM\n")
	ioMap := []IoMapEntry{
		{Variable: "SupplyTemp", Direction: "input", PointID: "UI-01", Type: "REAL", Category: "LOCAL", Writable: false},
		{Variable: "FanEnable", Direction: "output", PointID: "DO-01", Type: "BOOL", Category: "LOCAL", Writable: true},
	}
	result, err := runner.Compile(context.Background(), Input{SourceID: "22222222-2222-4222-8222-222222222222",
		Language: "ST", Source: source, IoMap: ioMap})
	if err != nil || !result.OK || result.IoBindingCount != 2 {
		t.Fatalf("compile với io_map=%+v err=%v", result, err)
	}

	// Tái hiện đúng bug thật (AlarmHigh BOOL -> UI-09 read-only): compile phải
	// FAILED với diagnostic ST-IOMAP-002, không phải OK với binding bị bỏ qua
	// lặng lẽ.
	badIoMap := []IoMapEntry{
		{Variable: "FanEnable", Direction: "output", PointID: "UI-01", Type: "BOOL", Category: "LOCAL", Writable: false},
	}
	badResult, err := runner.Compile(context.Background(), Input{SourceID: "22222222-2222-4222-8222-222222222222",
		Language: "ST", Source: source, IoMap: badIoMap})
	if err != nil {
		t.Fatalf("io_map hỏng phải trả về Result{OK:false}, không phải error worker: %v", err)
	}
	if badResult.OK || len(badResult.Diagnostics) == 0 || badResult.Diagnostics[0].Code != "ST-IOMAP-002" {
		t.Fatalf("io_map hỏng kết quả=%+v", badResult)
	}
}

func TestProcessRunnerWithOfficialCompilerEmitsPublishedSignalRefs(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("sandbox compiler chỉ hỗ trợ Linux")
	}
	binary := officialCompilerBinary(t)
	runner := ProcessRunner{BinaryPath: binary, ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second, SigningKeyPath: testSigningKeyPath(t)}
	contracts := []PublishedSignalContract{{
		Name: "SHARED_TEMP", Type: "REAL", PublisherProgramID: "P_pub",
	}}
	result, err := runner.Compile(context.Background(), Input{
		SourceID:  "33333333-3333-4333-8333-333333333333",
		ProgramID: "P_pub",
		Language:  "ST",
		Source: []byte("PROGRAM Producer\nVAR value : REAL; END_VAR\n" +
			"value := 25.0;\nSIGNAL_PUBLISH(SHARED_TEMP, value);\nEND_PROGRAM\n"),
		PublishedSignals: contracts,
	})
	if err != nil || !result.OK {
		t.Fatalf("compile Published Signal=%+v err=%v", result, err)
	}
	if len(result.SignalRefs) != 1 || result.SignalRefs[0].Name != "SHARED_TEMP" ||
		result.SignalRefs[0].Type != "REAL" || result.SignalRefs[0].Read || !result.SignalRefs[0].Publish {
		t.Fatalf("signalRefs không chứng minh actual SIGNAL_PUBLISH: %+v", result.SignalRefs)
	}

	bad, err := runner.Compile(context.Background(), Input{
		SourceID:  "44444444-4444-4444-8444-444444444444",
		ProgramID: "P_other",
		Language:  "ST",
		Source: []byte("PROGRAM Wrong\nSIGNAL_PUBLISH(SHARED_TEMP, 1.0);\n" +
			"END_PROGRAM\n"),
		PublishedSignals: contracts,
	})
	if err != nil {
		t.Fatalf("source publisher sai phải trả Result{OK:false}, không phải worker error: %v", err)
	}
	if bad.OK || len(bad.Diagnostics) == 0 || bad.Diagnostics[0].Code != "ST-SIG-001" {
		t.Fatalf("publisher sai không bị chặn đúng contract: %+v", bad)
	}
}

/* ───────────────────── T63-304: cache, pool, ưu tiên CPU ─────────────────────
 *
 * Compiler giả là CHÍNH test binary này: script bọc gọi lại nó với
 * `-test.run=^TestFakeCompilerHelper$` và biến môi trường riêng (ProcessRunner
 * xoá sạch môi trường của process con, nên script tự đặt). Nhờ vậy compiler giả
 * phát đúng response THÀNH CÔNG mà `validateSuccess` đòi — kể cả hằng profile
 * sinh từ contract — và ghi nhật ký start/end/nice để test đo được số process
 * chạy đồng thời và mức ưu tiên thật của process. */

func TestFakeCompilerHelper(t *testing.T) {
	if os.Getenv("MKDDC_FAKE_COMPILER") != "1" {
		t.Skip("chỉ chạy khi được gọi làm compiler giả")
	}
	args := os.Args
	for index, arg := range args {
		if arg == "--" {
			args = args[index+1:]
			break
		}
	}
	os.Exit(fakeCompilerMain(args))
}

func fakeCompilerMain(args []string) int {
	flags := map[string]string{}
	for index := 0; index < len(args); index++ {
		if args[index] == "--sandbox" {
			continue
		}
		if index+1 < len(args) {
			flags[args[index]] = args[index+1]
			index++
		}
	}
	logLine := func(format string, values ...any) {
		path := os.Getenv("MKDDC_FAKE_LOG")
		if path == "" {
			return
		}
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o600)
		if err != nil {
			return
		}
		_, _ = fmt.Fprintf(file, format+"\n", values...)
		_ = file.Close()
	}
	nice := readOwnNice()
	for deadline := time.Now().Add(500 * time.Millisecond); nice == 0 && time.Now().Before(deadline); nice = readOwnNice() {
		time.Sleep(5 * time.Millisecond)
	}
	logLine("start %d %d %d", time.Now().UnixNano(), os.Getpid(), nice)
	if ms, _ := strconv.Atoi(os.Getenv("MKDDC_FAKE_SLEEP_MS")); ms > 0 {
		time.Sleep(time.Duration(ms) * time.Millisecond)
	}
	defer logLine("end %d %d", time.Now().UnixNano(), os.Getpid())
	source, err := os.ReadFile(flags["--source"])
	if err != nil {
		return 3
	}
	sourceID, language := flags["--source-id"], flags["--language"]
	if os.Getenv("MKDDC_FAKE_MODE") == "diag" {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "diagnostics": []map[string]any{{
			"severity": "ERROR", "code": "ST-SYN-001", "message": "lỗi giả", "sourceId": sourceID, "line": 1, "column": 1, "length": 1}},
			"compilerVersion": "fwsom-st-1.2.0", "artifactSchemaVersion": 1, "targetAbi": domain.ProfileTargetABI})
		logLine("end %d %d", time.Now().UnixNano(), os.Getpid())
		os.Exit(1)
	}
	sourceDigest := sha256.Sum256(source)
	// Artifact phụ thuộc nguồn, có khoá ký hay không, và "phiên bản" compiler
	// giả (đổi script bọc = đổi binary).
	artifact := []byte("FAKE-MKIR:" + hex.EncodeToString(sourceDigest[:]) + ":key=" + strconv.FormatBool(flags["--key"] != "") +
		":build=" + os.Getenv("MKDDC_FAKE_BUILD"))
	artifactDigest := sha256.Sum256(artifact)
	fileHex := hex.EncodeToString(artifactDigest[:])
	signed := domain.ProfileIntegrityMode == "SIGNATURE_REQUIRED"
	manifest := map[string]any{
		"manifestVersion": 1,
		"source":          map[string]any{"sourceId": sourceID, "language": language, "canonicalSha256": hex.EncodeToString(sourceDigest[:])},
		"artifact": map[string]any{"bytes": len(artifact), "fileSha256": fileHex, "integritySha256": fileHex,
			"integrityMode": expectedArtifactIntegrityMode(), "schemaVersion": 1, "signaturePresent": signed},
		"profile":        map[string]any{"code": 1, "id": domain.ProfileID, "sha256": domain.ProfileSHA256, "libraryVersion": domain.ProfileLibraryVersion},
		"target":         map[string]any{"abi": domain.ProfileTargetABI},
		"compiler":       map[string]any{"version": "fwsom-st-1.2.0"},
		"buildKeySha256": fileHex,
	}
	manifestRaw, _ := json.Marshal(manifest)
	if os.WriteFile(flags["--out"], artifact, 0o600) != nil || os.WriteFile(flags["--manifest-out"], manifestRaw, 0o600) != nil {
		return 3
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
		"ok": true, "diagnostics": []any{}, "sourceId": sourceID, "language": language, "symbols": []any{},
		"artifact": base64.StdEncoding.EncodeToString(artifact), "artifactBytes": len(artifact),
		"artifactSha256": base64.StdEncoding.EncodeToString(artifactDigest[:]), "artifactFileSha256": fileHex,
		"artifactIntegritySha256": fileHex, "sourceSha256": hex.EncodeToString(sourceDigest[:]), "buildKeySha256": fileHex,
		"manifest": json.RawMessage(manifestRaw), "ioBindingCount": 0, "compilerVersion": "fwsom-st-1.2.0",
		"artifactSchemaVersion": 1, "compilerProfile": domain.ProfileCode, "profileId": domain.ProfileID,
		"profileSha256": domain.ProfileSHA256, "libraryVersion": domain.ProfileLibraryVersion,
		"integrityMode": expectedArtifactIntegrityMode(), "signaturePresent": signed, "targetAbi": domain.ProfileTargetABI,
		"linkedPous": []any{}, "signalRefs": []any{},
	})
	return 0
}

// readOwnNice đọc trường 19 (nice) của /proc/self/stat.
func readOwnNice() int {
	raw, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return -100
	}
	closing := strings.LastIndex(string(raw), ")")
	fields := strings.Fields(string(raw)[closing+1:])
	if len(fields) < 17 {
		return -100
	}
	nice, _ := strconv.Atoi(fields[16])
	return nice
}

type fakeCompilerOptions struct {
	sleepMS int
	mode    string
	build   string
}

// writeFakeCompiler ghi script bọc compiler giả; trả đường script và đường nhật ký.
func writeFakeCompiler(t *testing.T, dir string, options fakeCompilerOptions) (string, string) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("compiler giả dùng /proc và process group của Linux")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(dir, "fake-compiler.log")
	script := filepath.Join(dir, "fake-compiler")
	body := fmt.Sprintf("#!/bin/sh\nexec /usr/bin/env MKDDC_FAKE_COMPILER=1 MKDDC_FAKE_LOG='%s' MKDDC_FAKE_SLEEP_MS=%d MKDDC_FAKE_MODE='%s' MKDDC_FAKE_BUILD='%s' '%s' -test.run='^TestFakeCompilerHelper$' -- \"$@\"\n",
		logPath, options.sleepMS, options.mode, options.build, exe)
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	return script, logPath
}

type fakeCompilerRun struct {
	pid        int
	start, end int64
	nice       int
}

func readFakeCompilerLog(t *testing.T, path string) []fakeCompilerRun {
	t.Helper()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	runs := map[int]*fakeCompilerRun{}
	order := []int{}
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		at, _ := strconv.ParseInt(fields[1], 10, 64)
		pid, _ := strconv.Atoi(fields[2])
		run, found := runs[pid]
		if !found {
			run = &fakeCompilerRun{pid: pid}
			runs[pid] = run
			order = append(order, pid)
		}
		switch fields[0] {
		case "start":
			run.start = at
			if len(fields) > 3 {
				run.nice, _ = strconv.Atoi(fields[3])
			}
		case "end":
			run.end = at
		}
	}
	out := make([]fakeCompilerRun, 0, len(order))
	for _, pid := range order {
		out = append(out, *runs[pid])
	}
	return out
}

// maxOverlap là số process compiler chạy đồng thời lớn nhất đo từ nhật ký.
func maxOverlap(runs []fakeCompilerRun) int {
	type event struct {
		at    int64
		delta int
	}
	events := make([]event, 0, 2*len(runs))
	for _, run := range runs {
		events = append(events, event{run.start, +1}, event{run.end, -1})
	}
	for i := 1; i < len(events); i++ {
		for j := i; j > 0 && (events[j].at < events[j-1].at || (events[j].at == events[j-1].at && events[j].delta < events[j-1].delta)); j-- {
			events[j], events[j-1] = events[j-1], events[j]
		}
	}
	current, peak := 0, 0
	for _, e := range events {
		current += e.delta
		if current > peak {
			peak = current
		}
	}
	return peak
}

func fakeInput(index int) Input {
	return Input{SourceID: fmt.Sprintf("11111111-1111-4111-8111-%012d", index), Language: "ST",
		Source: []byte(fmt.Sprintf("PROGRAM P%d\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n", index))}
}

func isolatedRunner(t *testing.T, binary string) ProcessRunner {
	t.Helper()
	return ProcessRunner{BinaryPath: binary, ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second,
		SigningKeyPath: testSigningKeyPath(t), Cache: NewCompileCache(compileCacheMaxEntries, compileCacheMaxBytes),
		Pool: NewWorkerPool(MaxConcurrentCompiles)}
}

func TestCompileCacheHitReturnsIdenticalArtifactWithoutSpawning(t *testing.T) {
	binary, logPath := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{})
	runner := isolatedRunner(t, binary)
	input := fakeInput(1)
	started := time.Now()
	first, err := runner.Compile(context.Background(), input)
	firstElapsed := time.Since(started)
	if err != nil || !first.OK {
		t.Fatalf("lần 1: result=%+v err=%v", first, err)
	}
	started = time.Now()
	second, err := runner.Compile(context.Background(), input)
	secondElapsed := time.Since(started)
	if err != nil || !second.OK {
		t.Fatalf("lần 2: result=%+v err=%v", second, err)
	}
	if runs := readFakeCompilerLog(t, logPath); len(runs) != 1 {
		t.Fatalf("compiler bị gọi %d lần cho cùng đầu vào; cache phải trả lần 2", len(runs))
	}
	if !bytes.Equal(first.Artifact, second.Artifact) || first.ArtifactSHA256 != second.ArtifactSHA256 ||
		!bytes.Equal(first.Manifest, second.Manifest) || !reflect.DeepEqual(first, second) {
		t.Fatal("cache hit phải trả kết quả trùng từng byte với lần biên dịch")
	}
	stats := runner.Cache.Stats()
	if stats.Hits != 1 || stats.Misses != 1 || stats.Stores != 1 || stats.Entries != 1 {
		t.Fatalf("cache stats=%+v", stats)
	}
	t.Logf("T63-304 HOST compiler giả: lần 1 %v (spawn + validate), lần 2 %v (cache hit)", firstElapsed, secondElapsed)
}

func TestCompileCacheReturnsIsolatedCopies(t *testing.T) {
	binary, logPath := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{})
	runner := isolatedRunner(t, binary)
	input := fakeInput(2)
	first, err := runner.Compile(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte(nil), first.Artifact...)
	first.Artifact[0] ^= 0xFF
	first.Manifest[0] = 'X'
	second, err := runner.Compile(context.Background(), input)
	if err != nil || !bytes.Equal(second.Artifact, want) || second.Manifest[0] == 'X' {
		t.Fatalf("sửa bản trả về đã làm hỏng bản trong cache: %q err=%v", second.Artifact, err)
	}
	second.Artifact[0] ^= 0xFF
	third, _ := runner.Compile(context.Background(), input)
	if !bytes.Equal(third.Artifact, want) {
		t.Fatal("cache hit trả chung vùng nhớ với nơi gọi")
	}
	// Sửa bản trả về KHÔNG được làm hỏng mục cache (mục hỏng sẽ bị bỏ và phải
	// biên dịch lại): cả ba lần chỉ có đúng MỘT process.
	if runs := readFakeCompilerLog(t, logPath); len(runs) != 1 {
		t.Fatalf("compiler chạy %d lần; sửa bản trả về đã làm hỏng bản trong cache", len(runs))
	}
}

// Mọi field của Input phải đi vào khoá: đổi bất kỳ field nào mà khoá giữ nguyên
// là cache trả artifact của một đầu vào KHÁC.
func TestCompileCacheKeyCoversEveryInputField(t *testing.T) {
	binary, _ := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{})
	runner := isolatedRunner(t, binary)
	memo := &fileDigestMemo{}
	base := Input{SourceID: "S", ProgramID: "P", Language: "ST", Source: []byte("A"),
		LinkedPOUs:          []LinkedPOUSource{{Name: "F", Kind: "FUNCTION", Language: "ST", Source: []byte("F"), Origin: "PROJECT"}},
		RootRequiresLibrary: []LibraryRequirement{{Name: "L", Version: "1"}},
		LibraryLock:         LibraryLock{SystemVersion: "rev-a.6", Entries: []LibraryLockEntry{{EntryID: "E", Name: "F", Kind: "FUNCTION", Version: "1", Origin: "PROJECT"}}},
		PublishedSignals:    []PublishedSignalContract{{Name: "SIG", Type: "REAL", PublisherProgramID: "P"}},
		IoMap:               []IoMapEntry{{Variable: "X", Direction: "output", PointID: "DO-01", Type: "BOOL", Category: "LOCAL", Writable: true}},
	}
	baseKey, ok := runner.compileCacheKey(base, memo)
	if !ok {
		t.Fatal("không dựng được khoá")
	}
	mutations := map[string]func(*Input){
		"SourceID":  func(in *Input) { in.SourceID = "S2" },
		"ProgramID": func(in *Input) { in.ProgramID = "P2" },
		"Language":  func(in *Input) { in.Language = "FBD" },
		"Source":    func(in *Input) { in.Source = []byte("B") },
		"LinkedPOUs": func(in *Input) {
			in.LinkedPOUs = []LinkedPOUSource{{Name: "F", Kind: "FUNCTION", Language: "ST", Source: []byte("F2"), Origin: "PROJECT"}}
		},
		"RootRequiresLibrary": func(in *Input) { in.RootRequiresLibrary = []LibraryRequirement{{Name: "L", Version: "2"}} },
		"LibraryLock": func(in *Input) {
			in.LibraryLock.Entries = []LibraryLockEntry{{EntryID: "E", Name: "F", Kind: "FUNCTION", Version: "2", Origin: "PROJECT"}}
		},
		"PublishedSignals": func(in *Input) {
			in.PublishedSignals = []PublishedSignalContract{{Name: "SIG", Type: "INT", PublisherProgramID: "P"}}
		},
		"IoMap": func(in *Input) {
			in.IoMap = []IoMapEntry{{Variable: "X", Direction: "output", PointID: "DO-02", Type: "BOOL", Category: "LOCAL", Writable: true}}
		},
	}
	fields := reflect.TypeOf(Input{})
	for index := 0; index < fields.NumField(); index++ {
		name := fields.Field(index).Name
		mutate, found := mutations[name]
		if !found {
			t.Fatalf("field Input.%s chưa có ca kiểm khoá cache — thêm ca vào test này", name)
		}
		changed := base
		mutate(&changed)
		key, ok := runner.compileCacheKey(changed, memo)
		if !ok || key == baseKey {
			t.Errorf("đổi Input.%s mà khoá cache không đổi", name)
		}
	}
}

// Đổi binary compiler (cài bản mới) hoặc đổi khoá ký ⇒ khoá khác ⇒ biên dịch lại.
func TestCompileCacheMissesAfterToolchainOrSigningKeyChanges(t *testing.T) {
	dir := t.TempDir()
	binary, logPath := writeFakeCompiler(t, dir, fakeCompilerOptions{build: "1"})
	runner := isolatedRunner(t, binary)
	input := fakeInput(3)
	first, err := runner.Compile(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	// "Cài" compiler bản khác: cùng đường dẫn, nội dung khác (đổi inode như `install`).
	replacement, _ := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{build: "2"})
	body, _ := os.ReadFile(replacement)
	body = []byte(strings.ReplaceAll(string(body), filepath.Join(filepath.Dir(replacement), "fake-compiler.log"), logPath))
	if err := os.Remove(binary); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, body, 0o700); err != nil {
		t.Fatal(err)
	}
	second, err := runner.Compile(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first.Artifact, second.Artifact) {
		t.Fatal("compiler đã đổi mà vẫn nhận artifact của compiler cũ từ cache")
	}
	// Đổi khoá ký.
	runner.SigningKeyPath = filepath.Join(t.TempDir(), "other.key")
	if err := os.WriteFile(runner.SigningKeyPath, []byte("ab"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Compile(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if runs := readFakeCompilerLog(t, logPath); len(runs) != 3 {
		t.Fatalf("compiler chạy %d lần; muốn 3 (lần đầu, sau khi đổi binary, sau khi đổi khoá)", len(runs))
	}
}

// Lỗi biên dịch và lỗi worker KHÔNG được cache: một kết quả cũ không được che
// một lỗi mới, và một lỗi thoáng qua không được "dính" lại.
func TestCompileCacheNeverStoresFailures(t *testing.T) {
	binary, logPath := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{mode: "diag"})
	runner := isolatedRunner(t, binary)
	input := fakeInput(4)
	for attempt := 0; attempt < 2; attempt++ {
		result, err := runner.Compile(context.Background(), input)
		if err != nil || result.OK || len(result.Diagnostics) != 1 {
			t.Fatalf("lần %d: result=%+v err=%v", attempt+1, result, err)
		}
	}
	if runs := readFakeCompilerLog(t, logPath); len(runs) != 2 {
		t.Fatalf("lỗi biên dịch đã bị cache: compiler chạy %d lần, muốn 2", len(runs))
	}
	crashDir := t.TempDir()
	crash := filepath.Join(crashDir, "compiler-crash")
	if err := os.WriteFile(crash, []byte("#!/bin/sh\nkill -KILL $$\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	crashRunner := isolatedRunner(t, crash)
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := crashRunner.Compile(context.Background(), input); !errors.Is(err, ErrCrashed) {
			t.Fatalf("lần %d crash err=%v", attempt+1, err)
		}
	}
	if stats := crashRunner.Cache.Stats(); stats.Stores != 0 || runner.Cache.Stats().Stores != 0 {
		t.Fatalf("lỗi đã vào cache: %+v / %+v", stats, runner.Cache.Stats())
	}
}

func TestCompileCacheIsBoundedLRU(t *testing.T) {
	result := func(tag string, size int) Result {
		artifact := bytes.Repeat([]byte(tag), size)
		return Result{OK: true, Artifact: artifact, ArtifactSHA256: sha256.Sum256(artifact), Manifest: json.RawMessage(`{}`)}
	}
	key := func(tag string) [32]byte { return sha256.Sum256([]byte(tag)) }
	cache := NewCompileCache(3, 1<<20)
	for _, tag := range []string{"a", "b", "c"} {
		cache.put(key(tag), result(tag, 10))
	}
	if _, hit := cache.get(key("a")); !hit { // "a" thành mới nhất
		t.Fatal("thiếu a")
	}
	cache.put(key("d"), result("d", 10)) // loại "b" (cũ nhất)
	if _, hit := cache.get(key("b")); hit {
		t.Fatal("LRU phải loại b")
	}
	for _, tag := range []string{"a", "c", "d"} {
		if _, hit := cache.get(key(tag)); !hit {
			t.Fatalf("mất %s", tag)
		}
	}
	if stats := cache.Stats(); stats.Entries != 3 || stats.Evictions != 1 {
		t.Fatalf("stats=%+v", stats)
	}
	// Trần byte: mục quá trần không được lưu, và tổng byte không vượt trần.
	small := NewCompileCache(100, 4096)
	small.put(key("big"), result("x", 8192))
	if _, hit := small.get(key("big")); hit {
		t.Fatal("mục lớn hơn trần byte đã được lưu")
	}
	for i := 0; i < 20; i++ {
		small.put(key(fmt.Sprint(i)), result("y", 1000))
		if stats := small.Stats(); stats.Bytes > 4096 {
			t.Fatalf("cache vượt trần byte: %+v", stats)
		}
	}
	// Mục không OK không bao giờ được lưu.
	failed := NewCompileCache(10, 1<<20)
	failed.put(key("f"), Result{OK: false})
	if failed.Stats().Entries != 0 {
		t.Fatal("kết quả lỗi đã được lưu")
	}
	// Artifact trong bộ nhớ lệch digest ⇒ bỏ mục, không trả.
	tampered := NewCompileCache(10, 1<<20)
	tampered.put(key("t"), result("t", 10))
	element := tampered.items[key("t")]
	element.Value.(*compileCacheEntry).result.Artifact[0] = 'Z'
	if _, hit := tampered.get(key("t")); hit {
		t.Fatal("cache trả artifact lệch digest")
	}
}

// Manifest build chiếm phần lớn một kết quả compile (đo HOST với compiler thật:
// ≈180 B/instruction, 740 KB cho Program 4.095 instruction; artifact 99 KB).
// Lưu thô thì trần mặc định chỉ giữ một phần dự án và Check lặp lại duyệt tuần
// tự qua LRU nhỏ hơn tập làm việc ⇒ 0 hit. Cache lưu manifest nén: dự án lớn
// nhất của profile (MaxProgramsTotal Program × MaxInstructions) phải nằm trọn
// trong trần mặc định, không loại mục nào.
func TestCompileCacheHoldsLargestProfileProjectWithCompressedManifest(t *testing.T) {
	manifestFor := func(program int) json.RawMessage {
		var b strings.Builder
		fmt.Fprintf(&b, `{"program":%d,"instructions":[`, program)
		for i := 0; i < domain.MaxInstructions; i++ {
			if i > 0 {
				b.WriteByte(',')
			}
			fmt.Fprintf(&b, `{"index":%d,"op":"ADD_DINT","dst":%d,"src":[%d,%d],"line":%d,"column":%d,"pou":"P%02d","slotKind":"LOCAL","constant":1}`,
				i, i%1024, (i*7)%1024, (i*13)%512, 3+i, 5, program)
		}
		b.WriteString(`]}`)
		return json.RawMessage(b.String())
	}
	artifactFor := func(program int) []byte {
		out := make([]byte, 0, 100<<10)
		block := sha256.Sum256([]byte(fmt.Sprint("artifact", program)))
		for len(out) < 100<<10 {
			out = append(out, block[:]...)
			block = sha256.Sum256(block[:])
		}
		return out
	}
	key := func(program int) [32]byte { return sha256.Sum256([]byte(fmt.Sprint("program", program))) }
	cache := NewCompileCache(compileCacheMaxEntries, compileCacheMaxBytes)
	manifests := make([]json.RawMessage, domain.MaxProgramsTotal)
	raw := int64(0)
	for program := 0; program < domain.MaxProgramsTotal; program++ {
		artifact := artifactFor(program)
		manifests[program] = manifestFor(program)
		raw += int64(len(artifact) + len(manifests[program]))
		cache.put(key(program), Result{OK: true, Artifact: artifact, ArtifactSHA256: sha256.Sum256(artifact), Manifest: manifests[program]})
	}
	if raw <= compileCacheMaxBytes {
		t.Fatalf("tiền đề: dự án thô %d B phải vượt trần %d B, nếu không test không kiểm gì", raw, compileCacheMaxBytes)
	}
	for program := 0; program < domain.MaxProgramsTotal; program++ {
		got, hit := cache.get(key(program))
		if !hit {
			t.Fatalf("Program %d bị loại: dự án lớn nhất phải nằm trọn trong cache; stats=%+v", program, cache.Stats())
		}
		if !bytes.Equal(got.Manifest, manifests[program]) {
			t.Fatalf("Program %d: manifest giải nén khác byte", program)
		}
	}
	if stats := cache.Stats(); stats.Evictions != 0 || stats.Bytes > compileCacheMaxBytes {
		t.Fatalf("stats=%+v", stats)
	}

	// nil và rỗng giữ nguyên phân biệt qua nén.
	artifact := []byte("a")
	cache.put(key(1000), Result{OK: true, Artifact: artifact, ArtifactSHA256: sha256.Sum256(artifact)})
	if got, hit := cache.get(key(1000)); !hit || got.Manifest != nil {
		t.Fatalf("manifest nil phải giữ nil: hit=%v manifest=%v", hit, got.Manifest)
	}
	cache.put(key(1001), Result{OK: true, Artifact: artifact, ArtifactSHA256: sha256.Sum256(artifact), Manifest: json.RawMessage{}})
	if got, hit := cache.get(key(1001)); !hit || got.Manifest == nil || len(got.Manifest) != 0 {
		t.Fatalf("manifest rỗng phải giữ rỗng khác nil: hit=%v manifest=%v", hit, got.Manifest)
	}
	// Manifest nén bị hỏng ⇒ bỏ mục, không trả.
	element := cache.items[key(3)]
	entry := element.Value.(*compileCacheEntry)
	entry.manifestGz[len(entry.manifestGz)/2] ^= 0xFF
	if _, hit := cache.get(key(3)); hit {
		t.Fatal("cache trả manifest hỏng")
	}
}

// Cùng lỗi trên với compiler THẬT: Check lặp lại một dự án 32 Program cỡ
// 1.603 instruction phải trúng cache cho mọi Program (trước bản vá: 0 hit).
func TestProcessRunnerWithOfficialCompilerCachesWholeProjectRepeat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("sandbox compiler chỉ hỗ trợ Linux")
	}
	binary := officialCompilerBinary(t)
	cache := NewCompileCache(compileCacheMaxEntries, compileCacheMaxBytes)
	runner := ProcessRunner{BinaryPath: binary, ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 30 * time.Second,
		SigningKeyPath: testSigningKeyPath(t), Cache: cache, Pool: NewWorkerPool(MaxConcurrentCompiles)}
	inputs := make([]Input, domain.MaxProgramsTotal)
	for i := range inputs {
		var b strings.Builder
		fmt.Fprintf(&b, "PROGRAM P%02d\nVAR Acc : DINT; END_VAR\n", i)
		for s := 0; s < 801; s++ {
			b.WriteString("Acc := Acc + 1;\n")
		}
		b.WriteString("END_PROGRAM\n")
		inputs[i] = Input{SourceID: fmt.Sprintf("%08d-3333-4333-8333-333333333333", i), Language: "ST", Source: []byte(b.String())}
	}
	first := runner.CompileBatch(context.Background(), inputs)
	for i, outcome := range first {
		if outcome.Err != nil || !outcome.Result.OK {
			t.Fatalf("Program %d lần đầu: err=%v diag=%+v", i, outcome.Err, outcome.Result.Diagnostics)
		}
	}
	before := cache.Stats()
	second := runner.CompileBatch(context.Background(), inputs)
	after := cache.Stats()
	for i, outcome := range second {
		if outcome.Err != nil || !outcome.Result.OK || !bytes.Equal(outcome.Result.Artifact, first[i].Result.Artifact) ||
			!bytes.Equal(outcome.Result.Manifest, first[i].Result.Manifest) {
			t.Fatalf("Program %d lần lặp khác lần đầu: err=%v", i, outcome.Err)
		}
	}
	if hits := after.Hits - before.Hits; hits != uint64(len(inputs)) || after.Misses != before.Misses {
		t.Fatalf("lần lặp phải trúng %d/%d: hits=%d, misses thêm %d; stats=%+v", len(inputs), len(inputs), hits, after.Misses-before.Misses, after)
	}
}

// Tối đa 2 process compiler chạy đồng thời, dù có bao nhiêu request song song.
func TestWorkerPoolCapsConcurrentCompilerProcessesAtTwo(t *testing.T) {
	// Plan 63 §4.3: pool 2 worker trên SOM (CPU0–2 dành cho web/IOBus/HMI). 1 là
	// mất lợi ích song song, >2 là lấn CPU của IOBus.
	if MaxConcurrentCompiles != 2 {
		t.Fatalf("MaxConcurrentCompiles=%d; Plan 63 §4.3 chốt 2", MaxConcurrentCompiles)
	}
	binary, logPath := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{sleepMS: 300})
	runner := isolatedRunner(t, binary)
	const requests = 8
	var wg sync.WaitGroup
	errs := make([]error, requests)
	started := time.Now()
	for index := 0; index < requests; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, errs[index] = runner.Compile(context.Background(), fakeInput(100+index))
		}(index)
	}
	wg.Wait()
	elapsed := time.Since(started)
	for index, err := range errs {
		if err != nil {
			t.Fatalf("request %d: %v", index, err)
		}
	}
	runs := readFakeCompilerLog(t, logPath)
	if len(runs) != requests {
		t.Fatalf("số process=%d; muốn %d", len(runs), requests)
	}
	overlap := maxOverlap(runs)
	if overlap > MaxConcurrentCompiles {
		t.Fatalf("có %d process compiler chạy cùng lúc; trần %d", overlap, MaxConcurrentCompiles)
	}
	if overlap < MaxConcurrentCompiles {
		t.Fatalf("chỉ %d process cùng lúc: pool không cho chạy song song", overlap)
	}
	if stats := runner.Pool.Stats(); stats.Peak != MaxConcurrentCompiles || stats.Active != 0 {
		t.Fatalf("pool stats=%+v", stats)
	}
	t.Logf("T63-304 HOST: %d request song song, compiler giả 300 ms/lần ⇒ tối đa %d process đồng thời, tổng %v", requests, overlap, elapsed)
}

// Vượt pool thì xếp hàng có hạn: chờ quá một Timeout ⇒ ErrTimeout+ErrWorkerPoolBusy,
// context huỷ ⇒ trả ngay; không bao giờ treo và không spawn process.
func TestWorkerPoolWaitIsBoundedAndHonoursContext(t *testing.T) {
	binary, logPath := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{})
	runner := isolatedRunner(t, binary)
	runner.Timeout = time.Second
	runner.Pool = NewWorkerPool(1)
	release, err := runner.Pool.acquire(context.Background(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	started := time.Now()
	_, err = runner.Compile(context.Background(), fakeInput(5))
	waited := time.Since(started)
	if !errors.Is(err, ErrTimeout) || !errors.Is(err, ErrWorkerPoolBusy) {
		t.Fatalf("chờ slot quá hạn phải trả ErrTimeout+ErrWorkerPoolBusy, nhận %v", err)
	}
	if waited < 900*time.Millisecond || waited > 3*time.Second {
		t.Fatalf("thời gian chờ %v; muốn ≈ Timeout 1 s", waited)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(100 * time.Millisecond); cancel() }()
	started = time.Now()
	_, err = runner.Compile(ctx, fakeInput(6))
	if !errors.Is(err, ErrWorkerPoolBusy) || time.Since(started) > 700*time.Millisecond {
		t.Fatalf("context huỷ phải trả ngay: err=%v sau %v", err, time.Since(started))
	}
	if runs := readFakeCompilerLog(t, logPath); len(runs) != 0 {
		t.Fatalf("đã spawn %d process khi không có slot", len(runs))
	}
	if runner.Pool.Stats().Busy != 1 {
		t.Fatalf("pool stats=%+v", runner.Pool.Stats())
	}
}

// Process compiler chạy nice compileWorkerNice (thấp hơn web/IOBus nice 0 và Core RT).
func TestCompilerProcessRunsAtLowerCPUPriority(t *testing.T) {
	binary, logPath := writeFakeCompiler(t, t.TempDir(), fakeCompilerOptions{})
	runner := isolatedRunner(t, binary)
	if _, err := runner.Compile(context.Background(), fakeInput(7)); err != nil {
		t.Fatal(err)
	}
	runs := readFakeCompilerLog(t, logPath)
	if len(runs) != 1 || runs[0].nice != compileWorkerNice {
		t.Fatalf("nice của process compiler=%+v; muốn %d", runs, compileWorkerNice)
	}
	if runner.Pool.Stats().NiceFailures != 0 {
		t.Fatalf("hạ ưu tiên thất bại: %+v", runner.Pool.Stats())
	}
}

// CompileConcurrently: kết quả theo thứ tự Input dù hoàn thành đảo thứ tự; sau
// lỗi đầu tiên không phát thêm Input, mọi Input trước lỗi đều đã chạy.
func TestCompileConcurrentlyKeepsInputOrderAndStopsAfterError(t *testing.T) {
	inputs := make([]Input, 8)
	for index := range inputs {
		inputs[index] = Input{SourceID: fmt.Sprint(index)}
	}
	var active, peak atomic.Int64
	compile := func(_ context.Context, input Input) (Result, error) {
		now := active.Add(1)
		for {
			old := peak.Load()
			if now <= old || peak.CompareAndSwap(old, now) {
				break
			}
		}
		defer active.Add(-1)
		index, _ := strconv.Atoi(input.SourceID)
		time.Sleep(time.Duration(40-5*index) * time.Millisecond) // Input sau xong trước
		if index == 5 {
			return Result{}, ErrCrashed
		}
		return Result{OK: true, CompilerVersion: input.SourceID}, nil
	}
	outcomes := CompileConcurrently(context.Background(), inputs, 2, compile)
	if peak.Load() != 2 {
		t.Fatalf("song song tối đa %d; muốn 2", peak.Load())
	}
	for index := 0; index <= 5; index++ {
		outcome := outcomes[index]
		if !outcome.Ran {
			t.Fatalf("Input %d đứng trước lỗi nhưng không chạy", index)
		}
		if index < 5 && (outcome.Err != nil || outcome.Result.CompilerVersion != fmt.Sprint(index)) {
			t.Fatalf("outcome %d lệch chỗ: %+v", index, outcome)
		}
	}
	if !errors.Is(outcomes[5].Err, ErrCrashed) {
		t.Fatalf("outcome 5=%+v", outcomes[5])
	}
	if outcomes[7].Ran {
		t.Fatal("vẫn phát Input sau khi đã có lỗi")
	}
}
