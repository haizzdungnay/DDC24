package compiler

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"mkddc-web/internal/programming/domain"
)

// ErrToolchainMismatch — tool ST trên máy (`mkddc-st-compile`,
// `mkddc-st-package`) không cùng bản với web: thiếu file, hoặc được build cho
// một profile/ABI khác với hằng sinh từ hợp đồng mà web đang chạy.
//
// Đây là lỗi TẤT ĐỊNH của việc triển khai, không phải worker chết ngẫu nhiên.
// Trên Foxlinx 2026-09-26, web profile v2.2 chạy cùng compiler còn mang
// profile v2.1 (`profile_sha256=d2866c41…`): runner từ chối metadata, Check
// giữ RUNNING tới hết lease 30 s để "thử lại", lần hai hỏng y hệt, rồi đóng
// bằng `ST-WORKER-CRASH` — người dùng thấy Check treo rồi một mã lỗi chỉ sai
// chỗ sửa. Lỗi này (cùng họ với `P5-507-F05`, compiler chưa được cài) phải
// dừng NGAY với mã riêng và nói rõ phải cài lại tool nào.
var ErrToolchainMismatch = errors.New("tool ST lệch bản với web")

// ToolchainProbe kiểm `--version` của compiler và packager so với profile sinh
// từ hợp đồng. Kết quả được nhớ theo (inode, mtime, size) của từng binary: cài
// bản mới (`install` luôn tạo inode mới) là lần gọi kế tiếp tự dò lại, không
// cần restart web.
type ToolchainProbe struct {
	CompilerPath string
	PackagerPath string
	Timeout      time.Duration

	mu    sync.Mutex
	cache map[string]toolchainProbeEntry
}

type toolchainProbeEntry struct {
	info os.FileInfo
	err  error
}

// Verify trả nil khi cả hai tool khớp profile, lỗi bọc ErrToolchainMismatch khi
// thiếu hoặc lệch. Lỗi không tất định (không chạy được `--version` trong thời
// hạn) KHÔNG bọc ErrToolchainMismatch để nơi gọi không chặn nhầm một Check.
func (p *ToolchainProbe) Verify(ctx context.Context) error {
	if p == nil {
		return nil
	}
	var problems []error
	for _, tool := range []struct {
		path string
		kind string
	}{{p.CompilerPath, "compiler"}, {p.PackagerPath, "packager"}} {
		if tool.path == "" {
			continue
		}
		if err := p.verifyOne(ctx, tool.path, tool.kind); err != nil {
			problems = append(problems, err)
		}
	}
	return errors.Join(problems...)
}

func (p *ToolchainProbe) verifyOne(ctx context.Context, path, kind string) error {
	info, statErr := os.Stat(path)
	if statErr != nil {
		return fmt.Errorf("%w: %s %s không có (%v) — cài lại tool ST cùng bản với mkddc-web",
			ErrToolchainMismatch, kind, path, statErr)
	}
	p.mu.Lock()
	if p.cache == nil {
		p.cache = make(map[string]toolchainProbeEntry)
	}
	if entry, ok := p.cache[path]; ok && os.SameFile(entry.info, info) &&
		entry.info.ModTime().Equal(info.ModTime()) && entry.info.Size() == info.Size() {
		p.mu.Unlock()
		return entry.err
	}
	p.mu.Unlock()

	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, runErr := exec.CommandContext(probeCtx, path, "--version").Output()
	if probeCtx.Err() != nil || (runErr != nil && len(out) == 0) {
		// Không cache: có thể chỉ là máy đang bận.
		return fmt.Errorf("%s %s --version: %v", kind, path, runErr)
	}
	err := checkToolVersion(kind, path, string(out))
	p.mu.Lock()
	p.cache[path] = toolchainProbeEntry{info: info, err: err}
	p.mu.Unlock()
	return err
}

// parseToolVersion đọc dòng `khoá=giá trị` mà `mkddc-st-compile --version` và
// `mkddc-st-package --version` in ra.
func parseToolVersion(line string) map[string]string {
	fields := make(map[string]string)
	for _, token := range strings.Fields(line) {
		key, value, ok := strings.Cut(token, "=")
		if ok {
			fields[key] = value
		}
	}
	return fields
}

func checkToolVersion(kind, path, output string) error {
	fields := parseToolVersion(output)
	var mismatches []string
	expect := func(key, want string) {
		if got := fields[key]; got != want {
			if got == "" {
				got = "<thiếu>"
			}
			mismatches = append(mismatches, fmt.Sprintf("%s=%s (web cần %s)", key, got, want))
		}
	}
	expect("profile_id", domain.ProfileID)
	expect("profile_sha256", domain.ProfileSHA256)
	expect("target_abi", strconv.Itoa(domain.ProfileTargetABI))
	if kind == "compiler" {
		expect("compiler_version", "fwsom-st-1.2.0")
		expect("artifact_schema", "1")
	}
	if len(mismatches) == 0 {
		return nil
	}
	return fmt.Errorf("%w: %s %s: %s — cài lại tool ST cùng bản với mkddc-web",
		ErrToolchainMismatch, kind, path, strings.Join(mismatches, ", "))
}
