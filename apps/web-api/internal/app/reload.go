package app

const (
	reloadSIGHUPCore   = "sighup-core"
	reloadSIGHUPIobus  = "sighup-iobus"
	reloadRestartIobus = "restart-iobus"
	reloadSystem       = "system"
	reloadNone         = "none"
)

// Cảnh báo trả về cho người VẬN HÀNH, không phải cho lập trình viên.
//
// F-01: chuỗi cũ là `reload system pending B7 (systemd/polkit)` — lọt thẳng vào
// toast trên giao diện. Người dùng không biết "B7" là gì và không có hành động
// nào để làm tiếp. Hai chuỗi dưới đây nói rõ chuyện gì đã xảy ra với cấu hình
// của họ và bước tiếp theo là gì.
const (
	reloadHelperUnavailableWarning = "Đã lưu cấu hình, nhưng dịch vụ áp dụng thay đổi hiện không chạy. " +
		"Cấu hình sẽ có hiệu lực sau khi khởi động lại thiết bị."
	reloadHelperFailedWarning = "Đã lưu cấu hình, nhưng khởi động lại dịch vụ thất bại. " +
		"Hãy kiểm tra nhật ký thiết bị trước khi thử lại."
)

func (a *App) dispatchReload(target string) (applied bool, warnings []string) {
	if a != nil && a.reloadDispatcher != nil {
		return a.reloadDispatcher(target)
	}
	switch target {
	case reloadSIGHUPCore:
		return sendSignalReload(a.cfg.CorePidPath, "mkddc-core")
	case reloadSIGHUPIobus:
		return sendSignalReload(a.cfg.IobusPidPath, "mkddc-iobus")
	case reloadRestartIobus, reloadSystem:
		return applySystem(target)
	case reloadNone, "":
		return true, nil
	default:
		return false, []string{"unknown reload target " + target}
	}
}
