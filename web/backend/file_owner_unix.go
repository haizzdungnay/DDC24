//go:build !windows

package main

import (
	"errors"
	"os"
	"syscall"
)

func preserveExistingFileOwnership(path, replacement string) error {
	if os.Geteuid() != 0 {
		return nil
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}
	return os.Chown(replacement, int(stat.Uid), int(stat.Gid))
}
