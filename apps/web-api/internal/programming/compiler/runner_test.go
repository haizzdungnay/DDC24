package compiler

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
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
