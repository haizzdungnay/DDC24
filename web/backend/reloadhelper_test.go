//go:build linux

package main

import (
	"bufio"
	"net"
	"path/filepath"
	"strings"
	"testing"
)

// startFakeReloadHelper dựng một listener nói đúng protocol của helper thật để
// kiểm phía client mà không cần quyền root hay đụng vào systemd.
func startFakeReloadHelper(t *testing.T, reply string) string {
	t.Helper()
	// Socket path của AF_UNIX bị giới hạn ~108 ký tự nên không dùng t.TempDir().
	path := filepath.Join(t.TempDir(), "r.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Skipf("không tạo được unix socket: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			_, _ = bufio.NewReader(conn).ReadString('\n')
			_, _ = conn.Write([]byte(reply + "\n"))
			_ = conn.Close()
		}
	}()
	return path
}

func TestApplySystemUsesHelperAndReportsRealOutcome(t *testing.T) {
	t.Setenv("RELOAD_HELPER_SOCK", startFakeReloadHelper(t, "ok"))

	applied, warnings := applySystem(reloadRestartIobus)
	if !applied || len(warnings) != 0 {
		t.Fatalf("applied=%v warnings=%v; want áp dụng thành công", applied, warnings)
	}
}

func TestApplySystemReportsFailureWhenHelperRejects(t *testing.T) {
	t.Setenv("RELOAD_HELPER_SOCK", startFakeReloadHelper(t, "error restart failed"))

	applied, warnings := applySystem(reloadSystem)
	if applied {
		t.Fatal("applied=true; helper đã báo lỗi thì không được coi là đã áp dụng")
	}
	if len(warnings) != 1 || warnings[0] != reloadHelperFailedWarning {
		t.Fatalf("warnings = %v; want cảnh báo thất bại", warnings)
	}
}

// F-01 (regression guard): thông điệp tới người vận hành KHÔNG được chứa mã hạng
// mục nội bộ. Chuỗi cũ `reload system pending B7 (systemd/polkit)` từng lọt
// thẳng ra toast trên giao diện.
func TestApplySystemWarningIsOperatorReadableWhenHelperMissing(t *testing.T) {
	t.Setenv("RELOAD_HELPER_SOCK", filepath.Join(t.TempDir(), "khong-ton-tai.sock"))

	applied, warnings := applySystem(reloadRestartIobus)
	if applied {
		t.Fatal("applied=true dù helper không chạy")
	}
	if len(warnings) != 1 || warnings[0] != reloadHelperUnavailableWarning {
		t.Fatalf("warnings = %v; want cảnh báo helper không sẵn sàng", warnings)
	}
	for _, forbidden := range []string{"B7", "polkit", "systemd", "pending"} {
		if strings.Contains(warnings[0], forbidden) {
			t.Fatalf("cảnh báo %q còn chứa thuật ngữ nội bộ %q", warnings[0], forbidden)
		}
	}
}

func TestApplySystemRejectsUnknownTargetBeforeDialing(t *testing.T) {
	t.Setenv("RELOAD_HELPER_SOCK", startFakeReloadHelper(t, "ok"))

	applied, warnings := applySystem("restart-everything")
	if applied || len(warnings) != 1 || !strings.Contains(warnings[0], "unknown reload target") {
		t.Fatalf("applied=%v warnings=%v; want từ chối target lạ", applied, warnings)
	}
}

// Ranh giới đặc quyền: helper chỉ chấp nhận reload target đã allowlist, và
// allowlist không được chứa mkddc-core (gián đoạn điều khiển) hay bất cứ unit
// mạng nào — Ethernet thuộc quyền mkddc-netcfg theo ADR-017.
func TestReloadHelperAllowlistIsNarrow(t *testing.T) {
	if err := runReloadHelper("restart-everything"); err == nil {
		t.Fatal("helper chấp nhận target ngoài allowlist")
	}
	if err := runReloadHelper("mkddc-core.service"); err == nil {
		t.Fatal("helper chấp nhận tên unit thô từ client")
	}
	for target, units := range reloadHelperUnits {
		for _, unit := range units {
			if !strings.HasPrefix(unit, "mkddc-") || !strings.HasSuffix(unit, ".service") {
				t.Fatalf("allowlist[%s] chứa unit lạ %q", target, unit)
			}
			if unit == "mkddc-core.service" {
				t.Fatalf("allowlist[%s] không được restart core: gián đoạn điều khiển", target)
			}
			if strings.Contains(unit, "netcfg") || strings.Contains(unit, "network") {
				t.Fatalf("allowlist[%s] không được đụng tới mạng: ADR-017 giao cho mkddc-netcfg", target)
			}
		}
	}
}
