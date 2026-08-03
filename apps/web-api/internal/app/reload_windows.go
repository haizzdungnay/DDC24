//go:build windows

package app

import "fmt"

func sendSignalReload(string, string) (bool, []string) {
	return false, []string{"reload không hỗ trợ trên dev windows"}
}

func applySystem(string) (bool, []string) {
	return false, []string{"reload không hỗ trợ trên dev windows"}
}

func runReloadHelperServer() error {
	return fmt.Errorf("reload helper chỉ chạy trên linux")
}
