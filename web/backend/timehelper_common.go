package main

import (
	"os"
	"time"
)

func manualTimeCommandValue(instant time.Time, timezone string) (string, error) {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return "", err
	}
	return instant.In(location).Format("2006-01-02 15:04:05"), nil
}

func persistTimezoneName(path, timezone string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, os.FileMode(0o644))
	if err != nil {
		return err
	}
	if err := file.Chmod(os.FileMode(0o644)); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.WriteString(timezone + "\n"); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}
