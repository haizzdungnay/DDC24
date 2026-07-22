//go:build windows

package main

import "fmt"

func runTimeHelper(string) error { return fmt.Errorf("time helper is unavailable on Windows") }
func runTimeHelperServer() error { return fmt.Errorf("time helper server is unavailable on Windows") }
