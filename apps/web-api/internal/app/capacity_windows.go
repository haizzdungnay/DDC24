//go:build windows

package app

import "golang.org/x/sys/windows"

func filesystemFreeBytes(path string) (uint64, error) {
	root, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var free uint64
	err = windows.GetDiskFreeSpaceEx(root, &free, nil, nil)
	return free, err
}
