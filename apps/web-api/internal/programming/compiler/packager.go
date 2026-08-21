package compiler

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// PackageProgram là một Program đã biên dịch, sắp vào container theo đúng thứ tự
// caller cấp. Container KHÔNG diễn giải lại `Artifact`: nó là blob IR v1 mà Check
// vừa tạo, nên hash package suy được từ hash các thành phần.
type PackageProgram struct {
	Name     string
	Artifact []byte
}

// PackageResult là kết quả lắp container v2.
type PackageResult struct {
	Package       []byte
	SHA256        [sha256.Size]byte
	ByteSize      int64
	ProgramCount  int
	SchemaVersion int
	TargetABI     int64
}

// Packager tách khỏi Runner vì hai việc khác nhau: Runner biên dịch MỘT nguồn,
// Packager bọc N artifact đã có. Gộp chúng sẽ làm mọi test Check phải mock cả
// hai chức năng dù chỉ dùng một.
type Packager interface {
	Package(ctx context.Context, programs []PackageProgram) (PackageResult, error)
}

type packagerOutput struct {
	OK            bool   `json:"ok"`
	Bytes         int64  `json:"bytes"`
	ProgramCount  int    `json:"programCount"`
	SchemaVersion int    `json:"schemaVersion"`
	TargetABI     int64  `json:"targetAbi"`
	SHA256        string `json:"sha256"`
	Code          string `json:"code"`
	Message       string `json:"message"`
}

// ProcessPackager gọi `mkddc-st-package` — ĐÚNG writer production mà golden và
// fuzz của T59-106 đang canh. Cài lại định dạng bằng Go sẽ tạo bản thứ hai, và
// bản thứ hai luôn là bản quên cập nhật.
type ProcessPackager struct {
	BinaryPath  string
	ScratchRoot string
	Timeout     time.Duration
}

func (p ProcessPackager) Package(ctx context.Context, programs []PackageProgram) (PackageResult, error) {
	if p.BinaryPath == "" || p.ScratchRoot == "" || p.Timeout < time.Second || p.Timeout > time.Minute {
		return PackageResult{}, fmt.Errorf("tham số packager không hợp lệ")
	}
	if len(programs) == 0 || len(programs) > 32 {
		return PackageResult{}, fmt.Errorf("số Program trong package không hợp lệ: %d", len(programs))
	}
	if err := ensurePrivateDirectory(p.ScratchRoot); err != nil {
		return PackageResult{}, err
	}
	jobRoot, err := os.MkdirTemp(p.ScratchRoot, "package-")
	if err != nil {
		return PackageResult{}, fmt.Errorf("tạo packager scratch: %w", err)
	}
	defer os.RemoveAll(jobRoot)
	if err := os.Chmod(jobRoot, 0o700); err != nil {
		return PackageResult{}, err
	}

	outPath := filepath.Join(jobRoot, "package.mkpkg")
	args := make([]string, 0, 2+2*len(programs))
	args = append(args, "--out", outPath)
	for index, program := range programs {
		// Tên Program đi vào argv nên phải chặn ký tự có nghĩa với chính cú pháp
		// `<name>=<path>` và với đường dẫn — không dựa vào shell quoting vì
		// không có shell nào ở đây.
		if len(program.Name) < 1 || len(program.Name) > 64 ||
			strings.ContainsAny(program.Name, "=/\\\x00") {
			return PackageResult{}, fmt.Errorf("tên Program không hợp lệ: %q", program.Name)
		}
		if len(program.Artifact) == 0 {
			return PackageResult{}, fmt.Errorf("artifact rỗng cho Program %q", program.Name)
		}
		irPath := filepath.Join(jobRoot, fmt.Sprintf("program-%02d.mkir", index))
		if err := writeExclusive(irPath, program.Artifact, 0o600); err != nil {
			return PackageResult{}, err
		}
		args = append(args, "--program", program.Name+"="+irPath)
	}

	packageCtx, cancel := context.WithTimeout(ctx, p.Timeout)
	defer cancel()
	stdout, stderr := &boundedBuffer{limit: maxStdoutBytes}, &boundedBuffer{limit: maxStderrBytes}
	cmd := exec.CommandContext(packageCtx, p.BinaryPath, args...)
	cmd.Dir = jobRoot
	cmd.Env = []string{"LANG=C", "LC_ALL=C", "TZ=UTC", "PATH=/usr/bin:/bin"}
	cmd.Stdin = nil
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
			return err
		}
		return nil
	}
	cmd.WaitDelay = 500 * time.Millisecond
	runErr := cmd.Run()
	if packageCtx.Err() != nil {
		return PackageResult{}, fmt.Errorf("%w: deadline", ErrTimeout)
	}
	if stdout.overflow || stderr.overflow {
		return PackageResult{}, fmt.Errorf("packager output vượt giới hạn")
	}
	if runErr != nil {
		var output packagerOutput
		if json.Unmarshal(stderr.Bytes(), &output) == nil && output.Code != "" {
			return PackageResult{}, fmt.Errorf("packager từ chối: %s %s", output.Code, output.Message)
		}
		return PackageResult{}, fmt.Errorf("packager lỗi: %w", runErr)
	}

	var output packagerOutput
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil || !output.OK ||
		output.SchemaVersion != 2 || output.ProgramCount != len(programs) {
		return PackageResult{}, fmt.Errorf("packager output không hợp lệ")
	}
	blob, err := os.ReadFile(outPath)
	if err != nil {
		return PackageResult{}, fmt.Errorf("đọc package: %w", err)
	}
	// Hash được tính LẠI từ byte đọc về, không nhận con số CLI báo: nhận số của
	// bên khác nghĩa là tin một thứ mình chưa kiểm.
	digest := sha256.Sum256(blob)
	if int64(len(blob)) != output.Bytes {
		return PackageResult{}, fmt.Errorf("kích thước package lệch báo cáo")
	}
	return PackageResult{Package: blob, SHA256: digest, ByteSize: int64(len(blob)),
		ProgramCount: output.ProgramCount, SchemaVersion: output.SchemaVersion, TargetABI: output.TargetABI}, nil
}
