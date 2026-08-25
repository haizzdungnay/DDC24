package compiler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	// PeriodMs là chu kỳ release riêng của Program (DDD §7.1). Nó đi TRONG
	// container chứ không để runtime tự chọn: hai controller nạp cùng một
	// package phải chạy cùng một dãy release, và điều đó chỉ đúng khi chu kỳ là
	// dữ liệu của package. Production packager từ chối 0: caller phải phân giải
	// chu kỳ trước khi đóng gói, không được tự chọn một Task mặc định.
	PeriodMs int64
	// BudgetUs là ngân sách WCET của Program trong một lần release, đơn vị µs
	// (DDD §4.3: `<=20% period`). Nó đi TRONG container vì cùng lý do với
	// `PeriodMs`: ngân sách là dữ liệu của package, không phải thứ runtime tự
	// đặt. `SEC_PROGRAM_TABLE` đã có ô này từ `T59-106` nhưng writer phía Go
	// chưa bao giờ điền, nên mọi package v2 do Check dựng đều mang `budget_us=0`
	// — tức là "chưa đo" — kể cả khi Check vừa tính xong ngân sách
	// (F-P59-MANIFEST-001). 0 = chưa đo, giữ đường tương thích cũ.
	BudgetUs int64
}

// PackageSignal là một Published Signal đi TRONG container. Nó phải đi trong
// package chứ không nằm lại ở manifest Check: chính sách khi dữ liệu quá hạn là
// quyết định thiết kế của người dựng chương trình, và để runtime tự chọn nghĩa
// là chọn thay họ xem thiết bị làm gì khi mất dữ liệu.
type PackageSignal struct {
	Name        string
	Publisher   string
	Type        int
	FreshnessMs int
	// StalePolicy theo enum đóng của runtime: 0=HOLD_LAST, 1=USE_FALLBACK,
	// 2=WAIT. Dùng số chứ không dùng chuỗi để một tên viết sai không thể đi qua
	// biên process mà chỉ lộ ra ở loader.
	StalePolicy int
	// FallbackBits là 8 byte thô của giá trị dự phòng, chỉ có nghĩa với
	// USE_FALLBACK. nil = không có giá trị dự phòng.
	FallbackBits *uint64
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
	Package(ctx context.Context, programs []PackageProgram, signals []PackageSignal,
		linkedPOUs []LinkedPOU, libraryLock LibraryLock) (PackageResult, error)
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

func (p ProcessPackager) Package(ctx context.Context, programs []PackageProgram,
	signals []PackageSignal, linkedPOUs []LinkedPOU, libraryLock LibraryLock) (PackageResult, error) {
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
		if program.PeriodMs <= 0 {
			return PackageResult{}, fmt.Errorf("ST-POU-005: Program %q chưa có chu kỳ chạy", program.Name)
		}
		irPath := filepath.Join(jobRoot, fmt.Sprintf("program-%02d.mkir", index))
		if err := writeExclusive(irPath, program.Artifact, 0o600); err != nil {
			return PackageResult{}, err
		}
		args = append(args, "--program", program.Name+"="+irPath)
		if program.PeriodMs != 0 {
			args = append(args, "--period", fmt.Sprintf("%s=%d", program.Name, program.PeriodMs))
		}
		if program.BudgetUs != 0 {
			// CLI nhận số nguyên không dấu tối đa 9 chữ số (`st_package_main.cpp`)
			// và ô trong container là `uint32`. Chặn ở đây để lỗi chỉ vào dữ liệu
			// sai chứ không vào một thông báo CLI khó truy.
			if program.BudgetUs < 0 || program.BudgetUs > 999_999_999 {
				return PackageResult{}, fmt.Errorf("ngân sách WCET không hợp lệ cho Program %q: %d µs",
					program.Name, program.BudgetUs)
			}
			args = append(args, "--budget", fmt.Sprintf("%s=%d", program.Name, program.BudgetUs))
		}
	}

	packageCtx, cancel := context.WithTimeout(ctx, p.Timeout)
	defer cancel()
	stdout, stderr := &boundedBuffer{limit: maxStdoutBytes}, &boundedBuffer{limit: maxStderrBytes}
	if len(signals) > 0 {
		// Signal đi bằng FILE JSON chứ không bằng argv: tên signal là chuỗi
		// người dùng đặt, nên mọi dấu phân cách ta chọn đều có thể xuất hiện
		// trong chính dữ liệu. Một định dạng có escape sẵn thì không có lớp lỗi
		// đó.
		if len(signals) > 512 {
			return PackageResult{}, fmt.Errorf("số signal vượt trần: %d", len(signals))
		}
		encoded := make([]map[string]any, 0, len(signals))
		for _, signal := range signals {
			if signal.StalePolicy < 0 || signal.StalePolicy > 2 {
				return PackageResult{}, fmt.Errorf("chính sách stale không hợp lệ cho signal %q", signal.Name)
			}
			if (signal.StalePolicy == 1) != (signal.FallbackBits != nil) {
				return PackageResult{}, fmt.Errorf(
					"signal %q: USE_FALLBACK và giá trị dự phòng phải đi liền nhau", signal.Name)
			}
			item := map[string]any{
				"name": signal.Name, "publisher": signal.Publisher, "type": signal.Type,
				"freshnessMs": signal.FreshnessMs, "stalePolicy": signal.StalePolicy,
			}
			if signal.FallbackBits != nil {
				item["fallbackBits"] = *signal.FallbackBits
			}
			encoded = append(encoded, item)
		}
		payload, err := json.Marshal(encoded)
		if err != nil {
			return PackageResult{}, err
		}
		signalPath := filepath.Join(jobRoot, "signals.json")
		if err := writeExclusive(signalPath, payload, 0o600); err != nil {
			return PackageResult{}, err
		}
		args = append(args, "--signals", signalPath)
	}
	if len(linkedPOUs) > 0 {
		if err := validatePackagePOUs(linkedPOUs); err != nil {
			return PackageResult{}, err
		}
		payload, err := json.Marshal(struct {
			SchemaVersion int         `json:"schemaVersion"`
			POUs          []LinkedPOU `json:"pous"`
		}{SchemaVersion: 1, POUs: linkedPOUs})
		if err != nil {
			return PackageResult{}, err
		}
		path := filepath.Join(jobRoot, "pou-table.json")
		if err := writeExclusive(path, payload, 0o600); err != nil {
			return PackageResult{}, err
		}
		args = append(args, "--pou-table", path)
	}
	if libraryLock.SystemVersion != "" {
		if err := validateLinkedInputs(Input{LibraryLock: libraryLock}); err != nil {
			return PackageResult{}, err
		}
		payload, err := json.Marshal(struct {
			SchemaVersion int `json:"schemaVersion"`
			LibraryLock
		}{SchemaVersion: 1, LibraryLock: libraryLock})
		if err != nil {
			return PackageResult{}, err
		}
		path := filepath.Join(jobRoot, "library-lock.json")
		if err := writeExclusive(path, payload, 0o600); err != nil {
			return PackageResult{}, err
		}
		args = append(args, "--library-lock", path)
	} else {
		for _, pou := range linkedPOUs {
			if pou.FromLibrary {
				return PackageResult{}, fmt.Errorf("POU từ Control Library thiếu library lock")
			}
		}
	}

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

func validatePackagePOUs(items []LinkedPOU) error {
	seen := make(map[string]struct{}, len(items))
	previous := ""
	for _, item := range items {
		key := strings.ToUpper(item.Name)
		if !boundedLen(item.Name, 1, 64) || (item.Kind != "FUNCTION" && item.Kind != "FUNCTION_BLOCK") ||
			len(item.BodySHA256) != sha256.Size*2 || len(item.ContentSHA256) != sha256.Size*2 ||
			len(item.InputNames) != len(item.InputTypes) || len(item.OutputNames) != len(item.OutputTypes) ||
			(previous != "" && key < previous) {
			return fmt.Errorf("POU table không hợp lệ")
		}
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("POU table trùng tên: %s", item.Name)
		}
		seen[key] = struct{}{}
		previous = key
		if _, err := hex.DecodeString(item.BodySHA256); err != nil {
			return fmt.Errorf("POU table body hash không hợp lệ")
		}
		if _, err := hex.DecodeString(item.ContentSHA256); err != nil {
			return fmt.Errorf("POU table content hash không hợp lệ")
		}
		if item.FromLibrary && (item.LibraryEntryID == "" || item.Version == "") {
			return fmt.Errorf("POU table library metadata không hợp lệ")
		}
	}
	return nil
}
