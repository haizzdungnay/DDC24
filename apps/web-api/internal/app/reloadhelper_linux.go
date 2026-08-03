//go:build linux

package app

// Privileged reload helper — đóng finding F-01.
//
// Trước 2026-07-31, applySystem() là stub luôn trả về
// `reload <target> pending B7 (systemd/polkit)`. Hệ quả: mọi lần Lưu BACnet/WiFi
// đều GHI ĐƯỢC file nhưng KHÔNG BAO GIỜ có hiệu lực, và người vận hành nhận đúng
// chuỗi thuật ngữ nội bộ đó trong toast — không thể hành động được. Hạng mục "B7"
// cũng không tồn tại trong bất kỳ tài liệu nào của docs/.
//
// Vì sao là helper riêng chứ không phải sudo/polkit tuỳ tiện: tiến trình web chạy
// user `mkddc` với NoNewPrivileges=true và KHÔNG được phép có quyền restart
// service. Dự án đã có sẵn đúng khuôn mẫu cho việc này — mkddc-time-helper: một
// subcommand của chính binary này, chạy root dưới systemd, phục vụ trên unix
// socket 0660 root:mkddc. File này theo đúng khuôn mẫu đó.
//
// Ranh giới đặc quyền: helper KHÔNG nhận tên unit tuỳ ý từ client. Client chỉ gửi
// một `reload target` đã biết trước, helper tự tra sang danh sách unit cứng trong
// reloadHelperUnits. Kể cả khi tiến trình web bị chiếm quyền, bề mặt tấn công tối
// đa vẫn chỉ là restart đúng các unit mkddc-* đã liệt kê.

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const defaultReloadHelperSocket = "/run/mkddc/reload-helper.sock"

// reloadHelperUnits là allowlist DUY NHẤT. Cố ý không chứa mkddc-core (restart
// core làm gián đoạn điều khiển) và không chứa bất cứ thứ gì liên quan tới mạng
// — Ethernet thuộc quyền mkddc-netcfg theo ADR-017, không đi qua đường này.
var reloadHelperUnits = map[string][]string{
	reloadRestartIobus: {"mkddc-iobus.service"},
	reloadSystem:       {"mkddc-iobus.service"},
}

func reloadHelperSocketPath() string {
	if value := os.Getenv("RELOAD_HELPER_SOCK"); value != "" {
		return value
	}
	return defaultReloadHelperSocket
}

func runReloadHelperServer() error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("root privileges required")
	}
	path := reloadHelperSocketPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	_ = os.Remove(path)
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	defer listener.Close()
	group, err := user.LookupGroup("mkddc")
	if err != nil {
		return err
	}
	gid, err := strconv.Atoi(group.Gid)
	if err != nil {
		return err
	}
	if err := os.Chown(path, 0, gid); err != nil {
		return err
	}
	if err := os.Chmod(path, 0o660); err != nil {
		return err
	}
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		go handleReloadHelperConnection(conn)
	}
}

func handleReloadHelperConnection(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(90 * time.Second))
	request, err := bufio.NewReader(io.LimitReader(conn, 257)).ReadString('\n')
	if err != nil || len(request) > 256 {
		_, _ = conn.Write([]byte("error invalid request\n"))
		return
	}
	if err := runReloadHelper(strings.TrimSpace(request)); err != nil {
		_, _ = conn.Write([]byte("error " + sanitizeHelperError(err) + "\n"))
		return
	}
	_, _ = conn.Write([]byte("ok\n"))
}

func runReloadHelper(target string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("root privileges required")
	}
	units, ok := reloadHelperUnits[target]
	if !ok {
		return fmt.Errorf("target not allowed")
	}
	for _, unit := range units {
		// try-restart: unit không được bật thì bỏ qua thay vì dựng nó dậy.
		// Trên board lab, mkddc-hmi bị disable có chủ đích và web không có quyền
		// quyết định bật lại một service mà người vận hành đã tắt.
		if err := helperCommand(systemctlPath, "try-restart", unit); err != nil {
			return fmt.Errorf("restart %s: %w", unit, err)
		}
	}
	return nil
}

// sanitizeHelperError giữ thông điệp trả về ngắn và không rò đường dẫn hệ thống
// hay output lệnh ra phía client.
func sanitizeHelperError(err error) string {
	message := err.Error()
	if index := strings.IndexAny(message, ":\n"); index > 0 {
		message = message[:index]
	}
	if len(message) > 80 {
		message = message[:80]
	}
	return strings.TrimSpace(message)
}

// applySystem gọi helper đặc quyền. Đây là hiện thực THẬT thay cho stub cũ.
//
// Trả (false, warnings) khi helper chưa cài/không chạy — trường hợp đó cấu hình
// vẫn đã được ghi xuống file, nên thông điệp phải nói đúng điều đó bằng ngôn ngữ
// người vận hành hiểu được, không phải mã hạng mục nội bộ.
func applySystem(target string) (bool, []string) {
	if _, ok := reloadHelperUnits[target]; !ok {
		return false, []string{"unknown reload target " + target}
	}
	conn, err := net.DialTimeout("unix", reloadHelperSocketPath(), 2*time.Second)
	if err != nil {
		return false, []string{reloadHelperUnavailableWarning}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(90 * time.Second))
	if _, err := conn.Write([]byte(target + "\n")); err != nil {
		return false, []string{reloadHelperUnavailableWarning}
	}
	response, err := bufio.NewReader(io.LimitReader(conn, 257)).ReadString('\n')
	if err != nil {
		return false, []string{reloadHelperUnavailableWarning}
	}
	if strings.TrimSpace(response) != "ok" {
		return false, []string{reloadHelperFailedWarning}
	}
	return true, nil
}
