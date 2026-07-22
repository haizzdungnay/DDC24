//go:build windows

package main

func preserveExistingFileOwnership(string, string) error { return nil }
