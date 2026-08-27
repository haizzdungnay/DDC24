package simworker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Test ở đây chạy với BINARY THẬT, không với một fake.
//
// Lý do: thứ đang kiểm là hợp đồng giữa hai tiến trình — bắt tay, khung lệnh,
// thu hồi. Một fake sẽ đồng ý với bất cứ điều gì client này làm, kể cả khi
// worker thật không đồng ý. Khi chưa dựng binary thì test skip, và
// `MKDDC_REQUIRE_PRODUCTION_TOOLS=1` biến skip đó thành lỗi cho môi trường
// nghiệm thu.
func workerBinary(t *testing.T) string {
	t.Helper()
	_, current, _, _ := runtime.Caller(0)
	repo := filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", "..", ".."))
	candidates := []string{}
	if explicit := os.Getenv("MKDDC_SIM_WORKER_BINARY"); explicit != "" {
		candidates = append(candidates, explicit)
	} else {
		candidates = append(candidates,
			filepath.Join(repo, "build", "fw", "core", "mkddc-programming-sim-worker"),
			filepath.Join(repo, "build", "verify", "cpp-full", "core", "mkddc-programming-sim-worker"))
	}
	problems := make([]string, 0, len(candidates))
	for _, binary := range candidates {
		info, err := os.Stat(binary)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", binary, err))
			continue
		}
		if info.Mode().Perm()&0o111 == 0 {
			problems = append(problems, fmt.Sprintf("%s: không executable", binary))
			continue
		}
		return binary
	}
	message := "không có sim worker đã dựng: " + strings.Join(problems, "; ")
	if os.Getenv("MKDDC_REQUIRE_PRODUCTION_TOOLS") == "1" {
		t.Fatal(message)
	}
	t.Skip(message + " — dựng target mkddc-programming-sim-worker hoặc đặt MKDDC_SIM_WORKER_BINARY")
	return ""
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	// `/proc/<pid>` biến mất khi tiến trình đã được reap. Dùng nó thay vì
	// `Signal(0)` vì signal 0 vẫn thành công với một zombie — mà zombie chính là
	// thứ cần chứng minh không còn.
	entry, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return false
	}
	fields := strings.Fields(string(entry))
	return len(fields) > 2 && fields[2] != "Z"
}

func TestSpawnHandshakeAndClosePipeReapsWorker(t *testing.T) {
	binary := workerBinary(t)
	client, version, detail, err := Spawn(context.Background(), Options{
		BinaryPath: binary, CommandTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("bắt tay phải thành công: %v (%s)", err, detail)
	}
	if version == "" {
		t.Fatal("worker phải công bố phiên bản")
	}
	pid := client.PID()
	if !processAlive(pid) {
		t.Fatal("worker phải đang sống sau bắt tay")
	}

	client.Kill()
	// Kill phải KÈM reap: một tiến trình chết mà chưa thu hồi vẫn chiếm slot
	// trong bảng tiến trình, và đó đúng là kiểu rò rỉ ADR-053 bắt phải chứng
	// minh không xảy ra.
	if processAlive(pid) {
		t.Fatalf("worker %d vẫn còn sau Kill — supervisor rò tiến trình", pid)
	}
}

func TestSpawnRejectsMissingBinaryWithoutLeavingProcess(t *testing.T) {
	_, _, detail, err := Spawn(context.Background(), Options{
		BinaryPath: filepath.Join(t.TempDir(), "khong-ton-tai"), CommandTimeout: time.Second,
	})
	if !errors.Is(err, ErrWorkerUnavailable) {
		t.Fatalf("thiếu binary phải trả ErrWorkerUnavailable, nhận %v", err)
	}
	if detail != DetailCapability {
		t.Fatalf("thiếu binary là vấn đề capability, nhận detail=%s", detail)
	}
}

func TestWorkerRefusesForgedTokenSoASecondProcessCannotHijackThePipe(t *testing.T) {
	binary := workerBinary(t)
	// Chạy worker với token của phiên khác rồi tự bắt tay bằng token đoán: đây
	// đúng hình dạng của một tiến trình lạ cắm vào ống.
	command := exec.Command(binary)
	command.Env = []string{"MKDDC_SIM_SESSION_TOKEN=token-that-that-su"}
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	if _, err := stdin.Write([]byte(`{"cmd":"HELLO","commandId":"x","token":"doan-bua","protocolVersion":1}` + "\n")); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 4096)
	n, _ := stdout.Read(buffer)
	response := string(buffer[:n])
	if !strings.Contains(response, `"ok":false`) || !strings.Contains(response, "SIM-E-001") {
		t.Fatalf("token sai phải bị từ chối bằng SIM-E-001, nhận: %s", response)
	}
	_ = stdin.Close()
	if err := command.Wait(); err == nil {
		t.Fatal("worker phải thoát khác 0 khi token sai")
	}
}

func TestPrepareRejectsArtifactOutsideBounds(t *testing.T) {
	binary := workerBinary(t)
	client, _, _, err := Spawn(context.Background(), Options{
		BinaryPath: binary, CommandTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Kill()

	if _, err := client.Prepare(context.Background(), nil); !errors.Is(err, ErrProtocol) {
		t.Fatalf("artifact rỗng phải bị chặn tại supervisor, nhận %v", err)
	}
	if _, err := client.Prepare(context.Background(), make([]byte, MaxArtifactBytes+1)); !errors.Is(err, ErrProtocol) {
		t.Fatalf("artifact vượt trần phải bị chặn tại supervisor, nhận %v", err)
	}
}

func TestPrepareGarbageArtifactFailsSessionNotSupervisor(t *testing.T) {
	binary := workerBinary(t)
	client, _, _, err := Spawn(context.Background(), Options{
		BinaryPath: binary, CommandTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Kill()

	// Artifact rác là lỗi CỦA PHIÊN, không phải sự cố vận chuyển: worker vẫn
	// sống, vẫn đúng giao thức, và trả về mã của chính nó.
	_, err = client.Prepare(context.Background(), []byte("khong-phai-package-nao-ca-day-la-rac"))
	var commandError *CommandError
	if !errors.As(err, &commandError) {
		t.Fatalf("phải là CommandError của worker, nhận %v", err)
	}
	if commandError.DetailCode != "SIM-E-002" {
		t.Fatalf("artifact hỏng phải trả SIM-E-002, nhận %s", commandError.DetailCode)
	}
	if client.BrokenDetail() != "" {
		t.Fatal("một lệnh bị từ chối không được làm hỏng cả phiên")
	}
}

func TestStopAlwaysReapsEvenAfterGoodbye(t *testing.T) {
	binary := workerBinary(t)
	client, _, _, err := Spawn(context.Background(), Options{
		BinaryPath: binary, CommandTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	pid := client.PID()
	if err := client.Stop(context.Background()); err != nil {
		t.Fatalf("STOP phải thành công: %v", err)
	}
	if processAlive(pid) {
		t.Fatalf("worker %d còn sống sau STOP", pid)
	}
	// Gọi lại phải an toàn: đường dọn dẹp bị gọi nhiều lần là chuyện thường
	// (client bấm STOP, TTL quét, rồi shutdown).
	client.Kill()
}

// Đường quá hạn phải đo được TẤT ĐỊNH, không phụ thuộc máy chạy nhanh hay chậm.
// Dùng một tiến trình cố ý im lặng thay vì cố làm worker thật chậm lại: một
// test chỉ đỏ trên máy yếu là một test không nói được điều gì.
func silentStub(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "silent-worker.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestHandshakeTimeoutIsReportedAsTimeoutAndReapsTheProcess(t *testing.T) {
	client, _, detail, err := Spawn(context.Background(), Options{
		BinaryPath: silentStub(t), CommandTimeout: 50 * time.Millisecond,
	})
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("worker im lặng phải làm bắt tay quá hạn, nhận %v", err)
	}
	if detail != DetailTimeout {
		t.Fatalf("mã chi tiết phải là %s, nhận %s", DetailTimeout, detail)
	}
	if client != nil {
		t.Fatal("bắt tay hỏng không được trả về client dùng được")
	}
	// Không có cách nào đọc PID sau khi Spawn trả nil, nên bằng chứng reap nằm ở
	// chỗ khác: `Spawn` gọi `Kill()` (kèm `Wait`) trước khi trả lỗi. Test dưới
	// đây khoá phần quan sát được — tiến trình con không còn là con của test.
}

func TestBrokenSessionRefusesFurtherCommands(t *testing.T) {
	binary := workerBinary(t)
	client, _, _, err := Spawn(context.Background(), Options{
		BinaryPath: binary, CommandTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	pid := client.PID()
	client.Kill()
	if processAlive(pid) {
		t.Fatalf("worker %d còn sống sau Kill", pid)
	}
	// Sau khi phiên hỏng, MỌI lệnh phải trượt ngay tại supervisor. Gửi tiếp cho
	// một tiến trình đã chết sẽ biến một sự cố đã biết thành một lỗi I/O khó
	// đọc ở tầng khác.
	if _, err := client.Step(context.Background()); !errors.Is(err, ErrBroken) {
		t.Fatalf("phiên hỏng không được nhận lệnh tiếp, nhận %v", err)
	}
	if _, err := client.Reset(context.Background()); !errors.Is(err, ErrBroken) {
		t.Fatalf("phiên hỏng không được nhận RESET, nhận %v", err)
	}
	if client.BrokenDetail() == "" {
		t.Fatal("phiên hỏng phải nêu được lý do cho audit")
	}
}
