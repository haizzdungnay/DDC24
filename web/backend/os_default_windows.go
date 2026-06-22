//go:build windows

package main

func NewDefaultOSReader() OSReader {
	return WindowsOSReader{}
}
