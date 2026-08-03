//go:build windows

package app

func NewDefaultOSReader() OSReader {
	return WindowsOSReader{}
}
