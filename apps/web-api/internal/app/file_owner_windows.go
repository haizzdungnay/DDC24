//go:build windows

package app

func preserveExistingFileOwnership(string, string) error { return nil }
