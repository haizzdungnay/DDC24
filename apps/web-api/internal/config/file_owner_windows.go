//go:build windows

package config

func preserveExistingFileOwnership(string, string) error { return nil }
