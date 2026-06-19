//go:build windows

package main

func sendSignalReload(string, string) (bool, []string) {
	return false, []string{"reload không hỗ trợ trên dev windows"}
}

func applySystem(string) (bool, []string) {
	return false, []string{"reload không hỗ trợ trên dev windows"}
}
