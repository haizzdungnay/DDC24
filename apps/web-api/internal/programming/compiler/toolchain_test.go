package compiler

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mkddc-web/internal/programming/domain"
)

func currentCompilerVersionLine() string {
	return fmt.Sprintf("compiler_version=fwsom-st-1.2.0 profile_id=%s profile_sha256=%s artifact_schema=1 target_abi=%d",
		domain.ProfileID, domain.ProfileSHA256, domain.ProfileTargetABI)
}

func currentPackagerVersionLine() string {
	return fmt.Sprintf("packager_version=2 profile_id=%s profile_sha256=%s artifact_schema=2 target_abi=%d",
		domain.ProfileID, domain.ProfileSHA256, domain.ProfileTargetABI)
}

// Dòng `--version` THẬT của compiler trên Foxlinx 2026-09-26: build ngày
// 2026-09-13 cho profile v2.1, chạy cùng web profile v2.2.
const foxlinxStaleCompilerLine = "compiler_version=fwsom-st-1.2.0 profile_id=revA-1t-1-5-30 " +
	"profile_sha256=d2866c41065e2a51fba88460068df453d63b6e95b30879eba292f4b667b49ede artifact_schema=1 target_abi=3841"

func TestCheckToolVersionAcceptsToolsBuiltForCurrentProfile(t *testing.T) {
	if err := checkToolVersion("compiler", "/usr/sbin/mkddc-st-compile", currentCompilerVersionLine()+"\n"); err != nil {
		t.Fatalf("compiler cùng profile bị từ chối: %v", err)
	}
	if err := checkToolVersion("packager", "/usr/sbin/mkddc-st-package", currentPackagerVersionLine()+"\n"); err != nil {
		t.Fatalf("packager cùng profile bị từ chối: %v", err)
	}
}

func TestCheckToolVersionRejectsFoxlinxStaleCompilerWithBothHashes(t *testing.T) {
	err := checkToolVersion("compiler", "/usr/sbin/mkddc-st-compile", foxlinxStaleCompilerLine)
	if !errors.Is(err, ErrToolchainMismatch) {
		t.Fatalf("compiler profile cũ phải là ErrToolchainMismatch, nhận: %v", err)
	}
	// Người sửa trên bo cần đủ hai con số và biết phải cài lại cái gì.
	for _, want := range []string{"profile_sha256=d2866c41", "web cần " + domain.ProfileSHA256, "/usr/sbin/mkddc-st-compile", "cài lại"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("thông điệp thiếu %q: %v", want, err)
		}
	}
}

func TestCheckToolVersionRejectsOutputWithoutProfileTokens(t *testing.T) {
	// Binary trả lời `--version` bằng định dạng khác (không phải tool ST, hoặc
	// bản quá cũ) cũng là lệch bản, không phải "khớp vì không có gì để so".
	err := checkToolVersion("packager", "/usr/sbin/mkddc-st-package", "mkddc-st-package revA-1t-1-5-30\n")
	if !errors.Is(err, ErrToolchainMismatch) || !strings.Contains(err.Error(), "profile_sha256=<thiếu>") {
		t.Fatalf("thiếu token profile phải bị từ chối, nhận: %v", err)
	}
}

func TestToolchainProbeReportsMissingBinaryAsMismatch(t *testing.T) {
	probe := &ToolchainProbe{CompilerPath: filepath.Join(t.TempDir(), "mkddc-st-compile")}
	err := probe.Verify(context.Background())
	if !errors.Is(err, ErrToolchainMismatch) || !strings.Contains(err.Error(), "không có") {
		t.Fatalf("thiếu compiler phải là ErrToolchainMismatch, nhận: %v", err)
	}
}

func writeVersionScript(t *testing.T, path, line string) {
	t.Helper()
	body := "#!/bin/sh\necho '" + line + "'\n"
	if err := os.WriteFile(path, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
}

// installVersionScript thay binary như `install` làm: ghi file mới rồi rename
// đè, nên inode đổi — không phụ thuộc độ phân giải mtime của filesystem.
func installVersionScript(t *testing.T, path, line string) {
	t.Helper()
	staged := path + ".new"
	writeVersionScript(t, staged, line)
	if err := os.Rename(staged, path); err != nil {
		t.Fatal(err)
	}
}

func TestToolchainProbeReprobesAfterBinaryIsReplaced(t *testing.T) {
	dir := t.TempDir()
	compiler := filepath.Join(dir, "mkddc-st-compile")
	packager := filepath.Join(dir, "mkddc-st-package")
	writeVersionScript(t, compiler, foxlinxStaleCompilerLine)
	writeVersionScript(t, packager, currentPackagerVersionLine())
	probe := &ToolchainProbe{CompilerPath: compiler, PackagerPath: packager}

	if err := probe.Verify(context.Background()); !errors.Is(err, ErrToolchainMismatch) {
		t.Fatalf("compiler cũ phải bị bắt, nhận: %v", err)
	}
	// Kết quả được nhớ: gọi lại không chạy lại binary nhưng vẫn trả cùng lỗi.
	if err := probe.Verify(context.Background()); !errors.Is(err, ErrToolchainMismatch) {
		t.Fatalf("lần gọi thứ hai phải trả lỗi đã nhớ, nhận: %v", err)
	}
	// Cài bản đúng (inode mới, cùng kích thước vì hai dòng version dài bằng
	// nhau) ⇒ lần gọi kế tiếp tự dò lại, không cần restart web.
	installVersionScript(t, compiler, currentCompilerVersionLine())
	if err := probe.Verify(context.Background()); err != nil {
		t.Fatalf("sau khi cài compiler đúng bản vẫn báo lệch: %v", err)
	}
}

func TestDecodeCLIResponseVersionMismatchIsToolchainMismatch(t *testing.T) {
	raw := []byte(fmt.Sprintf(`{"ok":true,"diagnostics":[],"compilerVersion":"fwsom-st-1.1.0","artifactSchemaVersion":1,"targetAbi":%d}`,
		domain.ProfileTargetABI))
	_, err := decodeCLIResponse(raw)
	if !errors.Is(err, ErrToolchainMismatch) || !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("compiler khác version phải vừa là ErrInvalidOutput vừa là ErrToolchainMismatch, nhận: %v", err)
	}
}

func TestValidateSuccessProfileMismatchIsToolchainMismatch(t *testing.T) {
	code := domain.ProfileCode
	profileID := domain.ProfileID
	staleSHA := "d2866c41065e2a51fba88460068df453d63b6e95b30879eba292f4b667b49ede"
	library := domain.ProfileLibraryVersion
	response := cliResponse{CompilerProfile: &code, ProfileID: &profileID, ProfileSHA256: &staleSHA, LibraryVersion: &library}
	_, err := validateSuccess(response, "", "", Input{})
	if !errors.Is(err, ErrToolchainMismatch) || !strings.Contains(err.Error(), "sha256=d2866c41") {
		t.Fatalf("artifact của profile khác phải là ErrToolchainMismatch, nhận: %v", err)
	}
}
