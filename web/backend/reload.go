package main

const (
	reloadSIGHUPCore   = "sighup-core"
	reloadSIGHUPIobus  = "sighup-iobus"
	reloadRestartIobus = "restart-iobus"
	reloadSystem       = "system"
	reloadNone         = "none"
)

func (a *App) dispatchReload(target string) (applied bool, warnings []string) {
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
